import { desc, eq, inArray } from "drizzle-orm";
import {
  allocationsTable, db, d3ForecastComparisonsTable, validationRunsTable,
} from "@workspace/db";
import { optimizePreparedSnapshot, type AllocationRequest, type AllocationResult } from "./allocation-b2";
import { replayB3ValidationRun } from "./b3-validation-store";
import { canonicalJson, fingerprint } from "./prepared-inputs";
import { hashDataset } from "./run-snapshot";

const ENGINE_VERSION = "d3-forecast-comparison.1";
const TOLERANCE = 1e-8;
const TYPES = ["SAMPLE_MEAN", "SHRUNK_MEAN", "BAYESIAN_VIEWS"] as const;
type ForecastType = (typeof TYPES)[number];
type ComparisonIds = {
  allocationIds: Record<ForecastType, number>;
  validationRunIds?: Record<ForecastType, number>;
};
type Source = {
  type: ForecastType;
  allocation: typeof allocationsTable.$inferSelect;
  validationRun?: typeof validationRunsTable.$inferSelect;
  b3Envelope?: Record<string, any>;
  allocationResult: AllocationResult;
};

export class D3ForecastComparisonError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
function forecastType(request: unknown): ForecastType | null {
  if (!isRecord(request) || !isRecord(request.forecastModel)) return null;
  return TYPES.includes(request.forecastModel.type) ? request.forecastModel.type : null;
}
function withoutForecastSettings(request: Record<string, any>) {
  const { forecastModel: _forecastModel, ...common } = request;
  return common;
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
      !["asset_returns", "alpha_streams"].includes(row.representation) ||
      request.representation !== row.representation ||
      result.status !== "SOLVED" || !Array.isArray(request.candidateIds) ||
      request.candidateIds.length < 1 || !request.candidateIds.every((id: unknown) => typeof id === "string"))
    throw new D3ForecastComparisonError(
      `Allocation #${row.id} is not a solved asset-return or alpha-stream B2 run.`);
  // Do not infer a forecast type for legacy requests. Such runs retain their
  // historical estimator and cannot be represented as a controlled D3 run.
  if (!forecastType(request))
    throw new D3ForecastComparisonError(`Allocation #${row.id} has no supported explicit forecastModel.type; legacy runs cannot enter a D3 controlled comparison.`, 400);
  if (fingerprint(snapshot) !== row.frozenSnapshotHash ||
      fingerprint({
        preparedInputId: row.preparedInputId, representation: row.representation,
        engineVersion: row.engineVersion, request: row.frozenRequest,
        snapshotHash: row.frozenSnapshotHash, result: row.frozenResult,
      }) !== row.fingerprint)
    throw new D3ForecastComparisonError(`Allocation #${row.id} failed frozen snapshot/fingerprint integrity checks.`);
  if (!isRecord(snapshot.dataset) || typeof snapshot.dataset.csvContent !== "string" ||
      hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256)
    throw new D3ForecastComparisonError(`Allocation #${row.id} frozen dataset hash is invalid.`);
  return result as unknown as AllocationResult;
}
function assertValidB3(
  row: typeof validationRunsTable.$inferSelect,
  allocation: typeof allocationsTable.$inferSelect,
) {
  const envelope = row.resultJson;
  if (row.allocationId !== allocation.id || row.validationPreparedInputId === null ||
      !isRecord(envelope) || envelope.kind !== "b3" || !isRecord(envelope.policyRequest) ||
      !isRecord(envelope.policySnapshot) || !isRecord(envelope.validationSnapshot) ||
      !isRecord(envelope.assumptions) || !isRecord(envelope.result) ||
      envelope.result.status !== "completed")
    throw new D3ForecastComparisonError(
      `Validation Run #${row.id} is not a successful B3 child of Allocation #${allocation.id}.`);
  if (canonicalJson(envelope.policyRequest) !== canonicalJson(allocation.frozenRequest) ||
      fingerprint(envelope.policySnapshot) !== allocation.frozenSnapshotHash)
    throw new D3ForecastComparisonError(
      `Validation Run #${row.id} does not use Allocation #${allocation.id}'s exact frozen policy.`);
  const validationSnapshot = envelope.validationSnapshot;
  if (!isRecord(validationSnapshot.dataset) || typeof validationSnapshot.dataset.csvContent !== "string" ||
      hashDataset(validationSnapshot.dataset.csvContent) !== validationSnapshot.dataset.sha256)
    throw new D3ForecastComparisonError(`Validation Run #${row.id} frozen evaluation dataset hash is invalid.`);
  if (b3EnvelopeHash(row, envelope) !== row.validationInputHash)
    throw new D3ForecastComparisonError(`Validation Run #${row.id} failed frozen input/result integrity checks.`);
  return envelope;
}

