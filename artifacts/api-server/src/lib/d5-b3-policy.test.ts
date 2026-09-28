import assert from "node:assert/strict";
import test from "node:test";
import { runB3Validation, type B3Assumptions, type B3CostAwareRequest } from "./b3-policy";
import type { AllocationRequest } from "./allocation-b2";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";
import { defaultBacktestConfig, runBacktestEngine, type BacktestInitialState, type PriceRow } from "./calculator";

const dateAt = (index: number) => new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
const factor: FactorDefinition = {
  id: "d5-momentum", name: "D5 momentum", description: "D5 test", family: "Momentum",
  enabled: true, status: "active", inputSeries: "adjusted close", calculationType: "momentum",
  formula: "return(3)", direction: "higher_is_better", lookback: 3, lag: 0,
  normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
  missingDataTreatment: "exclude", baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "D5 fixture", benchmarkTicker: null,
  currentCoverage: 1, availabilityReason: null, version: "d5-test",
};

function csv(missing?: { ticker: string; index: number }): string {
  return ["date,A,B", ...Array.from({ length: 150 }, (_, i) => {
    const a = missing?.ticker === "A" && missing.index === i ? "" : (100 + i * 0.22 + Math.sin(i / 4)).toFixed(8);
    const b = missing?.ticker === "B" && missing.index === i
      ? "" : (90 + i * 0.11 + Math.cos(i / 5) * 2).toFixed(8);
    return `${dateAt(i)},${a},${b}`;
  })].join("\n");
}

function snapshot(source = csv()): PreparedSnapshot {
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: ["A", "B"], factorIds: [], alphaDefinitions: [] },
    csvContent: source, factorVersion: "d5-test", factors: [factor], datasetId: 55,
  });
}

function request(prepared: PreparedSnapshot, costAware = true): AllocationRequest {
  return {
    preparedInputId: 17, candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(50), decisionTimestamp: dateAt(51), estimationWindow: 40,
    minObservations: 20, representation: "asset_returns", returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0, dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.35 } },
    ...(costAware ? { costAware: {
      costAmortizationDays: 0.5, turnoverPreferenceBps: 3, transactionCostBps: 12,
      slippageBps: 4, holdings: { asOf: dateAt(49), quantities: {}, cash: 100, nav: 100 },
    } } as Partial<AllocationRequest> : {}),
  };
}

function assumptions(prepared: PreparedSnapshot, start = 40, end = 125): B3Assumptions {
  const firstCutoffPrice = Number(prepared.dataset.csvContent.split(/\r?\n/)[start].split(",")[1]);
  const initialNav = 100;
  const quantity = 25 / firstCutoffPrice;
  return {
    evaluationStartDate: dateAt(start), evaluationEndDate: dateAt(end),
    decisionCalendar: "monthly", executionTiming: "next_close",
    initialNav, initialHoldings: { A: quantity }, initialCash: 75,
    transactionCostBps: 12, slippageBps: 4, dailyCashYield: 0,
  };
}

function d5Request(prepared: PreparedSnapshot): AllocationRequest {
  return request(prepared) as AllocationRequest;
}

function close(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

test("D5 B3 T4 freezes actual carried holdings and reconciles predicted versus gap-adjusted fills", () => {
  const prepared = snapshot();
  const policy = d5Request(prepared);
  const result = runB3Validation(prepared, policy, prepared, assumptions(prepared));
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.decisions.length >= 2, "fixture must include multiple decision/execution events");
  assert.equal(result.costAwarePolicy?.costAmortizationDays, 0.5, "fractional positive amortization horizons are valid");
  assert.ok((result.decisions[0].d5?.actualHoldings.quantities.A ?? 0) > 0, "initial nonzero holding is carried");
  for (const decision of result.decisions) {
    assert.equal(decision.d5?.actualHoldings.asOf, decision.informationCutoff);
    assert.ok(decision.d5?.actualHoldings.nav && decision.d5.actualHoldings.nav > 0);
    assert.ok(Number.isFinite(decision.d5?.predictedTransactionCosts));
    const fill = result.dailyLedger.find((entry) => entry.date === decision.executionDate)!;
    close(decision.d5!.actualTransactionCosts!, fill.transactionCosts, "actual fee");
    close(decision.d5!.actualSlippage!, fill.slippage, "actual slippage");
    assert.deepEqual(decision.d5!.actualTrades, fill.externalTrades);
  }
  assert.ok(result.decisions.some((decision) =>
    Math.abs(decision.d5!.predictedTransactionCosts! - decision.d5!.actualTransactionCosts!) > 1e-10),
  "cutoff estimate should expose execution-gap charge difference");
});

