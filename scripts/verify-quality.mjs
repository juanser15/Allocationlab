// Bounded functional verification against the running API, using saved data only.
// No downloads, provider changes, parameter search, trading or active-dataset change.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const root = `https://${process.env.REPLIT_DEV_DOMAIN}/api/workbench/p0`;
const dataset = "yf_a140f0c19a244eed968211605215c662";
async function api(path, body) {
  const r = await fetch(root + path, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(json).slice(0, 900)}`);
  return json;
}
const shared = {
  contract_version: "allocationlab-coordinated-1.0.0", dataset_id: dataset,
  evaluation_start: "2024-01-02", evaluation_end_exclusive: "2024-03-02",
  training_window_months: 24, window_type: "ROLLING", rebalance_frequency: "MONTHLY", transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE", maximum_exposure: .6, risk_budget: .1, regime_model: "TREND", regime_response: "FIXED",
  defensive_multiplier: .5, cash_policy: { type: "SGOV_TOTAL_RETURN", ticker: "SGOV" }, slippage_bps: 1,
};
async function submit(spec) {
  const submitted = await api("/runs", spec);
  const id = submitted.run_id;
  assert.ok(id, JSON.stringify(submitted).slice(0, 1000));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const r = await api(`/runs/${id}`);
    if (!["PENDING", "RUNNING", null].includes(r.latest_status)) return r;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Attempt did not terminate in 90s: ${id}`);
}
const capital = await submit({ ...shared, research_scope: "CAPITAL_EXPOSURE" });
assert.equal(capital.latest_status, "SUCCESS", JSON.stringify(capital.latest_result));
assert.equal(capital.latest_successful_result.validation_evidence.accounting.passed, true);
assert.equal(capital.latest_successful_result.capital_gate.optimizer, "NONE");
const portfolio = { ...shared, research_scope: "PORTFOLIO", etfs: ["SPY", "SGOV"], maximum_etf_weight: .4, risk_aversion: 5, covariance_shrinkage: .2 };
const on = await submit({ ...portfolio, quality_control: { enabled: true, policy_version: "STRUCTURAL_V1" } });
const off = await submit({ ...portfolio, quality_control: { enabled: false, policy_version: "STRUCTURAL_V1" } });
for (const r of [on, off]) {
  assert.equal(r.latest_status, "SUCCESS", JSON.stringify(r.latest_result));
  const result = r.latest_successful_result;
  assert.equal(result.quality_gate_evidence.every_rebalance, true);
  assert.equal(result.quality_gate_evidence.evaluated_rebalances, result.plan.number_of_folds);
  assert.equal(result.validation_evidence.accounting.passed, true);
  assert.ok(result.mandate_evidence.every(x => x.passed));
}
assert.notEqual(on.run_id, off.run_id);
assert.deepEqual(on.latest_successful_result.points, off.latest_successful_result.points);
assert.deepEqual(on.latest_successful_result.ledger, off.latest_successful_result.ledger);
const canceled = {
  model: "MANUAL_SCORE", horizon_sessions: 21, manual_base_return: .02, manual_score_return: .02, training_sessions: 252, ridge_penalty: 1,
  signals: [
    { id: "MOMENTUM", enabled: true, lookback_sessions: 21, skip_sessions: 0, weight: 1 },
    { id: "REVERSAL", enabled: true, lookback_sessions: 21, skip_sessions: 0, weight: 1 },
  ],
};
const blocked = await submit({ ...portfolio, forecast: canceled, quality_control: { enabled: true, policy_version: "STRUCTURAL_V1" } });
assert.equal(blocked.latest_status, "FAILED");
assert.equal(blocked.latest_result.error_class, "QUALITY_GATE_BLOCKED");
assert.equal(blocked.latest_successful_result, null);
assert.equal(blocked.latest_result.technical_details.gate_evidence.would_block, true);
assert.ok(!blocked.latest_result.metrics);
const observed = await submit({ ...portfolio, forecast: canceled, quality_control: { enabled: false, policy_version: "STRUCTURAL_V1" } });
assert.equal(observed.latest_status, "SUCCESS", JSON.stringify(observed.latest_result));
assert.equal(observed.latest_successful_result.quality_gate_evidence.status, "OFF_OBSERVE_ONLY");
assert.ok(observed.latest_successful_result.quality_gate_evidence.decisions.every(d => d.would_block));
await mkdir("generated-artifacts/quality-validation", { recursive: true });
const evidence = {
  scope: "BOUNDED_FUNCTIONAL_VERIFICATION_NOT_A_PROPOSED_ALLOCATION",
  dataset_id: dataset, dataset_hash: on.spec.dataset_hash,
  checks: { fixed_spy_cash_accounting: true, passing_on_off_same_fills: true, distinct_immutable_identity: true, exactly_one_quality_evaluation_per_rebalance: true, blocked_no_substitute_result: true, off_preserves_would_block_evidence: true },
  runs: Object.fromEntries(Object.entries({ capital, on, off, blocked, observed }).map(([k, v]) => [k, { run_id: v.run_id, status: v.latest_status, attempt: v.latest_attempt.attempt.execution_attempt_id }])),
};
await writeFile("generated-artifacts/quality-validation/api-evidence.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
