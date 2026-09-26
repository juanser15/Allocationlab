/**
 * D3 expected-return forecasts. All return quantities are daily decimal returns.
 * This module estimates forecasts only; it does not select candidates or weights.
 */
export type ForecastModelConfig =
  | { type: "SAMPLE_MEAN"; displayZ?: number }
  | {
      type: "SHRUNK_MEAN";
      shrinkage?: number;
      shrinkagePrior?: { source: "DEFAULT" | "USER_DEFINED"; values?: Record<string, number> };
      displayZ?: number;
    }
  | {
      type: "BAYESIAN_VIEWS";
      shrinkage?: number;
      shrinkagePrior?: { source: "DEFAULT" | "USER_DEFINED"; values?: Record<string, number> };
      priorMean?: {
        source: "SAMPLE_PRIOR" | "SHRUNK_PRIOR" | "USER_DEFINED_PRIOR";
        values?: Record<string, number>;
      };
      priorUncertainty?: {
        type: "TAU_SIGMA" | "USER_DEFINED";
        tau?: number;
        matrix?: number[][];
        candidateIds?: string[];
      };
      views?: Array<{
        type: "ABSOLUTE" | "RELATIVE";
        candidateId: string;
        relativeCandidateId?: string;
        q: number;
        variance: number;
        effectiveTimestamp: string;
        availabilityTimestamp: string;
      }>;
      displayZ?: number;
    };

export interface ForecastInput {
  candidateIds: string[];
  /** Aligned daily returns, time-major: one row per date, one column per candidate. */
  returns: number[][];
  dates: string[];
  /** Selected contemporaneous risk covariance, in daily-return units. */
  sigma: number[][];
  dailyCashYield: number;
  mode: "CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY";
  config: ForecastModelConfig;
  decisionCutoff: string;
  /** Optional complete return history used only for the short/base/long diagnostic. */
  fullHistory?: { dates: string[]; returns: number[][] };
}

export interface ForecastViewSnapshot {
  type: "ABSOLUTE" | "RELATIVE";
  candidateId: string;
  relativeCandidateId?: string;
  exposure: number[];
  q: number;
  variance: number;
  effectiveTimestamp: string;
  availabilityTimestamp: string;
  status: "ELIGIBLE" | "NOT_YET_EFFECTIVE" | "NOT_YET_AVAILABLE" | "NOT_EFFECTIVE_OR_AVAILABLE";
}

export interface ForecastStability {
  observationCounts: { short: number; base: number; long: number };
  short: number[];
  base: number[];
  long: number[];
  dispersion: number[];
}

export interface ForecastResult {
  status: "OK" | "INVALID_FORECAST_MODEL" | "HISTORICAL_FORECAST_UNAVAILABLE";
  reason?: string;
  engineVersion: "D3.1.0";
  estimator: ForecastModelConfig["type"];
  returnConvention: "DAILY_DECIMAL_GROSS" | "DAILY_DECIMAL_EXCESS";
  mode: ForecastInput["mode"];
  candidateIds: string[];
  dates: string[];
  observationCount: number;
  startDate: string | null;
  endDate: string | null;
  decisionCutoff: string;
  sigma: number[][];
  sampleMeans: number[];
  sampleStandardDeviations: number[];
  muHat: number[];
  V_mu: number[][];
  standardErrors: number[];
  signalToNoise: Array<number | null>;
  intervals: Array<{ lower: number; upper: number }>;
  intervalLabel: "Gaussian forecast-uncertainty interval under model assumptions.";
  displayZ: number;
  priorMean: number[] | null;
  priorUncertainty: number[][] | null;
  tau: number | null;
  shrinkage: number | null;
  shrinkageDelta: number[] | null;
  uncertaintyAssumption: string;
  P: number[][];
  q: number[];
  Omega: number[][];
  views: ForecastViewSnapshot[];
  viewSetStatus: "NOT_APPLICABLE" | "AVAILABLE" | "UNAVAILABLE_NO_ELIGIBLE_VIEWS";
  stability: ForecastStability | null;
}

