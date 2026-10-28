import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import apiApp from "../../app";
import { capabilitiesV2, loadDatasetV2, parseSubmissionV2, planCalendarV2, normalizedSpecV2, runIdV2, SPEC_V2, CalendarContractError, type SubmissionV2 } from "./calendar-v2";

const base: SubmissionV2 = {
  contract_version: SPEC_V2, research_mode: "CAPITAL_MARKET_EXPOSURE", execution_scope: "EMPIRICAL", universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD", evaluation_start: "2022-01-01", evaluation_end_exclusive: "2022-03-01",
  window_type: "ROLLING", training_window_months: 24, rebalance_frequency: "MONTHLY", transaction_cost_bps: 0, selection_cost_bps: 2.5,
};
const dataset = loadDatasetV2();
const temporal = (request: SubmissionV2) => planCalendarV2(request, dataset, false);
const intervals = (request: SubmissionV2) => temporal(request).folds.map(fold => [fold.training_start, fold.training_end_exclusive, fold.oos_start, fold.oos_end_exclusive]);
const example = { ...base, evaluation_start: "2020-01-01", evaluation_end_exclusive: "2020-05-01" };

test("rolling monthly known answer uses OOS dates, preceding training, disjoint one-month folds", () => {
  assert.deepEqual(intervals(example), [
    ["2018-01-01", "2020-01-01", "2020-01-01", "2020-02-01"],
    ["2018-02-01", "2020-02-01", "2020-02-01", "2020-03-01"],
    ["2018-03-01", "2020-03-01", "2020-03-01", "2020-04-01"],
    ["2018-04-01", "2020-04-01", "2020-04-01", "2020-05-01"],
  ]);
});
test("expanding known answer preserves the first training start", () => {
  assert.deepEqual(intervals({ ...example, window_type: "EXPANDING" }), [
    ["2018-01-01", "2020-01-01", "2020-01-01", "2020-02-01"],
    ["2018-01-01", "2020-02-01", "2020-02-01", "2020-03-01"],
    ["2018-01-01", "2020-03-01", "2020-03-01", "2020-04-01"],
    ["2018-01-01", "2020-04-01", "2020-04-01", "2020-05-01"],
  ]);
});
test("quarterly known answer derives a three-month horizon, step and refit cadence", () => {
  const request = { ...base, evaluation_end_exclusive: "2022-10-01", rebalance_frequency: "QUARTERLY" as const };
  const plan = planCalendarV2(request, dataset);
  assert.deepEqual(plan.folds.map(f => [f.oos_start, f.oos_end_exclusive]), [
    ["2022-01-01", "2022-04-01"], ["2022-04-01", "2022-07-01"], ["2022-07-01", "2022-10-01"],
  ]);
  assert.equal(plan.derived_engine_calendar.recalibration_frequency, "quarterly");
  assert.equal(plan.derived_engine_calendar.test_months, 3); assert.equal(plan.derived_engine_calendar.step_months, 3);
});
test("programmatic calendar ranges remain complete, disjoint and cutoff-causal across leap years", () => {
  for (const year of [2020, 2021, 2024]) for (const months of [13, 18, 24, 36]) for (const window of ["ROLLING", "EXPANDING"] as const) for (const frequency of ["MONTHLY", "QUARTERLY"] as const) {
    const request = { ...base, evaluation_start: `${year}-01-01`, evaluation_end_exclusive: `${year + 1}-01-01`, training_window_months: months, window_type: window, rebalance_frequency: frequency };
    const plan = temporal(request);
    assert.equal(plan.number_of_folds, frequency === "MONTHLY" ? 12 : 4);
    for (const [i, fold] of plan.folds.entries()) {
      assert.equal(fold.training_end_exclusive, fold.oos_start); assert.ok(fold.information_cutoff < fold.oos_start);
      if (i) assert.equal(plan.folds[i - 1].oos_end_exclusive, fold.oos_start);
      if (window === "EXPANDING") assert.equal(fold.training_start, plan.first_training_date);
    }
  }
});
test("all unsupported/ambiguous request fields and invalid calendars fail closed", () => {
  const invalid: unknown[] = [
    {}, { ...base, evaluation_start: undefined }, { ...base, evaluation_start: "2022-01-02" }, { ...base, evaluation_start: "2022-13-01" },
    { ...base, evaluation_end_exclusive: base.evaluation_start }, { ...base, rebalance_frequency: "YEARLY" },
    { ...base, training_window_months: 0 }, { ...base, training_window_months: -1 }, { ...base, training_window_months: 1.5 },
    { ...base, transaction_cost_bps: NaN }, { ...base, selection_cost_bps: Infinity }, { ...base, transaction_cost_bps: -1 },
    { ...base, test_months: 12 }, { ...base, step_months: 3 }, { ...base, recalibration_frequency: "yearly" },
    { ...base, universe: "QQQ" }, { ...base, output_path: "/tmp/escape" }, { ...base, contract_version: "V1" },
  ];
  for (const value of invalid) assert.throws(() => parseSubmissionV2(value), CalendarContractError);
  const shortTraining = planCalendarV2({ ...base, training_window_months: 1 }, dataset);
  assert.equal(shortTraining.derived_engine_calendar.train_months, 1, "Indicator warmup must not silently enlarge or restrict stateless model training");
  const sparseTraining = { ...dataset, rows: dataset.rows.filter(row => row.date < "2020-01-01" || row.date >= "2022-01-01") };
  assert.throws(() => planCalendarV2(base, sparseTraining), (error: unknown) => error instanceof CalendarContractError && error.code === "INSUFFICIENT_TRAINING_HISTORY");
  assert.throws(() => planCalendarV2({ ...base, evaluation_end_exclusive: "2028-01-01" }, dataset), /last complete observed/);
  assert.throws(() => planCalendarV2({ ...base, evaluation_start: "0000-01-01", evaluation_end_exclusive: "0001-01-01" }, dataset), (error: unknown) => error instanceof CalendarContractError && error.code === "INSUFFICIENT_TRAINING_HISTORY");
  assert.throws(() => planCalendarV2({ ...base, rebalance_frequency: "QUARTERLY" }, dataset), /complete rebalance/);
  assert.throws(() => planCalendarV2(example, dataset), (error: unknown) => error instanceof CalendarContractError && error.code === "INSUFFICIENT_MODEL_WARMUP_HISTORY");
});
test("costs are independent finite numbers; every economic field alters V2 identity", () => {
  const a = normalizedSpecV2(base, dataset), id = runIdV2(a);
  const changes = [{ transaction_cost_bps: 7.25 }, { selection_cost_bps: 0 }, { training_window_months: 18 }, { window_type: "EXPANDING" }, { evaluation_start: "2022-02-01" }, { evaluation_end_exclusive: "2022-04-01" }, { rebalance_frequency: "QUARTERLY", evaluation_end_exclusive: "2022-04-01" }];
  for (const change of changes) assert.notEqual(runIdV2(normalizedSpecV2({ ...base, ...change }, dataset)), id);
  assert.equal(runIdV2(a), runIdV2(normalizedSpecV2(Object.fromEntries(Object.entries(base).reverse()), dataset)));
  assert.equal(runIdV2({ ...a, created_at: "display only" } as any), id);
  assert.notEqual(runIdV2({ ...a, code_version: "changed" }), id);
  assert.notEqual(runIdV2({ ...a, data_snapshot: { ...a.data_snapshot, sha256: "changed" } }), id);
});
test("capabilities derive data/calendar bounds and advertise the V1 compatibility boundary", () => {
  const c = capabilitiesV2(dataset);
  assert.equal(c.data_first_observation, dataset.rows[0].date); assert.equal(c.data_last_observation, dataset.rows.at(-1)!.date);
  assert.deepEqual(c.transaction_cost_rules.fields, ["transaction_cost_bps", "selection_cost_bps"]);
  assert.equal(c.timing_semantics.step_source, "REBALANCE_FREQUENCY"); assert.equal(c.compatibility.legacy_api, "/api/workbench/v1");
});

