import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { BacktestInputs } from "./backtest-inputs";
import { MandateFields, cashPolicyLabel } from "./coordinated-p0";
import { PolicyEditor } from "./capital-policy";

const draft: any = {
  research_scope: "PORTFOLIO", etfs: Array.from({ length: 20 }, (_, i) => `ASSET${i}`),
  mandate: { minimum_positions: 8, maximum_positions: 12, minimum_weight: .025 },
  maximum_etf_weight: .1, maximum_exposure: 1, risk_budget: .1,
  control_mode: "MAX_EXPOSURE", regime_response: "ADAPTIVE",
  defensive_multiplier: 0, regime_model: "HMM", capital_signal_frequency: "DAILY",
  dataset_id: "existing-saved-dataset", evaluation_start: "2024-01-22",
  evaluation_end_exclusive: "2024-02-03", training_window_months: 24,
  window_type: "ROLLING", rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10, slippage_bps: 5,
  cash_policy: { type: "ZERO_RETURN", annual_rate: 0 },
};
const caps = { dataset_source: "INTERNAL_SNAPSHOT", dataset_version: 7 };
test("Backtest summary separates candidates, final holdings, cash return and investment ceilings", () => {
  const before = structuredClone(draft);
  const html = renderToStaticMarkup(<BacktestInputs draft={draft} caps={caps} />);
  assert.match(html, /20 selected · candidates, not holdings/);
  assert.match(html, /8 min · 12 max/);
  assert.match(html, /10.0% of total NAV/);
  assert.match(html, /2.5% of total NAV/);
  assert.match(html, /Up to 100.0% invested/);
  assert.match(html, /full stress: up to 0.0% invested · at least 100.0% cash/);
  assert.match(html, /Cash return assumption: 0%/);
  for (const text of [/HMM/, /v7/, /To exclusive/, /24 months · rolling/, /Monthly/, /Daily/, /10 bps trading · 5 bps slippage/])
    assert.match(html, text);
  assert.doesNotMatch(html, /data-conflict="true"|text-portfolio-conflict/);
  assert.deepEqual(draft, before);
});
test("Conflicting constraints are highlighted at their exact summary rows, with a specific fix", () => {
  const html = renderToStaticMarkup(<BacktestInputs draft={{ ...draft, maximum_etf_weight: .02 }} caps={caps} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /Minimum asset weight.*exceeds maximum asset weight/);
  assert.match(html, /Lower the minimum weight or raise the maximum weight/);
  assert.match(html, /data-testid="text-input-max-weight" data-conflict="true"/);
  assert.match(html, /data-testid="text-input-min-weight" data-conflict="true"/);
});
test("No mandate is described without inventing a minimum or guaranteed number of holdings", () => {
  const html = renderToStaticMarkup(<BacktestInputs draft={{ ...draft, mandate: undefined }} caps={caps} />);
  assert.match(html, /No holding-count mandate · may hold zero to all candidates/);
  assert.match(html, /None · no mandate/);
  assert.equal(cashPolicyLabel(draft.cash_policy), "Cash return assumption: 0%");
});

test("Mandate summary distinguishes strategic construction floors from permitted HMM scaling and drift", () => {
  for (const minimum_weight of [.025, .03]) {
    const html = renderToStaticMarkup(<BacktestInputs draft={{ ...draft, mandate: { ...draft.mandate, minimum_weight } }} caps={caps} />);
    assert.match(html, /at strategic construction/);
    assert.match(html, /HMM scaling and market drift may take effective weights below this floor/);
    assert.doesNotMatch(html, /max when invested/);
  }
});
test("Final-holdings fields allow more than eight without silently clamping the mandate", () => {
  const m = { minimum_positions: 9, maximum_positions: 12, minimum_weight: .025 };
  const before = { ...m };
  const html = renderToStaticMarkup(<MandateFields value={m} selected={20} maxWeight={.1} onChange={() => assert.fail("Render must not update inputs")} />);
  assert.match(html, /Minimum final holdings/);
  assert.match(html, /Maximum final holdings/);
  assert.match(html, /value="12"/);
  assert.doesNotMatch(html, /max="8"|capped at 8/);
  assert.deepEqual(m, before);
});
test("Capital policy explains the valid 100%-stress reduction without implying cash allocation is zero", () => {
  const html = renderToStaticMarkup(<PolicyEditor value={draft} idPrefix="test" onChange={() => {}} />);
  assert.match(html, /A 100% stress reduction is valid/);
  assert.match(html, /maximum invested exposure is 0% and cash is 100%/);
  assert.match(html, /Cash return assumption: 0%/);
});
