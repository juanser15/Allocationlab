// @ts-expect-error quadprog 2.0.0 does not publish TypeScript declarations.
import { solveQP } from "quadprog";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";
import {
  buildStatisticalFactorRiskModel, decomposeStatisticalFactorRisk,
  type D1StatisticalFactorRiskModel,
} from "./d1-factor-model";
import type {
  AllocationModel, AllocationRequest, AllocationResult, AllocationStatus, SolverDiagnostics,
  SignedOverlayConstraints,
} from "./allocation-b2";
import {
  estimateForecast, portfolioForecastUncertainty, type ForecastResult,
} from "./forecast-d3";

const SOLVER_VERSION = "2.0.0";
const TOL = 1e-8;
const OPT_TOL = 1e-6;
const PSD_TOL = 1e-10;

type Constraint = { name: string; coefficients: number[]; lower?: number; upper?: number };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function quadratic(x: number[], matrix: number[][]): number {
  return dot(x, matrix.map((row) => dot(row, x)));
}

function covariance(rows: number[][]): number[][] {
  const count = rows[0].length;
  const averages = Array.from({ length: count }, (_, i) => mean(rows.map((row) => row[i])));
  return Array.from({ length: count }, (_, i) => Array.from({ length: count }, (_, j) =>
    rows.reduce((sum, row) => sum + (row[i] - averages[i]) * (row[j] - averages[j]), 0) / (rows.length - 1)));
}

function validateCovariance(matrix: number[][]): boolean {
  const n = matrix.length;
  if (!n || matrix.some((row) => row.length !== n || row.some((value) => !finite(value)))) return false;
  const a = matrix.map((row) => [...row]);
  let scale = 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    scale = Math.max(scale, Math.abs(a[i][j]));
    if (Math.abs(a[i][j] - a[j][i]) > PSD_TOL * scale) return false;
  }
  for (let iteration = 0; iteration < 100 * n * n; iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest <= PSD_TOL * scale) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const app = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const aqq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];
    for (let k = 0; k < n; k++) if (k !== p && k !== q) {
      const akp = c * a[k][p] - s * a[k][q], akq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = akp;
      a[k][q] = a[q][k] = akq;
    }
    a[p][p] = app; a[q][q] = aqq; a[p][q] = a[q][p] = 0;
  }
  return a.every((row, i) => row[i] >= -PSD_TOL * scale);
}

function failure(status: AllocationStatus, reason: string, model: AllocationModel | null = null,
  message = reason): AllocationResult {
  const result: AllocationResult = {
    status, reason, model, candidateWeights: null, assetWeights: null, totalCash: null, masterCash: null,
    estimatedGrossReturn: null, estimatedVolatility: null, objectiveContributions: null, constraintSlacks: [],
    solver: { name: "quadprog", version: SOLVER_VERSION, status, primalResidual: null, dualResidual: null,
      scaledOptimalityResidual: null, maxConstraintViolation: null, psdTolerance: PSD_TOL,
      optimalityTolerance: OPT_TOL, constraintTolerance: TOL, iterations: null, message },
  };
  if (model?.riskModel) result.riskModel = model.riskModel;
  return result;
}

