import assert from "node:assert/strict";
import test from "node:test";
import { runB3Validation, type B3Assumptions } from "./b3-policy";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import type { FactorDefinition } from "./factor-library";

const tickers = ["AAA", "BBB", "CCC", "DDD", "EEE"];
const dates = Array.from({ length: 850 }, (_, index) =>
  new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10));

function fixtureCsv(multiplier = 1): string {
  return ["date,AAA,BBB,CCC,DDD,EEE", ...dates.map((date, index) => {
    const prices = tickers.map((_, assetIndex) => {
      const daily = 0.0004 * (assetIndex - 1.5) +
        0.002 * Math.sin(index * (assetIndex + 1) * 0.17) +
        0.001 * Math.cos(index * 0.11 + assetIndex);
      return (100 + assetIndex * 7) * Math.exp(
        Array.from({ length: index + 1 }, (_, step) =>
          0.0005 + 0.004 * Math.sin(step * (assetIndex + 1) * 0.13) +
          daily * Math.cos(step * 0.07)).reduce((sum, value) => sum + value, 0));
    });
    const adjusted = index > 650 ? prices.map((value) => value * multiplier) : prices;
    return `${date},${adjusted.map((value) => value.toFixed(8)).join(",")}`;
  })].join("\n");
}

const factor: FactorDefinition = {
  id: "ridge-momentum", name: "Momentum", description: "Sequential-test feature", family: "Test",
  enabled: true, status: "active", inputSeries: "adjusted close", calculationType: "momentum",
  formula: "P(t-lag)/P(t-lag-lookback)-1", direction: "higher_is_better", lookback: 6, lag: 0,
  normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
  missingDataTreatment: "exclude", baseWeight: 1,
  regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "fixture",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "ridge-test-v1",
};

function snapshot(csvContent = fixtureCsv()): PreparedSnapshot {
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: tickers, factorIds: [], alphaDefinitions: [] },
    csvContent, factorVersion: "ridge-test-v1", factors: [factor],
  });
}

function request(prepared: PreparedSnapshot): AllocationRequest {
  return {
    preparedInputId: 1,
    candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dates[40],
    decisionTimestamp: dates[41],
    estimationWindow: 30,
    minObservations: 20,
    representation: "asset_returns",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    forecastModel: {
      type: "SIGNAL_RIDGE", factorIds: [factor.id], lambdaSignal: 1,
      trainingWindowDates: 252, minTrainingDates: 60, hacBandwidth: 5,
      executionTiming: "next_close",
    },
    robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.5 },
    covarianceDiagonalShrinkage: 0.1,
    dailyCashYield: 0.00002,
    objective: { type: "regularized_mean_variance", gamma: 0.1, eta: 0.1 },
    constraints: {},
  };
}

const assumptions: B3Assumptions = {
  evaluationStartDate: dates[638],
  evaluationEndDate: dates[762],
  decisionCalendar: "monthly",
  executionTiming: "next_close",
  initialNav: 100_000,
  initialHoldings: {},
  initialCash: 100_000,
  transactionCostBps: 0,
  slippageBps: 0,
  dailyCashYield: 0.00002,
};

