import { desc, eq, inArray } from "drizzle-orm";
import {
  allocationsTable, c1ExperimentsTable, c2ExperimentsTable, db, preparedInputsTable, validationRunsTable,
} from "@workspace/db";
import type { C2ExperimentInput as ApiC2ExperimentInput } from "@workspace/api-zod";
import { computeC2Diagnostics, C2_ENGINE_VERSION } from "./c2-diagnostics";
import type { AllocationRequest } from "./allocation-b2";
import type { C2Input, C2Sources } from "./c2-diagnostics";
import { parseCsv } from "./calculator";
import { canonicalJson, fingerprint, type PreparedCandidate, type PreparedSnapshot } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";
import { persistC1Experiment } from "./c1-experiment-store";
import type { B3Assumptions } from "./b3-policy";
import { replayB3ValidationRun } from "./b3-validation-store";
import { planC1Policies } from "./c1-contribution";

const REPLAY_TOLERANCE = 1e-8;

type C1Child = {
  label: string;
  excludedCandidateIds: string[];
  validationRunId: number | null;
  validationInputHash?: string;
  policyRequest: unknown;
  result: unknown;
};

type FrozenC1 = {
  status: string;
  manifest: any;
  children: C1Child[];
  summary: any;
  successfulValidationRunIds: number[];
};

type C2Manifest = {
  schemaVersion: 1;
  input: C2StoreInput;
  engineVersion: string;
  sourceIdentities: Record<string, unknown>;
  sourceHashes: Record<string, unknown>;
  sources: C2Sources;
};

type C2StoreInput = C2Input & { assumptions?: B3Assumptions };

type DependencyPlanItem = {
  alphaId: string;
  status: "REUSE" | "WILL_CREATE" | "UNAVAILABLE";
  c1ExperimentId: number | null;
  fingerprint: string;
  reason: string | null;
  childPolicyCount: number;
  spec: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function preparedFingerprint(snapshot: unknown): string {
  if (!isRecord(snapshot) || !isRecord(snapshot.dataset) || !isRecord(snapshot.factorSet)) return "";
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

function allocationFingerprint(row: typeof allocationsTable.$inferSelect): string {
  const snapshotHash = fingerprint(row.frozenSnapshot);
  if (snapshotHash !== row.frozenSnapshotHash) return "";
  return fingerprint({
    preparedInputId: row.preparedInputId,
    representation: row.representation,
    engineVersion: row.engineVersion,
    request: row.frozenRequest,
    snapshotHash,
    result: row.frozenResult,
  });
}

function candidateDefinition(candidate: PreparedCandidate) {
  const rawDefinition = candidate.lineage.definition;
  const definition = isRecord(rawDefinition) ? { ...rawDefinition } : null;
  if (definition) delete definition.name;
  return {
    kind: candidate.kind,
    factorId: candidate.factorId ?? null,
    assetTickers: candidate.assetTickers,
    mapping: candidate.mapping ?? null,
    signalUnits: candidate.signalUnits ?? null,
    definition,
  };
}

function compatibleCandidateDefinitions(policy: PreparedCandidate, validation: PreparedCandidate): boolean {
  if (policy.kind !== validation.kind ||
      canonicalJson(policy.assetTickers) !== canonicalJson(validation.assetTickers) ||
      policy.factorId !== validation.factorId || policy.mapping !== validation.mapping ||
      policy.signalUnits !== validation.signalUnits) return false;
  if (policy.kind !== "alpha_streams") return true;
  const withoutDisplayName = (value: unknown) => {
    if (!isRecord(value)) return null;
    const copy = { ...value };
    delete copy.name;
    return copy;
  };
  return canonicalJson(withoutDisplayName(policy.lineage.definition)) ===
    canonicalJson(withoutDisplayName(validation.lineage.definition));
}

function validDataset(snapshot: PreparedSnapshot): boolean {
  return typeof snapshot.dataset?.csvContent === "string" &&
    hashDataset(snapshot.dataset.csvContent) === snapshot.dataset.sha256;
}

function validateCandidateReturns(
  candidate: PreparedCandidate,
  datasetHash: string,
  sourceDates: Set<string>,
): string | null {
  if (candidate.status !== "READY")
    return `Candidate ${candidate.candidateId} is ${candidate.status}, not READY.`;
  if (candidate.lineage.datasetHash !== datasetHash)
    return `Candidate ${candidate.candidateId} lineage dataset hash does not match its frozen B1 source.`;
  if (!Array.isArray(candidate.returnSeries) || !candidate.returnSeries.length ||
      !Array.isArray(candidate.ledger) || !candidate.ledger.length)
    return `Candidate ${candidate.candidateId} is missing its frozen B1 return series or accounting ledger.`;

  const returnByDate = new Map<string, number | null>();
  for (const point of candidate.returnSeries) {
    if (!point || typeof point.date !== "string" || returnByDate.has(point.date) ||
        !sourceDates.has(point.date) ||
        (point.value !== null && (!Number.isFinite(point.value) || typeof point.value !== "number")))
      return `Candidate ${candidate.candidateId} has invalid or duplicate dated return observations.`;
    returnByDate.set(point.date, point.value);
  }
  const ledgerByDate = new Map<string, Record<string, unknown>>();
  for (const item of candidate.ledger) {
    if (!isRecord(item) || typeof item.date !== "string" || ledgerByDate.has(item.date))
      return `Candidate ${candidate.candidateId} has invalid or duplicate dated ledger entries.`;
    ledgerByDate.set(item.date, item);
  }
  if (returnByDate.size !== ledgerByDate.size ||
      [...ledgerByDate.keys()].some((date) => !returnByDate.has(date)))
    return `Candidate ${candidate.candidateId} B1 return dates do not match its ledger dates.`;
  for (const [date, value] of returnByDate) {
    const entry = ledgerByDate.get(date);
    if (!entry) return `Candidate ${candidate.candidateId} return on ${date} has no matching frozen ledger entry.`;
    const beginningNav = entry.beginningNav;
    const netPnl = entry.netPnl;
    if (typeof beginningNav === "number" && Number.isFinite(beginningNav) &&
        typeof netPnl === "number" && Number.isFinite(netPnl) && beginningNav > 0) {
      const ledgerReturn = netPnl / beginningNav;
      if (value === null || Math.abs(value - ledgerReturn) > REPLAY_TOLERANCE)
        return `Candidate ${candidate.candidateId} return series and ledger disagree on ${date}.`;
    } else if (value !== null && typeof entry.dailyNetReturn === "number" &&
        Number.isFinite(entry.dailyNetReturn) && Math.abs(value - entry.dailyNetReturn) > REPLAY_TOLERANCE) {
      return `Candidate ${candidate.candidateId} return series and daily ledger return disagree on ${date}.`;
    }
  }
  return null;
}

function normalizeInput(raw: ApiC2ExperimentInput): C2StoreInput {
  const toDate = (value: unknown): string => value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === "string" ? value.slice(0, 10) : "";
  return {
    allocationId: raw.allocationId,
    validationPreparedInputId: raw.validationPreparedInputId,
    c1ExperimentId: raw.c1ExperimentId ?? null,
    ...(raw.assumptions ? { assumptions: structuredClone(raw.assumptions) as B3Assumptions } : {}),
    alphaIds: [...raw.alphaIds],
    startDate: toDate(raw.startDate),
    endDate: toDate(raw.endDate),
    regimeSource: raw.regimeSource,
    regimeMapping: structuredClone(raw.regimeMapping ?? {}),
    rollingWindow: raw.rollingWindow ?? 63,
    rollingStep: raw.rollingStep ?? 21,
    contributionWindow: raw.contributionWindow ?? 252,
    contributionStep: raw.contributionStep ?? 63,
    minRollingPaired: raw.minRollingPaired ?? 40,
    minRegimePaired: raw.minRegimePaired ?? 30,
    minSharpeObservations: raw.minSharpeObservations ?? 30,
    highCorrelationThreshold: raw.highCorrelationThreshold ?? 0.8,
    materialCorrelationGap: raw.materialCorrelationGap ?? 0.3,
  };
}

function validateNormalizedInput(input: C2StoreInput): string | null {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!Number.isSafeInteger(input.allocationId) || input.allocationId < 1 ||
      !Number.isSafeInteger(input.validationPreparedInputId) || input.validationPreparedInputId < 1)
    return "allocationId and validationPreparedInputId must be positive safe integers.";
  if (input.c1ExperimentId !== null && (!Number.isSafeInteger(input.c1ExperimentId) || input.c1ExperimentId < 1))
    return "c1ExperimentId must be null or a positive safe integer.";
  if (!input.alphaIds.length || input.alphaIds.length > 5 ||
      input.alphaIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(input.alphaIds).size !== input.alphaIds.length)
    return "alphaIds must contain one to five unique, explicit canonical alpha IDs.";
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate)
    return "startDate and endDate must be valid ISO dates with startDate not after endDate.";
  if (input.assumptions) {
    const assumptions = input.assumptions;
    const allowedAssumptionKeys = new Set([
      "evaluationStartDate", "evaluationEndDate", "decisionCalendar", "executionTiming",
      "initialNav", "initialHoldings", "initialCash", "transactionCostBps", "slippageBps",
      "dailyCashYield", "benchmarkTicker",
    ]);
    if (Object.keys(assumptions).some((key) => !allowedAssumptionKeys.has(key)))
      return "B3 assumptions contain unsupported fields.";
    if (assumptions.evaluationStartDate !== input.startDate ||
        assumptions.evaluationEndDate !== input.endDate)
      return "B3 assumptions evaluation dates must exactly match the C2 startDate and endDate.";
    if (!validDate(assumptions.evaluationStartDate) || !validDate(assumptions.evaluationEndDate) ||
        assumptions.evaluationStartDate >= assumptions.evaluationEndDate)
      return "B3 assumption evaluation dates must be valid ISO dates with start before end.";
    if (!["monthly", "quarterly"].includes(assumptions.decisionCalendar) ||
        !["same_close", "next_close"].includes(assumptions.executionTiming) ||
        !Number.isFinite(assumptions.initialNav) || assumptions.initialNav <= 0 ||
        !Number.isFinite(assumptions.initialCash) || assumptions.initialCash < 0 ||
        !Number.isFinite(assumptions.transactionCostBps) || assumptions.transactionCostBps < 0 ||
        !Number.isFinite(assumptions.slippageBps) || assumptions.slippageBps < 0 ||
        !Number.isFinite(assumptions.dailyCashYield) || assumptions.dailyCashYield <= -1 ||
        !isRecord(assumptions.initialHoldings) ||
        Object.keys(assumptions.initialHoldings).some((ticker) => !ticker.trim()) ||
        Object.values(assumptions.initialHoldings).some((weight) =>
          typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) ||
        (assumptions.benchmarkTicker !== undefined &&
          (typeof assumptions.benchmarkTicker !== "string" || !assumptions.benchmarkTicker.trim())))
      return "B3 assumptions contain an unsupported calendar/execution setting or invalid initial state/cost values.";
  }
  if (input.regimeSource !== "frozen_b1_prefix") return "Unsupported C2 regime source.";
  for (const [key, value] of Object.entries({
    rollingWindow: input.rollingWindow, rollingStep: input.rollingStep,
    contributionWindow: input.contributionWindow, contributionStep: input.contributionStep,
    minRollingPaired: input.minRollingPaired, minRegimePaired: input.minRegimePaired,
    minSharpeObservations: input.minSharpeObservations,
  })) {
    if (!Number.isSafeInteger(value) || value < (key.endsWith("Step") ? 1 : 2))
      return `${key} must be a positive integer within its valid range.`;
  }
  if (!Number.isFinite(input.highCorrelationThreshold) || input.highCorrelationThreshold < -1 ||
      input.highCorrelationThreshold > 1 || !Number.isFinite(input.materialCorrelationGap) ||
      input.materialCorrelationGap < 0 || input.materialCorrelationGap > 2)
    return "C2 correlation thresholds are outside their supported ranges.";
  if (Object.entries(input.regimeMapping).some(([key, value]) => !key.trim() || !value.trim()))
    return "regimeMapping keys and values must be non-empty strings.";
  return null;
}

