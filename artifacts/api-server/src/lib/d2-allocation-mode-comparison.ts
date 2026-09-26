import { desc, eq, inArray } from "drizzle-orm";
import {
  allocationsTable, db, d2AllocationModeComparisonsTable, validationRunsTable,
} from "@workspace/db";
import {
  optimizePreparedSnapshot, type AllocationRequest, type AllocationResult,
} from "./allocation-b2";
import { replayB3ValidationRun } from "./b3-validation-store";
import { canonicalJson, fingerprint } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";

const ENGINE_VERSION = "d2-allocation-mode-comparison.1";
const TOLERANCE = 1e-8;
type Mode = "CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY";
type ComparisonIds = { allocationIds: Record<Mode, number>; validationRunIds: Record<Mode, number> };
type Source = {
  mode: Mode;
  allocation: typeof allocationsTable.$inferSelect;
  validationRun: typeof validationRunsTable.$inferSelect;
  b3Envelope: Record<string, any>;
  allocationResult: AllocationResult;
};

export class D2AllocationModeComparisonError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function comparableInstant(value: unknown) {
  if (typeof value !== "string") return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}
function compareValues(left: unknown, right: unknown, path = "$", differences: string[] = []): string[] {
  if (typeof left === "number" && typeof right === "number") {
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > TOLERANCE)
      differences.push(`${path}: numeric difference exceeds ${TOLERANCE}`);
    return differences;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      differences.push(`${path}: array shape differs`);
      return differences;
    }
    left.forEach((item, index) => compareValues(item, right[index], `${path}[${index}]`, differences));
    return differences;
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      differences.push(`${path}: value shape differs`);
      return differences;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!(key in left) || !(key in right)) differences.push(`${path}.${key}: key differs`);
      else compareValues(left[key], right[key], `${path}.${key}`, differences);
    }
    return differences;
  }
  if (left !== right) differences.push(`${path}: value differs`);
  return differences;
}
function numericMaximumDifference(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number")
    return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) : 0;
  if (Array.isArray(left) && Array.isArray(right))
    return Math.max(0, ...left.map((value, index) => numericMaximumDifference(value, right[index])));
  if (isRecord(left) && isRecord(right))
    return Math.max(0, ...Object.keys(left).filter((key) => key in right)
      .map((key) => numericMaximumDifference(left[key], right[key])));
  return 0;
}
function modeOf(request: unknown): Mode | null {
  if (!isRecord(request)) return null;
  const mode = request.allocationMode ?? "CAPITAL_LONG_ONLY";
  return mode === "CAPITAL_LONG_ONLY" || mode === "SIGNED_OVERLAY" ? mode : null;
}
function riskMethodology(request: Record<string, any>) {
  const model = isRecord(request.riskModel) ? request.riskModel : null;
  const delta = request.covarianceDiagonalShrinkage;
  const type = model?.type ?? (finite(delta) && delta === 0 ? "SAMPLE" :
    finite(delta) && delta > 0 && delta <= 1 ? "DIAGONAL_SHRINKAGE" : null);
  if (type === "SAMPLE") return { type };
  if (type === "DIAGONAL_SHRINKAGE" && finite(delta) && delta >= 0 && delta <= 1)
    return { type, covarianceDiagonalShrinkage: delta };
  if (type === "STATISTICAL_FACTOR" && model)
    return {
      type,
      factorCount: model.factorCount ?? null,
      specificRiskFloorFraction: model.specificRiskFloorFraction ?? 1e-6,
    };
  return null;
}
function b3EnvelopeHash(row: typeof validationRunsTable.$inferSelect, envelope: Record<string, any>): string {
  const base = {
    allocationId: row.allocationId,
    validationPreparedInputId: row.validationPreparedInputId,
    policySnapshot: envelope.policySnapshot,
    policyRequest: envelope.policyRequest,
    validationSnapshot: envelope.validationSnapshot,
    assumptions: envelope.assumptions,
    engineVersion: row.engineVersion,
    result: envelope.result,
  };
  return fingerprint(envelope.estimationDatePlan === undefined
    ? base : { ...base, estimationDatePlan: envelope.estimationDatePlan });
}
function assertValidAllocation(row: typeof allocationsTable.$inferSelect): AllocationResult {
  const request = row.frozenRequest;
  const snapshot = row.frozenSnapshot;
  const result = row.frozenResult;
  if (!isRecord(request) || !isRecord(snapshot) || !isRecord(result) ||
      row.representation !== "alpha_streams" || request.representation !== "alpha_streams" ||
      result.status !== "SOLVED" || !Array.isArray(request.candidateIds) ||
      request.candidateIds.length < 1 || !request.candidateIds.every((id: unknown) => typeof id === "string"))
    throw new D2AllocationModeComparisonError(`Allocation #${row.id} is not a solved alpha-stream B2 run.`);
  if (fingerprint(snapshot) !== row.frozenSnapshotHash ||
      fingerprint({
        preparedInputId: row.preparedInputId, representation: row.representation,
        engineVersion: row.engineVersion, request: row.frozenRequest,
        snapshotHash: row.frozenSnapshotHash, result: row.frozenResult,
      }) !== row.fingerprint)
    throw new D2AllocationModeComparisonError(`Allocation #${row.id} failed frozen snapshot/fingerprint integrity checks.`);
  if (!isRecord(snapshot.dataset) || typeof snapshot.dataset.csvContent !== "string" ||
      hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256)
    throw new D2AllocationModeComparisonError(`Allocation #${row.id} frozen dataset hash is invalid.`);
  if (!modeOf(request))
    throw new D2AllocationModeComparisonError(`Allocation #${row.id} has no supported allocation-mode identity.`);
  return result as unknown as AllocationResult;
}
function assertValidB3(row: typeof validationRunsTable.$inferSelect, allocation: typeof allocationsTable.$inferSelect) {
  const envelope = row.resultJson;
  if (row.allocationId !== allocation.id || row.validationPreparedInputId === null ||
      !isRecord(envelope) || envelope.kind !== "b3" || !isRecord(envelope.policyRequest) ||
      !isRecord(envelope.policySnapshot) || !isRecord(envelope.validationSnapshot) ||
      !isRecord(envelope.assumptions) || !isRecord(envelope.result) ||
      envelope.result.status !== "completed")
    throw new D2AllocationModeComparisonError(
      `Validation Run #${row.id} is not a successful B3 child of Allocation #${allocation.id}.`);
  if (canonicalJson(envelope.policyRequest) !== canonicalJson(allocation.frozenRequest) ||
      fingerprint(envelope.policySnapshot) !== allocation.frozenSnapshotHash)
    throw new D2AllocationModeComparisonError(
      `Validation Run #${row.id} does not use Allocation #${allocation.id}'s exact frozen policy.`);
  const validationSnapshot = envelope.validationSnapshot;
  if (!isRecord(validationSnapshot.dataset) || typeof validationSnapshot.dataset.csvContent !== "string" ||
      hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    throw new D2AllocationModeComparisonError(`Validation Run #${row.id} frozen evaluation dataset hash is invalid.`);
  if (b3EnvelopeHash(row, envelope) !== row.validationInputHash)
    throw new D2AllocationModeComparisonError(`Validation Run #${row.id} failed frozen input/result integrity checks.`);
  return envelope;
}

export function validateMatchingSources(sources: Source[]): void {
  if (sources.length !== 2 || new Set(sources.map((source) => source.mode)).size !== 2 ||
      !sources.some((source) => source.mode === "CAPITAL_LONG_ONLY") ||
      !sources.some((source) => source.mode === "SIGNED_OVERLAY"))
    throw new D2AllocationModeComparisonError(
      "D2 comparison requires exactly one CAPITAL_LONG_ONLY run and one SIGNED_OVERLAY run.", 400);
  const capital = sources.find((source) => source.mode === "CAPITAL_LONG_ONLY")!;
  const overlay = sources.find((source) => source.mode === "SIGNED_OVERLAY")!;
  const a = capital.allocation.frozenRequest as unknown as Record<string, any>;
  const b = overlay.allocation.frozenRequest as unknown as Record<string, any>;
  const ar = capital.allocationResult, br = overlay.allocationResult;
  const aSnapshot = capital.allocation.frozenSnapshot as Record<string, any>;
  const bSnapshot = overlay.allocation.frozenSnapshot as Record<string, any>;
  const sameUniverse = canonicalJson([...a.candidateIds].sort()) === canonicalJson([...b.candidateIds].sort());
  const sameData = aSnapshot.dataset?.sha256 === bSnapshot.dataset?.sha256;
  const sameDates = comparableInstant(a.informationCutoff) === comparableInstant(b.informationCutoff) &&
    comparableInstant(a.decisionTimestamp) === comparableInstant(b.decisionTimestamp) &&
    a.estimationWindow === b.estimationWindow &&
    a.minObservations === b.minObservations &&
    canonicalJson(ar.model?.dates ?? []) === canonicalJson(br.model?.dates ?? []);
  // The two modes transform returns differently (gross capital returns vs cash-relative
  // excess returns); compare estimator identity and configured shrinkage, not those series.
  const expectedReturnEstimator = (request: Record<string, any>) => ({
    returnConvention: request.returnConvention ?? "daily_decimal",
    shrinkage: request.expectedReturnShrinkage,
    cashYield: request.dailyCashYield,
    window: request.estimationWindow,
    minimumObservations: request.minObservations,
  });
  const sameEstimator = canonicalJson(expectedReturnEstimator(a)) === canonicalJson(expectedReturnEstimator(b));
  const riskA = riskMethodology(a), riskB = riskMethodology(b);
  const sameRiskMethod = riskA !== null && riskB !== null && canonicalJson(riskA) === canonicalJson(riskB);
  const aB3 = capital.b3Envelope, bB3 = overlay.b3Envelope;
  const sameEvaluationData = aB3.validationSnapshot.dataset?.sha256 === bB3.validationSnapshot.dataset?.sha256;
  const sameExecutionCosts = canonicalJson(aB3.assumptions) === canonicalJson(bB3.assumptions);
  const sameEvaluationDates = aB3.assumptions.evaluationStartDate === bB3.assumptions.evaluationStartDate &&
    aB3.assumptions.evaluationEndDate === bB3.assumptions.evaluationEndDate;
  const sameB3EstimationDates = canonicalJson(aB3.estimationDatePlan ?? null) ===
    canonicalJson(bB3.estimationDatePlan ?? null);
  if (!sameUniverse || !sameData || !sameDates || !sameEstimator || !sameRiskMethod ||
      !sameEvaluationData || !sameExecutionCosts || !sameEvaluationDates || !sameB3EstimationDates)
    throw new D2AllocationModeComparisonError(
      "D2 comparison rejected: sources must share alpha universe, frozen B1 data, estimation and evaluation dates, expected-return estimator settings, risk-model methodology where applicable, and B3 execution/cost assumptions. Objective and constraints may differ and are disclosed as non-controlled.", 400);
}

function objectiveSemantics(source: Source) {
  const request = source.allocation.frozenRequest as unknown as Record<string, any>;
  return {
    objective: request.objective,
    constraints: source.mode === "SIGNED_OVERLAY"
      ? { signedConstraints: request.signedConstraints ?? null, legacyConstraints: request.constraints ?? null }
      : { capitalConstraints: request.constraints ?? null },
  };
}
function buildResult(sources: Source[]) {
  const modes = {} as Record<Mode, Record<string, any>>;
  sources.forEach((source) => {
    const request = source.allocation.frozenRequest as unknown as Record<string, any>;
    const result = source.allocationResult;
    const b3 = source.b3Envelope.result;
    const ledger = Array.isArray(b3.dailyLedger) ? b3.dailyLedger : [];
    const turnover = ledger.reduce((sum: number, entry: any) =>
      sum + (finite(entry.externalTradedNotional) ? entry.externalTradedNotional : 0), 0);
    modes[source.mode] = {
      allocationId: source.allocation.id,
      validationRunId: source.validationRun.id,
      allocationMode: source.mode,
      coefficientMeaning: source.mode === "SIGNED_OVERLAY"
        ? "Signed active-exposure coefficients; not capital shares."
        : "Nonnegative capital fractions.",
      candidateIds: [...request.candidateIds],
      coefficientsOrCapitalFractions: result.candidateWeights,
      underlyingAssetWeights: result.assetWeights,
      masterCash: result.masterCash,
      totalCash: result.totalCash,
      exposures: result.signedOverlay ?? null,
      expectedDailyVolatility: result.estimatedVolatility,
      estimatedReturn: result.estimatedGrossReturn,
      realizedMetrics: b3.metrics,
      realizedTurnover: turnover,
      b3Status: b3.status,
      maximumReconciliationDifference: b3.diagnostics?.maximumReconciliationDifference ?? null,
      objectiveAndConstraints: objectiveSemantics(source),
    };
  });
  return {
    engineVersion: ENGINE_VERSION,
    comparisonClassification: "NON_CONTROLLED_ECONOMIC_COMPARISON",
    modes,
    semanticDifferences: {
      allocationStructure: "CAPITAL_LONG_ONLY coefficients are nonnegative capital fractions; SIGNED_OVERLAY coefficients are signed active exposures, not cash allocations.",
      returnConvention: "Capital mode optimizes capital-stream returns; signed mode estimates and optimizes cash-relative alpha excess returns. Matching estimator configuration does not make these return series economically identical.",
      objectiveAndConstraints: {
        capitalLongOnly: modes.CAPITAL_LONG_ONLY.objectiveAndConstraints,
        signedOverlay: modes.SIGNED_OVERLAY.objectiveAndConstraints,
      },
      interpretation: "Objectives, feasible sets, coefficient meanings, and resulting capital structures can differ. Results are descriptive; this comparison is not controlled and does not declare a winner.",
    },
    methodology: "Saved comparison of frozen B2/B3 runs after matching universe, data, dates, estimator settings, applicable risk methodology, and execution/cost assumptions. The modes remain economically different; no winner is selected.",
  };
}

async function loadSources(ids: ComparisonIds): Promise<Source[]> {
  const modes: Mode[] = ["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"];
  if (!ids || !isRecord(ids.allocationIds) || !isRecord(ids.validationRunIds) ||
      modes.some((mode) => !Number.isSafeInteger(ids.allocationIds[mode]) || ids.allocationIds[mode] < 1 ||
        !Number.isSafeInteger(ids.validationRunIds[mode]) || ids.validationRunIds[mode] < 1) ||
      new Set(modes.map((mode) => ids.allocationIds[mode])).size !== 2 ||
      new Set(modes.map((mode) => ids.validationRunIds[mode])).size !== 2)
    throw new D2AllocationModeComparisonError(
      "Provide distinct positive allocation and B3 validation run IDs for CAPITAL_LONG_ONLY and SIGNED_OVERLAY.", 400);
  const allocationRows = await db.select().from(allocationsTable)
    .where(inArray(allocationsTable.id, modes.map((mode) => ids.allocationIds[mode])));
  const validationRows = await db.select().from(validationRunsTable)
    .where(inArray(validationRunsTable.id, modes.map((mode) => ids.validationRunIds[mode])));
  if (allocationRows.length !== 2 || validationRows.length !== 2)
    throw new D2AllocationModeComparisonError("One or more saved B2 allocation or B3 validation runs were not found.", 404);
  const allocationsById = new Map(allocationRows.map((row) => [row.id, row]));
  const validationsById = new Map(validationRows.map((row) => [row.id, row]));
  return modes.map((mode) => {
    const allocation = allocationsById.get(ids.allocationIds[mode]);
    const validationRun = validationsById.get(ids.validationRunIds[mode]);
    if (!allocation || !validationRun) throw new D2AllocationModeComparisonError("A requested child run was not found.", 404);
    const allocationResult = assertValidAllocation(allocation);
    if (modeOf(allocation.frozenRequest) !== mode)
      throw new D2AllocationModeComparisonError(
        `Allocation #${allocation.id} is not a ${mode} run.`, 400);
    const b3Envelope = assertValidB3(validationRun, allocation);
    return { mode, allocation, validationRun, b3Envelope, allocationResult };
  });
}
function makeManifest(sources: Source[]) {
  return {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    sourceIdentities: Object.fromEntries(sources.map((source) => [source.mode, {
      allocationId: source.allocation.id,
      allocationFingerprint: source.allocation.fingerprint,
      validationRunId: source.validationRun.id,
      validationInputHash: source.validationRun.validationInputHash,
      validationResultHash: fingerprint(source.b3Envelope.result),
    }])),
    sourceHashes: Object.fromEntries(sources.map((source) => [source.mode, {
      allocationSnapshotHash: source.allocation.frozenSnapshotHash,
      b2ResultHash: fingerprint(source.allocation.frozenResult),
      validationSnapshotHash: fingerprint(source.b3Envelope.validationSnapshot),
      assumptionsHash: fingerprint(source.b3Envelope.assumptions),
    }])),
    frozenSources: Object.fromEntries(sources.map((source) => [source.mode, {
      request: source.allocation.frozenRequest,
      snapshot: source.allocation.frozenSnapshot,
      result: source.allocation.frozenResult,
      b3PolicySnapshot: source.b3Envelope.policySnapshot,
      b3ValidationSnapshot: source.b3Envelope.validationSnapshot,
      b3Assumptions: source.b3Envelope.assumptions,
      estimationDatePlan: source.b3Envelope.estimationDatePlan ?? null,
      b3Result: source.b3Envelope.result,
      b2EngineVersion: source.allocation.engineVersion,
      b3EngineVersion: source.validationRun.engineVersion,
    }])),
    classification: "NON_CONTROLLED_ECONOMIC_COMPARISON",
  };
}
function response(row: typeof d2AllocationModeComparisonsTable.$inferSelect) {
  return {
    id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    manifest: row.manifestJson, result: row.resultJson, createdAt: row.createdAt.toISOString(),
  };
}
export async function persistD2AllocationModeComparison(ids: ComparisonIds) {
  const sources = await loadSources(ids);
  validateMatchingSources(sources);
  for (const source of sources) {
    const allocationReplay = optimizePreparedSnapshot(
      source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
      source.allocation.frozenRequest as AllocationRequest,
    );
    const differences = compareValues(source.allocation.frozenResult, allocationReplay);
    if (differences.length)
      throw new D2AllocationModeComparisonError(
        `Allocation #${source.allocation.id} does not replay from its frozen request: ${differences.slice(0, 3).join("; ")}`);
    const b3Replay = await replayB3ValidationRun(source.validationRun.id);
    if (!b3Replay || b3Replay.status !== "pass")
      throw new D2AllocationModeComparisonError(
        `B3 Validation Run #${source.validationRun.id} failed frozen replay: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`);
  }
  const manifestJson = makeManifest(sources);
  const resultJson = buildResult(sources);
  const [row] = await db.insert(d2AllocationModeComparisonsTable).values({
    capitalLongOnlyAllocationId: ids.allocationIds.CAPITAL_LONG_ONLY,
    capitalLongOnlyValidationRunId: ids.validationRunIds.CAPITAL_LONG_ONLY,
    signedOverlayAllocationId: ids.allocationIds.SIGNED_OVERLAY,
    signedOverlayValidationRunId: ids.validationRunIds.SIGNED_OVERLAY,
    manifestHash: fingerprint(manifestJson),
    resultHash: fingerprint(resultJson),
    manifestJson,
    resultJson,
  }).returning();
  return response(row);
}
export async function listD2AllocationModeComparisons() {
  const rows = await db.select().from(d2AllocationModeComparisonsTable)
    .orderBy(desc(d2AllocationModeComparisonsTable.id));
  return rows.map((row) => ({
    id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    createdAt: row.createdAt.toISOString(),
  }));
}
export async function getD2AllocationModeComparison(id: number) {
  const [row] = await db.select().from(d2AllocationModeComparisonsTable)
    .where(eq(d2AllocationModeComparisonsTable.id, id)).limit(1);
  return row ? response(row) : null;
}
export async function replayD2AllocationModeComparison(id: number) {
  const [row] = await db.select().from(d2AllocationModeComparisonsTable)
    .where(eq(d2AllocationModeComparisonsTable.id, id)).limit(1);
  if (!row) return null;
  const differences: string[] = [];
  if (fingerprint(row.manifestJson) !== row.manifestHash) differences.push("Frozen comparison manifest hash mismatch.");
  if (fingerprint(row.resultJson) !== row.resultHash) differences.push("Frozen comparison result hash mismatch.");
  if (differences.length) return {
    comparisonId: id, status: "fail" as const, differences,
    maximumNumericDifference: 0, result: {},
  };
  try {
    const ids: ComparisonIds = {
      allocationIds: {
        CAPITAL_LONG_ONLY: row.capitalLongOnlyAllocationId,
        SIGNED_OVERLAY: row.signedOverlayAllocationId,
      },
      validationRunIds: {
        CAPITAL_LONG_ONLY: row.capitalLongOnlyValidationRunId,
        SIGNED_OVERLAY: row.signedOverlayValidationRunId,
      },
    };
    const sources = await loadSources(ids);
    validateMatchingSources(sources);
    const manifest = makeManifest(sources);
    differences.push(...compareValues(row.manifestJson, manifest, "manifest"));
    let maximumNumericDifference = 0;
    for (const source of sources) {
      const allocationReplay = optimizePreparedSnapshot(
        source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
        source.allocation.frozenRequest as AllocationRequest,
      );
      differences.push(...compareValues(source.allocation.frozenResult, allocationReplay,
        `allocation[${source.allocation.id}]`));
      maximumNumericDifference = Math.max(maximumNumericDifference,
        numericMaximumDifference(source.allocation.frozenResult, allocationReplay));
      const b3Replay = await replayB3ValidationRun(source.validationRun.id);
      if (!b3Replay || b3Replay.status !== "pass")
        differences.push(`B3 Validation Run #${source.validationRun.id} replay failed: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`);
      else
        maximumNumericDifference = Math.max(maximumNumericDifference,
          numericMaximumDifference(source.b3Envelope.result, b3Replay.replayedResult));
    }
    const result = buildResult(sources);
    maximumNumericDifference = Math.max(maximumNumericDifference,
      numericMaximumDifference(row.resultJson, result));
    differences.push(...compareValues(row.resultJson, result, "comparisonResult"));
    if (maximumNumericDifference > TOLERANCE)
      differences.push("Replayed result numeric difference exceeds tolerance.");
    return {
      comparisonId: id, status: differences.length ? "fail" as const : "pass" as const,
      differences: [...new Set(differences)], maximumNumericDifference, result,
    };
  } catch (error) {
    differences.push(error instanceof Error ? error.message : "Frozen D2 allocation-mode comparison replay failed.");
    return { comparisonId: id, status: "fail" as const, differences,
      maximumNumericDifference: 0, result: {} };
  }
}