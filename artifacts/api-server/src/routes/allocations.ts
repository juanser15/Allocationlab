import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  CreateAllocationBody, CreateAllocationResponse, GetAllocationParams, GetAllocationResponse,
  ListAllocationsResponse, ReplayAllocationParams, ReplayAllocationResponse,
} from "@workspace/api-zod";
import { allocationsTable, db, preparedInputsTable } from "@workspace/db";
import {
  optimizePreparedSnapshot, type AllocationRequest, type AllocationResult,
} from "../lib/allocation-b2";
import { fingerprint, type PreparedSnapshot } from "../lib/prepared-inputs";
import { hashDataset } from "../lib/run-snapshot";
import { maximumNumericDifference } from "../lib/replay-numeric-difference";
import { computeD4Diagnostics } from "../lib/d4-diagnostics";
import { D4_SOLVER_VERSION } from "../lib/robust-solver-d4";

const router: IRouter = Router();
const REPLAY_TOLERANCE = 1e-8;
// Bump this when route-level frozen-input or replay semantics change.
const B2_API_ENGINE_VERSION = "allocation-b2-api.1";
const D4_API_ENGINE_VERSION = "allocation-d4-api.1";
const D5_API_ENGINE_VERSION = "allocation-d5-api.1";
const D5_SIMPLE_API_ENGINE_VERSION = "allocation-d5-simple-api.1";
const D6_RIDGE_API_ENGINE_VERSION = "allocation-d6-signal-ridge-api.1";

function apiEngineVersion(request: AllocationRequest): string {
  if (request.forecastModel?.type === "SIGNAL_RIDGE") return D6_RIDGE_API_ENGINE_VERSION;
  if (request.rebalanceRegularization && request.rebalanceRegularization.lambdaR > 0)
    return D5_SIMPLE_API_ENGINE_VERSION;
  return (request as AllocationRequest & { costAware?: unknown }).costAware
    ? D5_API_ENGINE_VERSION
    : request.robustness ? D4_API_ENGINE_VERSION : B2_API_ENGINE_VERSION;
}

function engineVersion(result: AllocationResult, request: AllocationRequest): string {
  const d4Solver = result.robustness?.solver;
  const costAware = (result as AllocationResult & { costAware?: Record<string, unknown> }).costAware;
  const costAwareSolver = costAware?.solverEvidence && typeof costAware.solverEvidence === "object"
    ? costAware.solverEvidence as Record<string, unknown> : undefined;
  const costAwareMethod = "cost-aware";
  const rebalanceSolver = result.rebalanceRegularization?.solverEvidence;
  return `${apiEngineVersion(request)}; ${result.solver.name}@${result.solver.version}` +
    (request.robustness ? `; D4 ${d4Solver?.name ?? "robust-solver"}@${d4Solver?.version ?? D4_SOLVER_VERSION}` : "") +
    (costAware
      ? `; D5 ${costAwareMethod}${costAwareSolver
        ? ` ${String(costAwareSolver.name ?? "solver")}@${String(costAwareSolver.version ?? "unknown")}`
        : ""}`
      : "") +
    (result.rebalanceRegularization
      ? `; D5 simple rebalance regularization ${rebalanceSolver?.name ?? "solver"}@${rebalanceSolver?.version ?? "unknown"}`
      : "");
}

function validPathId(params: { allocationId: number }): boolean {
  return Number.isSafeInteger(params.allocationId) && params.allocationId > 0;
}

function response(row: typeof allocationsTable.$inferSelect) {
  const result = row.frozenResult as AllocationResult;
  return {
    id: row.id,
    preparedInputId: row.preparedInputId,
    representation: row.representation,
    fingerprint: row.fingerprint,
    engineVersion: row.engineVersion,
    status: result.status,
    request: row.frozenRequest,
    result,
    createdAt: row.createdAt,
  };
}