async function c1SourceHashCheck(
  row: typeof c1ExperimentsTable.$inferSelect,
  allocationFp: string,
  validationFp: string,
  policySnapshot: PreparedSnapshot,
  validationSnapshot: PreparedSnapshot,
  allocationRequest: AllocationRequest,
): Promise<{ source: FrozenC1; identities: Record<string, unknown>; hashes: Record<string, unknown> } | string> {
  if (!isRecord(row.manifestJson) || !Array.isArray(row.childResultsJson))
    return "Referenced C1 experiment has an invalid frozen manifest or children.";
  const manifest = row.manifestJson as Record<string, any>;
  const children = row.childResultsJson as C1Child[];
  const manifestHash = fingerprint(manifest);
  const expectedInputHash = fingerprint({
    manifestHash,
    allocationFingerprint: manifest.allocationFingerprint,
    validationPreparedFingerprint: manifest.validationPreparedFingerprint,
    policySnapshotHash: fingerprint(policySnapshot),
    validationDatasetHash: manifest.validationDatasetHash,
  });
  if (!["completed", "partial", "failed"].includes(row.status) ||
      row.manifestHash !== manifestHash || row.inputHash !== expectedInputHash ||
      manifest.allocationId !== row.allocationId || manifest.validationPreparedInputId !== row.validationPreparedInputId ||
      manifest.allocationFingerprint !== allocationFp || manifest.validationPreparedFingerprint !== validationFp ||
      manifest.validationDatasetHash !== validationSnapshot.dataset.sha256)
    return "Referenced C1 experiment is incomplete or its frozen identity/hash does not match the selected B1/B2 sources.";
  if (row.allocationId !== manifest.allocationId ||
      manifest.allocationPreparedInputId !== allocationRequest.preparedInputId ||
      !Array.isArray(manifest.candidateIds) ||
      canonicalJson(manifest.candidateIds) !== canonicalJson(allocationRequest.candidateIds))
    return "Referenced C1 experiment does not identify the selected full baseline policy.";
  const expectedDefinitionsHash = fingerprint((manifest.candidateIds as string[]).map((id) => {
    const candidate = policySnapshot.candidates.find((item) => item.candidateId === id);
    return candidate ? { policyCandidateId: id, definition: candidateDefinition(candidate) } : null;
  }));
  if (manifest.candidateDefinitionsHash !== expectedDefinitionsHash ||
      manifest.developmentPeriod?.startDate !== manifest.assumptions?.evaluationStartDate ||
      manifest.developmentPeriod?.endDate !== manifest.assumptions?.evaluationEndDate)
    return "Referenced C1 candidate-definition hash or dated B3 assumption manifest is inconsistent.";
  const baselineChildren = children.filter((child) => Array.isArray(child?.excludedCandidateIds) &&
    child.excludedCandidateIds.length === 0);
  if (baselineChildren.length !== 1)
    return "Referenced C1 experiment must contain exactly one original full-policy baseline child.";
  const baseline = baselineChildren[0];
  if (!isRecord(baseline.policyRequest) ||
      fingerprint(baseline.policyRequest) !== fingerprint(allocationRequest))
    return "Referenced C1 full child is not the unchanged original B2 baseline policy.";
  if (children.some((child) => !child || !Array.isArray(child.excludedCandidateIds) ||
      !isRecord(child.policyRequest) || !isRecord(child.result) ||
      !["completed", "failed"].includes(child.result.status as string)))
    return "Referenced C1 contains a child with an invalid frozen policy, exclusion, or result status.";
  const runIds = children.flatMap((child) =>
    typeof child.validationRunId === "number" ? [child.validationRunId] : []);
  if (new Set(runIds).size !== runIds.length)
    return "Referenced C1 experiment contains duplicate immutable B3 Validation Run references.";
  const listedRunIds = Array.isArray(row.childValidationRunIds) ? row.childValidationRunIds : [];
  if (canonicalJson(runIds) !== canonicalJson(listedRunIds))
    return "Referenced C1 child B3 Validation Run references differ from the C1 row's immutable run list.";
  const runRows = await db.select().from(validationRunsTable).where(inArray(validationRunsTable.id, runIds));
  const runsById = new Map(runRows.map((run) => [run.id, run]));
  const b3RunIdentities = [];
  const successfulValidationRunIds: number[] = [];
  for (const child of children) {
    const childResult = child.result as Record<string, any>;
    if (child.validationRunId === null) {
      if (childResult.status !== "failed" ||
          !(typeof childResult.diagnostic === "string" || typeof childResult.reason === "string"))
        return "Referenced C1 child without a B3 run does not preserve an explicit frozen failure diagnostic.";
      continue;
    }
    const run = runsById.get(child.validationRunId);
    const validRunState = run &&
      ((run.reconciliationStatus === "pass" && run.reproducibilityStatus === "pass" &&
        childResult.status === "completed") ||
       (run.reconciliationStatus === "fail" && run.reproducibilityStatus === "fail" &&
        ["completed", "failed"].includes(childResult.status)));
    if (!run || run.allocationId !== row.allocationId ||
        run.validationPreparedInputId !== row.validationPreparedInputId ||
        run.datasetHash !== validationSnapshot.dataset.sha256 ||
        run.validationInputHash !== child.validationInputHash ||
        !validRunState || !isRecord(run.resultJson) ||
        fingerprint(run.resultJson.result) !== fingerprint(child.result) ||
        fingerprint(run.resultJson.policyRequest) !== fingerprint(child.policyRequest) ||
        fingerprint(run.assumptions) !== fingerprint(manifest.assumptions))
      return `Referenced B3 Validation Run ${child.validationRunId} is missing or differs from its frozen C1 child.`;
    if (run.reconciliationStatus === "pass" && run.reproducibilityStatus === "pass")
      successfulValidationRunIds.push(run.id);
    b3RunIdentities.push({
      id: run.id,
      allocationId: run.allocationId,
      validationPreparedInputId: run.validationPreparedInputId,
      datasetHash: run.datasetHash,
      engineVersion: run.engineVersion,
      reconciliationStatus: run.reconciliationStatus,
      reproducibilityStatus: run.reproducibilityStatus,
      validationInputHash: run.validationInputHash,
      resultHash: fingerprint(run.resultJson),
    });
  }
  if (row.status === "completed" && successfulValidationRunIds.length !== children.length)
    return "Completed C1 experiment contains an unsuccessful B3 child.";
  if (row.status === "partial" &&
      (!successfulValidationRunIds.length || successfulValidationRunIds.length === children.length))
    return "Partial C1 experiment does not contain a genuine mix of successful and failed B3 children.";
  if (row.status === "failed" && successfulValidationRunIds.length > 0 &&
      children.length === successfulValidationRunIds.length)
    return "Failed C1 experiment has no persisted failed child explaining its status.";

  const policyDates = new Set(parseCsv(policySnapshot.dataset.csvContent).map((item) => item.date));
  const validationDates = new Set(parseCsv(validationSnapshot.dataset.csvContent).map((item) => item.date));
  for (const alphaId of manifest.candidateIds as string[]) {
    const policyCandidate = policySnapshot.candidates.find((item) => item.candidateId === alphaId);
    const matchingValidation = validationSnapshot.candidates.filter((item) =>
      item.candidateId === item.canonicalFingerprint && !item.diagnostics.duplicateOf &&
      policyCandidate && compatibleCandidateDefinitions(policyCandidate, item));
    if (!policyCandidate || policyCandidate.canonicalFingerprint !== alphaId ||
        policyCandidate.diagnostics.duplicateOf || matchingValidation.length !== 1 ||
        manifest.validationCandidateIds?.[alphaId] !== matchingValidation[0]?.candidateId)
      return `C1 baseline alpha ${alphaId} no longer maps to exactly one compatible canonical B1 validation candidate.`;
    const policyReturnError = validateCandidateReturns(policyCandidate, policySnapshot.dataset.sha256, policyDates);
    const validationReturnError = validateCandidateReturns(matchingValidation[0], validationSnapshot.dataset.sha256, validationDates);
    if (policyReturnError || validationReturnError)
      return policyReturnError ?? validationReturnError!;
  }
  const baselineResult = baseline.result as Record<string, any>;
  if (baselineResult.status === "completed" &&
      (!isRecord(baselineResult.policyIdentity) ||
       canonicalJson(baselineResult.policyIdentity.candidateIds) !== canonicalJson(allocationRequest.candidateIds)))
    return "Referenced C1 full child is not the unchanged original B2 baseline policy.";
  const childrenForHash = children.map((child) => ({
    validationRunId: child.validationRunId,
    validationInputHash: child.validationInputHash ?? null,
    resultHash: fingerprint(child.result),
  }));
  return {
    source: {
      status: row.status,
      manifest: structuredClone(manifest), children: structuredClone(children), summary: row.summaryJson,
      successfulValidationRunIds,
    },
    identities: {
      id: row.id,
      allocationId: row.allocationId,
      validationPreparedInputId: row.validationPreparedInputId,
      status: row.status,
      manifestHash: row.manifestHash,
      inputHash: row.inputHash,
      childValidationRunIds: row.childValidationRunIds,
    },
    hashes: {
      manifestHash,
      inputHash: expectedInputHash,
      b3Children: childrenForHash,
      b3ValidationRuns: b3RunIdentities,
      summaryHash: fingerprint(row.summaryJson),
    },
  };
}