export interface PortfolioForecastUncertainty {
  expectedReturn: number;
  varianceOfExpectedReturn: number;
  standardError: number;
  label: "Expected return estimation uncertainty; not portfolio return volatility.";
}

const ENGINE_VERSION = "D3.1.0" as const;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;
const PSD_TOLERANCE = 1e-10;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value));
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function failed(reason: string, estimator: ForecastModelConfig["type"] = "SAMPLE_MEAN"): ForecastResult {
  return freezeDeep({
    status: "INVALID_FORECAST_MODEL", reason, engineVersion: ENGINE_VERSION, estimator,
    returnConvention: "DAILY_DECIMAL_GROSS", mode: "CAPITAL_LONG_ONLY",
    candidateIds: [], dates: [], observationCount: 0, startDate: null, endDate: null,
    decisionCutoff: "", sigma: [], sampleMeans: [], sampleStandardDeviations: [],
    muHat: [], V_mu: [], standardErrors: [], signalToNoise: [], intervals: [],
    intervalLabel: "Gaussian forecast-uncertainty interval under model assumptions.",
    displayZ: 1.96, priorMean: null, priorUncertainty: null, tau: null, shrinkage: null,
    shrinkageDelta: null, uncertaintyAssumption: "", P: [], q: [], Omega: [], views: [],
    viewSetStatus: "NOT_APPLICABLE", stability: null,
  } as ForecastResult);
}

function validateSymmetricPsd(matrix: number[][], size: number, label: string): string | null {
  if (!Array.isArray(matrix) || matrix.length !== size ||
    matrix.some((row) => !Array.isArray(row) || row.length !== size || row.some((value) => !isFiniteNumber(value))))
    return `${label} must be a finite ${size}x${size} matrix.`;
  let scale = 0;
  for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tolerance = PSD_TOLERANCE * Math.max(scale, Number.MIN_VALUE);
  for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++)
    if (Math.abs(matrix[i][j] - matrix[j][i]) > tolerance)
      return `${label} must be symmetric.`;
  const a = matrix.map((row) => row.slice());
  for (let iteration = 0; iteration < Math.max(1, 100 * size * size); iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++)
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest <= tolerance) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const app = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const aqq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];
    for (let k = 0; k < size; k++) if (k !== p && k !== q) {
      const akp = c * a[k][p] - s * a[k][q];
      const akq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = akp;
      a[k][q] = a[q][k] = akq;
    }
    a[p][p] = app; a[q][q] = aqq; a[p][q] = a[q][p] = 0;
  }
  if (a.some((row, i) => row[i] < -tolerance)) return `${label} must be positive semidefinite.`;
  return null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleMeans(rows: number[][], size: number): number[] {
  return Array.from({ length: size }, (_, column) => mean(rows.map((row) => row[column])));
}

function sampleStandardDeviations(rows: number[][], averages: number[]): number[] {
  return averages.map((average, column) => Math.sqrt(rows.reduce((sum, row) =>
    sum + (row[column] - average) ** 2, 0) / (rows.length - 1)));
}

function diagonalScale(matrix: number[][], factor: number): number[][] {
  return matrix.map((row) => row.map((value) => value * factor));
}

function multiply(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, column) =>
    row.reduce((sum, value, k) => sum + value * b[k][column], 0)));
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function solvePositiveDefinite(matrix: number[][], right: number[][]): number[][] | null {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [...row, ...right[i]]);
  let scale = 0;
  for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const pivotTolerance = Number.EPSILON * Math.max(Number.MIN_VALUE, scale) * n;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) <= pivotTolerance) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j < augmented[column].length; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = augmented[row][column];
      for (let j = column; j < augmented[row].length; j++)
        augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row.slice(n));
}

function configuredVector(values: Record<string, number> | undefined, ids: string[], label: string): number[] | string {
  if (!values || Object.keys(values).length !== ids.length || ids.some((id) => !(id in values)) ||
    Object.keys(values).some((id) => !ids.includes(id)))
    return `${label} must provide exactly one value for each candidate.`;
  const vector = ids.map((id) => values[id]);
  return vector.every(isFiniteNumber) ? vector : `${label} values must be finite.`;
}