export function validateControlledForecastSources(sources: Source[]): void {
  if (sources.length !== 3 || new Set(sources.map((source) => source.type)).size !== 3 ||
      TYPES.some((type) => !sources.some((source) => source.type === type)))
    throw new D3ForecastComparisonError(
      "A controlled comparison requires exactly one SAMPLE_MEAN, SHRUNK_MEAN, and BAYESIAN_VIEWS run.", 400);
  for (const source of sources) {
    const request = source.allocation.frozenRequest as unknown;
    if (forecastType(request) !== source.type)
      throw new D3ForecastComparisonError(
        `Allocation #${source.allocation.id} is a legacy or mismatched forecast run; an explicit matching forecastModel.type is required.`, 400);
  }

  const first = sources[0];
  const firstRequest = first.allocation.frozenRequest as unknown as Record<string, any>;
  const firstSnapshotHash = first.allocation.frozenSnapshotHash;
  const firstDates = (first.allocationResult.model as any)?.dates ?? [];
  for (const source of sources.slice(1)) {
    const request = source.allocation.frozenRequest as unknown as Record<string, any>;
    const dates = (source.allocationResult.model as any)?.dates ?? [];
    // Exact canonical request equality (apart from the explicitly selected
    // forecast settings) covers ordered candidates, dates, risk, objective,
    // constraints, allocation mode, and every other B2/D2 assumption.
    if (canonicalJson(withoutForecastSettings(request)) !==
          canonicalJson(withoutForecastSettings(firstRequest)) ||
        source.allocation.frozenSnapshotHash !== firstSnapshotHash ||
        canonicalJson(dates) !== canonicalJson(firstDates))
      throw new D3ForecastComparisonError(
        "Controlled comparison rejected: candidate order, frozen dataset, estimation dates, risk methodology, allocation mode, objective, constraints, and all non-forecast B2/D2 assumptions must match exactly.", 400);
  }

  const withB3 = sources.filter((source) => source.b3Envelope);
  if (withB3.length !== 0 && withB3.length !== 3)
    throw new D3ForecastComparisonError("B3 validation is optional, but when supplied it must include all three forecast runs.", 400);
  if (withB3.length === 3) {
    const base = first.b3Envelope!;
    for (const source of sources.slice(1)) {
      const current = source.b3Envelope!;
      if (fingerprint(current.validationSnapshot) !== fingerprint(base.validationSnapshot) ||
          canonicalJson(current.assumptions) !== canonicalJson(base.assumptions) ||
          canonicalJson(current.estimationDatePlan ?? null) !== canonicalJson(base.estimationDatePlan ?? null))
        throw new D3ForecastComparisonError(
          "Controlled comparison rejected: all B3 evaluation datasets, dates, execution, cost, and cash assumptions must match exactly.", 400);
    }
  }
}

