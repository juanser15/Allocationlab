/**
 * Deterministic statistical-factor risk construction for aligned gross daily
 * alpha returns. All covariance quantities remain in daily-decimal units.
 */

export const D1_DEFAULT_SPECIFIC_RISK_FLOOR_FRACTION = 1e-6;
export const D1_EIGEN_GAP_RELATIVE_TOLERANCE = 1e-8;
/** Relative tolerance used for correlation/covariance eigenvalue and variance checks. */
export const D1_NUMERICAL_TOLERANCE = 1e-10;

export type D1FactorModelFailureStatus =
  | "INSUFFICIENT_HISTORY_OR_DIMENSION"
  | "INVALID_FACTOR_MODEL"
  | "INVALID_RISK_MODEL";

export interface D1FactorModelDiagnostics {
  observationCount: number;
  alphaCount: number;
  factorCount: number;
  sampleVariances: number[];
  rawSpecificVariances: number[];
  specificVariances: number[];
  floorBoundAlphaIds: string[];
  floorAdjustedDiagonalAlphaIds: string[];
  sampleEigenvalues: number[];
  factorCovarianceEigenvalues: number[];
  sampleCovarianceRank: number;
  factorCovarianceRank: number;
  sampleConditionNumber: number | null;
  factorCovarianceConditionNumber: number | null;
  correlationConditionNumber: number | null;
  factorVarianceExplained: number[];
  cumulativeVarianceExplained: number[];
  commonFactorVarianceShare: number;
  specificRiskVarianceShare: number;
  factorBasisUnstable: boolean;
  warnings: string[];
  eigenGapRelativeTolerance: number;
  negativeEigenvalueRelativeTolerance: number;
  effectiveRankConvention: string;
  sampleEffectiveRank: number;
  factorCovarianceEffectiveRank: number;
}

export interface D1StatisticalFactorRiskModel {
  status: "VALID";
  candidateIds: string[];
  observationCount: number;
  alphaCount: number;
  factorCount: number;
  specificRiskFloorFraction: number;
  /** S: centered sample covariance using denominator T-1. */
  sampleCovariance: number[][];
  /** R: sample covariance normalized by sample standard deviations. */
  correlationMatrix: number[][];
  /** Eigenvectors of R are columns, in descending eigenvalue order. */
  eigenvectors: number[][];
  eigenvalues: number[];
  /** Omega = D V_F, indexed [alpha][factor]. */
  omega: number[][];
  /** Phi = diag(lambda_1 ... lambda_F). */
  phi: number[][];
  /** Xi is a diagonal specific-risk covariance matrix. */
  xi: number[][];
  /** Gamma = Xi + Omega Phi Omega'. */
  gamma: number[][];
  diagnostics: D1FactorModelDiagnostics;
}

export type D1FactorModelResult = D1StatisticalFactorRiskModel | {
  status: D1FactorModelFailureStatus;
  reason: string;
};

export interface D1FactorRiskDecomposition {
  [key: string]: unknown;
  status: "VALID";
  portfolioVariance: number;
  portfolioVolatility: number;
  factorExposure: number[];
  factorVarianceContributions: number[];
  factorVariance: number;
  specificVariance: number;
  alphaMarginalComponentRisk: Array<{
    marginalContributionToRisk: number | null;
    componentContributionToRisk: number | null;
  }>;
}

export type D1FactorRiskDecompositionResult = D1FactorRiskDecomposition | {
  [key: string]: unknown;
  status: "INVALID_RISK_MODEL";
  reason: string;
};

interface EigenResult {
  values: number[];
  /** Eigenvectors stored in columns. */
  vectors: number[][];
}