function configuredShrinkage(config: ForecastModelConfig): number | string {
  const s = config.type === "SAMPLE_MEAN" ? 0 : config.shrinkage ?? 0;
  return isFiniteNumber(s) && s >= 0 && s <= 1 ? s : "Shrinkage must be finite and between 0 and 1.";
}

function resolvePriorMean(config: ForecastModelConfig, averages: number[], ids: string[],
  mode: ForecastInput["mode"], cashYield: number): number[] | string {
  if (config.type !== "BAYESIAN_VIEWS" || !config.priorMean || config.priorMean.source === "SAMPLE_PRIOR")
    return averages.slice();
  if (config.priorMean.source === "USER_DEFINED_PRIOR")
    return configuredVector(config.priorMean.values, ids, "User-defined prior mean");
  const shrinkage = configuredShrinkage(config);
  if (typeof shrinkage === "string") return shrinkage;
  const prior = config.shrinkagePrior;
  if (prior?.source === "USER_DEFINED") {
    const vector = configuredVector(prior.values, ids, "User-defined shrinkage prior");
    if (typeof vector === "string") return vector;
    return averages.map((value, index) => (1 - shrinkage) * value + shrinkage * vector[index]);
  }
  const defaultPrior = ids.map(() => mode === "SIGNED_OVERLAY" ? 0 : cashYield);
  return averages.map((value, index) => (1 - shrinkage) * value + shrinkage * defaultPrior[index]);
}

interface BayesianUpdate {
  mean: number[];
  covariance: number[][];
  priorMean: number[];
  priorCovariance: number[][];
  tau: number | null;
  exposures: number[][];
  values: number[];
  omega: number[][];
  views: ForecastViewSnapshot[];
  viewSetStatus: ForecastResult["viewSetStatus"];
}

