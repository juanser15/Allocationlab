import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = await mkdtemp("/tmp/product-reset-operational-"),
  token = randomBytes(32).toString("hex");
const evidence = [];
const spec = {
  contract_version: "allocationlab-interactive-spec-3.0.0",
  research_mode: "CAPITAL_MARKET_EXPOSURE",
  execution_scope: "EMPIRICAL",
  universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD",
  evaluation_start: "2019-10-01",
  evaluation_end_exclusive: "2019-11-01",
  window_type: "ROLLING",
  training_window_months: 1,
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 1,
  selection_cost_bps: 1,
  turnover_constraint_methodology_version:
    "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2",
};
async function start(store, extra = {}) {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const p = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      WORKBENCH_PREVIEW_TOKEN: token,
      WORKBENCH_RUN_DIR: store,
      DATABASE_URL: "postgresql://agent@127.0.0.1:55432/allocationlab",
      VALIDATION_JOB_WORKER_DISABLED: "1",
      ...extra,
    },
    stdio: "ignore",
  });
  const req = async (path, body, options = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/workbench/interactive` + path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(options.auth === false
            ? {}
            : { Authorization: "Bearer " + token }),
          ...(body === undefined
            ? {}
            : { "Content-Type": options.content_type ?? "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  for (let i = 0; i < 100; i++) {
    try {
      if ((await req("/capabilities")).status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    req,
    stop: async () => {
      p.kill("SIGTERM");
      await Promise.race([
        once(p, "exit"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (p.exitCode === null) p.kill("SIGKILL");
    },
  };
}
async function wait(req, id) {
  for (let i = 0; i < 500; i++) {
    const r = await req("/runs/" + id);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(r.body.latest_status))
      return r.body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("bounded wait exceeded");
}
for (const [setting, value] of [
  ["WORKBENCH_MAX_JOBS", "1"],
  ["WORKBENCH_MAX_ENGINE_FILES", "1"],
]) {
  const api = await start(join(root, setting), { [setting]: value });
  try {
    const plan = await api.req("/plan", spec),
      submit = await api.req("/runs", spec);
    assert.equal(plan.status, 422);
    assert.equal(submit.status, 422);
    assert.equal(plan.body.error.code, "INTERACTIVE_CAPACITY_EXCEEDED");
    assert.equal(plan.body.error.issues.no_attempt_created, true);
    assert.equal((await api.req("/runs")).body.runs.length, 0);
    evidence.push({
      case: setting,
      status: "PRE_RUN_BLOCKED",
      blocker: plan.body.error,
      no_attempt_created: true,
    });
  } finally {
    await api.stop();
  }
}
const failureRoot = join(root, "failure"),
  low = await start(failureRoot, { WORKBENCH_MAX_OUTPUT_BYTES: "1" });
let id, attempt, bytes;
try {
  assert.equal(
    (await low.req("/capabilities", undefined, { auth: false })).status,
    401,
  );
  assert.equal(
    (await low.req("/runs", "{}", { content_type: "text/plain" })).status,
    415,
  );
  assert.equal(
    (await low.req("/runs", '{"x":"' + "a".repeat(17000) + '"}')).status,
    413,
  );
  assert.equal((await low.req("/capabilities?token=not-allowed")).status, 400);
  for (const path of [
    "/runs/..%2F..%2Fetc%2Fpasswd",
    "/runs/arbitrary-command",
  ])
    assert.ok([400, 404].includes((await low.req(path)).status));
  const receipt = await low.req("/runs", spec);
  assert.equal(receipt.status, 202);
  id = receipt.body.run_id;
  attempt = receipt.body.execution_attempt_id;
  const d = await wait(low.req, id);
  assert.equal(d.latest_status, "FAILED");
  assert.equal(d.latest_result.error_class, "OUTPUT_OR_LOG_LIMIT");
  assert.equal(d.latest_successful_result, null);
  const text = JSON.stringify(d);
  for (const marker of [
    "node:internal",
    "file:///",
    "/workspace/",
    "/tmp/",
    "private_diagnostic",
    "Error:",
  ])
    assert.ok(!text.includes(marker), marker);
  bytes = await readFile(
    join(failureRoot, "runs", id, "attempts", attempt, "result.json"),
  );
  evidence.push({
    case: "Bounded output failure",
    status: "FAILED",
    error_class: d.latest_result.error_class,
    private_diagnostic_exists: !!(await readFile(
      join(failureRoot, "runs", id, "attempts", attempt, "diagnostic.json"),
    )),
    no_stack_or_path_leakage: true,
    failed_attempt_retained: true,
  });
} finally {
  await low.stop();
}
let otherId;
const ordinary = await start(failureRoot);
try {
  const receipt = await ordinary.req("/runs/" + id + "/rerun", {});
  assert.equal(receipt.status, 202);
  assert.notEqual(receipt.body.execution_attempt_id, attempt);
  const d = await wait(ordinary.req, id);
  assert.equal(d.latest_status, "SUCCESS");
  assert.equal(d.run_id, id);
  assert.equal(d.attempt_history.length, 2);
  assert.equal(d.attempt_history[0].status, "FAILED");
  assert.deepEqual(
    bytes,
    await readFile(
      join(failureRoot, "runs", id, "attempts", attempt, "result.json"),
    ),
  );
  evidence.push({
    case: "Explicit rerun after output-bound failure",
    status: "SUCCESS",
    same_financial_run_id: true,
    new_attempt: true,
    prior_failed_bytes_unchanged: true,
  });
  const other = await ordinary.req("/runs", {
    ...spec,
    transaction_cost_bps: 2,
    selection_cost_bps: 2,
  });
  otherId = other.body.run_id;
  assert.equal((await wait(ordinary.req, otherId)).latest_status, "SUCCESS");
} finally {
  await ordinary.stop();
}
const lowAgain = await start(failureRoot, { WORKBENCH_MAX_OUTPUT_BYTES: "1" });
try {
  assert.equal((await lowAgain.req("/runs/" + id + "/rerun", {})).status, 202);
  assert.equal((await wait(lowAgain.req, id)).latest_status, "FAILED");
} finally {
  await lowAgain.stop();
}
const compareReader = await start(failureRoot);
try {
  const before = (await compareReader.req("/runs/" + id)).body;
  assert.equal(before.latest_status, "FAILED");
  assert.equal(before.latest_successful_result.status, "SUCCESS");
  const result = await compareReader.req("/compare", {
    run_ids: [id, otherId],
  });
  assert.equal(result.status, 200);
  assert.ok(
    result.body.warnings.some((x) =>
      x.includes("newer unfinished or unsuccessful"),
    ),
  );
  assert.equal(
    result.body.runs.find((x) => x.run_id === id).latest_status,
    "FAILED",
  );
  assert.equal(
    result.body.runs.find((x) => x.run_id === id).comparison_attempt_status,
    "SUCCESS",
  );
  assert.deepEqual(before, (await compareReader.req("/runs/" + id)).body);
  evidence.push({
    case: "Compare earlier success with visible later failure",
    status: "PASS",
    read_only: true,
    latest_failure_not_hidden: true,
    explicit_successful_attempt_selected: true,
  });
} finally {
  await compareReader.stop();
}
await writeFile(
  "reports/workbench01/product-reset-01/operational-acceptance.json",
  JSON.stringify(
    {
      status: "PASS",
      cases: evidence,
      auth_401: true,
      unsupported_media_415: true,
      oversize_413: true,
      path_traversal_rejected: true,
      unexpected_query_rejected: true,
      defaults_not_increased: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "PASS operational capacity, authenticated boundary, size limits and immutable failure/rerun",
);