function fail(status: D1FactorModelFailureStatus, reason: string): D1FactorModelResult {
  return { status, reason };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function zeros(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, () => Array<number>(columns).fill(0));
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function maxAbs(matrix: number[][]): number {
  return matrix.reduce((largest, row) => Math.max(largest, ...row.map(Math.abs)), 0);
}

function symmetricEigen(matrix: number[][]): EigenResult {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const vectors = zeros(n, n);
  for (let i = 0; i < n; i++) vectors[i][i] = 1;

  // Maximum-pivot Jacobi rotations have deterministic pivot ties because scan
  // order is stable. They remain well-defined for repeated eigenvalues; in a
  // tied eigenspace the particular basis is not economically meaningful, so
  // the result is flagged by the caller.
  const scale = Math.max(maxAbs(a), Number.MIN_VALUE);
  const convergenceTolerance = Number.EPSILON * scale * Math.max(8, n * 4);
  const maxIterations = 100 * n * n;
  let converged = n < 2;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const absolute = Math.abs(a[i][j]);
        if (absolute > largest) { largest = absolute; p = i; q = j; }
      }
    }
    if (largest <= convergenceTolerance) { converged = true; break; }

    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < n; k++) {
      if (k !== p && k !== q) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = a[p][k] = c * akp - s * akq;
        a[k][q] = a[q][k] = s * akp + c * akq;
      }
      const vkp = vectors[k][p], vkq = vectors[k][q];
      vectors[k][p] = c * vkp - s * vkq;
      vectors[k][q] = s * vkp + c * vkq;
    }
  }
  if (!converged) throw new Error("Symmetric Jacobi eigensolver did not converge.");

  const order = Array.from({ length: n }, (_, index) => index)
    .sort((left, right) => a[right][right] - a[left][left] || left - right);
  const values = order.map((index) => a[index][index]);
  const orderedVectors = zeros(n, n);
  for (let factor = 0; factor < n; factor++) {
    const originalColumn = order[factor];
    for (let row = 0; row < n; row++) orderedVectors[row][factor] = vectors[row][originalColumn];
    let pivot = 0;
    for (let row = 1; row < n; row++)
      if (Math.abs(orderedVectors[row][factor]) > Math.abs(orderedVectors[pivot][factor])) pivot = row;
    if (orderedVectors[pivot][factor] < 0)
      for (let row = 0; row < n; row++) orderedVectors[row][factor] *= -1;
  }
  return { values, vectors: orderedVectors };
}

function covarianceEigenDiagnostics(eigen: EigenResult) {
  const scale = Math.max(...eigen.values.map(Math.abs), Number.MIN_VALUE);
  const tolerance = D1_NUMERICAL_TOLERANCE * scale;
  const positive = eigen.values.filter((value) => value > 0);
  const numericalPositive = eigen.values.filter((value) => value > tolerance);
  const totalPositive = positive.reduce((sum, value) => sum + value, 0);
  const effectiveRank = totalPositive > 0
    ? Math.exp(-positive.reduce((sum, value) => {
      const probability = value / totalPositive;
      return sum + probability * Math.log(probability);
    }, 0))
    : 0;
  const minEigenvalue = eigen.values.at(-1) ?? 0;
  const maxEigenvalue = eigen.values[0] ?? 0;
  return {
    rank: numericalPositive.length,
    effectiveRank,
    conditionNumber: minEigenvalue > tolerance ? maxEigenvalue / minEigenvalue : null,
    tolerance,
  };
}

function multiply(left: number[][], right: number[][]): number[][] {
  const result = zeros(left.length, right[0].length);
  for (let i = 0; i < left.length; i++) {
    for (let k = 0; k < right.length; k++) {
      const value = left[i][k];
      for (let j = 0; j < right[0].length; j++) result[i][j] += value * right[k][j];
    }
  }
  return result;
}

function reconstructCovariance(
  omega: number[][],
  phi: number[][],
  xi: number[][],
): number[][] {
  const common = multiply(multiply(omega, phi), transpose(omega));
  return common.map((row, i) => row.map((value, j) => value + xi[i][j]));
}

/**
 * Build the D1 correlation-PCA covariance model from rows of aligned,
 * finite gross daily decimal returns. Missing observations are rejected;
 * callers must perform exact date alignment before calling this function.
 */