function eligibleBayesianUpdate(config: Extract<ForecastModelConfig, { type: "BAYESIAN_VIEWS" }>,
  ids: string[], averages: number[], sigma: number[][], count: number, mode: ForecastInput["mode"],
  cashYield: number, cutoff: string, viewsInput: NonNullable<Extract<ForecastModelConfig,
    { type: "BAYESIAN_VIEWS" }>["views"]>): BayesianUpdate | string {
  const meanPrior = resolvePriorMean(config, averages, ids, mode, cashYield);
  if (typeof meanPrior === "string") return meanPrior;
  let tau: number | null = null;
  let priorCovariance: number[][];
  const uncertainty = config.priorUncertainty ?? { type: "TAU_SIGMA" as const };
  if (uncertainty.type === "TAU_SIGMA") {
    tau = uncertainty.tau ?? 1 / count;
    if (!isFiniteNumber(tau) || tau <= 0) return "Prior tau must be finite and strictly positive.";
    priorCovariance = diagonalScale(sigma, tau);
  } else if (uncertainty.type === "USER_DEFINED") {
    if (!Array.isArray(uncertainty.candidateIds) ||
      uncertainty.candidateIds.length !== ids.length ||
      uncertainty.candidateIds.some((id, i) => id !== ids[i]))
      return "User prior uncertainty candidateIds must exactly match the forecast candidate ordering.";
    priorCovariance = uncertainty.matrix ?? [];
  } else return "Prior uncertainty type is unsupported.";
  const covarianceError = validateSymmetricPsd(priorCovariance, ids.length, "Prior uncertainty");
  if (covarianceError) return covarianceError;

  const allViews: ForecastViewSnapshot[] = [];
  const eligibleViews: ForecastViewSnapshot[] = [];
  for (const view of viewsInput) {
    const first = ids.indexOf(view.candidateId);
    const second = view.relativeCandidateId === undefined ? -1 : ids.indexOf(view.relativeCandidateId);
    if (view.type !== "ABSOLUTE" && view.type !== "RELATIVE")
      return "Bayesian view type must be ABSOLUTE or RELATIVE.";
    if (first < 0 || (view.type === "RELATIVE" && (second < 0 || second === first)))
      return "A Bayesian view references an unknown candidate or a non-identifiable relative view.";
    if ((view.type === "ABSOLUTE" && view.relativeCandidateId !== undefined) ||
      (view.type === "RELATIVE" && view.relativeCandidateId === undefined) ||
      !isFiniteNumber(view.q) || !isFiniteNumber(view.variance) || view.variance <= 0 ||
      !validTimestamp(view.effectiveTimestamp) || !validTimestamp(view.availabilityTimestamp))
      return "Each Bayesian view requires a valid type, candidate(s), finite q, positive variance, and valid timestamps.";
    const isEffective = view.effectiveTimestamp <= cutoff;
    const isAvailable = view.availabilityTimestamp <= cutoff;
    const status: ForecastViewSnapshot["status"] = isEffective && isAvailable ? "ELIGIBLE"
      : !isEffective && !isAvailable ? "NOT_EFFECTIVE_OR_AVAILABLE"
        : isEffective ? "NOT_YET_AVAILABLE" : "NOT_YET_EFFECTIVE";
    const exposure = ids.map((_, i) => (i === first ? 1 : 0) - (view.type === "RELATIVE" && i === second ? 1 : 0));
    const snapshot: ForecastViewSnapshot = {
      type: view.type, candidateId: view.candidateId,
      ...(view.relativeCandidateId === undefined ? {} : { relativeCandidateId: view.relativeCandidateId }),
      exposure, q: view.q, variance: view.variance, effectiveTimestamp: view.effectiveTimestamp,
      availabilityTimestamp: view.availabilityTimestamp, status,
    };
    allViews.push(snapshot);
    if (status === "ELIGIBLE") eligibleViews.push(snapshot);
  }
  const exposures = eligibleViews.map((view) => view.exposure);
  const values = eligibleViews.map((view) => view.q);
  const omega = eligibleViews.map((view, i) =>
    eligibleViews.map((_, j) => i === j ? view.variance : 0));
  if (!eligibleViews.length) return {
    mean: meanPrior, covariance: priorCovariance, priorMean: meanPrior, priorCovariance, tau,
    exposures, values, omega, views: allViews, viewSetStatus: "UNAVAILABLE_NO_ELIGIBLE_VIEWS",
  };

  const p = exposures, pt = transpose(p);
  const vpT = multiply(priorCovariance, pt);
  const innovationCovariance = multiply(p, vpT).map((row, i) =>
    row.map((value, j) => value + omega[i][j]));
  const solvedResidual = solvePositiveDefinite(innovationCovariance,
    values.map((value, i) => [value - p[i].reduce((sum, coefficient, j) => sum + coefficient * meanPrior[j], 0)]));
  const solvedCrossCovariance = solvePositiveDefinite(innovationCovariance, transpose(vpT));
  if (!solvedResidual || !solvedCrossCovariance)
    return "Bayesian view conditioning covariance is singular or non-identifiable; no epsilon regularization was applied.";
  const gain = transpose(solvedCrossCovariance);
  const posteriorMean = meanPrior.map((value, i) => value + gain[i].reduce((sum, coefficient, j) =>
    sum + coefficient * (values[j] - p[j].reduce((inner, exposure, k) => inner + exposure * meanPrior[k], 0)), 0));
  const posteriorCovariance = priorCovariance.map((row, i) => row.map((value, j) => {
    const reduction = vpT[i].reduce((sum, coefficient, k) => sum + coefficient * solvedCrossCovariance[k][j], 0);
    return value - reduction;
  }));
  for (let i = 0; i < posteriorCovariance.length; i++) for (let j = i + 1; j < posteriorCovariance.length; j++) {
    const average = (posteriorCovariance[i][j] + posteriorCovariance[j][i]) / 2;
    posteriorCovariance[i][j] = posteriorCovariance[j][i] = average;
  }
  const posteriorError = validateSymmetricPsd(posteriorCovariance, ids.length, "Posterior uncertainty");
  if (posteriorError) return posteriorError;
  return {
    mean: posteriorMean, covariance: posteriorCovariance, priorMean: meanPrior,
    priorCovariance, tau, exposures, values, omega, views: allViews, viewSetStatus: "AVAILABLE",
  };
}

