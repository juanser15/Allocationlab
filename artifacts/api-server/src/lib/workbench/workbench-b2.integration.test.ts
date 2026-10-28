import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import apiApp from "../../app";
import { PIT_CLASSIFICATION, RESEARCH_BOUNDARY, STORAGE_CLASSIFICATION } from "./contracts";

const enabled = process.env.WORKBENCH_B2_EMPIRICAL_ACCEPTANCE === "1";
const token = "phase-b2-injected-api-acceptance-token";
const evidencePath = "/tmp/allocationlab-workbench-b2-api-integration.json";

const submission = (cost: 0 | 5) => ({
  research_mode: "CAPITAL_MARKET_EXPOSURE",
  execution_scope: "EMPIRICAL",
  universe: "SPY",
  validation_protocol: "TRADITIONAL_WALK_FORWARD",
  transaction_cost_bps: cost,
});
async function request(baseUrl: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  // B1/B2 certification remains explicitly versioned as a fixture contract.
  const response = await fetch(`${baseUrl}${path.replace(/^\/api\/workbench/, "/api/workbench/v1")}`, { ...init, headers });
  const text = await response.text();
  const body = JSON.parse(text);
  assert.ok(response.ok, `${response.status} ${text}`);
  return { response, body };
}

async function waitForTerminal(baseUrl: string, runId: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await request(baseUrl, `/api/workbench/runs/${runId}`);
    if (["SUCCESS", "FAILED", "BLOCKED"].includes(body.latest_status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${runId}`);
}

test("Phase B2 authenticated UI/API vertical slice executes A, A-rerun, B and read-only compare", {
  skip: !enabled,
  timeout: 8 * 60_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-workbench-b2-"));
  const previousRoot = process.env.WORKBENCH_RUN_DIR;
  const previousToken = process.env.WORKBENCH_PREVIEW_TOKEN;
  process.env.WORKBENCH_RUN_DIR = root;
  process.env.WORKBENCH_PREVIEW_TOKEN = token;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.WORKBENCH_RUN_DIR;
    else process.env.WORKBENCH_RUN_DIR = previousRoot;
    if (previousToken === undefined) delete process.env.WORKBENCH_PREVIEW_TOKEN;
    else process.env.WORKBENCH_PREVIEW_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  });

  const server = apiApp.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise<void>((resolveClose, rejectClose) => server.close((error) =>
    error ? rejectClose(error) : resolveClose())));

  const capabilities = await request(baseUrl, "/api/workbench/capabilities");
  assert.equal(capabilities.body.research_boundary, RESEARCH_BOUNDARY);
  assert.equal(capabilities.body.pit_classification, PIT_CLASSIFICATION);
  assert.equal(capabilities.body.temporary_storage.status, STORAGE_CLASSIFICATION);
  assert.deepEqual(capabilities.body.editable_fields.map((field: any) => field.field), ["transaction_cost_bps"]);
  assert.deepEqual(capabilities.body.editable_fields[0].allowed_values, [0, 5]);

  const aReceipt = await request(baseUrl, "/api/workbench/runs", {
    method: "POST", body: JSON.stringify(submission(0)),
  });
  const a = await waitForTerminal(baseUrl, aReceipt.body.run_id);
  assert.equal(a.latest_status, "SUCCESS");
  assert.equal(a.latest_successful_result.metrics.observations, 501);
  assert.equal(a.latest_successful_result.metrics.final_research_index, 107.25445949277757);
  assert.equal(a.latest_successful_result.costs.realized_transaction_cost, 0);
  assert.equal(a.latest_successful_result.financial_result_hash,
    "426533ad89ffb1ad72246a8c8ecdb2a6e7ad8e9d1c50f8e6db713d36e1af7e0d");

  const rerunReceipt = await request(baseUrl, `/api/workbench/runs/${aReceipt.body.run_id}/rerun`, {
    method: "POST", body: "{}",
  });
  const rerunA = await waitForTerminal(baseUrl, aReceipt.body.run_id);
  assert.equal(rerunReceipt.body.run_id, aReceipt.body.run_id);
  assert.notEqual(rerunReceipt.body.execution_attempt_id, aReceipt.body.execution_attempt_id);
  assert.equal(rerunA.attempt_history.length, 2);
  assert.equal(rerunA.latest_successful_result.financial_result_hash,
    a.latest_successful_result.financial_result_hash);
  assert.deepEqual(rerunA.latest_successful_result.metrics, a.latest_successful_result.metrics);
  assert.deepEqual(rerunA.latest_successful_result.time_series.points,
    a.latest_successful_result.time_series.points);

  const bReceipt = await request(baseUrl, "/api/workbench/runs", {
    method: "POST", body: JSON.stringify(submission(5)),
  });
  const b = await waitForTerminal(baseUrl, bReceipt.body.run_id);
  assert.notEqual(bReceipt.body.run_id, aReceipt.body.run_id);
  assert.equal(b.latest_successful_result.metrics.observations, 501);
  assert.equal(b.latest_successful_result.metrics.final_research_index, 107.13006040048703);
  assert.equal(b.latest_successful_result.costs.realized_transaction_cost, 0.1130073297533634);
  assert.equal(b.latest_successful_result.financial_result_hash,
    "ed95b4e9782f942905539d37f3a655358e7f106c8162f6a905985288f53f40b8");

  const beforeCompare = {
    aAttempts: rerunA.attempt_history.length,
    bAttempts: b.attempt_history.length,
  };
  const compared = await request(baseUrl,
    `/api/workbench/compare?leftRunId=${aReceipt.body.run_id}&rightRunId=${bReceipt.body.run_id}`);
  assert.equal(compared.body.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.deepEqual(compared.body.spec_differences.map((item: any) => item.path),
    ["/transaction_cost_bps"]);
  assert.equal(compared.body.transaction_cost_difference_bps, 5);
  assert.equal(compared.body.oos_observation_difference, 0);
  assert.equal(compared.body.final_research_index_difference, -0.12439909229054535);
  assert.equal(compared.body.realized_cost_difference, 0.1130073297533634);
  assert.equal(Object.prototype.hasOwnProperty.call(compared.body, "winner"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compared.body, "recommendation"), false);
  const [aAfterCompare, bAfterCompare] = await Promise.all([
    request(baseUrl, `/api/workbench/runs/${aReceipt.body.run_id}`),
    request(baseUrl, `/api/workbench/runs/${bReceipt.body.run_id}`),
  ]);
  assert.equal(aAfterCompare.body.attempt_history.length, beforeCompare.aAttempts);
  assert.equal(bAfterCompare.body.attempt_history.length, beforeCompare.bAttempts);

  const evidence = {
    status: "PASS",
    access_control: "BEARER_TOKEN_ACCEPTED_SERVER_SIDE",
    run_a: {
      run_id: aReceipt.body.run_id,
      execution_attempt_id: aReceipt.body.execution_attempt_id,
      status: a.latest_status,
      observations: a.latest_successful_result.metrics.observations,
      final_research_index: a.latest_successful_result.metrics.final_research_index,
      realized_transaction_cost: a.latest_successful_result.costs.realized_transaction_cost,
      financial_result_hash: a.latest_successful_result.financial_result_hash,
    },
    run_a_rerun: {
      run_id: rerunReceipt.body.run_id,
      execution_attempt_id: rerunReceipt.body.execution_attempt_id,
      status: rerunA.latest_status,
      attempt_history_count: rerunA.attempt_history.length,
      same_financial_result_hash: rerunA.latest_successful_result.financial_result_hash ===
        a.latest_successful_result.financial_result_hash,
      same_metrics: JSON.stringify(rerunA.latest_successful_result.metrics) ===
        JSON.stringify(a.latest_successful_result.metrics),
      same_time_series: JSON.stringify(rerunA.latest_successful_result.time_series.points) ===
        JSON.stringify(a.latest_successful_result.time_series.points),
    },
    run_b: {
      run_id: bReceipt.body.run_id,
      execution_attempt_id: bReceipt.body.execution_attempt_id,
      status: b.latest_status,
      observations: b.latest_successful_result.metrics.observations,
      final_research_index: b.latest_successful_result.metrics.final_research_index,
      realized_transaction_cost: b.latest_successful_result.costs.realized_transaction_cost,
      financial_result_hash: b.latest_successful_result.financial_result_hash,
    },
    compare: {
      calculation: compared.body.calculation,
      spec_difference_paths: compared.body.spec_differences.map((item: any) => item.path),
      transaction_cost_difference_bps: compared.body.transaction_cost_difference_bps,
      oos_observation_difference: compared.body.oos_observation_difference,
      final_research_index_difference: compared.body.final_research_index_difference,
      realized_cost_difference: compared.body.realized_cost_difference,
      attempt_counts_unchanged: true,
      winner_declared: false,
    },
    boundaries: {
      research_boundary: RESEARCH_BOUNDARY,
      storage_classification: STORAGE_CLASSIFICATION,
      pit_classification: PIT_CLASSIFICATION,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});
