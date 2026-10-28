import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const root = await mkdtemp("/tmp/product-reset-performance-"),
  probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const token = randomBytes(32).toString("hex");
const server = spawn(
  process.execPath,
  ["artifacts/api-server/dist/index.mjs"],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      LOG_LEVEL: "silent",
      WORKBENCH_PREVIEW_TOKEN: token,
      WORKBENCH_RUN_DIR: root,
      DATABASE_URL: "postgresql://agent@127.0.0.1:55432/allocationlab",
      VALIDATION_JOB_WORKER_DISABLED: "1",
    },
    stdio: "ignore",
  },
);
const req = async (p, body) => {
  const r = await fetch(
    `http://127.0.0.1:${port}/api/workbench/interactive` + p,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  assert.ok(r.ok, "HTTP " + r.status);
  return r.json();
};
async function wait(id) {
  for (let i = 0; i < 1000; i++) {
    const d = await req("/runs/" + id);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(d.latest_status)) {
      assert.equal(d.latest_status, "SUCCESS");
      return d.latest_successful_result;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("bounded wait exceeded");
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      await req("/capabilities");
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const proof = JSON.parse(
      await readFile(
        "reports/workbench01/product-reset-01/interactive-certified-reconciliation.json",
        "utf8",
      ),
    ),
    spec =
      process.env.RESET_PROFILE_24 === "1"
        ? {
            ...proof.matrix.find((x) => x.case === "Five-year monthly").request,
            evaluation_start: "2021-10-01",
            evaluation_end_exclusive: "2026-10-01",
            training_window_months: 24,
          }
        : proof.matrix.find((x) => x.case === "Five-year monthly").request;
  const t = performance.now(),
    receipt = await req("/runs", spec),
    cold = await wait(receipt.run_id),
    coldMs = performance.now() - t;
  const start = performance.now(),
    again = await req("/runs/" + receipt.run_id + "/rerun", {}),
    warm = await wait(receipt.run_id),
    warmMs = performance.now() - start;
  assert.notEqual(receipt.execution_attempt_id, again.execution_attempt_id);
  for (const k of [
    "financial_result_hash",
    "passive_control_hash",
    "matched_beta_control_hash",
    "attribution_hash",
  ])
    assert.equal(cold[k], warm[k]);
  assert.equal(cold.execution_profile.cache.candidate_hits, 0);
  const file = "reports/workbench01/product-reset-01/performance-profile.json",
    profile = JSON.parse(await readFile(file, "utf8"));
  profile[
    process.env.RESET_PROFILE_24 === "1" ? "after_training_24_months" : "after"
  ] = {
    request: spec,
    process_cold: true,
    cold_api_ms: coldMs,
    warm_api_ms: warmMs,
    cold_worker: cold.execution_profile,
    warm_worker: warm.execution_profile,
    same_financial_hashes: true,
    explicit_new_attempt: true,
    financial_observations: cold.metrics.observations,
    financial_index: cold.metrics.final_research_index,
    storage:
      "Two compact financial payloads per run/attempt plus small immutable lifecycle records, no per-candidate engine files",
    targets: {
      cold_under_10_seconds: coldMs < 10000,
      warm_under_3_seconds: warmMs < 3000,
    },
    run_id: receipt.run_id,
  };
  await writeFile(file, JSON.stringify(profile, null, 2) + "\n");
  console.log(
    JSON.stringify({
      cold_api_ms: coldMs,
      warm_api_ms: warmMs,
      cache: warm.execution_profile.cache,
      targets:
        profile[
          process.env.RESET_PROFILE_24 === "1"
            ? "after_training_24_months"
            : "after"
        ].targets,
    }),
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