function constraintsFor(
  request: AllocationRequest, ids: string[], assets: string[], H: number[][],
  alphaCount: number, assetCount: number, total: number,
): Constraint[] | string {
  const signed: SignedOverlayConstraints = request.signedConstraints ?? {};
  const unknownAlpha = Object.keys(signed.alphaBounds ?? {}).filter((id) => !ids.includes(id));
  if (unknownAlpha.length) return `Alpha bounds reference unselected IDs: ${unknownAlpha.join(", ")}.`;
  const unknownAssets = Object.keys(signed.assetBounds ?? {}).filter((asset) => !assets.includes(asset));
  if (unknownAssets.length) return `Asset bounds reference unexposed tickers: ${unknownAssets.join(", ")}.`;
  const constraints: Constraint[] = [];
  const vector = (values: number[]) => [...values, ...Array(total - values.length).fill(0)];
  const addBounds = (name: string, coefficients: number[], bound: { min?: number; max?: number }): string | null => {
    const { min, max } = bound;
    if ((min !== undefined && !finite(min)) || (max !== undefined && !finite(max)))
      return `${name} bounds must be finite numbers.`;
    if (min !== undefined && max !== undefined && min > max) return `INFEASIBLE: ${name} lower bound exceeds its upper bound.`;
    if (min !== undefined || max !== undefined) constraints.push({ name, coefficients, lower: min, upper: max });
    return null;
  };
  for (let i = 0; i < alphaCount; i++) {
    const err = addBounds(`alpha:${ids[i]}`, vector(Array.from({ length: alphaCount }, (_, j) => i === j ? 1 : 0)),
      signed.alphaBounds?.[ids[i]] ?? {});
    if (err) return err;
  }
  if (signed.grossAlphaMax !== undefined) {
    if (!finite(signed.grossAlphaMax) || signed.grossAlphaMax < 0) return "grossAlphaMax must be finite and nonnegative.";
    const uStart = alphaCount;
    constraints.push({ name: "gross_alpha", coefficients: vector(Array.from({ length: total }, (_, i) =>
      i >= uStart && i < uStart + alphaCount ? 1 : 0)), upper: signed.grossAlphaMax });
    for (let i = 0; i < alphaCount; i++) {
      const a = Array.from({ length: total }, (_, j) => j === i ? 1 : 0);
      const u = Array.from({ length: total }, (_, j) => j === uStart + i ? 1 : 0);
      constraints.push({ name: `abs_alpha_pos:${ids[i]}`, coefficients: u.map((v, j) => v - a[j]), lower: 0 });
      constraints.push({ name: `abs_alpha_neg:${ids[i]}`, coefficients: u.map((v, j) => v + a[j]), lower: 0 });
      constraints.push({ name: `abs_alpha_nonnegative:${ids[i]}`, coefficients: u, lower: 0 });
    }
  }
  for (const group of signed.groupGrossCaps ?? []) {
    if (!group.group || !Array.isArray(group.candidateIds) || !group.candidateIds.length ||
      group.candidateIds.some((id) => !ids.includes(id)) || !finite(group.max) || group.max < 0)
      return `Invalid signed gross cap for group ${group.group || "(unnamed)"}.`;
    const uStart = alphaCount;
    constraints.push({ name: `group_gross:${group.group}`, coefficients: vector(Array.from({ length: total }, (_, i) =>
      i >= uStart && i < uStart + alphaCount && group.candidateIds.includes(ids[i - uStart]) ? 1 : 0)), upper: group.max });
    for (const id of group.candidateIds) {
      const i = ids.indexOf(id), u = Array.from({ length: total }, (_, j) => j === uStart + i ? 1 : 0);
      const a = Array.from({ length: total }, (_, j) => j === i ? 1 : 0);
      constraints.push({ name: `abs_group_pos:${group.group}:${id}`, coefficients: u.map((v, j) => v - a[j]), lower: 0 });
      constraints.push({ name: `abs_group_neg:${group.group}:${id}`, coefficients: u.map((v, j) => v + a[j]), lower: 0 });
      constraints.push({ name: `abs_group_nonnegative:${group.group}:${id}`, coefficients: u, lower: 0 });
    }
  }
  for (let i = 0; i < assetCount; i++) {
    const err = addBounds(`asset:${assets[i]}`, vector([...H[i], ...Array(total - alphaCount).fill(0)]),
      signed.assetBounds?.[assets[i]] ?? {});
    if (err) return err;
  }
  if (signed.grossAssetMax !== undefined) {
    if (!finite(signed.grossAssetMax) || signed.grossAssetMax < 0) return "grossAssetMax must be finite and nonnegative.";
    const vStart = total - assetCount;
    constraints.push({ name: "gross_asset", coefficients: vector(Array.from({ length: total }, (_, j) =>
      j >= vStart ? 1 : 0)), upper: signed.grossAssetMax });
    for (let i = 0; i < assetCount; i++) {
      const x = [...H[i], ...Array(total - alphaCount).fill(0)];
      const v = Array.from({ length: total }, (_, j) => j === vStart + i ? 1 : 0);
      constraints.push({ name: `abs_asset_pos:${assets[i]}`, coefficients: v.map((value, j) => value - x[j]), lower: 0 });
      constraints.push({ name: `abs_asset_neg:${assets[i]}`, coefficients: v.map((value, j) => value + x[j]), lower: 0 });
      constraints.push({ name: `abs_asset_nonnegative:${assets[i]}`, coefficients: v, lower: 0 });
    }
  }
  const net = Array.from({ length: total }, (_, j) => j < alphaCount ? H.reduce((sum, row) => sum + row[j], 0) : 0);
  const netError = addBounds("net_asset_exposure", net, signed.netAssetExposure ?? {});
  if (netError) return netError;
  if (signed.cash) {
    const { min, max } = signed.cash;
    if ((min !== undefined && !finite(min)) || (max !== undefined && !finite(max)))
      return "Cash bounds must be finite numbers.";
    if (min !== undefined && max !== undefined && min > max) return "INFEASIBLE: Cash lower bound exceeds its upper bound.";
    if (min !== undefined || max !== undefined)
      constraints.push({ name: "cash", coefficients: net, lower:
        max === undefined ? undefined : 1 - max, upper: min === undefined ? undefined : 1 - min });
  }
  return constraints;
}

