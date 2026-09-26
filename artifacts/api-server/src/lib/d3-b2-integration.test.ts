import assert from "node:assert/strict";
import test from "node:test";
import {
  optimizePreparedSnapshot, type AllocationRequest,
} from "./allocation-b2";
import type { ForecastModelConfig } from "./forecast-d3";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";

function dateAt(index: number): string {
  return new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
}

function centered(variance: number, scale: number[]): number[] {
  return scale.map((value) => value * Math.sqrt(variance));
}

const ids = ["a", "b"];
const dates = [1, 2, 3];
const returns = [
  centered(0.01, [-1, 1, 0]).map((value) => value + 0.02),
  centered(0.04, [1 / Math.sqrt(3), 1 / Math.sqrt(3), -2 / Math.sqrt(3)])
    .map((value) => value + 0.01),
];

function candidate(id: string, values: number[], signed = false): PreparedCandidate {
  return {
    candidateId: id, canonicalFingerprint: id, name: id,
    kind: signed ? "alpha_streams" : "asset_returns", status: "READY", reasons: [],
    assetTickers: [id.toUpperCase()], targetAssetExposures: { [id.toUpperCase()]: 1 },
    actualAssetExposures: { [id.toUpperCase()]: 1 }, residualCash: 0,
    targetHistory: signed ? [{ signalDate: dateAt(5), informationCutoff: dateAt(4),
      executionDate: dateAt(5), targetPositions: { [id.toUpperCase()]: 1 } }] : [],
    signalSeries: [],
    returnSeries: signed ? [] : values.map((value, i) => ({ date: dateAt(dates[i]), value })),
    ledger: signed ? values.map((value, i) => ({
      date: dateAt(dates[i]), beginningNav: 100, beginningCash: 0,
      etfPnl: value * 100, cashPnl: 0, netPnl: value * 100, transactionCosts: 0, slippage: 0,
    })) : [],
    lineage: signed ? { datasetHash: "d3-integration", definition: { cashYieldAnnual: 0 } } : {},
    diagnostics: {},
  } as PreparedCandidate;
}

function snapshot(signed = false): PreparedSnapshot {
  const candidates = ids.map((id, i) => candidate(id, returns[i], signed));
  return {
    schemaVersion: 1, engineVersion: "allocation-b1.0", a1EngineVersion: "a1",
    representation: signed ? "alpha_streams" : "asset_returns",
    dataset: { id: 10, sha256: "d3-integration", csvContent: "fixture", startDate: dateAt(0),
      endDate: dateAt(10), tickers: ["A", "B"], priceConvention: "adjusted close" },
    factorSet: { version: "test", factors: [] }, request: { representation: signed ? "alpha_streams" : "asset_returns",
      assetTickers: [], factorIds: [], alphaDefinitions: [] }, coverage: {}, candidates,
    dependence: {}, suppliedWeights: {}, createdAt: dateAt(0),
  } as unknown as PreparedSnapshot;
}

function request(signed: boolean, forecastModel: ForecastModelConfig): AllocationRequest {
  return {
    preparedInputId: 10, candidateIds: ids, informationCutoff: dateAt(5), decisionTimestamp: dateAt(5),
    estimationWindow: 3, minObservations: 3, representation: signed ? "alpha_streams" : "asset_returns",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0.005, objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.1 },
    constraints: signed ? {} : { totalCash: { min: 0, max: 0 } },
    ...(signed ? { allocationMode: "SIGNED_OVERLAY" as const,
      signedConstraints: { alphaBounds: { a: { min: -1, max: 1 }, b: { min: -1, max: 1 } } } } : {}),
    ...(signed ? { riskModel: { type: "SAMPLE" as const } } : {}),
    forecastModel,
  };
}

