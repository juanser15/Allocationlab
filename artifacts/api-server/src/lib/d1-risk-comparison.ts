import { desc, eq, inArray } from "drizzle-orm";
import {
  allocationsTable, db, d1RiskComparisonsTable, validationRunsTable,
} from "@workspace/db";
import { optimizePreparedSnapshot, type AllocationRequest, type AllocationResult } from "./allocation-b2";
import { replayB3ValidationRun } from "./b3-validation-store";
import { canonicalJson, fingerprint } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";

const COMPARISON_ENGINE = "d1-controlled-risk-comparison.1";
const TOLERANCE = 1e-8;
const RISK_TYPES = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"] as const;
type RiskType = typeof RISK_TYPES[number];
type Slot = "SAMPLE" | "DIAGONAL_SHRINKAGE" | "STATISTICAL_FACTOR";
type ComparisonIds = { allocationIds: Record<Slot, number>; validationRunIds: Record<Slot, number> };
type Source = {
  slot: Slot;
  allocation: typeof allocationsTable.$inferSelect;
  validationRun: typeof validationRunsTable.$inferSelect;
  b3Envelope: Record<string, any>;
  riskType: RiskType;
  allocationResult: AllocationResult;
};
export class D1RiskComparisonError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function riskTypeFromRequest(request: unknown): RiskType | null {
  if (!isRecord(request)) return null;
  const configuration = isRecord(request.riskModel) ? request.riskModel : null;
  if (configuration) {
    if (configuration.type === "SAMPLE" || configuration.type === "SAMPLE_COVARIANCE")
      return "SAMPLE";
    if (configuration.type === "DIAGONAL_SHRINKAGE") return "DIAGONAL_SHRINKAGE";
    if (configuration.type === "STATISTICAL_FACTOR" || configuration.type === "STATISTICAL_FACTOR_MODEL")
      return "STATISTICAL_FACTOR";
    return null;
  }
  // Historical B2 snapshots predate the explicit selector. They only identify
  // sample vs diagonal shrinkage via delta; absence can never mean factor model.
  if (!finite(request.covarianceDiagonalShrinkage) ||
      request.covarianceDiagonalShrinkage < 0 || request.covarianceDiagonalShrinkage > 1) return null;
  return request.covarianceDiagonalShrinkage === 0 ? "SAMPLE" : "DIAGONAL_SHRINKAGE";
}
function economicRequest(request: Record<string, any>) {
  const { covarianceDiagonalShrinkage: _delta, riskModel: _riskModel, candidateIds: _candidateIds, ...economic } = request;
  // The B2 form submits datetime-local as ISO; older API-created policies used a
  // date-only UTC timestamp. Both denote the same decision instant.
  const instant = Date.parse(economic.decisionTimestamp);
  return {
    ...economic,
    constraints: economicConstraints(economic.constraints),
    decisionTimestamp: Number.isFinite(instant)
      ? new Date(instant).toISOString() : economic.decisionTimestamp,
  };
}
function economicConstraints(value: unknown) {
  if (!isRecord(value)) return value;
  const constraints = { ...value };
  for (const key of ["candidateBounds", "assetBounds", "groupCaps", "unsupported"]) {
    const item = constraints[key];
    if ((Array.isArray(item) && item.length === 0) ||
        (isRecord(item) && Object.keys(item).length === 0))
      delete constraints[key];
  }
  return constraints;
}
function halfL1(left: unknown, right: unknown): number {
  const l = isRecord(left) ? left : {}, r = isRecord(right) ? right : {};
  const ids = new Set([...Object.keys(l), ...Object.keys(r)]);
  return 0.5 * [...ids].reduce((sum, id) =>
    sum + Math.abs((finite(l[id]) ? l[id] : 0) - (finite(r[id]) ? r[id] : 0)), 0);
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
  const request = row.frozenRequest as AllocationRequest;
  const snapshot = row.frozenSnapshot as Record<string, any>;
  const result = row.frozenResult as AllocationResult;
  if (!isRecord(request) || !isRecord(snapshot) || !isRecord(result) ||
      row.representation !== "alpha_streams" || request.representation !== "alpha_streams" ||
      result.status !== "SOLVED" || !Array.isArray(request.candidateIds) ||
      request.candidateIds.length < 1 || !request.candidateIds.every((id: unknown) => typeof id === "string"))
    throw new D1RiskComparisonError(`Allocation #${row.id} is not a solved alpha-stream B2 run.`, 409);
  if (fingerprint(snapshot) !== row.frozenSnapshotHash ||
      fingerprint({
        preparedInputId: row.preparedInputId, representation: row.representation,
        engineVersion: row.engineVersion, request: row.frozenRequest,
        snapshotHash: row.frozenSnapshotHash, result: row.frozenResult,
      }) !== row.fingerprint)
    throw new D1RiskComparisonError(`Allocation #${row.id} failed frozen snapshot/fingerprint integrity checks.`, 409);
  if (!isRecord(snapshot.dataset) || typeof snapshot.dataset.csvContent !== "string" ||
      hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256)
    throw new D1RiskComparisonError(`Allocation #${row.id} frozen dataset hash is invalid.`, 409);
  const riskType = riskTypeFromRequest(request);
  if (!riskType)
    throw new D1RiskComparisonError(`Allocation #${row.id} has no explicit, supported risk-model identity.`, 409);
  return result;
}
function assertValidB3(row: typeof validationRunsTable.$inferSelect, allocation: typeof allocationsTable.$inferSelect) {
  const envelope = row.resultJson;
  if (row.allocationId !== allocation.id || row.validationPreparedInputId === null ||
      !isRecord(envelope) || envelope.kind !== "b3" || !isRecord(envelope.policyRequest) ||
      !isRecord(envelope.policySnapshot) || !isRecord(envelope.validationSnapshot) ||
      !isRecord(envelope.assumptions) || !isRecord(envelope.result) ||
      envelope.result.status !== "completed")
    throw new D1RiskComparisonError(`Validation Run #${row.id} is not a successful B3 child of Allocation #${allocation.id}.`, 409);
  if (canonicalJson(envelope.policyRequest) !== canonicalJson(allocation.frozenRequest) ||
      fingerprint(envelope.policySnapshot) !== allocation.frozenSnapshotHash)
    throw new D1RiskComparisonError(`Validation Run #${row.id} does not use Allocation #${allocation.id}'s exact frozen policy.`, 409);
  const validationSnapshot = envelope.validationSnapshot;
  if (!isRecord(validationSnapshot.dataset) || typeof validationSnapshot.dataset.csvContent !== "string" ||
      hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    throw new D1RiskComparisonError(`Validation Run #${row.id} frozen evaluation dataset hash is invalid.`, 409);
  if (b3EnvelopeHash(row, envelope) !== row.validationInputHash)
    throw new D1RiskComparisonError(`Validation Run #${row.id} failed frozen input/result integrity checks.`, 409);
  return envelope;
}
export function validateControlledRiskSources(sources: Source[]): void {
  if (sources.length !== 3 || new Set(sources.map((source) => source.riskType)).size !== 3 ||
      RISK_TYPES.some((type) => !sources.some((source) => source.riskType === type)))
    throw new D1RiskComparisonError("A controlled comparison requires exactly one SAMPLE, DIAGONAL_SHRINKAGE, and STATISTICAL_FACTOR run.", 400);
  const first = sources[0];
  const request = first.allocation.frozenRequest as unknown as Record<string, any>;
  const candidateIds = [...request.candidateIds].sort();
  const resultDates = (first.allocation.frozenResult as AllocationResult).model?.dates;
  const snapshotHash = first.allocation.frozenSnapshotHash;
  const validationSnapshotHash = fingerprint(first.b3Envelope.validationSnapshot);
  const assumptions = canonicalJson(first.b3Envelope.assumptions);
  const estimationPlan = canonicalJson(first.b3Envelope.estimationDatePlan ?? null);
  for (const source of sources.slice(1)) {
    const current = source.allocation.frozenRequest as unknown as Record<string, any>;
    const currentResultDates = (source.allocation.frozenResult as AllocationResult).model?.dates;
    if (canonicalJson([...current.candidateIds].sort()) !== canonicalJson(candidateIds) ||
        canonicalJson(economicRequest(current)) !== canonicalJson(economicRequest(request)) ||
        canonicalJson(economicConstraints(current.constraints)) !== canonicalJson(economicConstraints(request.constraints)) ||
        canonicalJson(currentResultDates ?? []) !== canonicalJson(resultDates ?? []) ||
        source.allocation.frozenSnapshotHash !== snapshotHash ||
        fingerprint(source.b3Envelope.validationSnapshot) !== validationSnapshotHash ||
        canonicalJson(source.b3Envelope.assumptions) !== assumptions ||
        canonicalJson(source.b3Envelope.estimationDatePlan ?? null) !== estimationPlan)
      throw new D1RiskComparisonError("Controlled comparison rejected: alpha candidates, estimation/evaluation dates, B1 inputs, expected-return assumptions, objective, constraints, execution, cost, cash, or B3 assumptions differ.", 400);
  }
}
function buildResult(sources: Source[]) {
  const models = Object.fromEntries(sources.map((source) => {
    const allocation = source.allocation;
    const allocationResult = source.allocationResult;
    const b3 = source.b3Envelope.result;
    const weights = allocationResult.candidateWeights ?? {};
    const assetWeights = allocationResult.assetWeights ?? {};
    const ledger = Array.isArray(b3.dailyLedger) ? b3.dailyLedger : [];
    const turnover = ledger.reduce((sum: number, entry: any) =>
      sum + (finite(entry.externalTradedNotional) ? entry.externalTradedNotional : 0), 0);
    return [source.riskType, {
      allocationId: allocation.id,
      validationRunId: source.validationRun.id,
      riskModel: (allocation.frozenRequest as any).riskModel ?? {
        type: source.riskType,
        covarianceDiagonalShrinkage: (allocation.frozenRequest as any).covarianceDiagonalShrinkage,
      },
      candidateIds: [...(allocation.frozenRequest as any).candidateIds],
      alphaWeights: weights,
      underlyingAssetWeights: assetWeights,
      expectedDailyVolatility: allocationResult.estimatedVolatility,
      realizedMetrics: b3.metrics,
      realizedTurnover: turnover,
      b3Status: b3.status,
      maximumReconciliationDifference: b3.diagnostics?.maximumReconciliationDifference ?? null,
    }];
  })) as unknown as Record<RiskType, Record<string, any>>;
  const keys: RiskType[] = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"];
  const pairwiseDistances = [];
  for (let leftIndex = 0; leftIndex < keys.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < keys.length; rightIndex++) {
      const left = keys[leftIndex], right = keys[rightIndex];
      pairwiseDistances.push({
        left, right,
        alphaWeightDistance: halfL1(models[left].alphaWeights, models[right].alphaWeights),
        underlyingAssetWeightDistance: halfL1(models[left].underlyingAssetWeights, models[right].underlyingAssetWeights),
        expectedDailyVolatilityDifference:
          finite(models[left].expectedDailyVolatility) && finite(models[right].expectedDailyVolatility)
            ? models[left].expectedDailyVolatility - models[right].expectedDailyVolatility : null,
      });
    }
  }
  return {
    engineVersion: COMPARISON_ENGINE,
    models,
    pairwiseDistances,
    methodology: "Descriptive controlled comparison of three frozen risk estimators under identical alpha policy, expected-return assumptions, B2 objective/constraints, B1 sources, B3 evaluation inputs, execution and cash/cost assumptions. No winner is selected.",
  };
}
async function loadSources(ids: ComparisonIds): Promise<Source[]> {
  const slots: Slot[] = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"];
  if (!ids || !isRecord(ids.allocationIds) || !isRecord(ids.validationRunIds) ||
      slots.some((slot) => !Number.isSafeInteger(ids.allocationIds[slot]) || ids.allocationIds[slot] < 1 ||
        !Number.isSafeInteger(ids.validationRunIds[slot]) || ids.validationRunIds[slot] < 1) ||
      new Set(slots.map((slot) => ids.allocationIds[slot])).size !== 3 ||
      new Set(slots.map((slot) => ids.validationRunIds[slot])).size !== 3)
    throw new D1RiskComparisonError("Provide three distinct positive allocation IDs and three distinct positive B3 validation run IDs.", 400);
  const allocationRows = await db.select().from(allocationsTable)
    .where(inArray(allocationsTable.id, slots.map((slot) => ids.allocationIds[slot])));
  const validationRows = await db.select().from(validationRunsTable)
    .where(inArray(validationRunsTable.id, slots.map((slot) => ids.validationRunIds[slot])));
  if (allocationRows.length !== 3 || validationRows.length !== 3)
    throw new D1RiskComparisonError("One or more saved B2 allocation or B3 validation runs were not found.", 404);
  const byAllocation = new Map(allocationRows.map((row) => [row.id, row]));
  const byValidation = new Map(validationRows.map((row) => [row.id, row]));
  return slots.map((slot) => {
    const allocation = byAllocation.get(ids.allocationIds[slot]);
    const validationRun = byValidation.get(ids.validationRunIds[slot]);
    if (!allocation || !validationRun) throw new D1RiskComparisonError("A requested child run was not found.", 404);
    const allocationResult = assertValidAllocation(allocation);
    const request = allocation.frozenRequest as unknown as Record<string, any>;
    const riskType = riskTypeFromRequest(request);
    if (riskType !== slot)
      throw new D1RiskComparisonError(`Allocation #${allocation.id} is ${riskType ?? "an unidentified estimator"}, not requested ${slot}.`, 400);
    const b3Envelope = assertValidB3(validationRun, allocation);
    return { slot, allocation, validationRun, b3Envelope, riskType, allocationResult };
  });
}
function response(row: typeof d1RiskComparisonsTable.$inferSelect) {
  return {
    id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    manifest: row.manifestJson, result: row.resultJson,
    createdAt: row.createdAt.toISOString(),
  };
}
export async function persistD1RiskModelComparison(ids: ComparisonIds) {
  const sources = await loadSources(ids);
  validateControlledRiskSources(sources);
  for (const source of sources) {
    const allocationReplay = optimizePreparedSnapshot(
      source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
      source.allocation.frozenRequest as AllocationRequest,
    );
    const replayDiff = compareValues(source.allocation.frozenResult, allocationReplay);
    if (replayDiff.length)
      throw new D1RiskComparisonError(`Allocation #${source.allocation.id} does not replay from its frozen request: ${replayDiff.slice(0, 3).join("; ")}`, 409);
    const b3Replay = await replayB3ValidationRun(source.validationRun.id);
    if (!b3Replay || b3Replay.status !== "pass")
      throw new D1RiskComparisonError(`B3 Validation Run #${source.validationRun.id} failed frozen replay: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`, 409);
  }
  const resultJson = buildResult(sources);
  const manifestJson = {
    schemaVersion: 1, engineVersion: COMPARISON_ENGINE,
    sourceIdentities: Object.fromEntries(sources.map((source) => [source.riskType, {
      allocationId: source.allocation.id, allocationFingerprint: source.allocation.fingerprint,
      validationRunId: source.validationRun.id, validationInputHash: source.validationRun.validationInputHash,
      validationResultHash: fingerprint(source.b3Envelope.result),
    }])),
    sourceHashes: Object.fromEntries(sources.map((source) => [source.riskType, {
      allocationSnapshotHash: source.allocation.frozenSnapshotHash,
      validationSnapshotHash: fingerprint(source.b3Envelope.validationSnapshot),
      assumptionsHash: fingerprint(source.b3Envelope.assumptions),
    }])),
    frozenPolicy: {
      request: sources[0].allocation.frozenRequest,
      evaluationAssumptions: sources[0].b3Envelope.assumptions,
      validationSnapshot: sources[0].b3Envelope.validationSnapshot,
      estimationDatePlan: sources[0].b3Envelope.estimationDatePlan ?? null,
    },
    riskModels: Object.fromEntries(sources.map((source) => [
      source.riskType, (source.allocation.frozenRequest as any).riskModel ?? {
        type: source.riskType,
        covarianceDiagonalShrinkage: (source.allocation.frozenRequest as any).covarianceDiagonalShrinkage,
      },
    ])),
  };
  const manifestHash = fingerprint(manifestJson);
  const resultHash = fingerprint(resultJson);
  const [row] = await db.insert(d1RiskComparisonsTable).values({
    sampleAllocationId: ids.allocationIds.SAMPLE,
    sampleValidationRunId: ids.validationRunIds.SAMPLE,
    diagonalShrinkageAllocationId: ids.allocationIds.DIAGONAL_SHRINKAGE,
    diagonalShrinkageValidationRunId: ids.validationRunIds.DIAGONAL_SHRINKAGE,
    statisticalFactorAllocationId: ids.allocationIds.STATISTICAL_FACTOR,
    statisticalFactorValidationRunId: ids.validationRunIds.STATISTICAL_FACTOR,
    manifestHash, resultHash, manifestJson, resultJson,
  }).returning();
  return response(row);
}
export async function listD1RiskModelComparisons() {
  const rows = await db.select().from(d1RiskComparisonsTable).orderBy(desc(d1RiskComparisonsTable.id));
  return rows.map((row) => ({ id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    createdAt: row.createdAt.toISOString() }));
}
export async function getD1RiskModelComparison(id: number) {
  const [row] = await db.select().from(d1RiskComparisonsTable)
    .where(eq(d1RiskComparisonsTable.id, id)).limit(1);
  return row ? response(row) : null;
}
export async function replayD1RiskModelComparison(id: number) {
  const [row] = await db.select().from(d1RiskComparisonsTable)
    .where(eq(d1RiskComparisonsTable.id, id)).limit(1);
  if (!row) return null;
  const differences: string[] = [];
  if (fingerprint(row.manifestJson) !== row.manifestHash) differences.push("Frozen comparison manifest hash mismatch.");
  if (fingerprint(row.resultJson) !== row.resultHash) differences.push("Frozen comparison result hash mismatch.");
  if (differences.length) return { comparisonId: id, status: "fail" as const, differences,
    maximumNumericDifference: 0, result: {} };
  try {
    const ids: ComparisonIds = {
      allocationIds: {
        SAMPLE: row.sampleAllocationId,
        DIAGONAL_SHRINKAGE: row.diagonalShrinkageAllocationId,
        STATISTICAL_FACTOR: row.statisticalFactorAllocationId,
      },
      validationRunIds: {
        SAMPLE: row.sampleValidationRunId,
        DIAGONAL_SHRINKAGE: row.diagonalShrinkageValidationRunId,
        STATISTICAL_FACTOR: row.statisticalFactorValidationRunId,
      },
    };
    const sources = await loadSources(ids);
    validateControlledRiskSources(sources);
    for (const source of sources) {
      const allocationReplay = optimizePreparedSnapshot(
        source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
        source.allocation.frozenRequest as AllocationRequest,
      );
      differences.push(...compareValues(source.allocation.frozenResult, allocationReplay,
        `allocation[${source.allocation.id}]`));
      const b3Replay = await replayB3ValidationRun(source.validationRun.id);
      if (!b3Replay || b3Replay.status !== "pass")
        differences.push(`B3 Validation Run #${source.validationRun.id} replay failed: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`);
    }
    const result = buildResult(sources);
    let maximumNumericDifference = 0;
    const collectDifference = (left: unknown, right: unknown) => {
      if (typeof left === "number" && typeof right === "number") {
        if (Number.isFinite(left) && Number.isFinite(right))
          maximumNumericDifference = Math.max(maximumNumericDifference, Math.abs(left - right));
      } else if (Array.isArray(left) && Array.isArray(right)) {
        left.forEach((value, index) => collectDifference(value, right[index]));
      } else if (isRecord(left) && isRecord(right)) {
        for (const key of Object.keys(left)) if (key in right) collectDifference(left[key], right[key]);
      }
    };
    collectDifference(row.resultJson, result);
    differences.push(...compareValues(row.resultJson, result, "comparisonResult"));
    if (maximumNumericDifference > TOLERANCE) differences.push("Replayed result numeric difference exceeds tolerance.");
    return {
      comparisonId: id,
      status: differences.length ? "fail" as const : "pass" as const,
      differences: [...new Set(differences)],
      maximumNumericDifference,
      result,
    };
  } catch (error) {
    differences.push(error instanceof Error ? error.message : "Frozen risk-model comparison replay failed.");
    return { comparisonId: id, status: "fail" as const, differences,
      maximumNumericDifference: 0, result: {} };
  }
}