import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";

const reportDir = "reports/workbench01/phase-b3c1";
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const save = (name: string, v: unknown) =>
  writeFile(join(reportDir, name), JSON.stringify(v, null, 2) + "\n");
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
async function start(root: string) {
  const token = randomBytes(32).toString("hex");
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as any).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const child = spawn(
    process.execPath,
    ["artifacts/api-server/dist/index.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        PORT: String(port),
        WORKBENCH_RUN_DIR: root,
        WORKBENCH_PREVIEW_TOKEN: token,
        VALIDATION_JOB_WORKER_DISABLED: "1",
        DATABASE_URL: "postgresql://agent@127.0.0.1:55432/allocationlab",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b: Buffer) => {
      if (Buffer.byteLength(logs) < 1048576) logs += b.toString();
    });
  const request = async (
    path: string,
    body?: unknown,
    authenticated = true,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/workbench${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("/capabilities")).status === 200) break;
    } catch {}
    if (i === 99) throw new Error("Production server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    request,
    close: async () => {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await writeFile(join(root, "acceptance-server.log"), logs, {
        mode: 0o600,
      });
    },
  };
}
test(
  "B3C.1 exact production pre-run block, short-history matrix, immutable private failures and prior financial regression",
  { skip: process.env.WORKBENCH_B3C1_ACCEPTANCE !== "1", timeout: 25 * 60000 },
  async () => {
    const before = await read(join(reportDir, "before-fix-reproduction.json"));
    const work = await mkdtemp("/tmp/allocationlab-b3c1-acceptance-");
    const api = await start(work),
      req = api.request;
    const evidence: any[] = [];
    const terminal = async (runId: string) => {
      const deadline = Date.now() + 145000;
      while (Date.now() < deadline) {
        const r = await req(`/runs/${runId}`);
        assert.equal(r.status, 200);
        if (["FAILED", "BLOCKED", "SUCCESS"].includes(r.body.latest_status))
          return r.body;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("Bounded empirical polling deadline reached");
    };
    try {
      assert.equal((await req("/capabilities", undefined, false)).status, 401);
      const initial = await req("/runs");
      const plan = await req("/plan", before.request),
        repeat = await req("/plan", before.request),
        submitted = await req("/runs", before.request);
      for (const x of [plan, repeat, submitted]) {
        assert.equal(x.status, 422);
        assert.equal(x.body.error.code, "NO_VALID_CANDIDATE");
        assert.equal(x.body.error.issues.failed_fold_id, 0);
        assert.equal(x.body.error.issues.number_of_folds, 84);
      }
      assert.deepEqual(repeat.body, plan.body);
      assert.deepEqual((await req("/runs")).body, initial.body);
      await save("exact-84-fold-acceptance.json", {
        status: "PASS",
        outcome: "PRE_RUN_BLOCKED",
        exact_request: before.request,
        requested_fold_count: 84,
        plan_http_status: plan.status,
        submit_http_status: submitted.status,
        blocker: plan.body.error,
        deterministic_repeat: true,
        no_execution_attempt_created: true,
        no_financial_engine_executed: true,
        dates_and_training_unchanged: true,
      });
      const full = [1, 2, 3, 6, 12].map((m) => ({
        name: `FULL_84_ROLLING_MONTHLY_${m}`,
        request: { ...before.request, training_window_months: m },
      }));
      full.push({
        name: "FULL_84_EXPANDING_MONTHLY_1",
        request: { ...before.request, window_type: "EXPANDING" },
      });
      for (const item of full) {
        const p = await req("/plan", item.request),
          again = await req("/plan", item.request),
          s = await req("/runs", item.request);
        assert.equal(p.status, 422 === p.status ? 422 : 400);
        assert.equal(s.status, p.status);
        assert.deepEqual(again.body, p.body);
        assert.ok(
          [
            "NO_VALID_CANDIDATE",
            "OUTPUT_OR_LOG_LIMIT",
            "INSUFFICIENT_MODEL_WARMUP_HISTORY",
            "RESEARCH_RESOURCE_LIMIT",
          ].includes(p.body.error.code),
          JSON.stringify({ name: item.name, response: p.body }),
        );
        evidence.push({
          ...item,
          requested_fold_count: 84,
          plan_status: "BLOCKED",
          execution_status: "NOT_STARTED",
          blocker: p.body.error,
          reproducibility: "IDENTICAL_REPEATED_PREFLIGHT",
          no_attempt_created: true,
        });
      }
      const withinBudget = [2, 3, 6, 12].map((m) => ({
        name: `ROLLING_MONTHLY_${m}_MANY_FOLDS`,
        request: {
          ...before.request,
          evaluation_start: "2022-01-01",
          evaluation_end_exclusive: "2023-01-01",
          training_window_months: m,
        },
      }));
      withinBudget.push({
        name: "EXPANDING_MONTHLY_INITIAL_1_MANY_FOLDS",
        request: {
          ...before.request,
          evaluation_start: "2020-05-01",
          evaluation_end_exclusive: "2021-05-01",
          window_type: "EXPANDING",
        },
      });
      withinBudget.push({
        name: "ROLLING_QUARTERLY_SHORT_VALID",
        request: {
          ...before.request,
          evaluation_start: "2020-04-01",
          evaluation_end_exclusive: "2026-10-01",
          training_window_months: 3,
          rebalance_frequency: "QUARTERLY",
        },
      });
      withinBudget.push({
        name: "ROLLING_MONTHLY_VALID_ONE_MONTH",
        request: {
          ...before.request,
          evaluation_start: "2020-05-01",
          evaluation_end_exclusive: "2020-06-01",
        },
      });
      for (const item of withinBudget) {
        const p = await req("/plan", item.request);
        assert.equal(p.status, 200, JSON.stringify(p.body));
        assert.equal(p.body.preflight.candidate_viability_guaranteed, false);
        const receipt = await req("/runs", item.request);
        assert.equal(receipt.status, 202);
        const detail = await terminal(receipt.body.run_id);
        assert.equal(
          detail.latest_status,
          "SUCCESS",
          JSON.stringify(detail.latest_attempt),
        );
        const r = detail.latest_successful_result;
        assert.deepEqual(
          r.validation_diagnostics.exact_fold_plan,
          p.body.folds,
        );
        const rerun = await req(`/runs/${receipt.body.run_id}/rerun`, {});
        assert.equal(rerun.status, 202);
        const repeated = await terminal(receipt.body.run_id);
        assert.equal(
          repeated.latest_status,
          "SUCCESS",
          JSON.stringify(repeated.latest_attempt),
        );
        assert.notEqual(
          rerun.body.execution_attempt_id,
          receipt.body.execution_attempt_id,
        );
        assert.equal(repeated.attempt_history.length, 2);
        for (const key of [
          "financial_result_hash",
          "passive_control_hash",
          "matched_beta_control_hash",
          "attribution_hash",
        ])
          assert.equal(repeated.latest_successful_result[key], r[key], key);
        assert.deepEqual(
          repeated.latest_successful_result.time_series.points,
          r.time_series.points,
        );
        assert.equal(
          repeated.latest_successful_result.time_series.selected_rows_sha256,
          r.time_series.selected_rows_sha256,
        );
        assert.notEqual(
          repeated.latest_successful_result.time_series.artifact,
          r.time_series.artifact,
          "Each immutable attempt has its own evidence reference; financial time-series bytes still reproduce",
        );
        evidence.push({
          ...item,
          plan_status: "PASS",
          execution_status: "SUCCESS",
          fold_count: p.body.number_of_folds,
          first_blocker_or_failure: null,
          run_id: receipt.body.run_id,
          attempt_id: receipt.body.execution_attempt_id,
          rerun_attempt_id: rerun.body.execution_attempt_id,
          metrics: r.metrics,
          hashes: Object.fromEntries(
            [
              "financial_result_hash",
              "passive_control_hash",
              "matched_beta_control_hash",
              "attribution_hash",
            ].map((k) => [k, r[k]]),
          ),
          reproducibility: "ALL_FOUR_HASHES_AND_TIME_SERIES_IDENTICAL",
          actual_file_budget: p.body.preflight,
          no_dates_or_windows_changed: true,
        });
        console.log(
          `PASS B3C.1 empirical ${item.name}: ${p.body.number_of_folds} folds and identical rerun`,
        );
        await save("regression-matrix.json", {
          status: "RUNNING",
          cases: evidence,
        });
      }
      // All unique prior V2 financial specifications. Frozen evidence supplies
      // expected hashes; every value below is recalculated by the actual API.
      const b3a = await read(
        "reports/workbench01/phase-b3a/acceptance-matrix.json",
      );
      const b3b = await read(
        "reports/workbench01/phase-b3b/api-integration.json",
      );
      const b3c = await read(
        "reports/workbench01/phase-b3c/browser-acceptance.json",
      );
      const previous = new Map<string, any>();
      for (const p of b3a.matrix)
        previous.set(p.run_id, {
          request: p.request,
          run_id: p.run_id,
          metrics: p.metrics,
          financial_result_hash: p.financial_result_hash,
          origin: "B3A",
          old: p,
        });
      for (const p of b3b.matrix) {
        const prior = previous.get(p.run_id);
        assert.ok(prior);
        assert.equal(prior.financial_result_hash, p.financial_result_hash);
      }
      for (const p of b3c.matrix)
        previous.set(p.run_id, {
          request: p.request,
          run_id: p.run_id,
          metrics: p.dynamic_metrics,
          financial_result_hash: p.hashes.dynamic,
          hashes: {
            financial_result_hash: p.hashes.dynamic,
            passive_control_hash: p.hashes.passive,
            matched_beta_control_hash: p.hashes.matched_beta,
            attribution_hash: p.hashes.attribution,
          },
          origin: "B3C",
          old: p,
        });
      const priorProof = [];
      for (const p of previous.values()) {
        const receipt = await req("/runs", p.request);
        assert.ok(
          [200, 202].includes(receipt.status),
          JSON.stringify(receipt.body),
        );
        assert.equal(receipt.body.run_id, p.run_id);
        const d = await terminal(p.run_id);
        assert.equal(d.latest_status, "SUCCESS");
        const r = d.latest_successful_result;
        assert.deepEqual(r.metrics, p.metrics);
        assert.equal(r.financial_result_hash, p.financial_result_hash);
        if (p.hashes)
          for (const [key, value] of Object.entries(p.hashes))
            assert.equal(r[key], value, key);
        priorProof.push({
          origin: p.origin,
          run_id: p.run_id,
          request: p.request,
          metrics_exact: true,
          dynamic_hash_exact: true,
          benchmark_and_attribution_hashes_exact: p.hashes
            ? true
            : "NO_PRIOR_BENCHMARK_EXPECTATION",
          financial_result_hash: r.financial_result_hash,
        });
        console.log(
          `PASS prior ${p.origin} financial regression ${p.run_id.slice(0, 15)}`,
        );
      }
      await save("regression-matrix.json", {
        status: "PASS",
        exact_84_fold_request_not_shortened: true,
        cases: evidence,
        prior_unique_v2_cases: priorProof,
        prior_b3b_cases_verified: b3b.matrix.length,
        synthetic_data_used: false,
        economic_claim: "NONE",
      });
    } finally {
      await api.close();
    }
    const locationPath = process.env.B3C1_REPRODUCTION_LOCATION;
    assert.ok(
      locationPath,
      "An actual before-fix production failure must be retained for migration/private-evidence regression",
    );
    const location = await read(locationPath);
    const oldApi = await start(join(location.dir, "runs"));
    const inventory = async (dir: string): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      const walk = async (p: string, rel = "") => {
        for (const e of await readdir(p, { withFileTypes: true })) {
          const path = join(p, e.name),
            name = join(rel, e.name);
          if (e.isDirectory()) await walk(path, name);
          else out[name] = sha(await readFile(path));
        }
      };
      await walk(dir);
      return out;
    };
    try {
      const originalFiles = await inventory(location.attempt);
      const d = await oldApi.request(`/runs/${location.run_id}`);
      assert.equal(d.status, 200);
      assert.equal(d.body.latest_status, "FAILED");
      const safe = d.body.latest_attempt;
      assert.equal(safe.error_class, "NO_VALID_CANDIDATE");
      assert.equal(safe.failed_fold_id, 0);
      assert.equal(safe.failed_decision_date, "2019-10-01");
      assert.equal(safe.failure_diagnostic.candidates.length, 5);
      assert.equal(safe.failure_diagnostic.private_content_exposed, false);
      assert.doesNotMatch(
        JSON.stringify(d.body),
        /\/workspace\/|\/tmp\/|\n\s*at |Dynamic campaign did not complete|CAPITAL_ENGINE_EXECUTION_FAILED/,
      );
      assert.equal(
        (
          await oldApi.request(
            `/runs/${location.run_id}/attempts/${location.attempt_id}/diagnostic.json`,
          )
        ).status,
        404,
      );
      assert.equal(
        (await oldApi.request(`/runs/${location.run_id}`, undefined, false))
          .status,
        401,
      );
      const blocked = await oldApi.request(
        `/runs/${location.run_id}/rerun`,
        {},
      );
      assert.equal(blocked.status, 422);
      assert.equal(blocked.body.error.code, "NO_VALID_CANDIDATE");
      assert.equal(
        (await oldApi.request(`/runs/${location.run_id}`)).body.attempt_history
          .length,
        1,
      );
      const afterFiles = await inventory(location.attempt);
      for (const [name, digest] of Object.entries(originalFiles))
        assert.equal(afterFiles[name], digest, name);
      await save("failure-contract-evidence.json", {
        status: "PASS",
        retained_before_fix_attempt_id: location.attempt_id,
        safe_failure: safe,
        private_diagnostic_still_present: true,
        private_diagnostic_sha256_unchanged:
          originalFiles["diagnostic.json"] === afterFiles["diagnostic.json"],
        original_attempt_files_byte_identical: true,
        original_attempt_files: Object.keys(originalFiles).length,
        new_append_only_files: Object.keys(afterFiles).filter(
          (n) => !Object.hasOwn(originalFiles, n),
        ),
        rerun_blocked_before_new_attempt: true,
        unauthorized_status: 401,
        raw_diagnostic_endpoint_status: 404,
        absolute_paths_and_stacks_exposed: false,
      });
    } finally {
      await oldApi.close();
    }
  },
);