const configurations: Array<{ name: string; config: ForecastModelConfig }> = [
  { name: "sample mean", config: { type: "SAMPLE_MEAN" } },
  { name: "shrunk mean", config: { type: "SHRUNK_MEAN", shrinkage: 0.5 } },
  { name: "Bayesian views", config: {
    type: "BAYESIAN_VIEWS",
    priorMean: { source: "SAMPLE_PRIOR" },
    priorUncertainty: { type: "TAU_SIGMA", tau: 1 / 3 },
    views: [{ type: "ABSOLUTE", candidateId: "a", q: 0.04, variance: 1e-7,
      effectiveTimestamp: dateAt(3), availabilityTimestamp: dateAt(3) }],
  } },
];

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from independently calculated ${expected}`);
}

for (const signed of [false, true]) {
  test(`D3 T6 ${signed ? "D2 signed" : "B2 capital"} integration uses each exact forecast and replays`, () => {
    const prepared = snapshot(signed);
    let selectedSigma: number[][] | undefined;
    for (const { name, config } of configurations) {
      const query = request(signed, config);
      const result = optimizePreparedSnapshot(prepared, query);
      assert.equal(result.status, "SOLVED", `${name}: ${result.reason}`);
      assert.ok(result.forecast);
      assert.deepEqual(result.model!.mu, result.forecast.muHat);
      assert.deepEqual(result.forecast.config, config);
      assert.deepEqual(result.model!.sigma, selectedSigma ?? result.model!.sigma);
      selectedSigma ??= result.model!.sigma;

      const sigma = result.model!.sigma;
      const mu = result.forecast.muHat;
      const weights = ids.map((id) => result.candidateWeights![id]);
      if (signed) {
        close(weights[0], mu[0] / (2 * sigma[0][0] + 0.1));
        close(weights[1], mu[1] / (2 * sigma[1][1] + 0.1));
      } else {
        const expectedA = (2 * sigma[1][1] + 0.1 + mu[0] - mu[1]) /
          (2 * (sigma[0][0] + sigma[1][1]) + 0.2);
        close(weights[0], expectedA);
        close(weights[1], 1 - expectedA);
      }
      const variance = 0.5 * 2 * weights.reduce((sum, weight, i) => sum +
        weight * sigma[i].reduce((inner, value, j) => inner + value * weights[j], 0), 0);
      const regularization = 0.05 * weights.reduce((sum, weight) => sum + weight * weight, 0);
      const candidateReturn = -weights.reduce((sum, weight, i) => sum + weight * mu[i], 0);
      close(result.objectiveContributions!.variance, variance);
      close(result.objectiveContributions!.regularization, regularization);
      close(result.objectiveContributions!.candidateReturn, candidateReturn);
      close(result.objectiveContributions!.total, variance + regularization + candidateReturn);

      const forecast = result.forecast;
      const portfolioVariance = weights.reduce((sum, wi, i) => sum + weights.reduce((inner, wj, j) =>
        inner + wi * forecast.V_mu[i][j] * wj, 0), 0);
      const portfolio = forecast.portfolio!;
      close(portfolio.expectedReturn, weights.reduce((sum, weight, i) =>
        sum + weight * mu[i], 0));
      close(portfolio.varianceOfExpectedReturn, portfolioVariance);
      close(portfolio.standardError, Math.sqrt(Math.max(0, portfolioVariance)));

      const replay = optimizePreparedSnapshot(prepared, structuredClone(query));
      assert.deepEqual(replay, result, `${name} forecast and allocation replay exactly`);
    }
  });
}

test("D3 forecast failures are explicit and retain invalid configuration provenance", () => {
  const prepared = snapshot();
  const invalidConfig: ForecastModelConfig = { type: "SAMPLE_MEAN", displayZ: -1 };
  const invalid = optimizePreparedSnapshot(prepared, request(false, invalidConfig));
  assert.equal(invalid.status, "INVALID_FORECAST_MODEL");
  assert.deepEqual(invalid.forecast?.config, invalidConfig);
  assert.equal(invalid.forecast?.status, "INVALID_FORECAST_MODEL");
  assert.equal(invalid.candidateWeights, null);

  const conflict = optimizePreparedSnapshot(prepared, {
    ...request(false, { type: "SAMPLE_MEAN" }), expectedReturnShrinkage: 0.25,
  });
  assert.equal(conflict.status, "INVALID_FORECAST_MODEL");
  assert.equal(conflict.candidateWeights, null);
});
