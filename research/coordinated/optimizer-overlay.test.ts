/** Source-only synthetic integration evidence; not private historical certification. */
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./engine";
import { runInstitutional, validateTargets, reconcileLedger } from "./institutional";
import { normalizeP0WithData } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { optimizerTestData, optimizerTestRequest, sourceOnlyDataset } from "./optimizer-test-fixtures";
import { riskyTemplate, overlayExposure } from "./capital-clock";
import { defaultBacktestConfig } from "../../artifacts/api-server/src/lib/calculator";
import { cashIntervals } from "../../artifacts/api-server/src/lib/workbench/institutional-contract";
import { remuneratedLedger } from "../workbench/institutional-ledger";
import { SUPPORT_TOLERANCE, CONSTRAINT_TOLERANCE, PORTFOLIO_CONSTRAINT_SCOPE } from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";

const controlled: typeof classify = (_model, history) => ({ model: "TEST_ONLY_CASH_GATE", defensive_score: (Date.parse(history.at(-1)!.date) / 86400000) % 2, high_risk_probability: null }) as any;
const run = (request = optimizerTestRequest(), data = optimizerTestData(), classifyCapital = controlled) => runInstitutional(normalizeP0WithData(request, data), data, () => {}, { classifyCapital });

test("Original 11-holdings and below-3% failures: actual engine constructs invested mandate targets", () => {
  const request = optimizerTestRequest({ capital_signal_frequency: "REBALANCE_ONLY", regime_response: "FIXED" });
  const result = run(request);
  assert.equal(result.decisions.length, 1);
  for (const decision of result.decisions) {
    const active = Object.values(decision.optimizer.optimized_nav_weights).filter((w: any) => w > SUPPORT_TOLERANCE) as number[];
    assert.ok(active.length >= 1 && active.length <= 10);
    assert.ok(active.every(w => w >= .03 - CONSTRAINT_TOLERANCE && w <= .25 + CONSTRAINT_TOLERANCE));
    assert.ok(decision.optimizer.audit);
    assert.deepEqual(decision.optimizer.effective_nav_weights, decision.weights);
    assert.equal(decision.optimizer.selected_support_tickers.length, active.length);
    assert.equal(decision.optimizer.audit.support_size, active.length);
    assert.ok(Object.values(decision.optimizer.construction_constraint_residuals).every((r: any) => r <= CONSTRAINT_TOLERANCE));
  }
  assert.ok(result.validation_evidence.accounting.passed);
});
test("Daily capital switches repeatedly through cash while monthly constrained composition stays frozen", () => {
  const result = run(optimizerTestRequest({ evaluation_end_exclusive: "2024-05-31" }));
  assert.ok(result.capital_clock.signals.length > 85);
  assert.ok(result.capital_clock.intramonth_exposure_changes > 20);
  assert.equal(result.decisions.length, 5);
  assert.equal(result.capital_clock.signals.filter(s => s.optimizer_refreshed).length, result.decisions.length);
  assert.ok(result.capital_clock.signals.some(s => s.exposure === 0));
  assert.ok(result.capital_clock.signals.some(s => s.exposure > 0));
  for (const d of result.decisions) {
    const signals = result.capital_clock.signals.filter(s => s.source_optimizer_date === d.decision_date);
    for (const s of signals) {
      assert.deepEqual(s.frozen_risky_proportions, signals[0].frozen_risky_proportions);
      assert.ok(s.information_cutoff < s.decision_date);
      assert.ok(s.execution_date === null || s.execution_date > s.decision_date);
    }
    assert.ok(d.optimizer.audit.support_size <= 10);
  }
  const entered = result.ledger.filter(day => day.beginningPositions.length === 0 && day.trades.some(t => t.notional > 0));
  assert.ok(entered.length > 5);
  assert.ok(result.capital_clock.capital_overlay_transaction_costs > 0);
  assert.ok(result.capital_clock.capital_overlay_slippage > 0);
  assert.ok(result.validation_evidence.accounting.passed);
});
test("Future prices cannot affect earlier constrained decisions or capital signals; reruns reproduce", () => {
  const request = optimizerTestRequest({ evaluation_end_exclusive: "2024-02-20" }), data = optimizerTestData();
  const first = run(request, data), repeat = run(request, data);
  assert.equal(first.financial_result_hash, repeat.financial_result_hash);
  const changed = structuredClone(data), cutoff = "2024-02-02";
  for (const row of changed.rows) if (row.date >= cutoff) for (const symbol of Object.keys(row.prices)) row.prices[symbol] *= 1.1;
  const other = run(request, changed);
  assert.deepEqual(first.decisions.filter(d => d.decision_date <= cutoff), other.decisions.filter(d => d.decision_date <= cutoff));
  assert.deepEqual(first.capital_clock.signals.filter(d => d.decision_date <= cutoff), other.capital_clock.signals.filter(d => d.decision_date <= cutoff));
  assert.deepEqual(first.points.filter(d => d.date < cutoff), other.points.filter(d => d.date < cutoff));
});
test("Both monitoring modes honor explicitly all-cash policies despite positive minimum holdings", () => {
  for (const capital_signal_frequency of ["DAILY", "REBALANCE_ONLY"]) {
    const request = optimizerTestRequest({ capital_signal_frequency, maximum_exposure: 0, regime_response: "FIXED" });
    const result = run(request);
    assert.ok(result.points.every(p => p.index === 100 && p.costs === 0 && p.exposure === 0));
    assert.ok(result.mandate_evidence.every(e => e.passed));
    assert.ok(validateTargets("2024-01-22", { SPY: 0 }, { ...request, etfs: ["SPY"] }).passed);
  }
});
test("Owner 3% NAV known-answer target halves to 1.5% XLE and executes with exact costs", () => {
  const tickers = ["SPY", "QQQ", "IEF", "GLD", "XLE"];
  const strategic = [.30, .20, .15, .10, .03], expected = [.15, .10, .075, .05, .015];
  const template = riskyTemplate(strategic);
  const covariance = tickers.map((_t, i) => tickers.map((_u, j) => i === j ? .04 : 0));
  const overlay = overlayExposure(template, covariance, strategic.reduce((a, b) => a + b, 0) / 2, null);
  overlay.weights.forEach((w, i) => assert.ok(Math.abs(w - expected[i]) < 1e-12));
  const request = optimizerTestRequest({ etfs: tickers, maximum_etf_weight: .3, mandate: { minimum_positions: 5, maximum_positions: 5, minimum_weight: .03 } });
  const toRecord = (weights: number[]) => Object.fromEntries(tickers.map((ticker, i) => [ticker, weights[i]]));
  assert.ok(validateTargets("2024-01-02", toRecord(strategic), request).passed);
  assert.throws(() => validateTargets("2024-01-02", toRecord(overlay.weights), request), (e: any) => e.code === "NUMERICAL_FAILURE");
  assert.ok(validateTargets("2024-01-02", toRecord(overlay.weights), request, false, "EFFECTIVE_CAPITAL").passed);
  const rows = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"].map(date => ({ date, prices: Object.fromEntries(tickers.map(ticker => [ticker, 100])) }));
  const cash = cashIntervals(rows, "2024-01-02", "2024-01-05");
  const ledger = remuneratedLedger(cash, 5, (date, weights) => { validateTargets(date, weights, request, false, "EFFECTIVE_CAPITAL"); })(
    rows, tickers.map(ticker => ({ ticker, enabled: true, priorWeight: 0 })) as any,
    { cashMin: 0, cashMax: 1, minEtfWeight: 0, maxEtfWeight: 1 } as any,
    { ...defaultBacktestConfig(), warmupDays: 0, executionTiming: "next_close", transactionCostBps: 10, slippageBps: 5, maxTurnoverPerRebalance: 1, cashYieldAnnual: 0 },
    null, undefined, () => toRecord(overlay.weights),
    { initialNav: 100, initialCash: 100, initialHoldings: {}, dailyCashYield: 0, d5GrossTradeCosts: true },
    ["2024-01-02"], () => ({ label: "TEST_ONLY", composite: 0 }) as any,
  );
  const fill = ledger.dailyLedger.find(day => day.executionSignalDate === "2024-01-02")!;
  assert.equal(fill.date, "2024-01-03");
  assert.ok(Math.abs(fill.endingPositions.find(p => p.ticker === "XLE")!.weight - .015) < 1e-10);
  assert.ok(fill.transactionCosts > 0 && fill.slippage > 0);
  assert.ok(reconcileLedger(ledger.dailyLedger, cash, 10, 5).passed);
});

