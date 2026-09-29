import assert from "node:assert/strict";
import test from "node:test";
import { runB3Validation, type B3Assumptions, type B3RebalanceRegularizationRequest } from "./b3-policy";
import type { AllocationRequest } from "./allocation-b2";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";

const dateAt = (index: number) => new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
const factor: FactorDefinition = {
  id: "d5-simple-momentum", name: "D5 simple momentum", description: "D5 historical fixture",
  family: "Momentum", enabled: true, status: "active", inputSeries: "adjusted close",
  calculationType: "momentum", formula: "return(3)", direction: "higher_is_better",
  lookback: 3, lag: 0, normalization: "percentile_rank", winsorizationLower: 0,
  winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
  regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
  dataSource: "D5 historical fixture", benchmarkTicker: null, currentCoverage: 1,
  availabilityReason: null, version: "d5-simple-test",
};

function csv(missing?: { ticker: string; index: number }): string {
  return ["date,A,B", ...Array.from({ length: 150 }, (_, i) => {
    const a = missing?.ticker === "A" && missing.index === i ? "" :
      (100 + i * 0.22 + Math.sin(i / 4)).toFixed(8);
    const b = missing?.ticker === "B" && missing.index === i ? "" :
      (90 + i * 0.11 + Math.cos(i / 5) * 2).toFixed(8);
    return `${dateAt(i)},${a},${b}`;
  })].join("\n");
}

function snapshot(source = csv()): PreparedSnapshot {
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: ["A", "B"], factorIds: [], alphaDefinitions: [] },
    csvContent: source, factorVersion: "d5-simple-test", factors: [factor], datasetId: 550,
  });
}

function alphaSnapshot(source: string): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams", assetTickers: ["A", "B"], factorIds: [],
      alphaDefinitions: ["A", "B"].map((ticker) => ({
        name: `D5 mapped alpha ${ticker}`, factorId: factor.id, assetTickers: [ticker],
        mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
        threshold: -1, grossFraction: 0.7, rebalanceFrequency: "monthly" as const,
        executionTiming: "next_close" as const, transactionCostBps: 0, slippageBps: 0,
        cashYieldAnnual: 0,
      })),
    },
    csvContent: source, factorVersion: "d5-simple-test", factors: [factor], datasetId: 551,
  });
}

function policy(prepared: PreparedSnapshot, lambdaR: number): AllocationRequest {
  return {
    preparedInputId: 17, candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(50), decisionTimestamp: dateAt(51), estimationWindow: 40,
    minObservations: 20, representation: "asset_returns", returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0, dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.35 } },
    rebalanceRegularization: { lambdaR },
  } as AllocationRequest & { rebalanceRegularization: B3RebalanceRegularizationRequest };
}

function assumptions(prepared: PreparedSnapshot, start = 40, end = 125): B3Assumptions {
  const firstPrice = Number(prepared.dataset.csvContent.split(/\r?\n/)[start].split(",")[1]);
  const initialNav = 100;
  return {
    evaluationStartDate: dateAt(start), evaluationEndDate: dateAt(end),
    decisionCalendar: "monthly", executionTiming: "next_close",
    initialNav, initialHoldings: { A: 25 / firstPrice }, initialCash: 75,
    transactionCostBps: 12, slippageBps: 4, dailyCashYield: 0,
  };
}

test("D5 simple B3 pairs positive quadratic rebalancing with zero lambda on self-financing historical books", () => {
  const prepared = snapshot();
  const input = policy(prepared, 0.04);
  const settings = assumptions(prepared);
  const result = runB3Validation(prepared, input, prepared, settings);
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.decisions.length >= 2, "fixture must include repeated scheduled decisions");
  assert.ok(result.rebalanceComparison);
  const zero = result.rebalanceComparison.zero;
  assert.equal(zero.decisions.length, result.decisions.length);
  assert.ok(zero.dailyLedger.filter((entry) => entry.externalTrades.length > 0).length >= 2);
  assert.ok(result.dailyLedger.filter((entry) => entry.externalTrades.length > 0).length >= 2);
  assert.deepEqual(result.decisionCalendar, zero.decisionCalendar);
  assert.equal(result.assumptions.initialNav, zero.assumptions.initialNav);
  assert.equal(result.assumptions.transactionCostBps, zero.assumptions.transactionCostBps);
  assert.equal(result.assumptions.slippageBps, zero.assumptions.slippageBps);
  assert.match(result.metrics!.turnoverConvention, /half the sum of absolute changes/);
  assert.match(result.rebalanceComparison.convention, /no winner is selected/i);
  for (const ledger of [result.dailyLedger, zero.dailyLedger]) {
    for (const entry of ledger) {
      assert.ok(Math.abs(entry.beginningNav + entry.netPnl - entry.endingNav) < 1e-8);
      assert.ok(Math.abs(entry.endingCash + entry.endingPositions.reduce((sum, position) =>
        sum + position.marketValue, 0) - entry.endingNav) < 1e-8);
    }
  }

  for (const [index, decision] of result.decisions.entries()) {
    const regularization = decision.rebalanceRegularization!;
    const zeroDecision = zero.decisions[index];
    assert.ok(regularization);
    assert.equal(regularization.lambdaR, 0.04);
    assert.equal(regularization.actualHoldings.asOf, decision.informationCutoff);
    assert.ok(Math.abs(regularization.actualHoldings.nav -
      (regularization.actualHoldings.cash + Object.entries(regularization.actualHoldings.quantities)
        .reduce((sum, [ticker, quantity]) =>
          sum + quantity * regularization.referencePrices[ticker], 0))) < 1e-8,
    `cutoff book did not mark to NAV: ${JSON.stringify(regularization)}`);
    assert.ok(regularization.referenceExposures.A > 0);
    assert.ok(regularization.penalty >= 0);
    const squaredTradeDistance = Object.keys({
      ...regularization.referenceExposures, ...regularization.targetExposures,
    }).reduce((sum, ticker) => sum +
      ((regularization.targetExposures[ticker] ?? 0) -
        (regularization.referenceExposures[ticker] ?? 0)) ** 2, 0);
    assert.ok(Math.abs(regularization.penalty - regularization.lambdaR / 2 * squaredTradeDistance) < 1e-8);
    assert.equal(zeroDecision.rebalanceRegularization?.lambdaR, 0);
    assert.equal(zeroDecision.rebalanceRegularization?.actualHoldings.asOf, decision.informationCutoff);
    assert.equal(decision.informationCutoff, zeroDecision.informationCutoff);
    assert.deepEqual(decision.estimationDates, zeroDecision.estimationDates);
    assert.deepEqual(decision.forecast, zeroDecision.forecast);
    assert.deepEqual(decision.optimizer.riskModel, zeroDecision.optimizer.riskModel);
    const fill = result.dailyLedger.find((entry) => entry.date === decision.executionDate)!;
    assert.ok(fill.transactionCosts >= 0);
    assert.ok(fill.slippage >= 0);
    assert.ok(Math.abs(fill.beginningNav + fill.netPnl - fill.endingNav) < 1e-8);
    assert.ok(Math.abs(fill.endingCash + fill.endingPositions.reduce((sum, position) =>
      sum + position.marketValue, 0) - fill.endingNav) < 1e-8);
  }

  const replay = runB3Validation(prepared, input, prepared, settings);
  assert.deepEqual(result.decisions.map((item) => item.rebalanceRegularization),
    replay.decisions.map((item) => item.rebalanceRegularization), "frozen per-decision D5 values are replay-stable");
});

