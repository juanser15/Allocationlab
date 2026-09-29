// @ts-expect-error quadprog 2.0.0 does not publish TypeScript declarations.
import { solveQP } from "quadprog";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";
import {
  buildStatisticalFactorRiskModel, decomposeStatisticalFactorRisk, type D1StatisticalFactorRiskModel,
} from "./d1-factor-model";
import { optimizeSignedOverlay } from "./signed-overlay-d2";
import { D4_SOLVER_VERSION, solveRobustMeanUncertainty } from "./robust-solver-d4";
import {
  prepareCostAwarePlan, summarizeCostAware, type CostAwarePlan, type CostAwareRequest,
} from "./cost-aware-d5";
import {
  prepareRebalanceRegularizationPlan, type RebalanceRegularizationPlan,
  type RebalanceRegularizationRequest,
} from "./rebalance-regularization";
import {
  estimateForecast, portfolioForecastUncertainty, type ForecastModelConfig, type ForecastResult,
  type PortfolioForecastUncertainty,
} from "./forecast-d3";
import { buildSignalRidgeForecast } from "./signal-ridge-forecast";

export type AllocationRepresentation = "asset_returns" | "alpha_streams" | "signals";
export type AllocationMode = "CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY";
export interface SignedOverlayConstraints {
  alphaBounds?: Record<string, { min?: number; max?: number }>;
  grossAlphaMax?: number;
  groupGrossCaps?: Array<{ group: string; candidateIds: string[]; max: number }>;
  assetBounds?: Record<string, { min?: number; max?: number }>;
  grossAssetMax?: number;
  netAssetExposure?: { min?: number; max?: number };
  cash?: { min?: number; max?: number };
}
export type AllocationObjective =
  | { type: "minimum_variance"; gamma: number; eta: number }
  | { type: "regularized_mean_variance"; gamma: number; eta: number };
export interface AllocationRobustness {
  method: "NOMINAL" | "ROBUST_MEAN_UNCERTAINTY";
  kappa: number;
}
export interface RobustnessDiagnostics {
  method: AllocationRobustness["method"];
  kappa: number;
  robustHaircut: number;
  objectiveTotal: number;
  solver: { name: string; version: string; optimalityTolerance: number; constraintTolerance: number };
  nominalWeights?: Record<string, number>;
  robustWeights?: Record<string, number>;
  diagnostics?: Record<string, unknown>;
}

export interface AllocationRequest {
  preparedInputId: number;
  candidateIds: string[];
  informationCutoff: string;
  decisionTimestamp: string;
  estimationWindow: number;
  minObservations: number;
  representation: AllocationRepresentation;
  returnConvention: "daily_decimal";
  expectedReturnShrinkage: number;
  forecastModel?: ForecastModelConfig;
  robustness?: AllocationRobustness;
  costAware?: CostAwareRequest;
  rebalanceRegularization?: RebalanceRegularizationRequest;
  covarianceDiagonalShrinkage: number;
  allocationMode?: AllocationMode;
  signedConstraints?: SignedOverlayConstraints;
  targetExcessReturn?: number;
  riskModel?: {
    type: "SAMPLE" | "DIAGONAL_SHRINKAGE" | "STATISTICAL_FACTOR";
    factorCount?: number;
    specificRiskFloorFraction?: number;
  };
  dailyCashYield: number;
  objective: AllocationObjective;
  constraints: {
    candidateBounds?: Record<string, { min?: number; max?: number }>;
    totalCash?: { min?: number; max?: number };
    assetBounds?: Record<string, { min?: number; max?: number }>;
    groupCaps?: Array<{ name: string; candidateIds: string[]; max: number }>;
    unsupported?: string[];
  };
}

export type AllocationStatus =
  | "SOLVED"
  | "INFEASIBLE"
  | "INVALID_INPUT"
  | "INVALID_RISK_MODEL"
  | "INSUFFICIENT_HISTORY_OR_DIMENSION"
  | "INVALID_FACTOR_MODEL"
  | "UNSUPPORTED"
  | "NUMERICAL_FAILURE"
  | "LIMIT_REACHED"
  | "UNBOUNDED"
  | "MISSING_TARGET_EXCESS_RETURN"
  | "INVALID_FORECAST_MODEL"
  | "UNAVAILABLE_HISTORICAL_VIEWS";

export interface AllocationModel {
  candidateIds: string[];
  assetTickers: string[];
  dates: string[];
  observationCount: number;
  sampleMeans: number[];
  mu: number[];
  sigma: number[][];
  H: number[][];
  d: number[];
  netReturns: number[][];
  costs: { transactionCosts: number[][]; slippage: number[][]; total: number[][] };
  grossReturns: number[][];
  expectedReturnShrinkage: number;
  covarianceDiagonalShrinkage: number;
  covarianceFormula: string;
  riskModel?: AllocationResult["riskModel"];
  returnUnits: "daily_decimal";
  decisionTimestamp: string;
  informationCutoff: string;
}

export interface SolverDiagnostics {
  name: string;
  version: string;
  status: string;
  primalResidual: number | null;
  dualResidual: number | null;
  scaledOptimalityResidual: number | null;
  maxConstraintViolation: number | null;
  psdTolerance: number;
  optimalityTolerance: number;
  constraintTolerance: number;
  iterations: number | null;
  message?: string;
}

export interface AllocationResult {
  status: AllocationStatus;
  reason?: string;
  model: AllocationModel | null;
  candidateWeights: Record<string, number> | null;
  assetWeights: Record<string, number> | null;
  totalCash: number | null;
  masterCash: number | null;
  estimatedGrossReturn: number | null;
  estimatedVolatility: number | null;
  objectiveContributions: {
    variance: number;
    regularization: number;
    candidateReturn: number;
    masterCashReturn: number;
    robustHaircut?: number;
    economicTransactionCost?: number;
    economicSlippage?: number;
    turnoverPreference?: number;
    total: number;
  } | null;
  constraintSlacks: Array<{ name: string; value: number; minSlack: number | null; maxSlack: number | null }>;
  solver: SolverDiagnostics;
  signedOverlay?: {
    alphaGrossExposure: number;
    netAlphaCoefficient: number;
    longAssetExposure: number;
    shortAssetExposure: number;
    grossAssetExposure: number;
    netAssetExposure: number;
    cashTarget: number;
    expectedExcessReturn: number;
    allocationMode: "SIGNED_OVERLAY";
  };
  riskModel?: {
    type: "SAMPLE" | "DIAGONAL_SHRINKAGE" | "STATISTICAL_FACTOR";
    factorCount?: number;
    specificRiskFloorFraction?: number;
    sampleCovariance: number[][];
    covariance: number[][];
    provenance: {
      candidateIds: string[];
      dates: string[];
      observationCount: number;
      alphaCount: number;
      informationCutoff: string;
      preparedInputId: number;
      datasetId: string | number | null;
      datasetHash: string;
    };
    factorModel?: D1StatisticalFactorRiskModel;
    sampleDiagnostics?: {
      covariance: number[][];
      correlation: number[][];
      covarianceEigenvalues: number[];
      correlationEigenvalues: number[];
      covarianceRank: number;
      covarianceConditionNumber: number | null;
      correlationConditionNumber: number | null;
    };
    sameWindowModels?: Record<"SAMPLE" | "DIAGONAL_SHRINKAGE" | "STATISTICAL_FACTOR", {
      covariance: number[][];
      expectedDailyVolatility: number | null;
    }>;
    decomposition?: Record<string, unknown>;
  };
  forecast?: Omit<ForecastResult, "status"> & {
    status: ForecastResult["status"] | "HISTORICAL_FORECAST_UNAVAILABLE" | "UNAVAILABLE_HISTORICAL_VIEWS";
    config: ForecastModelConfig;
    portfolio?: PortfolioForecastUncertainty;
  };
  robustness?: RobustnessDiagnostics;
  costAware?: ReturnType<typeof summarizeCostAware>;
  rebalanceRegularization?: {
    lambdaR: number;
    assets: string[];
    prices: Record<string, number>;
    assetMapping: Record<string, Record<string, number>>;
    candidateIds: string[];
    referenceAssetWeights: Record<string, number>;
    targetAssetWeights: Record<string, number>;
    penalty: number;
    solverEvidence: { name: string; version: string; optimalityResidual: number | null; feasibilityResidual: number | null };
  };
}

