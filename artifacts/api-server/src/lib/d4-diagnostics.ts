import type { AllocationRequest, AllocationResult } from "./allocation-b2";

export const D4_SHRINKAGE_DELTA = 0.1;
export const D4_ACTIVE_WEIGHT_TOLERANCE = 1e-10;
export const D4_BINDING_TOLERANCE = 1e-8;
const D4_PSD_RELATIVE_TOLERANCE = 1e-10;

type DiagnosticValue = number | null;
type SensitivityCase = {
  name: string;
  status: string;
  reason?: string;
  requestChanges?: Record<string, unknown>;
  metrics?: {
    candidateWeights: Record<string, number> | null;
    assetWeights: Record<string, number> | null;
    estimatedGrossReturn: DiagnosticValue;
    estimatedVolatility: DiagnosticValue;
    forecastStandardError: DiagnosticValue;
    totalCash: DiagnosticValue;
    relativeToBaseline: {
      candidateWeightHalfL1: DiagnosticValue;
      assetWeightHalfL1: DiagnosticValue;
      expectedReturnChange: DiagnosticValue;
      riskChange: DiagnosticValue;
      forecastStandardErrorChange: DiagnosticValue;
      exposureChanges: { gross: DiagnosticValue; net: DiagnosticValue; cash: DiagnosticValue };
      candidateWeightChanges: WeightChanges | null;
      assetWeightChanges: WeightChanges | null;
    };
  };
};
type WeightChanges = { signFlips: string[]; added: string[]; removed: string[] };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((child) => clone(child)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, clone(child)])) as T;
  }
  return value;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function difference(left: DiagnosticValue, right: DiagnosticValue): DiagnosticValue {
  return left !== null && right !== null ? left - right : null;
}

function alignedWeights(left: Record<string, number> | null | undefined,
  right: Record<string, number> | null | undefined): DiagnosticValue {
  if (!left || !right) return null;
  const ids = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  let sum = 0;
  for (const id of ids) sum += Math.abs((left?.[id] ?? 0) - (right?.[id] ?? 0));
  return sum / 2;
}

function weightChanges(base: Record<string, number> | null | undefined,
  changed: Record<string, number> | null | undefined): WeightChanges | null {
  if (!base || !changed) return null;
  const changes: WeightChanges = { signFlips: [], added: [], removed: [] };
  const ids = new Set([...Object.keys(base), ...Object.keys(changed)]);
  for (const id of ids) {
    const before = base[id] ?? 0;
    const after = changed[id] ?? 0;
    if (before * after < 0) changes.signFlips.push(id);
    if (Math.abs(before) <= D4_ACTIVE_WEIGHT_TOLERANCE &&
        Math.abs(after) > D4_ACTIVE_WEIGHT_TOLERANCE) changes.added.push(id);
    if (Math.abs(before) > D4_ACTIVE_WEIGHT_TOLERANCE &&
        Math.abs(after) <= D4_ACTIVE_WEIGHT_TOLERANCE) changes.removed.push(id);
  }
  return changes;
}

function forecastSe(result: AllocationResult): DiagnosticValue {
  const value = result.forecast?.portfolio?.standardError;
  return finite(value) ? value : null;
}

function portfolioExposure(result: AllocationResult) {
  const assets = result.assetWeights;
  const gross = result.signedOverlay?.grossAssetExposure ??
    (assets ? Object.values(assets).reduce((sum, weight) => sum + Math.abs(weight), 0) : null);
  const net = result.signedOverlay?.netAssetExposure ??
    (assets ? Object.values(assets).reduce((sum, weight) => sum + weight, 0) : null);
  return { gross, net, cash: finite(result.totalCash) ? result.totalCash : null };
}

function objective(result: AllocationResult) {
  const contribution = result.objectiveContributions;
  return {
    variance: finite(contribution?.variance) ? contribution.variance : null,
    regularization: finite(contribution?.regularization) ? contribution.regularization : null,
    candidateReturn: finite(contribution?.candidateReturn) ? contribution.candidateReturn : null,
    masterCashReturn: finite(contribution?.masterCashReturn) ? contribution.masterCashReturn : null,
    robustHaircut: finite(result.robustness?.robustHaircut) ? result.robustness.robustHaircut : 0,
    total: finite(contribution?.total) ? contribution.total : null,
  };
}