function forecastForWindow(rows: number[][], sigma: number[][], ids: string[], input: ForecastInput,
  config: ForecastModelConfig): number[] | string {
  const averages = sampleMeans(rows, ids.length);
  if (config.type === "SAMPLE_MEAN") return averages;
  if (config.type === "SHRUNK_MEAN") {
    const s = configuredShrinkage(config);
    if (typeof s === "string") return s;
    const priorConfig = config.shrinkagePrior;
    const prior = priorConfig?.source === "USER_DEFINED"
      ? configuredVector(priorConfig.values, ids, "User-defined shrinkage prior")
      : ids.map(() => input.mode === "SIGNED_OVERLAY" ? 0 : input.dailyCashYield);
    if (typeof prior === "string") return prior;
    return averages.map((value, i) => (1 - s) * value + s * prior[i]);
  }
  const update = eligibleBayesianUpdate(config, ids, averages, sigma, rows.length, input.mode,
    input.dailyCashYield, input.decisionCutoff, config.views ?? []);
  return typeof update === "string" ? update : update.mean;
}

function buildStability(input: ForecastInput, config: ForecastModelConfig): ForecastStability | null | string {
  if (!input.fullHistory) return null;
  const ids = input.candidateIds;
  const dates = input.fullHistory.dates;
  const rows = input.fullHistory.returns;
  if (!Array.isArray(dates) || !Array.isArray(rows) || dates.length !== rows.length ||
    rows.some((row) => !Array.isArray(row) || row.length !== ids.length || row.some((v) => !isFiniteNumber(v))) ||
    dates.some((date, i) => !validTimestamp(date) || date > input.decisionCutoff ||
      (i > 0 && dates[i - 1] >= date)))
    return "Full available history must have aligned finite observations, ordered valid dates, and no dates after cutoff.";
  const eligibleRows = rows.filter((_, i) => dates[i] <= input.decisionCutoff);
  if (eligibleRows.length < 2) return "Full available history requires at least two observations for stability diagnostics.";
  const baseCount = Math.max(2, Math.min(eligibleRows.length, input.returns.length));
  const counts = {
    short: Math.max(2, Math.min(eligibleRows.length, Math.round(baseCount * 0.75))),
    base: baseCount,
    long: Math.max(2, Math.min(eligibleRows.length, Math.round(baseCount * 1.25))),
  };
  const means: Record<"short" | "base" | "long", number[]> = { short: [], base: [], long: [] };
  for (const key of ["short", "base", "long"] as const) {
    // A frozen B3 alignment can omit otherwise available dates. The Base diagnostic
    // must describe exactly the observations used by the actual forecast.
    const windowRows = key === "base" ? input.returns : eligibleRows.slice(-counts[key]);
    const value = forecastForWindow(windowRows, input.sigma, ids, input, config);
    if (typeof value === "string") return value;
    means[key] = value;
  }
  const dispersion = ids.map((_, i) => {
    const center = (means.short[i] + means.base[i] + means.long[i]) / 3;
    return Math.sqrt(((means.short[i] - center) ** 2 + (means.base[i] - center) ** 2 +
      (means.long[i] - center) ** 2) / 3);
  });
  return { observationCounts: counts, short: means.short, base: means.base, long: means.long, dispersion };
}

/**
 * Estimate an auditable forecast using aligned candidate returns, selected risk Sigma,
 * a frozen model configuration, and a point-in-time information cutoff.
 */