const SOLVER_VERSION = "2.0.0";
const PSD_TOLERANCE = 1e-10;
const OPTIMALITY_TOLERANCE = 1e-6;
const CONSTRAINT_TOLERANCE = 1e-8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;

type LinearConstraint = { name: string; coefficients: number[]; lower?: number; upper?: number };
type Point = { gross: number; net: number; transactionCost: number; slippage: number };

function failure(status: AllocationStatus, reason: string, model: AllocationModel | null = null,
  message = reason): AllocationResult {
  const result: AllocationResult = {
    status, reason, model, candidateWeights: null, assetWeights: null, totalCash: null, masterCash: null,
    estimatedGrossReturn: null, estimatedVolatility: null, objectiveContributions: null, constraintSlacks: [],
    solver: { name: "quadprog", version: SOLVER_VERSION, status, primalResidual: null, dualResidual: null,
      scaledOptimalityResidual: null, maxConstraintViolation: null, psdTolerance: PSD_TOLERANCE,
      optimalityTolerance: OPTIMALITY_TOLERANCE, constraintTolerance: CONSTRAINT_TOLERANCE,
      iterations: null, message },
  };
  if (model?.riskModel) result.riskModel = model.riskModel;
  return result;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTimestamp(value: string): boolean {
  return DATE_RE.test(value) && Number.isFinite(Date.parse(value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covarianceMatrix(rows: number[][]): number[][] {
  const n = rows[0].length;
  const averages = Array.from({ length: n }, (_, j) => mean(rows.map((row) => row[j])));
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    rows.reduce((sum, row) => sum + (row[i] - averages[i]) * (row[j] - averages[j]), 0) / (rows.length - 1)));
}

/** Reject asymmetry and negative eigenvalues beyond a scale-relative PSD tolerance. */
export function validateCovariance(matrix: number[][], tolerance = PSD_TOLERANCE): string | null {
  const n = matrix.length;
  if (!n || matrix.some((row) => row.length !== n || row.some((value) => !finite(value))))
    return "Covariance must be a nonempty finite square matrix.";
  let scale = 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    scale = Math.max(scale, Math.abs(matrix[i][j]));
    if (Math.abs(matrix[i][j] - matrix[j][i]) > tolerance * scale)
      return "Covariance is materially asymmetric.";
  }
  const a = matrix.map((row) => [...row]);
  for (let iter = 0; iter < 100 * n * n; iter++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest <= tolerance * scale) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const app = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const aqq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];
    for (let k = 0; k < n; k++) if (k !== p && k !== q) {
      const akp = c * a[k][p] - s * a[k][q];
      const akq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = akp;
      a[k][q] = a[q][k] = akq;
    }
    a[p][p] = app; a[q][q] = aqq; a[p][q] = a[q][p] = 0;
  }
  if (a.some((row, i) => row[i] < -tolerance * scale))
    return "Covariance is not positive semidefinite within the declared 1e-10 scale-relative tolerance.";
  return null;
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
}

function candidateReturns(candidate: PreparedCandidate, representation: AllocationRepresentation,
  cutoff: string, decision: string): Map<string, Point> {
  const points = new Map<string, Point>();
  if (representation === "asset_returns") {
    for (const item of candidate.returnSeries) {
      if (item.date <= cutoff && item.date <= decision && finite(item.value))
        points.set(item.date, { gross: item.value, net: item.value, transactionCost: 0, slippage: 0 });
    }
    return points;
  }
  const ledger = candidate.ledger as Array<{
    date: string; beginningNav: number; etfPnl: number; cashPnl: number; netPnl: number;
    transactionCosts: number; slippage: number;
  }>;
  for (const row of ledger) {
    if (row.date > cutoff || row.date > decision || !finite(row.beginningNav) || row.beginningNav <= 0 ||
      !finite(row.etfPnl) || !finite(row.cashPnl) || !finite(row.netPnl) ||
      !finite(row.transactionCosts) || !finite(row.slippage)) continue;
    points.set(row.date, {
      gross: (row.etfPnl + row.cashPnl) / row.beginningNav,
      net: row.netPnl / row.beginningNav,
      transactionCost: row.transactionCosts / row.beginningNav,
      slippage: row.slippage / row.beginningNav,
    });
  }
  return points;
}

function exposureAt(candidate: PreparedCandidate, decisionTimestamp: string, informationCutoff: string,
  assetTickers: string[]): { exposures: number[]; cash: number } | string {
  const history = candidate.targetHistory
    .filter((item) => item.signalDate <= decisionTimestamp && item.signalDate <= informationCutoff &&
      item.informationCutoff <= informationCutoff)
    .sort((a, b) => a.signalDate.localeCompare(b.signalDate));
  const latest = history.at(-1);
  if (!latest) return `Candidate ${candidate.candidateId} has no B1 target exposure available at the requested decision timestamp.`;
  const exposures = assetTickers.map((ticker) => latest.targetPositions[ticker] ?? 0);
  if (Object.keys(latest.targetPositions).some((ticker) => !assetTickers.includes(ticker)))
    return `Candidate ${candidate.candidateId} exposes an asset outside the selected underlying universe.`;
  if (exposures.some((value) => !finite(value) || value < -CONSTRAINT_TOLERANCE))
    return `Candidate ${candidate.candidateId} has an invalid or signed B1 target exposure.`;
  const invested = exposures.reduce((sum, value) => sum + value, 0);
  if (invested > 1 + CONSTRAINT_TOLERANCE) return `Candidate ${candidate.candidateId} target exposure exceeds unit capital.`;
  return { exposures, cash: Math.max(0, 1 - invested) };
}