function bindingConstraints(result: AllocationResult) {
  return result.constraintSlacks.flatMap((slack) => {
    const sides: string[] = [];
    if (finite(slack.minSlack) && slack.minSlack <= D4_BINDING_TOLERANCE) sides.push("min");
    if (finite(slack.maxSlack) && slack.maxSlack <= D4_BINDING_TOLERANCE) sides.push("max");
    return sides.length ? [{ name: slack.name, sides, value: slack.value }] : [];
  });
}

function signedStatus(solve: (request: AllocationRequest) => AllocationResult, request: AllocationRequest) {
  try {
    const result = solve(request);
    if (result.status !== "SOLVED") return { status: result.status, reason: result.reason ?? result.solver.message, result };
    if (!result.candidateWeights)
      return { status: "INVALID_RESULT", reason: "Solved sensitivity result has no candidate weights.", result };
    return { status: result.status, result };
  } catch (error) {
    return { status: "ERROR", reason: error instanceof Error ? error.message : String(error), result: null };
  }
}

function caseMetrics(result: AllocationResult, baseline: AllocationResult): SensitivityCase["metrics"] {
  const changedExposure = portfolioExposure(result);
  const baseExposure = portfolioExposure(baseline);
  const changedReturn = finite(result.estimatedGrossReturn) ? result.estimatedGrossReturn : null;
  const baseReturn = finite(baseline.estimatedGrossReturn) ? baseline.estimatedGrossReturn : null;
  const changedRisk = finite(result.estimatedVolatility) ? result.estimatedVolatility : null;
  const baseRisk = finite(baseline.estimatedVolatility) ? baseline.estimatedVolatility : null;
  return {
    candidateWeights: result.candidateWeights,
    assetWeights: result.assetWeights,
    estimatedGrossReturn: changedReturn,
    estimatedVolatility: changedRisk,
    forecastStandardError: forecastSe(result),
    totalCash: finite(result.totalCash) ? result.totalCash : null,
    relativeToBaseline: {
      candidateWeightHalfL1: alignedWeights(baseline.candidateWeights, result.candidateWeights),
      assetWeightHalfL1: alignedWeights(baseline.assetWeights, result.assetWeights),
      expectedReturnChange: difference(changedReturn, baseReturn),
      riskChange: difference(changedRisk, baseRisk),
      forecastStandardErrorChange: difference(forecastSe(result), forecastSe(baseline)),
      exposureChanges: {
        gross: difference(changedExposure.gross, baseExposure.gross),
        net: difference(changedExposure.net, baseExposure.net),
        cash: difference(changedExposure.cash, baseExposure.cash),
      },
      candidateWeightChanges: weightChanges(baseline.candidateWeights, result.candidateWeights),
      assetWeightChanges: weightChanges(baseline.assetWeights, result.assetWeights),
    },
  };
}

function sensitivityCase(name: string, changes: Record<string, unknown>,
  request: AllocationRequest, baseline: AllocationResult,
  solve: (request: AllocationRequest) => AllocationResult): SensitivityCase {
  const outcome = signedStatus(solve, request);
  return {
    name,
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    requestChanges: changes,
    ...(outcome.status === "SOLVED" && outcome.result ? { metrics: caseMetrics(outcome.result, baseline) } : {}),
  };
}

function covarianceRisk(weights: Record<string, number> | null, ids: string[],
  covariance: number[][]): { status: "OK" | "INVALID_COVARIANCE" | "MISSING_WEIGHTS"; variance: number | null; volatility: number | null } {
  if (!weights) return { status: "MISSING_WEIGHTS", variance: null, volatility: null };
  if (covariance.length !== ids.length ||
      covariance.some((row) => row.length !== ids.length || row.some((value) => !finite(value))))
    return { status: "INVALID_COVARIANCE", variance: null, volatility: null };
  if (!isPositiveSemidefinite(covariance))
    return { status: "INVALID_COVARIANCE", variance: null, volatility: null };
  const w = ids.map((id) => weights[id] ?? 0);
  let variance = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++)
    variance += w[i] * covariance[i][j] * w[j];
  if (!finite(variance) || variance < -1e-10)
    return { status: "INVALID_COVARIANCE", variance: null, volatility: null };
  variance = Math.max(0, variance);
  return { status: "OK", variance, volatility: Math.sqrt(variance) };
}