function unexpectedAllocationFields(body: unknown): string[] {
  const differences: string[] = [];
  const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  const check = (value: unknown, allowed: string[], path: string): Record<string, unknown> | null => {
    const object = record(value);
    if (object) for (const key of Object.keys(object))
      if (!allowed.includes(key)) differences.push(`${path}.${key} is not supported`);
    return object;
  };
  const request = check(body, [
    "preparedInputId", "candidateIds", "informationCutoff", "decisionTimestamp", "estimationWindow",
    "minObservations", "representation", "returnConvention", "expectedReturnShrinkage",
      "covarianceDiagonalShrinkage", "riskModel", "dailyCashYield", "objective", "constraints",
      "allocationMode", "signedConstraints", "targetExcessReturn", "forecastModel", "robustness", "costAware",
      "rebalanceRegularization",
  ], "request");
  if (!request) return differences;
  check(request.objective, ["type", "gamma", "eta"], "objective");
  const costAware = check(request.costAware, [
    "costAmortizationDays", "turnoverPreferenceBps", "transactionCostBps", "slippageBps", "holdings",
  ], "costAware");
  if (costAware) check(costAware.holdings, ["asOf", "quantities", "cash", "nav"], "costAware.holdings");
  check(request.riskModel, ["type", "factorCount", "specificRiskFloorFraction"], "riskModel");
  check(request.robustness, ["method", "kappa"], "robustness");
  const forecast = check(request.forecastModel, [
    "type", "displayZ", "shrinkage", "shrinkagePrior", "priorMean", "priorUncertainty", "views",
    "factorIds", "lambdaSignal", "trainingWindowDates", "minTrainingDates", "hacBandwidth", "executionTiming",
  ], "forecastModel");
  if (forecast) {
    const forecastType = forecast.type;
    const typeAllowed = forecastType === "SAMPLE_MEAN" ? ["type", "displayZ"] :
      forecastType === "SHRUNK_MEAN" ? ["type", "displayZ", "shrinkage", "shrinkagePrior"] :
      forecastType === "SIGNAL_RIDGE" ? ["type", "displayZ", "factorIds", "lambdaSignal",
        "trainingWindowDates", "minTrainingDates", "hacBandwidth", "executionTiming"] :
        ["type", "displayZ", "shrinkage", "shrinkagePrior", "priorMean", "priorUncertainty", "views"];
    check(forecast, typeAllowed, "forecastModel");
    const shrinkagePrior = check(forecast.shrinkagePrior, ["source", "values"], "forecastModel.shrinkagePrior");
    if (shrinkagePrior) check(shrinkagePrior,
      shrinkagePrior.source === "USER_DEFINED" ? ["source", "values"] : ["source"],
      "forecastModel.shrinkagePrior");
    const priorMean = check(forecast.priorMean, ["source", "values"], "forecastModel.priorMean");
    if (priorMean) check(priorMean,
      priorMean.source === "USER_DEFINED_PRIOR" ? ["source", "values"] : ["source"],
      "forecastModel.priorMean");
    const priorUncertainty = check(forecast.priorUncertainty,
      ["type", "tau", "matrix", "candidateIds"], "forecastModel.priorUncertainty");
    if (priorUncertainty) check(priorUncertainty,
      priorUncertainty.type === "USER_DEFINED" ? ["type", "matrix", "candidateIds"] : ["type", "tau"],
      "forecastModel.priorUncertainty");
    if (Array.isArray(forecast.views)) forecast.views.forEach((view, index) => {
      const viewRecord = record(view);
      check(view, viewRecord?.type === "RELATIVE"
        ? ["type", "candidateId", "relativeCandidateId", "q", "variance", "effectiveTimestamp", "availabilityTimestamp"]
        : ["type", "candidateId", "q", "variance", "effectiveTimestamp", "availabilityTimestamp"],
      `forecastModel.views[${index}]`);
    });
  }
  const constraints = check(request.constraints, [
    "candidateBounds", "totalCash", "assetBounds", "groupCaps", "unsupported",
  ], "constraints");
  const checkBounds = (value: unknown, path: string) => {
    const bounds = record(value);
    if (!bounds) return;
    for (const [key, bound] of Object.entries(bounds)) check(bound, ["min", "max"], `${path}.${key}`);
  };
  if (constraints) {
    checkBounds(constraints.candidateBounds, "constraints.candidateBounds");
    check(constraints.totalCash, ["min", "max"], "constraints.totalCash");
    checkBounds(constraints.assetBounds, "constraints.assetBounds");
    if (Array.isArray(constraints.groupCaps))
      constraints.groupCaps.forEach((cap, index) => check(cap, ["name", "candidateIds", "max"], `constraints.groupCaps[${index}]`));
  }
  const signed = check(request.signedConstraints, [
    "alphaBounds", "grossAlphaMax", "groupGrossCaps", "assetBounds",
    "grossAssetMax", "netAssetExposure", "cash",
  ], "signedConstraints");
  if (signed) {
    checkBounds(signed.alphaBounds, "signedConstraints.alphaBounds");
    checkBounds(signed.assetBounds, "signedConstraints.assetBounds");
    check(signed.netAssetExposure, ["min", "max"], "signedConstraints.netAssetExposure");
    check(signed.cash, ["min", "max"], "signedConstraints.cash");
    if (Array.isArray(signed.groupGrossCaps))
      signed.groupGrossCaps.forEach((cap, index) =>
        check(cap, ["group", "candidateIds", "max"], `signedConstraints.groupGrossCaps[${index}]`));
  }
  return differences;
}

