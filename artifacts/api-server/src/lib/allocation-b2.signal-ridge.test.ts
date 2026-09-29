import assert from "node:assert/strict";
import test from "node:test";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import type { FactorDefinition } from "./factor-library";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";

const tickers = ["AAA", "BBB", "CCC", "DDD", "EEE"];
const dates = Array.from({ length: 150 }, (_, index) =>
  new Date(Date.UTC(2022, 0, index + 1)).toISOString().slice(0, 10));
const informationCutoff = dates[120];
const dailyCashYield = 0.00003;
const factors: FactorDefinition[] = [
  {
    id: "ridge-momentum-short", name: "Momentum short", description: "Frozen B2 fixture factor",
    family: "Test", enabled: true, status: "active", inputSeries: "adjusted close",
    calculationType: "momentum", formula: "P(t-lag)/P(t-lag-lookback)-1",
    direction: "higher_is_better", lookback: 3, lag: 0, normalization: "percentile_rank",
    winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
    dataSource: "deterministic test prices", benchmarkTicker: null, currentCoverage: 1,
    availabilityReason: null, version: "ridge-b2-frozen-v1",
  },
  {
    id: "ridge-momentum-long", name: "Momentum long", description: "Frozen B2 fixture factor",
    family: "Test", enabled: true, status: "active", inputSeries: "adjusted close",
    calculationType: "momentum", formula: "P(t-lag)/P(t-lag-lookback)-1",
    direction: "higher_is_better", lookback: 9, lag: 0, normalization: "percentile_rank",
    winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
    dataSource: "deterministic test prices", benchmarkTicker: null, currentCoverage: 1,
    availabilityReason: null, version: "ridge-b2-frozen-v1",
  },
  {
    id: "ridge-volatility", name: "Volatility", description: "Frozen B2 fixture factor",
    family: "Test", enabled: true, status: "active", inputSeries: "adjusted close",
    calculationType: "volatility", formula: "realizedVolatility(P[t-lookback:t-lag])",
    direction: "lower_is_better", lookback: 7, lag: 0, normalization: "percentile_rank",
    winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
    dataSource: "deterministic test prices", benchmarkTicker: null, currentCoverage: 1,
    availabilityReason: null, version: "ridge-b2-frozen-v1",
  },
];

function frozenSnapshot(): PreparedSnapshot {
  const prices = tickers.map((_, assetIndex) => {
    let price = 80 + assetIndex * 13;
    return dates.map((_, timeIndex) => {
      if (timeIndex > 0) {
        const time = timeIndex + 1;
        const logReturn = 0.0002 * (assetIndex - 2) +
          0.003 * Math.sin(time * 0.19) +
          0.002 * Math.sin(time * (assetIndex + 1) * 0.071) +
          0.0015 * Math.cos((time + 3) * (assetIndex + 2) * 0.037);
        price *= Math.exp(logReturn);
      }
      return price;
    });
  });
  const csvContent = [
    `date,${tickers.join(",")}`,
    ...dates.map((date, dateIndex) =>
      `${date},${prices.map((series) => series[dateIndex].toFixed(10)).join(",")}`),
  ].join("\n");
  const prepared = prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: tickers, factorIds: [], alphaDefinitions: [] },
    csvContent,
    factorVersion: "ridge-b2-frozen-v1",
    factors,
  });
  assert.equal(prepared.representation, "asset_returns");
  assert.equal(prepared.candidates.length, tickers.length);
  assert.equal(prepared.dataset.tickers.length, tickers.length);
  return deepFreeze(prepared);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function request(snapshot: PreparedSnapshot, overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 77,
    candidateIds: snapshot.candidates.map((candidate) => candidate.candidateId),
    informationCutoff,
    // The current hypothetical execution is at the next available close;
    // same_close therefore uses a decision timestamp strictly after cutoff.
    decisionTimestamp: dates[121],
    estimationWindow: 90,
    minObservations: 60,
    representation: "asset_returns",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    forecastModel: {
      type: "SIGNAL_RIDGE",
      factorIds: factors.map((factor) => factor.id),
      lambdaSignal: 0.8,
      trainingWindowDates: 100,
      minTrainingDates: 60,
      hacBandwidth: 5,
      executionTiming: "same_close",
    },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.25 },
    covarianceDiagonalShrinkage: 0,
    dailyCashYield,
    objective: { type: "regularized_mean_variance", gamma: 30, eta: 0.01 },
    constraints: {},
    ...overrides,
  };
}