async function request(baseUrl: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/workbench${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer b3a-injected-test-token", ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
async function terminal(baseUrl: string, runId: string) {
  const end = Date.now() + 150000;
  while (Date.now() < end) {
    const res = await request(baseUrl, `/runs/${runId}`);
    assert.equal(res.status, 200);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(res.body.latest_status)) return res.body;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Empirical acceptance timed out");
}
test("API plan is authenticated, creates no store and rejects V1 without executing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workbench-plan-v2-"));
  const oldRoot = process.env.WORKBENCH_RUN_DIR, oldToken = process.env.WORKBENCH_PREVIEW_TOKEN;
  process.env.WORKBENCH_RUN_DIR = join(root, "uncreated-store"); process.env.WORKBENCH_PREVIEW_TOKEN = "b3a-injected-test-token";
  const server = apiApp.listen(0); await once(server, "listening");
  const port = (server.address() as any).port; const url = `http://127.0.0.1:${port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldRoot === undefined) delete process.env.WORKBENCH_RUN_DIR; else process.env.WORKBENCH_RUN_DIR = oldRoot;
    if (oldToken === undefined) delete process.env.WORKBENCH_PREVIEW_TOKEN; else process.env.WORKBENCH_PREVIEW_TOKEN = oldToken;
    await rm(root, { recursive: true, force: true }); });
  assert.equal((await fetch(`${url}/api/workbench/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) })).status, 401);
  const plan = await request(url, "/plan", base); assert.equal(plan.status, 200); assert.equal(plan.body.number_of_folds, 2);
  assert.equal((await readdir(root)).length, 0, "planning must not create storage or execute backtests");
  assert.equal((await request(url, "/runs", { research_mode: "CAPITAL_MARKET_EXPOSURE", execution_scope: "EMPIRICAL", universe: "SPY", validation_protocol: "TRADITIONAL_WALK_FORWARD", transaction_cost_bps: 0 })).status, 400);
});

