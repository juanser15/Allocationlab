import assert from "node:assert/strict";
import test from "node:test";
import { fitSignalRidge, predictSignalRidge, type SignalRidgeTrainingRow } from "./signal-ridge";

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiply(left: number[][], right: number[][]): number[][] {
  return left.map((row) => right[0].map((_, column) =>
    row.reduce((sum, value, k) => sum + value * right[k][column], 0)));
}

function inverse(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented = matrix.map((row, i) =>
    [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = 0; j < 2 * n; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = augmented[row][column];
      for (let j = 0; j < 2 * n; j++) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row.slice(n));
}

function referenceRidgeHac(
  rows: SignalRidgeTrainingRow[],
  factors: string[],
  lambda: number,
  q: number,
  candidates: Array<{ asset: string; features: Record<string, number> }>,
) {
  const n = rows.length, dimension = factors.length + 1;
  const means = factors.map((factor) => rows.reduce((sum, row) => sum + row.features[factor], 0) / n);
  const deviations = factors.map((factor, j) => Math.sqrt(rows.reduce((sum, row) =>
    sum + (row.features[factor] - means[j]) ** 2, 0) / n));
  const design = rows.map((row) => [1, ...factors.map((factor, j) =>
    (row.features[factor] - means[j]) / deviations[j])]);
  const gram = Array.from({ length: dimension }, (_, i) =>
    Array.from({ length: dimension }, (_, j) =>
      design.reduce((sum, z) => sum + z[i] * z[j] / n, 0) + (i === j && i > 0 ? lambda : 0)));
  const inverseGram = inverse(gram);
  const response = rows.map((row) => [row.y]);
  const theta = multiply(inverseGram, multiply(transpose(design), response).map((row) =>
    row.map((value) => value / n)));
  const residuals = rows.map((row, i) => row.y -
    design[i].reduce((sum, value, j) => sum + value * theta[j][0], 0));
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const scores = dates.map((date) => design.reduce((score, z, i) => {
    if (rows[i].date === date) z.forEach((value, j) => { score[j] += value * residuals[i]; });
    return score;
  }, Array(dimension).fill(0) as number[]));
  const average = Array(dimension).fill(0) as number[];
  scores.forEach((score) => score.forEach((value, j) => { average[j] += value / dates.length; }));
  const centered = scores.map((score) => score.map((value, j) => value - average[j]));
  const lagSums = Array.from({ length: q + 1 }, () =>
    Array.from({ length: dimension }, () => Array(dimension).fill(0) as number[]));
  for (let lag = 0; lag <= q; lag++) for (let t = lag; t < dates.length; t++)
    for (let i = 0; i < dimension; i++) for (let j = 0; j < dimension; j++)
      lagSums[lag][i][j] += centered[t][i] * centered[t - lag][j];
  const meat = lagSums[0].map((row) => row.slice());
  for (let lag = 1; lag <= q; lag++) {
    const weight = 1 - lag / (q + 1);
    for (let i = 0; i < dimension; i++) for (let j = 0; j < dimension; j++)
      meat[i][j] += weight * (lagSums[lag][i][j] + lagSums[lag][j][i]);
  }
  const coefficientCovariance = multiply(
    multiply(inverseGram, meat.map((row) => row.map((value) => value / (n * n)))),
    transpose(inverseGram),
  );
  const predictionDesign = candidates.map((candidate) => [1, ...factors.map((factor, j) =>
    (candidate.features[factor] - means[j]) / deviations[j])]);
  const V_mu = multiply(multiply(predictionDesign, coefficientCovariance), transpose(predictionDesign));
  return { means, deviations, theta: theta.map((row) => row[0]), scores, centered, lagSums, meat,
    coefficientCovariance, design, predictionDesign, V_mu };
}

function matrixClose(actual: number[][], expected: number[][], tolerance = 1e-8): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((row, i) => {
    assert.equal(row.length, expected[i].length);
    row.forEach((value, j) => assert.ok(Math.abs(value - expected[i][j]) <= tolerance,
      `matrix[${i}][${j}] ${value} differs from ${expected[i][j]}`));
  });
}

