import assert from "node:assert/strict";
import { test } from "node:test";
import { runBacktestEngine, defaultBacktestConfig, type PriceRow, type EtfEntry, type Constraints, type BacktestConfig } from "./calculator";
import type { FactorDefinition } from "./factor-library";

const tolerance = 1e-8; // Absolute NAV/index units (initial NAV = 100).
const etfs: EtfEntry[] = [
  { ticker: "AAA", name: "AAA", sector: "A", priorWeight: 0, enabled: true },
  { ticker: "BBB", name: "BBB", sector: "B", priorWeight: 0, enabled: true },
];
const constraints: Constraints = {
  cashMin: 0, cashMax: 0, maxEtfWeight: 1, minInclusionThreshold: 0,
  targetActiveEtfs: 1, diversificationEnabled: false,
};
const factor: FactorDefinition = {
  id: "momentum", name: "Momentum", description: "", family: "Momentum", enabled: true,
  status: "active", inputSeries: "price", calculationType: "momentum", formula: "return(2)",
  direction: "higher_is_better", lookback: 2, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "price",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "test",
};
const factorSet = { factors: [factor] };
const config = (overrides: Partial<BacktestConfig> = {}): BacktestConfig => ({
  ...defaultBacktestConfig(), warmupDays: 3, executionTiming: "same_close",
  transactionCostBps: 0, slippageBps: 0, ...overrides,
});
const rows = (values: Array<[string, number, number?]>): PriceRow[] =>
  values.map(([date, a, b]) => ({
    date, prices: { AAA: a, ...(b === undefined ? {} : { BBB: b }) },
  }));
const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
  "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
const oneAsset = (prices: number[]) => rows(dates.map((date, i) => [date, prices[i]]));
const run = (prices: PriceRow[], settings = config(), universe = [etfs[0]],
  rules = constraints, selectedFactors = factorSet) =>
  runBacktestEngine(prices, universe, rules, settings, null, selectedFactors);
const near = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);

test("TEST 1 — price jump before purchase", () => {
  for (const timing of ["same_close", "next_close"] as const) {
    const prices = oneAsset(timing === "same_close"
      ? [100, 100, 100, 110, 110, 110, 110, 110]
      : [100, 100, 100, 100, 110, 110, 110, 110]);
    const result = run(prices, config({ executionTiming: timing }));
    assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
    const fill = result.dailyLedger.find((entry) => entry.executionSignalDate !== null)!;
    near(fill.etfPnl, 0, "pre-purchase ETF P&L");
    near(fill.beginningNav, 100, "NAV before purchase");
    near(fill.endingNav, 100, "NAV after purchase");
    near(fill.endingPositions[0].price, 110, "actual fill close");
    assert.equal(fill.beginningPositions.length, 0);
  }
});

test("TEST 2 — constant prices without costs leave NAV constant", () => {
  const result = run(oneAsset(Array(8).fill(100)));
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  for (const day of result.dailyLedger) near(day.endingNav, 100, day.date);
  near(result.equityCurve.at(-1)!.portfolioIndex, 100, "displayed curve");
});

test("TEST 3 — constant prices with purchases/sales charge only explicit costs", () => {
  const prices = rows([
    ["2026-01-28", 100, 100], ["2026-01-29", 100, 100],
    ["2026-01-30", 100, 100], ["2026-01-31", 100, 100],
    ["2026-02-01", 100, 100], ["2026-02-02", 100, 100],
    ["2026-02-03", 100, 100], ["2026-02-04", 100, 100],
  ]);
  const universe = [{ ...etfs[0], priorWeight: 0.8 }, etfs[1]];
  const rules = { ...constraints, cashMin: 0.2, cashMax: 0.2, targetActiveEtfs: 2, diversificationEnabled: true };
  const result = run(prices, config({ transactionCostBps: 10, slippageBps: 5 }), universe, rules);
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  const trades = result.dailyLedger.flatMap((d) => d.trades);
  assert.ok(trades.some((t) => t.quantity > 0), "must purchase");
  assert.ok(trades.some((t) => t.quantity < 0), "must sell");
  let nav = 100;
  for (const day of result.dailyLedger) {
    near(day.etfPnl, 0, "unchanged ETF prices");
    near(day.cashPnl, 0, "zero cash yield");
    near(day.beginningNav, nav, "previous NAV");
    nav -= day.transactionCosts + day.slippage;
    near(day.endingNav, nav, "cost-only NAV");
  }
});