async function replayC1ChildRuns(children: C1Child[]): Promise<string[]> {
  const differences: string[] = [];
  for (const child of children) {
    if (child.validationRunId === null) {
      const result = child.result as Record<string, unknown>;
      if (result?.status !== "failed" ||
          !(typeof result.diagnostic === "string" || typeof result.reason === "string"))
        differences.push("C1 child without a B3 Validation Run does not preserve an explicit frozen failure diagnostic.");
      continue;
    }
    const replay = await replayB3ValidationRun(child.validationRunId);
    if (!replay) {
      differences.push(`B3 Validation Run ${child.validationRunId} could not be replayed.`);
      continue;
    }
    if (replay.status !== "pass")
      differences.push(`B3 Validation Run ${child.validationRunId} replay failed: ${replay.differences.join("; ")}`);
    if (replay.validationInputHash !== child.validationInputHash)
      differences.push(`B3 Validation Run ${child.validationRunId} input hash differs from the frozen C1 child.`);
  }
  return differences;
}

async function loadSources(input: C2StoreInput): Promise<
  { sources: C2Sources; sourceIdentities: Record<string, unknown>; sourceHashes: Record<string, unknown> } |
  { error: string; status: number }
> {
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  if (!allocation) return { error: "Frozen B2 allocation not found.", status: 404 };
  const [validation] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!validation) return { error: "Frozen B1 validation preparation not found.", status: 404 };
  const [policy] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, allocation.preparedInputId)).limit(1);
  if (!policy) return { error: "Frozen B1 policy preparation referenced by the allocation was not found.", status: 404 };

  const allocationFp = allocationFingerprint(allocation);
  const validationSnapshot = structuredClone(validation.snapshot) as PreparedSnapshot;
  const policySnapshot = structuredClone(policy.snapshot) as PreparedSnapshot;
  const validationFp = preparedFingerprint(validationSnapshot);
  const policyFp = preparedFingerprint(policySnapshot);
  if (!allocationFp || allocationFp !== allocation.fingerprint)
    return { error: "Frozen B2 allocation fingerprint or snapshot hash mismatch.", status: 409 };
  if (!validationFp || validationFp !== validation.fingerprint || !validDataset(validationSnapshot))
    return { error: "Frozen validation B1 fingerprint or dataset content hash mismatch.", status: 409 };
  if (!policyFp || policyFp !== policy.fingerprint || !validDataset(policySnapshot))
    return { error: "Frozen policy B1 fingerprint or dataset content hash mismatch.", status: 409 };
  if (input.assumptions &&
      (input.assumptions.evaluationStartDate < validationSnapshot.dataset.startDate ||
       input.assumptions.evaluationEndDate > validationSnapshot.dataset.endDate))
    return { error: `B3 assumption period ${input.assumptions.evaluationStartDate} through ${input.assumptions.evaluationEndDate} is outside the selected frozen B1 validation dataset dates.`, status: 422 };
  if (!isRecord(allocation.frozenSnapshot) ||
      fingerprint(allocation.frozenSnapshot) !== allocation.frozenSnapshotHash ||
      fingerprint(allocation.frozenSnapshot) !== fingerprint(policySnapshot))
    return { error: "Frozen B2 policy snapshot does not exactly match its referenced frozen B1 preparation and snapshot hash.", status: 409 };
  const allocationRequest = structuredClone(allocation.frozenRequest) as AllocationRequest;
  if (allocation.representation !== "alpha_streams" || validation.representation !== "alpha_streams" ||
      policy.representation !== "alpha_streams" || allocationRequest.representation !== "alpha_streams" ||
      allocationRequest.preparedInputId !== allocation.preparedInputId)
    return { error: "C2 requires frozen B1 alpha-stream inputs and their matching B2 alpha-stream policy.", status: 409 };
  if (!Array.isArray(allocationRequest.candidateIds) || new Set(allocationRequest.candidateIds).size !== allocationRequest.candidateIds.length)
    return { error: "Frozen B2 policy has invalid or duplicate canonical candidate identities.", status: 409 };

  const policyById = new Map(policySnapshot.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const policyDates = new Set(parseCsv(policySnapshot.dataset.csvContent).map((row) => row.date));
  const validationDates = new Set(parseCsv(validationSnapshot.dataset.csvContent).map((row) => row.date));
  const validationCandidateIds: Record<string, string> = {};
  for (const alphaId of input.alphaIds) {
    const policyCandidate = policyById.get(alphaId);
    const validationCandidates = validationSnapshot.candidates.filter((candidate) =>
      candidate.candidateId === candidate.canonicalFingerprint && !candidate.diagnostics.duplicateOf &&
      policyCandidate && compatibleCandidateDefinitions(policyCandidate, candidate));
    if (!allocationRequest.candidateIds.includes(alphaId) || !policyCandidate ||
        policyCandidate.canonicalFingerprint !== alphaId || policyCandidate.diagnostics.duplicateOf ||
        validationCandidates.length !== 1)
      return {
        error: `Selected alpha ${alphaId} failed frozen B1/B2 candidate identity checks (baselineMember=${allocationRequest.candidateIds.includes(alphaId)}, policyCanonical=${Boolean(policyCandidate && policyCandidate.canonicalFingerprint === alphaId && !policyCandidate.diagnostics.duplicateOf)}, compatibleValidationCandidates=${validationCandidates.length}).`,
        status: 409,
      };
    const policyReturnError = validateCandidateReturns(policyCandidate, policySnapshot.dataset.sha256, policyDates);
    if (policyReturnError) return { error: policyReturnError, status: 409 };
    const validationCandidate = validationCandidates[0];
    validationCandidateIds[alphaId] = validationCandidate.candidateId;
    const validationReturnError = validateCandidateReturns(validationCandidate, validationSnapshot.dataset.sha256, validationDates);
    if (validationReturnError) return { error: validationReturnError, status: 409 };
  }

  const sources: C2Sources = {
    validation: validationSnapshot,
    policy: policySnapshot,
    allocationRequest,
    validationCandidateIds,
  };
  return {
    sources,
    sourceIdentities: {
      b1Validation: { id: validation.id, fingerprint: validation.fingerprint, representation: validation.representation },
      b1Policy: { id: policy.id, fingerprint: policy.fingerprint, representation: policy.representation },
      b2Allocation: {
        id: allocation.id, fingerprint: allocation.fingerprint, preparedInputId: allocation.preparedInputId,
        representation: allocation.representation, engineVersion: allocation.engineVersion,
      },
      c1: null,
    },
    sourceHashes: {
      b1Validation: {
        preparedFingerprint: validationFp, datasetHash: validationSnapshot.dataset.sha256,
        snapshotHash: fingerprint(validationSnapshot), engineVersion: validationSnapshot.engineVersion,
      },
      b1Policy: {
        preparedFingerprint: policyFp, datasetHash: policySnapshot.dataset.sha256,
        snapshotHash: fingerprint(policySnapshot), engineVersion: policySnapshot.engineVersion,
      },
      b2Allocation: {
        allocationFingerprint: allocationFp, frozenSnapshotHash: allocation.frozenSnapshotHash,
        policyRequestHash: fingerprint(allocationRequest), frozenResultHash: fingerprint(allocation.frozenResult),
      },
      c1: null,
    },
  };
}

function childSucceeded(source: FrozenC1, child: C1Child | undefined): child is C1Child {
  return source.status !== "failed" && Boolean(child) &&
    child!.validationRunId !== null &&
    source.successfulValidationRunIds.includes(child!.validationRunId);
}

function childForExclusion(source: FrozenC1, alphaId: string): C1Child | undefined {
  const baseline = source.children.find((child) => child.excludedCandidateIds.length === 0);
  if (!childSucceeded(source, baseline)) return undefined;
  return source.children.find((child) =>
    Array.isArray(child?.excludedCandidateIds) &&
    canonicalJson(child.excludedCandidateIds) === canonicalJson([alphaId]) &&
    (child.result as Record<string, unknown> | undefined)?.status === "completed" &&
    childSucceeded(source, child));
}