function matrixFrom(...values: unknown[]): number[][] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.every((row) =>
      Array.isArray(row) && row.every(finite))) return value as number[][];
  }
  return null;
}
function vectorFrom(...values: unknown[]): number[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.every(finite)) return value as number[];
  }
  return null;
}
function diagonalEstimatorUncertainty(
  type: ForecastType,
  forecastModel: Record<string, any>,
  covariance: unknown,
  observationCount: unknown,
): number[][] | null {
  if (type === "BAYESIAN_VIEWS" || !Array.isArray(covariance) ||
      !Number.isSafeInteger(observationCount) || (observationCount as number) < 1)
    return null;
  const sigma = matrixFrom(covariance);
  if (!sigma || sigma.some((row) => row.length !== sigma.length)) return null;
  const strength = type === "SHRUNK_MEAN"
    ? forecastModel.shrinkageStrength ?? forecastModel.shrinkage ?? forecastModel.s
    : 0;
  if (!finite(strength) || strength < 0 || strength > 1) return null;
  const factor = (1 - strength) ** 2 / (observationCount as number);
  return sigma.map((row) => row.map((value) => value * factor));
}
function buildResult(sources: Source[]) {
  const forecasts = {} as Record<ForecastType, Record<string, any>>;
  for (const source of sources) {
    const request = source.allocation.frozenRequest as unknown as Record<string, any>;
    const result = source.allocationResult as any;
    const model = result.model ?? {};
    const forecastState = result.forecast ?? model.forecast ?? {};
    const forecastConfiguration = request.forecastModel ?? {};
    const b3Result = source.b3Envelope?.result;
    const muHat = vectorFrom(
      forecastState.muHat, forecastState.mu, model.muHat, model.mu,
      forecastConfiguration.muHat,
    );
    const uncertainty = matrixFrom(
      forecastState.V_mu, forecastState.forecastUncertaintyCovariance,
      model.V_mu, model.forecastUncertaintyCovariance,
      forecastConfiguration.V_mu, forecastConfiguration.forecastUncertaintyCovariance,
    ) ?? diagonalEstimatorUncertainty(
      source.type, forecastConfiguration, result.riskModel?.covariance ?? model.sigma,
      model.observationCount,
    );
    const sampleMean = vectorFrom(
      forecastState.muSample, forecastState.sampleMeans, model.muSample, model.sampleMeans,
      forecastConfiguration.muSample,
    );
    const explicitStandardErrors = vectorFrom(
      forecastState.standardErrors, forecastState.forecastStandardErrors, model.forecastStandardErrors,
      forecastConfiguration.forecastStandardErrors,
    );
    const standardErrors = explicitStandardErrors ?? (uncertainty
      ? uncertainty.map((row: number[], index: number) =>
        finite(row[index]) && row[index] >= 0 ? Math.sqrt(row[index]) : null)
      : null);
    const weights = result.candidateWeights ?? {};
    const assetWeights = result.assetWeights ?? {};
    const alphaValues = Object.values(weights).filter(finite);
    const assetValues = Object.values(assetWeights).filter(finite);
    const signed = result.signedOverlay;
    const ledger = Array.isArray(b3Result?.dailyLedger) ? b3Result.dailyLedger : [];
    const turnover = ledger.reduce((sum: number, entry: any) =>
      sum + (finite(entry.externalTradedNotional) ? entry.externalTradedNotional : 0), 0);
    forecasts[source.type] = {
      allocationId: source.allocation.id,
      validationRunId: source.validationRun?.id ?? null,
      forecastModel: request.forecastModel,
      returnConvention: request.returnConvention ?? "daily_decimal",
      candidateIds: [...request.candidateIds],
      estimationDates: model.dates ?? [],
      observationCount: model.observationCount ?? null,
      muSample: sampleMean,
      muHat,
      V_mu: uncertainty,
      forecastStandardErrors: standardErrors,
      candidateWeights: weights,
      underlyingAssetWeights: assetWeights,
      expectedReturn: signed?.expectedExcessReturn ?? result.estimatedGrossReturn ?? null,
      expectedRisk: result.estimatedVolatility ?? null,
      grossExposure: finite(signed?.grossAssetExposure)
        ? signed.grossAssetExposure
        : alphaValues.reduce((sum, value) => sum + Math.abs(value), 0),
      netExposure: finite(signed?.netAssetExposure)
        ? signed.netAssetExposure
        : assetValues.reduce((sum, value) => sum + value, 0),
      alphaGrossExposure: signed?.alphaGrossExposure ?? null,
      cash: { masterCash: result.masterCash ?? null, totalCash: result.totalCash ?? null },
      realizedMetrics: b3Result?.metrics ?? null,
      realizedTurnover: source.b3Envelope ? turnover : null,
      b3Status: b3Result?.status ?? null,
    };
  }
  return {
    engineVersion: ENGINE_VERSION,
    comparisonClassification: "CONTROLLED_FORECAST_ESTIMATOR_COMPARISON",
    forecasts,
    methodology: "Descriptive controlled comparison of three explicitly selected frozen B2/D2 expected-return estimators under identical candidates, data, dates, risk model, objective, constraints, and assumptions. B3 metrics are included only when all three matched validation children are supplied. No winner or ranking is produced.",
  };
}