for (const minimum_weight of [.025, .03]) {
  for (const capital_signal_frequency of ["DAILY", "REBALANCE_ONLY"]) {
    test(`${minimum_weight * 100}% strategic NAV floor permits reduced positive HMM exposure on ${capital_signal_frequency}`, () => {
      const request = optimizerTestRequest({ etfs: ["SPY", "ETF1"], maximum_etf_weight: minimum_weight,
        mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight }, capital_signal_frequency,
        evaluation_end_exclusive: "2024-04-01", defensive_multiplier: .01 });
      const stress: typeof classify = () => ({ model: "TEST_ONLY_HMM_STRESS", defensive_score: 1, high_risk_probability: null }) as any;
      const result = run(request, optimizerTestData(2), stress);
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.mandate_evidence.length, result.decisions.length);
      for (const decision of result.decisions) {
        assert.ok(Object.values(decision.optimizer.optimized_nav_weights).every((w: any) => Math.abs(w - minimum_weight) < 1e-10));
        assert.ok(Object.values(decision.optimizer.effective_nav_weights).every((w: any) => w > 0 && w < minimum_weight));
        assert.ok(decision.optimizer.construction_floor_deviation_due_to_overlay > 0);
        assert.ok(Object.values(decision.optimizer.construction_constraint_residuals).every((r: any) => r <= CONSTRAINT_TOLERANCE));
        assert.ok(Object.values(decision.optimizer.effective_policy_residuals).every((r: any) => r <= CONSTRAINT_TOLERANCE));
      }
      assert.ok(result.mandate_evidence.every(e => e.passed && e.scope === PORTFOLIO_CONSTRAINT_SCOPE));
      assert.ok(result.capital_target_evidence!.every(e => e.passed && e.scope === "EFFECTIVE_TARGET_EXECUTION_SAFETY_ONLY"));
      assert.ok(result.capital_clock.signals.every(signal => signal.exposure > 0 && signal.exposure < 2 * minimum_weight));
      assert.equal(result.capital_clock.signals.filter(signal => signal.optimizer_refreshed).length, result.decisions.length);
      assert.equal(result.financial_result_hash, run(request, optimizerTestData(2), stress).financial_result_hash);
      assert.ok(result.validation_evidence.accounting.passed);
    });
  }
  test(`${minimum_weight * 100}% construction floor and cap allow price drift; next scheduled solve uses realized prior holdings`, () => {
    const data = optimizerTestData(2);
    for (const row of data.rows) if (row.date >= "2024-01-24") { row.prices.SPY *= .5; row.prices.ETF1 *= 2; }
    const request = optimizerTestRequest({ etfs: ["SPY", "ETF1"], maximum_etf_weight: minimum_weight,
      mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight }, evaluation_end_exclusive: "2024-03-01", regime_response: "FIXED" });
    const calm: typeof classify = () => ({ model: "TEST_ONLY_CALM", defensive_score: 0, high_risk_probability: null }) as any;
    const result = run(request, data, calm), first = result.decisions[0], second = result.decisions[1];
    assert.equal(result.decisions.length, 2);
    const intramonth = result.ledger.filter(day => day.date > "2024-01-23" && day.date < second.decision_date);
    assert.ok(intramonth.some(day => day.endingPositions.some(p => p.ticker === "SPY" && p.weight < minimum_weight)));
    assert.ok(intramonth.some(day => day.endingPositions.some(p => p.ticker === "ETF1" && p.weight > minimum_weight)));
    assert.ok(intramonth.every(day => day.trades.length === 0));
    assert.equal(result.capital_clock.signals.filter(s => s.optimizer_refreshed).length, 2);
    const cutoff = result.ledger.find(day => day.date === second.information_cutoff)!;
    for (const [ticker, actual] of Object.entries(second.prior_weights)) {
      const position = cutoff.endingPositions.find(p => p.ticker === ticker)!;
      assert.ok(Math.abs((actual as number) - position.marketValue / cutoff.endingNav) < 1e-12);
    }
    assert.notDeepEqual(second.prior_weights, first.optimizer.optimized_nav_weights);
    for (const decision of result.decisions) assert.ok(Object.values(decision.optimizer.optimized_nav_weights).every((w: any) => Math.abs(w - minimum_weight) < 1e-10));
    const resetFill = result.ledger.find(day => day.executionSignalDate === second.decision_date)!;
    assert.ok(resetFill.transactionCosts > 0 && resetFill.trades.some(t => t.notional < 0) && resetFill.trades.some(t => t.notional > 0));
    assert.ok(result.validation_evidence.accounting.passed);
  });
}