function manifestTemplateMatches(
  manifest: Record<string, any>,
  input: C2Input,
  allocationFp: string,
  validationFp: string,
  policySnapshot: PreparedSnapshot,
  validationSnapshot: PreparedSnapshot,
  allocationRequest: AllocationRequest,
): boolean {
  const expectedDefinitionsHash = fingerprint(allocationRequest.candidateIds.map((id) => {
    const candidate = policySnapshot.candidates.find((item) => item.candidateId === id);
    return candidate ? { policyCandidateId: id, definition: candidateDefinition(candidate) } : null;
  }));
  return manifest.allocationId === input.allocationId &&
    manifest.allocationFingerprint === allocationFp &&
    manifest.allocationPreparedInputId === allocationRequest.preparedInputId &&
    manifest.validationPreparedInputId === input.validationPreparedInputId &&
    manifest.validationPreparedFingerprint === validationFp &&
    manifest.validationDatasetHash === validationSnapshot.dataset.sha256 &&
    canonicalJson(manifest.candidateIds) === canonicalJson(allocationRequest.candidateIds) &&
    manifest.candidateDefinitionsHash === expectedDefinitionsHash &&
    isRecord(manifest.assumptions) &&
    manifest.assumptions.evaluationStartDate === input.startDate &&
    manifest.assumptions.evaluationEndDate === input.endDate &&
    manifest.developmentPeriod?.startDate === input.startDate &&
    manifest.developmentPeriod?.endDate === input.endDate;
}

function exactDependencySpec(
  alphaId: string,
  input: C2Input,
  assumptions: B3Assumptions,
  holdoutStartDate: string | null,
  allocationFp: string,
  validationFp: string,
  policySnapshot: PreparedSnapshot,
  validationSnapshot: PreparedSnapshot,
  allocation: typeof allocationsTable.$inferSelect,
  allocationRequest: AllocationRequest,
): Record<string, unknown> {
  const plans = planC1Policies(policySnapshot, allocationRequest, assumptions, {
    mode: "single",
    exclusionSets: [[alphaId]],
    ...(holdoutStartDate ? { holdoutStartDate } : {}),
  }) as Array<{ excludedCandidateIds: string[]; policyRequest: AllocationRequest }>;
  const exclusion = plans.find((plan) =>
    canonicalJson(plan.excludedCandidateIds) === canonicalJson([alphaId]));
  const baseline = plans.find((plan) => plan.excludedCandidateIds.length === 0);
  return {
    allocationFingerprint: allocationFp,
    validationPreparedFingerprint: validationFp,
    validationDatasetHash: validationSnapshot.dataset.sha256,
    candidateIds: [...allocationRequest.candidateIds],
    candidateDefinitionsHash: fingerprint(allocationRequest.candidateIds.map((id) => {
      const candidate = policySnapshot.candidates.find((item) => item.candidateId === id);
      return candidate ? { policyCandidateId: id, definition: candidateDefinition(candidate) } : null;
    })),
    developmentPeriod: { startDate: input.startDate, endDate: input.endDate },
    holdoutStartDate,
    assumptions,
    mode: "single",
    exclusionSet: [alphaId],
    baselinePolicyRequest: baseline?.policyRequest ?? null,
    exclusionPolicyRequest: exclusion?.policyRequest ?? null,
    policyEngineVersions: {
      b1Policy: policySnapshot.engineVersion,
      a1Policy: policySnapshot.a1EngineVersion ?? null,
      b1Validation: validationSnapshot.engineVersion,
      a1Validation: validationSnapshot.a1EngineVersion ?? null,
      b2: allocation.engineVersion,
    },
    b3EngineVersion: `b3-validation-api.1; ${validationSnapshot.engineVersion}`,
  };
}