test("D5 A1 carries signed books with negative cash through repeated self-financing executions", () => {
  const prices: PriceRow[] = [
    "2024-12-31", "2025-01-01", "2025-01-02", "2025-02-01",
    "2025-02-02", "2025-03-01", "2025-03-02",
  ].map((date) => ({ date, prices: { A: 100, B: 100 } }));
  const universe = ["A", "B"].map((ticker) => ({
    ticker, name: ticker, sector: "test", priorWeight: 0, enabled: true,
  }));
  const constraints = {
    cashMin: -1, cashMax: 1, maxEtfWeight: 2, minInclusionThreshold: 0,
    targetActiveEtfs: 2, diversificationEnabled: false,
  };
  const initialState: BacktestInitialState = {
    initialNav: 100, initialCash: -20, initialHoldings: { A: 1.2 },
    dailyCashYield: 0, allowShortPositions: true, d5GrossTradeCosts: true,
  };
  const contexts: Array<{ asOf: string; cash: number; nav: number; quantities: Record<string, number> }> = [];
  const result = runBacktestEngine(
    prices, universe, constraints,
    { ...defaultBacktestConfig(), warmupDays: 0, startDate: "2025-01-01",
      rebalanceFrequency: "monthly", executionTiming: "next_close",
      transactionCostBps: 10, slippageBps: 5 },
    null, { factors: [] },
    (date, _rows, context) => {
      if (date === "2025-01-01" || date === "2025-02-01") {
        assert.ok(context);
        contexts.push({
          asOf: context.asOf, cash: context.cash, nav: context.nav,
          quantities: { ...context.quantities },
        });
        return date === "2025-01-01" ? { A: 1.2, B: -0.1 } : { A: 1, B: -0.2 };
      }
      return null;
    },
    initialState,
  );
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  assert.equal(result.rebalanceLog.length, 2);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].asOf, "2024-12-31");
  assert.equal(contexts[0].cash, -20);
  assert.ok(contexts[1].cash < 0, "the next decision sees its own negative-cash carried book");
  assert.ok(contexts[1].quantities.B < 0, "the next decision sees its carried short quantity");
  assert.ok(result.dailyLedger.some((entry) => entry.endingCash < 0));
  for (const entry of result.dailyLedger) {
    close(entry.beginningNav + entry.netPnl, entry.endingNav, `${entry.date} NAV`);
    close(entry.endingCash + entry.endingPositions.reduce((sum, position) => sum + position.marketValue, 0),
      entry.endingNav, `${entry.date} signed book value`);
  }
});

test("D5 B3 T6 fails with a dated cutoff-price error rather than using a future price", () => {
  const start = 40;
  const missingIndex = 59;
  const prepared = snapshot(csv({ ticker: "B", index: missingIndex }));
  const settings = assumptions(prepared, start, 125);
  // First decision starts with an A holding; the missing close is encountered as
  // the next monthly decision's information cutoff while the book remains carried.
  settings.initialHoldings = { A: 25 / Number(csv().split(/\r?\n/)[start].split(",")[1]) };
  settings.initialCash = 75;
  const policy = d5Request(prepared) as AllocationRequest & { costAware?: B3CostAwareRequest };
  const bCandidate = prepared.candidates.find((candidate) => candidate.assetTickers[0] === "B")!;
  policy.constraints.candidateBounds = { [bCandidate.candidateId]: { max: 0 } };
  const result = runB3Validation(prepared, policy, prepared, settings);
  assert.equal(result.status, "failed");
  assert.equal(result.failureDate, dateAt(missingIndex));
  assert.match(result.reason ?? "", /missing|cutoff|asOf/i);
});

test("D5 B3 T7 stores paired cost-blind ledgers with independent books and zero-cost identity", () => {
  const prepared = snapshot();
  const policy = d5Request(prepared);
  const result = runB3Validation(prepared, policy, prepared, assumptions(prepared));
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.ok(result.costBlindComparison);
  assert.equal(result.costBlindComparison.costBlindPolicyObjective, "frozen_cost_blind_policy");
  assert.equal(result.costBlindComparison.costBlind.decisions.length, result.decisions.length);
  assert.ok(result.costBlindComparison.costBlind.decisions[0].d5?.actualHoldings.quantities.A);
  assert.ok(result.costBlindComparison.costBlind.dailyLedger.filter((entry) => entry.externalTrades.length).length >= 2);
  assert.match(result.metrics!.turnoverConvention, /full sum of absolute consolidated underlying fill notionals/);

  const zeroCostPolicy = structuredClone(policy) as AllocationRequest & { costAware?: B3CostAwareRequest };
  zeroCostPolicy.costAware!.transactionCostBps = 0;
  zeroCostPolicy.costAware!.slippageBps = 0;
  zeroCostPolicy.costAware!.turnoverPreferenceBps = 0;
  const zeroCostAssumptions = { ...assumptions(prepared), transactionCostBps: 0, slippageBps: 0 };
  const zeroCost = runB3Validation(prepared, zeroCostPolicy, prepared, zeroCostAssumptions);
  assert.equal(zeroCost.status, "completed", zeroCost.reason ?? "");
  assert.ok(zeroCost.costBlindComparison);
  assert.deepEqual(zeroCost.dailyLedger, zeroCost.costBlindComparison.costBlind.dailyLedger);
});