function maxViolation(x: number[], constraints: Constraint[]): number {
  return constraints.reduce((largest, c) => {
    const value = dot(c.coefficients, x);
    return Math.max(largest, c.lower === undefined ? 0 : c.lower - value,
      c.upper === undefined ? 0 : value - c.upper);
  }, 0);
}

function constraintSlacks(x: number[], constraints: Constraint[]) {
  return constraints.map((constraint) => {
    const value = dot(constraint.coefficients, x);
    return { name: constraint.name, value,
      minSlack: constraint.lower === undefined ? null : value - constraint.lower,
      maxSlack: constraint.upper === undefined ? null : constraint.upper - value };
  });
}

function kktResidual(hessian: number[][], linear: number[], x: number[], constraints: Constraint[]): number {
  const gradient = hessian.map((row, i) => dot(row, x) + linear[i]);
  const active = constraints.flatMap((c) => {
    const value = dot(c.coefficients, x);
    const normals: Array<{ normal: number[]; equality: boolean }> = [];
    if (c.lower !== undefined && c.upper !== undefined && Math.abs(c.lower - c.upper) < 1e-12 &&
      Math.abs(value - c.lower) < 2e-7) normals.push({ normal: c.coefficients, equality: true });
    else {
      if (c.lower !== undefined && Math.abs(value - c.lower) < 2e-7)
        normals.push({ normal: c.coefficients, equality: false });
      if (c.upper !== undefined && Math.abs(value - c.upper) < 2e-7)
        normals.push({ normal: c.coefficients.map((v) => -v), equality: false });
    }
    return normals;
  });
  let multipliers = active.map(() => 0);
  for (let iteration = 0; iteration < 20000; iteration++) {
    let movement = 0;
    for (let j = 0; j < multipliers.length; j++) {
      const lambda = multipliers[j];
      const residual = gradient.map((value, i) => value - active.reduce((sum, item, k) =>
        sum + item.normal[i] * multipliers[k], 0));
      const norm = Math.max(1e-20, dot(active[j].normal, active[j].normal));
      const nextRaw = lambda + dot(active[j].normal, residual) / norm;
      const next = active[j].equality ? nextRaw : Math.max(0, nextRaw);
      movement = Math.max(movement, Math.abs(next - lambda));
      multipliers[j] = next;
    }
    if (movement < 1e-12) break;
  }
  const residual = gradient.map((value, i) => value - active.reduce((sum, item, j) =>
    sum + item.normal[i] * multipliers[j], 0));
  return Math.sqrt(dot(residual, residual)) /
    Math.max(1e-12, Math.sqrt(dot(gradient, gradient)), ...hessian.map((row) => Math.sqrt(dot(row, row))));
}

function cashReturnsByDate(candidates: PreparedCandidate[], dates: string[]): Map<string, number> | string {
  const output = new Map<string, number>();
  const annual = candidates.map((candidate) =>
    (candidate.lineage.definition as { cashYieldAnnual?: number } | undefined)?.cashYieldAnnual);
  if (annual.some((value) => !finite(value) || value <= -1) || new Set(annual).size !== 1)
    return "Selected alpha streams do not have compatible frozen cash-yield assumptions.";
  const annualRate = annual[0]!;
  const declaredFallback = (1 + annualRate) ** (1 / 252) - 1;
  for (const date of dates) {
    const observations: number[] = [];
    for (const candidate of candidates) {
      const entry = (candidate.ledger as Array<{ date: string; beginningCash?: number; cashPnl: number }>)
        .find((row) => row.date === date);
      if (entry && finite(entry.beginningCash) && Math.abs(entry.beginningCash) > 1e-12 && finite(entry.cashPnl))
        observations.push(entry.cashPnl / entry.beginningCash);
    }
    if (observations.some((value) => !finite(value)) ||
      observations.some((value) => Math.abs(value - observations[0]) > 1e-8))
      return `B1 cash-return histories disagree on ${date}.`;
    output.set(date, observations.length ? observations[0] : declaredFallback);
  }
  return output;
}

function expose(candidate: PreparedCandidate, decision: string, cutoff: string, assets: string[]):
  { exposures: number[] } | string {
  const latest = candidate.targetHistory.filter((item) => item.signalDate <= decision &&
    item.signalDate <= cutoff && item.informationCutoff <= cutoff)
    .sort((a, b) => a.signalDate.localeCompare(b.signalDate)).at(-1);
  if (!latest) return `Candidate ${candidate.candidateId} has no B1 target exposure available at the requested decision timestamp.`;
  if (Object.keys(latest.targetPositions).some((ticker) => !assets.includes(ticker)))
    return `Candidate ${candidate.candidateId} exposes an asset outside the selected underlying universe.`;
  const exposures = assets.map((ticker) => latest.targetPositions[ticker] ?? 0);
  if (exposures.some((value) => !finite(value) || value < -TOL) ||
    exposures.reduce((sum, value) => sum + value, 0) > 1 + TOL)
    return `Candidate ${candidate.candidateId} has invalid B1 long-only target exposures.`;
  return { exposures };
}