async function planDependencies(input: C2StoreInput, loaded: Awaited<ReturnType<typeof loadSources>>) {
  if ("error" in loaded) return loaded;
  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  const [validation] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!allocation || !validation) return { error: "Frozen C2 sources disappeared during dependency planning.", status: 404 };
  const policySnapshot = loaded.sources.policy;
  const validationSnapshot = loaded.sources.validation;
  const allocationRequest = loaded.sources.allocationRequest;
  const allocationFp = allocationFingerprint(allocation);
  const validationFp = preparedFingerprint(validationSnapshot);
  const c1Rows = await db.select().from(c1ExperimentsTable)
    .where(eq(c1ExperimentsTable.allocationId, input.allocationId))
    .orderBy(desc(c1ExperimentsTable.id));
  const checkedRows: Array<{
    row: typeof c1ExperimentsTable.$inferSelect;
    source: FrozenC1;
    hashes: Record<string, unknown>;
  }> = [];
  for (const row of c1Rows) {
    if (row.validationPreparedInputId !== input.validationPreparedInputId) continue;
    const checked = await c1SourceHashCheck(
      row, allocationFp, validationFp, policySnapshot, validationSnapshot, allocationRequest,
    );
    if (typeof checked !== "string")
      checkedRows.push({ row, source: checked.source, hashes: checked.hashes });
  }

  let hintedRow: typeof c1ExperimentsTable.$inferSelect | undefined;
  if (input.c1ExperimentId !== null) {
    hintedRow = c1Rows.find((row) => row.id === input.c1ExperimentId);
    if (!hintedRow) {
      const [hint] = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.id, input.c1ExperimentId)).limit(1);
      if (!hint) return { error: "Referenced C1 template was not found.", status: 404 };
      if (hint.allocationId !== input.allocationId ||
          hint.validationPreparedInputId !== input.validationPreparedInputId)
        return { error: "Referenced C1 template does not use the requested original B2 allocation and B1 evaluation preparation.", status: 409 };
      hintedRow = hint;
    }
  }
  const hintedEntry = hintedRow
    ? checkedRows.find((item) => item.row.id === hintedRow!.id)
    : undefined;
  const hintedSource = hintedEntry?.source;

  let targetAssumptions: B3Assumptions | undefined = input.assumptions
    ? structuredClone(input.assumptions)
    : undefined;
  let targetHoldoutStartDate: string | null = null;
  let templateRow: typeof c1ExperimentsTable.$inferSelect | undefined;
  let assumptionsUnavailableReason: string | null = null;

  if (input.assumptions) {
    if (hintedSource &&
        fingerprint(hintedSource.manifest.assumptions) === fingerprint(input.assumptions) &&
        manifestTemplateMatches(hintedSource.manifest, input, allocationFp, validationFp,
          policySnapshot, validationSnapshot, allocationRequest)) {
      targetHoldoutStartDate = hintedSource.manifest.holdoutStartDate ?? null;
      templateRow = hintedRow;
    }
  } else if (input.c1ExperimentId !== null) {
    if (!hintedSource) {
      assumptionsUnavailableReason = "The explicitly selected C1 assumption template failed frozen C1/B3 integrity checks.";
    } else if (!manifestTemplateMatches(hintedSource.manifest, input, allocationFp, validationFp,
      policySnapshot, validationSnapshot, allocationRequest)) {
      assumptionsUnavailableReason = `The explicitly selected C1 template does not freeze B3 assumptions for ${input.startDate} through ${input.endDate}.`;
    } else {
      targetAssumptions = structuredClone(hintedSource.manifest.assumptions) as B3Assumptions;
      targetHoldoutStartDate = hintedSource.manifest.holdoutStartDate ?? null;
      templateRow = hintedRow;
    }
  } else {
    const matchingRows = checkedRows.filter(({ source }) =>
      source.status !== "failed" &&
      manifestTemplateMatches(source.manifest, input, allocationFp, validationFp,
        policySnapshot, validationSnapshot, allocationRequest));
    const distinctTargets = new Map(matchingRows.map(({ source }) => {
      const assumptions = structuredClone(source.manifest.assumptions) as B3Assumptions;
      const holdoutStartDate = source.manifest.holdoutStartDate ?? null;
      return [fingerprint({ assumptions, holdoutStartDate }), { assumptions, holdoutStartDate }] as const;
    }));
    if (distinctTargets.size === 1) {
      const [{ assumptions, holdoutStartDate }] = [...distinctTargets.values()];
      targetAssumptions = assumptions;
      targetHoldoutStartDate = holdoutStartDate;
      templateRow = matchingRows[0]?.row;
    } else if (distinctTargets.size > 1) {
      assumptionsUnavailableReason = "Multiple frozen B3 assumption templates match this C2 period but differ in economically relevant settings; supply explicit assumptions or select a C1 template.";
    } else {
      assumptionsUnavailableReason = `No explicit or unambiguous frozen B3 assumption template matches ${input.startDate} through ${input.endDate}; supply B3 assumptions or select a C1 template.`;
    }
  }

  if (targetAssumptions) {
    const assumptionsError = validateNormalizedInput({ ...input, assumptions: targetAssumptions });
    if (assumptionsError) {
      targetAssumptions = undefined;
      assumptionsUnavailableReason = `Frozen B3 assumption template is invalid for this C2 request: ${assumptionsError}`;
      templateRow = undefined;
    } else if (targetAssumptions.evaluationStartDate < validationSnapshot.dataset.startDate ||
        targetAssumptions.evaluationEndDate > validationSnapshot.dataset.endDate) {
      targetAssumptions = undefined;
      assumptionsUnavailableReason = `B3 assumption period ${input.startDate} through ${input.endDate} is outside the selected frozen B1 validation dataset dates.`;
      templateRow = undefined;
    }
  }

  const dependencies: DependencyPlanItem[] = [];
  for (const alphaId of input.alphaIds) {
    let planningFailure = assumptionsUnavailableReason;
    let spec: Record<string, unknown>;
    try {
      if (!targetAssumptions) throw new Error(planningFailure ?? "No target B3 assumptions are available.");
      spec = exactDependencySpec(alphaId, input, targetAssumptions, targetHoldoutStartDate,
        allocationFp, validationFp, policySnapshot, validationSnapshot, allocation, allocationRequest);
    } catch (error) {
      planningFailure ??= `C1 policy planning failed: ${error instanceof Error ? error.message : String(error)}`;
      spec = {
        alphaId, allocationFingerprint: allocationFp, validationPreparedFingerprint: validationFp,
        startDate: input.startDate, endDate: input.endDate,
        assumptions: targetAssumptions ?? null, planningFailure,
      };
    }
    const desiredFingerprint = fingerprint(spec);
    let match: { row: typeof c1ExperimentsTable.$inferSelect; source: FrozenC1 } | undefined;
    let failedMatch: {
      row: typeof c1ExperimentsTable.$inferSelect;
      child: C1Child;
      hashes: Record<string, unknown>;
    } | undefined;
    for (const { row, source, hashes } of checkedRows) {
      const manifest = source.manifest;
      const child = childForExclusion(source, alphaId);
      const frozenChild = source.children.find((item) =>
        canonicalJson(item.excludedCandidateIds) === canonicalJson([alphaId]));
      const baselineChild = source.children.find((item) => item.excludedCandidateIds.length === 0);
      if (!frozenChild || !targetAssumptions || planningFailure ||
          canonicalJson(manifest.candidateIds) !== canonicalJson(allocationRequest.candidateIds) ||
          manifest.candidateDefinitionsHash !== (spec as any).candidateDefinitionsHash ||
          canonicalJson(manifest.developmentPeriod) !== canonicalJson((spec as any).developmentPeriod) ||
          canonicalJson(manifest.assumptions) !== canonicalJson(targetAssumptions) ||
          (manifest.holdoutStartDate ?? null) !== targetHoldoutStartDate ||
          manifest.mode !== "single" ||
          fingerprint(frozenChild.policyRequest) !== fingerprint((spec as any).exclusionPolicyRequest) ||
          !baselineChild || !childSucceeded(source, baselineChild) ||
          fingerprint(baselineChild.policyRequest) !== fingerprint((spec as any).baselinePolicyRequest) ||
          canonicalJson((baselineChild.result as any)?.policyIdentity?.candidateIds) !==
            canonicalJson((spec as any).baselinePolicyRequest?.candidateIds) ||
          fingerprint((baselineChild.result as any)?.assumptions) !== fingerprint(targetAssumptions))
        continue;
      if ((frozenChild.result as any)?.status === "completed" &&
          (canonicalJson((frozenChild.result as any)?.policyIdentity?.candidateIds) !==
             canonicalJson((spec as any).exclusionPolicyRequest?.candidateIds) ||
           fingerprint((frozenChild.result as any)?.assumptions) !== fingerprint(targetAssumptions)))
        continue;
      if (child && (canonicalJson((child.result as any)?.policyIdentity?.candidateIds) !==
          canonicalJson((spec as any).exclusionPolicyRequest?.candidateIds) ||
          fingerprint((child.result as any)?.assumptions) !== fingerprint(targetAssumptions)))
        continue;
      const expectedB3EngineVersion = (spec as any).b3EngineVersion;
      const requiredRunIds = [frozenChild.validationRunId, baselineChild.validationRunId]
        .filter((id): id is number => typeof id === "number");
      const requiredRuns = requiredRunIds.length
        ? await db.select().from(validationRunsTable).where(inArray(validationRunsTable.id, requiredRunIds))
        : [];
      if (requiredRuns.length !== requiredRunIds.length ||
          requiredRuns.some((run) => run.engineVersion !== expectedB3EngineVersion)) continue;
      if (child) {
        match = { row, source };
        break;
      }
      failedMatch = { row, child: frozenChild, hashes };
      break;
    }
    if (match) {
      dependencies.push({
        alphaId, status: "REUSE", c1ExperimentId: match.row.id,
        fingerprint: desiredFingerprint, reason: null,
        childPolicyCount: match.row.actualPolicyCount, spec,
      });
    } else if (failedMatch) {
      const result = failedMatch.child.result as Record<string, any>;
      const exactDate = typeof result.failureDate === "string" ? result.failureDate : input.startDate;
      const failedRun = failedMatch.child.validationRunId === null
        ? undefined
        : (failedMatch.hashes.b3ValidationRuns as Array<Record<string, any>>).find(
          (run) => run.id === failedMatch!.child.validationRunId,
        );
      const diagnostic = result.reason ?? result.diagnostic ??
        (failedRun
          ? `B3 Validation Run saved reconciliationStatus=${failedRun.reconciliationStatus}, reproducibilityStatus=${failedRun.reproducibilityStatus}.`
          : null) ??
        `The frozen child is not successful (status=${String(result.status)}).`;
      dependencies.push({
        alphaId, status: "UNAVAILABLE", c1ExperimentId: failedMatch.row.id,
        fingerprint: desiredFingerprint,
        reason: `${exactDate}: ${diagnostic} (C1 experiment #${failedMatch.row.id}, B3 Validation Run ${failedMatch.child.validationRunId === null ? "not persisted" : `#${failedMatch.child.validationRunId}`}.)`,
        childPolicyCount: failedMatch.row.actualPolicyCount, spec,
      });
    } else if (targetAssumptions && !planningFailure) {
      dependencies.push({
        alphaId, status: "WILL_CREATE", c1ExperimentId: null,
        fingerprint: desiredFingerprint, reason: null, childPolicyCount: 2, spec,
      });
    } else {
      dependencies.push({
        alphaId, status: "UNAVAILABLE", c1ExperimentId: null,
        fingerprint: desiredFingerprint,
        reason: `${input.startDate} through ${input.endDate}: ${planningFailure ?? "No exact B3 assumption template is available."}`,
        childPolicyCount: 0, spec,
      });
    }
  }
  return {
    dependencies, template: templateRow, assumptions: targetAssumptions,
    holdoutStartDate: targetHoldoutStartDate, sources: loaded.sources,
  } as const;
}

function publicDependencyPlan(plan: Exclude<Awaited<ReturnType<typeof planDependencies>>, { error: string }>) {
  const dependencies = plan.dependencies.map(({ spec: _spec, ...item }) => item);
  const reusedCount = dependencies.filter((item) => item.status === "REUSE").length;
  const toCreateCount = dependencies.filter((item) => item.status === "WILL_CREATE").length;
  const unavailableCount = dependencies.filter((item) => item.status === "UNAVAILABLE").length;
  const newPolicyCount = toCreateCount ? toCreateCount + 1 : 0;
  const reusedC1Ids = new Set(dependencies.flatMap((item) =>
    item.status === "REUSE" && item.c1ExperimentId !== null ? [item.c1ExperimentId] : []));
  const reusedChildPolicies = [...reusedC1Ids].reduce((sum, id) =>
    sum + (plan.dependencies.find((item) => item.c1ExperimentId === id)?.childPolicyCount ?? 0), 0);
  const estimatedTotalChildPolicies = reusedChildPolicies + (toCreateCount ? toCreateCount + 1 : 0);
  return { dependencies, reusedCount, toCreateCount, unavailableCount, newPolicyCount, estimatedTotalChildPolicies };
}

export async function planC2Dependencies(raw: ApiC2ExperimentInput) {
  const input = normalizeInput(raw);
  const inputError = validateNormalizedInput(input);
  if (inputError) return { error: inputError, status: 400 } as const;
  const loaded = await loadSources(input);
  if ("error" in loaded) return loaded;
  const plan = await planDependencies(input, loaded);
  if ("error" in plan) return plan;
  return { plan: publicDependencyPlan(plan) } as const;
}