/** Deterministic Jacobi eigensolver check, allowing only scale-relative roundoff. */
function isPositiveSemidefinite(matrix: number[][]): boolean {
  const size = matrix.length;
  let scale = 0;
  for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tolerance = D4_PSD_RELATIVE_TOLERANCE * scale;
  const values = matrix.map((row) => row.slice());
  for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
    if (Math.abs(values[i][j] - values[j][i]) > tolerance) return false;
    const average = (values[i][j] + values[j][i]) / 2;
    values[i][j] = values[j][i] = average;
  }
  const maxIterations = Math.max(1, 100 * size * size);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
      const magnitude = Math.abs(values[i][j]);
      if (magnitude > largest) { largest = magnitude; p = i; q = j; }
    }
    if (largest <= tolerance) {
      return values.every((row, index) => row[index] >= -tolerance);
    }
    const angle = 0.5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p]);
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const app = cosine * cosine * values[p][p] - 2 * sine * cosine * values[p][q] +
      sine * sine * values[q][q];
    const aqq = sine * sine * values[p][p] + 2 * sine * cosine * values[p][q] +
      cosine * cosine * values[q][q];
    for (let k = 0; k < size; k++) if (k !== p && k !== q) {
      const akp = cosine * values[k][p] - sine * values[k][q];
      const akq = sine * values[k][p] + cosine * values[k][q];
      values[k][p] = values[p][k] = akp;
      values[k][q] = values[q][k] = akq;
    }
    values[p][p] = app;
    values[q][q] = aqq;
    values[p][q] = values[q][p] = 0;
  }
  return false;
}

/**
 * Frozen D4 diagnostic comparison. Every solve uses the caller's frozen snapshot
 * through its callback; this module never modifies or substitutes covariance in
 * an optimization call.
 */