function matrixRank(matrix: number[][]): number {
  if (!matrix.length) return 0;
  const a = matrix.map((row) => [...row]);
  const rows = a.length, cols = a[0].length;
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col++) {
    let pivot = rank;
    for (let i = rank + 1; i < rows; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    if (Math.abs(a[pivot][col]) < 1e-10) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const scale = a[rank][col];
    for (let j = col; j < cols; j++) a[rank][j] /= scale;
    for (let i = 0; i < rows; i++) if (i !== rank) {
      const factor = a[i][col];
      for (let j = col; j < cols; j++) a[i][j] -= factor * a[rank][j];
    }
    rank++;
  }
  return rank;
}

function provedBounded(request: AllocationRequest, ids: string[], assets: string[], H: number[][],
  hessian: number[][]): boolean {
  const c = request.signedConstraints ?? {};
  if (c.grossAlphaMax !== undefined) return true;
  if (ids.every((id) => finite(c.alphaBounds?.[id]?.min) && finite(c.alphaBounds?.[id]?.max))) return true;
  if (c.grossAssetMax !== undefined && matrixRank(H) === ids.length) return true;
  if (assets.every((asset) => finite(c.assetBounds?.[asset]?.min) && finite(c.assetBounds?.[asset]?.max)) &&
    matrixRank(H) === ids.length) return true;
  // A strictly convex active objective is coercive and therefore bounded even
  // when the feasible region itself is not compact.
  return matrixRank(hessian.map((row) => row.slice(0, ids.length))) === ids.length;
}

function hasUnrestrictedDescent(request: AllocationRequest, n: number, hessian: number[][],
  linear: number[]): boolean {
  const c = request.signedConstraints ?? {};
  const hasConstraints = Object.keys(c.alphaBounds ?? {}).length > 0 ||
    (c.groupGrossCaps?.length ?? 0) > 0 || c.grossAlphaMax !== undefined ||
    Object.keys(c.assetBounds ?? {}).length > 0 || c.grossAssetMax !== undefined ||
    c.netAssetExposure !== undefined || c.cash !== undefined;
  if (hasConstraints) return false;
  const activeHessian = hessian.slice(0, n).map((row) => row.slice(0, n));
  const rank = matrixRank(activeHessian);
  const augmentedRank = matrixRank(activeHessian.map((row, i) => [...row, linear[i]]));
  return rank < n && augmentedRank > rank;
}

