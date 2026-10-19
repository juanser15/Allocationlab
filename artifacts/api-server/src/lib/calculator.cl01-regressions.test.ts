import assert from "node:assert/strict";
import { test } from "node:test";
// Reuse the 33 original cases byte-for-byte, including A1.
import "./calculator.cl01.test";
import {
  AllocationConstraintError, computeSignalAsOf, constructAllocation,
  defaultBacktestConfig, runBacktestEngine,
  type BacktestConfig, type BacktestInitialState, type BacktestTargetContext,
  type Constraints, type EtfEntry, type ExecutionTiming, type PriceRow,
} from "./calculator";
import type { FactorDefinition } from "./factor-library";

// SYNTHETIC inputs only; exercise the actual constructor and execution engine.
const asset: EtfEntry = { ticker: "AAA", name: "Synthetic AAA", sector: "Synthetic", priorWeight: 0.4, enabled: true };
const constraints: Constraints = {
  cashMin: 1, cashMax: 1, maxEtfWeight: 1, minEtfWeight: 0,
  minInclusionThreshold: 0, targetActiveEtfs: 1, diversificationEnabled: false,
};
const factor: FactorDefinition = {
  id: "momentum", name: "Synthetic fixture", description: "", family: "Momentum", enabled: true,
  status: "active", inputSeries: "price", calculationType: "momentum", formula: "return(2)",
  direction: "higher_is_better", lookback: 2, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "price",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "synthetic-cl01-fix",
};
const factors = { factors: [factor] };
const rows = (prices: number[]): PriceRow[] => prices.map((price, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`, prices: { AAA: price }, opens: { AAA: price },
}));
const config = (executionTiming: ExecutionTiming): BacktestConfig => ({
  ...defaultBacktestConfig(), warmupDays: 3, executionTiming, transactionCostBps: 0, slippageBps: 0,
});
const near = (actual: number, expected: number, label: string) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8, `${label}: ${actual} != ${expected}`);
const fixture = () => computeSignalAsOf(rows([100, 100, 100, 100, 100]), "2026-01-04",
  ["AAA"], [asset], { ...constraints, cashMin: 0.5, cashMax: 0.5 }, factors);

for (const timing of ["same_close", "next_close", "next_open"] as const) {
  for (const mode of ["without context", "provideTargetContext", "d5GrossTradeCosts"] as const) {
    test(`CL01 FIX SYNTHETIC — callback cutoff and actual fill (${timing}, ${mode})`, () => {
      const prices = rows([100, 101, 102, 200, 300, 310, 320, 330]);
      prices[4].opens = { AAA: 150 };
      const observed: Array<{ dates: string[]; context?: BacktestTargetContext }> = [];
      const initial: BacktestInitialState | undefined = mode === "without context" ? undefined : {
        initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: 0,
        ...(mode === "provideTargetContext" ? { provideTargetContext: true } : { d5GrossTradeCosts: true }),
      };
      const result = runBacktestEngine(prices, [asset], constraints, config(timing), null, factors,
        (_signalDate, available, context) => {
          observed.push({ dates: available.map((row) => row.date), context });
          // Use the provided information as-is: filtering is the engine's job.
          return { AAA: available.at(-1)!.prices.AAA >= 150 ? 0.75 : 0.25 };
        }, initial);
      assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
      assert.equal(observed.length, 1);
      assert.deepEqual(observed[0].dates, prices.slice(0, timing === "next_open" ? 4 : 3).map((row) => row.date));
      if (mode === "without context") assert.equal(observed[0].context, undefined);
      else {
        assert.equal(observed[0].context!.asOf, timing === "next_open" ? "2026-01-04" : "2026-01-03");
        assert.deepEqual(observed[0].context!.quantities, {});
        near(observed[0].context!.cash, 100, "cutoff cash");
        near(observed[0].context!.nav, 100, "cutoff NAV");
        assert.ok(Object.isFrozen(observed[0].context));
      }
      const fill = result.dailyLedger.find((day) => day.executionSignalDate)!;
      const expectedWeight = timing === "next_open" ? 0.75 : 0.25;
      const expectedPrice = timing === "same_close" ? 200 : timing === "next_close" ? 300 : 150;
      assert.equal(fill.executionSignalDate, "2026-01-04");
      assert.equal(fill.date, timing === "same_close" ? "2026-01-04" : "2026-01-05");
      near(fill.trades[0].quantity, 100 * expectedWeight / expectedPrice, "actual execution price, not cutoff price");
      near(fill.trades[0].notional, 100 * expectedWeight, "target notional");
      near(fill.endingCash, 100 * (1 - expectedWeight), "residual cash");
      near(fill.etfPnl, timing === "next_open" ? 75 : 0, "next_open earns open-to-close; close fill earns no prior move");
      near(fill.endingNav, timing === "next_open" ? 175 : 100, "execution NAV");
    });
  }

  test(`CL01 FIX SYNTHETIC — existing holdings liquidate to 100% cash (${timing})`, () => {
    const prices = rows([100, 100, 100, 110, 125, 150, 180, 190]);
    prices[4].opens = { AAA: 120 };
    const result = runBacktestEngine(prices, [asset], constraints,
      { ...config(timing), transactionCostBps: 10, slippageBps: 5 }, null, factors, undefined,
      { initialNav: 100, initialCash: 0, initialHoldings: { AAA: 1 }, dailyCashYield: 0.001 });
    assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
    const fillIndex = result.dailyLedger.findIndex((day) => day.executionSignalDate !== null);
    const fill = result.dailyLedger[fillIndex];
    const fillPrice = timing === "same_close" ? 110 : timing === "next_close" ? 125 : 120;
    const costBase = timing === "next_open" ? fillPrice : fillPrice / 2;
    assert.deepEqual(fill.trades, [{ ticker: "AAA", quantity: -1, notional: -fillPrice }]);
    assert.deepEqual(fill.endingPositions, []);
    near(fill.transactionCosts, costBase * 10 / 10000, "liquidation fees");
    near(fill.slippage, costBase * 5 / 10000, "liquidation slippage");
    near(fill.endingCash, fillPrice - costBase * 15 / 10000, "sale proceeds net of costs");
    near(fill.endingNav, fill.endingCash, "all equity in cash after liquidation");
    near(result.rebalanceLog[0].cashWeight, 1, "cash-only execution");
    let nav = 100;
    for (const [i, day] of result.dailyLedger.entries()) {
      near(day.beginningNav, nav, "continuous equity");
      near(day.cashPnl, day.beginningCash * 0.001, "interest on held cash");
      near(day.endingCash, day.beginningCash + day.cashPnl - day.trades.reduce((sum, trade) => sum + trade.notional, 0) -
        day.transactionCosts - day.slippage, "cash roll-forward");
      near(day.endingNav, day.beginningNav + day.etfPnl + day.cashPnl - day.transactionCosts - day.slippage, "net NAV");
      near(day.endingNav, day.endingCash + day.endingPositions.reduce((sum, p) => sum + p.marketValue, 0), "book reconciliation");
      near(result.equityCurve[i + 1].portfolioIndex, day.endingNav, "curve reconciliation");
      if (i > fillIndex) {
        assert.deepEqual(day.trades, []);
        assert.deepEqual(day.endingPositions, []);
        near(day.etfPnl, 0, "no exposure after liquidation");
        near(day.transactionCosts + day.slippage, 0, "liquidation charged once");
      }
      nav = day.endingNav;
    }
  });
}

test("CL01 FIX SYNTHETIC — zero-risk mandate permits no active ETFs and preserves output format", () => {
  const signal = fixture();
  // The rule, rather than cashMin=1 alone, produces zero risk at composite=0.
  const result = constructAllocation(signal.factorData, [{ ...asset, enabled: false }],
    { ...constraints, cashMin: 0, targetActiveEtfs: 20, diversificationEnabled: true }, { ...signal.regime, composite: 0 });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    ticker: asset.ticker, name: asset.name, sector: asset.sector, weight: 0,
    priorWeight: 0.4, change: -0.4, factorScores: signal.factorData[0].factorScores,
    factorContributions: signal.factorData[0].factorContributions, active: false,
  });
});

test("CL01 FIX SYNTHETIC — cash-only rejects positive ETF minima and invalid constraints", () => {
  const signal = fixture();
  for (const minEtfWeight of [0.01, 1e-12]) {
    assert.throws(() => constructAllocation(signal.factorData, [asset],
      { ...constraints, minEtfWeight }, signal.regime),
    (error: unknown) => error instanceof AllocationConstraintError && /positive minimum ETF weight/.test(error.message));
  }
  for (const incompatible of [{ cashMax: 1.1 }, { maxEtfWeight: 0 }, { targetActiveEtfs: 0 }, { minEtfWeight: -0.1 }]) {
    assert.throws(() => constructAllocation(signal.factorData, [asset],
      { ...constraints, ...incompatible }, signal.regime), AllocationConstraintError);
  }
});

test("CL01 FIX SYNTHETIC — positive risk budgets retain eligibility and allocation constraints", () => {
  const signal = fixture();
  const cash = 1 - 1e-12;
  const tiny = { ...constraints, cashMin: cash, cashMax: cash };
  const result = constructAllocation(signal.factorData, [asset], tiny, signal.regime);
  assert.equal(result[0].active, true);
  assert.ok(result[0].weight > 0, "small positive budget must not become cash-only");
  assert.throws(() => constructAllocation(signal.factorData, [{ ...asset, enabled: false }], tiny, signal.regime), AllocationConstraintError);
  assert.throws(() => constructAllocation(signal.factorData, [asset], { ...tiny, targetActiveEtfs: 2 }, signal.regime), AllocationConstraintError);
  for (const incompatible of [
    { cashMin: 0.2, cashMax: 0.2, maxEtfWeight: 0.5 },
    { cashMin: 0.8, cashMax: 0.8, minEtfWeight: 0.3 },
  ]) {
    assert.throws(() => constructAllocation(signal.factorData, [asset], { ...constraints, ...incompatible }, signal.regime), AllocationConstraintError);
  }
});