test("A binding risk-budget overlay preserves its volatility ceiling while allowing sub-floor effective NAV targets in both clocks", () => {
  for (const capital_signal_frequency of ["DAILY", "REBALANCE_ONLY"]) {
    const request = optimizerTestRequest({ etfs: ["SPY", "ETF1"], maximum_etf_weight: .03,
      mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight: .03 },
      control_mode: "RISK_BUDGET", risk_budget: .1, defensive_multiplier: .0001, capital_signal_frequency });
    const stress: typeof classify = () => ({ model: "TEST_ONLY_HMM_STRESS", defensive_score: 1, high_risk_probability: null }) as any;
    const result = run(request, optimizerTestData(2), stress);
    assert.ok(result.decisions.every(d => d.risk_budget > 0 && d.estimated_volatility <= d.risk_budget + CONSTRAINT_TOLERANCE));
    assert.ok(result.decisions.every(d => Object.values(d.weights).every((w: any) => w > 0 && w < .03)));
    assert.ok(result.decisions.every(d => Object.values(d.optimizer.optimized_nav_weights).every((w: any) => Math.abs(w - .03) < 1e-10)));
    assert.ok(result.decisions.every(d => d.optimizer.effective_policy_residuals.volatility_ceiling <= CONSTRAINT_TOLERANCE));
    assert.ok(result.validation_evidence.accounting.passed);
  }
});

