import { desc, eq } from "drizzle-orm";
import {
  allocationsTable, db, preparedInputsTable, validationRunsTable, c2ExperimentsTable,
} from "@workspace/db";
import type { AllocationRequest, AllocationResult } from "./allocation-b2";
import { optimizePreparedSnapshot } from "./allocation-b2";
import type { B3Assumptions, B3Result } from "./b3-policy";
import { persistB3ValidationRun, replayB3ValidationRun } from "./b3-validation-store";
import { getC2Experiment, replayC2Experiment } from "./c2-experiment-store";
import { buildC3Selection } from "./c3-selection";
import { canonicalJson, fingerprint, type PreparedSnapshot } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";

const REPLAY_TOLERANCE = 1e-8;
const C3_ENGINE_VERSION = "c3-policy-comparison.1";
type C3Thresholds = {
  returnCorrelation: number;
  rollingMedianCorrelation: number;
  exposureSimilarity: number;
  regimeCorrelation: number;
  minPairedObservations: number;
  minRollingWindows: number;
  minRegimeObservations: number;
  epsilon: number;
};
type C3Input = {
  allocationId: number;
  validationPreparedInputId: number;
  c2ExperimentId: number;
  alphaIds: string[];
  developmentStartDate: string;
  developmentEndDate: string;
  evaluationStartDate: string;
  evaluationEndDate: string;
  thresholds: C3Thresholds;
  groupCaps?: Record<string, number>;
  manualOverrides: Record<string, string>;
  assumptions?: B3Assumptions;
};
type PolicyRequest = AllocationRequest;
type PolicyKey = "KEEP_ALL" | "GROUP_CAP" | "REPRESENTATIVE";
type PreparedPlan = {
  input: C3Input;
  source: {
    c2Manifest: any;
    c2Result: any;
    policySnapshot: PreparedSnapshot;
    validationSnapshot: PreparedSnapshot;
    baseAllocationRequest: AllocationRequest;
    baseAllocation: typeof allocationsTable.$inferSelect;
    validationPreparedFingerprint: string;
  };
  selection: any;
  policyRequests: Record<PolicyKey, PolicyRequest>;
  summaries: Record<PolicyKey, Record<string, unknown>>;
};
type C3Result = {
  engineVersion: string;
  policies: Record<PolicyKey, {
    allocationId: number;
    allocationFingerprint: string;
    validationRunId: number;
    validationInputHash: string;
    resultHash: string;
    metrics: Record<string, number | null>;
    candidateIds: string[];
  }>;
  pairwiseDifferences: Array<{ left: PolicyKey; right: PolicyKey; metrics: Record<string, number | null> }>;
  allocationDistances: Record<string, Array<{
    date: string; alphaCapitalDistance: number | null; underlyingAssetDistance: number | null;
  }>>;
  allocationDistanceSummary: Record<string, {
    alphaCapitalDistance: { mean: number | null; max: number | null };
    underlyingAssetDistance: { mean: number | null; max: number | null };
  }>;
  methodology: string;
};
type C3Manifest = {
  schemaVersion: 1;
  engineVersion: string;
  input: C3Input;
  sourceIdentities: Record<string, unknown>;
  sourceHashes: Record<string, unknown>;
  c2Evidence: { dependence: unknown[]; stability: unknown[]; regimes: unknown; incrementalContribution: unknown };
  selection: unknown;
  policyRequests: Record<PolicyKey, PolicyRequest>;
  allocations: Record<PolicyKey, Record<string, unknown>>;
  validationRuns: Record<PolicyKey, { id: number; inputHash: string; resultHash: string }>;
  result: C3Result;
};