function assertPsd3(matrix: number[][]): void {
  const tolerance = 1e-10;
  for (let i = 0; i < 3; i++) assert.ok(matrix[i][i] >= -tolerance);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
    assert.ok(matrix[i][i] * matrix[j][j] - matrix[i][j] ** 2 >= -tolerance);
  const determinant = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  assert.ok(determinant >= -tolerance);
}

test("T1: average-loss ridge has the independently calculated one-feature slope", () => {
  const rows: SignalRidgeTrainingRow[] = [
    { date: "2024-01-01", asset: "A", features: { x: -1 }, y: -0.02 },
    { date: "2024-01-02", asset: "A", features: { x: 1 }, y: 0.02 },
  ];
  const fit = fitSignalRidge(rows, ["x"], 1, 0);
  // The feature variance is one, so (1 + lambda) beta = mean(z*y) = .02.
  assert.ok(Math.abs(fit.intercept) < 1e-14);
  assert.ok(Math.abs(fit.slopes[0] - 0.01) < 1e-14);
  assert.deepEqual(fit.scaler[0], {
    factorId: "x", mean: 0, standardDeviation: 1, constant: false,
  });
  assert.ok(Math.abs(fit.trainingRows[0].excessPrediction + 0.01) < 1e-14);
  assert.ok(Math.abs(fit.trainingRows[1].excessPrediction - 0.01) < 1e-14);
});

test("ridge keeps collinear factors and makes a training-constant factor contribute zero", () => {
  const rows: SignalRidgeTrainingRow[] = [
    { date: "2024-02-01", asset: "A", features: { x: -1, copy: -1, fixed: 9 }, y: -0.03 },
    { date: "2024-02-01", asset: "B", features: { x: -1, copy: -1, fixed: 9 }, y: -0.01 },
    { date: "2024-02-02", asset: "A", features: { x: 1, copy: 1, fixed: 9 }, y: 0.02 },
    { date: "2024-02-02", asset: "B", features: { x: 1, copy: 1, fixed: 9 }, y: 0.04 },
  ];
  const fit = fitSignalRidge(rows, ["x", "copy", "fixed"], 0.5, 0);
  assert.equal(fit.selectedFactorIds.length, 3);
  assert.equal(fit.scaler[2].constant, true);
  assert.equal(fit.slopes[2], 0);
  assert.ok(Math.abs(fit.slopes[0] - fit.slopes[1]) < 1e-14);
  // Check normal-equation residuals independently: mean(z_j * residual) = lambda * beta_j.
  for (const j of [0, 1]) {
    const score = rows.reduce((sum, row, i) =>
      sum + fit.trainingRows[i].contributions[j].standardizedValue *
        (row.y - fit.trainingRows[i].excessPrediction), 0) / rows.length;
    assert.ok(Math.abs(score - 0.5 * fit.slopes[j]) < 1e-14);
  }
  const prediction = predictSignalRidge(fit, [
    { asset: "B", features: { x: 0.5, copy: 0.5, fixed: 100 } },
    { asset: "A", features: { x: -0.5, copy: -0.5, fixed: -5 } },
  ]);
  assert.deepEqual(prediction.candidateIds, ["B", "A"]);
  assert.equal(prediction.predictions[0].contributions[2].contribution, 0);
  assert.equal(prediction.predictions[1].contributions[2].contribution, 0);
});