export function optimizeSignedOverlay(snapshot: PreparedSnapshot, request: AllocationRequest,
  plannedEstimationDates?: readonly string[]): AllocationResult {
  const reject = (status: AllocationStatus, reason: string) => failure(status, reason);
  if (!snapshot || snapshot.representation !== "alpha_streams" || !Array.isArray(snapshot.candidates))
    return reject("UNSUPPORTED", "SIGNED_OVERLAY is supported only for alpha_streams preparations.");
  if (request.constraints?.unsupported?.length)
    return reject("UNSUPPORTED", `UNSUPPORTED_CONSTRAINT: ${request.constraints.unsupported.join(", ")}.`);
  if (!validTimestamp(request.informationCutoff) || !validTimestamp(request.decisionTimestamp) ||
    request.informationCutoff > request.decisionTimestamp)
    return reject("INVALID_INPUT", "Information cutoff and decision timestamp must be valid and cutoff cannot follow the decision.");
  if (!request.candidateIds.length || new Set(request.candidateIds).size !== request.candidateIds.length)
    return reject("INVALID_INPUT", "Select unique canonical candidate IDs.");
  if (!Number.isInteger(request.estimationWindow) || request.estimationWindow < 2 ||
    !Number.isInteger(request.minObservations) || request.minObservations < 2 ||
    request.minObservations > request.estimationWindow)
    return reject("INVALID_INPUT", "Estimation window and minimum observations must be integers >= 2.");
  if (request.returnConvention !== "daily_decimal" || !finite(request.expectedReturnShrinkage) ||
    request.expectedReturnShrinkage < 0 || request.expectedReturnShrinkage > 1 ||
    !finite(request.covarianceDiagonalShrinkage) || request.covarianceDiagonalShrinkage < 0 ||
    request.covarianceDiagonalShrinkage > 1 || !request.objective ||
    !["minimum_variance", "regularized_mean_variance"].includes(request.objective.type) ||
    !finite(request.objective.gamma) || request.objective.gamma <= 0 ||
    !finite(request.objective.eta) || request.objective.eta < 0)
    return reject("INVALID_INPUT", "Return convention, shrinkage or objective parameters are invalid.");
  if (request.forecastModel !== undefined && request.expectedReturnShrinkage !== 0)
    return reject("INVALID_FORECAST_MODEL",
      "forecastModel cannot be combined with nonzero legacy expectedReturnShrinkage; set legacy shrinkage to zero.");
  if (request.objective.type === "minimum_variance" &&
    (!finite(request.targetExcessReturn) || request.targetExcessReturn <= 0))
    return reject("MISSING_TARGET_EXCESS_RETURN", "MISSING_TARGET_EXCESS_RETURN: signed minimum variance requires targetExcessReturn > 0.");
  const candidates = request.candidateIds.map((id) => snapshot.candidates.find((item) =>
    item.candidateId === id && item.canonicalFingerprint === id));
  if (candidates.some((candidate) => !candidate)) return reject("INVALID_INPUT", "Selected IDs must be canonical candidates.");
  const selected = candidates as PreparedCandidate[];
  if (selected.some((candidate) => candidate.status !== "READY" || candidate.kind !== "alpha_streams"))
    return reject("INVALID_INPUT", "Every signed-overlay candidate must be a READY alpha_stream.");
  if (request.riskModel !== undefined &&
    (!request.riskModel || !["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"].includes(request.riskModel.type) ||
      (request.riskModel.factorCount !== undefined &&
        (!Number.isSafeInteger(request.riskModel.factorCount) || request.riskModel.factorCount < 1)) ||
      (request.riskModel.specificRiskFloorFraction !== undefined &&
        (!finite(request.riskModel.specificRiskFloorFraction) || request.riskModel.specificRiskFloorFraction < 0))))
    return reject("INVALID_INPUT", "Risk-model choice is invalid.");
  const assumptions = selected.map((candidate) =>
    (candidate.lineage.definition as { cashYieldAnnual?: number } | undefined)?.cashYieldAnnual);
  if (assumptions.some((value) => !finite(value)) || new Set(assumptions).size !== 1)
    return reject("INVALID_INPUT", "Selected alpha streams do not share a frozen cash-yield assumption.");
  const returns = selected.map((candidate) => new Map((candidate.ledger as Array<{
    date: string; beginningNav: number; etfPnl: number; cashPnl: number; netPnl: number;
    transactionCosts: number; slippage: number;
  }>).filter((row) => row.date <= request.informationCutoff && row.date <= request.decisionTimestamp &&
    finite(row.beginningNav) && row.beginningNav > 0 && finite(row.etfPnl) && finite(row.cashPnl) &&
    finite(row.netPnl) && finite(row.transactionCosts) && finite(row.slippage))
    .map((row) => [row.date, row] as const)));
  const common = [...returns[0].keys()].filter((date) => returns.every((stream) => stream.has(date))).sort();
  let dates: string[];
  if (plannedEstimationDates) {
    if (plannedEstimationDates.length < request.minObservations ||
      plannedEstimationDates.length > request.estimationWindow ||
      plannedEstimationDates.some((date, i) => date > request.informationCutoff ||
        (i > 0 && plannedEstimationDates[i - 1] >= date)) ||
      plannedEstimationDates.some((date) => !common.includes(date)))
      return reject("INVALID_INPUT", "Frozen estimation dates are invalid or unavailable.");
    dates = [...plannedEstimationDates];
  } else {
    if (common.length < request.minObservations)
      return reject("INVALID_INPUT", `Only ${common.length} common observations are available.`);
    dates = common.slice(-request.estimationWindow);
  }
  if (dates.length < request.minObservations) return reject("INVALID_INPUT", "Too few aligned observations.");
  const cashSeries = cashReturnsByDate(selected, dates);
  if (typeof cashSeries === "string") return reject("INVALID_INPUT", cashSeries);
  const cashReturns = dates.map((date) => cashSeries.get(date)!);
  const grossReturns = selected.map((_, j) => dates.map((date) => {
    const row = returns[j].get(date)!;
    return (row.etfPnl + row.cashPnl) / row.beginningNav;
  }));
  const netReturns = selected.map((_, j) => dates.map((date) => returns[j].get(date)!.netPnl /
    returns[j].get(date)!.beginningNav));
  const transactionCosts = selected.map((_, j) => dates.map((date) =>
    returns[j].get(date)!.transactionCosts / returns[j].get(date)!.beginningNav));
  const slippage = selected.map((_, j) => dates.map((date) =>
    returns[j].get(date)!.slippage / returns[j].get(date)!.beginningNav));
  const excess = grossReturns.map((series) => series.map((value, i) => value - cashReturns[i]));
  const sampleMeans = excess.map(mean);
  let mu = sampleMeans.map((value) => (1 - request.expectedReturnShrinkage) * value);
  const sampleCovariance = covariance(dates.map((_, row) => excess.map((series) => series[row])));
  let factorModel: D1StatisticalFactorRiskModel | undefined;
  let sigma: number[][];
  if (request.riskModel?.type === "STATISTICAL_FACTOR") {
    const factorResult = buildStatisticalFactorRiskModel(dates.map((_, row) => excess.map((series) => series[row])),
      selected.map((candidate) => candidate.candidateId), request.riskModel.factorCount,
      request.riskModel.specificRiskFloorFraction ?? 1e-6);
    if (factorResult.status !== "VALID")
      return reject(factorResult.status === "INSUFFICIENT_HISTORY_OR_DIMENSION" ?
        "INSUFFICIENT_HISTORY_OR_DIMENSION" : "INVALID_RISK_MODEL", factorResult.reason ?? "Statistical factor model failed.");
    factorModel = factorResult;
    sigma = factorModel.gamma;
  } else {
    const shrinkage = request.riskModel?.type === "SAMPLE" ? 0 : request.covarianceDiagonalShrinkage;
    sigma = sampleCovariance.map((row, i) => row.map((value, j) =>
      (1 - shrinkage) * value + (i === j ? shrinkage * sampleCovariance[i][i] : 0)));
  }
  if (!validateCovariance(sigma)) return reject("INVALID_RISK_MODEL", "Excess-return covariance is not finite PSD.");
  let forecast: AllocationResult["forecast"];
  if (request.forecastModel) {
    const fullCash = cashReturnsByDate(selected, common);
    if (typeof fullCash === "string") return reject("INVALID_INPUT", fullCash);
    const estimated = estimateForecast({
      candidateIds: selected.map((candidate) => candidate.candidateId),
      returns: dates.map((_, row) => excess.map((series) => series[row])),
      dates,
      sigma,
      dailyCashYield: request.dailyCashYield,
      mode: "SIGNED_OVERLAY",
      config: request.forecastModel,
      decisionCutoff: request.informationCutoff,
      fullHistory: {
        dates: common,
        returns: common.map((date) => selected.map((_, j) => {
          const entry = returns[j].get(date)!;
          return (entry.etfPnl + entry.cashPnl) / entry.beginningNav - fullCash.get(date)!;
        })),
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
  const assets = [...new Set(selected.flatMap((candidate) => candidate.assetTickers))].sort();
  const columns = selected.map((candidate) => expose(candidate, request.decisionTimestamp, request.informationCutoff, assets));
  const badColumn = columns.find((item) => typeof item === "string");
  if (badColumn) return reject("INVALID_INPUT", badColumn as string);
  const H = assets.map((_, i) => (columns as Array<{ exposures: number[] }>).map((column) => column.exposures[i]));
  const ids = selected.map((candidate) => candidate.candidateId);
  const n = ids.length, m = assets.length;
  const useAlphaAbs = request.signedConstraints?.grossAlphaMax !== undefined ||
    (request.signedConstraints?.groupGrossCaps?.length ?? 0) > 0;
  const useAssetAbs = request.signedConstraints?.grossAssetMax !== undefined;
  const total = n + (useAlphaAbs ? n : 0) + (useAssetAbs ? m : 0);
  const constraints = constraintsFor(request, ids, assets, H, n, m, total);
  if (typeof constraints === "string")
    return reject(constraints.startsWith("INFEASIBLE:") ? "INFEASIBLE" : "INVALID_INPUT",
      constraints.replace(/^INFEASIBLE:\s*/, ""));
  const minimumVariance = request.objective.type === "minimum_variance";
  const gamma = minimumVariance ? 1 : request.objective.gamma;
  const hessian = Array.from({ length: total }, (_, i) => Array.from({ length: total }, (_, j) =>
    i < n && j < n ? gamma * sigma[i][j] + (i === j && !minimumVariance ? request.objective.eta : 0) : 0));
  const linear = [...(minimumVariance ? Array(n).fill(0) : mu.map((value) => -value)),
    ...Array(total - n).fill(0)];
  if (minimumVariance) constraints.push({ name: "target_excess_return", coefficients: [...mu, ...Array(total - n).fill(0)],
    lower: request.targetExcessReturn });
  if (!provedBounded(request, ids, assets, H, hessian)) {
    if (hasUnrestrictedDescent(request, n, hessian, linear))
      return failure("UNBOUNDED", "UNBOUNDED: a feasible unconstrained null-risk direction strictly decreases the signed objective.");
    return failure("NUMERICAL_FAILURE", "The selected explicit constraints do not certify boundedness; no allocation was returned.");
  }

  const model: AllocationModel = {
    candidateIds: ids, assetTickers: assets, dates, observationCount: dates.length, sampleMeans, mu, sigma, H,
    d: selected.map(() => 0), netReturns, costs: { transactionCosts, slippage,
      total: transactionCosts.map((series, j) => series.map((value, i) => value + slippage[j][i])) }, grossReturns,
    expectedReturnShrinkage: request.expectedReturnShrinkage,
    covarianceDiagonalShrinkage: request.covarianceDiagonalShrinkage,
    covarianceFormula: factorModel ? "Gamma=Xi+Omega*Phi*Omega' on aligned alpha excess returns" :
      request.riskModel?.type === "SAMPLE" ? "Sigma=sample_covariance(alpha excess returns)" :
        "Sigma=(1-delta)*sample_covariance(alpha excess returns)+delta*diag(sample covariance)",
    returnUnits: "daily_decimal", decisionTimestamp: request.decisionTimestamp, informationCutoff: request.informationCutoff,
  };
  const riskSummary: AllocationResult["riskModel"] | undefined = request.riskModel ? {
    type: request.riskModel.type,
    ...(factorModel ? { factorCount: factorModel.factorCount,
      specificRiskFloorFraction: factorModel.specificRiskFloorFraction } : {}),
    sampleCovariance, covariance: sigma,
    provenance: { candidateIds: ids, dates, observationCount: dates.length, alphaCount: n,
      informationCutoff: request.informationCutoff, preparedInputId: request.preparedInputId,
      datasetId: snapshot.dataset.id ?? null, datasetHash: snapshot.dataset.sha256 },
    ...(factorModel ? {
      factorModel,
      sampleDiagnostics: {
        covariance: sampleCovariance, correlation: factorModel.correlationMatrix,
        covarianceEigenvalues: factorModel.diagnostics.sampleEigenvalues,
        correlationEigenvalues: factorModel.eigenvalues,
        covarianceRank: factorModel.diagnostics.sampleCovarianceRank,
        covarianceConditionNumber: factorModel.diagnostics.sampleConditionNumber,
        correlationConditionNumber: factorModel.diagnostics.correlationConditionNumber,
      },
      sameWindowModels: {
        SAMPLE: { covariance: sampleCovariance, expectedDailyVolatility: null },
        DIAGONAL_SHRINKAGE: { covariance: sampleCovariance.map((row, i) => row.map((value, j) =>
          (1 - request.covarianceDiagonalShrinkage) * value +
          (i === j ? request.covarianceDiagonalShrinkage * sampleCovariance[i][i] : 0))),
        expectedDailyVolatility: null },
        STATISTICAL_FACTOR: { covariance: sigma, expectedDailyVolatility: null },
      },
    } : {}),
  } : undefined;
  if (riskSummary) model.riskModel = riskSummary;

  let solution: number[], iterations: number | null = null;
  const converted = constraints.flatMap((c) => {
    const result: Array<{ coefficients: number[]; bound: number; equality: boolean }> = [];
    if (c.lower !== undefined && c.upper !== undefined && Math.abs(c.upper - c.lower) <= 1e-14)
      result.push({ coefficients: c.coefficients, bound: c.lower, equality: true });
    else {
      if (c.lower !== undefined) result.push({ coefficients: c.coefficients, bound: c.lower, equality: false });
      if (c.upper !== undefined) result.push({ coefficients: c.coefficients.map((value) => -value),
        bound: -c.upper, equality: false });
    }
    return result;
  }).sort((a, b) => Number(b.equality) - Number(a.equality));
  const equalityCount = converted.filter((item) => item.equality).length;
  const qpMatrix = (matrix: number[][]) => [[0, ...Array(total).fill(0)], ...matrix.map((row) => [0, ...row])];
  const qpVector = (values: number[]) => [0, ...values];
  const qpConstraints = [[0, ...Array(converted.length).fill(0)],
    ...Array.from({ length: total }, (_, i) => [0, ...converted.map((item) => item.coefficients[i])])];
  const scale = Math.max(1, ...hessian.flat().map(Math.abs));
  let lift = 0;
  try {
    const run = (matrix: number[][]) => solveQP(qpMatrix(matrix), qpVector(linear.map((value) => -value)),
      qpConstraints, qpVector(converted.map((item) => item.bound)), equalityCount) as
      { solution?: number[]; iterations?: number[]; message?: string };
    let solved = run(hessian);
    if (!solved.solution || solved.message) {
      if (!/not positive definite/i.test(solved.message ?? "")) throw new Error(solved.message ?? "QP solver returned no solution.");
      lift = scale * 1e-12;
      solved = run(hessian.map((row, i) => row.map((value, j) => value + (i === j ? lift : 0))));
    }
    if (!solved.solution || solved.message) throw new Error(solved.message ?? "QP solver returned no solution.");
    solution = solved.solution.slice(1);
    iterations = solved.iterations?.slice(1).reduce((sum, value) => sum + value, 0) ?? null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/infeasible|constraints are inconsistent/i.test(detail))
      return failure("INFEASIBLE", "Signed overlay constraints are infeasible.", model, detail);
    return failure("NUMERICAL_FAILURE", `Signed QP solver failed: ${detail}`, model, detail);
  }
  if (solution.length !== total || solution.some((value) => !finite(value)))
    return failure("NUMERICAL_FAILURE", "QP solver returned an invalid signed solution.", model);
  const violation = Math.max(0, maxViolation(solution, constraints));
  const residual = kktResidual(hessian, linear, solution, constraints);
  if (violation > TOL) return failure("NUMERICAL_FAILURE", `Independent feasibility check failed: ${violation}.`, model);
  if (!finite(residual) || residual > OPT_TOL)
    return failure("NUMERICAL_FAILURE", `Independent signed-objective KKT residual ${residual} exceeds ${OPT_TOL}.`, model);
  const weights = solution.slice(0, n);
  const asset = H.map((row) => dot(row, weights));
  const assetWeights = Object.fromEntries(assets.map((ticker, i) => [ticker, asset[i]]));
  const netExposure = asset.reduce((sum, value) => sum + value, 0);
  const cashTarget = 1 - netExposure;
  const variance = Math.max(0, quadratic(weights, sigma));
  const riskContribution = minimumVariance ? 0.5 * variance : 0.5 * gamma * variance;
  const regularization = minimumVariance ? 0 : 0.5 * request.objective.eta * dot(weights, weights);
  const candidateReturn = minimumVariance ? 0 : -dot(mu, weights);
  const expectedExcess = dot(mu, weights);
  const result: AllocationResult = {
    status: "SOLVED", model, candidateWeights: Object.fromEntries(ids.map((id, i) => [id, weights[i]])),
    assetWeights, totalCash: cashTarget, masterCash: cashTarget,
    estimatedGrossReturn: mean(cashReturns) + expectedExcess, estimatedVolatility: Math.sqrt(variance),
    objectiveContributions: { variance: riskContribution, regularization, candidateReturn, masterCashReturn: 0,
      total: riskContribution + regularization + candidateReturn },
    constraintSlacks: constraintSlacks(solution, constraints),
    solver: { name: "quadprog / Goldfarb-Idnani", version: SOLVER_VERSION, status: "SOLVED",
      primalResidual: violation, dualResidual: residual, scaledOptimalityResidual: residual,
      maxConstraintViolation: violation, psdTolerance: PSD_TOL, optimalityTolerance: OPT_TOL,
      constraintTolerance: TOL, iterations,
      message: lift ? `QP candidate regularization ${lift}; exact unmodified objective KKT and constraints independently verified.` :
        "Exact objective KKT stationarity and independent primal feasibility checks passed." },
    signedOverlay: {
      alphaGrossExposure: weights.reduce((sum, value) => sum + Math.abs(value), 0),
      netAlphaCoefficient: weights.reduce((sum, value) => sum + value, 0),
      longAssetExposure: asset.reduce((sum, value) => sum + Math.max(value, 0), 0),
      shortAssetExposure: asset.reduce((sum, value) => sum + Math.max(-value, 0), 0),
      grossAssetExposure: asset.reduce((sum, value) => sum + Math.abs(value), 0),
      netAssetExposure: netExposure, cashTarget, expectedExcessReturn: expectedExcess, allocationMode: "SIGNED_OVERLAY",
    },
  };
  if (forecast) {
    const uncertainty = portfolioForecastUncertainty(forecast as ForecastResult, weights);
    if ("status" in uncertainty)
      return failure("INVALID_FORECAST_MODEL", uncertainty.reason, model);
    result.forecast = { ...forecast, portfolio: uncertainty };
  }
  if (riskSummary) {
    if (factorModel) {
      for (const modelEntry of Object.values(riskSummary.sameWindowModels!))
        modelEntry.expectedDailyVolatility = Math.sqrt(Math.max(0, quadratic(weights, modelEntry.covariance)));
    }
    result.riskModel = { ...riskSummary, ...(factorModel ? {
      decomposition: decomposeStatisticalFactorRisk(factorModel, weights),
    } : {}) };
    result.model!.riskModel = result.riskModel;
  }
  return result;
}