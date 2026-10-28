import test from "node:test";
import "./quality.test";
import assert from "node:assert/strict";
import { defaultBacktestConfig, type PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import { cashIntervals, parseInstitutional } from "../../artifacts/api-server/src/lib/workbench/institutional-contract";
import { remuneratedLedger } from "../workbench/institutional-ledger";
import { institutionalMetrics, reconcileLedger, validateTargets } from "./institutional";
import { runInstitutional } from "./institutional";
import { preparedDataset } from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import { normalizeP0WithData, p0RunId, type P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { CURRENT_CASH_POLICY, COORDINATED_SPEC } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

const prices: PriceRow[] = [
  { date: "2024-01-01", prices: { SPY: 100, SGOV: 100 } },
  { date: "2024-01-02", prices: { SPY: 100, SGOV: 101 } },
  { date: "2024-01-03", prices: { SPY: 100, SGOV: 102.01 } },
  { date: "2024-01-04", prices: { SPY: 110, SGOV: 103.0301 } },
  { date: "2024-01-05", prices: { SPY: 110, SGOV: 104.060401 } },
];
const historicPolicy = { type: "SGOV_TOTAL_RETURN", ticker: "SGOV" } as const;
const cash = cashIntervals(prices, "2024-01-02", "2024-01-06", historicPolicy);
const design: any = { research_scope: "CAPITAL_EXPOSURE", cash_policy: { type: "ZERO_RETURN", annual_rate: 0 }, slippage_bps: 0, control_mode: "MAX_EXPOSURE", maximum_exposure: .5 };
const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function run(fee = 0, slippage = 0, exposure = .5, intervalReturns = cash, observations = prices) {
  return remuneratedLedger(intervalReturns, slippage, (d, w) => validateTargets(d, w, { ...design, maximum_exposure: exposure }))(
    observations,
    [{ ticker: "SPY", enabled: true, minWeight: 0, maxWeight: 1, priorWeight: 0 }] as any,
    { cashMin: 0, cashMax: 1, minHoldings: 0, maxHoldings: 1 } as any,
    { ...defaultBacktestConfig(), warmupDays: 0, executionTiming: "next_close", transactionCostBps: fee, slippageBps: slippage, maxTurnoverPerRebalance: 1, cashYieldAnnual: 0 },
    "SPY", { version: 1, factors: [] } as any,
    () => ({ SPY: exposure }),
    { initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: 0, d5GrossTradeCosts: true, provideTargetContext: true },
    ["2024-01-02"],
    () => ({ label: "TEST_ONLY", composite: 0, recommendedCash: .5, trend: 0, breadth: 0, volatility: 0, liquidity: 0 }) as any,
  );
}
test("SGOV interval convention fails closed on holes, including the previous observation", () => {
  for (const index of [0, 1, 2]) {
    const rows = structuredClone(prices); delete rows[index].prices.SGOV;
    assert.throws(() => cashIntervals(rows, "2024-01-02", "2024-01-06", historicPolicy), (e: any) => e.code === "CASH_HISTORY_REQUIRED");
  }
  close(cash.get("2024-01-03")!, .01);
  assert.throws(() => parseInstitutional({ ...design, cash_policy: undefined }), /forced to 0%/);
  assert.throws(() => parseInstitutional({ ...design, slippage_bps: -1 }), /Slippage/);
});
test("Current policy forces exactly zero and rejects missing, historical, positive or extra cash inputs", () => {
  assert.deepEqual(parseInstitutional(design).cash_policy, CURRENT_CASH_POLICY);
  for (const policy of [undefined, historicPolicy, { type: "ZERO_RETURN", annual_rate: .05 }, { ...CURRENT_CASH_POLICY, ticker: "SGOV" }])
    assert.throws(() => parseInstitutional({ ...design, cash_policy: policy }), /forced to 0%/);
});
test("Zero cash is independent of SGOV history and values, excludes To, and does not invent intervals", () => {
  const noSgov = prices.map(row => ({ ...row, prices: { SPY: row.prices.SPY } }));
  const zero = cashIntervals(noSgov, "2024-01-02", "2024-01-05");
  assert.deepEqual([...zero], [["2024-01-02", 0], ["2024-01-03", 0], ["2024-01-04", 0]]);
  assert.deepEqual(zero, cashIntervals(prices, "2024-01-02", "2024-01-05", CURRENT_CASH_POLICY));
  assert.throws(() => cashIntervals([], "2024-01-02", "2024-01-05"), /No cash-accounting intervals/);
});
test("Zero-cash ledger reconciles all-cash and invested positions, real fees, slippage and drift", () => {
  const noSgov = prices.map(row => ({ ...row, prices: { SPY: row.prices.SPY } }));
  const zero = cashIntervals(noSgov, "2024-01-02", "2024-01-06");
  const allCash = run(10, 5, 0, zero, noSgov);
  for (const day of allCash.dailyLedger) {
    assert.equal(day.cashPnl, 0); assert.equal(day.endingNav, 100); assert.equal(day.trades.length, 0);
  }
  const invested = run(10, 5, .5, zero, noSgov), days = invested.dailyLedger;
  assert.ok(days.every(day => day.cashPnl === 0));
  close(days[1].endingNav, 100 / (1 + .5 * .0015), 1e-8);
  assert.ok(reconcileLedger(days, zero, 10, 5).passed);
  assert.ok(days[2].endingPositions[0].weight > .5);
  assert.equal(days[2].trades.length, 0);
  const metrics = institutionalMetrics(allCash.dailyLedger.map(d => ({ date: d.date, net_return: 0, turnover: 0, costs: 0, exposure: 0 })), zero);
  assert.equal(metrics.net_sharpe, null); assert.equal(metrics.final_index, 100);
});
test("New portfolio and isolated capital runs both execute without SGOV and freeze zero-cash provenance", () => {
  const source = preparedDataset();
  const binding = { dataset_id: `internal_${source.snapshot.sha256}`, dataset_version: 1, dataset_hash: source.snapshot.sha256, dataset_source: "INTERNAL_SNAPSHOT" };
  const data: P0Dataset = { ...source, binding, rows: source.rows.map(row => {
    const { SGOV: _sgov, ...prices } = row.prices; return { ...row, prices };
  }) };
  const common = { contract_version: COORDINATED_SPEC, dataset_id: binding.dataset_id, cash_policy: CURRENT_CASH_POLICY,
    slippage_bps: 5, evaluation_start: "2024-01-22", evaluation_end_exclusive: "2024-02-03", training_window_months: 6,
    window_type: "ROLLING", rebalance_frequency: "MONTHLY", transaction_cost_bps: 10, control_mode: "MAX_EXPOSURE",
    maximum_exposure: .6, risk_budget: .1, regime_model: "TREND", regime_response: "FIXED", defensive_multiplier: .5 };
  for (const request of [
    { ...common, research_scope: "CAPITAL_EXPOSURE" },
    { ...common, research_scope: "PORTFOLIO", etfs: ["SPY", "EFA", "IEF"], maximum_etf_weight: .4, risk_aversion: 5,
      covariance_shrinkage: .2, quality_control: { enabled: true, policy_version: "STRUCTURAL_V1" } },
  ]) {
    const spec = normalizeP0WithData(request, data), id = p0RunId(spec), result = runInstitutional(spec, data);
    assert.match(spec.engine_version, /zero-cash/);
    assert.equal(spec.methodology.cash_yield, "ZERO_RETURN_EACH_OBSERVED_INTERVAL");
    assert.deepEqual(result.accounting.cash_policy, CURRENT_CASH_POLICY);
    assert.ok(result.ledger.length > 0);
    assert.ok(result.ledger.every(day => day.cashPnl === 0));
    if (request.research_scope === "CAPITAL_EXPOSURE") assert.ok(result.benchmark);
    if (result.benchmark) assert.ok(result.benchmark.ledger.every((day: any) => day.cashPnl === 0));
    assert.equal(result.cash_reference.metrics.final_index, 100);
    assert.equal(result.cash_reference.metrics.net_sharpe, null);
    assert.ok(result.validation_evidence.accounting.passed);
    assert.notEqual(p0RunId({ ...spec, cash_policy: historicPolicy } as any), id);
  }
});
test("Independent tiny ledger oracle: cash accrues before execution, holdings drift without implicit trades", () => {
  const r = run(), days = r.dailyLedger;
  assert.equal(days.length, 4);
  close(days[0].cashPnl, 1);
  assert.equal(days[0].trades.length, 0);
  close(days[1].beginningCash, 101);
  close(days[1].endingNav, 102.01);
  close(days[1].endingCash, 51.005);
  close(days[1].endingPositions[0].quantity, .51005);
  close(days[2].etfPnl, 5.1005);
  close(days[2].cashPnl, .51005);
  close(days[2].endingNav, 107.62055);
  assert.notEqual(days[2].endingPositions[0].weight, .5);
  assert.equal(days[2].trades.length, 0);
  assert.equal(days[3].endingPositions[0].quantity, days[2].endingPositions[0].quantity);
  assert.ok(reconcileLedger(days, cash, 0, 0).passed);
});
test("Fee/slippage oracle is based on actual fills; all-cash reference has zero excess Sharpe variance", () => {
  const r = run(10, 5), tradeDay = r.dailyLedger[1];
  const notional = tradeDay.trades.reduce((s, t) => s + Math.abs(t.notional), 0);
  close(tradeDay.transactionCosts, notional * .001);
  close(tradeDay.slippage, notional * .0005);
  close(tradeDay.endingNav, 102.01 / (1 + .5 * .0015), 1e-8);
  assert.ok(reconcileLedger(r.dailyLedger, cash, 10, 5).passed);
  const allCash = run(10, 5, 0);
  const points = allCash.dailyLedger.map(d => ({ date: d.date, net_return: cash.get(d.date)!, turnover: 0, costs: 0, exposure: 0 }));
  const metrics = institutionalMetrics(points, cash);
  assert.equal(metrics.net_sharpe, null);
  close(metrics.final_index, 104.060401);
  const corrupt = structuredClone(r.dailyLedger); corrupt[1].cashPnl = 0;
  assert.throws(() => reconcileLedger(corrupt, cash, 10, 5), /Beginning cash/);
});
test("Mandate violations reject rather than fix solver weights or transfer cash", () => {
  const request: any = { ...design, research_scope: "PORTFOLIO", maximum_exposure: .5, maximum_etf_weight: .3, etfs: ["SPY", "EFA"], mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight: .1 } };
  assert.ok(validateTargets("2024-01-02", { SPY: .25, EFA: .25 }, request).passed);
  for (const weights of [{ SPY: .5 }, { SPY: .05, EFA: .3 }, { SPY: .3, GLD: .2 }, { SPY: -.1, EFA: .3 }])
    assert.throws(() => validateTargets("2024-01-02", weights, request), (e: any) => e.code === "MANDATE_BREACH");
});