test("T4: date-clustered Bartlett HAC preserves shared cross-candidate uncertainty and calendar gaps", () => {
  const rows: SignalRidgeTrainingRow[] = [
    { date: "2024-03-01", asset: "A", features: { fixed: 7 }, y: 0.01 },
    { date: "2024-03-01", asset: "B", features: { fixed: 7 }, y: 0.01 },
    { date: "2024-03-02", asset: "A", features: { fixed: 7 }, y: -0.01 },
    { date: "2024-03-02", asset: "B", features: { fixed: 7 }, y: -0.01 },
    { date: "2024-03-04", asset: "A", features: { fixed: 7 }, y: 0.03 },
    { date: "2024-03-04", asset: "B", features: { fixed: 7 }, y: 0.03 },
  ];
  const fit = fitSignalRidge(rows, ["fixed"], 1, 1,
    ["2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04"]);
  // Independent date-score calculation: [0, -.04, .04], centered mean zero.
  // S0=.0032; lag one contributes zero (the Mar 2/Mar 4 scores are two
  // trading-calendar observations apart). With n=6 and A_intercept=1,
  // C_intercept=.0032/36. Constant-factor uncertainty is exactly zero.
  const expected = 0.0032 / 36;
  assert.equal(fit.dateScores[2].calendarIndex, 3);
  assert.equal(fit.slopes[0], 0);
  assert.ok(Math.abs(fit.coefficientCovariance[0][0] - expected) < 1e-14);
  assert.equal(fit.coefficientCovariance[1][1], 0);
  const prediction = predictSignalRidge(fit, [
    { asset: "A", features: { fixed: 7 } },
    { asset: "B", features: { fixed: 7 } },
  ]);
  assert.deepEqual(prediction.candidateIds, ["A", "B"]);
  assert.ok(Math.abs(prediction.V_mu[0][1] - expected) < 1e-14);
  assert.equal(prediction.V_mu[0][1], prediction.V_mu[1][0]);
  assert.ok(prediction.V_mu[0][0] > 0);
});

