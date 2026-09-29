/**
 * Pooled daily-excess-return ridge estimator with date-aggregated Bartlett HAC
 * coefficient sampling covariance. This mathematical fitter does not impose
 * production readiness thresholds or decide which rows are point-in-time eligible.
 */
export interface SignalRidgeTrainingRow {
  date: string;
  asset: string;
  features: Record<string, number>;
  y: number;
}

export interface SignalRidgeFeatureVector {
  asset: string;
  features: Record<string, number>;
}

export interface SignalRidgeContribution {
  factorId: string;
  standardizedValue: number;
  slope: number;
  contribution: number;
}

export interface SignalRidgePredictionRow {
  date: string;
  asset: string;
  intercept: number;
  contributions: SignalRidgeContribution[];
  excessPrediction: number;
}

export interface SignalRidgeFit {
  selectedFactorIds: string[];
  lambda: number;
  bandwidth: number;
  intercept: number;
  slopes: number[];
  scaler: Array<{ factorId: string; mean: number; standardDeviation: number; constant: boolean }>;
  trainingRowCount: number;
  trainingDateCount: number;
  trainingRows: SignalRidgePredictionRow[];
  coefficientCovariance: number[][];
  /** Chronological date scores, with calendar positions retained for HAC lags. */
  dateScores: Array<{ date: string; calendarIndex: number; score: number[] }>;
  calendarDates: string[];
}

export interface SignalRidgePrediction {
  candidateIds: string[];
  intercept: number;
  slopes: number[];
  predictions: SignalRidgePredictionRow[];
  /** Full cross-candidate approximate sampling covariance in candidateIds order. */
  V_mu: number[][];
  uncertaintyLabel: "Approximate sampling uncertainty of the penalized fitted forecast.";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertRows(rows: SignalRidgeTrainingRow[], factors: string[]): void {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Training rows must be nonempty.");
  if (!Array.isArray(factors) || factors.length === 0 ||
    factors.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(factors).size !== factors.length)
    throw new Error("Selected factor IDs must be nonempty, unique strings.");
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.date !== "string" || !row.date || typeof row.asset !== "string" ||
      !row.asset || !row.features || typeof row.features !== "object" || !finite(row.y))
      throw new Error("Each training row requires a date, asset, complete features, and finite y.");
    for (const id of factors) {
      if (!Object.prototype.hasOwnProperty.call(row.features, id) || !finite(row.features[id]))
        throw new Error(`Training row ${row.date}/${row.asset} is missing finite feature ${id}.`);
    }
    const key = `${row.date}\u0000${row.asset}`;
    if (keys.has(key)) throw new Error(`Duplicate training row for ${row.date}/${row.asset}.`);
    keys.add(key);
  }
}

function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!finite(value) || value <= 0)
          throw new Error("Ridge normal matrix is not numerically positive definite.");
        lower[i][j] = Math.sqrt(value);
      } else {
        lower[i][j] = value / lower[j][j];
      }
    }
  }
  return lower;
}

function solveCholesky(lower: number[][], right: number[][]): number[][] {
  const n = lower.length;
  const columns = right[0]?.length ?? 0;
  const forward = Array.from({ length: n }, () => Array(columns).fill(0) as number[]);
  for (let i = 0; i < n; i++) for (let c = 0; c < columns; c++) {
    let value = right[i][c];
    for (let k = 0; k < i; k++) value -= lower[i][k] * forward[k][c];
    forward[i][c] = value / lower[i][i];
  }
  const result = Array.from({ length: n }, () => Array(columns).fill(0) as number[]);
  for (let i = n - 1; i >= 0; i--) for (let c = 0; c < columns; c++) {
    let value = forward[i][c];
    for (let k = i + 1; k < n; k++) value -= lower[k][i] * result[k][c];
    result[i][c] = value / lower[i][i];
  }
  return result;
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, j) => matrix.map((row) => row[j]));
}

function assertSymmetricPsd(matrix: number[][], label: string): void {
  const size = matrix.length;
  let scale = 0;
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    if (!finite(matrix[i][j])) throw new Error(`${label} contains a nonfinite value.`);
    scale = Math.max(scale, Math.abs(matrix[i][j]));
    if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-10 * Math.max(Number.MIN_VALUE, scale))
      throw new Error(`${label} is not symmetric.`);
  }
  const a = matrix.map((row) => row.slice());
  const tolerance = 1e-10 * Math.max(Number.MIN_VALUE, scale);
  for (let iteration = 0; iteration < Math.max(1, 100 * size * size); iteration++) {
    let p = 0, q = 0, largest = 0;
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++)
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest <= tolerance) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const qq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];
    for (let k = 0; k < size; k++) if (k !== p && k !== q) {
      const kp = c * a[k][p] - s * a[k][q];
      const kq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = kp;
      a[k][q] = a[q][k] = kq;
    }
    a[p][p] = pp;
    a[q][q] = qq;
    a[p][q] = a[q][p] = 0;
  }
  if (a.some((row, i) => row[i] < -tolerance))
    throw new Error(`${label} is not positive semidefinite.`);
}