test("Effective audit still rejects invalid universe, shorting, leverage and exposure without imposing construction floors", () => {
  const request = optimizerTestRequest({ maximum_exposure: .5 });
  for (const weights of [{ SPY: -.01 }, { SPY: .6 }, { SPY: NaN }, { UNKNOWN: .01 }])
    assert.throws(() => validateTargets("2024-01-22", weights, request, false, "EFFECTIVE_CAPITAL"), (e: any) => e.code === "NUMERICAL_FAILURE");
  assert.ok(validateTargets("2024-01-22", { SPY: .001 }, request, false, "EFFECTIVE_CAPITAL").passed);
});
test("Actual HMM daily refits produce repeated cash/re-entry with frozen monthly composition on a labelled regime fixture", () => {
  const dates = optimizerTestData(3).rows;
  const values = [100, 100, 100];
  const rows = dates.map((row, i) => {
    const highVariance = Math.floor(i / 5) % 2 === 1;
    return { date: row.date, prices: Object.fromEntries(["SPY", "ETF1", "ETF2"].map((ticker, j) => {
      // Two explicit test regimes with well-separated variances. Not market data.
      const variation = highVariance ? .03 * (i % 2 ? 1 : -1) : .00001 * (i % 2 ? 1 : -1);
      values[j] *= Math.exp(.001 + variation * (1 + .1 * j));
      return [ticker, values[j]];
    })) };
  });
  const data = sourceOnlyDataset(rows);
  const request = optimizerTestRequest({ etfs: ["SPY", "ETF1", "ETF2"], maximum_etf_weight: .7,
    evaluation_end_exclusive: "2024-03-01", mandate: { minimum_positions: 1, maximum_positions: 3, minimum_weight: .03 },
    forecast: { model: "MANUAL_SCORE", horizon_sessions: 21, training_sessions: 126, ridge_penalty: 1,
      manual_base_return: .02, manual_score_return: 0,
      signals: [{ id: "MOMENTUM", enabled: true, lookback_sessions: 20, skip_sessions: 0, weight: 1 }] },
  });
  const result = run(request, data, classify);
  assert.equal(result.financial_result_hash, run(request, data, classify).financial_result_hash);
  assert.ok(result.capital_clock.signals.some(s => s.exposure === 0));
  assert.ok(result.capital_clock.signals.some(s => s.exposure > .5));
  assert.ok(result.ledger.filter(d => d.beginningPositions.length === 0 && d.trades.some(t => t.notional > 0)).length >= 3);
  assert.equal(result.capital_clock.signals.filter(s => s.optimizer_refreshed).length, 2);
  for (const decision of result.decisions) {
    const signals = result.capital_clock.signals.filter(s => s.source_optimizer_date === decision.decision_date);
    assert.ok(signals.every(s => JSON.stringify(s.frozen_risky_proportions) === JSON.stringify(signals[0].frozen_risky_proportions)));
    assert.ok(signals.every(s => s.regime.model === "GAUSSIAN_HMM_2_V1"));
  }
  assert.ok(result.validation_evidence.accounting.passed);
});