export function estimateForecast(input: ForecastInput): ForecastResult {
  const estimator = input?.config?.type ?? "SAMPLE_MEAN";
  const reject = (reason: string) => failed(reason, estimator);
  if (!input || !Array.isArray(input.candidateIds) || !input.candidateIds.length ||
    new Set(input.candidateIds).size !== input.candidateIds.length ||
    input.candidateIds.some((id) => typeof id !== "string" || !id))
    return reject("Candidate IDs must be a nonempty ordered list of unique strings.");
  const n = input.candidateIds.length;
  if (!Array.isArray(input.returns) || input.returns.length < 2 || !Array.isArray(input.dates) ||
    input.dates.length !== input.returns.length ||
    input.returns.some((row) => !Array.isArray(row) || row.length !== n || row.some((value) => !isFiniteNumber(value))) ||
    input.dates.some((date, i) => !validTimestamp(date) || date > input.decisionCutoff ||
      (i > 0 && input.dates[i - 1] >= date)))
    return reject("Returns and dates must be finite, aligned, ordered, and no later than the decision cutoff.");
  if (!validTimestamp(input.decisionCutoff) || !["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"].includes(input.mode) ||
    !isFiniteNumber(input.dailyCashYield) || !input.config ||
    !["SAMPLE_MEAN", "SHRUNK_MEAN", "BAYESIAN_VIEWS"].includes(input.config.type))
    return reject("Forecast mode, daily cash yield, model configuration, or decision cutoff is invalid.");
  const covarianceError = validateSymmetricPsd(input.sigma, n, "Selected Sigma");
  if (covarianceError) return reject(covarianceError);
  if (input.config.type !== "SAMPLE_MEAN") {
    const shrinkageError = configuredShrinkage(input.config);
    if (typeof shrinkageError === "string") return reject(shrinkageError);
  }
  if ((input.config.type === "SHRUNK_MEAN" || input.config.type === "BAYESIAN_VIEWS") &&
    input.config.shrinkagePrior && input.config.shrinkagePrior.source !== "DEFAULT" &&
    input.config.shrinkagePrior.source !== "USER_DEFINED")
    return reject("Shrinkage prior source must be DEFAULT or USER_DEFINED.");
  if (input.config.type === "BAYESIAN_VIEWS" && input.config.priorMean &&
    !["SAMPLE_PRIOR", "SHRUNK_PRIOR", "USER_DEFINED_PRIOR"].includes(input.config.priorMean.source))
    return reject("Bayesian prior mean source is unsupported.");
  const displayZ = input.config.displayZ ?? 1.96;
  if (!isFiniteNumber(displayZ) || displayZ < 0) return reject("Display z must be finite and nonnegative.");
  const averages = sampleMeans(input.returns, n);
  const standardDeviations = sampleStandardDeviations(input.returns, averages);
  let muHat: number[];
  let V_mu: number[][];
  let priorMean: number[] | null = null;
  let priorUncertainty: number[][] | null = null;
  let tau: number | null = null;
  let shrinkage: number | null = null;
  let shrinkageDelta: number[] | null = null;
  let assumption = "Sampling uncertainty conditional on the selected Sigma.";
  let P: number[][] = [], q: number[] = [], Omega: number[][] = [];
  let views: ForecastViewSnapshot[] = [];
  let viewSetStatus: ForecastResult["viewSetStatus"] = "NOT_APPLICABLE";
  if (input.config.type === "SAMPLE_MEAN") {
    muHat = averages.slice();
    V_mu = diagonalScale(input.sigma, 1 / input.returns.length);
  } else if (input.config.type === "SHRUNK_MEAN") {
    shrinkage = configuredShrinkage(input.config) as number;
    const priorConfig = input.config.shrinkagePrior;
    if (priorConfig?.source === "USER_DEFINED") {
      const resolved = configuredVector(priorConfig.values, input.candidateIds, "User-defined shrinkage prior");
      if (typeof resolved === "string") return reject(resolved);
      priorMean = resolved;
    } else priorMean = input.candidateIds.map(() =>
      input.mode === "SIGNED_OVERLAY" ? 0 : input.dailyCashYield);
    muHat = averages.map((value, i) => (1 - shrinkage!) * value + shrinkage! * priorMean![i]);
    V_mu = diagonalScale(input.sigma, ((1 - shrinkage) ** 2) / input.returns.length);
    shrinkageDelta = muHat.map((value, i) => value - averages[i]);
    assumption = shrinkage === 1 ? "Forecast entirely determined by fixed prior; zero sampling uncertainty by construction, not certainty about the true expected return."
      : "Configured prior is treated as deterministic; uncertainty excludes prior uncertainty.";
  } else {
    const update = eligibleBayesianUpdate(input.config, input.candidateIds, averages, input.sigma,
      input.returns.length, input.mode, input.dailyCashYield, input.decisionCutoff, input.config.views ?? []);
    if (typeof update === "string") return reject(update);
    muHat = update.mean;
    V_mu = update.covariance;
    priorMean = update.priorMean;
    priorUncertainty = update.priorCovariance;
    tau = update.tau;
    P = update.exposures;
    q = update.values;
    Omega = update.omega;
    views = update.views;
    viewSetStatus = update.viewSetStatus;
    assumption = "Gaussian prior and explicit independent Gaussian view errors; only views available and effective by the decision cutoff are used.";
  }
  if (muHat.some((value) => !isFiniteNumber(value)) ||
    V_mu.some((row) => row.some((value) => !isFiniteNumber(value))))
    return reject("Forecast calculation produced a nonfinite result.");
  const uncertaintyError = validateSymmetricPsd(V_mu, n, "Forecast uncertainty");
  if (uncertaintyError) return reject(uncertaintyError);
  const standardErrors = V_mu.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const stability = buildStability(input, input.config);
  if (typeof stability === "string") return reject(stability);
  const unavailable = input.config.type === "BAYESIAN_VIEWS" &&
    viewSetStatus === "UNAVAILABLE_NO_ELIGIBLE_VIEWS";
  return freezeDeep({
    status: unavailable ? "HISTORICAL_FORECAST_UNAVAILABLE" : "OK",
    ...(unavailable ? { reason: "No Bayesian views were both effective and available by the decision cutoff." } : {}),
    engineVersion: ENGINE_VERSION, estimator: input.config.type,
    returnConvention: input.mode === "SIGNED_OVERLAY" ? "DAILY_DECIMAL_EXCESS" : "DAILY_DECIMAL_GROSS",
    mode: input.mode, candidateIds: input.candidateIds.slice(), dates: input.dates.slice(),
    observationCount: input.returns.length, startDate: input.dates[0], endDate: input.dates.at(-1)!,
    decisionCutoff: input.decisionCutoff, sigma: input.sigma.map((row) => row.slice()),
    sampleMeans: averages, sampleStandardDeviations: standardDeviations, muHat, V_mu,
    standardErrors, signalToNoise: muHat.map((value, i) => standardErrors[i] === 0 ? null : value / standardErrors[i]),
    intervals: muHat.map((value, i) => ({
      lower: value - displayZ * standardErrors[i], upper: value + displayZ * standardErrors[i],
    })),
    intervalLabel: "Gaussian forecast-uncertainty interval under model assumptions.",
    displayZ, priorMean, priorUncertainty, tau, shrinkage, shrinkageDelta, uncertaintyAssumption: assumption,
    P, q, Omega, views, viewSetStatus, stability,
  });
}