test("B3 Signal Ridge sequentially refits matured labels and records pending outcomes", () => {
  const prepared = snapshot();
  const result = runB3Validation(prepared, request(prepared), prepared, assumptions);
  assert.equal(result.status, "completed", result.reason);
  assert.ok(result.decisions.length >= 3);
  for (const decision of result.decisions) {
    assert.equal(decision.forecast?.estimator, "SIGNAL_RIDGE");
    const ridge = (decision.forecast as NonNullable<typeof decision.forecast> & {
      ridge: { trainingRows: Array<{ signalDate: string; informationCutoff: string;
        labelEnd: string; excessReturnLabel: number }>; trainingDateCount: number;
        scaler: Array<{ factorId: string }>; intercept: number; slopes: number[];
        predictions: Array<{ asset: string; excessPrediction: number }> };
    }).ridge;
    assert.equal(ridge.trainingRows.length, ridge.trainingDateCount * tickers.length);
    assert.ok(ridge.trainingRows.every((row) =>
      row.informationCutoff < decision.informationCutoff && row.labelEnd <= decision.informationCutoff));
    assert.ok(ridge.trainingDateCount >= 60);
    assert.deepEqual(ridge.scaler.map((item) => item.factorId), [factor.id]);
    assert.deepEqual(decision.forecast?.candidateIds, decision.pointInTimeCandidateIds);
    const lines = prepared.dataset.csvContent.trimEnd().split(/\r?\n/);
    const prefixCsv = [lines[0], ...lines.slice(1).filter((line) =>
      line.split(",")[0].replace(/^"|"$/g, "") <= decision.executionDate)].join("\n");
    const historical = prepareSnapshot({
      request: structuredClone(prepared.request), csvContent: prefixCsv,
      factorVersion: prepared.factorSet.version, factors: prepared.factorSet.factors,
      datasetId: prepared.dataset.id ?? undefined,
    });
    const isolatedRequest: AllocationRequest = {
      ...request(prepared),
      candidateIds: historical.candidates.map((candidate) => candidate.candidateId),
      informationCutoff: decision.informationCutoff,
      decisionTimestamp: decision.decisionDate,
    };
    const isolated = optimizePreparedSnapshot(historical, isolatedRequest);
    assert.equal(isolated.status, "SOLVED", isolated.reason);
    assert.deepEqual(decision.forecast?.ridge, isolated.forecast?.ridge);
    assert.deepEqual(decision.targetAssetWeights, isolated.assetWeights);
  }
  assert.ok(result.ridgeEvaluation);
  assert.ok(result.ridgeEvaluation.outcomes.some((outcome) => outcome.status === "MATURED"));
  assert.ok(result.ridgeEvaluation.outcomes.some((outcome) => outcome.status === "PENDING"));
  assert.ok(result.ridgeEvaluation.metrics.rmse !== null);
  assert.ok(result.ridgeEvaluation.metrics.mae !== null);
  assert.ok(result.decisions.some((decision) =>
    Object.values(decision.executedAssetWeights ?? {}).some((weight) => weight > 1e-8)));
  assert.ok(result.dailyLedger.some((entry) => entry.externalTrades.length > 0));
});

test("B3 Signal Ridge rejects an execution-timing mismatch", () => {
  const prepared = snapshot();
  const policy = request(prepared);
  policy.forecastModel = { ...policy.forecastModel!, type: "SIGNAL_RIDGE",
    executionTiming: "same_close" } as typeof policy.forecastModel;
  const result = runB3Validation(prepared, policy, prepared, assumptions);
  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /executionTiming must exactly match/);
});

test("future validation price values cannot alter an earlier saved ridge fit or forecast", () => {
  const prepared = snapshot();
  const changedFuture = snapshot(fixtureCsv(3));
  const policy = request(prepared);
  const changedPolicy = request(changedFuture);
  const shortAssumptions = { ...assumptions, evaluationStartDate: dates[638], evaluationEndDate: dates[762] };
  const original = runB3Validation(prepared, policy, prepared, shortAssumptions);
  const changed = runB3Validation(changedFuture, changedPolicy, changedFuture, shortAssumptions);
  assert.equal(original.status, "completed", original.reason);
  assert.equal(changed.status, "completed", changed.reason);
  const earlier = original.decisions.filter((decision) => decision.informationCutoff <= dates[650]);
  assert.ok(earlier.length >= 1);
  for (const decision of earlier) {
    const other = changed.decisions.find((candidate) => candidate.decisionDate === decision.decisionDate)!;
    assert.equal(decision.informationCutoff, other.informationCutoff);
    assert.deepEqual(decision.forecast?.ridge, other.forecast?.ridge);
    assert.deepEqual(decision.targetAssetWeights, other.targetAssetWeights);
  }
});