export function buildStatisticalFactorRiskModel(
  matrix: number[][],
  candidateIds: string[],
  factorCount: number | undefined,
  specificRiskFloorFraction = D1_DEFAULT_SPECIFIC_RISK_FLOOR_FRACTION,
): D1FactorModelResult {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0]))
    return fail("INSUFFICIENT_HISTORY_OR_DIMENSION", "Return matrix must contain at least two dated observations and one alpha.");
  const observations = matrix.length;
  const alphaCount = matrix[0].length;
  if (observations < 2 || !alphaCount)
    return fail("INSUFFICIENT_HISTORY_OR_DIMENSION", "At least two observations and one alpha are required.");
  if (matrix.some((row) => !Array.isArray(row) || row.length !== alphaCount || row.some((value) => !finite(value))))
    return fail("INVALID_FACTOR_MODEL", "Return matrix must be rectangular with every aligned gross daily return finite; missing values are not replaced.");
  if (!Array.isArray(candidateIds) || candidateIds.length !== alphaCount ||
      candidateIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(candidateIds).size !== candidateIds.length)
    return fail("INVALID_FACTOR_MODEL", "Candidate IDs must uniquely match the return matrix's alpha columns.");
  if (!finite(specificRiskFloorFraction) || specificRiskFloorFraction < 0)
    return fail("INVALID_FACTOR_MODEL", "Specific-risk floor fraction must be finite and nonnegative.");

  const selectedFactorCount = factorCount === undefined
    ? Math.min(5, alphaCount - 1, observations - 1)
    : factorCount;
  if (!Number.isSafeInteger(selectedFactorCount) || selectedFactorCount < 1 ||
      selectedFactorCount >= alphaCount || selectedFactorCount >= observations)
    return fail("INSUFFICIENT_HISTORY_OR_DIMENSION",
      `Factor count F=${String(selectedFactorCount)} must satisfy 1 <= F < N=${alphaCount} and F < T=${observations}; explicit counts are never lowered.`);

  const means = Array<number>(alphaCount).fill(0);
  for (const row of matrix)
    for (let alpha = 0; alpha < alphaCount; alpha++) means[alpha] += row[alpha] / observations;
  const centered = matrix.map((row) => row.map((value, alpha) => value - means[alpha]));
  const sampleCovariance = zeros(alphaCount, alphaCount);
  for (let left = 0; left < alphaCount; left++) {
    for (let right = left; right < alphaCount; right++) {
      let sum = 0;
      for (let time = 0; time < observations; time++)
        sum += centered[time][left] * centered[time][right];
      sampleCovariance[left][right] = sampleCovariance[right][left] = sum / (observations - 1);
    }
  }
  if (sampleCovariance.some((row) => row.some((value) => !finite(value))))
    return fail("INVALID_FACTOR_MODEL", "Sample covariance contains a nonfinite value.");

  const sampleVariances = sampleCovariance.map((row, alpha) => row[alpha]);
  const maxVariance = Math.max(...sampleVariances.map(Math.abs), Number.MIN_VALUE);
  const varianceTolerance = D1_NUMERICAL_TOLERANCE * maxVariance;
  if (sampleVariances.some((variance) => variance <= varianceTolerance))
    return fail("INVALID_FACTOR_MODEL", "Sample correlation is undefined for a zero or numerically negligible alpha variance.");
  const standardDeviations = sampleVariances.map(Math.sqrt);
  const correlationMatrix = sampleCovariance.map((row, i) =>
    row.map((value, j) => value / (standardDeviations[i] * standardDeviations[j])));
  if (correlationMatrix.some((row) => row.some((value) => !finite(value))))
    return fail("INVALID_FACTOR_MODEL", "Sample correlation matrix contains a nonfinite value.");

  let correlationEigen: EigenResult;
  let sampleEigen: EigenResult;
  try {
    correlationEigen = symmetricEigen(correlationMatrix);
    sampleEigen = symmetricEigen(sampleCovariance);
  } catch (error) {
    return fail("INVALID_FACTOR_MODEL", error instanceof Error ? error.message : String(error));
  }
  const corrScale = Math.max(...correlationEigen.values.map(Math.abs), 1);
  if (correlationEigen.values.some((value) => value < -D1_NUMERICAL_TOLERANCE * corrScale))
    return fail("INVALID_FACTOR_MODEL", "Sample correlation matrix has a materially negative eigenvalue.");
  // R is a sample correlation matrix. Tiny negative eigenvalues at roundoff
  // are zeroed for the low-rank representation, never for material failures.
  correlationEigen.values = correlationEigen.values.map((value) => Math.max(0, value));

  const factorEigenvalues = correlationEigen.values.slice(0, selectedFactorCount);
  const omega = zeros(alphaCount, selectedFactorCount);
  for (let alpha = 0; alpha < alphaCount; alpha++)
    for (let factor = 0; factor < selectedFactorCount; factor++)
      omega[alpha][factor] = standardDeviations[alpha] * correlationEigen.vectors[alpha][factor];
  const phi = zeros(selectedFactorCount, selectedFactorCount);
  for (let factor = 0; factor < selectedFactorCount; factor++)
    phi[factor][factor] = factorEigenvalues[factor];
  const common = multiply(multiply(omega, phi), transpose(omega));
  const rawSpecificVariances = sampleVariances.map((variance, alpha) => variance - common[alpha][alpha]);
  if (rawSpecificVariances.some((value) => !finite(value)))
    return fail("INVALID_FACTOR_MODEL", "Raw specific variances contain a nonfinite value.");
  const materiallyNegative = rawSpecificVariances.find((value) => value < -varianceTolerance);
  if (materiallyNegative !== undefined)
    return fail("INVALID_FACTOR_MODEL",
      `Truncated common-factor covariance exceeds a sample variance by ${-materiallyNegative}, beyond the ${varianceTolerance} relative floating-point tolerance.`);
  const specificVariances = rawSpecificVariances.map((variance, alpha) => {
    const roundoffClamped = Math.max(0, variance);
    return Math.max(roundoffClamped, specificRiskFloorFraction * sampleVariances[alpha]);
  });
  const xi = zeros(alphaCount, alphaCount);
  for (let alpha = 0; alpha < alphaCount; alpha++) xi[alpha][alpha] = specificVariances[alpha];
  const gamma = reconstructCovariance(omega, phi, xi);

  if (gamma.length !== alphaCount || gamma.some((row) => row.length !== alphaCount ||
      row.some((value) => !finite(value))))
    return fail("INVALID_RISK_MODEL", "Gamma has nonfinite entries or dimensions that do not match candidate ordering.");
  const gammaScale = Math.max(maxAbs(gamma), Number.MIN_VALUE);
  for (let i = 0; i < alphaCount; i++)
    for (let j = i + 1; j < alphaCount; j++)
      if (Math.abs(gamma[i][j] - gamma[j][i]) > D1_NUMERICAL_TOLERANCE * gammaScale)
        return fail("INVALID_RISK_MODEL", "Gamma is materially asymmetric.");
  if (specificVariances.some((variance) => !finite(variance) || variance < 0))
    return fail("INVALID_RISK_MODEL", "Gamma contains a negative or nonfinite specific variance.");

  let gammaEigen: EigenResult;
  try {
    gammaEigen = symmetricEigen(gamma);
  } catch (error) {
    return fail("INVALID_RISK_MODEL", error instanceof Error ? error.message : String(error));
  }
  const gammaScaleEigen = Math.max(...gammaEigen.values.map(Math.abs), Number.MIN_VALUE);
  if (gammaEigen.values.some((value) => value < -D1_NUMERICAL_TOLERANCE * gammaScaleEigen))
    return fail("INVALID_RISK_MODEL", "Gamma is not positive semidefinite within the declared relative tolerance.");

  const sampleDiagnostics = covarianceEigenDiagnostics(sampleEigen);
  const gammaDiagnostics = covarianceEigenDiagnostics(gammaEigen);
  const correlationPositive = correlationEigen.values.filter((value) => value > 0);
  const correlationTotal = correlationPositive.reduce((sum, value) => sum + value, 0);
  const factorVarianceExplained = factorEigenvalues.map((value) => value / correlationTotal);
  let cumulative = 0;
  const cumulativeVarianceExplained = factorVarianceExplained.map((value) => cumulative += value);
  const factorBasisUnstable = correlationEigen.values.some((value, index, values) => index > 0 &&
    Math.abs(values[index - 1] - value) /
      Math.max(Math.abs(values[index - 1]), Math.abs(value), Number.MIN_VALUE) <= D1_EIGEN_GAP_RELATIVE_TOLERANCE);
  const rawSpecificTrace = rawSpecificVariances.reduce((sum, value) => sum + Math.max(0, value), 0);
  const commonTrace = common.reduce((sum, row, alpha) => sum + row[alpha], 0);
  const gammaTrace = gamma.reduce((sum, row, alpha) => sum + row[alpha], 0);
  const floorBoundAlphaIds = candidateIds.filter((_, alpha) =>
    specificRiskFloorFraction * sampleVariances[alpha] > Math.max(0, rawSpecificVariances[alpha]));
  const floorAdjustedDiagonalAlphaIds = candidateIds.filter((_, alpha) =>
    Math.abs(gamma[alpha][alpha] - sampleVariances[alpha]) > varianceTolerance);
  const warnings = factorBasisUnstable ? ["FACTOR_BASIS_UNSTABLE"] : [];
  const diagnostics: D1FactorModelDiagnostics = {
    observationCount: observations,
    alphaCount,
    factorCount: selectedFactorCount,
    sampleVariances,
    rawSpecificVariances,
    specificVariances,
    floorBoundAlphaIds,
    floorAdjustedDiagonalAlphaIds,
    sampleEigenvalues: sampleEigen.values,
    factorCovarianceEigenvalues: gammaEigen.values,
    sampleCovarianceRank: sampleDiagnostics.rank,
    factorCovarianceRank: gammaDiagnostics.rank,
    sampleConditionNumber: sampleDiagnostics.conditionNumber,
    factorCovarianceConditionNumber: gammaDiagnostics.conditionNumber,
    correlationConditionNumber: covarianceEigenDiagnostics(correlationEigen).conditionNumber,
    factorVarianceExplained,
    cumulativeVarianceExplained,
    commonFactorVarianceShare: gammaTrace > 0 ? commonTrace / gammaTrace : 0,
    specificRiskVarianceShare: gammaTrace > 0
      ? specificVariances.reduce((sum, value) => sum + value, 0) / gammaTrace : 0,
    factorBasisUnstable,
    warnings,
    eigenGapRelativeTolerance: D1_EIGEN_GAP_RELATIVE_TOLERANCE,
    negativeEigenvalueRelativeTolerance: D1_NUMERICAL_TOLERANCE,
    effectiveRankConvention: "exp(-sum(p*log(p))) over strictly positive eigenvalues only; numerical rank uses eigenvalues greater than relative tolerance times spectral scale.",
    sampleEffectiveRank: sampleDiagnostics.effectiveRank,
    factorCovarianceEffectiveRank: gammaDiagnostics.effectiveRank,
  };
  // Avoid an unused trace and make the raw specific-risk meaning explicit via
  // diagnostics; the modeled Xi may be lifted only by the declared floor.
  void rawSpecificTrace;

  return {
    status: "VALID",
    candidateIds: [...candidateIds],
    observationCount: observations,
    alphaCount,
    factorCount: selectedFactorCount,
    specificRiskFloorFraction,
    sampleCovariance,
    correlationMatrix,
    eigenvectors: correlationEigen.vectors,
    eigenvalues: correlationEigen.values,
    omega,
    phi,
    xi,
    gamma,
    diagnostics,
  };
}