async function resolveDependencies(input: C2Input, planned: Exclude<
  Awaited<ReturnType<typeof planDependencies>>, { error: string }
>) {
  const dependencyByAlpha: Record<string, { id: number; manifest: any; children: any[]; summary: any }> = {};
  const dependencyIdentities: Record<string, unknown> = {};
  const dependencyHashes: Record<string, unknown> = {};
  const frozenPlan: Array<{
    alphaId: string;
    status: "REUSED" | "CREATED" | "UNAVAILABLE";
    c1ExperimentId: number | null;
    fingerprint: string;
    reason: string | null;
    childPolicyCount: number;
  }> = [];
  const missing = planned.dependencies.filter((item) => item.status === "WILL_CREATE");
  let createdC1Id: number | null = null;
  let createFailure: string | null = null;
  if (missing.length && planned.assumptions) {
    const beforeRows = await db.select({ id: c1ExperimentsTable.id }).from(c1ExperimentsTable)
      .where(eq(c1ExperimentsTable.allocationId, input.allocationId));
    const beforeIds = new Set(beforeRows.map((row) => row.id));
    const assumptions = structuredClone(planned.assumptions);
    try {
      const saved = await persistC1Experiment({
        allocationId: input.allocationId,
        validationPreparedInputId: input.validationPreparedInputId,
        assumptions,
        ...(planned.holdoutStartDate ? { holdoutStartDate: planned.holdoutStartDate } : {}),
        mode: "single",
        exclusionSets: missing.map((item) => [item.alphaId]),
      });
      if ("experiment" in saved && saved.experiment) createdC1Id = saved.experiment.id;
      else createFailure = `${input.startDate} through ${input.endDate}: C1 dependency creation failed: ${saved.error}`;
    } catch (error) {
      createFailure = `${input.startDate} through ${input.endDate}: C1 dependency creation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (createdC1Id === null) {
      const afterRows = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.allocationId, input.allocationId))
        .orderBy(desc(c1ExperimentsTable.id));
      const persisted = afterRows.find((row) => {
        if (beforeIds.has(row.id) || row.validationPreparedInputId !== input.validationPreparedInputId ||
            !isRecord(row.manifestJson)) return false;
        const manifest = row.manifestJson;
        return manifest.mode === "single" &&
          canonicalJson(manifest.exclusionSets) === canonicalJson(missing.map((item) => [item.alphaId])) &&
          canonicalJson(manifest.assumptions) === canonicalJson(assumptions) &&
          (manifest.holdoutStartDate ?? null) === planned.holdoutStartDate &&
          canonicalJson(manifest.developmentPeriod) === canonicalJson({
            startDate: input.startDate, endDate: input.endDate,
          });
      });
      if (persisted) createdC1Id = persisted.id;
    }
  }

  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  const [validation] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!allocation || !validation) {
    createFailure ??= `${input.startDate} through ${input.endDate}: frozen B1/B2 sources disappeared during C1 resolution.`;
  } else {
    const allocationFp = allocationFingerprint(allocation);
    const validationFp = preparedFingerprint(validation.snapshot);
    const policySnapshot = planned.sources.policy;
    const validationSnapshot = planned.sources.validation;
    for (const dependency of planned.dependencies) {
      let row: typeof c1ExperimentsTable.$inferSelect | undefined;
      let status: "REUSED" | "CREATED" | "UNAVAILABLE" = "UNAVAILABLE";
      let reason = dependency.reason;
      if (dependency.status === "REUSE" && dependency.c1ExperimentId !== null) {
        [row] = await db.select().from(c1ExperimentsTable)
          .where(eq(c1ExperimentsTable.id, dependency.c1ExperimentId)).limit(1);
        status = "REUSED";
      } else if (dependency.status === "WILL_CREATE" && createdC1Id !== null) {
        [row] = await db.select().from(c1ExperimentsTable)
          .where(eq(c1ExperimentsTable.id, createdC1Id)).limit(1);
        status = "CREATED";
      } else if (dependency.status === "UNAVAILABLE" && dependency.c1ExperimentId !== null) {
        [row] = await db.select().from(c1ExperimentsTable)
          .where(eq(c1ExperimentsTable.id, dependency.c1ExperimentId)).limit(1);
      }
      let checked: Awaited<ReturnType<typeof c1SourceHashCheck>> | undefined;
      if (row && allocation && validation) {
        checked = await c1SourceHashCheck(
          row, allocationFp, validationFp, policySnapshot, validationSnapshot, planned.sources.allocationRequest,
        );
      }
      const selectedChild = checked && typeof checked !== "string"
        ? childForExclusion(checked.source, dependency.alphaId) : undefined;
      const persistedChildren = row && Array.isArray(row.childResultsJson)
        ? row.childResultsJson as C1Child[] : [];
      const persistedChild = persistedChildren.find((child) =>
        canonicalJson(child?.excludedCandidateIds) === canonicalJson([dependency.alphaId]));
      if (!row || !checked || typeof checked === "string" || !selectedChild) {
        status = "UNAVAILABLE";
        const result = (selectedChild ?? persistedChild)?.result as Record<string, any> | undefined;
        const exactDate = typeof result?.failureDate === "string" ? result.failureDate : input.startDate;
        const persistedRunId = persistedChild?.validationRunId ?? null;
        const failedRun = persistedRunId !== null && checked && typeof checked !== "string"
          ? (checked.hashes.b3ValidationRuns as Array<Record<string, any>>).find((run) => run.id === persistedRunId)
          : undefined;
        const diagnostic = result?.reason ?? result?.diagnostic ??
          (failedRun
            ? `B3 Validation Run saved reconciliationStatus=${failedRun.reconciliationStatus}, reproducibilityStatus=${failedRun.reproducibilityStatus}.`
            : null) ??
          (typeof checked === "string" ? checked : createFailure) ??
          "C1/B3 dependency did not produce the exact successful one-alpha exclusion child.";
        const runId = persistedRunId;
        reason = dependency.reason ??
          `${exactDate}: ${diagnostic} (C1 experiment ${row ? `#${row.id}` : "not persisted"}, B3 Validation Run ${runId === null ? "not persisted" : `#${runId}`}.)`;
      } else {
        dependencyByAlpha[dependency.alphaId] = {
          id: row.id,
          manifest: checked.source.manifest,
          children: checked.source.children,
          summary: checked.source.summary,
        };
        dependencyIdentities[dependency.alphaId] = checked.identities;
        dependencyHashes[dependency.alphaId] = checked.hashes;
      }
      if (row && status === "UNAVAILABLE") {
        dependencyIdentities[dependency.alphaId] = {
          id: row.id, allocationId: row.allocationId,
          validationPreparedInputId: row.validationPreparedInputId,
          status: row.status, manifestHash: row.manifestHash, inputHash: row.inputHash,
          childValidationRunIds: row.childValidationRunIds,
        };
        dependencyHashes[dependency.alphaId] = {
          manifestHash: fingerprint(row.manifestJson),
          childResultsHash: fingerprint(row.childResultsJson),
          summaryHash: fingerprint(row.summaryJson),
          childValidationRunIds: row.childValidationRunIds,
          childReferences: persistedChildren.map((child) => ({
            excludedCandidateIds: child.excludedCandidateIds,
            validationRunId: child.validationRunId,
            validationInputHash: child.validationInputHash ?? null,
            resultHash: fingerprint(child.result),
          })),
          failedChild: persistedChild ?? null,
        };
      }
      frozenPlan.push({
        alphaId: dependency.alphaId,
        status,
        c1ExperimentId: row?.id ?? null,
        fingerprint: dependency.fingerprint,
        reason,
        childPolicyCount: row?.actualPolicyCount ?? dependency.childPolicyCount,
      });
    }
  }
  const templateReference = planned.template ? {
    identity: {
      id: planned.template.id,
      allocationId: planned.template.allocationId,
      validationPreparedInputId: planned.template.validationPreparedInputId,
      status: planned.template.status,
      manifestHash: planned.template.manifestHash,
      inputHash: planned.template.inputHash,
      childValidationRunIds: planned.template.childValidationRunIds,
    },
    hashes: {
      manifestHash: fingerprint(planned.template.manifestJson),
      childResultsHash: fingerprint(planned.template.childResultsJson),
      summaryHash: fingerprint(planned.template.summaryJson),
    },
  } : null;
  return {
    dependencyByAlpha, dependencyPlan: frozenPlan,
    dependencyIdentities, dependencyHashes, templateReference,
  };
}

function response(row: typeof c2ExperimentsTable.$inferSelect) {
  return {
    id: row.id,
    allocationId: row.allocationId,
    validationPreparedInputId: row.validationPreparedInputId,
    c1ExperimentId: row.c1ExperimentId,
    manifestHash: row.manifestHash,
    inputHash: row.inputHash,
    resultHash: row.resultHash,
    manifest: row.manifestJson,
    result: row.resultJson,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function persistC2Experiment(raw: ApiC2ExperimentInput) {
  const input = normalizeInput(raw);
  const inputError = validateNormalizedInput(input);
  if (inputError) return { error: inputError, status: 400 } as const;
  const loaded = await loadSources(input);
  if ("error" in loaded) return loaded;
  const dependencyResolution = await planDependencies(input, loaded);
  if ("error" in dependencyResolution) return dependencyResolution;
  const resolved = await resolveDependencies(input, dependencyResolution);
  const frozenSources = {
    ...loaded.sources,
    ...(Object.keys(resolved.dependencyByAlpha).length
      ? { c1ByAlpha: resolved.dependencyByAlpha }
      : {}),
    dependencyPlan: resolved.dependencyPlan,
  } as unknown as C2Sources;
  const manifestInput: C2StoreInput = {
    ...input,
    ...(dependencyResolution.assumptions
      ? { assumptions: structuredClone(dependencyResolution.assumptions) }
      : {}),
  };
  let result: Awaited<ReturnType<typeof computeC2Diagnostics>>;
  try {
    result = await computeC2Diagnostics(manifestInput, frozenSources);
  } catch (error) {
    return {
      error: `C2 diagnostics could not be computed from the frozen sources: ${error instanceof Error ? error.message : String(error)}`,
      status: 422,
    } as const;
  }
  const manifest: C2Manifest = {
    schemaVersion: 1,
    input: manifestInput,
    engineVersion: C2_ENGINE_VERSION,
    sourceIdentities: {
      ...loaded.sourceIdentities,
      c1Dependencies: resolved.dependencyIdentities,
      c1Template: resolved.templateReference?.identity ?? null,
      regimeClassification: {
        source: result.regimes.source,
        version: result.regimes.version,
        status: result.regimes.status,
      },
    },
    sourceHashes: {
      ...loaded.sourceHashes,
      c1Dependencies: resolved.dependencyHashes,
      c1Template: resolved.templateReference?.hashes ?? null,
    },
    sources: frozenSources,
  };
  const manifestHash = fingerprint(manifest);
  const inputHash = fingerprint({ manifestHash, sourceHashes: manifest.sourceHashes, engineVersion: manifest.engineVersion });
  const resultHash = fingerprint(result);
  const [created] = await db.insert(c2ExperimentsTable).values({
    allocationId: input.allocationId,
    validationPreparedInputId: input.validationPreparedInputId,
    c1ExperimentId: input.c1ExperimentId,
    manifestHash,
    inputHash,
    resultHash,
    manifestJson: manifest,
    resultJson: result,
  }).returning();
  if (!created) return { error: "C2 immutable experiment snapshot could not be persisted.", status: 500 } as const;
  return { experiment: response(created) } as const;
}

export async function listC2Experiments() {
  const rows = await db.select().from(c2ExperimentsTable)
    .orderBy(desc(c2ExperimentsTable.createdAt), desc(c2ExperimentsTable.id));
  return rows.map(response);
}

export async function getC2Experiment(id: number) {
  const [row] = await db.select().from(c2ExperimentsTable)
    .where(eq(c2ExperimentsTable.id, id)).limit(1);
  return row ? response(row) : null;
}

function compareValues(saved: unknown, replayed: unknown) {
  const differences: string[] = [];
  let maximumNumericDifference = 0;
  const describe = (value: unknown) => JSON.stringify(value) ?? "undefined";
  const visit = (left: unknown, right: unknown, path: string) => {
    if (typeof left === "number" || typeof right === "number") {
      if (typeof left !== "number" || typeof right !== "number" ||
          !Number.isFinite(left) || !Number.isFinite(right)) {
        differences.push(`${path}: saved=${describe(left)}, replayed=${describe(right)}`);
        return;
      }
      const delta = Math.abs(left - right);
      maximumNumericDifference = Math.max(maximumNumericDifference, delta);
      if (delta > REPLAY_TOLERANCE)
        differences.push(`${path}: saved=${left}, replayed=${right}, difference=${delta}`);
      return;
    }
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length)
        differences.push(`${path}.length: saved=${left.length}, replayed=${right.length}`);
      for (let index = 0; index < Math.min(left.length, right.length); index++)
        visit(left[index], right[index], `${path}[${index}]`);
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (!(key in left) || !(key in right)) differences.push(`${path}.${key}: key presence differs`);
        else visit(left[key], right[key], `${path}.${key}`);
      }
      return;
    }
    differences.push(`${path}: saved=${describe(left)}, replayed=${describe(right)}`);
  };
  visit(saved, replayed, "result");
  return { differences, maximumNumericDifference };
}

export async function replayC2Experiment(id: number) {
  const [row] = await db.select().from(c2ExperimentsTable)
    .where(eq(c2ExperimentsTable.id, id)).limit(1);
  if (!row) return null;
  const differences: string[] = [];
  if (!isRecord(row.manifestJson) || !isRecord(row.resultJson)) {
    return {
      experimentId: id, status: "fail" as const, inputHash: row.inputHash, resultHash: row.resultHash,
      maximumNumericDifference: 0, differences: ["persisted C2 manifest or result has an invalid shape"],
    };
  }
  const manifest = row.manifestJson as unknown as C2Manifest;
  const actualManifestHash = fingerprint(manifest);
  if (actualManifestHash !== row.manifestHash)
    differences.push(`manifestHash: expected=${row.manifestHash}, observed=${actualManifestHash}`);
  const actualInputHash = fingerprint({
    manifestHash: actualManifestHash,
    sourceHashes: manifest.sourceHashes,
    engineVersion: manifest.engineVersion,
  });
  if (actualInputHash !== row.inputHash)
    differences.push(`inputHash: expected=${row.inputHash}, observed=${actualInputHash}`);
  const actualResultHash = fingerprint(row.resultJson);
  if (actualResultHash !== row.resultHash)
    differences.push(`resultHash: expected=${row.resultHash}, observed=${actualResultHash}`);

  const source = manifest.sources;
  if (!source || !source.validation || !source.policy || !source.allocationRequest ||
      !isRecord(manifest.input) || manifest.engineVersion !== C2_ENGINE_VERSION)
    differences.push("Frozen C2 source snapshots or matching engine version are unavailable.");
  if (manifest.input?.allocationId !== row.allocationId ||
      manifest.input?.validationPreparedInputId !== row.validationPreparedInputId ||
      manifest.input?.c1ExperimentId !== row.c1ExperimentId)
    differences.push("Frozen C2 input identity does not match the persisted experiment identity.");
  try {
    const inputError = validateNormalizedInput(manifest.input);
    if (inputError) differences.push(`Frozen C2 request is invalid: ${inputError}`);
  } catch {
    differences.push("Frozen C2 request does not contain a valid normalized input shape.");
  }

  const [allocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, row.allocationId)).limit(1);
  const [validation] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, row.validationPreparedInputId)).limit(1);
  const [policy] = allocation ? await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, allocation.preparedInputId)).limit(1) : [];
  const sourceIds = manifest.sourceIdentities as any;
  const sourceHashes = manifest.sourceHashes as any;
  const actualAllocationFp = allocation ? allocationFingerprint(allocation) : "";
  const actualValidationFp = validation ? preparedFingerprint(validation.snapshot) : "";
  const actualPolicyFp = policy ? preparedFingerprint(policy.snapshot) : "";
  const currentSourceIdentity = {
    b1Validation: validation ? { id: validation.id, fingerprint: validation.fingerprint, representation: validation.representation } : null,
    b1Policy: policy ? { id: policy.id, fingerprint: policy.fingerprint, representation: policy.representation } : null,
    b2Allocation: allocation ? {
      id: allocation.id, fingerprint: allocation.fingerprint, preparedInputId: allocation.preparedInputId,
      representation: allocation.representation, engineVersion: allocation.engineVersion,
    } : null,
  };
  const expectedSourceIdentity = {
    b1Validation: sourceIds?.b1Validation ?? null,
    b1Policy: sourceIds?.b1Policy ?? null,
    b2Allocation: sourceIds?.b2Allocation ?? null,
  };
  const sourceIdentityComparison = compareValues(expectedSourceIdentity, currentSourceIdentity);
  differences.push(...sourceIdentityComparison.differences.map((item) => `sourceIdentity.${item}`));
  if (actualValidationFp !== sourceHashes?.b1Validation?.preparedFingerprint ||
      actualPolicyFp !== sourceHashes?.b1Policy?.preparedFingerprint ||
      actualAllocationFp !== sourceHashes?.b2Allocation?.allocationFingerprint)
    differences.push("Referenced B1/B2 source fingerprint differs from the frozen manifest.");
  if ((validation && fingerprint(validation.snapshot) !== sourceHashes?.b1Validation?.snapshotHash) ||
      (policy && fingerprint(policy.snapshot) !== sourceHashes?.b1Policy?.snapshotHash))
    differences.push("Referenced full B1 snapshot hash differs from the frozen manifest.");
  if (validation && isRecord(validation.snapshot) && isRecord(validation.snapshot.dataset) &&
      (validation.snapshot.dataset.sha256 !== sourceHashes?.b1Validation?.datasetHash ||
       hashDataset(validation.snapshot.dataset.csvContent) !== sourceHashes?.b1Validation?.datasetHash))
    differences.push("Referenced validation dataset content/hash differs from the frozen manifest.");
  if (policy && isRecord(policy.snapshot) && isRecord(policy.snapshot.dataset) &&
      (policy.snapshot.dataset.sha256 !== sourceHashes?.b1Policy?.datasetHash ||
       hashDataset(policy.snapshot.dataset.csvContent) !== sourceHashes?.b1Policy?.datasetHash))
    differences.push("Referenced policy dataset content/hash differs from the frozen manifest.");
  if (allocation && (fingerprint(allocation.frozenSnapshot) !== allocation.frozenSnapshotHash ||
      fingerprint(allocation.frozenRequest) !== sourceHashes?.b2Allocation?.policyRequestHash ||
      fingerprint(allocation.frozenResult) !== sourceHashes?.b2Allocation?.frozenResultHash))
    differences.push("Referenced B2 allocation snapshot/request/result hash differs from the frozen manifest.");
  if (allocation && policy &&
      fingerprint(allocation.frozenSnapshot) !== fingerprint(policy.snapshot))
    differences.push("Referenced B2 frozen snapshot no longer matches its exact B1 policy preparation.");
  if (source?.validation && source?.policy && manifest.input?.alphaIds) {
    const frozenPolicy = source.policy as PreparedSnapshot;
    const frozenValidation = source.validation as PreparedSnapshot;
    const policyDates = new Set(parseCsv(frozenPolicy.dataset.csvContent).map((item) => item.date));
    const validationDates = new Set(parseCsv(frozenValidation.dataset.csvContent).map((item) => item.date));
    const validationCandidateIds = source.validationCandidateIds;
    if (!isRecord(validationCandidateIds) ||
        canonicalJson(Object.keys(validationCandidateIds).sort()) !==
          canonicalJson([...manifest.input.alphaIds].sort()))
      differences.push("Frozen policy-to-validation candidate identity map does not cover exactly the selected C2 alpha IDs.");
    for (const alphaId of manifest.input.alphaIds) {
      const policyCandidate = frozenPolicy.candidates.find((candidate) => candidate.candidateId === alphaId);
      const validationCandidates = frozenValidation.candidates.filter((candidate) =>
        candidate.candidateId === candidate.canonicalFingerprint && !candidate.diagnostics.duplicateOf &&
        policyCandidate && compatibleCandidateDefinitions(policyCandidate, candidate));
      if (!policyCandidate || policyCandidate.canonicalFingerprint !== alphaId ||
          policyCandidate.diagnostics.duplicateOf || validationCandidates.length !== 1 ||
          validationCandidates[0].status !== "READY" ||
          validationCandidateIds?.[alphaId] !== validationCandidates[0]?.candidateId) {
        differences.push(`Frozen selected B1 candidate ${alphaId} is not a unique READY canonical validation candidate.`);
        continue;
      }
      const policyReturnError = validateCandidateReturns(policyCandidate, frozenPolicy.dataset.sha256, policyDates);
      const validationReturnError = validateCandidateReturns(validationCandidates[0],
        frozenValidation.dataset.sha256, validationDates);
      if (policyReturnError || validationReturnError)
        differences.push(policyReturnError ?? validationReturnError!);
    }
  }

  const frozenRegime = sourceIds?.regimeClassification;
  const savedRegimes = isRecord(row.resultJson.regimes) ? row.resultJson.regimes : null;
  if (!frozenRegime || frozenRegime.source !== manifest.input?.regimeSource ||
      !savedRegimes || savedRegimes.source !== frozenRegime.source ||
      savedRegimes.version !== frozenRegime.version || savedRegimes.status !== frozenRegime.status)
    differences.push("Frozen regime source/version does not exactly match the original persisted diagnostic result.");

  const frozenPerAlpha = (source as any)?.c1ByAlpha as Record<string, any> | undefined;
  const frozenDependencyPlan = (source as any)?.dependencyPlan as Array<Record<string, any>> | undefined;
  if (frozenPerAlpha || frozenDependencyPlan) {
    const dependencies = Array.isArray(frozenDependencyPlan) ? frozenDependencyPlan : [];
    if (dependencies.length !== manifest.input?.alphaIds?.length ||
        new Set(dependencies.map((item) => item.alphaId)).size !== dependencies.length ||
        dependencies.some((item) => !manifest.input?.alphaIds?.includes(item.alphaId) ||
          !["REUSED", "CREATED", "UNAVAILABLE"].includes(item.status)))
      differences.push("Frozen per-alpha dependency plan does not match the unique selected C2 alpha IDs.");
    for (const dependency of dependencies) {
      const alphaId = String(dependency.alphaId);
      const frozenC1 = frozenPerAlpha?.[alphaId];
      const dependencyId = dependency.c1ExperimentId;
      if (dependency.status === "UNAVAILABLE") {
        if (frozenC1) differences.push(`dependencyPlan.${alphaId}: unavailable dependency unexpectedly has successful C1 source data.`);
        if (typeof dependencyId === "number") {
          const [failedRow] = await db.select().from(c1ExperimentsTable)
            .where(eq(c1ExperimentsTable.id, dependencyId)).limit(1);
          const expected = (sourceIds?.c1Dependencies ?? {})[alphaId];
          const observed = failedRow ? {
            id: failedRow.id, allocationId: failedRow.allocationId,
            validationPreparedInputId: failedRow.validationPreparedInputId,
            status: failedRow.status, manifestHash: failedRow.manifestHash,
            inputHash: failedRow.inputHash, childValidationRunIds: failedRow.childValidationRunIds,
          } : null;
          differences.push(...compareValues(expected, observed).differences
            .map((item) => `sourceIdentity.c1Dependencies.${alphaId}.${item}`));
          if (failedRow && (
            fingerprint(failedRow.manifestJson) !== sourceHashes?.c1Dependencies?.[alphaId]?.manifestHash ||
            fingerprint(failedRow.childResultsJson) !== sourceHashes?.c1Dependencies?.[alphaId]?.childResultsHash ||
            fingerprint(failedRow.summaryJson) !== sourceHashes?.c1Dependencies?.[alphaId]?.summaryHash ||
            fingerprint(failedRow.childValidationRunIds) !==
              fingerprint(sourceHashes?.c1Dependencies?.[alphaId]?.childValidationRunIds) ||
            fingerprint((failedRow.childResultsJson as C1Child[]).map((child) => ({
              excludedCandidateIds: child.excludedCandidateIds,
              validationRunId: child.validationRunId,
              validationInputHash: child.validationInputHash ?? null,
              resultHash: fingerprint(child.result),
            }))) !== fingerprint(sourceHashes?.c1Dependencies?.[alphaId]?.childReferences)
          )) differences.push(`dependencyPlan.${alphaId}: persisted failed C1 record differs from frozen failure reference.`);
          if (failedRow) {
            const frozenFailureChild = (failedRow.childResultsJson as C1Child[]).find((child) =>
              canonicalJson(child.excludedCandidateIds) === canonicalJson([alphaId]));
            differences.push(...compareValues(
              sourceHashes?.c1Dependencies?.[alphaId]?.failedChild ?? null,
              frozenFailureChild ?? null,
            ).differences.map((item) => `sourceHashes.c1Dependencies.${alphaId}.failedChild.${item}`));
          }
          if (failedRow && allocation && validation && policy) {
            const failedChecked = await c1SourceHashCheck(
              failedRow, actualAllocationFp, actualValidationFp,
              policy.snapshot as PreparedSnapshot, validation.snapshot as PreparedSnapshot,
              allocation.frozenRequest as AllocationRequest,
            );
            if (typeof failedChecked === "string") {
              differences.push(`dependencyPlan.${alphaId}: failed C1 source integrity failed: ${failedChecked}`);
            } else {
              differences.push(...(await replayC1ChildRuns(failedChecked.source.children))
                .map((item) => `dependencyPlan.${alphaId}: ${item}`));
            }
          }
        }
        continue;
      }
      if (!frozenC1 || typeof dependencyId !== "number" || frozenC1.id !== dependencyId) {
        differences.push(`dependencyPlan.${alphaId}: frozen successful C1 reference is absent or differs from its plan.`);
        continue;
      }
      const [c1Row] = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.id, dependencyId)).limit(1);
      if (!c1Row || !allocation || !validation || !policy) {
        differences.push(`dependencyPlan.${alphaId}: referenced frozen C1/B1/B2 source is unavailable.`);
        continue;
      }
      const checked = await c1SourceHashCheck(
        c1Row, actualAllocationFp, actualValidationFp,
        policy.snapshot as PreparedSnapshot, validation.snapshot as PreparedSnapshot,
        allocation.frozenRequest as AllocationRequest,
      );
      if (typeof checked === "string") {
        differences.push(`dependencyPlan.${alphaId}: ${checked}`);
        continue;
      }
      differences.push(...compareValues({
        id: frozenC1.id, manifest: frozenC1.manifest, children: frozenC1.children, summary: frozenC1.summary,
      }, {
        id: c1Row.id, manifest: checked.source.manifest, children: checked.source.children, summary: checked.source.summary,
      }).differences.map((item) => `dependencyPlan.${alphaId}.source.${item}`));
      differences.push(...compareValues(
        sourceIds?.c1Dependencies?.[alphaId], checked.identities,
      ).differences.map((item) => `sourceIdentity.c1Dependencies.${alphaId}.${item}`));
      differences.push(...compareValues(
        sourceHashes?.c1Dependencies?.[alphaId], checked.hashes,
      ).differences.map((item) => `sourceHashes.c1Dependencies.${alphaId}.${item}`));
      differences.push(...(await replayC1ChildRuns(checked.source.children))
        .map((item) => `dependencyPlan.${alphaId}: ${item}`));
    }
    if (frozenPerAlpha && Object.keys(frozenPerAlpha).some((alphaId) =>
      !dependencies.some((dependency) => dependency.alphaId === alphaId &&
        (dependency.status === "REUSED" || dependency.status === "CREATED"))))
      differences.push("Frozen per-alpha C1 sources contain a dependency absent from the immutable dependency plan.");
    const templateIdentity = sourceIds?.c1Template;
    if (templateIdentity && typeof templateIdentity.id === "number") {
      const [templateRow] = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.id, templateIdentity.id)).limit(1);
      if (!templateRow || !allocation || !validation || !policy) {
        differences.push("Frozen C1/B3 assumption template reference is unavailable.");
      } else {
        differences.push(...compareValues(templateIdentity, {
          id: templateRow.id, allocationId: templateRow.allocationId,
          validationPreparedInputId: templateRow.validationPreparedInputId,
          status: templateRow.status, manifestHash: templateRow.manifestHash,
          inputHash: templateRow.inputHash, childValidationRunIds: templateRow.childValidationRunIds,
        }).differences.map((item) => `sourceIdentity.c1Template.${item}`));
        const templateChecked = await c1SourceHashCheck(
          templateRow, actualAllocationFp, actualValidationFp,
          policy.snapshot as PreparedSnapshot, validation.snapshot as PreparedSnapshot,
          allocation.frozenRequest as AllocationRequest,
        );
        if (typeof templateChecked === "string") {
          differences.push(`C1/B3 assumption template integrity failed: ${templateChecked}`);
        } else {
          differences.push(...compareValues(sourceHashes?.c1Template, {
            manifestHash: fingerprint(templateRow.manifestJson),
            childResultsHash: fingerprint(templateRow.childResultsJson),
            summaryHash: fingerprint(templateRow.summaryJson),
          }).differences.map((item) => `sourceHashes.c1Template.${item}`));
          differences.push(...(await replayC1ChildRuns(templateChecked.source.children))
            .map((item) => `C1/B3 assumption template child replay failed: ${item}`));
        }
      }
    } else if (sourceHashes?.c1Template !== null) {
      differences.push("Frozen C1/B3 assumption template identity is inconsistent.");
    }
  } else if (row.c1ExperimentId !== null && !Array.isArray(source?.dependencyPlan)) {
    // Historical C2 rows retain their original singular C1 source contract.
    const [c1Row] = await db.select().from(c1ExperimentsTable)
      .where(eq(c1ExperimentsTable.id, row.c1ExperimentId)).limit(1);
    if (!c1Row || fingerprint(c1Row.manifestJson) !== sourceHashes?.c1?.manifestHash ||
        fingerprint(c1Row.summaryJson) !== sourceHashes?.c1?.summaryHash ||
        fingerprint(c1Row.childResultsJson) !== fingerprint(source.c1?.children))
      differences.push("Referenced legacy C1 manifest, summary, or B3 children differ from the frozen manifest.");
  }

  let replayed: unknown;
  if (source && manifest.engineVersion === C2_ENGINE_VERSION && isRecord(manifest.input)) {
    try {
      replayed = await computeC2Diagnostics(manifest.input, source);
    } catch (error) {
      differences.push(`Frozen-source C2 replay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const compared = replayed === undefined
    ? { differences: [], maximumNumericDifference: 0 }
    : compareValues(row.resultJson, replayed);
  differences.push(...compared.differences);
  return {
    experimentId: id,
    status: differences.length === 0 ? "pass" as const : "fail" as const,
    inputHash: row.inputHash,
    resultHash: row.resultHash,
    maximumNumericDifference: compared.maximumNumericDifference,
    differences,
  };
}