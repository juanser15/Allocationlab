import assert from "node:assert/strict";
const base =
  process.env.COORDINATED_TEST_BASE ??
  "http://127.0.0.1:4173/api/workbench/coordinated";
const request = {
  contract_version: "allocationlab-coordinated-1.0.0",
  evaluation_start: "2024-01-21",
  evaluation_end_exclusive: "2024-07-21",
  training_window_months: 6,
  window_type: "ROLLING",
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10,
  control_mode: "RISK_BUDGET",
  maximum_exposure: 0.6,
  risk_budget: 0.06,
  regime_model: "HMM",
  regime_response: "ADAPTIVE",
  defensive_multiplier: 0.5,
  etfs: ["SPY", "EFA", "IEF", "GLD"],
  maximum_etf_weight: 0.4,
  risk_aversion: 5,
  covariance_shrinkage: 0.2,
};
async function api(path, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const x = await r.json();
  assert.ok(r.ok, JSON.stringify(x));
  return x;
}
async function complete(id) {
  for (let i = 0; i < 60; i++) {
    const r = await api(`/runs/${id}`);
    if (!["PENDING", "RUNNING"].includes(r.latest_status)) {
      assert.equal(r.latest_status, "SUCCESS", JSON.stringify(r.latest_result));
      return r;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Worker did not complete within test bound");
}
assert.equal(
  (await api("/capabilities")).supported_spec_version,
  request.contract_version,
);
const plan = await api("/plan", request);
assert.equal(plan.number_of_folds, 6);
const submitted = await api("/runs", request),
  first = await complete(submitted.run_id);
assert.equal(first.latest_result.decisions.length, 6);
assert.equal(first.latest_result.plan.plan_hash, plan.plan_hash);
assert.ok(
  first.latest_result.decisions.every(
    (d) => d.estimated_volatility <= d.risk_budget + 1e-7,
  ),
);
const reused = await api("/runs", request);
assert.equal(reused.reused_existing_attempt, true);
await api(`/runs/${submitted.run_id}/rerun`, {});
const second = await complete(submitted.run_id);
assert.equal(second.attempt_history.length, first.attempt_history.length + 1);
assert.equal(
  second.latest_result.financial_result_hash,
  first.latest_result.financial_result_hash,
);
assert.notEqual(
  second.latest_result.execution_attempt_id,
  first.latest_result.execution_attempt_id,
);
assert.ok((await api("/runs")).runs.some((r) => r.run_id === submitted.run_id));
assert.equal(first.spec.research_scope, "PORTFOLIO");
assert.equal(first.latest_result.research_scope, "PORTFOLIO");
assert.equal(first.latest_result.benchmark, undefined);
const {
  etfs,
  maximum_etf_weight,
  risk_aversion,
  covariance_shrinkage,
  ...shared
} = request;
const studyRequest = { ...shared, research_scope: "CAPITAL_EXPOSURE" };
const studyReceipt = await api("/runs", studyRequest),
  study = await complete(studyReceipt.run_id);
assert.notEqual(study.run_id, first.run_id);
assert.equal(study.spec.research_scope, "CAPITAL_EXPOSURE");
assert.ok(!Object.hasOwn(study.spec, "etfs"));
assert.equal(study.latest_result.research_scope, "CAPITAL_EXPOSURE");
assert.ok(
  study.latest_result.decisions.every(
    (d) => d.optimizer === null && Object.keys(d.weights).join() === "SPY",
  ),
);
assert.deepEqual(
  study.latest_result.points.map((p) => p.date),
  study.latest_result.benchmark.points.map((p) => p.date),
);
const listed = (await api("/runs")).runs;
assert.ok(
  listed.some(
    (r) =>
      r.run_id === study.run_id && r.spec.research_scope === "CAPITAL_EXPOSURE",
  ),
);
assert.ok(
  listed.some(
    (r) => r.run_id === first.run_id && r.spec.research_scope === "PORTFOLIO",
  ),
);
console.log(
  JSON.stringify({
    status: "PASS",
    run_id: submitted.run_id,
    study_run_id: study.run_id,
    attempts: second.attempt_history.length,
    decisions: 6,
    financial_result_hash: second.latest_result.financial_result_hash,
  }),
);