function buildConstraints(request: AllocationRequest, candidateIds: string[], assets: string[], H: number[][],
  d: number[]): LinearConstraint[] | string {
  const n = candidateIds.length, size = n + 1;
  const unknownCandidateBounds = Object.keys(request.constraints.candidateBounds ?? {})
    .filter((id) => !candidateIds.includes(id));
  if (unknownCandidateBounds.length) return `Candidate bounds reference unselected IDs: ${unknownCandidateBounds.join(", ")}.`;
  const unknownAssetBounds = Object.keys(request.constraints.assetBounds ?? {}).filter((ticker) => !assets.includes(ticker));
  if (unknownAssetBounds.length) return `Asset bounds reference unexposed tickers: ${unknownAssetBounds.join(", ")}.`;
  const constraints: LinearConstraint[] = [];
  constraints.push({ name: "capital_budget", coefficients: [...Array(n).fill(1), 1], lower: 1, upper: 1 });
  constraints.push({ name: "master_cash_nonnegative", coefficients: [...Array(n).fill(0), 1], lower: 0 });
  for (const [i, id] of candidateIds.entries()) {
    const bound = request.constraints.candidateBounds?.[id] ?? {};
    const min = bound.min ?? 0, max = bound.max ?? 1;
    if (!finite(min) || !finite(max) || min < 0 || max > 1)
      return `Invalid long-only candidate bounds for ${id}.`;
    if (min > max) return `INFEASIBLE: Candidate ${id} lower bound exceeds its upper bound.`;
    const coefficients = Array.from({ length: size }, (_, j) => j === i ? 1 : 0);
    constraints.push({ name: `candidate:${id}`, coefficients, lower: min, upper: max });
  }
  for (const [i, ticker] of assets.entries()) {
    const bound = request.constraints.assetBounds?.[ticker] ?? {};
    const coefficients = [...H[i], 0];
    const min = bound.min, max = bound.max;
    if ((min !== undefined && (!finite(min) || min < 0)) ||
      (max !== undefined && (!finite(max) || max > 1)))
      return `Invalid underlying asset bounds for ${ticker}.`;
    if (min !== undefined && max !== undefined && min > max)
      return `INFEASIBLE: Underlying asset ${ticker} lower bound exceeds its upper bound.`;
    if (min !== undefined || max !== undefined)
      constraints.push({ name: `asset:${ticker}`, coefficients, lower: min, upper: max });
  }
  const cashBounds = request.constraints.totalCash ?? {};
  if ((cashBounds.min !== undefined && (!finite(cashBounds.min) || cashBounds.min < 0 || cashBounds.min > 1)) ||
    (cashBounds.max !== undefined && (!finite(cashBounds.max) || cashBounds.max < 0 || cashBounds.max > 1)))
    return "Invalid total-cash bounds.";
  if (cashBounds.min !== undefined && cashBounds.max !== undefined && cashBounds.min > cashBounds.max)
    return "INFEASIBLE: Total-cash lower bound exceeds its upper bound.";
  if (cashBounds.min !== undefined || cashBounds.max !== undefined)
    constraints.push({ name: "total_cash", coefficients: [...d, 1], lower: cashBounds.min, upper: cashBounds.max });
  for (const group of request.constraints.groupCaps ?? []) {
    if (!group.name || !Array.isArray(group.candidateIds) || group.candidateIds.some((id) => !candidateIds.includes(id)) ||
      !finite(group.max) || group.max < 0 || group.max > 1)
      return `Invalid candidate group cap ${group.name || "(unnamed)"}.`;
    const included = new Set(group.candidateIds);
    constraints.push({ name: `group:${group.name}`,
      coefficients: [...candidateIds.map((id) => included.has(id) ? 1 : 0), 0], upper: group.max });
  }
  return constraints;
}

function maxViolation(x: number[], constraints: LinearConstraint[]): number {
  return constraints.reduce((largest, constraint) => {
    const value = constraint.coefficients.reduce((sum, a, i) => sum + a * x[i], 0);
    return Math.max(largest, constraint.lower === undefined ? 0 : constraint.lower - value,
      constraint.upper === undefined ? 0 : value - constraint.upper);
  }, 0);
}