function close(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`);
}

function robustHaircut(result: ReturnType<typeof optimizePreparedSnapshot>, kappa: number): number {
  const ids = result.forecast!.candidateIds;
  const weights = ids.map((id) => result.candidateWeights![id]);
  const variance = weights.reduce((sum, wi, i) => sum + weights.reduce((inner, wj, j) =>
    inner + wi * result.forecast!.V_mu[i][j] * wj, 0), 0);
  return kappa * Math.sqrt(Math.max(0, variance));
}

test("B2 D6 T5/T7: frozen SIGNAL_RIDGE forecasts feed D4 independently of risk and D5", () => {
  const prepared = frozenSnapshot();
  const originalSnapshot = structuredClone(prepared);
  const candidateIds = prepared.candidates.map((candidate) => candidate.candidateId);
  const baseRequest = request(prepared);
  const base = optimizePreparedSnapshot(prepared, baseRequest);
  assert.equal(base.status, "SOLVED", base.reason);
  assert.deepEqual(base.forecast?.candidateIds, candidateIds);
  assert.equal(base.forecast?.estimator, "SIGNAL_RIDGE");

  const forecast = base.forecast!;
  const ridge = forecast.ridge as {
    factorIds: string[];
    trainingDateCount: number;
    trainingRows: Array<{
      informationCutoff: string;
      labelEnd: string;
      excessReturnLabel: number;
    }>;
    dailyCashYield: number;
    predictions: Array<{
      candidateId: string;
      intercept: number;
      contributions: Array<{ factorId: string; contribution: number }>;
      excessPrediction: number;
      grossPrediction: number;
    }>;
  };
  assert.deepEqual(ridge.factorIds, factors.map((factor) => factor.id));
  assert.ok(ridge.trainingDateCount >= 70, `only ${ridge.trainingDateCount} matured dates trained`);
  assert.equal(ridge.trainingRows.length, ridge.trainingDateCount * candidateIds.length);
  assert.ok(ridge.trainingRows.every((row) => row.informationCutoff <= informationCutoff &&
    row.labelEnd <= informationCutoff && Number.isFinite(row.excessReturnLabel)));
  assert.equal(ridge.dailyCashYield, dailyCashYield);
  assert.deepEqual(forecast.candidateIds, candidateIds);
  assert.equal(forecast.V_mu.length, candidateIds.length);
  assert.ok(forecast.V_mu.every((row) => row.length === candidateIds.length));
  assert.ok(forecast.V_mu.some((row, i) => row[i] > 0), "D4 fixture needs nonzero forecast uncertainty");
  assert.ok(baseRequest.robustness!.kappa > 0);

  for (const [index, prediction] of ridge.predictions.entries()) {
    assert.equal(prediction.candidateId, candidateIds[index]);
    const explained = prediction.intercept +
      prediction.contributions.reduce((sum, item) => sum + item.contribution, 0);
    close(explained, prediction.excessPrediction, 1e-12);
    close(prediction.grossPrediction, prediction.excessPrediction + dailyCashYield, 1e-12);
    close(forecast.muHat[index], prediction.grossPrediction, 1e-12);
  }
  close(base.robustness!.robustHaircut, robustHaircut(base, baseRequest.robustness!.kappa), 1e-8);
  assert.ok(base.robustness!.robustHaircut > 0, "D4 must apply the ordered V_mu uncertainty penalty");

  const alternateRiskRequest = request(prepared, { covarianceDiagonalShrinkage: 0.7 });
  const alternateRisk = optimizePreparedSnapshot(prepared, alternateRiskRequest);
  assert.equal(alternateRisk.status, "SOLVED", alternateRisk.reason);
  assert.notDeepEqual(alternateRisk.model?.sigma, base.model?.sigma,
    "fixture must exercise a different selected return-risk covariance");
  assert.deepEqual(alternateRisk.forecast?.candidateIds, candidateIds);
  assert.deepEqual(alternateRisk.forecast?.muHat, forecast.muHat);
  assert.deepEqual(alternateRisk.forecast?.V_mu, forecast.V_mu);
  close(alternateRisk.robustness!.robustHaircut,
    robustHaircut(alternateRisk, alternateRiskRequest.robustness!.kappa), 1e-8);

  const priceRow = prepared.dataset.csvContent.split("\n")
    .find((line) => line.startsWith(`${informationCutoff},`))!;
  const prices = Object.fromEntries(tickers.map((ticker, index) =>
    [ticker, Number(priceRow.split(",")[index + 1])]));
  const holdings = {
    asOf: informationCutoff,
    quantities: Object.fromEntries(tickers.map((ticker) => [ticker, 0.16 / prices[ticker]])),
    cash: 0.2,
    nav: 1,
  };
  const withD5Request = request(prepared, {
    rebalanceRegularization: { lambdaR: 0.04, holdings },
  });
  const withD5 = optimizePreparedSnapshot(prepared, withD5Request);
  assert.equal(withD5.status, "SOLVED", withD5.reason);
  assert.deepEqual(withD5.forecast?.candidateIds, candidateIds);
  assert.deepEqual(withD5.forecast?.muHat, forecast.muHat);
  assert.deepEqual(withD5.forecast?.V_mu, forecast.V_mu);
  assert.equal(withD5.rebalanceRegularization?.lambdaR, 0.04);

  const alphaUnsupported = optimizePreparedSnapshot(prepared, request(prepared, {
    representation: "alpha_streams",
  }));
  assert.equal(alphaUnsupported.status, "UNSUPPORTED");
  assert.match(alphaUnsupported.reason ?? "", /SIGNAL_RIDGE supports underlying asset_returns/);
  const signedUnsupported = optimizePreparedSnapshot(prepared, request(prepared, {
    allocationMode: "SIGNED_OVERLAY",
  }));
  assert.equal(signedUnsupported.status, "UNSUPPORTED");
  assert.match(signedUnsupported.reason ?? "", /SIGNAL_RIDGE supports underlying asset_returns/);

  assert.deepEqual(prepared, originalSnapshot, "optimization must not reinterpret or mutate its frozen snapshot");
});