/** Compute factor, specific, and Euler alpha risk contributions for weights b. */
export function decomposeStatisticalFactorRisk(
  model: D1StatisticalFactorRiskModel,
  weights: number[],
): D1FactorRiskDecompositionResult {
  const n = model?.candidateIds?.length;
  if (model?.status !== "VALID" || !Number.isSafeInteger(n) || !n ||
      !Array.isArray(weights) || weights.length !== n || weights.some((weight) => !finite(weight)) ||
      model.gamma.length !== n || model.gamma.some((row) => row.length !== n || row.some((value) => !finite(value))))
    return { status: "INVALID_RISK_MODEL", reason: "Risk decomposition requires finite weights and a dimensionally valid frozen Gamma model." };

  const factors = model.factorCount;
  const factorExposure = Array.from({ length: factors }, (_, factor) =>
    model.omega.reduce((sum, row, alpha) => sum + row[factor] * weights[alpha], 0));
  const phiExposure = model.phi.map((row) => row.reduce((sum, value, factor) => sum + value * factorExposure[factor], 0));
  const factorVarianceContributions = factorExposure.map((exposure, factor) => exposure * phiExposure[factor]);
  const factorVariance = factorVarianceContributions.reduce((sum, value) => sum + value, 0);
  const specificVariance = weights.reduce((sum, weight, alpha) =>
    sum + weight * weight * model.xi[alpha][alpha], 0);
  const portfolioVariance = weights.reduce((sum, leftWeight, i) =>
    sum + leftWeight * model.gamma[i].reduce((rowSum, covariance, j) => rowSum + covariance * weights[j], 0), 0);
  const computedVariance = factorVariance + specificVariance;
  const varianceTolerance = 1e-8 * Math.max(1e-20, Math.abs(portfolioVariance), Math.abs(computedVariance));
  if (![factorVariance, specificVariance, portfolioVariance].every(finite) ||
      Math.abs(portfolioVariance - computedVariance) > varianceTolerance ||
      factorVarianceContributions.some((value) => !finite(value)))
    return { status: "INVALID_RISK_MODEL", reason: "Risk decomposition does not reconcile b'Gamma b with factor plus specific variance." };
  if (portfolioVariance < -varianceTolerance)
    return { status: "INVALID_RISK_MODEL", reason: "Portfolio variance is materially negative under the frozen Gamma model." };

  const nonnegativeVariance = Math.max(0, portfolioVariance);
  const portfolioVolatility = Math.sqrt(nonnegativeVariance);
  const alphaMarginalComponentRisk = Array.from({ length: n }, (_, alpha) => {
    const covarianceTimesWeight = model.gamma[alpha].reduce((sum, covariance, j) => sum + covariance * weights[j], 0);
    return portfolioVolatility > 0
      ? {
        marginalContributionToRisk: covarianceTimesWeight / portfolioVolatility,
        componentContributionToRisk: weights[alpha] * covarianceTimesWeight / portfolioVolatility,
      }
      : { marginalContributionToRisk: null, componentContributionToRisk: null };
  });
  const componentSum = alphaMarginalComponentRisk.reduce((sum, contribution) =>
    sum + (contribution.componentContributionToRisk ?? 0), 0);
  if (portfolioVolatility > 0 &&
      Math.abs(componentSum - portfolioVolatility) > 1e-8 * Math.max(portfolioVolatility, 1e-20))
    return { status: "INVALID_RISK_MODEL", reason: "Alpha component risk contributions do not sum to portfolio volatility." };

  return {
    status: "VALID",
    portfolioVariance: nonnegativeVariance,
    portfolioVolatility,
    factorExposure,
    factorVarianceContributions,
    factorVariance,
    specificVariance,
    alphaMarginalComponentRisk,
  };
}