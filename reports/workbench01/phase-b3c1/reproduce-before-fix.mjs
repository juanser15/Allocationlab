// Portable transcription of the exact before-fix production reproduction.
// Run from an isolated checkout of the starting SHA, with its production build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
} from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  "2404632e60f837dc564a64f3029e1abe92324f95",
  "Use the required starting checkpoint for BEFORE-fix reproduction.",
);
execFileSync(
  "git",
  [
    "diff",
    "--exit-code",
    "HEAD",
    "--",
    "artifacts/api-server/src",
    "research/capital",
    "configs/capital-research",
    "reports/cl02/adjusted-closes.csv",
  ],
  { stdio: "ignore" },
);
execFileSync(process.execPath, ["artifacts/api-server/build.mjs"], {
  stdio: "ignore",
});
const root = process.cwd(),
  dir = await mkdtemp("/tmp/allocationlab-b3c1-before-"),
  observer = join(dir, "observer.jsonl"),
  token = randomBytes(32).toString("hex");
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
let logs = "";
const server = spawn(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), "before-fix-observer.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      WORKBENCH_PREVIEW_TOKEN: token,
      WORKBENCH_RUN_DIR: join(dir, "runs"),
      PORT: String(port),
      DATABASE_URL: "postgresql://agent@127.0.0.1:55432/allocationlab",
      VALIDATION_JOB_WORKER_DISABLED: "1",
      B3C1_OBSERVER_FILE: observer,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (c) => {
    if (Buffer.byteLength(logs) < 1048576) logs += c;
  });
const base = `http://127.0.0.1:${port}/api/workbench`;
const req = async (path, body) => {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { http_status: r.status, body: await r.json() };
};
const spec = {
  contract_version: "workbench-research-run-spec-2.0.0",
  research_mode: "CAPITAL_MARKET_EXPOSURE",
  execution_scope: "EMPIRICAL",
  universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD",
  evaluation_start: "2019-10-01",
  evaluation_end_exclusive: "2026-10-01",
  window_type: "ROLLING",
  training_window_months: 1,
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 1,
  selection_cost_bps: 1,
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await req("/capabilities");
      if (r.http_status === 200) break;
    } catch {}
    if (i === 99) throw Error("Server startup failed");
    await new Promise((r) => setTimeout(r, 100));
  }
  const plan = await req("/plan", spec);
  assert.equal(plan.http_status, 200);
  assert.equal(plan.body.number_of_folds, 84);
  const t = performance.now();
  const submit = await req("/runs", spec);
  assert.equal(submit.http_status, 202);
  const states = [];
  let detail;
  for (let i = 0; i < 300; i++) {
    const d = (await req("/runs/" + submit.body.run_id)).body;
    if (states.at(-1) !== d.latest_status) states.push(d.latest_status);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(d.latest_status)) {
      detail = d;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(detail);
  assert.equal(
    detail.latest_status,
    "FAILED",
    "STOP: exact failure not reproduced",
  );
  const elapsed = performance.now() - t;
  const attempt = join(
    dir,
    "runs",
    "runs",
    submit.body.run_id,
    "attempts",
    submit.body.execution_attempt_id,
  );
  const original = JSON.parse(
    await readFile(join(attempt, "diagnostic.json"), "utf8"),
  );
  const events = (await readFile(observer, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const files = [];
  const walk = async (p, rel = "") => {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const r = join(rel, e.name),
        f = join(p, e.name);
      if (e.isDirectory()) await walk(f, r);
      else {
        const b = await readFile(f);
        files.push({
          path: r,
          bytes: b.length,
          sha256: createHash("sha256").update(b).digest("hex"),
        });
      }
    }
  };
  await walk(join(attempt, "engine"));
  const summary = JSON.parse(
    await readFile(join(attempt, "engine/summary.json"), "utf8"),
  );
  const first = summary.selected_by_fold.find((f) => f.status !== "SELECTED");
  const report = {
    status: "FAILURE_REPRODUCED",
    starting_sha: "2404632e60f837dc564a64f3029e1abe92324f95",
    production_build: true,
    observation_method:
      "Actual production server and fixed worker; passive parent-process fork event listeners record message/exit without changing inputs, limits, worker code or execution arguments.",
    request: spec,
    normalized_spec: detail.spec,
    plan: plan.body,
    submission: submit,
    status_transitions: states,
    actual_stage_reached:
      "Completed engine campaign; summary INCOMPLETE; V2 adapter completeness guard",
    first_failing_fold: first,
    engine_summary_status: summary.status,
    engine_job_counts: {
      total_backtests: summary.total_backtest_jobs,
      failed: summary.failed_jobs,
      invalid: summary.invalid_jobs,
    },
    internal_error: {
      parent_class: detail.latest_result?.error_class,
      worker_class: events.find((x) => x.event === "worker_error_message")
        ?.error_class,
      internal_exception_class: "Error",
      internal_exception_message: events
        .find((x) => x.event === "worker_error_message")
        ?.diagnostic?.split("\n")[0],
      safe_message: detail.latest_result?.error_message,
    },
    bounded_worker_diagnostic: {
      sha256: createHash("sha256")
        .update(JSON.stringify(original))
        .digest("hex"),
      bytes: Buffer.byteLength(JSON.stringify(original)),
      private_reference:
        detail.latest_result?.provenance?.runtime_diagnostic_reference ??
        "diagnostic.json",
      diagnostic_published: false,
    },
    worker_exit: events.find((x) => x.event === "worker_exit"),
    output_bytes: files.reduce((s, f) => s + f.bytes, 0),
    output_file_count: files.length,
    elapsed_ms: elapsed,
    limits: {
      timeout_ms: 120000,
      max_output_bytes: 64 * 1024 * 1024,
      max_log_bytes: 1024 * 1024,
      max_worker_message_bytes: 1024 * 1024,
    },
    output_manifest: files,
    server_remained_online: (await req("/capabilities")).http_status === 200,
  };
  const reports = join(root, "reports/workbench01/phase-b3c1");
  await mkdir(reports, { recursive: true });
  await writeFile(
    join(reports, "before-fix-reproduction.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "/tmp/allocationlab-b3c1-reproduction-location.json",
    JSON.stringify(
      {
        dir,
        attempt,
        run_id: submit.body.run_id,
        attempt_id: submit.body.execution_attempt_id,
        detail,
        summary,
        events,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: report.status,
      run_id: submit.body.run_id,
      attempt_id: submit.body.execution_attempt_id,
      first_failing_fold: first,
      internal_error: report.internal_error,
      exit: report.worker_exit,
      elapsed_ms: elapsed,
      output_bytes: report.output_bytes,
      output_files: files.length,
    }),
  );
} finally {
  await writeFile(join(dir, "server.log"), logs, { mode: 0o600 });
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