function resultDifferences(saved: unknown, replayed: unknown): string[] {
  const differences: string[] = [];
  const describe = (value: unknown) => JSON.stringify(value) ?? "undefined";
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (differences.length >= 100) return;
    if (typeof left === "number" && typeof right === "number") {
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > REPLAY_TOLERANCE)
        differences.push(`${path}: saved=${left}, replayed=${right}`);
      return;
    }
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) differences.push(`${path}.length: saved=${left.length}, replayed=${right.length}`);
      for (let i = 0; i < Math.min(left.length, right.length); i++) visit(left[i], right[i], `${path}[${i}]`);
      return;
    }
    if (left && right && typeof left === "object" && typeof right === "object" &&
      !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>;
      const b = right as Record<string, unknown>;
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        if (!(key in a) || !(key in b)) differences.push(`${path}.${key}: key presence differs`);
        else visit(a[key], b[key], `${path}.${key}`);
      }
      return;
    }
    differences.push(`${path}: saved=${describe(left)}, replayed=${describe(right)}`);
  };
  visit(saved, replayed, "result");
  return differences;
}

function persistedFingerprint(input: {
  preparedInputId: number;
  representation: string;
  engineVersion: string;
  request: unknown;
  snapshotHash: string;
  result: unknown;
}): string {
  return fingerprint({
    preparedInputId: input.preparedInputId,
    representation: input.representation,
    engineVersion: input.engineVersion,
    request: input.request,
    snapshotHash: input.snapshotHash,
    result: input.result,
  });
}

router.get("/allocations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(allocationsTable)
    .orderBy(desc(allocationsTable.createdAt), desc(allocationsTable.id));
  res.json(ListAllocationsResponse.parse(rows.map(response)));
});