export function computeD4Diagnostics(
  request: AllocationRequest,
  baseline: AllocationResult,
  solve: (request: AllocationRequest) => AllocationResult,
): object {
  const nominalRequest: AllocationRequest = {
    ...request,
    robustness: { method: "NOMINAL", kappa: request.robustness?.kappa ?? 0 },
  };
  const nominalOutcome = signedStatus(solve, nominalRequest);
  const nominal: AllocationResult = nominalOutcome.result ?? {
    ...baseline,
    status: "INVALID_INPUT",
    reason: nominalOutcome.reason ?? "Nominal solve did not return a result.",
    candidateWeights: null,
    assetWeights: null,
    totalCash: null,
    masterCash: null,
    estimatedGrossReturn: null,
    estimatedVolatility: null,
    objectiveContributions: null,
    constraintSlacks: [],
    robustness: undefined,
    forecast: undefined,
    riskModel: undefined,
  };
  const nominalSolved = nominalOutcome.status === "SOLVED";
  const baselineSolved = baseline.status === "SOLVED";
  const robustWeights = baseline.candidateWeights;
  const nominalWeights = nominal.candidateWeights;
  const robustExposure = portfolioExposure(baseline);
  const nominalExposure = portfolioExposure(nominal);

  const comparison = {
    status: baselineSolved && nominalSolved ? "SOLVED" : "PARTIAL",
    baselineStatus: baseline.status,
    baselineReason: baseline.reason ?? null,
    nominalStatus: nominalOutcome.status,
    nominalReason: nominalOutcome.reason ?? nominal.reason ?? null,
    candidateWeightHalfL1: alignedWeights(robustWeights, nominalWeights),
    assetWeightHalfL1: alignedWeights(baseline.assetWeights, nominal.assetWeights),
    return: {
      robust: finite(baseline.estimatedGrossReturn) ? baseline.estimatedGrossReturn : null,
      nominal: finite(nominal.estimatedGrossReturn) ? nominal.estimatedGrossReturn : null,
      difference: difference(finite(baseline.estimatedGrossReturn) ? baseline.estimatedGrossReturn : null,
        finite(nominal.estimatedGrossReturn) ? nominal.estimatedGrossReturn : null),
    },
    risk: {
      robust: finite(baseline.estimatedVolatility) ? baseline.estimatedVolatility : null,
      nominal: finite(nominal.estimatedVolatility) ? nominal.estimatedVolatility : null,
      difference: difference(finite(baseline.estimatedVolatility) ? baseline.estimatedVolatility : null,
        finite(nominal.estimatedVolatility) ? nominal.estimatedVolatility : null),
    },
    forecastStandardError: {
      robust: forecastSe(baseline), nominal: forecastSe(nominal),
      difference: difference(forecastSe(baseline), forecastSe(nominal)),
    },
    exposure: {
      gross: { robust: robustExposure.gross, nominal: nominalExposure.gross,
        difference: difference(robustExposure.gross, nominalExposure.gross) },
      net: { robust: robustExposure.net, nominal: nominalExposure.net,
        difference: difference(robustExposure.net, nominalExposure.net) },
      cash: { robust: robustExposure.cash, nominal: nominalExposure.cash,
        difference: difference(robustExposure.cash, nominalExposure.cash) },
    },
    bindingConstraints: { robust: bindingConstraints(baseline), nominal: bindingConstraints(nominal) },
    objective: { robust: objective(baseline), nominal: objective(nominal) },
    membership: { added: [] as string[], removed: [] as string[], signFlips: [] as string[] },
  };

  const ids = new Set([...Object.keys(robustWeights ?? {}), ...Object.keys(nominalWeights ?? {})]);
  for (const id of ids) {
    const robust = robustWeights?.[id] ?? 0;
    const base = nominalWeights?.[id] ?? 0;
    if (Math.abs(robust) > D4_ACTIVE_WEIGHT_TOLERANCE && Math.abs(base) <= D4_ACTIVE_WEIGHT_TOLERANCE)
      comparison.membership.added.push(id);
    if (Math.abs(base) > D4_ACTIVE_WEIGHT_TOLERANCE && Math.abs(robust) <= D4_ACTIVE_WEIGHT_TOLERANCE)
      comparison.membership.removed.push(id);
    if (robust * base < 0) comparison.membership.signFlips.push(id);
  }

  const sensitivity: SensitivityCase[] = [];
  if (request.robustness?.method === "ROBUST_MEAN_UNCERTAINTY") {
    for (const multiplier of [0.5, 1, 1.5]) {
      const kappa = request.robustness.kappa * multiplier;
      sensitivity.push(sensitivityCase(`kappa_${multiplier}x`, { "robustness.kappa": kappa },
        { ...request, robustness: { ...request.robustness, kappa } }, baseline, solve));
    }
  } else {
    sensitivity.push({ name: "kappa", status: "NOT_APPLICABLE",
      reason: "Kappa sensitivity requires ROBUST_MEAN_UNCERTAINTY." });
  }

  const selectedShrinkage: { name: string; value: number; update: (value: number) => AllocationRequest } | null =
    request.forecastModel
      ? request.forecastModel.type === "SHRUNK_MEAN"
        ? {
          name: "forecastModel.shrinkage",
          value: request.forecastModel.shrinkage ?? 0,
          update: (value) => ({ ...request, forecastModel: { ...request.forecastModel!, shrinkage: value } }),
        }
        : request.forecastModel.type === "BAYESIAN_VIEWS" &&
          request.forecastModel.priorMean?.source === "SHRUNK_PRIOR"
          ? {
            name: "forecastModel.shrinkage",
            value: request.forecastModel.shrinkage ?? 0,
            update: (value) => ({ ...request, forecastModel: { ...request.forecastModel!, shrinkage: value } }),
          }
          : null
      : {
        name: "expectedReturnShrinkage",
        value: request.expectedReturnShrinkage,
        update: (value) => ({ ...request, expectedReturnShrinkage: value }),
      };
  if (selectedShrinkage) {
    const selected = selectedShrinkage;
    for (const delta of [-D4_SHRINKAGE_DELTA, D4_SHRINKAGE_DELTA]) {
      const value = Math.max(0, Math.min(1, selected.value + delta));
      const perturbed = selected.update(value);
      sensitivity.push(sensitivityCase(`${selected.name}_${delta > 0 ? "plus" : "minus"}_${D4_SHRINKAGE_DELTA}`,
        { [selected.name]: value, delta: value - selected.value }, perturbed, baseline, solve));
    }
  } else {
    sensitivity.push({
      name: "shrinkage", status: "NOT_APPLICABLE",
      reason: request.forecastModel?.type === "SAMPLE_MEAN"
        ? "SAMPLE_MEAN does not select a shrinkage parameter."
        : "No selected D3 shrinkage parameter applies to this forecast configuration.",
    });
  }

  const forecast = request.forecastModel;
  if (forecast?.type === "BAYESIAN_VIEWS" &&
      (!forecast.priorUncertainty || forecast.priorUncertainty.type === "TAU_SIGMA")) {
    const observationCount = baseline.forecast?.observationCount;
    const tau = (forecast.priorUncertainty?.type === "TAU_SIGMA" ? forecast.priorUncertainty.tau : undefined) ??
      (finite(observationCount) && observationCount > 0
      ? 1 / observationCount : null);
    if (tau === null) {
      sensitivity.push({ name: "tau", status: "NOT_APPLICABLE",
        reason: "TAU_SIGMA default tau requires the selected baseline forecast observation count." });
    } else {
      for (const multiplier of [0.75, 1, 1.25]) {
        const value = tau * multiplier;
        const perturbed: AllocationRequest = {
          ...request,
          forecastModel: {
            ...forecast,
          priorUncertainty: {
            ...(forecast.priorUncertainty?.type === "TAU_SIGMA" ? forecast.priorUncertainty : { type: "TAU_SIGMA" as const }),
            tau: value,
          },
          },
        };
        sensitivity.push(sensitivityCase(`tau_${multiplier}x`, { "forecastModel.priorUncertainty.tau": value },
          perturbed, baseline, solve));
      }
    }
  } else {
    sensitivity.push({ name: "tau", status: "NOT_APPLICABLE",
      reason: "Tau sensitivity requires BAYESIAN_VIEWS with TAU_SIGMA prior uncertainty." });
  }

  if (request.riskModel?.type === "STATISTICAL_FACTOR" && request.riskModel.factorCount !== undefined) {
    const factorCount = request.riskModel.factorCount;
    const validFactorCount = (count: number) => Number.isSafeInteger(count) && count >= 1 &&
      count < request.candidateIds.length && count < request.estimationWindow;
    for (const count of [factorCount! - 1, factorCount!, factorCount! + 1]) {
      if (validFactorCount(count)) {
        const perturbed = { ...request, riskModel: { ...request.riskModel, factorCount: count } };
        sensitivity.push(sensitivityCase(`factorCount_${count}`, { "riskModel.factorCount": count },
          perturbed, baseline, solve));
      } else {
        sensitivity.push({ name: `factorCount_${count}`, status: "NOT_APPLICABLE",
          reason: `Factor count ${count} is not valid for ${request.candidateIds.length} candidates and estimation window ${request.estimationWindow}.`,
          requestChanges: { "riskModel.factorCount": count } });
      }
    }
  } else {
    sensitivity.push({ name: "factorCount", status: "NOT_APPLICABLE",
      reason: "Factor-count sensitivity requires an explicit STATISTICAL_FACTOR model count." });
  }

  const uncertainty: Record<string, unknown> = { status: "UNAVAILABLE" };
  const riskModel = baseline.riskModel;
  if (riskModel?.covariance && riskModel.provenance.candidateIds.length === riskModel.covariance.length) {
    const covariance = riskModel.covariance;
    const ids = riskModel.provenance.candidateIds;
    const dependence = [-0.1, 0.1].map((delta) => {
      const changed = covariance.map((row, i) => row.map((value, j) =>
        i === j ? value : value * (1 + delta)));
      return {
        dependenceChange: delta,
        ...covarianceRisk(robustWeights, ids, changed),
      };
    });
    const alternates = Object.entries(riskModel.sameWindowModels ?? {}).map(([type, model]) => ({
      type,
      ...covarianceRisk(robustWeights, ids, model.covariance),
    }));
    uncertainty.status = "AVAILABLE";
    uncertainty.baseRiskModel = riskModel.type;
    uncertainty.sameWeights = robustWeights;
    uncertainty.base = covarianceRisk(robustWeights, ids, covariance);
    uncertainty.offDiagonalDependence = dependence;
    uncertainty.alternateEstimators = alternates;
  }

  return deepFreeze(clone({
    version: "D4.1",
    nominalRequest,
    comparison,
    sensitivity,
    covarianceUncertainty: uncertainty,
  }));
}