test("TEST 4 — held quantities stay fixed and weights drift without trades", () => {
  const prices = rows(dates.map((date, i) => [date,
    i < 3 ? 100 + i * 10 : i < 5 ? 120 : 144,
    i < 3 ? 100 - i * 10 : 80]));
  const rules = { ...constraints, targetActiveEtfs: 2 };
  const selectedFactors = { factors: [
    { ...factor, id: "up", baseWeight: 0.5, regimeWeights: { riskOn: 0.5, neutral: 0.5, riskOff: 0.5 } },
    { ...factor, id: "down", direction: "lower_is_better" as const, baseWeight: 0.5,
      regimeWeights: { riskOn: 0.5, neutral: 0.5, riskOff: 0.5 } },
  ] };
  const result = run(prices, config(), etfs, rules, selectedFactors);
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  assert.equal(result.rebalanceLog.length, 1);
  const fill = result.dailyLedger.find((d) => d.trades.length)!;
  const later = result.dailyLedger.at(-1)!;
  for (const position of fill.endingPositions) {
    const held = later.endingPositions.find((p) => p.ticker === position.ticker)!;
    near(held.quantity, position.quantity, `held quantity ${position.ticker}`);
  }
  assert.ok(later.endingPositions.find((p) => p.ticker === "AAA")!.weight >
    fill.endingPositions.find((p) => p.ticker === "AAA")!.weight, "AAA weight must drift upward");
  assert.ok(result.dailyLedger.slice(result.dailyLedger.indexOf(fill) + 1).every((d) => d.trades.length === 0));
});

test("TEST 5 — future price mutation cannot alter earlier signals, fills or P&L", () => {
  const original = oneAsset([100, 100, 100, 100, 101, 102, 103, 104]);
  const changed = oneAsset([100, 100, 100, 100, 101, 102, 250, 10]);
  const a = run(original), b = run(changed);
  assert.equal(a.hasSufficientData, true, a.insufficientReason ?? "");
  assert.equal(b.hasSufficientData, true, b.insufficientReason ?? "");
  assert.deepEqual(
    a.dailyLedger.filter((d) => d.date < "2026-01-07"),
    b.dailyLedger.filter((d) => d.date < "2026-01-07"),
  );
  assert.deepEqual(a.rebalanceLog, b.rebalanceLog);
});

test("TEST 6 — every daily ledger entry and the compounded curve reconcile", () => {
  const result = run(oneAsset([100, 100, 100, 102, 104, 98, 103, 107]),
    config({ transactionCostBps: 10, slippageBps: 5, cashYieldAnnual: 0.04 }));
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  let nav = 100;
  for (const [index, day] of result.dailyLedger.entries()) {
    near(day.beginningNav, nav, "beginning NAV");
    near(day.etfPnl + day.cashPnl - day.transactionCosts - day.slippage, day.netPnl, "net P&L");
    near(day.beginningNav + day.netPnl, day.endingNav, "ending NAV");
    near(day.endingCash + day.endingPositions.reduce((s, p) => s + p.marketValue, 0), day.endingNav, "holdings and cash");
    near(day.endingNav, result.equityCurve[index + 1].portfolioIndex, "curve index");
    nav = day.endingNav;
  }
  near(nav, result.equityCurve.at(-1)!.portfolioIndex, "final curve");

  const missing = oneAsset(Array(8).fill(100));
  delete missing[5].prices.AAA;
  const invalid = run(missing);
  assert.equal(invalid.hasSufficientData, false);
  assert.match(invalid.insufficientReason ?? "", /Missing or invalid price for held asset AAA/);
});

