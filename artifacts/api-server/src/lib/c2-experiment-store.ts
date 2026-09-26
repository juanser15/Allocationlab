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

const REPLAY_TOLERANCE = 1e-8;

type C1Child = {
  label: string;
  excludedCandidateIds: string[];
  validationRunId: number | null;
  validationInputHash?: string;
  policyRequest: unknown;
  result: unknown;
};

type FrozenC1 = { manifest: any; children: C1Child[]; summary: any };

type C2Manifest = {
  schemaVersion: 1;
  input: C2Input;
  engineVersion: string;
  sourceIdentities: Record<string, unknown>;
  sourceHashes: Record<string, unknown>;
  sources: C2Sources;
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

function normalizeInput(raw: ApiC2ExperimentInput): C2Input {
  const toDate = (value: unknown): string => value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === "string" ? value.slice(0, 10) : "";
  return {
    allocationId: raw.allocationId,
    validationPreparedInputId: raw.validationPreparedInputId,
    c1ExperimentId: raw.c1ExperimentId,
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

function validateNormalizedInput(input: C2Input): string | null {
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
  if (row.status !== "completed" || row.manifestHash !== manifestHash || row.inputHash !== expectedInputHash ||
      manifest.allocationId !== row.allocationId || manifest.validationPreparedInputId !== row.validationPreparedInputId ||
      manifest.allocationFingerprint !== allocationFp || manifest.validationPreparedFingerprint !== validationFp ||
      manifest.validationDatasetHash !== validationSnapshot.dataset.sha256)
    return "Referenced C1 experiment is incomplete or its frozen identity/hash does not match the selected B1/B2 sources.";
  if (row.allocationId !== manifest.allocationId ||
      manifest.allocationPreparedInputId !== allocationRequest.preparedInputId ||
      !Array.isArray(manifest.candidateIds) ||
      canonicalJson(manifest.candidateIds) !== canonicalJson(allocationRequest.candidateIds))
    return "Referenced C1 experiment does not identify the selected full baseline policy.";
  const baseline = children.find((child) => child?.excludedCandidateIds?.length === 0);
  const baselineResult = baseline?.result as Record<string, any> | undefined;
  if (!baseline || baseline.validationRunId === null || baselineResult?.status !== "completed")
    return "Referenced C1 experiment is missing its original successful full-policy baseline.";
  if (!isRecord(baseline.policyRequest) ||
      fingerprint(baseline.policyRequest) !== fingerprint(allocationRequest) ||
      !isRecord(baselineResult?.policyIdentity) ||
      canonicalJson(baselineResult.policyIdentity.candidateIds) !== canonicalJson(allocationRequest.candidateIds))
    return "Referenced C1 full child is not the unchanged original B2 baseline policy.";
  const runIds = children.flatMap((child) => child?.validationRunId === null ? [] : [child?.validationRunId]);
  if (runIds.length !== children.length || new Set(runIds).size !== runIds.length)
    return "Referenced C1 experiment does not contain one unique immutable B3 Validation Run per policy child.";
  const runRows = await db.select().from(validationRunsTable).where(inArray(validationRunsTable.id, runIds));
  const runsById = new Map(runRows.map((run) => [run.id, run]));
  const b3RunIdentities = [];
  for (const child of children) {
    const run = runsById.get(child.validationRunId!);
    if (!run || run.allocationId !== row.allocationId ||
        run.validationPreparedInputId !== row.validationPreparedInputId ||
        run.datasetHash !== validationSnapshot.dataset.sha256 ||
        run.validationInputHash !== child.validationInputHash ||
        run.reconciliationStatus !== "pass" || run.reproducibilityStatus !== "pass" ||
        !isRecord(run.resultJson) || fingerprint(run.resultJson.result) !== fingerprint(child.result) ||
        fingerprint(run.resultJson.policyRequest) !== fingerprint(child.policyRequest))
      return `Referenced B3 Validation Run ${child.validationRunId} is missing or differs from the frozen C1 child.`;
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

  const policyDates = new Set(parseCsv(policySnapshot.dataset.csvContent).map((item) => item.date));
  const validationDates = new Set(parseCsv(validationSnapshot.dataset.csvContent).map((item) => item.date));
  for (const alphaId of manifest.candidateIds as string[]) {
    const policyCandidate = policySnapshot.candidates.find((item) => item.candidateId === alphaId);
    const matchingValidation = validationSnapshot.candidates.filter((item) =>
      item.candidateId === item.canonicalFingerprint && !item.diagnostics.duplicateOf &&
      policyCandidate && compatibleCandidateDefinitions(policyCandidate, item));
    if (!policyCandidate || policyCandidate.canonicalFingerprint !== alphaId ||
        policyCandidate.diagnostics.duplicateOf || matchingValidation.length !== 1)
      return `C1 baseline alpha ${alphaId} no longer maps to exactly one compatible canonical B1 validation candidate.`;
    const policyReturnError = validateCandidateReturns(policyCandidate, policySnapshot.dataset.sha256, policyDates);
    const validationReturnError = validateCandidateReturns(matchingValidation[0], validationSnapshot.dataset.sha256, validationDates);
    if (policyReturnError || validationReturnError)
      return policyReturnError ?? validationReturnError!;
  }
  const childrenForHash = children.map((child) => ({
    validationRunId: child.validationRunId,
    validationInputHash: child.validationInputHash ?? null,
    resultHash: fingerprint(child.result),
  }));
  return {
    source: { manifest: structuredClone(manifest), children: structuredClone(children), summary: row.summaryJson },
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

async function loadSources(input: C2Input): Promise<
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
    const validationReturnError = validateCandidateReturns(validationCandidate, validationSnapshot.dataset.sha256, validationDates);
    if (validationReturnError) return { error: validationReturnError, status: 409 };
  }

  let c1: FrozenC1 | undefined;
  let c1Identities: Record<string, unknown> | null = null;
  let c1Hashes: Record<string, unknown> | null = null;
  if (input.c1ExperimentId !== null) {
    const [c1Row] = await db.select().from(c1ExperimentsTable)
      .where(eq(c1ExperimentsTable.id, input.c1ExperimentId)).limit(1);
    if (!c1Row) return { error: "Referenced C1 experiment not found.", status: 404 };
    if (c1Row.allocationId !== input.allocationId ||
        c1Row.validationPreparedInputId !== input.validationPreparedInputId)
      return { error: "Referenced C1 experiment does not use the requested original B2 allocation and B1 evaluation preparation.", status: 409 };
    const checked = await c1SourceHashCheck(c1Row, allocationFp, validationFp, policySnapshot, validationSnapshot, allocationRequest);
    if (typeof checked === "string") return { error: checked, status: 409 };
    c1 = checked.source;
    c1Identities = checked.identities;
    c1Hashes = checked.hashes;
    for (const alphaId of input.alphaIds) {
      if (!(checked.source.manifest.candidateIds as string[]).includes(alphaId))
        return { error: `Selected alpha ${alphaId} is not eligible in the referenced C1 full-baseline policy.`, status: 422 };
      const hasExclusion = checked.source.children.some((child) =>
        child.excludedCandidateIds.includes(alphaId) &&
        (child.result as Record<string, unknown>)?.status === "completed");
      if (!hasExclusion)
        return { error: `Referenced C1 experiment has no successful original exclusion child for selected alpha ${alphaId}; C2 will not synthesize one.`, status: 422 };
    }
  }

  const sources: C2Sources = {
    validation: validationSnapshot,
    policy: policySnapshot,
    allocationRequest,
    ...(c1 ? { c1 } : {}),
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
      ...(c1Identities ? { c1: c1Identities } : { c1: null }),
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
      ...(c1Hashes ? { c1: c1Hashes } : { c1: null }),
    },
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
  let result: Awaited<ReturnType<typeof computeC2Diagnostics>>;
  try {
    result = await computeC2Diagnostics(input, loaded.sources);
  } catch (error) {
    return {
      error: `C2 diagnostics could not be computed from the frozen sources: ${error instanceof Error ? error.message : String(error)}`,
      status: 422,
    } as const;
  }
  const manifest: C2Manifest = {
    schemaVersion: 1,
    input,
    engineVersion: C2_ENGINE_VERSION,
    sourceIdentities: {
      ...loaded.sourceIdentities,
      regimeClassification: {
        source: result.regimes.source,
        version: result.regimes.version,
        status: result.regimes.status,
      },
    },
    sourceHashes: loaded.sourceHashes,
    sources: loaded.sources,
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
    for (const alphaId of manifest.input.alphaIds) {
      const policyCandidate = frozenPolicy.candidates.find((candidate) => candidate.candidateId === alphaId);
      const validationCandidates = frozenValidation.candidates.filter((candidate) =>
        candidate.candidateId === candidate.canonicalFingerprint && !candidate.diagnostics.duplicateOf &&
        policyCandidate && compatibleCandidateDefinitions(policyCandidate, candidate));
      if (!policyCandidate || policyCandidate.canonicalFingerprint !== alphaId ||
          policyCandidate.diagnostics.duplicateOf || validationCandidates.length !== 1 ||
          validationCandidates[0].status !== "READY") {
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

  if (row.c1ExperimentId !== null) {
    const [c1Row] = await db.select().from(c1ExperimentsTable)
      .where(eq(c1ExperimentsTable.id, row.c1ExperimentId)).limit(1);
    const expectedC1Identity = sourceIds?.c1;
    const observedC1Identity = c1Row ? {
      id: c1Row.id, allocationId: c1Row.allocationId, validationPreparedInputId: c1Row.validationPreparedInputId,
      status: c1Row.status, manifestHash: c1Row.manifestHash, inputHash: c1Row.inputHash,
      childValidationRunIds: c1Row.childValidationRunIds,
    } : null;
    const c1IdentityDifferences = compareValues(expectedC1Identity, observedC1Identity);
    differences.push(...c1IdentityDifferences.differences.map((item) => `sourceIdentity.c1.${item}`));
    if (!c1Row || fingerprint(c1Row.manifestJson) !== sourceHashes?.c1?.manifestHash ||
        fingerprint(c1Row.summaryJson) !== sourceHashes?.c1?.summaryHash ||
        fingerprint(c1Row.childResultsJson) !== fingerprint(source.c1?.children))
      differences.push("Referenced C1 manifest, summary, or B3 children differ from the frozen manifest.");
    const expectedB3Runs = Array.isArray(sourceHashes?.c1?.b3ValidationRuns)
      ? sourceHashes.c1.b3ValidationRuns as Array<Record<string, unknown>> : [];
    const runIds = expectedB3Runs.flatMap((run) => typeof run.id === "number" ? [run.id] : []);
    const currentRuns = runIds.length
      ? await db.select().from(validationRunsTable).where(inArray(validationRunsTable.id, runIds))
      : [];
    const observedB3Runs = currentRuns.map((run) => ({
      id: run.id,
      allocationId: run.allocationId,
      validationPreparedInputId: run.validationPreparedInputId,
      datasetHash: run.datasetHash,
      engineVersion: run.engineVersion,
      reconciliationStatus: run.reconciliationStatus,
      reproducibilityStatus: run.reproducibilityStatus,
      validationInputHash: run.validationInputHash,
      resultHash: fingerprint(run.resultJson),
    })).sort((left, right) => left.id - right.id);
    const expectedB3RunsSorted = [...expectedB3Runs].sort((left, right) =>
      Number(left.id) - Number(right.id));
    const b3RunDifferences = compareValues(expectedB3RunsSorted, observedB3Runs);
    differences.push(...b3RunDifferences.differences.map((item) => `sourceIdentity.b3ValidationRuns.${item}`));
  } else if (sourceIds?.c1 !== null || manifest.input?.c1ExperimentId !== null) {
    differences.push("C1 source identity is inconsistent with the frozen C2 input.");
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