function slacks(x: number[], constraints: LinearConstraint[]) {
  return constraints.map((constraint) => {
    const value = constraint.coefficients.reduce((sum, a, i) => sum + a * x[i], 0);
    return { name: constraint.name, value,
      minSlack: constraint.lower === undefined ? null : value - constraint.lower,
      maxSlack: constraint.upper === undefined ? null : constraint.upper - value };
  });
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function quadratic(x: number[], matrix: number[][]): number {
  return dot(x, matrix.map((row) => dot(row, x)));
}

function scaledKktResidual(Hessian: number[][], linear: number[], x: number[],
  constraints: LinearConstraint[]): number {
  const gradient = Hessian.map((row, i) => dot(row, x) + linear[i]);
  const active = constraints.flatMap((constraint) => {
    const value = dot(constraint.coefficients, x);
    const result: Array<{ normal: number[]; equality: boolean }> = [];
    if (constraint.lower !== undefined && constraint.upper !== undefined &&
      Math.abs(constraint.upper - constraint.lower) <= 1e-12 && Math.abs(value - constraint.lower) <= 2e-7)
      result.push({ normal: constraint.coefficients, equality: true });
    else {
      if (constraint.lower !== undefined && Math.abs(value - constraint.lower) <= 2e-7)
        result.push({ normal: constraint.coefficients, equality: false });
      if (constraint.upper !== undefined && Math.abs(value - constraint.upper) <= 2e-7)
        result.push({ normal: constraint.coefficients.map((coefficient) => -coefficient), equality: false });
    }
    return result;
  });
  const normals = active.map((constraint) => constraint.normal);
  let multipliers = normals.map(() => 0);
  const lipschitz = Math.max(1e-12, normals.reduce((sum, normal) => sum + dot(normal, normal), 0));
  for (let iteration = 0; iteration < 4000; iteration++) {
    const residual = gradient.map((value, i) => value - normals.reduce((sum, normal, j) =>
      sum + normal[i] * multipliers[j], 0));
    let movement = 0;
    multipliers = multipliers.map((lambda, j) => {
      const candidate = lambda + dot(normals[j], residual) / lipschitz;
      const next = active[j].equality ? candidate : Math.max(0, candidate);
      movement = Math.max(movement, Math.abs(next - lambda));
      return next;
    });
    if (movement < 1e-12) break;
  }
  const residual = gradient.map((value, i) => value - normals.reduce((sum, normal, j) =>
    sum + normal[i] * multipliers[j], 0));
  const numerator = Math.sqrt(dot(residual, residual));
  const denominator = Math.max(1e-12, Math.sqrt(dot(gradient, gradient)),
    ...Hessian.map((row) => Math.sqrt(dot(row, row))));
  return numerator / denominator;
}

/**
 * Estimate and solve a long-only, unlevered B2 allocation from an immutable B1 snapshot.
 * The model uses complete common daily intervals, gross stream returns, daily decimal
 * units, sample covariance and explicit diagonal covariance shrinkage.
 */
export function optimizePreparedSnapshot(snapshot: PreparedSnapshot, request: AllocationRequest,
  plannedEstimationDates?: readonly string[]): AllocationResult {
  const lambdaR = request.rebalanceRegularization?.lambdaR;
  if (request.rebalanceRegularization !== undefined &&
    (typeof lambdaR !== "number" || !Number.isFinite(lambdaR) || lambdaR < 0))
    return failure("INVALID_INPUT", "rebalanceRegularization.lambdaR must be finite and nonnegative.");
  if (lambdaR !== undefined && lambdaR > 0 && request.costAware)
    return failure("UNSUPPORTED", "rebalanceRegularization cannot be combined with legacy costAware optimization.");
  if (lambdaR !== undefined && lambdaR > 0 && request.objective?.type !== "regularized_mean_variance")
    return failure("INVALID_INPUT", "Positive rebalanceRegularization requires regularized_mean_variance.");
  if (!request.costAware) return optimizePreparedSnapshotCore(snapshot, request, plannedEstimationDates);
  if (request.objective?.type === "minimum_variance")
    return failure("UNSUPPORTED", "D5 cost-aware optimization supports regularized_mean_variance only.");
  const candidateAssets = snapshot?.candidates?.filter((candidate) => request.candidateIds?.includes(candidate.candidateId))
    .flatMap((candidate) => candidate.assetTickers) ?? [];
  const plan = prepareCostAwarePlan(snapshot, request.costAware, candidateAssets, request.informationCutoff,
    request.allocationMode === "SIGNED_OVERLAY");
  if (typeof plan === "string") return failure("INVALID_INPUT", plan);
  const result = optimizePreparedSnapshotCore(snapshot, request, plannedEstimationDates);
  if (result.status === "SOLVED" && result.assetWeights)
    result.costAware = summarizeCostAware(plan, result.assetWeights, {
      name: result.solver.name, version: result.solver.version,
      optimalityResidual: result.solver.scaledOptimalityResidual,
      feasibilityResidual: result.solver.maxConstraintViolation,
    });
  return result;
}

function optimizePreparedSnapshotCore(snapshot: PreparedSnapshot, request: AllocationRequest,
  plannedEstimationDates?: readonly string[]): AllocationResult {
  if (request.forecastModel?.type === "SIGNAL_RIDGE" &&
    (request.representation !== "asset_returns" || request.allocationMode === "SIGNED_OVERLAY"))
    return failure("UNSUPPORTED", "SIGNAL_RIDGE supports underlying asset_returns in CAPITAL_LONG_ONLY only; alpha streams and signed overlays retain their existing forecast estimators.");
  if (request.allocationMode === "SIGNED_OVERLAY")
    return optimizeSignedOverlay(snapshot, request, plannedEstimationDates);
  if (request.representation === "signals")
    return failure("UNSUPPORTED", "UNSUPPORTED_REPRESENTATION: predictive signal optimization is not supported; select asset_returns or alpha_streams.");
  if (request.constraints?.unsupported?.length)
    return failure("UNSUPPORTED", `UNSUPPORTED_CONSTRAINT: ${request.constraints.unsupported.join(", ")}.`);
  if (!snapshot || !Array.isArray(snapshot.candidates) || snapshot.representation !== request.representation)
    return failure("INVALID_INPUT", "Selected preparation is missing or has a different representation.");
  if (!request.candidateIds.length || new Set(request.candidateIds).size !== request.candidateIds.length)
    return failure("INVALID_INPUT", "Select unique canonical candidate IDs; aliases cannot create extra allocation variables.");
  if (!validTimestamp(request.informationCutoff) || !validTimestamp(request.decisionTimestamp) ||
    request.informationCutoff > request.decisionTimestamp)
    return failure("INVALID_INPUT", "Information cutoff and decision timestamp must be valid and cutoff cannot follow the decision.");
  if (!Number.isInteger(request.estimationWindow) || request.estimationWindow < 2 ||
    !Number.isInteger(request.minObservations) || request.minObservations < 2 ||
    request.minObservations > request.estimationWindow)
    return failure("INVALID_INPUT", "Estimation window and minimum observations must be integers >= 2, with minimum no larger than window.");
  if (request.returnConvention !== "daily_decimal" || !finite(request.expectedReturnShrinkage) ||
    request.expectedReturnShrinkage < 0 || request.expectedReturnShrinkage > 1 ||
    !finite(request.covarianceDiagonalShrinkage) || request.covarianceDiagonalShrinkage < 0 ||
    request.covarianceDiagonalShrinkage > 1 || !finite(request.dailyCashYield))
    return failure("INVALID_INPUT", "Return convention, shrinkage strengths or daily cash yield are invalid.");
  if (request.forecastModel !== undefined && request.expectedReturnShrinkage !== 0)
    return failure("INVALID_FORECAST_MODEL",
      "forecastModel cannot be combined with nonzero legacy expectedReturnShrinkage; set legacy shrinkage to zero.");
  if (request.riskModel !== undefined &&
      (!request.riskModel || !["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"].includes(request.riskModel.type) ||
       (request.riskModel.factorCount !== undefined &&
         (!Number.isSafeInteger(request.riskModel.factorCount) || request.riskModel.factorCount < 1)) ||
       (request.riskModel.specificRiskFloorFraction !== undefined &&
         (!finite(request.riskModel.specificRiskFloorFraction) || request.riskModel.specificRiskFloorFraction < 0))))
    return failure("INVALID_INPUT", "Risk-model choice, factor count, or specific-risk floor is invalid.");
  if (request.riskModel && request.representation !== "alpha_streams")
    return failure("UNSUPPORTED", "D1 risk-model choices are supported only for alpha_streams; asset-return mode retains its existing covariance configuration.");
  if (!request.objective || !["minimum_variance", "regularized_mean_variance"].includes(request.objective.type) ||
    !finite(request.objective.gamma) || request.objective.gamma <= 0 ||
    !finite(request.objective.eta) || request.objective.eta < 0)
    return failure("INVALID_INPUT", "Objective parameters require gamma > 0 and eta >= 0.");
  if (request.robustness !== undefined &&
    (!request.robustness || !["NOMINAL", "ROBUST_MEAN_UNCERTAINTY"].includes(request.robustness.method) ||
      !finite(request.robustness.kappa) || request.robustness.kappa < 0))
    return failure("INVALID_INPUT", "Robustness method must be NOMINAL or ROBUST_MEAN_UNCERTAINTY and kappa must be finite and nonnegative.");
  const robustEnabled = request.robustness?.method === "ROBUST_MEAN_UNCERTAINTY" &&
    request.robustness.kappa > 0;
  if (robustEnabled && (!request.forecastModel || request.objective.type !== "regularized_mean_variance"))
    return failure("INVALID_FORECAST_MODEL",
      "Positive robust mean-uncertainty mode requires an explicit D3 forecastModel and regularized_mean_variance objective.");
  const chosen = request.candidateIds.map((id) => snapshot.candidates.find((candidate) =>
    candidate.candidateId === id && candidate.canonicalFingerprint === id));
  if (chosen.some((candidate) => !candidate))
    return failure("INVALID_INPUT", "One or more selected IDs are not canonical candidates in the selected preparation.");
  const candidates = chosen as PreparedCandidate[];
  for (const candidate of candidates) {
    if (candidate.status !== "READY")
      return failure("INVALID_INPUT", `Candidate ${candidate.candidateId} is ${candidate.status}: ${candidate.reasons.join("; ")}`);
    if (candidate.kind !== request.representation)
      return failure("INVALID_INPUT", `Candidate ${candidate.candidateId} representation does not match the request.`);
  }
  if (request.representation === "alpha_streams") {
    const assumptions = candidates.map((candidate) =>
      (candidate.lineage.definition as { cashYieldAnnual?: number } | undefined)?.cashYieldAnnual);
    if (assumptions.some((yieldRate) => !finite(yieldRate)) || new Set(assumptions).size !== 1)
      return failure("INVALID_INPUT", "Selected alpha streams do not have compatible frozen cash-yield assumptions.");
    const datasetHashes = candidates.map((candidate) => candidate.lineage.datasetHash);
    if (datasetHashes.some((hash) => typeof hash !== "string") || new Set(datasetHashes).size !== 1)
      return failure("INVALID_INPUT", "Selected alpha streams do not share the same frozen dataset/calendar identity.");
  }

  const streams = candidates.map((candidate) =>
    candidateReturns(candidate, request.representation, request.informationCutoff, request.decisionTimestamp));
  const common = [...streams[0].keys()].filter((date) => streams.every((stream) => stream.has(date))).sort();
  let dates: string[];
  if (plannedEstimationDates !== undefined) {
    if (!Array.isArray(plannedEstimationDates) || plannedEstimationDates.some((date, index) =>
      !validTimestamp(date) || date > request.informationCutoff ||
      (index > 0 && plannedEstimationDates[index - 1] >= date)))
      return failure("INVALID_INPUT", "Frozen estimation-date alignment must be strictly increasing valid dates no later than the information cutoff.");
    if (plannedEstimationDates.length < request.minObservations)
      return failure("INVALID_INPUT", `Frozen estimation-date alignment contains ${plannedEstimationDates.length} observations; ${request.minObservations} are required.`);
    if (plannedEstimationDates.length > request.estimationWindow)
      return failure("INVALID_INPUT", `Frozen estimation-date alignment contains ${plannedEstimationDates.length} observations; the configured lookback is ${request.estimationWindow}.`);
    const unavailable = plannedEstimationDates.filter((date) => !common.includes(date));
    if (unavailable.length)
      return failure("INVALID_INPUT", `Frozen estimation-date alignment is unavailable in every selected candidate at ${unavailable.join(", ")}.`);
    dates = [...plannedEstimationDates];
  } else {
    if (common.length < request.minObservations)
      return failure("INVALID_INPUT", `Only ${common.length} complete common observations are available; ${request.minObservations} are required.`);
    dates = common.slice(-request.estimationWindow);
  }
  if (dates.length < request.minObservations)
    return failure("INVALID_INPUT", `Estimation window contains ${dates.length} common observations; ${request.minObservations} are required.`);
  const grossReturns = streams.map((stream) => dates.map((date) => stream.get(date)!.gross));
  const netReturns = streams.map((stream) => dates.map((date) => stream.get(date)!.net));
  const transactionCosts = streams.map((stream) => dates.map((date) => stream.get(date)!.transactionCost));
  const slippage = streams.map((stream) => dates.map((date) => stream.get(date)!.slippage));
  if (grossReturns.some((series) => series.some((value) => !finite(value))))
    return failure("INVALID_INPUT", "A selected candidate has nonfinite gross returns in the requested window.");
  const sampleMeans = grossReturns.map(mean);
  let mu = sampleMeans.map((sampleMean) => (1 - request.expectedReturnShrinkage) * sampleMean +
    request.expectedReturnShrinkage * request.dailyCashYield);
  const sampleCovariance = covarianceMatrix(dates.map((_, row) => grossReturns.map((series) => series[row])));
  let factorModel: any;
  let sigma: number[][];
  const riskModelType = request.riskModel?.type;
  if (riskModelType === "STATISTICAL_FACTOR") {
    factorModel = buildStatisticalFactorRiskModel(
      dates.map((_, row) => grossReturns.map((series) => series[row])),
      candidates.map((candidate) => candidate.candidateId),
      request.riskModel?.factorCount,
      request.riskModel?.specificRiskFloorFraction ?? 1e-6,
    );
    if (factorModel.status !== "VALID") {
      const status = ["INSUFFICIENT_HISTORY_OR_DIMENSION", "INVALID_FACTOR_MODEL"].includes(factorModel.status)
        ? factorModel.status as AllocationStatus : "INVALID_RISK_MODEL";
      return failure(status, factorModel.reason ?? `Statistical factor model failed: ${factorModel.status}.`);
    }
    sigma = factorModel.gamma;
  } else {
    const shrinkage = riskModelType === "SAMPLE" ? 0 : request.covarianceDiagonalShrinkage;
    sigma = sampleCovariance.map((row, i) => row.map((value, j) =>
      (1 - shrinkage) * value + (i === j ? shrinkage * sampleCovariance[i][i] : 0)));
  }
  const covarianceError = validateCovariance(sigma);
  if (covarianceError) return failure("INVALID_RISK_MODEL", covarianceError);
  const diagonalShrinkageCovariance = sampleCovariance.map((row, i) => row.map((value, j) =>
    (1 - request.covarianceDiagonalShrinkage) * value +
    (i === j ? request.covarianceDiagonalShrinkage * sampleCovariance[i][i] : 0)));
  let forecast: AllocationResult["forecast"];
  if (request.forecastModel) {
    let estimated: ForecastResult;
    if (request.forecastModel.type === "SIGNAL_RIDGE") {
      try {
        estimated = buildSignalRidgeForecast({
          snapshot, config: request.forecastModel,
          candidateIds: candidates.map((candidate) => candidate.candidateId),
          assetTickers: candidates.map((candidate) => candidate.assetTickers[0]),
          informationCutoff: request.informationCutoff, decisionDate: request.decisionTimestamp.slice(0, 10),
          dailyCashYield: request.dailyCashYield, sigma,
        });
      } catch (error) {
        return failure("INVALID_FORECAST_MODEL",
          `SIGNAL_RIDGE cannot produce this forecast: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else estimated = estimateForecast({
      candidateIds: candidates.map((candidate) => candidate.candidateId),
      returns: dates.map((_, row) => grossReturns.map((series) => series[row])),
      dates,
      sigma,
      dailyCashYield: request.dailyCashYield,
      mode: "CAPITAL_LONG_ONLY",
      config: request.forecastModel,
      decisionCutoff: request.informationCutoff,
      fullHistory: {
        dates: common,
        returns: common.map((date) => streams.map((stream) => stream.get(date)!.gross)),
      },
    });
    const forecastStatus = (estimated as { status: string }).status;
    if (forecastStatus !== "OK") {
      const status = ["HISTORICAL_FORECAST_UNAVAILABLE", "UNAVAILABLE_HISTORICAL_VIEWS"]
        .includes(forecastStatus) ? "UNAVAILABLE_HISTORICAL_VIEWS" : "INVALID_FORECAST_MODEL";
      const failedResult = failure(status, estimated.reason ?? "Forecast model could not produce a valid forecast.");
      failedResult.forecast = { ...estimated, config: structuredClone(request.forecastModel) };
      return failedResult;
    }
    mu = estimated.muHat;
    forecast = { ...estimated, config: structuredClone(request.forecastModel) } as AllocationResult["forecast"];
  }

  const assets = request.representation === "asset_returns"
    ? [...new Set(candidates.flatMap((candidate) => candidate.assetTickers))].sort()
    : [...new Set(candidates.flatMap((candidate) => candidate.assetTickers))].sort();
  let H: number[][], d: number[];
  if (request.representation === "asset_returns") {
    H = assets.map((ticker) => candidates.map((candidate) => candidate.assetTickers.includes(ticker) ? 1 : 0));
    d = candidates.map(() => 0);
  } else {
    const cols = candidates.map((candidate) => exposureAt(candidate, request.decisionTimestamp, request.informationCutoff, assets));
    const invalid = cols.find((col) => typeof col === "string");
    if (invalid) return failure("INVALID_INPUT", invalid as string);
    H = assets.map((_, i) => (cols as Array<{ exposures: number[]; cash: number }>).map((col) => col.exposures[i]));
    d = (cols as Array<{ exposures: number[]; cash: number }>).map((col) => col.cash);
    for (let j = 0; j < candidates.length; j++) {
      if (Math.abs(H.reduce((sum, row) => sum + row[j], 0) + d[j] - 1) > CONSTRAINT_TOLERANCE)
        return failure("INVALID_INPUT", `Candidate ${candidates[j].candidateId} violates the B1 asset-plus-internal-cash identity.`);
    }
  }
  const riskModelSummary: AllocationResult["riskModel"] | undefined = request.riskModel ? {
    type: request.riskModel.type,
    ...(request.riskModel.type === "STATISTICAL_FACTOR" ? {
      factorCount: factorModel.factorCount,
      specificRiskFloorFraction: factorModel.specificRiskFloorFraction,
    } : {}),
    sampleCovariance,
    covariance: sigma,
    provenance: {
      candidateIds: candidates.map((candidate) => candidate.candidateId),
      dates: [...dates],
      observationCount: dates.length,
      alphaCount: candidates.length,
      informationCutoff: request.informationCutoff,
      preparedInputId: request.preparedInputId,
      datasetId: snapshot.dataset.id ?? null,
      datasetHash: snapshot.dataset.sha256,
    },
    ...(factorModel ? {
      factorModel,
      sampleDiagnostics: {
        covariance: sampleCovariance,
        correlation: factorModel.correlationMatrix,
        covarianceEigenvalues: factorModel.diagnostics.sampleEigenvalues,
        correlationEigenvalues: factorModel.eigenvalues,
        covarianceRank: factorModel.diagnostics.sampleCovarianceRank,
        covarianceConditionNumber: factorModel.diagnostics.sampleConditionNumber,
        correlationConditionNumber: factorModel.diagnostics.correlationConditionNumber,
      },
      // These are risk estimates on the SAME frozen return window, not extra
      // optimizer runs. Their volatility fields are filled with this solve's
      // common alpha weights once the selected model has solved.
      sameWindowModels: {
        SAMPLE: { covariance: sampleCovariance, expectedDailyVolatility: null },
        DIAGONAL_SHRINKAGE: { covariance: diagonalShrinkageCovariance, expectedDailyVolatility: null },
        STATISTICAL_FACTOR: { covariance: sigma, expectedDailyVolatility: null },
      },
    } : {}),
  } : undefined;
  const model: AllocationModel = {
    candidateIds: candidates.map((candidate) => candidate.candidateId), assetTickers: assets, dates,
    observationCount: dates.length, sampleMeans, mu, sigma, H, d, netReturns,
    costs: { transactionCosts, slippage,
      total: transactionCosts.map((series, j) => series.map((value, i) => value + slippage[j][i])) }, grossReturns,
    expectedReturnShrinkage: request.expectedReturnShrinkage,
    covarianceDiagonalShrinkage: request.covarianceDiagonalShrinkage,
    covarianceFormula: factorModel ? "Gamma=Xi+Omega*Phi*Omega'" :
      request.riskModel?.type === "SAMPLE" ? "Sigma=sample_covariance" :
        "Sigma=(1-delta)*sample_covariance+delta*diag(sample_covariance)",
    ...(riskModelSummary ? { riskModel: riskModelSummary } : {}),
    returnUnits: "daily_decimal", decisionTimestamp: request.decisionTimestamp, informationCutoff: request.informationCutoff,
  };
  let rebalancePlan: RebalanceRegularizationPlan | undefined;
  if (request.rebalanceRegularization?.lambdaR) {
    const prepared = prepareRebalanceRegularizationPlan(snapshot, request.rebalanceRegularization, assets,
      request.informationCutoff);
    if (typeof prepared === "string") return failure("INVALID_INPUT", prepared, model);
    rebalancePlan = prepared;
  }
  let costPlan: CostAwarePlan | undefined;
  if (request.costAware) {
    const planned = prepareCostAwarePlan(snapshot, request.costAware, assets, request.informationCutoff);
    if (typeof planned === "string") return failure("INVALID_INPUT", planned, model);
    costPlan = planned;
  }
  const constraints = buildConstraints(request, model.candidateIds, assets, H, d);
  if (typeof constraints === "string") return failure(constraints.startsWith("INFEASIBLE:") ? "INFEASIBLE" : "INVALID_INPUT",
    constraints.replace(/^INFEASIBLE:\s*/, ""), model);

  const n = candidates.length, baseSize = n + 1;
  const costAssetCount = costPlan?.hasPenalty ? costPlan.assets.length : 0;
  const size = baseSize + costAssetCount;
  if (costAssetCount) {
    for (const constraint of constraints) constraint.coefficients.push(...Array(costAssetCount).fill(0));
    for (const [assetIndex, ticker] of costPlan!.assets.entries()) {
      const auxiliary = Array.from({ length: size }, (_, i) => i === baseSize + assetIndex ? 1 : 0);
      const target = Array.from({ length: size }, (_, i) => i < n
        ? (assets.includes(ticker) ? H[assets.indexOf(ticker)][i] : 0) : 0);
      const current = costPlan!.currentWeights[ticker] ?? 0;
      constraints.push({ name: `abs_trade_positive:${ticker}`,
        coefficients: auxiliary.map((value, i) => value - target[i]), lower: -current });
      constraints.push({ name: `abs_trade_negative:${ticker}`,
        coefficients: auxiliary.map((value, i) => value + target[i]), lower: current });
      constraints.push({ name: `abs_trade_nonnegative:${ticker}`, coefficients: auxiliary, lower: 0 });
    }
  }
  const gamma = request.objective.type === "minimum_variance" ? 1 : request.objective.gamma;
  const Hessian = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) =>
    i < n && j < n ? gamma * sigma[i][j] + (i === j && request.objective.type === "regularized_mean_variance" ? request.objective.eta : 0) : 0));
  const rebalanceMap = rebalancePlan?.assets.map((ticker) => assets.includes(ticker)
    ? H[assets.indexOf(ticker)] : Array(n).fill(0)) ?? [];
  const rebalanceReference = rebalancePlan?.assets.map((ticker) => rebalancePlan!.referenceAssetWeights[ticker]) ?? [];
  if (rebalancePlan) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
      Hessian[i][j] += rebalancePlan.lambdaR * rebalanceMap.reduce((sum, row) => sum + row[i] * row[j], 0);
  }
  const penaltyRate = costPlan && costPlan.hasPenalty
    ? (costPlan.transactionCostBps + costPlan.slippageBps + costPlan.turnoverPreferenceBps) /
      (10_000 * costPlan.costAmortizationDays) : 0;
  const linear = [...(request.objective.type === "regularized_mean_variance" ? mu.map((value) => -value) : Array(n).fill(0)),
    request.objective.type === "regularized_mean_variance" ? -request.dailyCashYield : 0,
    ...Array(costAssetCount).fill(penaltyRate)];
  if (rebalancePlan) for (let i = 0; i < n; i++)
    linear[i] -= rebalancePlan.lambdaR * rebalanceMap.reduce((sum, row, assetIndex) =>
      sum + row[i] * rebalanceReference[assetIndex], 0);

  let robustSolve: ReturnType<typeof solveRobustMeanUncertainty> | undefined;
  // quadprog uses a strictly convex Cholesky factorization. Flat PSD directions
  // are numerically regularized only for candidate generation; an independent KKT
  // check against the unmodified objective below rejects a changed/nonoptimal result.
  const scale = Math.max(1, ...Hessian.flat().map(Math.abs));
  let diagonalLift = 0;
  let solution: number[];
  let iterations: number | null = null;
  try {
    if (robustEnabled) {
      if (!forecast || forecast.status !== "OK")
        return failure("INVALID_FORECAST_MODEL", "A valid D3 forecast with V_mu is required for robust optimization.", model);
      robustSolve = solveRobustMeanUncertainty(Hessian, linear, forecast.V_mu, constraints,
        request.robustness!.kappa, size);
      solution = robustSolve.solution;
      iterations = robustSolve.iterations;
    } else {
    const constraintsForSolver = constraints.flatMap((constraint) => {
      const result: Array<{ coefficients: number[]; bound: number; equality: boolean }> = [];
      if (constraint.lower !== undefined && constraint.upper !== undefined &&
        Math.abs(constraint.upper - constraint.lower) <= 1e-14) {
        result.push({ coefficients: constraint.coefficients, bound: constraint.lower, equality: true });
      } else {
        if (constraint.lower !== undefined) result.push({ coefficients: constraint.coefficients, bound: constraint.lower, equality: false });
        if (constraint.upper !== undefined) result.push({ coefficients: constraint.coefficients.map((value) => -value),
          bound: -constraint.upper, equality: false });
      }
      return result;
    }).sort((a, b) => Number(b.equality) - Number(a.equality));
    const equalityCount = constraintsForSolver.filter((constraint) => constraint.equality).length;
    const qpMatrix = (matrix: number[][]) => [[0, ...Array(size).fill(0)], ...matrix.map((row) => [0, ...row])];
    const qpVector = (vector: number[]) => [0, ...vector];
    const qpConstraints = [[0, ...Array(constraintsForSolver.length).fill(0)],
      ...Array.from({ length: size }, (_, i) =>
        [0, ...constraintsForSolver.map((constraint) => constraint.coefficients[i])])];
    let solved: { solution?: number[]; iterations?: number[]; message?: string };
    const run = (matrix: number[][]) => solveQP(qpMatrix(matrix), qpVector(linear.map((value) => -value)),
      qpConstraints, qpVector(constraintsForSolver.map((constraint) => constraint.bound)), equalityCount) as
      { solution?: number[]; iterations?: number[]; message?: string };
    solved = run(Hessian);
    if (!solved.solution || solved.message) {
      if (!/not positive definite/i.test(solved.message ?? "")) throw new Error(solved.message ?? "QP solver did not return a solution.");
      // Preserve zero-variance PSD dimensions: the solver's infinitesimal lift
      // selects a point on a flat face, never changes the reported model. Acceptance
      // is still against the exact unlifted KKT conditions.
      diagonalLift = scale * 1e-12;
      const lifted = Hessian.map((row, i) => row.map((value, j) => value + (i === j ? diagonalLift : 0)));
      solved = run(lifted);
    }
    if (!solved.solution || solved.message) throw new Error(solved.message ?? "QP solver did not return a solution.");
    solution = solved.solution.slice(1);
    iterations = solved.iterations ? solved.iterations.slice(1).reduce((sum, value) => sum + value, 0) : null;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const infeasible = /infeasible|constraints are inconsistent/i.test(detail);
    return failure(infeasible ? "INFEASIBLE" : "NUMERICAL_FAILURE",
      infeasible ? "Supported constraints are infeasible." : `QP solver failed: ${detail}`, model, detail);
  }
  if (!solution! || solution!.length !== size || solution!.some((value) => !finite(value)))
    return failure("NUMERICAL_FAILURE", "QP solver returned a nonfinite or dimensionally invalid solution.", model);
  const x = solution!;
  const violation = Math.max(0, maxViolation(x, constraints));
  const primalResidual = Math.max(violation, Math.abs(x.slice(0, baseSize).reduce((sum, value) => sum + value, 0) - 1));
  const optimalityResidual = robustSolve?.stationarityResidual ?? scaledKktResidual(Hessian, linear, x, constraints);
  if (violation > CONSTRAINT_TOLERANCE)
    return failure("NUMERICAL_FAILURE", `Independent feasibility check failed (maximum violation ${violation}).`, model);
  if (!finite(optimalityResidual) || optimalityResidual > OPTIMALITY_TOLERANCE)
    return failure("NUMERICAL_FAILURE", `Independent scaled KKT stationarity residual ${optimalityResidual} exceeds ${OPTIMALITY_TOLERANCE}.`, model);

  const weights = x.slice(0, n);
  const masterCash = x[n];
  const assetWeights = Object.fromEntries(assets.map((ticker, i) => [ticker,
    H[i].reduce((sum, h, j) => sum + h * weights[j], 0)]));
  const totalCash = masterCash + dot(d, weights);
  const estimatedGrossReturn = dot(mu, weights) + request.dailyCashYield * masterCash;
  const variance = Math.max(0, quadratic(weights, sigma));
  const estimatedVolatility = Math.sqrt(variance);
  const riskContribution = request.objective.type === "minimum_variance" ? 0.5 * variance : 0.5 * gamma * variance;
  const regularization = request.objective.type === "regularized_mean_variance"
    ? 0.5 * request.objective.eta * dot(weights, weights) : 0;
  const candidateReturn = request.objective.type === "regularized_mean_variance" ? -dot(mu, weights) : 0;
  const masterCashReturn = request.objective.type === "regularized_mean_variance"
    ? -request.dailyCashYield * masterCash : 0;
  const rebalancePenalty = rebalancePlan ? rebalancePlan.lambdaR / 2 * rebalancePlan.assets.reduce((sum, ticker, i) =>
    sum + ((assetWeights[ticker] ?? 0) - rebalanceReference[i]) ** 2, 0) : 0;
  const robustHaircut = robustSolve?.robustHaircut ?? 0;
  const costTrades = costPlan && costAssetCount
    ? costPlan.assets.map((ticker, i) => x[baseSize + i]) : [];
  const tradedFraction = costTrades.reduce((sum, value) => sum + value, 0);
  const economicTransactionCost = costPlan ? tradedFraction * costPlan.transactionCostBps /
    (10_000 * costPlan.costAmortizationDays) : 0;
  const economicSlippage = costPlan ? tradedFraction * costPlan.slippageBps /
    (10_000 * costPlan.costAmortizationDays) : 0;
  const turnoverPreference = costPlan ? tradedFraction * costPlan.turnoverPreferenceBps /
    (10_000 * costPlan.costAmortizationDays) : 0;
  if (costPlan && costAssetCount) {
    const reconciled = costPlan.assets.reduce((sum, ticker) =>
      sum + Math.abs((assetWeights[ticker] ?? 0) - (costPlan!.currentWeights[ticker] ?? 0)), 0);
    if (Math.abs(reconciled - tradedFraction) > 1e-7)
      return failure("NUMERICAL_FAILURE", "D5 trade auxiliary does not reconcile to the underlying asset trade vector.", model);
  }
  const objectiveTotal = riskContribution + regularization + candidateReturn + masterCashReturn + robustHaircut +
    economicTransactionCost + economicSlippage + turnoverPreference + rebalancePenalty;
  const solverName = rebalancePlan ? "D5 SIMPLE quadratic rebalance regularization / quadprog" :
    robustSolve ? "D4 exact parametric-QP / quadprog" : "quadprog / Goldfarb-Idnani";
  const solverVersion = rebalancePlan ? `D5-SIMPLE.1${robustSolve ? `+${D4_SOLVER_VERSION}` : ""}` :
    robustSolve ? D4_SOLVER_VERSION : SOLVER_VERSION;
  const result: AllocationResult = {
    status: "SOLVED", model, candidateWeights: Object.fromEntries(model.candidateIds.map((id, i) => [id, weights[i]])),
    assetWeights, totalCash, masterCash, estimatedGrossReturn, estimatedVolatility,
    objectiveContributions: { variance: riskContribution, regularization, candidateReturn, masterCashReturn,
      ...(robustHaircut ? { robustHaircut } : {}),
      ...(rebalancePlan ? { rebalanceRegularization: rebalancePenalty } : {}),
      ...(costPlan?.hasPenalty ? { economicTransactionCost, economicSlippage, turnoverPreference } : {}), total: objectiveTotal },
    constraintSlacks: slacks(x, constraints),
    solver: { name: solverName,
      version: solverVersion, status: "SOLVED",
      primalResidual, dualResidual: optimalityResidual, scaledOptimalityResidual: optimalityResidual,
      maxConstraintViolation: violation, psdTolerance: PSD_TOLERANCE, optimalityTolerance: OPTIMALITY_TOLERANCE,
      constraintTolerance: CONSTRAINT_TOLERANCE, iterations,
      message: robustSolve
        ? "Exact square-root robust objective KKT stationarity and independent primal feasibility checks passed."
        : diagonalLift ? `PSD flat-direction candidate lift ${diagonalLift}; exact objective KKT independently verified.` :
          "Exact objective KKT stationarity and independent primal feasibility checks passed." },
  };
  if (rebalancePlan) {
    const targetAssetWeights = Object.fromEntries(rebalancePlan.assets.map((ticker) =>
      [ticker, assetWeights[ticker] ?? 0]));
    result.rebalanceRegularization = {
      lambdaR: rebalancePlan.lambdaR,
      assets: [...rebalancePlan.assets],
      prices: { ...rebalancePlan.prices },
      assetMapping: Object.fromEntries(rebalancePlan.assets.map((ticker, i) =>
        [ticker, Object.fromEntries(model.candidateIds.map((id, j) => [id, rebalanceMap[i][j]]))])),
      candidateIds: [...model.candidateIds],
      referenceAssetWeights: { ...rebalancePlan.referenceAssetWeights },
      targetAssetWeights,
      penalty: rebalancePenalty,
      solverEvidence: { name: solverName, version: solverVersion,
        optimalityResidual, feasibilityResidual: violation },
    };
  }
  if (forecast) {
    const uncertainty = portfolioForecastUncertainty(forecast as ForecastResult, weights);
    if ("status" in uncertainty)
      return failure("INVALID_FORECAST_MODEL", uncertainty.reason, model);
    result.forecast = { ...forecast, portfolio: uncertainty };
  }
  if (request.robustness) {
    const nominalWeights = robustSolve
      ? Object.fromEntries(model.candidateIds.map((id, i) => [id, robustSolve!.nominalSolution[i]]))
      : Object.fromEntries(model.candidateIds.map((id, i) => [id, weights[i]]));
    result.robustness = {
      method: request.robustness.method, kappa: request.robustness.kappa, robustHaircut,
      objectiveTotal,
      solver: { name: solverName,
        version: solverVersion, optimalityTolerance: robustSolve ? 1e-8 : OPTIMALITY_TOLERANCE,
        constraintTolerance: CONSTRAINT_TOLERANCE },
      nominalWeights,
      ...(robustSolve ? { robustWeights: Object.fromEntries(model.candidateIds.map((id, i) => [id, weights[i]])) } : {}),
    };
  }
  if (riskModelSummary) {
    if (factorModel) {
      for (const model of Object.values(riskModelSummary.sameWindowModels!)) {
        const variance = quadratic(weights, model.covariance);
        if (!finite(variance) || variance < -1e-10)
          return failure("INVALID_RISK_MODEL", "Same-window expected risk is nonfinite or materially negative.", result.model);
        model.expectedDailyVolatility = Math.sqrt(Math.max(0, variance));
      }
    }
    result.riskModel = {
      ...riskModelSummary,
      ...(factorModel ? { decomposition: decomposeStatisticalFactorRisk(
        factorModel, candidates.map((candidate) => result.candidateWeights![candidate.candidateId]),
      ) } : {}),
    };
    result.model!.riskModel = result.riskModel;
  }
  return result;
}