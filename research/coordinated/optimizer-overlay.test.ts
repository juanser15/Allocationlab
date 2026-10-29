/** Source-only synthetic integration evidence; not private historical certification. */
import test from "node:test";
import assert from "node:assert/strict";
import { assertFrozenOverlayMandate, classify } from "./engine";
import { runInstitutional, validateTargets } from "./institutional";
import { normalizeP0WithData } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { optimizerTestData, optimizerTestRequest, sourceOnlyDataset } from "./optimizer-test-fixtures";
import { riskyTemplate } from "./capital-clock";
import { SUPPORT_TOLERANCE, CONSTRAINT_TOLERANCE } from "../../artifacts/api-server/src/lib/workbench/portfolio-numerics";

const controlled: typeof classify = (_model, history) => ({ model: "TEST_ONLY_CASH_GATE", defensive_score: (Date.parse(history.at(-1)!.date) / 86400000) % 2, high_risk_probability: null }) as any;
const run = (request = optimizerTestRequest(), data = optimizerTestData(), classifyCapital = controlled) => runInstitutional(normalizeP0WithData(request, data), data, () => {}, { classifyCapital });

test("Original 11-holdings and below-3% failures: actual engine constructs invested mandate targets", () => {
  const request = optimizerTestRequest({ capital_signal_frequency: "REBALANCE_ONLY", regime_response: "FIXED" });
  const result = run(request);
  assert.equal(result.decisions.length, 1);
  for (const decision of result.decisions) {
    const active = Object.values(decision.weights).filter((w: any) => w > SUPPORT_TOLERANCE) as number[];
    assert.ok(active.length >= 1 && active.length <= 10);
    assert.ok(active.every(w => w >= .03 - CONSTRAINT_TOLERANCE && w <= .25 + CONSTRAINT_TOLERANCE));
    assert.ok(decision.optimizer.audit);
    assert.deepEqual(decision.optimizer.effective_nav_weights, decision.weights);
    assert.equal(decision.optimizer.selected_support_tickers.length, active.length);
    assert.equal(decision.optimizer.audit.support_size, active.length);
    assert.ok(Object.values(decision.optimizer.effective_constraint_residuals).every((r: any) => r <= CONSTRAINT_TOLERANCE));
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
test("A positive intramonth NAV-floor conflict fails explicitly without changing frozen weights", () => {
  const template = riskyTemplate([.4, .3, .3]), floor = { minimum_positions: 1, maximum_positions: 3, minimum_weight: .03 };
  const weights = [.02, .015, .015], before = [...weights];
  assert.throws(() => assertFrozenOverlayMandate(weights, template, floor, { decision_date: "2024-02-02", source_optimizer_date: "2024-01-22" }, false), (error: any) => error.code === "SOLVER_INFEASIBLE" && error.details.reason === "FROZEN_COMPOSITION_EXPOSURE_CONFLICT" && Math.abs(error.details.minimum_required_exposure_for_frozen_composition - .1) < 1e-12);
  assert.deepEqual(weights, before);
  assert.throws(() => assertFrozenOverlayMandate([1e-12, 1e-12, 1e-12], template, floor, {}, false), (e: any) => e.code === "SOLVER_INFEASIBLE");
  assert.doesNotThrow(() => assertFrozenOverlayMandate([0, 0, 0], template, floor, {}, true));
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