function makeManifest(sources: Source[]) {
  return {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    sourceIdentities: Object.fromEntries(sources.map((source) => [source.type, {
      allocationId: source.allocation.id,
      allocationFingerprint: source.allocation.fingerprint,
      validationRunId: source.validationRun?.id ?? null,
      validationInputHash: source.validationRun?.validationInputHash ?? null,
      validationResultHash: source.b3Envelope ? fingerprint(source.b3Envelope.result) : null,
    }])),
    sourceHashes: Object.fromEntries(sources.map((source) => [source.type, {
      allocationSnapshotHash: source.allocation.frozenSnapshotHash,
      b2ResultHash: fingerprint(source.allocation.frozenResult),
      validationSnapshotHash: source.b3Envelope ? fingerprint(source.b3Envelope.validationSnapshot) : null,
      assumptionsHash: source.b3Envelope ? fingerprint(source.b3Envelope.assumptions) : null,
    }])),
    frozenSources: Object.fromEntries(sources.map((source) => [source.type, {
      request: source.allocation.frozenRequest,
      snapshot: source.allocation.frozenSnapshot,
      result: source.allocation.frozenResult,
      b3PolicySnapshot: source.b3Envelope?.policySnapshot ?? null,
      b3ValidationSnapshot: source.b3Envelope?.validationSnapshot ?? null,
      b3Assumptions: source.b3Envelope?.assumptions ?? null,
      estimationDatePlan: source.b3Envelope?.estimationDatePlan ?? null,
      b3Result: source.b3Envelope?.result ?? null,
      b2EngineVersion: source.allocation.engineVersion,
      b3EngineVersion: source.validationRun?.engineVersion ?? null,
    }])),
    classification: "CONTROLLED_FORECAST_ESTIMATOR_COMPARISON",
  };
}
function response(row: typeof d3ForecastComparisonsTable.$inferSelect) {
  return {
    id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    manifest: row.manifestJson, result: row.resultJson, createdAt: row.createdAt.toISOString(),
  };
}