test("empirical V2 matrix: five designs, exact plans, immutable deterministic reruns and PIT evidence", {
  skip: process.env.WORKBENCH_B3A_ACCEPTANCE !== "1", timeout: 20 * 60000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workbench-b3a-empirical-"));
  const oldRoot = process.env.WORKBENCH_RUN_DIR, oldToken = process.env.WORKBENCH_PREVIEW_TOKEN;
  process.env.WORKBENCH_RUN_DIR = root; process.env.WORKBENCH_PREVIEW_TOKEN = "b3a-injected-test-token";
  const server = apiApp.listen(0); await once(server, "listening"); const url = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldRoot === undefined) delete process.env.WORKBENCH_RUN_DIR; else process.env.WORKBENCH_RUN_DIR = oldRoot;
    if (oldToken === undefined) delete process.env.WORKBENCH_PREVIEW_TOKEN; else process.env.WORKBENCH_PREVIEW_TOKEN = oldToken;
    await rm(root, { recursive: true, force: true }); });
  const matrix = [
    { label: "A_ROLLING_MONTHLY_24", spec: base },
    { label: "B_ROLLING_MONTHLY_18", spec: { ...base, training_window_months: 18 } },
    { label: "C_EXPANDING_MONTHLY", spec: { ...base, window_type: "EXPANDING" as const } },
    { label: "D_ROLLING_QUARTERLY", spec: { ...base, rebalance_frequency: "QUARTERLY" as const, evaluation_end_exclusive: "2022-07-01" } },
    { label: "E_SAME_CALENDAR_COST_7_25", spec: { ...base, transaction_cost_bps: 7.25 } },
  ];
  const evidence: any[] = [];
  for (const item of matrix) {
    const planned = await request(url, "/plan", item.spec); assert.equal(planned.status, 200);
    const started = await request(url, "/runs", item.spec); assert.equal(started.status, 202);
    const a = await terminal(url, started.body.run_id);
    assert.equal(a.latest_status, "SUCCESS", JSON.stringify(a.latest_result));
    const result = a.latest_result;
    assert.notEqual(result.time_series.artifact, "NOT_SUPPORTED");
    assert.notEqual(result.weights_or_positions.artifact, "NOT_SUPPORTED");
    assert.notEqual(result.trades_or_rebalances.artifact, "NOT_SUPPORTED");
    assert.deepEqual(result.validation_diagnostics.exact_fold_plan, planned.body.folds);
    assert.equal(result.execution.whole_campaign_reused_jobs, 0);
    assert.equal(result.costs.selection_cost_bps, 2.5); assert.equal(result.costs.transaction_cost_bps, item.spec.transaction_cost_bps);
    assert.equal(result.validation_diagnostics.selected_jobs.length, planned.body.number_of_folds);
    for (const job of result.validation_diagnostics.selected_jobs) {
      const f = planned.body.folds[job.outer_fold]; assert.equal(job.targets.length, 1);
      for (const target of job.targets) { assert.ok(target.fit_information_cutoff < f.oos_start); assert.ok(target.information_cutoff < target.signalDate); }
    }
    const reused = await request(url, "/runs", item.spec); assert.equal(reused.status, 200); assert.equal(reused.body.execution_requested, false);
    const rerun = await request(url, `/runs/${started.body.run_id}/rerun`, {}); assert.equal(rerun.status, 202);
    assert.equal(rerun.body.run_id, started.body.run_id); assert.notEqual(rerun.body.execution_attempt_id, started.body.execution_attempt_id);
    const b = await terminal(url, started.body.run_id); assert.equal(b.latest_status, "SUCCESS", JSON.stringify(b.latest_result));
    assert.equal(b.latest_result.financial_result_hash, result.financial_result_hash); assert.deepEqual(b.latest_result.metrics, result.metrics);
    assert.deepEqual(b.latest_result.time_series.points, result.time_series.points);
    assert.equal(b.latest_result.time_series.selected_rows_sha256, result.time_series.selected_rows_sha256);
    assert.notEqual(b.latest_result.time_series.artifact, result.time_series.artifact, "Immutable attempts must have different artifact references");
    assert.equal(b.attempt_history.length, 2);
    evidence.push({ case: item.label, request: item.spec, run_id: started.body.run_id, execution_attempt_id: started.body.execution_attempt_id,
      rerun_attempt_id: rerun.body.execution_attempt_id, status: a.latest_status, number_of_folds: planned.body.number_of_folds,
      folds: planned.body.folds, metrics: result.metrics, costs: result.costs, financial_result_hash: result.financial_result_hash,
      rerun_reproduces: true, fresh_jobs: result.execution.whole_campaign_new_jobs, reused_jobs: 0, exact_plan_matches_execution: true, pit_target_checks: "PASS" });
  }
  assert.equal(new Set(evidence.map(item => item.run_id)).size, matrix.length);
  const compare = await request(url, `/compare?leftRunId=${evidence[0].run_id}&rightRunId=${evidence[4].run_id}`);
  assert.equal(compare.status, 200); assert.deepEqual(compare.body.financial_input_differences.map((item: any) => item.path), ["/transaction_cost_bps"]);
  assert.ok(evidence[4].costs.realized_transaction_cost > 0);
  await writeFile("/tmp/workbench-b3a-acceptance.json", JSON.stringify({ status: "PASS", matrix: evidence, comparison: compare.body }, null, 2) + "\n");
});