router.post("/allocations", async (req, res): Promise<void> => {
  const rawInput = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(rawInput, "costAware")) {
    const stacked = Object.prototype.hasOwnProperty.call(rawInput, "rebalanceRegularization");
    res.status(422).json({
      error: stacked
        ? "The legacy D5 costAware L1 method is retired; costAware cannot be combined with rebalanceRegularization."
        : "The legacy D5 costAware L1 method is retired; use rebalanceRegularization instead.",
    });
    return;
  }
  const unexpectedFields = unexpectedAllocationFields(req.body);
  if (unexpectedFields.length) {
    res.status(400).json({ error: unexpectedFields.join("; ") });
    return;
  }
  const parsed = CreateAllocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const regularization = parsed.data.rebalanceRegularization;
  if (regularization && regularization.lambdaR > 0) {
    if (parsed.data.objective.type !== "regularized_mean_variance") {
      res.status(400).json({ error: "Positive rebalanceRegularization requires objective.type to be regularized_mean_variance." });
      return;
    }
    const holdings = regularization.holdings;
    if (!holdings) {
      res.status(400).json({ error: "Positive rebalanceRegularization requires explicit holdings." });
      return;
    }
    const asOf = holdings.asOf;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      !Number.isFinite(Date.parse(`${asOf}T00:00:00.000Z`)) ||
      new Date(`${asOf}T00:00:00.000Z`).toISOString().slice(0, 10) !== asOf) {
      res.status(400).json({ error: "rebalanceRegularization.holdings.asOf must be a valid ISO calendar date." });
      return;
    }
    if (asOf !== parsed.data.informationCutoff) {
      res.status(400).json({
        error: "rebalanceRegularization.holdings.asOf must exactly match informationCutoff.",
      });
      return;
    }
  }
  if (parsed.data.robustness?.method === "ROBUST_MEAN_UNCERTAINTY" && !parsed.data.forecastModel) {
    res.status(400).json({ error: "ROBUST_MEAN_UNCERTAINTY requires an explicit forecastModel." });
    return;
  }
  if (!Number.isSafeInteger(parsed.data.preparedInputId) || !Number.isSafeInteger(parsed.data.estimationWindow) ||
    !Number.isSafeInteger(parsed.data.minObservations)) {
    res.status(400).json({ error: "preparedInputId, estimationWindow and minObservations must be safe integers." });
    return;
  }
  const request = structuredClone(parsed.data) as AllocationRequest;
  if (Object.prototype.hasOwnProperty.call(rawInput, "forecastModel"))
    request.forecastModel = structuredClone(rawInput.forecastModel) as AllocationRequest["forecastModel"];
  if (new Set(request.candidateIds).size !== request.candidateIds.length) {
    res.status(400).json({ error: "candidateIds must contain unique canonical B1 candidate IDs." });
    return;
  }
  const [preparedRow] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, request.preparedInputId)).limit(1);
  if (!preparedRow) {
    res.status(404).json({ error: "Prepared input version not found." });
    return;
  }
  const snapshot = preparedRow.snapshot as PreparedSnapshot;
  if (request.representation !== snapshot.representation) {
    res.status(409).json({ error: "Allocation representation must match the selected immutable B1 preparation." });
    return;
  }
  if (!snapshot.dataset?.csvContent || hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256) {
    res.status(409).json({ error: "Prepared input dataset content/hash mismatch; allocation was not computed." });
    return;
  }
  const candidates = new Map(snapshot.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const candidateId of request.candidateIds) {
    const candidate = candidates.get(candidateId);
    if (!candidate) {
      res.status(409).json({ error: `Selected candidate ${candidateId} is not in prepared input ${request.preparedInputId}.` });
      return;
    }
    if (candidate.diagnostics.duplicateOf) {
      res.status(409).json({
        error: `Candidate ${candidateId} is a B1 canonical duplicate alias; use canonical candidate ${candidate.diagnostics.duplicateOf}.`,
      });
      return;
    }
    if (candidate.kind !== request.representation || candidate.status !== "READY") {
      res.status(409).json({
        error: `Selected candidate ${candidateId} is not READY for ${request.representation}: ${candidate.status}; ${candidate.reasons.join("; ")}`,
      });
      return;
    }
  }

  let result: AllocationResult;
  try {
    result = optimizePreparedSnapshot(snapshot, request);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Allocation engine failed." });
    return;
  }
  const frozenRequest = structuredClone(request);
  // Resolve and persist the default factor count once from the B2 estimation
  // window so every later B3 decision uses that same frozen dimension.
  const factorCount = result.riskModel?.factorCount ?? result.model?.riskModel?.factorCount;
  const specificRiskFloorFraction = result.riskModel?.specificRiskFloorFraction ??
    result.model?.riskModel?.specificRiskFloorFraction;
  if (frozenRequest.riskModel?.type === "STATISTICAL_FACTOR" &&
      frozenRequest.riskModel.factorCount === undefined &&
      Number.isSafeInteger(factorCount))
    frozenRequest.riskModel.factorCount = factorCount;
  if (frozenRequest.riskModel?.type === "STATISTICAL_FACTOR" &&
      frozenRequest.riskModel.specificRiskFloorFraction === undefined &&
      typeof specificRiskFloorFraction === "number")
    frozenRequest.riskModel.specificRiskFloorFraction = specificRiskFloorFraction;
  if (frozenRequest.robustness && result.status === "SOLVED" && result.robustness) {
    try {
      result.robustness.diagnostics = computeD4Diagnostics(
        frozenRequest, result, (variant) => optimizePreparedSnapshot(snapshot, variant),
      ) as Record<string, unknown>;
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? `D4 diagnostics failed: ${error.message}` : "D4 diagnostics failed.",
      });
      return;
    }
  }
  const frozenSnapshot = structuredClone(snapshot);
  const frozenResult = structuredClone(result);
  const frozenSnapshotHash = fingerprint(frozenSnapshot);
  const version = engineVersion(result, request);
  const versionFingerprint = persistedFingerprint({
    preparedInputId: request.preparedInputId,
    representation: request.representation,
    engineVersion: version,
    request: frozenRequest,
    snapshotHash: frozenSnapshotHash,
    result: frozenResult,
  });
  const [saved] = await db.insert(allocationsTable).values({
    preparedInputId: request.preparedInputId,
    representation: request.representation,
    fingerprint: versionFingerprint,
    frozenSnapshotHash,
    engineVersion: version,
    frozenRequest,
    frozenSnapshot,
    frozenResult,
  }).returning();
  res.status(201).json(CreateAllocationResponse.parse(response(saved)));
});