test("A1 next_open signals at close t, fills at t+1 open, and only new shares earn open-to-close", () => {
  const prices = rows(dates.map((date, i) => [date, i === 4 ? 130 : i === 5 ? 140 : 100]));
  prices.forEach((row, index) => {
    row.opens = { AAA: index === 4 ? 120 : index === 5 ? 150 : 100 };
  });
  const result = runBacktestEngine(prices, [etfs[0]], constraints,
    config({ executionTiming: "next_open", transactionCostBps: 100, slippageBps: 50 }), null,
    factorSet, (signalDate, availableRows) => {
      assert.ok(availableRows.some((row) => row.date === signalDate), "signal-day close is available");
      assert.ok(availableRows.every((row) => row.date <= signalDate), "next_open callback cannot see future rows");
      return signalDate === dates[3] ? { AAA: 1 } : null;
    });
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  const signal = result.dailyLedger.find((entry) => entry.date === dates[3])!;
  const fill = result.dailyLedger.find((entry) => entry.date === dates[4])!;
  assert.equal(signal.signalDate, dates[3]);
  assert.equal(signal.trades.length, 0);
  near(signal.endingNav, 100, "no position before next-open fill");
  assert.equal(fill.executionSignalDate, dates[3]);
  near(fill.beginningNav, 100, "pre-open NAV");
  const expectedNotional = 100 / 1.015;
  near(fill.trades[0].notional, expectedNotional, "fill notional uses open price and self-financed costs");
  near(fill.trades[0].quantity, expectedNotional / 120, "shares use actual execution open");
  near(fill.transactionCosts, expectedNotional * 100 / 10000, "fees use actual open notional");
  near(fill.slippage, expectedNotional * 50 / 10000, "slippage uses actual open notional");
  near(fill.etfPnl, (expectedNotional / 120) * 10, "new shares earn open-to-close only");
  near(fill.endingNav, expectedNotional + (expectedNotional / 120) * 10, "open fill and close mark reconcile");
  near(fill.endingCash + fill.endingPositions.reduce((sum, position) => sum + position.marketValue, 0),
    fill.endingNav, "fill-day holdings and cash");
});

test("A1 next_open is point-in-time and fails for missing held or traded adjusted opens", () => {
  const base = rows(dates.map((date, i) => [date, i < 5 ? 100 : 110]));
  base.forEach((row) => { row.opens = { AAA: 100 }; });
  base[3].prices.AAA = 101;
  const target = (signalDate: string, availableRows: PriceRow[]) => {
    assert.ok(availableRows.every((row) => row.date <= signalDate), "next_open callback cannot see future rows");
    const signalClose = availableRows.find((row) => row.date === signalDate)!.prices.AAA;
    return signalDate === dates[3] && signalClose > 100 ? { AAA: 1 } : null;
  };
  const visibleRowsOriginal: PriceRow[][] = [];
  const recordingTarget = (signalDate: string, availableRows: PriceRow[]) => {
    visibleRowsOriginal.push(structuredClone(availableRows));
    return target(signalDate, availableRows);
  };
  const original = runBacktestEngine(base, [etfs[0]], constraints,
    config({ executionTiming: "next_open" }), null, factorSet, recordingTarget);
  const futureMutation = structuredClone(base);
  futureMutation[6].prices.AAA = 900;
  futureMutation[7].prices.AAA = 1;
  const visibleRowsMutated: PriceRow[][] = [];
  const mutatedTarget = (signalDate: string, availableRows: PriceRow[]) => {
    visibleRowsMutated.push(structuredClone(availableRows));
    return target(signalDate, availableRows);
  };
  const mutated = runBacktestEngine(futureMutation, [etfs[0]], constraints,
    config({ executionTiming: "next_open" }), null, factorSet, mutatedTarget);
  assert.equal(original.hasSufficientData, true, original.insufficientReason ?? "");
  assert.equal(mutated.hasSufficientData, true, mutated.insufficientReason ?? "");
  assert.deepEqual(visibleRowsOriginal, visibleRowsMutated,
    "future price mutations must not change callback-visible rows");
  assert.ok(visibleRowsOriginal.every((rows) => rows.every((row) => row.date <= dates[3])));
  assert.ok(visibleRowsOriginal.every((rows) => !rows.some((row) => row.date === dates[4])),
    "the execution-day close is not callback-visible");
  assert.deepEqual(original.dailyLedger.filter((day) => day.date <= dates[5]),
    mutated.dailyLedger.filter((day) => day.date <= dates[5]));
  const signalCloseChanged = structuredClone(base);
  signalCloseChanged[3].prices.AAA = 99;
  const cutoffResult = runBacktestEngine(signalCloseChanged, [etfs[0]], constraints,
    config({ executionTiming: "next_open" }), null, factorSet, target);
  assert.equal(cutoffResult.hasSufficientData, true, cutoffResult.insufficientReason ?? "");
  assert.equal(cutoffResult.dailyLedger.find((day) => day.date === dates[4])!.trades.length, 0,
    "the signal-day close through t must affect the target");

  const missingHeld = structuredClone(base);
  delete missingHeld[5].opens!.AAA;
  const heldFailure = runBacktestEngine(missingHeld, [etfs[0]], constraints,
    config({ executionTiming: "next_open" }), null, factorSet, target);
  assert.equal(heldFailure.hasSufficientData, false);
  assert.match(heldFailure.insufficientReason ?? "", /Missing or invalid adjusted open for held asset AAA/);

  const missingTrade = structuredClone(base);
  delete missingTrade[4].opens!.AAA;
  const tradeFailure = runBacktestEngine(missingTrade, [etfs[0]], constraints,
    config({ executionTiming: "next_open" }), null, factorSet, target);
  assert.equal(tradeFailure.hasSufficientData, false);
  assert.match(tradeFailure.insufficientReason ?? "", /Missing or invalid adjusted open for traded asset AAA/);
});

