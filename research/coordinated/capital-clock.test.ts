import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCoordinated, classify } from "./engine";
import { normalizeP0WithData, engineRequest, p0RunId } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { runInstitutional, validateTargets } from "./institutional";
import { riskyTemplate, overlayExposure } from "./capital-clock";
import { clockData, clockRequest, legacyCases } from "./capital-clock-fixtures";
import { anchoredMonth } from "../../artifacts/api-server/src/lib/workbench/interactive-calendar";

const controlled: typeof classify = (_model, history) => ({
  model: "TEST_ONLY", defensive_score: (Date.parse(history.at(-1)!.date) / 86400000) % 2,
  high_risk_probability: null, label: "TEST_ONLY",
}) as any;
const run = (request = clockRequest(), data = clockData(), classifier = controlled) =>
  runInstitutional(normalizeP0WithData(request, data), data, () => {}, { classifyCapital: classifier });

test("Rebalance-only and absent clock match frozen pre-clock financial hashes exactly", () => {
  const golden = JSON.parse(readFileSync("research/coordinated/fixtures/pre-capital-clock.json", "utf8"));
  const data = clockData();
  for (const { name, request } of legacyCases()) {
    for (const frequency of [undefined, "REBALANCE_ONLY"]) {
      const r = { ...request, ...(frequency ? { capital_signal_frequency: frequency } : {}) };
      const spec = normalizeP0WithData(r, data);
      const result = runCoordinated({ ...spec, ...engineRequest(r) }, data);
      assert.equal(result.financial_result_hash, golden.hashes[name], name);
      assert.equal(result.capital_clock.frequency, "REBALANCE_ONLY");
      assert.equal(result.capital_clock.intramonth_exposure_changes, 0);
    }
  }
});
test("Daily portfolio switches cash/risk repeatedly while optimizer and quality run only at scheduled dates", () => {
  const result = run();
  assert.equal(result.decisions.length, 1);
  assert.equal(result.quality_gate_evidence.evaluated_rebalances, 1);
  const signals = result.capital_clock.signals;
  assert.ok(signals.length > 10);
  assert.equal(signals.filter(s => s.optimizer_refreshed).length, 1);
  assert.ok(signals.some(s => s.exposure === 0));
  assert.ok(signals.some(s => s.exposure > .99));
  assert.ok(result.capital_clock.intramonth_exposure_changes > 4);
  for (const signal of signals) {
    assert.deepEqual(signal.frozen_risky_proportions, signals[0].frozen_risky_proportions);
    assert.ok(signal.information_cutoff < signal.decision_date);
    assert.ok(signal.execution_date === null || signal.execution_date > signal.decision_date);
  }
  const reentries = result.ledger.filter(d => d.trades.some(t => t.notional > 0) && d.beginningPositions.length === 0);
  assert.ok(reentries.length > 1, "Cash-to-risk re-entry must execute repeatedly");
  for (const day of reentries) {
    const signal = signals.find(s => s.decision_date === day.executionSignalDate)!;
    for (const position of day.endingPositions)
      assert.ok(Math.abs(position.weight - signal.frozen_risky_proportions[position.ticker]) < 1e-8);
  }
  assert.ok(result.validation_evidence.accounting.passed);
});
test("Daily unchanged exposure produces no drift rebalancing, and the due initial order is not lost", () => {
  const calm: typeof classify = () => ({ model: "TEST_ONLY", defensive_score: 0, high_risk_probability: null }) as any;
  const result = run(clockRequest(), clockData(), calm);
  assert.equal(result.ledger.filter(d => d.trades.length).length, 1);
  assert.equal(result.capital_clock.signals.filter(s => s.trade_requested).length, 1);
  assert.ok(result.ledger.some(d => d.endingPositions.length > 0));
  assert.equal(result.capital_clock.capital_overlay_costs, 0);
});
test("SPY/cash has the same daily signals, switching, timing and real overlay costs without an optimizer", () => {
  const result = run(clockRequest("CAPITAL_EXPOSURE"));
  assert.ok(result.capital_clock.intramonth_exposure_changes > 4);
  assert.ok(result.capital_clock.signals.every(s => !s.optimizer_refreshed));
  assert.ok(result.capital_clock.signals.every(s => s.frozen_risky_proportions.SPY === 1));
  const overlaySignals = new Set(result.capital_clock.signals.filter(s => !s.rebalance_date && s.trade_requested).map(s => s.decision_date));
  const ledger = result.ledger.filter(d => overlaySignals.has(d.executionSignalDate));
  const fees = ledger.reduce((sum, d) => sum + d.transactionCosts, 0), slip = ledger.reduce((sum, d) => sum + d.slippage, 0);
  assert.equal(result.capital_clock.capital_overlay_transaction_costs, fees);
  assert.equal(result.capital_clock.capital_overlay_slippage, slip);
  assert.equal(result.capital_clock.capital_overlay_costs, fees + slip);
  assert.ok(fees > 0 && slip > 0);
  assert.ok(result.benchmark);
  assert.equal(result.benchmark.ledger.filter((d: any) => d.trades.length).length, 1);
});
test("Real HMM refits daily on rolling/expanding windows, and future/execution-close prices cannot affect earlier signals", () => {
  for (const window_type of ["ROLLING", "EXPANDING"]) {
    const request = { ...clockRequest("CAPITAL_EXPOSURE"), evaluation_end_exclusive: "2024-01-31", window_type };
    const calls: any[] = [];
    const observed: typeof classify = (model, rows, universe) => {
      calls.push({ first: rows[0].date, last: rows.at(-1)!.date, count: rows.length });
      return classify(model, rows, universe);
    };
    const data = clockData(), a = run(request, data, observed);
    assert.equal(calls.length, a.capital_clock.signals.length);
    for (let i = 0; i < calls.length; i++) {
      const s = a.capital_clock.signals[i];
      assert.equal(calls[i].last, s.information_cutoff);
      assert.equal(calls[i].count, s.training_observations);
      if (window_type === "ROLLING") assert.equal(s.training_start, anchoredMonth(s.decision_date, -6));
      else assert.equal(s.training_start, a.capital_clock.signals[0].training_start);
    }
    const changed = structuredClone(data), cutoff = a.capital_clock.signals[2].decision_date;
    for (const row of changed.rows) if (row.date >= cutoff) row.prices.SPY *= 1.002;
    const b = run(request, changed, classify);
    assert.deepEqual(a.capital_clock.signals.filter(s => s.decision_date <= cutoff), b.capital_clock.signals.filter(s => s.decision_date <= cutoff));
  }
});
test("Monthly and quarterly calendars refresh composition only at their own folds", () => {
  for (const rebalance_frequency of ["MONTHLY", "QUARTERLY"]) {
    const result = run({ ...clockRequest(), rebalance_frequency, evaluation_end_exclusive: "2024-03-01" });
    assert.equal(result.decisions.length, rebalance_frequency === "MONTHLY" ? 2 : 1);
    const dates = result.decisions.map(d => d.decision_date);
    assert.deepEqual(result.capital_clock.signals.filter(s => s.optimizer_refreshed).map(s => s.decision_date), dates);
    for (const d of result.decisions) {
      const signals = result.capital_clock.signals.filter(s => s.source_optimizer_date === d.decision_date);
      assert.ok(signals.every(s => JSON.stringify(s.frozen_risky_proportions) === JSON.stringify(signals[0].frozen_risky_proportions)));
    }
  }
});
test("Daily clock is frozen in identity, rejects unknown frequency and preserves explicit full-cash defense", () => {
  const data = clockData(), request = clockRequest();
  assert.notEqual(p0RunId(normalizeP0WithData(request, data)), p0RunId(normalizeP0WithData({ ...request, capital_signal_frequency: "REBALANCE_ONLY" }, data)));
  assert.throws(() => normalizeP0WithData({ ...request, capital_signal_frequency: "HOURLY" }, data), /frequency/);
  const mandate = { minimum_positions: 2, maximum_positions: 3, minimum_weight: .01 };
  assert.ok(validateTargets("2024-01-22", { SPY: 0, EFA: 0 }, { ...request, mandate }).passed);
  assert.throws(() => validateTargets("2024-01-22", { SPY: 0, EFA: 0 }, { ...request, mandate, capital_signal_frequency: "REBALANCE_ONLY" }), (e: any) => e.code === "MANDATE_BREACH");
  assert.throws(() => validateTargets("2024-01-22", { SPY: .001, EFA: .001 }, { ...request, mandate }), (e: any) => e.code === "MANDATE_BREACH");
});
test("Overlay proportions survive zero exposure and risk-budget changes never violate baseline max allocation", () => {
  const template = riskyTemplate([.4, .2]);
  assert.deepEqual(overlayExposure(template, [[.04, 0], [0, .09]], 0, null).weights, [0, 0]);
  const back = overlayExposure(template, [[.04, 0], [0, .09]], 1, null);
  assert.ok(Math.abs(back.weights[0] - .4) < 1e-12);
  assert.ok(Math.abs(back.weights[1] - .2) < 1e-12);
  const risk = overlayExposure(template, [[.04, 0], [0, .09]], 1, .03);
  assert.ok(risk.volatility <= .03 + 1e-12 && risk.exposure <= .6 + 1e-12);
});
test("Daily risk-budget can liquidate fully; rebalance-only retains its original positive-multiplier requirement", () => {
  for (const scope of ["PORTFOLIO", "CAPITAL_EXPOSURE"]) {
    const request = { ...clockRequest(scope), control_mode: "RISK_BUDGET" };
    const result = run(request);
    assert.ok(result.capital_clock.signals.some(s => s.exposure === 0));
    assert.ok(result.capital_clock.signals.some(s => s.exposure > 0));
    assert.ok(result.capital_clock.intramonth_exposure_changes > 4);
    assert.ok(result.validation_evidence.accounting.passed);
    assert.throws(() => normalizeP0WithData({ ...request, capital_signal_frequency: "REBALANCE_ONLY" }, clockData()), /positive defensive multiplier/);
  }
});