test("T4 reference: multifeature date scores, Bartlett sandwich, cross-candidate V_mu, and replication invariance", () => {
  const dates = ["2024-04-01", "2024-04-02", "2024-04-03", "2024-04-04", "2024-04-05"];
  const panel: Array<{ x: number; z: number; base: number; shock: number }> = [
    { x: -2, z: 0, base: -0.030, shock: 0.010 },
    { x: -1, z: 2, base: -0.012, shock: -0.006 },
    { x: 0, z: -1, base: 0.004, shock: 0.014 },
    { x: 1, z: 1, base: 0.018, shock: -0.010 },
    { x: 2, z: -2, base: 0.031, shock: 0.004 },
  ];
  const rows: SignalRidgeTrainingRow[] = dates.flatMap((date, t) =>
    [0, 1].map((assetIndex) => ({
      date, asset: `A${assetIndex}`,
      features: { x: panel[t].x + assetIndex * 0.2, z: panel[t].z - assetIndex * 0.3 },
      // Both assets share the date shock; small opposite idiosyncrasy avoids
      // making the shared shock the only source of residual variation.
      y: panel[t].base + panel[t].shock + (assetIndex === 0 ? -0.001 : 0.001),
    })));
  const candidates = [
    { asset: "C", features: { x: -1.3, z: 0.8 } },
    { asset: "A", features: { x: 0.4, z: -0.7 } },
    { asset: "B", features: { x: 1.6, z: 1.2 } },
  ];
  const lambda = 0.7, q = 1;
  const reference = referenceRidgeHac(rows, ["x", "z"], lambda, q, candidates);
  const fit = fitSignalRidge(rows, ["x", "z"], lambda, q, dates);
  const prediction = predictSignalRidge(fit, candidates);

  assert.ok(reference.scores.some((score) => Math.abs(score[0]) > 1e-8));
  assert.ok(Math.abs(reference.lagSums[1][0][0]) > 1e-10,
    "fixture must exercise nonzero adjacent-date HAC terms");
  // Independently reconstruct each date's uncentered g_t from row scores and
  // verify S_0, S_1, and the q=1 Bartlett M entrywise before sandwiching.
  const rawDateScores = dates.map((date) => rows.reduce((score, row, i) => {
    if (row.date === date) {
      const residual = row.y - reference.design[i]
        .reduce((sum, value, j) => sum + value * reference.theta[j], 0);
      reference.design[i].forEach((value, j) => { score[j] += value * residual; });
    }
    return score;
  }, Array(3).fill(0) as number[]));
  rawDateScores.forEach((score, t) => score.forEach((value, j) =>
    assert.ok(Math.abs(value - reference.scores[t][j]) < 1e-10)));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const directS0 = reference.centered.reduce((sum, score) => sum + score[i] * score[j], 0);
    const directS1 = reference.centered.slice(1).reduce((sum, score, t) =>
      sum + score[i] * reference.centered[t][j], 0);
    assert.ok(Math.abs(reference.lagSums[0][i][j] - directS0) < 1e-12);
    assert.ok(Math.abs(reference.lagSums[1][i][j] - directS1) < 1e-12);
    const directBartlettMeat = directS0 + 0.5 * (directS1 +
      reference.centered.slice(1).reduce((sum, score, t) =>
        sum + score[j] * reference.centered[t][i], 0));
    assert.ok(Math.abs(reference.meat[i][j] - directBartlettMeat) < 1e-12);
  }
  assert.ok(Math.abs(reference.V_mu[0][1]) > 1e-10,
    "fixture must produce nonzero cross-candidate forecast covariance");
  assert.ok(Math.abs(fit.intercept - reference.theta[0]) < 1e-8);
  fit.slopes.forEach((slope, j) => assert.ok(Math.abs(slope - reference.theta[j + 1]) < 1e-8));
  fit.scaler.forEach((item, j) => {
    assert.ok(Math.abs(item.mean - reference.means[j]) < 1e-12);
    assert.ok(Math.abs(item.standardDeviation - reference.deviations[j]) < 1e-12);
  });
  fit.dateScores.forEach((entry, t) => entry.score.forEach((score, j) =>
    assert.ok(Math.abs(score - reference.centered[t][j]) < 1e-8)));
  matrixClose(fit.coefficientCovariance, reference.coefficientCovariance);
  matrixClose(prediction.V_mu, reference.V_mu);
  assert.ok(Math.abs(prediction.V_mu[0][1]) > 1e-10);
  assertPsd3(fit.coefficientCovariance);
  assertPsd3(prediction.V_mu);

  // Repeating every asset's identical information doubles each date score and
  // row count, so M and n^2 scale equally. A row-iid calculation would instead
  // report an artificial covariance reduction as the panel is replicated.
  const replicated = rows.flatMap((row) => [
    row,
    { ...row, asset: `${row.asset}-replica`, features: { ...row.features } },
  ]);
  const replicatedFit = fitSignalRidge(replicated, ["x", "z"], lambda, q, dates);
  const replicatedPrediction = predictSignalRidge(replicatedFit, candidates);
  fit.slopes.forEach((slope, j) => assert.ok(Math.abs(slope - replicatedFit.slopes[j]) < 1e-10));
  assert.ok(Math.abs(fit.intercept - replicatedFit.intercept) < 1e-10);
  matrixClose(replicatedFit.coefficientCovariance, fit.coefficientCovariance, 1e-10);
  matrixClose(replicatedPrediction.V_mu, prediction.V_mu, 1e-10);
});

test("ridge rejects missing or nonfinite training and prediction inputs", () => {
  assert.throws(() => fitSignalRidge([
    { date: "2024-01-01", asset: "A", features: {}, y: 0 },
  ], ["x"], 1, 0), /missing finite feature/);
  const fit = fitSignalRidge([
    { date: "2024-01-01", asset: "A", features: { x: 1 }, y: 0 },
    { date: "2024-01-02", asset: "A", features: { x: 2 }, y: 1 },
  ], ["x"], 1, 0);
  assert.throws(() => predictSignalRidge(fit, [
    { asset: "A", features: {} },
  ]), /missing finite feature/);
});