/** Calculate portfolio expected-return estimation uncertainty without conflating it with risk. */
export function portfolioForecastUncertainty(
  forecast: ForecastResult, weights: number[],
): PortfolioForecastUncertainty | { status: "INVALID_FORECAST_MODEL"; reason: string } {
  if (forecast.status !== "OK") return { status: "INVALID_FORECAST_MODEL", reason: forecast.reason ?? "Forecast is invalid." };
  const n = forecast.candidateIds.length;
  if (!Array.isArray(weights) || weights.length !== n || weights.some((weight) => !isFiniteNumber(weight)))
    return { status: "INVALID_FORECAST_MODEL", reason: "Portfolio weights must be finite and aligned to forecast candidate order." };
  const expectedReturn = forecast.muHat.reduce((sum, value, i) => sum + value * weights[i], 0);
  const varianceOfExpectedReturn = weights.reduce((sum, wi, i) => sum + weights.reduce((inner, wj, j) =>
    inner + wi * forecast.V_mu[i][j] * wj, 0), 0);
  if (varianceOfExpectedReturn < -PSD_TOLERANCE)
    return { status: "INVALID_FORECAST_MODEL", reason: "Portfolio forecast variance is materially negative." };
  return freezeDeep({
    expectedReturn, varianceOfExpectedReturn: Math.max(0, varianceOfExpectedReturn),
    standardError: Math.sqrt(Math.max(0, varianceOfExpectedReturn)),
    label: "Expected return estimation uncertainty; not portfolio return volatility.",
  });
}