async function loadSources(ids: ComparisonIds): Promise<Source[]> {
  if (!ids || !isRecord(ids.allocationIds) ||
      TYPES.some((type) => !Number.isSafeInteger(ids.allocationIds[type]) || ids.allocationIds[type] < 1) ||
      new Set(TYPES.map((type) => ids.allocationIds[type])).size !== 3)
    throw new D3ForecastComparisonError("Provide three distinct positive allocation IDs keyed by SAMPLE_MEAN, SHRUNK_MEAN, and BAYESIAN_VIEWS.", 400);
  const hasValidationIds = ids.validationRunIds !== undefined;
  if (hasValidationIds && (!isRecord(ids.validationRunIds) ||
      TYPES.some((type) => !Number.isSafeInteger(ids.validationRunIds![type]) || ids.validationRunIds![type] < 1) ||
      new Set(TYPES.map((type) => ids.validationRunIds![type])).size !== 3))
    throw new D3ForecastComparisonError("When provided, validationRunIds must contain three distinct positive B3 run IDs keyed by all forecast types.", 400);
  const allocationRows = await db.select().from(allocationsTable)
    .where(inArray(allocationsTable.id, TYPES.map((type) => ids.allocationIds[type])));
  if (allocationRows.length !== 3)
    throw new D3ForecastComparisonError("One or more saved B2 allocation runs were not found.", 404);
  const validationRows = hasValidationIds
    ? await db.select().from(validationRunsTable)
      .where(inArray(validationRunsTable.id, TYPES.map((type) => ids.validationRunIds![type])))
    : [];
  if (hasValidationIds && validationRows.length !== 3)
    throw new D3ForecastComparisonError("One or more saved B3 validation runs were not found.", 404);
  const allocationsById = new Map(allocationRows.map((row) => [row.id, row]));
  const validationsById = new Map(validationRows.map((row) => [row.id, row]));
  return TYPES.map((type) => {
    const allocation = allocationsById.get(ids.allocationIds[type]);
    if (!allocation) throw new D3ForecastComparisonError("A requested B2 allocation was not found.", 404);
    const allocationResult = assertValidAllocation(allocation);
    const actualType = forecastType(allocation.frozenRequest);
    if (actualType !== type)
      throw new D3ForecastComparisonError(`Allocation #${allocation.id} is ${actualType ?? "an unidentified estimator"}, not requested ${type}.`, 400);
    if (!hasValidationIds) return { type, allocation, allocationResult };
    const validationRun = validationsById.get(ids.validationRunIds![type]);
    if (!validationRun) throw new D3ForecastComparisonError("A requested B3 child was not found.", 404);
    const b3Envelope = assertValidB3(validationRun, allocation);
    return { type, allocation, validationRun, b3Envelope, allocationResult };
  });
}