function rowPrediction(
  date: string,
  asset: string,
  features: Record<string, number>,
  factors: string[],
  means: number[],
  deviations: number[],
  constants: boolean[],
  intercept: number,
  slopes: number[],
): SignalRidgePredictionRow {
  const contributions = factors.map((factorId, j) => {
    const value = features[factorId];
    if (!finite(value)) throw new Error(`Prediction ${date}/${asset} is missing finite feature ${factorId}.`);
    const standardizedValue = constants[j] ? 0 : (value - means[j]) / deviations[j];
    return { factorId, standardizedValue, slope: slopes[j], contribution: standardizedValue * slopes[j] };
  });
  return {
    date,
    asset,
    intercept,
    contributions,
    excessPrediction: intercept + contributions.reduce((sum, item) => sum + item.contribution, 0),
  };
}

/**
 * Fit pooled ridge under (1/(2n))*SSE + (lambda/2)*||beta||^2.
 * calendarDates, when supplied, is the declared ordered trading calendar; it
 * prevents absent calendar dates from being compressed into adjacent HAC lags.
 */
export function fitSignalRidge(
  rows: SignalRidgeTrainingRow[],
  selectedFactorIds: string[],
  lambda: number,
  bandwidth: number,
  calendarDates?: string[],
): SignalRidgeFit {
  assertRows(rows, selectedFactorIds);
  if (!finite(lambda) || lambda <= 0) throw new Error("lambda must be finite and strictly positive.");
  if (!Number.isInteger(bandwidth) || bandwidth < 0)
    throw new Error("HAC bandwidth must be a nonnegative integer.");
  const observedDates = [...new Set(rows.map((row) => row.date))].sort();
  const calendar = calendarDates ? calendarDates.slice() : observedDates;
  if (calendar.length === 0 || calendar.some((date, i) => typeof date !== "string" || !date ||
    (i > 0 && calendar[i - 1] >= date)) || observedDates.some((date) => !calendar.includes(date)))
    throw new Error("calendarDates must be strictly ordered and include every training date.");
  const calendarIndex = new Map(calendar.map((date, index) => [date, index]));
  const n = rows.length, p = selectedFactorIds.length, dimension = p + 1;
  const means = selectedFactorIds.map((id) =>
    rows.reduce((sum, row) => sum + row.features[id], 0) / n);
  const rawVariances = selectedFactorIds.map((id, j) =>
    rows.reduce((sum, row) => sum + (row.features[id] - means[j]) ** 2, 0) / n);
  const constants = rawVariances.map((variance) => variance === 0);
  const deviations = rawVariances.map((variance) => Math.sqrt(variance));
  const z = rows.map((row) => [
    1,
    ...selectedFactorIds.map((id, j) => constants[j] ? 0 : (row.features[id] - means[j]) / deviations[j]),
  ]);
  const normal = Array.from({ length: dimension }, () => Array(dimension).fill(0) as number[]);
  const rhs = Array(dimension).fill(0) as number[];
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < dimension; i++) {
      rhs[i] += z[r][i] * rows[r].y / n;
      for (let j = 0; j < dimension; j++) normal[i][j] += z[r][i] * z[r][j] / n;
    }
  }
  for (let j = 1; j < dimension; j++) normal[j][j] += lambda;
  const lower = cholesky(normal);
  const theta = solveCholesky(lower, rhs.map((value) => [value])).map((row) => row[0]);
  const intercept = theta[0], slopes = theta.slice(1);
  const trainingRows = rows.map((row) => rowPrediction(row.date, row.asset, row.features,
    selectedFactorIds, means, deviations, constants, intercept, slopes));

  const groupedScores = new Map<string, number[]>();
  for (const row of rows) if (!groupedScores.has(row.date)) groupedScores.set(row.date, Array(dimension).fill(0));
  rows.forEach((row, index) => {
    const residual = row.y - trainingRows[index].excessPrediction;
    const score = groupedScores.get(row.date)!;
    for (let j = 0; j < dimension; j++) score[j] += z[index][j] * residual;
  });
  const scores = [...groupedScores.entries()].sort(([a], [b]) => a.localeCompare(b));
  const averageScore = Array(dimension).fill(0) as number[];
  for (const [, score] of scores) for (let j = 0; j < dimension; j++) averageScore[j] += score[j] / scores.length;
  const centeredByIndex = new Map<number, number[]>();
  for (const [date, score] of scores) {
    const index = calendarIndex.get(date)!;
    centeredByIndex.set(index, score.map((value, j) => value - averageScore[j]));
  }
  const meat = Array.from({ length: dimension }, () => Array(dimension).fill(0) as number[]);
  const maxLag = Math.min(bandwidth, calendar.length - 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    const weight = lag === 0 ? 1 : 1 - lag / (bandwidth + 1);
    for (const [index, current] of centeredByIndex) {
      if (lag === 0) {
        for (let i = 0; i < dimension; i++) for (let j = 0; j < dimension; j++)
          meat[i][j] += current[i] * current[j];
      } else {
        const previous = centeredByIndex.get(index - lag);
        if (!previous) continue;
        for (let i = 0; i < dimension; i++) for (let j = 0; j < dimension; j++)
          meat[i][j] += weight * (current[i] * previous[j] + previous[i] * current[j]);
      }
    }
  }
  // C = A^-1 (M/n^2) A^-1, using two Cholesky solves rather than a raw inverse.
  const scaledMeat = meat.map((row) => row.map((value) => value / (n * n)));
  const leftSolved = solveCholesky(lower, scaledMeat);
  const covariance = transpose(solveCholesky(lower, transpose(leftSolved)));
  for (let i = 0; i < dimension; i++) for (let j = i + 1; j < dimension; j++) {
    const symmetric = (covariance[i][j] + covariance[j][i]) / 2;
    covariance[i][j] = covariance[j][i] = symmetric;
  }
  if (covariance.some((row) => row.some((value) => !finite(value))))
    throw new Error("HAC coefficient covariance calculation produced a nonfinite result.");
  assertSymmetricPsd(covariance, "HAC coefficient covariance");
  return {
    selectedFactorIds: selectedFactorIds.slice(), lambda, bandwidth, intercept, slopes,
    scaler: selectedFactorIds.map((factorId, j) => ({
      factorId, mean: means[j], standardDeviation: deviations[j], constant: constants[j],
    })),
    trainingRowCount: n, trainingDateCount: observedDates.length, trainingRows,
    coefficientCovariance: covariance,
    dateScores: scores.map(([date, score]) => ({
      date, calendarIndex: calendarIndex.get(date)!, score: score.map((value, j) => value - averageScore[j]),
    })),
    calendarDates: calendar,
  };
}

