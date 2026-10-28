import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  reference,
  readPriorControls,
  executePriorReference,
  originalCampaignReference,
} from "../dist/product-reset-reference.mjs";
const report = "reports/workbench01/product-reset-01";
await mkdir(report, { recursive: true });
const save = (name, x) =>
  writeFile(join(report, name), JSON.stringify(x, null, 2) + "\n");
const root = await mkdtemp("/tmp/product-reset-acceptance-"),
  token = randomBytes(32).toString("hex"),
  probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const server = spawn(
  process.execPath,
  ["artifacts/api-server/dist/index.mjs"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://agent@127.0.0.1:55432/allocationlab",
      VALIDATION_JOB_WORKER_DISABLED: "1",
      WORKBENCH_PREVIEW_TOKEN: token,
      WORKBENCH_RUN_DIR: join(root, "store"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
const base = `http://127.0.0.1:${port}/api/workbench/interactive`;
async function req(p, body, auth = true) {
  const r = await fetch(base + p, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(auth ? { Authorization: "Bearer " + token } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const fields = {
  contract_version: "allocationlab-interactive-spec-3.0.0",
  research_mode: "CAPITAL_MARKET_EXPOSURE",
  execution_scope: "EMPIRICAL",
  universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD",
  evaluation_start: "2022-01-01",
  evaluation_end_exclusive: "2023-01-01",
  window_type: "ROLLING",
  training_window_months: 6,
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 1,
  selection_cost_bps: 1,
  turnover_constraint_methodology_version:
    "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2",
};
const financial = (r) =>
  Object.fromEntries(
    [
      "financial_result_hash",
      "passive_control_hash",
      "matched_beta_control_hash",
      "attribution_hash",
    ].map((k) => [k, r[k]]),
  );
async function wait(id) {
  const progress = [];
  let d;
  for (let i = 0; i < 1000; i++) {
    const x = await req("/runs/" + id);
    assert.equal(x.status, 200);
    d = x.body;
    if (d.progress) progress.push(d.progress);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(d.latest_status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(d.latest_status, "SUCCESS", JSON.stringify(d.latest_result));
  assert.equal(progress.at(-1).percent_complete, 100);
  for (let i = 1; i < progress.length; i++) {
    assert.ok(
      progress[i].completed_work_units >= progress[i - 1].completed_work_units,
    );
    assert.ok(progress[i].percent_complete >= progress[i - 1].percent_complete);
    assert.ok(
      progress[i].estimated_remaining_ms === null ||
        progress[i].estimated_remaining_ms >= 0,
    );
  }
  return { detail: d, progress };
}
const matrix = [],
  results = [],
  benchmarks = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await req("/capabilities", undefined, false)).status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await req("/capabilities", undefined, false)).status, 401);
  const caps = (await req("/capabilities")).body;
  await save("capabilities.json", caps);
  const bad = [
    {},
    { ...fields, training_window_months: 0 },
    { ...fields, transaction_cost_bps: -1 },
    { ...fields, test_months: 12 },
    { ...fields, evaluation_start: "2025-02-30" },
    { ...fields, evaluation_end_exclusive: "2027-01-01" },
    { ...fields, universe: "QQQ" },
    { ...fields, output_path: "/tmp/elsewhere" },
  ];
  for (const v of bad) {
    const r = await req("/runs", v);
    assert.ok([400, 422].includes(r.status), JSON.stringify(r));
  }
  assert.equal((await req("/runs")).body.runs.length, 0);
  const cases = [
    { name: "Rolling monthly", spec: fields },
    {
      name: "Expanding monthly",
      spec: { ...fields, window_type: "EXPANDING" },
    },
    {
      name: "Rolling quarterly",
      spec: { ...fields, rebalance_frequency: "QUARTERLY" },
    },
    {
      name: "Arbitrary nonzero costs",
      spec: {
        ...fields,
        transaction_cost_bps: 7.375,
        selection_cost_bps: 7.375,
      },
    },
    {
      name: "Short training",
      spec: {
        ...fields,
        training_window_months: 1,
        evaluation_start: "2019-10-01",
        evaluation_end_exclusive: "2020-04-01",
      },
    },
    {
      name: "Five-year monthly",
      spec: {
        ...fields,
        evaluation_start: "2021-01-01",
        evaluation_end_exclusive: "2026-01-01",
      },
    },
    {
      name: "Seven-year short training",
      spec: {
        ...fields,
        evaluation_start: "2019-10-01",
        evaluation_end_exclusive: "2026-10-01",
        training_window_months: 1,
      },
    },
    {
      name: "Custom trading-day anchor",
      spec: {
        ...fields,
        evaluation_start: "2025-03-17",
        evaluation_end_exclusive: "2025-09-17",
      },
    },
    {
      name: "Weekend anchor",
      spec: {
        ...fields,
        evaluation_start: "2025-03-22",
        evaluation_end_exclusive: "2025-09-22",
      },
    },
    {
      name: "Declared unsupported matched-beta cost",
      spec: {
        ...fields,
        evaluation_start: "2019-10-01",
        evaluation_end_exclusive: "2019-11-01",
        training_window_months: 1,
        transaction_cost_bps: 10000,
        selection_cost_bps: 10000,
      },
    },
    {
      name: "Holiday quarterly anchor",
      spec: {
        ...fields,
        evaluation_start: "2025-01-20",
        evaluation_end_exclusive: "2026-01-20",
        rebalance_frequency: "QUARTERLY",
      },
    },
  ];
  for (const c of cases) {
    const plan = await req("/plan", c.spec);
    assert.equal(plan.status, 200, JSON.stringify(plan));
    const start = performance.now(),
      receipt = await req("/runs", c.spec);
    assert.equal(receipt.status, 202);
    const running = await req("/runs", c.spec);
    assert.equal(
      running.body.execution_attempt_id,
      receipt.body.execution_attempt_id,
    );
    const first = await wait(receipt.body.run_id),
      elapsed = performance.now() - start,
      r = first.detail.latest_successful_result;
    assert.equal(r.plan.plan_hash, plan.body.plan_hash);
    assert.deepEqual(r.plan.folds, plan.body.folds);
    for (const p of r.selected_policy_by_fold) {
      for (const t of p.targets) assert.ok(t.information_cutoff < t.signalDate);
      assert.ok(p.training_end_exclusive <= p.decision_date);
    }
    if (c.name === "Declared unsupported matched-beta cost") {
      assert.equal(r.benchmark_metrics.STATIC_MATCHED_BETA, "NOT_SUPPORTED");
      assert.equal(r.turnover.STATIC_MATCHED_BETA, "NOT_SUPPORTED");
      assert.ok(r.metrics.realized_simulated_cost > 0);
    }
    const ref = reference(c.spec, join(root, "reference-" + matrix.length));
    assert.deepEqual(financial(ref.result), financial(r));
    assert.deepEqual(ref.result.benchmark_tracks, r.benchmark_tracks);
    assert.deepEqual(ref.result.metrics, r.metrics);
    assert.deepEqual(
      ref.result.selected_policy_by_fold,
      r.selected_policy_by_fold,
    );
    const oldResult = await readFile(
      join(
        root,
        "store/runs",
        r.run_id,
        "attempts",
        r.execution_attempt_id,
        "result.json",
      ),
    );
    const t = performance.now(),
      rerun = await req("/runs/" + r.run_id + "/rerun", {});
    assert.equal(rerun.status, 202);
    assert.equal(rerun.body.run_id, r.run_id);
    assert.notEqual(rerun.body.execution_attempt_id, r.execution_attempt_id);
    const again = await wait(r.run_id);
    const warmElapsed = performance.now() - t;
    assert.deepEqual(
      financial(again.detail.latest_successful_result),
      financial(r),
    );
    assert.deepEqual(
      again.detail.latest_successful_result.benchmark_tracks,
      r.benchmark_tracks,
    );
    assert.deepEqual(
      oldResult,
      await readFile(
        join(
          root,
          "store/runs",
          r.run_id,
          "attempts",
          r.execution_attempt_id,
          "result.json",
        ),
      ),
    );
    const idempotent = await req("/runs", c.spec);
    assert.equal(idempotent.status, 200);
    assert.equal(idempotent.body.reused_existing_attempt, true);
    const evidence = {
      case: c.name,
      status: "PASS",
      request: c.spec,
      run_id: r.run_id,
      execution_attempt_id: r.execution_attempt_id,
      rerun_attempt_id: rerun.body.execution_attempt_id,
      fold_count: plan.body.number_of_folds,
      plan_hash: plan.body.plan_hash,
      financial_hashes: financial(r),
      metrics: r.metrics,
      all_tracks_exact: true,
      reference: {
        cache_disabled: true,
        materialized_jobs: ref.materialized_jobs,
        ledger_arithmetic:
          "BYTE_IDENTICAL_CERTIFIED_CLOSE_FILL_BODY_WITH_EXPLICIT_SCHEDULE",
      },
      progress_monotonic: true,
      progress_reaches_100: true,
      eta_nonnegative: true,
      first_progress: first.progress,
      rerun_progress: again.progress,
      cold_api_ms: elapsed,
      warm_api_ms: warmElapsed,
      worker_profile: r.execution_profile,
      warm_profile: again.detail.latest_successful_result.execution_profile,
    };
    matrix.push(evidence);
    results.push(r);
    benchmarks.push({
      case: c.name,
      cold_api_ms: elapsed,
      warm_api_ms: warmElapsed,
      worker_profile: r.execution_profile,
      warm_profile: again.detail.latest_successful_result.execution_profile,
    });
    console.log(
      "PASS",
      c.name,
      Math.round(elapsed) + "ms",
      Math.round(warmElapsed) + "ms",
    );
  }
  const before = (await req("/runs")).body,
    comparison = await req("/compare", {
      run_ids: results.slice(0, 4).map((r) => r.run_id),
    });
  assert.equal(comparison.status, 200);
  assert.equal(comparison.body.runs.length, 4);
  assert.equal(comparison.body.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.deepEqual((await req("/runs")).body, before);
  await save("comparison-evidence.json", comparison.body);
  // Compare regular month-start schedules to the original, unmodified recurring
  // certification campaign actually executed for the five-year before profile.
  const old =
      process.env.PRODUCT_RESET_REUSE_PHASE_EVIDENCE === "1"
        ? JSON.parse(
            await readFile("/tmp/product-reset-before-profile.json", "utf8"),
          )
        : originalCampaignReference(
            cases.find((x) => x.name === "Five-year monthly").spec,
            join(root, "original-certified-campaign"),
          ),
    current = results.find(
      (r) =>
        r.plan.normalized_request.evaluation_start ===
        old.request.evaluation_start,
    );
  const oldMetrics = old.result.summary.outer_oos[0];
  assert.equal(current.metrics.final_research_index, oldMetrics.final_index);
  assert.equal(current.metrics.cagr, oldMetrics.cagr);
  assert.equal(current.metrics.net_sharpe, oldMetrics.net_sharpe);
  assert.equal(current.metrics.realized_simulated_cost, oldMetrics.costs);
  const actual = [];
  for (const selection of old.result.summary.selected_by_fold) {
    const file = join(
      old.root,
      "jobs",
      selection.candidate_id,
      "outer-" + selection.outer_fold,
      "inner-outer",
      "scenario-1.json",
    );
    const job = JSON.parse(await readFile(file, "utf8")).result;
    actual.push(...job.observations);
    assert.equal(
      current.selected_policy_by_fold[selection.outer_fold].candidate_id,
      selection.candidate_id,
    );
  }
  assert.equal(actual.length, current.benchmark_tracks.DYNAMIC_EXPOSURE.length);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(
      actual[i].date,
      current.benchmark_tracks.DYNAMIC_EXPOSURE[i].date,
    );
    assert.equal(
      actual[i].net_return,
      current.benchmark_tracks.DYNAMIC_EXPOSURE[i].net_return,
    );
    assert.equal(
      actual[i].exposure,
      current.benchmark_tracks.DYNAMIC_EXPOSURE[i].spy_exposure,
    );
  }
  const priorLocation =
    process.env.PRODUCT_RESET_REUSE_PHASE_EVIDENCE === "1"
      ? JSON.parse(
          await readFile(
            "/tmp/allocationlab-b3c2-acceptance-location.json",
            "utf8",
          ),
        )
      : null;
  const committedPrior = JSON.parse(
      await readFile(
        "reports/workbench01/phase-b3c2/acceptance-matrix.json",
        "utf8",
      ),
    ),
    priorReconciliation = [],
    preserved = {
      prior_recurring_methodology_successes: committedPrior.matrix.filter(
        (x) => x.spec && x.run_id,
      ),
    };
  for (const oldCase of preserved.prior_recurring_methodology_successes) {
    const old = priorLocation
        ? await readPriorControls(priorLocation.root, oldCase.run_id)
        : await executePriorReference(
            oldCase.spec,
            join(root, "prior-" + oldCase.case),
          ),
      prior = old.latest_successful_result;
    assert.equal(old.run_id, oldCase.run_id);
    for (const k of [
      "financial_result_hash",
      "passive_control_hash",
      "matched_beta_control_hash",
      "attribution_hash",
    ])
      assert.equal(prior[k], oldCase.hashes[k]);
    const spec = { ...oldCase.spec, contract_version: fields.contract_version },
      receipt = await req("/runs", spec);
    assert.ok([200, 202].includes(receipt.status));
    const current = (await wait(receipt.body.run_id)).detail
      .latest_successful_result;
    for (const k of [
      "cagr",
      "net_sharpe",
      "max_drawdown",
      "observations",
      "final_research_index",
    ])
      assert.equal(current.metrics[k], prior.metrics[k]);
    assert.equal(
      current.metrics.realized_simulated_cost,
      prior.costs.realized_transaction_cost,
    );
    for (const k of ["DYNAMIC_EXPOSURE", "PASSIVE_SPY", "STATIC_MATCHED_BETA"])
      assert.deepEqual(
        current.benchmark_tracks[k],
        prior.benchmark_tracks[k].points,
      );
    assert.deepEqual(current.benchmark_metrics, prior.benchmark_metrics);
    priorReconciliation.push({
      case: oldCase.case,
      prior_run_id: oldCase.run_id,
      new_run_id: current.run_id,
      all_three_tracks_and_certified_risk_metrics_exact: true,
      distinct_versioned_identity: true,
    });
    console.log("PASS cross-contract", oldCase.case);
  }
  await save("interactive-certified-reconciliation.json", {
    status: "PASS",
    tolerance: 0,
    phase_evidence_reused:
      process.env.PRODUCT_RESET_REUSE_PHASE_EVIDENCE === "1",
    prior_recurring_cross_contract: priorReconciliation,
    old_engine_five_year: {
      observations: actual.length,
      all_daily_returns_and_exposures_exact: true,
      all_selected_candidate_ids_exact: true,
      metrics_exact: true,
      original_engine_version: "capital-research-recurring-turnover-2.0.0",
    },
    matrix,
    economic_claim: "NONE",
  });
  await save("performance-benchmarks.json", {
    status: "MEASURED",
    targets: { cold_ms: 10000, warm_ms: 3000 },
    cases: benchmarks,
    scope:
      "Actual production API; includes immutable compact result publication and polling. Later uncached references do not affect the earlier cold measurement.",
  });
  await writeFile(
    "/tmp/product-reset-acceptance-location.json",
    JSON.stringify({ root }),
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
  await writeFile(join(root, "server.log"), logs);
}