export async function persistD3ForecastComparison(ids: ComparisonIds) {
  const sources = await loadSources(ids);
  validateControlledForecastSources(sources);
  for (const source of sources) {
    const replay = optimizePreparedSnapshot(
      source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
      source.allocation.frozenRequest as AllocationRequest,
    );
    const differences = compareValues(source.allocation.frozenResult, replay);
    if (differences.length)
      throw new D3ForecastComparisonError(`Allocation #${source.allocation.id} does not replay from its frozen request: ${differences.slice(0, 3).join("; ")}`);
    if (source.validationRun) {
      const b3Replay = await replayB3ValidationRun(source.validationRun.id);
      if (!b3Replay || b3Replay.status !== "pass")
        throw new D3ForecastComparisonError(
          `B3 Validation Run #${source.validationRun.id} failed frozen replay: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`);
    }
  }
  const manifestJson = makeManifest(sources);
  const resultJson = buildResult(sources);
  const byType = (type: ForecastType) => sources.find((source) => source.type === type)!;
  const [row] = await db.insert(d3ForecastComparisonsTable).values({
    sampleMeanAllocationId: byType("SAMPLE_MEAN").allocation.id,
    sampleMeanValidationRunId: byType("SAMPLE_MEAN").validationRun?.id ?? null,
    shrunkMeanAllocationId: byType("SHRUNK_MEAN").allocation.id,
    shrunkMeanValidationRunId: byType("SHRUNK_MEAN").validationRun?.id ?? null,
    bayesianViewsAllocationId: byType("BAYESIAN_VIEWS").allocation.id,
    bayesianViewsValidationRunId: byType("BAYESIAN_VIEWS").validationRun?.id ?? null,
    manifestHash: fingerprint(manifestJson),
    resultHash: fingerprint(resultJson),
    manifestJson,
    resultJson,
  }).returning();
  return response(row);
}
export async function listD3ForecastComparisons() {
  const rows = await db.select().from(d3ForecastComparisonsTable)
    .orderBy(desc(d3ForecastComparisonsTable.id));
  return rows.map((row) => ({
    id: row.id, manifestHash: row.manifestHash, resultHash: row.resultHash,
    createdAt: row.createdAt.toISOString(),
  }));
}
export async function getD3ForecastComparison(id: number) {
  const [row] = await db.select().from(d3ForecastComparisonsTable)
    .where(eq(d3ForecastComparisonsTable.id, id)).limit(1);
  return row ? response(row) : null;
}
export async function replayD3ForecastComparison(id: number) {
  const [row] = await db.select().from(d3ForecastComparisonsTable)
    .where(eq(d3ForecastComparisonsTable.id, id)).limit(1);
  if (!row) return null;
  const differences: string[] = [];
  if (fingerprint(row.manifestJson) !== row.manifestHash) differences.push("Frozen comparison manifest hash mismatch.");
  if (fingerprint(row.resultJson) !== row.resultHash) differences.push("Frozen comparison result hash mismatch.");
  if (differences.length) return {
    comparisonId: id, status: "fail" as const, differences,
    maximumNumericDifference: 0, result: {},
  };
  try {
    const someB3 = row.sampleMeanValidationRunId !== null ||
      row.shrunkMeanValidationRunId !== null || row.bayesianViewsValidationRunId !== null;
    const allB3 = row.sampleMeanValidationRunId !== null &&
      row.shrunkMeanValidationRunId !== null && row.bayesianViewsValidationRunId !== null;
    if (someB3 && !allB3) throw new D3ForecastComparisonError("Persisted D3 comparison has an incomplete B3 child set.");
    const ids: ComparisonIds = {
      allocationIds: {
        SAMPLE_MEAN: row.sampleMeanAllocationId,
        SHRUNK_MEAN: row.shrunkMeanAllocationId,
        BAYESIAN_VIEWS: row.bayesianViewsAllocationId,
      },
      ...(allB3 ? { validationRunIds: {
        SAMPLE_MEAN: row.sampleMeanValidationRunId!,
        SHRUNK_MEAN: row.shrunkMeanValidationRunId!,
        BAYESIAN_VIEWS: row.bayesianViewsValidationRunId!,
      } } : {}),
    };
    const sources = await loadSources(ids);
    validateControlledForecastSources(sources);
    const manifest = makeManifest(sources);
    differences.push(...compareValues(row.manifestJson, manifest, "manifest"));
    let maximumNumericDifference = 0;
    for (const source of sources) {
      const replay = optimizePreparedSnapshot(
        source.allocation.frozenSnapshot as Parameters<typeof optimizePreparedSnapshot>[0],
        source.allocation.frozenRequest as AllocationRequest,
      );
      differences.push(...compareValues(source.allocation.frozenResult, replay,
        `allocation[${source.allocation.id}]`));
      maximumNumericDifference = Math.max(maximumNumericDifference,
        numericMaximumDifference(source.allocation.frozenResult, replay));
      if (source.validationRun) {
        const b3Replay = await replayB3ValidationRun(source.validationRun.id);
        if (!b3Replay || b3Replay.status !== "pass")
          differences.push(`B3 Validation Run #${source.validationRun.id} replay failed: ${b3Replay?.differences?.slice(0, 3).join("; ") ?? "missing replay"}`);
        else
          maximumNumericDifference = Math.max(maximumNumericDifference,
            numericMaximumDifference(source.b3Envelope!.result, b3Replay.replayedResult));
      }
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
    differences.push(error instanceof Error ? error.message : "Frozen D3 forecast comparison replay failed.");
    return { comparisonId: id, status: "fail" as const, differences,
      maximumNumericDifference: 0, result: {} };
  }
}