/** Predict in caller candidate order; covariance retains all cross-candidate terms. */
export function predictSignalRidge(
  fit: SignalRidgeFit,
  candidates: SignalRidgeFeatureVector[],
): SignalRidgePrediction {
  if (!fit || !Array.isArray(candidates) || candidates.length === 0)
    throw new Error("A fitted ridge model and nonempty ordered candidates are required.");
  const ids = candidates.map((candidate) => candidate?.asset);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
    throw new Error("Candidate assets must be unique nonempty IDs in requested order.");
  if (candidates.some((candidate) => !candidate.features || typeof candidate.features !== "object"))
    throw new Error("Each prediction candidate requires a feature vector.");
  const factors = fit.selectedFactorIds;
  const means = fit.scaler.map((item) => item.mean);
  const deviations = fit.scaler.map((item) => item.standardDeviation);
  const constants = fit.scaler.map((item) => item.constant);
  const predictions = candidates.map((candidate) => rowPrediction(
    "", candidate.asset, candidate.features, factors, means, deviations, constants, fit.intercept, fit.slopes,
  ));
  const augmented = candidates.map((candidate) => [
    1,
    ...factors.map((id, j) => {
      const value = candidate.features?.[id];
      if (!finite(value)) throw new Error(`Prediction ${candidate.asset} is missing finite feature ${id}.`);
      return constants[j] ? 0 : (value - means[j]) / deviations[j];
    }),
  ]);
  const V_mu = augmented.map((left) => augmented.map((right) =>
    left.reduce((sum, value, i) => sum + value * fit.coefficientCovariance[i].reduce(
      (inner, coefficient, j) => inner + coefficient * right[j], 0), 0)));
  for (let i = 0; i < V_mu.length; i++) for (let j = i + 1; j < V_mu.length; j++) {
    const symmetric = (V_mu[i][j] + V_mu[j][i]) / 2;
    V_mu[i][j] = V_mu[j][i] = symmetric;
  }
  if (V_mu.some((row) => row.some((value) => !finite(value))))
    throw new Error("Forecast covariance calculation produced a nonfinite result.");
  assertSymmetricPsd(V_mu, "Forecast covariance");
  return {
    candidateIds: ids, intercept: fit.intercept, slopes: fit.slopes.slice(), predictions, V_mu,
    uncertaintyLabel: "Approximate sampling uncertainty of the penalized fitted forecast.",
  };
}