test("D5 simple B3 rejects negative lambda and dates missing cutoff valuation failures", () => {
  const prepared = snapshot();
  const negative = runB3Validation(prepared, policy(prepared, -0.1), prepared, assumptions(prepared));
  assert.equal(negative.status, "failed");
  assert.match(negative.reason ?? "", /finite nonnegative/i);

  const missingIndex = 59;
  const missing = snapshot(csv({ ticker: "B", index: missingIndex }));
  const result = runB3Validation(missing, policy(missing, 0.04), missing, assumptions(missing));
  assert.equal(result.status, "failed");
  assert.equal(result.failureDate, dateAt(missingIndex));
  assert.match(result.reason ?? "", /missing|invalid price/i);
});

test("D5 simple B3 reports dated optimizer infeasibility", () => {
  const prepared = snapshot();
  const input = policy(prepared, 0.04) as AllocationRequest & {
    rebalanceRegularization: B3RebalanceRegularizationRequest;
  };
  input.constraints.totalCash = { min: 1.1 };
  const result = runB3Validation(prepared, input, prepared, assumptions(prepared));
  assert.equal(result.status, "failed");
  assert.ok(result.failureDate);
  assert.match(result.reason ?? "", /B2 (INFEASIBLE|INVALID_INPUT|NUMERICAL_FAILURE)/);
});

test("D5 simple B3 retains mapped-alpha signed robust policies with positive regularization", () => {
  const prepared = alphaSnapshot(csv());
  const candidateIds = prepared.candidates.map((candidate) => candidate.candidateId);
  const request: AllocationRequest = {
    preparedInputId: 18, candidateIds, informationCutoff: dateAt(50), decisionTimestamp: dateAt(51),
    estimationWindow: 40, minObservations: 20, representation: "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    allocationMode: "SIGNED_OVERLAY",
    signedConstraints: {
      alphaBounds: { [candidateIds[0]]: { min: 0.12, max: 0.12 }, [candidateIds[1]]: { min: -0.04, max: -0.04 } },
      grossAlphaMax: 0.5, grossAssetMax: 0.5, netAssetExposure: { min: 0, max: 0.5 },
      cash: { min: 0.5, max: 1 },
    },
    riskModel: { type: "SAMPLE" }, robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.2 },
    forecastModel: { type: "SAMPLE_MEAN" }, dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.1 },
    constraints: {},
    rebalanceRegularization: { lambdaR: 0.02 },
  };
  const result = runB3Validation(prepared, request, prepared, assumptions(prepared));
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.decisions.length >= 2);
  assert.ok(result.decisions.every((decision) =>
    decision.optimizer.status === "SOLVED" &&
    decision.d4Policy?.method === "ROBUST_MEAN_UNCERTAINTY" &&
    decision.rebalanceRegularization?.lambdaR === 0.02));
  assert.ok(result.decisions.every((decision) =>
    Object.values(decision.candidateWeights).some((weight) => weight < 0)));
  const zero = result.rebalanceComparison!.zero;
  assert.ok(zero.decisions.every((decision) =>
    decision.optimizer.status === "SOLVED" &&
    decision.d4Policy?.method === "ROBUST_MEAN_UNCERTAINTY"));
  for (const [index, decision] of result.decisions.entries()) {
    assert.deepEqual(decision.forecast?.muHat, zero.decisions[index].forecast?.muHat);
    assert.deepEqual(decision.forecast?.V_mu, zero.decisions[index].forecast?.V_mu);
    assert.deepEqual(decision.optimizer.riskModel, zero.decisions[index].optimizer.riskModel);
    assert.deepEqual(decision.estimationDates, zero.decisions[index].estimationDates);
  }
});