test("A1 signed execution accounts for short proceeds, covers, P&L and one-time costs", () => {
  const prices = rows([
    ["2026-01-01", 100], ["2026-01-02", 100], ["2026-01-03", 100],
    ["2026-01-04", 100], ["2026-01-05", 110],
    ["2026-02-01", 110], ["2026-02-02", 100], ["2026-02-03", 100],
    ["2026-03-01", 100], ["2026-03-02", 100],
  ]);
  const signedInitialState = {
    initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: 0,
    allowShortPositions: true,
  };
  const result = runBacktestEngine(
    prices, etfs, constraints,
    config({ warmupDays: 3, transactionCostBps: 10, slippageBps: 5 }),
    null, factorSet, (signalDate) => signalDate === "2026-01-04" ? { AAA: -0.2 } :
      signalDate === "2026-02-01" ? { AAA: 0.1 } : null,
    signedInitialState,
  );
  assert.equal(result.hasSufficientData, true, result.insufficientReason ?? "");
  const shortFill = result.dailyLedger.find((entry) => entry.executionSignalDate === "2026-01-04")!;
  assert.ok(shortFill.endingPositions.some((position) => position.quantity < 0));
  near(shortFill.endingCash / shortFill.endingNav, 1.2, "short proceeds in cash");
  near(shortFill.transactionCosts + shortFill.slippage,
    shortFill.beginningNav * 0.1 * 15 / 10000, "short opening cost");
  const heldShort = result.dailyLedger.find((entry) => entry.date === "2026-01-05")!;
  near(heldShort.etfPnl, shortFill.endingPositions[0].quantity * 10, "short mark-to-market P&L");
  assert.equal(heldShort.trades.length, 0);

  const coverFill = result.dailyLedger.find((entry) => entry.executionSignalDate === "2026-02-01")!;
  assert.ok(coverFill.trades.some((trade) => trade.quantity > 0), "cover trade consumes short quantity");
  assert.ok(coverFill.endingPositions.every((position) => position.quantity > 0));
  near(coverFill.endingCash / coverFill.endingNav, 0.9, "cash after partial cover and long position");
  const coverPreTradeNav = coverFill.beginningNav + coverFill.etfPnl + coverFill.cashPnl;
  const shortWeightBeforeCover = coverFill.beginningPositions[0].marketValue / coverPreTradeNav;
  const coverTurnover = Math.abs(0.1 - shortWeightBeforeCover) / 2;
  near(coverFill.transactionCosts + coverFill.slippage,
    coverPreTradeNav * coverTurnover * 15 / 10000,
    "cover and reversal charged once on consolidated turnover");
  for (const entry of result.dailyLedger) {
    near(entry.beginningNav + entry.netPnl, entry.endingNav, `${entry.date} NAV reconciliation`);
    near(entry.endingCash + entry.endingPositions.reduce((sum, p) => sum + p.marketValue, 0),
      entry.endingNav, `${entry.date} cash plus signed holdings`);
  }
});