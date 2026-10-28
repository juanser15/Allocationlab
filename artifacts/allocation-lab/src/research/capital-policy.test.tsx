import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PolicyEditor, PolicySummary, noAdaptiveEffect, noEffectText, reductionPct, limitText, policySentence, sameCapitalPolicy, type PolicyFields } from "./capital-policy";

const base: PolicyFields = { control_mode: "MAX_EXPOSURE", maximum_exposure: .6, risk_budget: .1, regime_response: "ADAPTIVE", defensive_multiplier: .5, regime_model: "HMM" };
test("Stress reduction is a presentation-only inverse of the existing multiplier", () => {
  for (const m of [0, .001, .2, .5, 1]) {
    assert.ok(Math.abs(1 - reductionPct(m) / 100 - m) < 1e-12);
  }
  assert.equal(reductionPct(1), 0);
  assert.equal(reductionPct(0), 100);
  assert.ok(Number.isNaN(reductionPct(NaN)));
  assert.equal(limitText(base, .5), "30.0% maximum exposure");
  assert.equal(limitText({ ...base, control_mode: "RISK_BUDGET" }, .5), "5.0% volatility ceiling");
});
test("No-effect warning only applies to zero regime reduction, without calling volatility-based weight constant", () => {
  assert.equal(noAdaptiveEffect({ ...base, defensive_multiplier: 1 }), true);
  assert.equal(noAdaptiveEffect({ ...base, defensive_multiplier: 0 }), false);
  assert.equal(noAdaptiveEffect({ ...base, regime_response: "FIXED", defensive_multiplier: 1 }), false);
  assert.match(noEffectText({ ...base, control_mode: "RISK_BUDGET" }), /SPY weight can still vary/);
});
test("Only essential inputs precede the advanced disclosure; rendering does not change policy", () => {
  const original = structuredClone(base);
  const html = renderToStaticMarkup(<PolicyEditor value={base} onChange={() => assert.fail("Rendering must not change policy")} idPrefix="policy" />);
  const visible = html.split("<details")[0];
  assert.match(visible, /Maximum invested/);
  assert.match(visible, /Reduction at full stress/);
  assert.doesNotMatch(visible, /<select|Capital invested<\/button>|Estimated volatility<\/button>/);
  assert.match(html, /policy-details-rule-advanced/);
  assert.match(html, /policy-select-regime-model/);
  assert.match(html, /HMM · two volatility states/);
  assert.deepEqual(base, original);
  const fixed = renderToStaticMarkup(<PolicyEditor value={{ ...base, regime_response: "FIXED" }} onChange={() => {}} idPrefix="policy" />);
  assert.doesNotMatch(fixed, /policy-input-stress-reduction/);
  assert.match(fixed, /classifier does not change/);
});
test("Frozen summaries use the passed saved rule, independently of live edits", () => {
  const saved = { ...base, maximum_exposure: .8, defensive_multiplier: 1 };
  const html = renderToStaticMarkup(<PolicySummary policy={saved} label="Rule executed" testId="saved" />);
  assert.match(html, /80.0% maximum exposure/);
  assert.match(html, /Regime has no effect/);
  assert.match(policySentence(base), /cut 50%/);
  assert.doesNotMatch(html, /60.0% maximum exposure/);
});
test("Study-copy difference detection compares exact fields, not rounded summaries or test dates", () => {
  assert.equal(sameCapitalPolicy(base, { ...base }), true);
  assert.equal(sameCapitalPolicy(base, { ...base, maximum_exposure: .60001 }), false);
  assert.equal(sameCapitalPolicy(base, { ...base, regime_model: "TREND" }), false);
  assert.equal(sameCapitalPolicy({ ...base, slippage_bps: 0 }, { ...base, slippage_bps: 1 }), false);
});