async function c3Table(): Promise<any> {
  const database = await import("@workspace/db") as unknown as Record<string, any>;
  const table = database.c3ExperimentsTable;
  if (!table) throw new Error("C3 experiment schema is unavailable.");
  return table;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function normalizeInput(raw: C3Input): C3Input {
  return {
    allocationId: raw.allocationId,
    validationPreparedInputId: raw.validationPreparedInputId,
    c2ExperimentId: raw.c2ExperimentId,
    alphaIds: [...raw.alphaIds],
    developmentStartDate: raw.developmentStartDate,
    developmentEndDate: raw.developmentEndDate,
    evaluationStartDate: raw.evaluationStartDate,
    evaluationEndDate: raw.evaluationEndDate,
    thresholds: structuredClone(raw.thresholds),
    ...(raw.groupCaps ? { groupCaps: structuredClone(raw.groupCaps) } : {}),
    manualOverrides: structuredClone(raw.manualOverrides ?? {}),
    ...(raw.assumptions ? { assumptions: structuredClone(raw.assumptions) } : {}),
  };
}

function validateInput(input: C3Input): string | null {
  if (![input.allocationId, input.validationPreparedInputId, input.c2ExperimentId]
    .every((id) => Number.isSafeInteger(id) && id > 0))
    return "allocationId, validationPreparedInputId, and c2ExperimentId must be positive safe integers.";
  if (!Array.isArray(input.alphaIds) || input.alphaIds.length < 2 ||
      input.alphaIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(input.alphaIds).size !== input.alphaIds.length)
    return "alphaIds must contain at least two unique canonical alpha IDs.";
  if (![input.developmentStartDate, input.developmentEndDate, input.evaluationStartDate, input.evaluationEndDate]
    .every(validDate) || input.developmentStartDate > input.developmentEndDate ||
      input.developmentEndDate >= input.evaluationStartDate ||
      input.evaluationStartDate > input.evaluationEndDate)
    return "Development and evaluation dates must be valid, ordered, and strictly separated.";
  const t = input.thresholds;
  for (const name of ["returnCorrelation", "rollingMedianCorrelation", "exposureSimilarity", "regimeCorrelation"] as const)
    if (!finite(t?.[name]) || t[name] < -1 || t[name] > 1)
      return `${name} must be a finite correlation threshold between -1 and 1.`;
  for (const name of ["minPairedObservations", "minRollingWindows", "minRegimeObservations"] as const)
    if (!Number.isSafeInteger(t?.[name]) || t[name] < 2)
      return `${name} must be a safe integer of at least 2.`;
  if (!finite(t?.epsilon) || t.epsilon <= 0 || t.epsilon > 1)
    return "epsilon must be greater than 0 and no greater than 1.";
  if (!isRecord(input.manualOverrides) ||
      Object.entries(input.manualOverrides).some(([groupId, memberId]) => !groupId.trim() || !memberId.trim()))
    return "manualOverrides must map non-empty group IDs to canonical alpha IDs.";
  if (input.groupCaps !== undefined &&
      (!isRecord(input.groupCaps) || Object.values(input.groupCaps).some((value) =>
        !finite(value) || value < 0 || value > 1)))
    return "groupCaps must map redundancy group IDs to finite caps between 0 and 1.";
  if (input.assumptions &&
      (input.assumptions.evaluationStartDate !== input.evaluationStartDate ||
       input.assumptions.evaluationEndDate !== input.evaluationEndDate))
    return "B3 assumptions must use the declared evaluation dates.";
  return null;
}

function allocationFingerprint(row: typeof allocationsTable.$inferSelect): string {
  const snapshotHash = fingerprint(row.frozenSnapshot);
  if (snapshotHash !== row.frozenSnapshotHash) return "";
  return fingerprint({
    preparedInputId: row.preparedInputId, representation: row.representation,
    engineVersion: row.engineVersion, request: row.frozenRequest, snapshotHash, result: row.frozenResult,
  });
}

function preparedFingerprint(snapshot: any): string {
  return fingerprint({
    request: snapshot.request, datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version, engineVersion: snapshot.engineVersion,
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function turnover(entry: Record<string, any>): number | null {
  for (const key of ["externalTradedNotional", "tradedNotional", "turnover"])
    if (finite(entry[key])) return entry[key];
  if (Array.isArray(entry.trades))
    return entry.trades.reduce((sum: number, trade: any) => sum + Math.abs(Number(trade.notional) || 0), 0);
  return null;
}

function dateWithin(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function buildC3PolicyRequests(
  base: PolicyRequest,
  alphaIds: string[],
  selection: any,
  groupCaps: Record<string, number>,
): Record<PolicyKey, PolicyRequest> {
  const allIds = [...alphaIds];
  const capRows = selection.groups.map((group: any) => ({
    name: `c3:${group.id}`,
    candidateIds: [...group.memberIds].sort(),
    max: groupCaps[group.id],
  }));
  const keepAll = structuredClone(base);
  const groupCap = structuredClone(base);
  groupCap.candidateIds = allIds;
  groupCap.constraints.groupCaps = [
    ...(base.constraints.groupCaps ?? []),
    ...capRows,
  ];
  const representativeIds = [...new Set([
    ...selection.standaloneIds,
    ...selection.groups.map((group: any) => group.representativeId),
  ])].sort();
  const representative = structuredClone(base);
  representative.candidateIds = representativeIds;
  if (representative.constraints.candidateBounds)
    representative.constraints.candidateBounds = Object.fromEntries(
      Object.entries(representative.constraints.candidateBounds)
        .filter(([id, bound]) => representativeIds.includes(id) || ((bound as any).min ?? 0) > 0),
    );
  if (representative.constraints.groupCaps)
    representative.constraints.groupCaps = representative.constraints.groupCaps.map((group) => ({
      ...group,
      candidateIds: group.candidateIds.filter((id) => representativeIds.includes(id)),
    })).filter((group) => group.candidateIds.length > 0);
  return { KEEP_ALL: keepAll, GROUP_CAP: groupCap, REPRESENTATIVE: representative };
}

function getC3Assumptions(input: C3Input): B3Assumptions {
  if (!input.assumptions) throw new Error("Full B3 evaluation assumptions are required to run C3.");
  return structuredClone(input.assumptions);
}

async function preparePlan(raw: C3Input, requireCaps: boolean): Promise<PreparedPlan | { error: string; status: number }> {
  const input = normalizeInput(raw);
  const error = validateInput(input);
  if (error) return { error, status: 400 };
  if (requireCaps && !input.assumptions)
    return { error: "Full B3 evaluation assumptions are required to run a C3 comparison.", status: 400 };
  const c2 = await getC2Experiment(input.c2ExperimentId);
  if (!c2) return { error: "Frozen C2 development experiment was not found.", status: 404 };
  // A development preview must remain responsive while inputs are being edited.
  // Check the frozen record's integrity here; the actual run (and C3 replay)
  // additionally re-executes the complete C2 replay before using its evidence.
  if (fingerprint(c2.manifest) !== c2.manifestHash || fingerprint(c2.result) !== c2.resultHash)
    return { error: "C2 development experiment failed frozen manifest/result integrity checks.", status: 409 };
  if (requireCaps) {
    const c2Replay = await replayC2Experiment(input.c2ExperimentId);
    if (!c2Replay || c2Replay.status !== "pass")
      return { error: `C2 development experiment failed frozen integrity/replay checks: ${c2Replay?.differences?.join("; ") ?? "missing replay"}`, status: 409 };
  }
  const c2Manifest = c2.manifest as any;
  const c2Input = c2Manifest?.input;
  if (c2.allocationId !== input.allocationId ||
      c2.validationPreparedInputId !== input.validationPreparedInputId ||
      c2Input?.startDate !== input.developmentStartDate ||
      c2Input?.endDate !== input.developmentEndDate ||
      canonicalJson([...(c2Input?.alphaIds ?? [])].sort()) !== canonicalJson([...input.alphaIds].sort()))
    return { error: "Selected C2 must use the same frozen B1/B2 sources, exact alpha universe, and development dates.", status: 409 };
  const source = c2Manifest.sources;
  if (!isRecord(source) || !isRecord(source.policy) || !isRecord(source.validation) ||
      !isRecord(source.allocationRequest) || !isRecord(c2.result) ||
      !Array.isArray(c2.result.dependence?.pairs) || !Array.isArray(c2.result.stability?.alphas) ||
      !Array.isArray(c2.result.regimes?.conditional ?? c2.result.regimes?.conditionalPerformance))
    return { error: `Frozen C2 record is missing its development evidence or B1/B2 snapshots (policy=${isRecord(source?.policy)}, validation=${isRecord(source?.validation)}, allocationRequest=${isRecord(source?.allocationRequest)}, result=${isRecord(c2.result)}, dependence=${Array.isArray((c2.result as any)?.dependence?.pairs)}, stability=${Array.isArray((c2.result as any)?.stability?.alphas)}, conditionalPerformance=${Array.isArray((c2.result as any)?.regimes?.conditional ?? (c2.result as any)?.regimes?.conditionalPerformance)}).`, status: 409 };
  const [baseAllocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, input.allocationId)).limit(1);
  if (!baseAllocation || c2.allocationId !== input.allocationId ||
      allocationFingerprint(baseAllocation) !== baseAllocation.fingerprint)
    return { error: "Selected frozen B2 policy failed its allocation integrity check.", status: 409 };
  const baseRequest = structuredClone(baseAllocation.frozenRequest) as AllocationRequest;
  const policySnapshot = structuredClone(source.policy) as PreparedSnapshot;
  const validationSnapshot = structuredClone(source.validation) as PreparedSnapshot;
  if (baseRequest.informationCutoff > input.developmentEndDate)
    return { error: "Frozen B2 informationCutoff must not be after the C3 development end date.", status: 409 };
  if (baseRequest.preparedInputId !== baseAllocation.preparedInputId ||
      baseAllocation.representation !== "alpha_streams" ||
      canonicalJson([...baseRequest.candidateIds].sort()) !== canonicalJson([...input.alphaIds].sort()) ||
      fingerprint(policySnapshot) !== baseAllocation.frozenSnapshotHash ||
      hashDataset(policySnapshot.dataset.csvContent) !== policySnapshot.dataset.sha256 ||
      hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    return { error: "C3 alpha universe or frozen B1/B2 snapshot does not exactly match the selected policy.", status: 409 };
  const [validationRow] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, input.validationPreparedInputId)).limit(1);
  if (!validationRow || preparedFingerprint(validationSnapshot) !== validationRow.fingerprint)
    return { error: "Selected evaluation B1 preparation failed its immutable fingerprint check.", status: 409 };
  if (input.evaluationStartDate < validationSnapshot.dataset.startDate ||
      input.evaluationEndDate > validationSnapshot.dataset.endDate)
    return { error: "C3 evaluation dates are outside the selected frozen B1 evaluation dataset.", status: 422 };
  if (input.assumptions?.evaluationStartDate !== input.evaluationStartDate ||
      input.assumptions?.evaluationEndDate !== input.evaluationEndDate)
    if (requireCaps) return { error: "B3 evaluation assumptions must exactly match the declared evaluation dates.", status: 400 };

  const policyDates = [...new Set(policySnapshot.candidates.flatMap((candidate: any) =>
    (candidate.returnSeries ?? []).filter((point: any) =>
      dateWithin(point.date, input.developmentStartDate, input.developmentEndDate)).map((point: any) => point.date)))].sort();
  const candidateMetadata = input.alphaIds.map((id) => {
    const candidate = policySnapshot.candidates.find((item: any) => item.candidateId === id) as any;
    const ledger = (candidate?.ledger ?? []).filter((entry: any) =>
      dateWithin(entry.date, input.developmentStartDate, input.developmentEndDate));
    const notionals = ledger.map(turnover).filter((value: number | null): value is number => value !== null);
    const valid = (candidate?.returnSeries ?? []).filter((point: any) =>
      dateWithin(point.date, input.developmentStartDate, input.developmentEndDate) && finite(point.value));
    return {
      id,
      developmentTurnover: median(notionals),
      coverage: policyDates.length ? valid.length / policyDates.length : 0,
    };
  });
  const conditionalByAlpha = new Map<string, unknown>(
    (c2.result.regimes?.conditional ?? c2.result.regimes?.conditionalPerformance)
      .map((row: any) => [row.alphaId, row.regimes]),
  );
  const contributionRows = c2.result.incrementalContribution?.conditional ?? [];
  const dependenceEvidence = c2.result.dependence.pairs.map((row: any) => ({
    ...row,
    conditionalPerformanceByRegime: {
      [row.alphaA]: conditionalByAlpha.get(row.alphaA) ?? null,
      [row.alphaB]: conditionalByAlpha.get(row.alphaB) ?? null,
    },
    conditionalContributionByRegime: contributionRows.filter((item: any) =>
      item.alphaId === row.alphaA || item.alphaId === row.alphaB),
  }));
  let selection: PreparedPlan["selection"];
  try {
    selection = buildC3Selection({
      alphaIds: input.alphaIds, dependence: dependenceEvidence,
      candidates: candidateMetadata, thresholds: input.thresholds,
      manualOverrides: input.manualOverrides,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const isManualOverrideError = /manual representative override/i.test(reason);
    return {
      error: `C3 development selection failed: ${reason}`,
      status: isManualOverrideError ? 400 : 409,
    };
  }
  if (selection.groups.some((group: any) => group.memberIds.length < 2 ||
      !group.memberIds.includes(group.representativeId)) ||
      selection.groups.some((group: any) =>
        input.manualOverrides[group.id] && group.representativeId !== input.manualOverrides[group.id]))
    return { error: "C3 grouping/representative selection failed its frozen development evidence checks.", status: 409 };
  const caps = input.groupCaps ?? {};
  if (requireCaps && (Object.keys(caps).length !== selection.groups.length ||
      selection.groups.some((group: any) => !finite(caps[group.id]) || caps[group.id] < 0 || caps[group.id] > 1)))
    return { error: "Run requests must specify one valid user-configured B2 group cap for every generated redundancy group.", status: 400 };
  if (Object.keys(caps).some((id) => !selection.groups.some((group: any) => group.id === id)))
    return { error: "groupCaps contains an unknown C3 redundancy group ID.", status: 400 };
  const policyRequests = buildC3PolicyRequests(baseRequest, input.alphaIds, selection, caps);
  const summaries = {
    KEEP_ALL: { alphaCount: policyRequests.KEEP_ALL.candidateIds.length, groupCount: 0, removedAlphaIds: [] },
    GROUP_CAP: { alphaCount: policyRequests.GROUP_CAP.candidateIds.length, groupCount: selection.groups.length, removedAlphaIds: [] },
    REPRESENTATIVE: {
      alphaCount: policyRequests.REPRESENTATIVE.candidateIds.length,
      groupCount: selection.groups.length,
      removedAlphaIds: input.alphaIds.filter((id) => !policyRequests.REPRESENTATIVE.candidateIds.includes(id)),
    },
  };
  return {
    input, selection, policyRequests, summaries,
    source: {
      c2Manifest, c2Result: c2.result, policySnapshot, validationSnapshot,
      baseAllocationRequest: baseRequest, baseAllocation,
      validationPreparedFingerprint: validationRow.fingerprint,
    },
  };
}

export async function previewC3Experiment(raw: C3Input) {
  const prepared = await preparePlan(raw, false);
  if ("error" in prepared) return prepared;
  return {
    plan: {
      engineVersion: C3_ENGINE_VERSION,
      developmentPeriod: { startDate: prepared.input.developmentStartDate, endDate: prepared.input.developmentEndDate },
      evaluationPeriod: { startDate: prepared.input.evaluationStartDate, endDate: prepared.input.evaluationEndDate },
      thresholds: prepared.input.thresholds,
      policies: prepared.summaries,
      groups: prepared.selection.groups,
      standaloneIds: prepared.selection.standaloneIds,
      preservedPairs: prepared.selection.preservedPairs,
      sensitivity: prepared.selection.sensitivity,
      policyRequests: prepared.policyRequests,
      methodology: "Conservative complete-linkage grouping from frozen C2 development evidence; evaluation outcomes do not change groups or representatives.",
    },
  } as const;
}

function engineVersionFor(result: AllocationResult): string {
  return `allocation-b2-api.1; ${result.solver.name}@${result.solver.version}`;
}

function createAllocationRow(
  request: AllocationRequest,
  snapshot: PreparedSnapshot,
  result: AllocationResult,
) {
  const frozenRequest = structuredClone(request);
  const frozenSnapshot = structuredClone(snapshot);
  const frozenResult = structuredClone(result);
  const snapshotHash = fingerprint(frozenSnapshot);
  const engineVersion = engineVersionFor(result);
  const allocationHash = fingerprint({
    preparedInputId: request.preparedInputId,
    representation: request.representation,
    engineVersion,
    request: frozenRequest,
    snapshotHash,
    result: frozenResult,
  });
  return {
    preparedInputId: request.preparedInputId, representation: request.representation,
    fingerprint: allocationHash, frozenSnapshotHash: snapshotHash, engineVersion,
    frozenRequest, frozenSnapshot, frozenResult,
  };
}

function b3Assumptions(input: C3Input): B3Assumptions {
  return getC3Assumptions(input);
}

function halfL1(left: Record<string, number>, right: Record<string, number>): number {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  return 0.5 * [...ids].reduce((sum, id) => sum + Math.abs((left[id] ?? 0) - (right[id] ?? 0)), 0);
}

function hhi(weights: Record<string, number>): number | null {
  const values = Object.values(weights).filter((value) => finite(value) && value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.reduce((sum, value) => sum + (value / total) ** 2, 0) : null;
}

function policyMetrics(result: B3Result, candidateIds: string[]): Record<string, number | null> {
  const ledger = result.dailyLedger;
  const cashWeights = ledger.map((entry) => entry.endingNav > 0 ? entry.endingCash / entry.endingNav : null)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const riskyWeights = ledger.map((entry) => entry.endingNav > 0
    ? entry.endingPositions.reduce((sum, position) => sum + position.marketValue, 0) / entry.endingNav
    : null).filter((value): value is number => value !== null && Number.isFinite(value));
  const decisions = result.decisions;
  const averageConcentration = (rows: Array<Record<string, number>>, ids?: string[]) => {
    const values = rows.map((row) => hhi(ids ? Object.fromEntries(ids.map((id) => [id, row[id] ?? 0])) : row))
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const active = new Set(decisions.flatMap((decision) =>
    candidateIds.filter((id) => (decision.candidateWeights[id] ?? 0) > 1e-8)));
  const lastDecision = decisions.at(-1);
  return {
    cumulativeReturn: result.metrics?.cumulativeReturn ?? null,
    annualizedReturn: result.metrics?.annualizedReturn ?? null,
    annualizedVolatility: result.metrics?.annualizedVolatility ?? null,
    dailyExcessReturnSharpe: result.metrics?.sharpe ?? null,
    maximumDrawdown: result.metrics?.maximumDrawdown ?? null,
    externalTradedNotional: result.metrics?.externalTradedNotional ?? null,
    transactionCosts: result.metrics?.totalTransactionCosts ?? null,
    slippage: result.metrics?.totalSlippage ?? null,
    averageCash: cashWeights.length ? cashWeights.reduce((sum, value) => sum + value, 0) / cashWeights.length : null,
    averageRiskyExposure: riskyWeights.length ? riskyWeights.reduce((sum, value) => sum + value, 0) / riskyWeights.length : null,
    activeAlphaStreams: active.size,
    finalUnderlyingAssets: lastDecision
      ? Object.values(lastDecision.targetAssetWeights).filter((weight) => weight > 1e-8).length : 0,
    alphaCapitalConcentration: averageConcentration(decisions.map((decision) => decision.candidateWeights), candidateIds),
    underlyingExposureConcentration: averageConcentration(decisions.map((decision) => decision.targetAssetWeights)),
  };
}

function childDistances(runs: Record<PolicyKey, B3Result>) {
  const keys: PolicyKey[] = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"];
  const pairs: Array<[PolicyKey, PolicyKey]> = [
    ["KEEP_ALL", "GROUP_CAP"], ["KEEP_ALL", "REPRESENTATIVE"], ["GROUP_CAP", "REPRESENTATIVE"],
  ];
  const allocationDistances: C3Result["allocationDistances"] = {};
  for (const [leftKey, rightKey] of pairs) {
    const leftByDate = new Map(runs[leftKey].decisions.map((decision: any) => [decision.decisionDate, decision]));
    const rightByDate = new Map(runs[rightKey].decisions.map((decision: any) => [decision.decisionDate, decision]));
    const dates = [...new Set([...leftByDate.keys(), ...rightByDate.keys()])].sort();
    allocationDistances[`${leftKey}_vs_${rightKey}`] = dates.map((date) => {
      const left: any = leftByDate.get(date), right: any = rightByDate.get(date);
      return {
        date,
        alphaCapitalDistance: left && right ? halfL1(left.candidateWeights ?? {}, right.candidateWeights ?? {}) : null,
        underlyingAssetDistance: left && right ? halfL1(left.targetAssetWeights ?? {}, right.targetAssetWeights ?? {}) : null,
      };
    });
  }
  return allocationDistances;
}

function distanceSummary(distances: C3Result["allocationDistances"]): C3Result["allocationDistanceSummary"] {
  return Object.fromEntries(Object.entries(distances).map(([pair, series]) => {
    const summarize = (values: Array<number | null>) => {
      const available = values.filter((value): value is number => finite(value));
      return {
        mean: available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null,
        max: available.length ? available.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
      };
    };
    return [pair, {
      alphaCapitalDistance: summarize(series.map((row) => row.alphaCapitalDistance)),
      underlyingAssetDistance: summarize(series.map((row) => row.underlyingAssetDistance)),
    }];
  }));
}

function createResult(
  runs: Record<PolicyKey, B3Result>,
  records: C3Manifest["validationRuns"],
  allocations: C3Manifest["allocations"],
  candidateIds: Record<PolicyKey, string[]>,
): C3Result {
  const keys: PolicyKey[] = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"];
  const policies = Object.fromEntries(keys.map((key) => [key, {
    allocationId: allocations[key].id as number,
    allocationFingerprint: allocations[key].fingerprint as string,
    validationRunId: records[key].id,
    validationInputHash: records[key].inputHash,
    resultHash: records[key].resultHash,
    metrics: policyMetrics(runs[key], candidateIds[key]),
    candidateIds: candidateIds[key],
  }])) as C3Result["policies"];
  const pairwiseDifferences = [
    ["KEEP_ALL", "GROUP_CAP"], ["KEEP_ALL", "REPRESENTATIVE"], ["GROUP_CAP", "REPRESENTATIVE"],
  ].map(([left, right]) => {
    const leftPolicy = left as PolicyKey, rightPolicy = right as PolicyKey;
    const l = policyMetrics(runs[leftPolicy], candidateIds[leftPolicy]);
    const r = policyMetrics(runs[rightPolicy], candidateIds[rightPolicy]);
    const metrics: Record<string, number | null> = {};
    for (const key of Object.keys(l ?? {}))
      metrics[key] = finite(l?.[key]) && finite(r?.[key]) ? l![key]! - r![key]! : null;
    return { left: left as PolicyKey, right: right as PolicyKey, metrics };
  });
  const allocationDistances = childDistances(runs);
  return {
    engineVersion: C3_ENGINE_VERSION, policies, pairwiseDifferences,
    allocationDistances,
    allocationDistanceSummary: distanceSummary(allocationDistances),
    methodology: "Three frozen B2 policies evaluated through B3 with identical evaluation dataset, dates, assumptions, execution, costs, and accounting. Pairwise differences are descriptive; no winner is inferred.",
  };
}

async function runPolicies(prepared: PreparedPlan) {
  const c3 = await c3Table();
  const allocations: C3Manifest["allocations"] = {} as C3Manifest["allocations"];
  const validationRuns: C3Manifest["validationRuns"] = {} as C3Manifest["validationRuns"];
  const results: Record<PolicyKey, B3Result> = {} as Record<PolicyKey, B3Result>;
  const requests = prepared.policyRequests;
  const policyKeys: PolicyKey[] = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"];
  for (const key of policyKeys) {
    const request = requests[key];
    let allocation: typeof allocationsTable.$inferSelect;
    if (key === "KEEP_ALL") {
      allocation = prepared.source.baseAllocation;
      if ((allocation.frozenResult as AllocationResult).status !== "SOLVED" ||
          fingerprint(allocation.frozenRequest) !== fingerprint(request))
        return { error: "KEEP_ALL must preserve the original solved B2 policy unchanged.", status: 409 } as const;
    } else {
      let allocationResult: AllocationResult;
      try {
        allocationResult = optimizePreparedSnapshot(prepared.source.policySnapshot, request);
      } catch (error) {
        return { error: `${key} B2 allocation failed: ${error instanceof Error ? error.message : String(error)}`, status: 422 } as const;
      }
      if (allocationResult.status !== "SOLVED")
        return { error: `${key} B2 allocation did not solve: ${allocationResult.reason ?? allocationResult.status}`, status: 422 } as const;
      const allocationValues = createAllocationRow(request, prepared.source.policySnapshot, allocationResult);
      const [createdAllocation] = await db.insert(allocationsTable).values(allocationValues).returning();
      if (!createdAllocation) return { error: `${key} frozen B2 policy allocation could not be persisted.`, status: 500 } as const;
      allocation = createdAllocation;
    }
    allocations[key] = {
      id: allocation.id, fingerprint: allocation.fingerprint,
      engineVersion: allocation.engineVersion, request: allocation.frozenRequest,
      snapshotHash: allocation.frozenSnapshotHash, resultHash: fingerprint(allocation.frozenResult),
      result: allocation.frozenResult,
    };
    const validation = await persistB3ValidationRun({
      allocationId: allocation.id,
      validationPreparedInputId: prepared.input.validationPreparedInputId,
      assumptions: b3Assumptions(prepared.input),
    });
    if (!("run" in validation) || !validation.run || validation.run.status !== "success")
      return { error: `${key} evaluation B3 failed: ${"error" in validation ? validation.error :
        (validation.run as any)?.result?.reason ?? validation.run?.status ?? "missing run"}`, status: 422 } as const;
    results[key] = validation.run.result as B3Result;
    validationRuns[key] = {
      id: validation.run.validationRunId,
      inputHash: validation.run.validationInputHash,
      resultHash: fingerprint(validation.run.result),
    };
  }
  const result = createResult(results, validationRuns, allocations, {
    KEEP_ALL: requests.KEEP_ALL.candidateIds,
    GROUP_CAP: requests.GROUP_CAP.candidateIds,
    REPRESENTATIVE: requests.REPRESENTATIVE.candidateIds,
  });
  const c2Result = prepared.source.c2Result;
  const manifest: C3Manifest = {
    schemaVersion: 1,
    engineVersion: C3_ENGINE_VERSION,
    input: prepared.input,
    sourceIdentities: {
      b1PolicyId: prepared.source.baseAllocation.preparedInputId,
      b1EvaluationId: prepared.input.validationPreparedInputId,
      b2BaseId: prepared.input.allocationId,
      b2BaseFingerprint: prepared.source.baseAllocation.fingerprint,
      b1EvaluationFingerprint: prepared.source.validationPreparedFingerprint,
      c2Id: prepared.input.c2ExperimentId,
      c2ManifestHash: fingerprint(prepared.source.c2Manifest),
      c2ResultHash: fingerprint(prepared.source.c2Result),
    },
    sourceHashes: {
      policySnapshotHash: fingerprint(prepared.source.policySnapshot),
      validationSnapshotHash: fingerprint(prepared.source.validationSnapshot),
      validationPreparedFingerprint: prepared.source.validationPreparedFingerprint,
      dependenceHash: fingerprint(c2Result.dependence),
      stabilityHash: fingerprint(c2Result.stability),
      regimeHash: fingerprint(c2Result.regimes),
      contributionHash: fingerprint(c2Result.incrementalContribution),
    },
    c2Evidence: {
      dependence: structuredClone(c2Result.dependence.pairs),
      stability: structuredClone(c2Result.stability.alphas),
      regimes: structuredClone(c2Result.regimes),
      incrementalContribution: structuredClone(c2Result.incrementalContribution),
    },
    selection: structuredClone(prepared.selection),
    policyRequests: structuredClone(requests),
    allocations,
    validationRuns,
    result,
  };
  const manifestHash = fingerprint(manifest);
  const inputHash = fingerprint({
    engineVersion: C3_ENGINE_VERSION, manifestHash,
    allocationId: prepared.input.allocationId,
    validationPreparedInputId: prepared.input.validationPreparedInputId,
    c2ExperimentId: prepared.input.c2ExperimentId,
  });
  const inserted = await db.insert(c3).values({
    allocationId: prepared.input.allocationId,
    validationPreparedInputId: prepared.input.validationPreparedInputId,
    c2ExperimentId: prepared.input.c2ExperimentId,
    manifestHash,
    inputHash,
    resultHash: fingerprint(result),
    manifestJson: manifest,
    resultJson: result,
    childValidationRunIds: Object.values(validationRuns).map((run) => run.id),
  }).returning();
  const saved = (inserted as any[])[0];
  if (!saved) return { error: "C3 immutable comparison could not be persisted.", status: 500 } as const;
  return { experiment: response(saved) } as const;
}

function response(row: any) {
  return {
    id: row.id, allocationId: row.allocationId,
    validationPreparedInputId: row.validationPreparedInputId,
    c2ExperimentId: row.c2ExperimentId,
    manifestHash: row.manifestHash, inputHash: row.inputHash, resultHash: row.resultHash,
    manifest: row.manifestJson, result: row.resultJson,
    childValidationRunIds: row.childValidationRunIds,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export async function persistC3Experiment(raw: C3Input) {
  const prepared = await preparePlan(raw, true);
  if ("error" in prepared) return prepared;
  try {
    return await runPolicies(prepared);
  } catch (error) {
    return { error: `C3 comparison failed: ${error instanceof Error ? error.message : String(error)}`, status: 500 } as const;
  }
}

export async function listC3Experiments() {
  const table = await c3Table();
  const rows = await db.select().from(table).orderBy(desc(table.createdAt), desc(table.id));
  return rows.map(response);
}

export async function getC3Experiment(id: number) {
  const table = await c3Table();
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return row ? response(row) : null;
}

function resultDifferences(saved: unknown, replayed: unknown) {
  const differences: string[] = [];
  let maximumNumericDifference = 0;
  const visit = (left: any, right: any, path: string) => {
    if (typeof left === "number" || typeof right === "number") {
      if (!finite(left) || !finite(right)) differences.push(`${path}: non-finite or type mismatch`);
      else {
        const delta = Math.abs(left - right);
        maximumNumericDifference = Math.max(maximumNumericDifference, delta);
        if (delta > REPLAY_TOLERANCE) differences.push(`${path}: saved=${left}, replayed=${right}, difference=${delta}`);
      }
    } else if (Object.is(left, right)) return;
    else if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) differences.push(`${path}.length differs`);
      for (let index = 0; index < Math.min(left.length, right.length); index++)
        visit(left[index], right[index], `${path}[${index}]`);
    } else if (isRecord(left) && isRecord(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        if (!(key in left) || !(key in right)) differences.push(`${path}.${key}: key presence differs`);
        else visit(left[key], right[key], `${path}.${key}`);
    } else differences.push(`${path}: saved/replayed values differ`);
  };
  visit(saved, replayed, "result");
  return { differences, maximumNumericDifference };
}

async function replayFrozenC3(row: any) {
  const manifest = row.manifestJson as C3Manifest;
  const differences: string[] = [];
  if (!isRecord(manifest) || !isRecord(row.resultJson))
    return { experimentId: row.id, status: "fail" as const, differences: ["C3 frozen manifest/result is invalid."], maximumNumericDifference: 0 };
  const manifestHash = fingerprint(manifest);
  if (manifestHash !== row.manifestHash ||
      fingerprint({
        engineVersion: manifest.engineVersion, manifestHash,
        allocationId: row.allocationId, validationPreparedInputId: row.validationPreparedInputId,
        c2ExperimentId: row.c2ExperimentId,
      }) !== row.inputHash ||
      fingerprint(row.resultJson) !== row.resultHash ||
      fingerprint(manifest.result) !== row.resultHash)
    differences.push("C3 persisted manifest, input, or result fingerprint mismatch.");
  if (manifest.engineVersion !== C3_ENGINE_VERSION)
    differences.push(`C3 engine version mismatch: saved=${manifest.engineVersion}, current=${C3_ENGINE_VERSION}`);
  if (manifest.input?.allocationId !== row.allocationId ||
      manifest.input?.validationPreparedInputId !== row.validationPreparedInputId ||
      manifest.input?.c2ExperimentId !== row.c2ExperimentId)
    differences.push("C3 row source identities differ from the frozen manifest input.");
  const [c2] = await db.select().from(c2ExperimentsTable)
    .where(eq(c2ExperimentsTable.id, row.c2ExperimentId)).limit(1);
  const [evaluationInput] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, row.validationPreparedInputId)).limit(1);
  const [baseAllocation] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, manifest.sourceIdentities?.b2BaseId as number)).limit(1);
  if (!c2 || c2.manifestHash !== manifest.sourceIdentities?.c2ManifestHash ||
      fingerprint(c2.manifestJson) !== manifest.sourceIdentities?.c2ManifestHash)
    differences.push("Frozen source C2 identity/manifest hash is missing or changed.");
  else if (c2.resultHash !== manifest.sourceIdentities?.c2ResultHash ||
      fingerprint(c2.resultJson) !== manifest.sourceIdentities?.c2ResultHash)
    differences.push("Frozen source C2 result hash is missing or changed.");
  if (c2) {
    const c2Result = c2.resultJson as any;
    if (fingerprint(c2Result?.dependence) !== manifest.sourceHashes?.dependenceHash ||
        fingerprint(c2Result?.stability) !== manifest.sourceHashes?.stabilityHash ||
        fingerprint(c2Result?.regimes) !== manifest.sourceHashes?.regimeHash ||
        fingerprint(c2Result?.incrementalContribution) !== manifest.sourceHashes?.contributionHash ||
        fingerprint(c2Result?.dependence?.pairs) !== fingerprint(manifest.c2Evidence?.dependence) ||
        fingerprint(c2Result?.stability?.alphas) !== fingerprint(manifest.c2Evidence?.stability) ||
        fingerprint(c2Result?.regimes) !== fingerprint(manifest.c2Evidence?.regimes) ||
        fingerprint(c2Result?.incrementalContribution) !== fingerprint(manifest.c2Evidence?.incrementalContribution))
      differences.push("Frozen C3 C2 development evidence/source hashes do not match the selected C2 source row.");
  }
  if (!evaluationInput ||
      evaluationInput.fingerprint !== manifest.sourceIdentities?.b1EvaluationFingerprint ||
      evaluationInput.fingerprint !== manifest.sourceHashes?.validationPreparedFingerprint)
    differences.push("Frozen evaluation B1 identity/fingerprint is missing or changed.");
  if (!baseAllocation || baseAllocation.fingerprint !== manifest.sourceIdentities?.b2BaseFingerprint ||
      baseAllocation.preparedInputId !== manifest.sourceIdentities?.b1PolicyId ||
      allocationFingerprint(baseAllocation) !== baseAllocation.fingerprint)
    differences.push("Frozen base B2 identity/fingerprint is missing or changed.");
  const c2Replay = await replayC2Experiment(row.c2ExperimentId);
  if (!c2Replay || c2Replay.status !== "pass")
    differences.push(`Frozen source C2 integrity replay failed: ${c2Replay?.differences?.join("; ") ?? "not found"}`);

  const keys: PolicyKey[] = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"];
  const selection = manifest.selection as any;
  const selectedIds = new Set<string>();
  let selectionValid = isRecord(selection) && Array.isArray(selection.groups) &&
    Array.isArray(selection.standaloneIds);
  if (selectionValid) {
    for (const group of selection.groups) {
      if (!isRecord(group) || typeof group.id !== "string" ||
          !Array.isArray(group.memberIds) || group.memberIds.length < 2 ||
          !group.memberIds.includes(group.representativeId)) {
        selectionValid = false;
        continue;
      }
      for (const id of group.memberIds) {
        if (typeof id !== "string" || selectedIds.has(id)) selectionValid = false;
        selectedIds.add(id);
      }
      if (manifest.input.manualOverrides[group.id] &&
          manifest.input.manualOverrides[group.id] !== group.representativeId)
        selectionValid = false;
    }
    for (const id of selection.standaloneIds) {
      if (typeof id !== "string" || selectedIds.has(id)) selectionValid = false;
      selectedIds.add(id);
    }
    if (canonicalJson([...selectedIds].sort()) !== canonicalJson([...manifest.input.alphaIds].sort()))
      selectionValid = false;
  }
  if (!selectionValid)
    differences.push("Frozen C3 selection is structurally invalid or does not partition its alpha universe.");
  if (selectionValid && c2) {
    const c2Pairs = new Map<string, any>(
      ((manifest.c2Evidence?.dependence ?? []) as any[])
        .map((pair) => [JSON.stringify([pair.alphaA, pair.alphaB].sort()), pair]),
    );
    for (const group of selection.groups) for (const evidence of group.evidence ?? []) {
      const sourcePair = c2Pairs.get(JSON.stringify([evidence.alphaA, evidence.alphaB].sort()));
      if (!sourcePair || evidence.fullSampleCorrelation !== sourcePair.fullSample?.correlation ||
          evidence.pairedObservations !== sourcePair.fullSample?.pairedObservations ||
          evidence.flag !== (sourcePair.flag ?? null)) {
        differences.push(`Frozen selection evidence for ${evidence.alphaA}/${evidence.alphaB} is not present in frozen C2 evidence.`);
        break;
      }
    }
  }
  if (baseAllocation && selectionValid) {
    try {
      const reconstructedRequests = buildC3PolicyRequests(
        baseAllocation.frozenRequest as AllocationRequest,
        manifest.input.alphaIds,
        selection,
        manifest.input.groupCaps ?? {},
      );
      if (fingerprint(reconstructedRequests) !== fingerprint(manifest.policyRequests))
        differences.push("Frozen B2 policy definitions do not match the frozen C3 selection.");
    } catch (error) {
      differences.push(`Frozen C3 selection cannot reconstruct its B2 policy definitions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const maximumExpectedChildIds = keys.map((key) => manifest.validationRuns?.[key]?.id);
  if (!Array.isArray(row.childValidationRunIds) ||
      canonicalJson(row.childValidationRunIds) !== canonicalJson(maximumExpectedChildIds))
    differences.push("Persisted C3 childValidationRunIds do not match the frozen B3 child identities.");

  const runs: Record<PolicyKey, B3Result> = {} as Record<PolicyKey, B3Result>;
  let maximumNumericDifference = 0;
  for (const key of keys) {
    const allocationId = manifest.allocations?.[key]?.id as number;
    const runIdentity = manifest.validationRuns?.[key];
    const [allocation] = await db.select().from(allocationsTable)
      .where(eq(allocationsTable.id, allocationId)).limit(1);
    const [run] = await db.select().from(validationRunsTable)
      .where(eq(validationRunsTable.id, runIdentity?.id)).limit(1);
    const envelope = run?.resultJson as any;
    if (!allocation || !run || run.allocationId !== allocationId ||
        run.validationPreparedInputId !== row.validationPreparedInputId ||
        run.reconciliationStatus !== "pass" || run.reproducibilityStatus !== "pass" ||
        envelope?.result?.status !== "completed" ||
        fingerprint(envelope?.policySnapshot) !== manifest.sourceHashes?.policySnapshotHash ||
        fingerprint(envelope?.validationSnapshot) !== manifest.sourceHashes?.validationSnapshotHash ||
        fingerprint(envelope?.assumptions) !== fingerprint(manifest.input.assumptions) ||
        allocationFingerprint(allocation) !== allocation.fingerprint ||
        allocation.fingerprint !== manifest.allocations[key].fingerprint ||
        fingerprint(allocation.frozenSnapshot) !== manifest.sourceHashes?.policySnapshotHash ||
        fingerprint(allocation.frozenSnapshot) !== manifest.allocations[key].snapshotHash ||
        fingerprint(allocation.frozenResult) !== manifest.allocations[key].resultHash ||
        allocation.engineVersion !== manifest.allocations[key].engineVersion ||
        fingerprint(allocation.frozenRequest) !== fingerprint(manifest.policyRequests[key]) ||
        fingerprint(envelope?.result) !== runIdentity.resultHash ||
        run.validationInputHash !== runIdentity.inputHash) {
      differences.push(`${key} frozen B2 allocation or B3 child identity/fingerprint is missing or inconsistent.`);
      continue;
    }
    const allocationResult = optimizePreparedSnapshot(
      allocation.frozenSnapshot as PreparedSnapshot,
      allocation.frozenRequest as AllocationRequest,
    );
    const allocationComparison = resultDifferences(allocation.frozenResult, allocationResult);
    maximumNumericDifference = Math.max(maximumNumericDifference, allocationComparison.maximumNumericDifference);
    differences.push(...allocationComparison.differences.map((item) => `${key} B2: ${item}`));
    const childReplay = await replayB3ValidationRun(run.id);
    if (!childReplay || childReplay.status !== "pass")
      differences.push(`${key} B3 Validation Run ${run.id} replay failed: ${childReplay?.differences?.join("; ") ?? "not found"}`);
    runs[key] = envelope.result as B3Result;
  }
  if (keys.every((key) => runs[key])) {
    const regenerated = createResult(
      runs, manifest.validationRuns, manifest.allocations,
      Object.fromEntries(keys.map((key) => [key, manifest.policyRequests[key].candidateIds])) as Record<PolicyKey, string[]>,
    );
    const comparison = resultDifferences(manifest.result, regenerated);
    maximumNumericDifference = Math.max(maximumNumericDifference, comparison.maximumNumericDifference);
    differences.push(...comparison.differences);
    const savedVersusRow = resultDifferences(row.resultJson, manifest.result);
    maximumNumericDifference = Math.max(maximumNumericDifference, savedVersusRow.maximumNumericDifference);
    differences.push(...savedVersusRow.differences.map((item) => `frozen result: ${item}`));
    return {
      experimentId: row.id, status: differences.length ? "fail" as const : "pass" as const,
      differences, maximumNumericDifference,
    };
  }
  return { experimentId: row.id, status: "fail" as const, differences, maximumNumericDifference };
}

export async function replayC3Experiment(id: number) {
  const table = await c3Table();
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return row ? replayFrozenC3(row) : null;
}