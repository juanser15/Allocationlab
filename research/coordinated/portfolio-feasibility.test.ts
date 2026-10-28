import test from "node:test";
import assert from "node:assert/strict";
import { portfolioFeasibilityIssue } from "../../artifacts/api-server/src/lib/workbench/portfolio-feasibility";
import { parseP0, planP0WithData, type P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { COORDINATED_SPEC, CURRENT_CASH_POLICY } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";
import { preparedDataset } from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import { runInstitutional, validateTargets } from "./institutional";
import { optimize } from "./models";

const candidates = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY", "IWM", "EEM", "EWJ", "EWG", "EWU", "EWC", "EWA", "EWZ", "EUFN"];
const request: any = {
  contract_version: COORDINATED_SPEC, dataset_id: `internal_${"a".repeat(64)}`,
  research_scope: "PORTFOLIO", etfs: candidates,
  maximum_etf_weight: .1, risk_aversion: 5, covariance_shrinkage: .2,
  cash_policy: CURRENT_CASH_POLICY, slippage_bps: 0,
  quality_control: { enabled: false, policy_version: "STRUCTURAL_V1" },
  evaluation_start: "2024-01-22", evaluation_end_exclusive: "2024-02-03",
  training_window_months: 6, window_type: "ROLLING", rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10, control_mode: "MAX_EXPOSURE", maximum_exposure: .5,
  risk_budget: .1, regime_model: "TREND", regime_response: "FIXED",
  defensive_multiplier: .5, capital_signal_frequency: "REBALANCE_ONLY",
  mandate: { minimum_positions: 8, maximum_positions: 12, minimum_weight: .025 },
};
const issue = (patch: any = {}) => portfolioFeasibilityIssue({ ...request, ...patch });
function dataset(): P0Dataset {
  const source = preparedDataset();
  return { ...source, binding: { dataset_id: request.dataset_id, dataset_version: 1,
    dataset_hash: "a".repeat(64), dataset_source: "INTERNAL_SNAPSHOT" } };
}
test("Twenty candidates and an 8–12 final-holdings mandate are accepted, without clamping or input mutation", () => {
  const original = structuredClone(request);
  const parsed = parseP0(request);
  assert.equal(parsed.etfs.length, 20);
  assert.deepEqual(parsed.mandate, request.mandate);
  assert.equal(issue(), null);
  assert.deepEqual(request, original);
  assert.ok(parseP0({ ...request, mandate: { minimum_positions: 9, maximum_positions: 20, minimum_weight: .01 } }));
});
test("Candidate duplicates and empty candidates are rejected with a specific actionable reason", () => {
  for (const [etfs, match] of [[[], /at least one|No candidate/i], [["XLB", "XLB"], /duplicate/i]] as const)
    assert.throws(() => parseP0({ ...request, etfs, mandate: undefined }), match);
});
test("Feasibility identifies the exact conflicting holding constraints", () => {
  const count = issue({ mandate: { minimum_positions: 13, maximum_positions: 12, minimum_weight: .01 } })!;
  assert.deepEqual(count.fields, ["mandate.minimum_positions", "mandate.maximum_positions"]);
  assert.match(count.message, /13.*12/);
  const universe = issue({ etfs: candidates.slice(0, 4) })!;
  assert.deepEqual(universe.fields, ["mandate.minimum_positions", "etfs"]);
  assert.match(universe.message, /8.*4/);
  // A maximum is an upper bound, not an obligation to hold that many assets.
  assert.equal(issue({ mandate: { minimum_positions: 8, maximum_positions: 40, minimum_weight: .025 } }), null);
});
test("Weight-floor conflicts and required invested capital are checked before execution", () => {
  const weight = issue({ maximum_etf_weight: .02 })!;
  assert.deepEqual(weight.fields, ["mandate.minimum_weight", "maximum_etf_weight"]);
  const cap = issue({ maximum_exposure: .15 })!;
  assert.match(cap.message, /8.*2.5%.*20%.*15%/);
  assert.ok(cap.suggestion.length);
  assert.equal(issue({ maximum_exposure: .2 }), null, "The exact boundary is feasible");
  for (const maximum_etf_weight of [NaN, 0, -.1, 1.1])
    assert.ok(issue({ maximum_etf_weight }));
});
test("A low maximum-weight capacity does not require full investment or silently change inputs", () => {
  const r = { ...request, maximum_exposure: 1, maximum_etf_weight: .03,
    mandate: { minimum_positions: 8, maximum_positions: 12, minimum_weight: .025 } };
  assert.equal(portfolioFeasibilityIssue(r), null);
  assert.ok(parseP0(r), "12 × 3% < 100% ceiling is valid; remainder may stay cash");
  assert.equal(r.maximum_exposure, 1);
});
test("100% ceiling plus 100% stress reduction is valid in Daily mode, including full-cash targets", () => {
  const r = { ...request, maximum_exposure: 1, regime_response: "ADAPTIVE",
    defensive_multiplier: 0, capital_signal_frequency: "DAILY" };
  assert.ok(parseP0(r));
  assert.equal(portfolioFeasibilityIssue(r), null);
  assert.ok(validateTargets("2024-01-22", Object.fromEntries(candidates.map(t => [t, 0])), r).passed);
  assert.equal(portfolioFeasibilityIssue({ ...r, maximum_exposure: 0 }), null);
  assert.ok(issue({ maximum_exposure: 0 }), "Legacy all-cash/min-holdings semantics remain unchanged");
  assert.ok(parseP0({ ...r, control_mode: "RISK_BUDGET" }));
});
test("Dataset membership is verified individually before the calendar or optimizer", () => {
  const data = dataset();
  assert.throws(() => planP0WithData({ ...request, etfs: ["SPY", "NOTINDATA"], mandate: undefined }, data),
    (e: any) => e.code === "CANDIDATES_NOT_IN_DATASET" && /NOTINDATA/.test(e.message) &&
      e.details.missing_symbols[0] === "NOTINDATA");
});
test("All supported internal candidates pass actual preflight and execute a short unfrozen-mandate run", () => {
  const data = dataset();
  const all = [...new Set(data.rows.flatMap(r => Object.keys(r.prices)))].sort();
  assert.ok(all.length > 8);
  const r = { ...request, etfs: all, mandate: undefined, maximum_etf_weight: .4 };
  const plan = planP0WithData(r, data);
  assert.deepEqual(plan.normalized_request.etfs, all);
  // Uses existing real internal research rows, in-memory only; no save or fetch.
  const result = runInstitutional(plan.normalized_request as any, data);
  assert.ok(result.validation_evidence.accounting.passed);
  assert.equal(Object.keys(result.decisions[0].weights).length, all.length);
});
test("Final targets must satisfy holdings and weight requirements; nothing is truncated or raised", () => {
  const r = { ...request, etfs: ["SPY", "EFA", "IEF"],
    maximum_etf_weight: .3, mandate: { minimum_positions: 2, maximum_positions: 2, minimum_weight: .1 } };
  for (const weights of [{ SPY: .2 }, { SPY: .1, EFA: .1, IEF: .1 }, { SPY: .05, EFA: .2 }]) {
    const before = { ...weights };
    assert.throws(() => validateTargets("2024-01-22", weights, r),
      (e: any) => e.code === "MANDATE_BREACH" && /holdings|minimum per held asset/.test(e.message));
    assert.deepEqual(weights, before);
  }
});
test("The continuous objective and weight solution remain unchanged for existing valid inputs", () => {
  const covariance = [[.04, 0], [0, .09]];
  const solved = optimize([.08, .12], covariance, [0, 0],
    { cap: 1, maxWeight: 1, riskAversion: 5, cost: 0, horizon: 1, volatility: null });
  assert.ok(Math.abs(solved.weights[0] - .4) < 1e-7);
  assert.ok(Math.abs(solved.weights[1] - .12 / .45) < 1e-7);
});
