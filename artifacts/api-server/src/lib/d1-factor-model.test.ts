import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStatisticalFactorRiskModel,
  decomposeStatisticalFactorRisk,
  type D1StatisticalFactorRiskModel,
} from "./d1-factor-model";

const TOLERANCE = 1e-10;

function close(actual: number, expected: number, tolerance = TOLERANCE) {
  assert.ok(Number.isFinite(actual), `expected a finite value; got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected)),
    `${actual} differs from ${expected} by more than relative tolerance ${tolerance}`);
}

function validModel(
  returns: number[][],
  ids: string[],
  factorCount: number | undefined,
  floor = 1e-6,
): D1StatisticalFactorRiskModel {
  const result = buildStatisticalFactorRiskModel(returns, ids, factorCount, floor);
  assert.equal(result.status, "VALID", result.status === "VALID" ? undefined : result.reason);
  return result as D1StatisticalFactorRiskModel;
}

/** Centered, mutually orthonormal Helmert contrasts with unit sample variance. */
function sampleOrthogonalReturns(observations: number): number[][] {
  const contrasts: number[][] = [];
  for (let column = 0; column < observations - 1; column++) {
    const values = Array<number>(observations).fill(0);
    const scale = Math.sqrt((observations - 1) / ((column + 1) * (column + 2)));
    for (let row = 0; row <= column; row++) values[row] = scale;
    values[column + 1] = -(column + 1) * scale;
    contrasts.push(values);
  }
  return Array.from({ length: observations }, (_, row) => contrasts.map((column) => column[row]));
}

function oneKnownCommonFactorFixture() {
  const observations = 5;
  const sigma = [0.01, 0.02, 0.03];
  const rho = 0.4;
  const orthogonal = sampleOrthogonalReturns(observations);
  const common = orthogonal.map((row) => row[0]);
  const idiosyncratic = sigma.map((_, alpha) => orthogonal.map((row) => row[alpha + 1]));
  const returns = Array.from({ length: observations }, (_, time) =>
    sigma.map((volatility, alpha) => volatility * (
      Math.sqrt(rho) * common[time] + Math.sqrt(1 - rho) * idiosyncratic[alpha][time]
    )));
  return { returns, sigma, rho };
}

test("D1 T1 independently reconstructs S, R, Omega, Phi, Xi and PSD Gamma", () => {
  const { returns, sigma, rho } = oneKnownCommonFactorFixture();
  const model = validModel(returns, ["alpha-a", "alpha-b", "alpha-c"], 1);
  const lambda = 1 + 2 * rho;
  const loading = 1 / Math.sqrt(3);

  assert.equal(model.observationCount, 5);
  assert.equal(model.alphaCount, 3);
  model.diagnostics.sampleVariances.forEach((variance, alpha) => close(variance, sigma[alpha] ** 2));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const expectedCorrelation = i === j ? 1 : rho;
      close(model.correlationMatrix[i][j], expectedCorrelation);
      close(model.sampleCovariance[i][j], sigma[i] * sigma[j] * expectedCorrelation);
      close(model.eigenvectors[i][0], loading);
      close(model.omega[i][0], sigma[i] * loading);
      close(model.gamma[i][j],
        (i === j ? sigma[i] ** 2 * (1 - lambda / 3) : 0) +
          sigma[i] * sigma[j] * lambda / 3);
    }
    close(model.phi[i]?.[i] ?? 0, i === 0 ? lambda : 0);
    close(model.xi[i][i], sigma[i] ** 2 * (1 - lambda / 3));
  }
  close(model.eigenvalues[0], lambda);
  close(model.eigenvalues[1], 1 - rho);
  close(model.eigenvalues[2], 1 - rho);
  assert.ok(model.diagnostics.factorCovarianceEigenvalues.every((value) => value >= -1e-12));
  assert.equal(model.diagnostics.factorBasisUnstable, true);
});

test("D1 T2 independently reconciles factor, specific, and Euler alpha component risk", () => {
  const model = validModel(oneKnownCommonFactorFixture().returns, ["a", "b", "c"], 1);
  const weights = [0.5, 0.3, 0.2];
  const decomposition = decomposeStatisticalFactorRisk(model, weights);
  assert.equal(decomposition.status, "VALID", decomposition.status === "VALID" ? undefined : decomposition.reason);
  if (decomposition.status !== "VALID") return;

  const manualVariance = weights.reduce((sum, left, i) =>
    sum + weights.reduce((rowSum, right, j) => rowSum + left * model.gamma[i][j] * right, 0), 0);
  const manualFactorExposure = model.omega[0].map((_, factor) =>
    weights.reduce((sum, weight, alpha) => sum + weight * model.omega[alpha][factor], 0));
  const manualFactorVariance = manualFactorExposure.reduce((sum, exposure, factor) =>
    sum + exposure * exposure * model.phi[factor][factor], 0);
  const manualSpecificVariance = weights.reduce((sum, weight, alpha) =>
    sum + weight * weight * model.xi[alpha][alpha], 0);
  const manualComponentRisk = weights.map((weight, alpha) => weight *
    model.gamma[alpha].reduce((sum, covariance, j) => sum + covariance * weights[j], 0) /
    Math.sqrt(manualVariance));

  close(decomposition.portfolioVariance, manualVariance);
  close(decomposition.factorVariance, manualFactorVariance);
  close(decomposition.specificVariance, manualSpecificVariance);
  close(decomposition.portfolioVariance, decomposition.factorVariance + decomposition.specificVariance);
  close(decomposition.alphaMarginalComponentRisk.reduce((sum, risk) =>
    sum + (risk.componentContributionToRisk ?? 0), 0), decomposition.portfolioVolatility);
  decomposition.alphaMarginalComponentRisk.forEach((risk, alpha) =>
    close(risk.componentContributionToRisk!, manualComponentRisk[alpha]));

  const zeroWeights = decomposeStatisticalFactorRisk(model, [0, 0, 0]);
  assert.equal(zeroWeights.status, "VALID");
  if (zeroWeights.status === "VALID")
    assert.ok(zeroWeights.alphaMarginalComponentRisk.every((risk) =>
      risk.marginalContributionToRisk === null && risk.componentContributionToRisk === null));
});

test("D1 T3 remains finite and PSD for N > T and reports declared floor-bound risk", () => {
  const returns = Array.from({ length: 4 }, (_, time) => Array.from({ length: 9 }, (_, alpha) =>
    0.0003 * (alpha + 1) * Math.sin((time + 1) * (alpha + 1) * 0.37) +
    0.0002 * Math.cos((time + 2) * (alpha + 2) * 0.23)));
  const ids = Array.from({ length: 9 }, (_, alpha) => `alpha-${alpha}`);
  const model = validModel(returns, ids, undefined, 10);
  assert.equal(model.factorCount, 3); // min(5, N-1, T-1), without an explicit override.
  assert.ok(model.diagnostics.sampleCovarianceRank <= returns.length - 1);
  assert.ok(model.gamma.flat().every(Number.isFinite));
  assert.equal(model.diagnostics.floorBoundAlphaIds.length, ids.length);
  assert.deepEqual(model.diagnostics.floorBoundAlphaIds, ids);
  assert.ok(model.diagnostics.floorAdjustedDiagonalAlphaIds.length > 0);
  assert.ok(model.diagnostics.factorCovarianceEigenvalues.every((value) => value >= -1e-12));
  const decomposition = decomposeStatisticalFactorRisk(model, Array(9).fill(1 / 9));
  assert.equal(decomposition.status, "VALID", decomposition.status === "VALID" ? undefined : decomposition.reason);
});

test("D1 T4 rejects invalid fixed F, preserves eigen order/sign, and flags tied basis", () => {
  const fixture = oneKnownCommonFactorFixture();
  const invalidCount = buildStatisticalFactorRiskModel(fixture.returns, ["a", "b", "c"], 3);
  assert.equal(invalidCount.status, "INSUFFICIENT_HISTORY_OR_DIMENSION");
  const invalidTimeCount = buildStatisticalFactorRiskModel(fixture.returns, ["a", "b", "c"], 5);
  assert.equal(invalidTimeCount.status, "INSUFFICIENT_HISTORY_OR_DIMENSION");
  const invalidVariance = buildStatisticalFactorRiskModel([[0, 0], [1, 0], [2, 0]], ["a", "b"], 1);
  assert.equal(invalidVariance.status, "INVALID_FACTOR_MODEL");

  const orthogonal = sampleOrthogonalReturns(5);
  const ids = ["a", "b", "c"];
  const tiedReturns = Array.from({ length: 5 }, (_, time) =>
    ids.map((_, alpha) => orthogonal[time][alpha] * (alpha + 1) * 0.01));
  const model = validModel(tiedReturns, ids, 1, 0);
  assert.equal(model.diagnostics.factorBasisUnstable, true);
  assert.ok(model.diagnostics.warnings.includes("FACTOR_BASIS_UNSTABLE"));
  for (let i = 1; i < model.eigenvalues.length; i++)
    assert.ok(model.eigenvalues[i - 1] >= model.eigenvalues[i]);
  for (let factor = 0; factor < model.alphaCount; factor++) {
    let pivot = 0;
    for (let alpha = 1; alpha < model.alphaCount; alpha++)
      if (Math.abs(model.eigenvectors[alpha][factor]) > Math.abs(model.eigenvectors[pivot][factor])) pivot = alpha;
    assert.ok(model.eigenvectors[pivot][factor] >= 0);
  }
  const repeated = validModel(tiedReturns, ids, 1, 0);
  assert.deepEqual(repeated.eigenvalues, model.eigenvalues);
  assert.deepEqual(repeated.eigenvectors, model.eigenvectors);
  assert.deepEqual(repeated.gamma, model.gamma);
  assert.ok(model.diagnostics.factorCovarianceEigenvalues.every((value) => value >= -1e-12));
});