router.get("/allocations/:allocationId", async (req, res): Promise<void> => {
  const params = GetAllocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!validPathId(params.data)) {
    res.status(400).json({ error: "allocationId must be a positive safe integer." });
    return;
  }
  const [row] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, params.data.allocationId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Allocation version not found." });
    return;
  }
  res.json(GetAllocationResponse.parse(response(row)));
});

router.post("/allocations/:allocationId/replay", async (req, res): Promise<void> => {
  const params = ReplayAllocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!validPathId(params.data)) {
    res.status(400).json({ error: "allocationId must be a positive safe integer." });
    return;
  }
  const [row] = await db.select().from(allocationsTable)
    .where(eq(allocationsTable.id, params.data.allocationId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Allocation version not found." });
    return;
  }
  const snapshot = row.frozenSnapshot as PreparedSnapshot;
  const request = row.frozenRequest as AllocationRequest;
  const savedResult = row.frozenResult as AllocationResult;
  const differences: string[] = [];
  const expectedApiVersion = apiEngineVersion(request);
  const actualSnapshotHash = fingerprint(snapshot);
  if (actualSnapshotHash !== row.frozenSnapshotHash)
    differences.push("frozen prepared snapshot fingerprint mismatch");
  if (!snapshot || typeof snapshot !== "object" || !snapshot.dataset?.csvContent ||
    hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256)
    differences.push("frozen dataset content/hash mismatch");
  if (row.engineVersion.split("; ", 1)[0] !== expectedApiVersion)
    differences.push(`allocation engine version mismatch: saved=${row.engineVersion}, current=${expectedApiVersion}`);
  const expectedFingerprint = persistedFingerprint({
    preparedInputId: row.preparedInputId,
    representation: row.representation,
    engineVersion: row.engineVersion,
    request,
    snapshotHash: row.frozenSnapshotHash,
    result: savedResult,
  });
  if (expectedFingerprint !== row.fingerprint)
    differences.push("persisted allocation fingerprint mismatch");

  if (differences.length) {
    res.json(ReplayAllocationResponse.parse({
      allocationId: row.id,
      status: row.engineVersion.split("; ", 1)[0] !== expectedApiVersion ? "engine_mismatch" : "fail",
      fingerprint: row.fingerprint,
      differences,
      replayedResult: {},
    }));
    return;
  }

  let replayedResult: AllocationResult;
  try {
    replayedResult = optimizePreparedSnapshot(snapshot, request);
    if (request.robustness && replayedResult.status === "SOLVED" && replayedResult.robustness) {
      replayedResult.robustness.diagnostics = computeD4Diagnostics(
        request, replayedResult, (variant) => optimizePreparedSnapshot(snapshot, variant),
      ) as Record<string, unknown>;
    }
  } catch (error) {
    res.json(ReplayAllocationResponse.parse({
      allocationId: row.id,
      status: "fail",
      fingerprint: row.fingerprint,
      differences: [error instanceof Error ? error.message : "Allocation replay failed."],
      replayedResult: {},
    }));
    return;
  }
  const replayedEngineVersion = engineVersion(replayedResult, request);
  const incompatibleEngine = replayedEngineVersion !== row.engineVersion;
  if (incompatibleEngine)
    differences.push(`solver/engine version mismatch: saved=${row.engineVersion}, replayed=${replayedEngineVersion}`);
  differences.push(...resultDifferences(savedResult, replayedResult));
  res.json(ReplayAllocationResponse.parse({
    allocationId: row.id,
    status: incompatibleEngine ? "engine_mismatch" : differences.length === 0 ? "pass" : "fail",
    fingerprint: row.fingerprint,
    differences,
    maximumNumericDifference: maximumNumericDifference(savedResult, replayedResult),
    replayedResult,
  }));
});

export default router;