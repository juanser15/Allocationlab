import assert from "node:assert/strict";
import { test } from "node:test";
// Reuse every A1 regression unchanged; this file adds only CL-01 coverage.
import "./calculator.a1.test";
import {
  computeSignalAsOf, constructAllocation, defaultBacktestConfig, runBacktestEngine,
  type BacktestConfig, type BacktestEngineResult, type Constraints,
  type EtfEntry, type ExecutionTiming, type PriceRow,
} from "./calculator";
import type { FactorDefinition } from "./factor-library";

// SYNTHETIC fixtures only. No database, market service or production-function mocks.
const asset: EtfEntry = { ticker: "AAA", name: "Synthetic AAA", sector: "Synthetic", priorWeight: 0, enabled: true };
const rules = (cash: number): Constraints => ({
  cashMin: cash, cashMax: cash, maxEtfWeight: 1, minInclusionThreshold: 0,
  targetActiveEtfs: 1, diversificationEnabled: false,
});
// Same short-lookback fixture as A1; factor quality/selection is outside CL-01.
const factor: FactorDefinition = {
  id: "momentum", name: "Synthetic fixture", description: "", family: "Momentum", enabled: true,
  status: "active", inputSeries: "price", calculationType: "momentum", formula: "return(2)",
  direction: "higher_is_better", lookback: 2, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "price",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "synthetic-cl01",
};
const factors = { factors: [factor] };
const settings = (timing: ExecutionTiming, extra: Partial<BacktestConfig> = {}): BacktestConfig => ({
  ...defaultBacktestConfig(), warmupDays: 3, executionTiming: timing,
  transactionCostBps: 0, slippageBps: 0, ...extra,
});
const series = (values: number[]): PriceRow[] => values.map((price, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`, prices: { AAA: price }, opens: { AAA: price },
}));
const near = (actual: number, expected: number, label: string) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8, `${label}: ${actual} != ${expected}`);
const valid = (result: BacktestEngineResult) => assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
const run = (rows: PriceRow[], timing: ExecutionTiming, cash: number, extra: Partial<BacktestConfig> = {}) =>
  runBacktestEngine(rows, [asset], rules(cash), settings(timing, extra), null, factors);
const timings: ExecutionTiming[] = ["same_close", "next_close", "next_open"];
const monthlySeries = (): PriceRow[] => Array.from({ length: 70 }, (_, i) => {
  const price = i < 30 ? 100 : i < 59 ? 100 + (i - 29) * 2 : 160 - (i - 58) * 7;
  return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), prices: { AAA: price }, opens: { AAA: price } };
});

test("CL01 SYNTHETIC — cash decision respects the band and preserves fixed invested composition", () => {
  const universe = [asset, { ...asset, ticker: "BBB", name: "Synthetic BBB" }];
  const rows = series([100, 100, 100, 100, 100, 100]);
  rows.forEach((row) => { row.prices.BBB = row.prices.AAA; });
  const constraints = { ...rules(0.5), cashMin: 0.2, cashMax: 0.8, targetActiveEtfs: 2 };
  const signal = computeSignalAsOf(rows, rows[3].date, ["AAA", "BBB"], universe, constraints, factors);
  // Freeze the invested composition by feeding the same synthetic scores each time.
  // These are inputs to the real constructor, not a replacement implementation.
  const scoreInputs = signal.factorData.map((entry) => ({
    ...entry, factorScores: { ...entry.factorScores, composite: entry.ticker === "AAA" ? 75 : 25 },
  }));
  for (const [composite, cash] of [[0, 0.8], [25, 0.65], [50, 0.5], [75, 0.35], [100, 0.2]]) {
    const allocations = constructAllocation(scoreInputs, universe, constraints, { ...signal.regime, composite });
    const invested = allocations.reduce((sum, entry) => sum + entry.weight, 0);
    near(invested, 1 - cash, `invested budget at regime ${composite}`);
    near(allocations.find((entry) => entry.ticker === "AAA")!.weight / invested, 0.75, "fixed AAA share");
    near(allocations.find((entry) => entry.ticker === "BBB")!.weight / invested, 0.25, "fixed BBB share");
  }
  // Exercise the real constructor -> execution path with a fixed 50/50 sleeve.
  const result = runBacktestEngine(rows, universe, { ...constraints, cashMin: 0.5, cashMax: 0.5 },
    settings("same_close"), null, factors);
  valid(result);
  const fill = result.dailyLedger.find((day) => day.executionSignalDate)!;
  near(fill.endingCash, 50, "normalization retains cash");
  assert.equal(fill.endingPositions.length, 2);
  fill.endingPositions.forEach((position) => near(position.marketValue, 25, "exposure applied once"));
});

for (const timing of timings) {
  test(`CL01 SYNTHETIC — 50% asset + 50% cash earns +1% on asset +2% (${timing})`, () => {
    // Large pre-purchase moves make attribution to an unheld interval detectable.
    const rows = series(timing === "next_close"
      ? [100, 100, 100, 110, 120, 122.4, 122.4]
      : [100, 100, 100, 120, 122.4, 122.4, 122.4]);
    if (timing === "next_open") rows[4].opens = { AAA: 120 };
    const result = run(rows, timing, 0.5);
    valid(result);
    const fillIndex = result.dailyLedger.findIndex((day) => day.executionSignalDate !== null);
    const fill = result.dailyLedger[fillIndex];
    const investedInterval = result.dailyLedger[fillIndex + (timing === "next_open" ? 0 : 1)];
    near(fill.trades[0].notional, 50, "invested capital at actual fill");
    near(fill.trades[0].quantity, 50 / 120, "actual fill price");
    near(fill.endingCash, 50, "uninvested capital");
    near(investedInterval.etfPnl, 1, "asset P&L");
    near(investedInterval.cashPnl, 0, "cash P&L");
    near(investedInterval.transactionCosts + investedInterval.slippage, 0, "costs");
    near(investedInterval.netPnl / investedInterval.beginningNav, 0.01, "interval return");
    near(result.equityCurve.at(-1)!.portfolioIndex, 101, "final equity");
    assert.ok(result.dailyLedger.slice(0, fillIndex).every((day) => day.etfPnl === 0));
  });

  test(`CL01 SYNTHETIC — 100% asset earns full +2% (${timing})`, () => {
    const rows = series([100, 100, 100, 100, 100, 102, 102]);
    const result = run(rows, timing, 0);
    valid(result);
    near(result.dailyLedger.at(-1)!.endingCash, 0, "zero cash");
    near(result.dailyLedger.at(-1)!.endingNav, 102, "full asset return");
  });

  test(`CL01 SYNTHETIC — explicit 100% cash target earns only cash interest (${timing})`, () => {
    const rows = series([100, 100, 100, 100, 120, 10, 200]);
    // Supported explicit-target input; the actual accounting engine is under test.
    const result = runBacktestEngine(rows, [asset], rules(1),
      settings(timing, { cashYieldAnnual: 0.04, transactionCostBps: 10, slippageBps: 5 }),
      null, factors, () => ({}));
    valid(result);
    const dailyYield = Math.pow(1.04, 1 / 252) - 1;
    for (const day of result.dailyLedger) {
      assert.deepEqual(day.endingPositions, []);
      assert.deepEqual(day.trades, []);
      near(day.etfPnl, 0, "no asset exposure");
      near(day.transactionCosts + day.slippage, 0, "no trade costs");
      near(day.cashPnl, day.beginningCash * dailyYield, "cash interest");
      near(day.endingCash, day.endingNav, "all equity in cash");
    }
    near(result.dailyLedger.at(-1)!.endingNav, 100 * Math.pow(1 + dailyYield, result.dailyLedger.length), "compounded cash");
  });

  test(`CL01 SYNTHETIC — constructor supports a 100% cash decision (${timing})`, () => {
    // Intentionally keeps the desired invariant. Do not turn this into assert.throws.
    const result = run(series([100, 100, 100, 100, 102, 80, 120]), timing, 1);
    valid(result);
    result.dailyLedger.forEach((day) => {
      near(day.endingNav, 100, "cash NAV with zero yield");
      assert.deepEqual(day.endingPositions, []);
      assert.deepEqual(day.trades, []);
    });
  });

  test(`CL01 SYNTHETIC — mixed book reconciles positions, cash interest, costs and equity (${timing})`, () => {
    const rows = series([100, 100, 100, 110, 100, 104, 98, 105]);
    rows.forEach((row, i) => { row.opens = { AAA: i < 3 ? 100 : row.prices.AAA - 2 }; });
    rows[6].date = "2026-02-01";
    rows[7].date = "2026-02-02";
    rows.push({ date: "2026-02-03", prices: { AAA: 103 }, opens: { AAA: 104 } });
    const result = run(rows, timing, 0.5, { cashYieldAnnual: 0.04, transactionCostBps: 10, slippageBps: 5 });
    valid(result);
    assert.equal(result.rebalanceLog.length, 2);
    assert.ok(result.dailyLedger.some((day) => day.transactionCosts > 0));
    const dailyYield = Math.pow(1.04, 1 / 252) - 1;
    let previousNav = 100;
    for (const [i, day] of result.dailyLedger.entries()) {
      const current = rows.find((row) => row.date === day.date)!;
      const previous = rows.find((row) => row.date === day.intervalStart)!;
      const expectedEtfPnl = timing === "next_open"
        ? day.beginningPositions.reduce((sum, p) => sum + p.quantity * (current.opens![p.ticker] - previous.prices[p.ticker]), 0) +
          day.endingPositions.reduce((sum, p) => sum + p.quantity * (current.prices[p.ticker] - current.opens![p.ticker]), 0)
        : day.beginningPositions.reduce((sum, p) => sum + p.quantity * (current.prices[p.ticker] - previous.prices[p.ticker]), 0);
      near(day.etfPnl, expectedEtfPnl, "independent held-quantity P&L");
      near(day.cashPnl, day.beginningCash * dailyYield, "interest on beginning cash only");
      const tradedNotional = day.trades.reduce((sum, trade) => sum + trade.notional, 0);
      near(day.endingCash, day.beginningCash + day.cashPnl - tradedNotional - day.transactionCosts - day.slippage, "self-financing cash");
      const tickers = new Set([...day.beginningPositions, ...day.endingPositions].map((p) => p.ticker));
      for (const ticker of tickers) {
        const before = day.beginningPositions.find((p) => p.ticker === ticker)?.quantity ?? 0;
        const after = day.endingPositions.find((p) => p.ticker === ticker)?.quantity ?? 0;
        near(after, before + day.trades.filter((t) => t.ticker === ticker).reduce((sum, t) => sum + t.quantity, 0), "quantity reconciliation");
      }
      let costBase = 0;
      if (day.executionSignalDate) {
        if (timing === "next_open") costBase = day.trades.reduce((sum, t) => sum + Math.abs(t.notional), 0);
        else {
          const preTradeNav = day.beginningNav + day.etfPnl + day.cashPnl;
          const oldWeight = day.beginningPositions.reduce((sum, p) => sum + p.quantity * current.prices[p.ticker], 0) / preTradeNav;
          costBase = preTradeNav * Math.abs(0.5 - oldWeight) / 2;
        }
      }
      // Verify each path's existing convention; CL-01 does not redefine fees.
      near(day.transactionCosts, costBase * 10 / 10000, "fees charged once");
      near(day.slippage, costBase * 5 / 10000, "slippage charged once");
      near(day.beginningNav, previousNav, "continuous NAV");
      near(day.netPnl, expectedEtfPnl + day.cashPnl - day.transactionCosts - day.slippage, "net P&L");
      near(day.endingNav, day.beginningNav + day.netPnl, "equity roll-forward");
      day.endingPositions.forEach((p) => near(p.marketValue, p.quantity * current.prices[p.ticker], "position value"));
      near(day.endingCash + day.endingPositions.reduce((sum, p) => sum + p.marketValue, 0), day.endingNav, "cash plus assets");
      near(result.equityCurve[i + 1].portfolioIndex, day.endingNav, "curve reconciles");
      previousNav = day.endingNav;
    }
  });

  test(`CL01 SYNTHETIC — cash objective refreshes only at monthly rebalances (${timing})`, () => {
    // One fixed asset, 70 artificial calendar observations, no historical backtest.
    const rows = monthlySeries();
    const constraints = { ...rules(0.5), cashMin: 0.2, cashMax: 0.8 };
    const result = runBacktestEngine(rows, [asset], constraints, settings(timing, { warmupDays: 21 }), null, factors);
    valid(result);
    assert.deepEqual(result.rebalanceLog.map((entry) => entry.rebalanceDate), ["2026-01-22", "2026-02-01", "2026-03-01"]);
    const targets: number[] = [];
    for (const log of result.rebalanceLog) {
      const signalIndex = rows.findIndex((row) => row.date === log.rebalanceDate);
      // computeSignalAsOf uses strict <; move boundary one row for next_open's through-t convention.
      const boundary = timing === "next_open" ? rows[signalIndex + 1].date : log.rebalanceDate;
      const signal = computeSignalAsOf(rows, boundary, ["AAA"], [asset], constraints, factors);
      const cashTarget = Math.max(0.2, Math.min(0.8, 0.8 - 0.006 * signal.regime.composite));
      targets.push(cashTarget);
      const fill = result.dailyLedger.find((day) => day.executionSignalDate === log.rebalanceDate)!;
      const fillRow = rows.find((row) => row.date === fill.date)!;
      const executionAssets = fill.endingPositions.reduce((sum, p) => sum + p.quantity *
        (timing === "next_open" ? fillRow.opens![p.ticker] : fillRow.prices[p.ticker]), 0);
      near(fill.endingCash / (fill.endingCash + executionAssets), cashTarget, "fresh cash target at execution");
      assert.equal(log.lookbackDays, signal.lookbackDays);
      assert.equal(log.executionDate, timing === "same_close" ? log.rebalanceDate : rows[signalIndex + 1].date);
    }
    assert.ok(Math.max(...targets) - Math.min(...targets) > 0.01, "fixture must produce changing cash decisions");
    for (const day of result.dailyLedger.filter((entry) => !entry.executionSignalDate)) {
      assert.deepEqual(day.trades, [], "no implicit trades between executions");
      near(day.transactionCosts + day.slippage, 0, "no implicit fees");
      assert.deepEqual(day.endingPositions.map((p) => [p.ticker, p.quantity]), day.beginningPositions.map((p) => [p.ticker, p.quantity]));
    }
  });

  test(`CL01 SYNTHETIC — built-in cash decision and execution respect the information cutoff (${timing})`, () => {
    const rows = monthlySeries();
    const constraints = { ...rules(0.5), cashMin: 0.2, cashMax: 0.8 };
    const boundary = timing === "next_open" ? "2026-01-23" : "2026-01-22";
    const cutoffMutation = structuredClone(rows);
    cutoffMutation.filter((row) => row.date >= boundary).forEach((row, i) => { row.prices.AAA = i % 2 ? 1 : 1000; });
    assert.deepEqual(
      computeSignalAsOf(rows, boundary, ["AAA"], [asset], constraints, factors),
      computeSignalAsOf(cutoffMutation, boundary, ["AAA"], [asset], constraints, factors),
      "prices at/after the exclusive boundary cannot alter the built-in cash/risk target",
    );
    // Mutate only after the first actual fill, preserving all observable fill data.
    const futureMutation = structuredClone(rows);
    futureMutation.filter((row) => row.date >= "2026-01-25").forEach((row, i) => {
      row.prices.AAA = i % 2 ? 1 : 1000;
      row.opens = { AAA: i % 2 ? 2 : 900 };
    });
    const a = runBacktestEngine(rows, [asset], constraints, settings(timing, { warmupDays: 21 }), null, factors);
    const b = runBacktestEngine(futureMutation, [asset], constraints, settings(timing, { warmupDays: 21 }), null, factors);
    valid(a); valid(b);
    assert.deepEqual(a.rebalanceLog[0], b.rebalanceLog[0], "initial built-in cash decision and fill");
    assert.deepEqual(a.dailyLedger.filter((day) => day.date < "2026-01-25"),
      b.dailyLedger.filter((day) => day.date < "2026-01-25"), "earlier positions, cash, costs and equity");
  });
}

for (const timing of ["same_close", "next_close"] as const) {
  test(`CL01 SYNTHETIC — explicit cash/risk target cannot consume future rows (${timing})`, () => {
    const original = series([100, 100, 100, 100, 100, 102, 103, 104]);
    const mutated = structuredClone(original);
    mutated[7].prices.AAA = 1000;
    const visible: PriceRow[][] = [];
    // Real engine callback seam, deliberately sensitive to any leaked last row.
    // The engine, not this input policy, must enforce its information boundary.
    const target = (_signalDate: string, available: PriceRow[]) => {
      visible.push(structuredClone(available));
      return { AAA: available.at(-1)!.prices.AAA > 150 ? 0.25 : 0.75 };
    };
    const a = runBacktestEngine(original, [asset], rules(0.5), settings(timing), null, factors, target);
    const b = runBacktestEngine(mutated, [asset], rules(0.5), settings(timing), null, factors, target);
    valid(a); valid(b);
    assert.deepEqual(a.dailyLedger.filter((day) => day.date < original[7].date),
      b.dailyLedger.filter((day) => day.date < original[7].date), "future mutation must not alter earlier cash, fills or P&L");
    assert.ok(visible.every((available) => available.every((row) => row.date < original[3].date)), "strict prior-signal cutoff");
  });
}
