import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import {
  EXECUTION_SCOPE,
  PIT_CLASSIFICATION,
  RESEARCH_BOUNDARY,
  RESEARCH_MODE,
  STORAGE_CLASSIFICATION,
  SUPPORTED_UNIVERSE,
  VALIDATION_PROTOCOL,
  WorkbenchContractValidationError,
  normalizeResearchRunSpec,
  parseResearchRunSubmission,
  type ResearchRunSubmission,
} from "./contracts";
import {
  CapitalExecutionError,
  WORKBENCH_ADAPTER_VERSION,
  WORKBENCH_PIT_CLASSIFICATION,
  WORKBENCH_REAL_MONEY_BOUNDARY,
  WORKBENCH_STORAGE_STATUS,
  executeCapitalResearchAttempt,
  type CapitalExecutionInput,
  type CapitalExecutionOutcome,
} from "./execution-adapter";
import {
  calculateRunId, canonicalJson, createExecutionAttemptId, createResearchRunSpec,
} from "./identity";
import { WorkbenchRunStore, WorkbenchRunStoreError } from "./run-store";
import { WorkbenchService, createWorkbenchService } from "./service";
import { WORKBENCH_PREVIEW_TOKEN_ENV } from "./preview-access";
import { createWorkbenchRouter } from "../../routes/workbench";
import apiApp from "../../app";

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const submission = (transactionCostBps: 0 | 5 = 0): ResearchRunSubmission => ({
  research_mode: RESEARCH_MODE,
  execution_scope: EXECUTION_SCOPE,
  universe: SUPPORTED_UNIVERSE,
  validation_protocol: VALIDATION_PROTOCOL,
  transaction_cost_bps: transactionCostBps,
});

function clock(): () => string {
  let tick = 0;
  const epoch = Date.parse("2026-10-20T12:00:00.000Z");
  return () => new Date(epoch + tick++ * 1_000).toISOString();
}

async function writeArtifact(root: string, path: string, body: string): Promise<string> {
  const target = join(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, body, "utf8");
  return sha256(body);
}

async function fakeOutcome(
  storeRoot: string,
  input: CapitalExecutionInput,
): Promise<CapitalExecutionOutcome> {
  const cost = input.transactionCostBps;
  const engineRoot = join(
    storeRoot, "runs", input.runId, "attempts", input.executionAttemptId, "engine",
  );
  await mkdir(engineRoot, { recursive: true });

  const finalIndex = cost === 0 ? 107.25445949277757 : 107.13006040048703;
  const realizedCost = cost === 0 ? 0 : 0.1130073297533634;
  const points = Array.from({ length: 501 }, (_, index) => ({
    outer_fold: index < 251 ? 0 : 1,
    candidate_id: index < 251 ? "c_8bd28f4f8b5e8e7d2077e17c" : "c_aa16f813288e415fae34648c",
    date: new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10),
    index: 100 + (finalIndex - 100) * ((index + 1) / 501),
    drawdown: 0,
    net_return: cost === 0 ? 0.0001 : 0.00009,
    exposure: 0.8566549034132027,
  }));
  const summary = `${JSON.stringify({ scenario: cost, observations: 501, final_index: finalIndex, costs: realizedCost })}\n`;
  const equity = ["scenario,date,index", ...points.map((point) => `${cost},${point.date},${point.index}`)].join("\n") + "\n";
  const ledger = `scenario,total_cost\n${cost},${realizedCost}\n`;
  const manifestText = `${JSON.stringify({ engine: "capital-research-1.0.1", cost })}\n`;
  const progress = `${JSON.stringify({ elapsed_ms: input.executionAttemptId.length, attempt: input.executionAttemptId })}\n`;
  const hashes = {
    manifest: await writeArtifact(engineRoot, "manifest.json", manifestText),
    summary: await writeArtifact(engineRoot, "summary.json", summary),
    equity: await writeArtifact(engineRoot, "oos-equity.csv", equity),
    ledger: await writeArtifact(engineRoot, "oos-ledger.csv", ledger),
    progress: await writeArtifact(engineRoot, "progress.json", progress),
  };

  const selectedFolds = [0, 1].map((outerFold) => ({
    outer_fold: outerFold,
    train_start: outerFold === 0 ? "2020-01-01" : "2021-01-01",
    train_end: outerFold === 0 ? "2022-01-01" : "2023-01-01",
    test_start: outerFold === 0 ? "2022-01-01" : "2023-01-01",
    test_end: outerFold === 0 ? "2023-01-01" : "2024-01-01",
    selection_metric: "net_sharpe",
    selection_cost_bps: 5,
    candidate_id: outerFold === 0 ? "c_8bd28f4f8b5e8e7d2077e17c" : "c_aa16f813288e415fae34648c",
    score: 0.3,
    rank: 1,
    scoring_hash: sha256(`selection-${outerFold}`),
    status: "SELECTED" as const,
  }));
  const selectedJobs = await Promise.all(selectedFolds.map(async (fold) => {
    const path = `jobs/fold-${fold.outer_fold}-scenario-${cost}.json`;
    const jobHash = sha256(`job-${fold.outer_fold}-${cost}`);
    const resultHash = sha256(`result-${fold.outer_fold}-${cost}`);
    await writeArtifact(engineRoot, path, `${JSON.stringify({ job_hash: jobHash, result_hash: resultHash })}\n`);
    return {
      outer_fold: fold.outer_fold,
      candidate_id: fold.candidate_id,
      scenario: cost,
      job_hash: jobHash,
      result_hash: resultHash,
      fit_keys: [sha256(`fit-${fold.outer_fold}`)],
      targets: [{ signalDate: `202${2 + fold.outer_fold}-01-03`, risk_target: 0.8 }],
      artifact: path,
    };
  }));
  const financialHash = sha256(canonicalJson({
    cost, finalIndex, realizedCost,
    jobs: selectedJobs.map(({ job_hash, result_hash }) => ({ job_hash, result_hash })),
    equity: hashes.equity,
    ledger: hashes.ledger,
  }));

  return {
    engineRoot,
    boundedLogs: `fake capital execution cost=${cost}\n`,
    result: {
      adapter_version: WORKBENCH_ADAPTER_VERSION,
      pit_classification: WORKBENCH_PIT_CLASSIFICATION,
      storage_status: WORKBENCH_STORAGE_STATUS,
      real_money_boundary: WORKBENCH_REAL_MONEY_BOUNDARY,
      requested_transaction_cost_bps: cost,
      engine: {
        engine_version: "capital-research-1.0.1",
        experiment_id: "cl03-acceptance-traditional",
        experiment_hash: sha256("fake-certified-campaign"),
        code_hash: "94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf",
        data_csv_sha256: "b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0",
        parsed_data_hash: "f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e",
        campaign_config_sha256: "9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64",
        new_jobs: 24,
        reused_jobs: 0,
      },
      scenario_metrics: {
        scenario: cost,
        observations: 501,
        cagr: cost === 0 ? 0.035854467043460625 : 0.035249977711973246,
        net_sharpe: cost === 0 ? 0.30496407414649523 : 0.3011888473152739,
        max_drawdown: cost === 0 ? -0.191148358059128 : -0.19162665108551424,
        return_drawdown_ratio: cost === 0 ? 0.18757402578561386 : 0.1839513319900518,
        volatility: cost === 0 ? 0.1546685294257783 : 0.15466908349475517,
        turnover: cost === 0 ? 2.321457669865068 : 2.320629024530165,
        turnover_annualized: cost === 0 ? 1.1676793069979983 : 1.16726250335649,
        costs: realizedCost,
        exposure: 0.8566549034132027,
        final_index: finalIndex,
      },
      selected_folds: selectedFolds,
      selected_jobs: selectedJobs,
      time_series: points,
      result_artifacts: [
        { kind: "ENGINE_MANIFEST", path: "manifest.json", sha256: hashes.manifest },
        { kind: "ENGINE_SUMMARY", path: "summary.json", sha256: hashes.summary, selector: `outer_oos[scenario=${cost}]` },
        { kind: "OOS_EQUITY", path: "oos-equity.csv", sha256: hashes.equity, selector: `scenario=${cost}`, selected_rows_sha256: hashes.equity },
        { kind: "OOS_LEDGER", path: "oos-ledger.csv", sha256: hashes.ledger, selector: `scenario=${cost}`, selected_rows_sha256: hashes.ledger },
      ],
      financial_result_hash: financialHash,
      runtime_hash: hashes.progress,
      warnings: [
        PIT_CLASSIFICATION,
        "Adjusted-close vendor authenticity and historical vintages are not independently verified.",
      ],
      blockers: [],
    },
  };
}

type ExecutorMode = "immediate" | "deferred" | "failed";

class FakeExecutor {
  readonly calls: CapitalExecutionInput[] = [];
  private pending = new Map<string, {
    input: CapitalExecutionInput;
    resolve: (outcome: CapitalExecutionOutcome) => void;
    reject: (error: unknown) => void;
  }>();

  constructor(readonly storeRoot: string, public mode: ExecutorMode = "immediate") {}

  readonly execute = async (input: CapitalExecutionInput): Promise<CapitalExecutionOutcome> => {
    this.calls.push(structuredClone(input));
    if (this.mode === "failed") {
      throw new CapitalExecutionError(
        "WORKBENCH_WORKER_FAILED",
        "The empirical execution failed safely.",
        "internal diagnostic /secret/path must remain in the store",
      );
    }
    if (this.mode === "deferred") {
      return new Promise<CapitalExecutionOutcome>((resolvePending, rejectPending) => {
        this.pending.set(input.executionAttemptId, {
          input: structuredClone(input), resolve: resolvePending, reject: rejectPending,
        });
      });
    }
    return fakeOutcome(this.storeRoot, input);
  };

  async succeed(executionAttemptId: string): Promise<void> {
    const pending = this.pending.get(executionAttemptId);
    assert.ok(pending, `pending fake execution ${executionAttemptId} should exist`);
    this.pending.delete(executionAttemptId);
    pending.resolve(await fakeOutcome(this.storeRoot, pending.input));
  }
}

interface Harness {
  root: string;
  store: WorkbenchRunStore;
  service: WorkbenchService;
  executor: FakeExecutor;
  baseUrl: string;
}

async function harness(t: TestContext, mode: ExecutorMode = "immediate"): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-workbench-test-"));
  const store = await WorkbenchRunStore.open({ root, repositoryRoot: process.cwd() });
  const executor = new FakeExecutor(root, mode);
  const service = await createWorkbenchService({ store, executeAttempt: executor.execute, now: clock() });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createWorkbenchRouter(service));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) =>
      error ? rejectClose(error) : resolveClose()));
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, service, executor, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function fetchJson(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: any; text: string }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); }
  catch { body = null; }
  return { response, body, text };
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function waitForStatus(
  service: WorkbenchService,
  runId: string,
  status: "SUCCESS" | "FAILED" | "BLOCKED",
  timeoutMs = 5_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const view = await service.getRun(runId);
    if (view.latest_status === status) return view;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  assert.fail(`run ${runId} did not reach ${status} within ${timeoutMs}ms`);
}

function allObjectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => allObjectKeys(item, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      found.add(key.toLowerCase());
      allObjectKeys(item, found);
    }
  }
  return found;
}

test("A/B/S/T: capabilities expose one empirical research-only path and preserve mandatory boundaries", async (t) => {
  const h = await harness(t);
  const { response, body } = await fetchJson(h.baseUrl, "/workbench/capabilities");
  assert.equal(response.status, 200);
  assert.deepEqual(body.supported_research_modes, ["CAPITAL_MARKET_EXPOSURE"]);
  assert.deepEqual(body.supported_universe, ["SPY"]);
  assert.deepEqual(body.supported_validation_methods, ["TRADITIONAL_WALK_FORWARD"]);
  assert.deepEqual(body.editable_fields.map((field: { field: string }) => field.field), ["transaction_cost_bps"]);
  assert.deepEqual(body.editable_fields[0].allowed_values, [0, 5]);
  const metadataKeys = [
    "field", "editable", "type", "validation_rule", "default_source",
    "financial_meaning", "backend_mapping", "unsupported_reason",
  ];
  for (const field of [...body.editable_fields, ...body.fixed_fields]) {
    for (const key of metadataKeys)
      assert.ok(Object.prototype.hasOwnProperty.call(field, key), `${field.field} lacks ${key}`);
    assert.ok(["USER_SUPPLIED", "SAVED_CONFIGURATION", "EXPLICIT_ENGINE_DEFAULT", "DERIVED"]
      .includes(field.default_source), `${field.field} has an unsupported source`);
  }
  for (const requiredFixed of [
    "information_universe", "selection_metric", "model_and_candidate_configuration",
    "constraints", "walk_forward_configuration", "cost_and_yield_configuration",
    "candidate_budget", "random_seed", "information_cutoff_policy",
    "strategy_or_allocator_version", "expected_return_method", "covariance_method",
    "risk_mandate",
  ]) assert.ok(body.fixed_fields.some((field: { field: string }) => field.field === requiredFixed));
  assert.equal(body.pit_classification, PIT_CLASSIFICATION);
  assert.equal(body.research_boundary, RESEARCH_BOUNDARY);
  assert.equal(body.temporary_storage.status, STORAGE_CLASSIFICATION);
  assert.equal(body.real_money_boundary.status, RESEARCH_BOUNDARY);
  assert.equal(body.engine_identity.adapter_version, WORKBENCH_ADAPTER_VERSION);
  assert.equal(body.supported_research_modes.some((mode: string) => /SYNTHETIC/.test(mode)), false);
  assert.ok(body.blocked_modes.some((mode: { mode: string }) => mode.mode === "NESTED_WALK_FORWARD"));
  assert.deepEqual(body.real_money_boundary.state_non_implications, ["PROMOTED", "ACTIVE", "ALLOCATED", "AUTHORIZED"]);
  const keys = allObjectKeys(body);
  for (const affirmative of ["order", "orders", "broker_route", "approved_size", "capital_authorization", "live_execution_state"])
    assert.equal(keys.has(affirmative), false, `${affirmative} must not be an executable response field`);
});

test("C/D: canonical normalization is deterministic and transaction cost changes run identity", () => {
  const zero = submission(0);
  const reordered = {
    transaction_cost_bps: 0,
    validation_protocol: VALIDATION_PROTOCOL,
    universe: SUPPORTED_UNIVERSE,
    execution_scope: EXECUTION_SCOPE,
    research_mode: RESEARCH_MODE,
  };
  const first = createResearchRunSpec(zero, { createdAt: "2026-10-20T12:00:00.000Z" });
  const second = createResearchRunSpec(reordered, { createdAt: "2026-10-21T12:00:00.000Z" });
  const five = createResearchRunSpec(submission(5), { createdAt: "2026-10-20T12:00:00.000Z" });
  assert.equal(first.run_id, second.run_id);
  assert.equal(first.run_id, calculateRunId(normalizeResearchRunSpec(zero)));
  assert.notEqual(first.run_id, five.run_id);
  assert.equal(canonicalJson({ z: -0, b: null, a: [2, 1] }), '{"a":[2,1],"b":null,"z":0}');
  assert.notEqual(canonicalJson({ values: [1, 2] }), canonicalJson({ values: [2, 1] }));
});

test("E/F/G/H/M/N: HTTP validation rejects unsupported, dangerous, nonfinite and oversized input before execution", async (t) => {
  const h = await harness(t);
  const invalidBodies = [
    { ...submission(0), unsupported_field: true },
    { ...submission(0), universe: "QQQ" },
    { ...submission(0), research_mode: "FACTOR_ALLOCATION" },
    { ...submission(0), validation_protocol: "NESTED_WALK_FORWARD" },
    { ...submission(0), execution_scope: "SYNTHETIC_TEST" },
    { ...submission(0), transaction_cost_bps: -1 },
    { ...submission(0), transaction_cost_bps: "NaN" },
    { ...submission(0), command: "touch /tmp/allocationlab-command-marker" },
    { ...submission(0), data_path: "../../reports/cl02/adjusted-closes.csv" },
    (() => { const value: Record<string, unknown> = { ...submission(0) }; delete value.transaction_cost_bps; return value; })(),
  ];
  for (const value of invalidBodies) {
    const { response, body, text } = await fetchJson(h.baseUrl, "/workbench/runs", post(value));
    assert.equal(response.status, 400, text);
    assert.equal(body.pit_classification, PIT_CLASSIFICATION);
    assert.equal(body.research_boundary, RESEARCH_BOUNDARY);
    assert.equal(body.error.code, "INVALID_RESEARCH_RUN_SPEC");
    assert.doesNotMatch(text, /\/workspace|at [A-Za-z].*\.(?:ts|js):\d+/);
  }
  assert.throws(
    () => parseResearchRunSubmission({ ...submission(0), transaction_cost_bps: Number.POSITIVE_INFINITY }),
    WorkbenchContractValidationError,
  );
  const infinite = JSON.stringify(submission(0)).replace('"transaction_cost_bps":0', '"transaction_cost_bps":1e400');
  const rawInfinite = await fetchJson(h.baseUrl, "/workbench/runs", {
    method: "POST", headers: { "content-type": "application/json" }, body: infinite,
  });
  assert.equal(rawInfinite.response.status, 400);

  for (const queryPath of [
    "/workbench/capabilities?unexpected=true",
    "/workbench/runs?transaction_cost_bps=999",
  ]) {
    const queried = queryPath.includes("/runs?")
      ? await fetchJson(h.baseUrl, queryPath, post(submission(0)))
      : await fetchJson(h.baseUrl, queryPath);
    assert.equal(queried.response.status, 400);
    assert.equal(queried.body.error.code, "INVALID_QUERY");
  }

  const oversized = await fetchJson(h.baseUrl, "/workbench/runs", post({
    ...submission(0), unsupported_field: "x".repeat(20 * 1024),
  }));
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.body.error.code, "WORKBENCH_REQUEST_TOO_LARGE");

  const traversal = encodeURIComponent("../../reports/cl02/adjusted-closes.csv");
  const traversed = await fetchJson(h.baseUrl, `/workbench/runs/${traversal}`);
  assert.equal(traversed.response.status, 400);
  assert.equal(traversed.body.error.code, "INVALID_RUN_ID");
  await assert.rejects(
    executeCapitalResearchAttempt({
      runId: "safe_but_not_a_canonical_run_id",
      executionAttemptId: createExecutionAttemptId(),
      transactionCostBps: 0,
    }),
    (error: unknown) => error instanceof CapitalExecutionError &&
      error.errorClass === "WORKBENCH_INVALID_EXECUTION_INPUT",
  );
  assert.equal(h.executor.calls.length, 0, "rejected request data must never reach the executor");
});

test("I/J: duplicate POST is idempotent while RUNNING and after SUCCESS", async (t) => {
  const h = await harness(t, "deferred");
  const first = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  assert.equal(first.response.status, 202);
  assert.equal(first.body.status, "RUNNING");
  assert.equal(first.body.execution_requested, true);
  assert.equal(h.executor.calls.length, 1);

  const duplicateRunning = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  assert.equal(duplicateRunning.response.status, 202);
  assert.equal(duplicateRunning.body.run_id, first.body.run_id);
  assert.equal(duplicateRunning.body.execution_attempt_id, first.body.execution_attempt_id);
  assert.equal(duplicateRunning.body.reused_existing_attempt, true);
  assert.equal(duplicateRunning.body.execution_requested, false);
  assert.equal(h.executor.calls.length, 1);

  await h.executor.succeed(first.body.execution_attempt_id);
  await waitForStatus(h.service, first.body.run_id, "SUCCESS");
  const duplicateSuccess = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  assert.equal(duplicateSuccess.response.status, 200);
  assert.equal(duplicateSuccess.body.execution_attempt_id, first.body.execution_attempt_id);
  assert.equal(duplicateSuccess.body.reused_existing_attempt, true);
  assert.equal(duplicateSuccess.body.execution_requested, false);
  assert.equal(h.executor.calls.length, 1);
});

test("bounded concurrency returns an explicit BLOCKED attempt instead of starting a second experiment", async (t) => {
  const h = await harness(t, "deferred");
  const active = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  const blocked = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(5)));
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.status, "BLOCKED");
  assert.equal(blocked.body.execution_requested, false);
  assert.notEqual(blocked.body.run_id, active.body.run_id);
  assert.equal(h.executor.calls.length, 1);
  const detail = await fetchJson(h.baseUrl, `/workbench/runs/${blocked.body.run_id}`);
  assert.equal(detail.body.latest_status, "BLOCKED");
  assert.equal(detail.body.blockers[0].code, "BLOCKED_EXECUTION_CAPACITY");
  for (let index = 0; index < 5; index += 1) {
    const repeated = await fetchJson(
      h.baseUrl, `/workbench/runs/${blocked.body.run_id}/rerun`, post({}),
    );
    assert.equal(repeated.response.status, 429);
    assert.equal(repeated.body.execution_attempt_id, blocked.body.execution_attempt_id);
    assert.equal(repeated.body.reused_existing_attempt, true);
  }
  const boundedDetail = await fetchJson(h.baseUrl, `/workbench/runs/${blocked.body.run_id}`);
  assert.equal(boundedDetail.body.attempt_history.length, 1,
    "repeated capacity pressure must not amplify immutable metadata");
  await h.executor.succeed(active.body.execution_attempt_id);
  await waitForStatus(h.service, active.body.run_id, "SUCCESS");
});

test("K/P/Q/R/S/T: rerun reproduces A, B applies cost, and compare only reads immutable results", async (t) => {
  const h = await harness(t);
  const runAReceipt = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  const runA = await waitForStatus(h.service, runAReceipt.body.run_id, "SUCCESS");
  assert.equal(runA.latest_result.pit_classification, PIT_CLASSIFICATION);
  assert.equal(runA.latest_result.real_money_boundary, RESEARCH_BOUNDARY);
  assert.equal(runA.latest_result.metrics.observations, 501);
  assert.equal(runA.latest_result.costs.realized_transaction_cost, 0);

  const rejectedRerunQuery = await fetchJson(
    h.baseUrl, `/workbench/runs/${runAReceipt.body.run_id}/rerun?unexpected=true`, post({}),
  );
  assert.equal(rejectedRerunQuery.response.status, 400);
  assert.equal(rejectedRerunQuery.body.error.code, "INVALID_QUERY");
  assert.equal((await h.service.getRun(runAReceipt.body.run_id)).attempt_history.length, 1);

  const rerunReceipt = await fetchJson(
    h.baseUrl, `/workbench/runs/${runAReceipt.body.run_id}/rerun`, post({}),
  );
  assert.equal(rerunReceipt.response.status, 202);
  assert.equal(rerunReceipt.body.run_id, runAReceipt.body.run_id);
  assert.notEqual(rerunReceipt.body.execution_attempt_id, runAReceipt.body.execution_attempt_id);
  const rerunA = await waitForStatus(h.service, runAReceipt.body.run_id, "SUCCESS");
  assert.equal(rerunA.attempt_history.length, 2);
  const [firstResult, rerunResult] = await Promise.all(rerunA.attempt_history.map((attempt: any) =>
    h.store.readResult({
      runId: runAReceipt.body.run_id,
      executionAttemptId: attempt.execution_attempt_id,
    })) as Promise<any>[]);
  assert.equal(firstResult.financial_result_hash, rerunResult.financial_result_hash);
  assert.deepEqual(firstResult.metrics, rerunResult.metrics);
  assert.deepEqual(firstResult.time_series.points, rerunResult.time_series.points);
  assert.notEqual(firstResult.runtime_hash, rerunResult.runtime_hash,
    "runtime telemetry may differ and must not enter the financial hash");

  const runBReceipt = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(5)));
  const runB = await waitForStatus(h.service, runBReceipt.body.run_id, "SUCCESS");
  assert.notEqual(runBReceipt.body.run_id, runAReceipt.body.run_id);
  assert.equal(runB.latest_result.costs.transaction_cost_bps, 5);
  assert.ok(runB.latest_result.costs.realized_transaction_cost > 0);
  assert.notEqual(runB.latest_result.financial_result_hash, firstResult.financial_result_hash);
  assert.notDeepEqual(runB.latest_result.validation_diagnostics.job_hashes,
    firstResult.validation_diagnostics.job_hashes);

  const callsBeforeCompare = h.executor.calls.length;
  const compared = await fetchJson(
    h.baseUrl,
    `/workbench/compare?leftRunId=${runAReceipt.body.run_id}&rightRunId=${runBReceipt.body.run_id}`,
  );
  assert.equal(compared.response.status, 200);
  assert.equal(compared.body.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.equal(h.executor.calls.length, callsBeforeCompare, "compare must not invoke the engine");
  assert.deepEqual(compared.body.spec_differences.map((item: { path: string }) => item.path),
    ["/transaction_cost_bps"]);
  assert.deepEqual(compared.body.financial_input_differences, compared.body.spec_differences);
  assert.equal(compared.body.transaction_cost_difference_bps, 5);
  assert.equal(compared.body.oos_observation_difference, 0);
  assert.ok(compared.body.realized_cost_difference > 0);
  assert.equal(compared.body.pit_classification, PIT_CLASSIFICATION);
  assert.equal(compared.body.research_boundary, RESEARCH_BOUNDARY);
  assert.equal(Object.prototype.hasOwnProperty.call(compared.body, "winner"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compared.body, "recommendation"), false);
  for (const result of [firstResult, rerunResult, runB.latest_result]) {
    const keys = allObjectKeys(result);
    for (const key of ["order", "broker_route", "approved_size", "capital_authorization"])
      assert.equal(keys.has(key), false);
  }
});

test("L: a failed rerun remains latest while default POST reuses prior success without retry", async (t) => {
  const h = await harness(t);
  const original = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  await waitForStatus(h.service, original.body.run_id, "SUCCESS");
  h.executor.mode = "failed";
  const failedReceipt = await fetchJson(h.baseUrl, `/workbench/runs/${original.body.run_id}/rerun`, post({}));
  const failed = await waitForStatus(h.service, original.body.run_id, "FAILED");
  assert.equal(failed.latest_attempt.execution_attempt_id, failedReceipt.body.execution_attempt_id);
  assert.equal(failed.latest_result.status, "FAILED");
  assert.equal(failed.latest_result.error_class, "WORKBENCH_WORKER_FAILED");
  assert.equal(failed.latest_result.error_message, "The empirical execution failed safely.");
  assert.equal(
    failed.latest_result.execution.runtime_diagnostic_reference,
    `runs/${original.body.run_id}/attempts/${failedReceipt.body.execution_attempt_id}/diagnostic.json`,
  );
  assert.equal(failed.latest_result.execution.diagnostic_content_exposed_by_api, false);
  assert.equal(failed.latest_attempt.runtime_diagnostic_reference,
    failed.latest_result.execution.runtime_diagnostic_reference);
  assert.equal(failed.latest_successful_result.status, "SUCCESS",
    "the earlier success remains separately available and must not replace latest failure");
  assert.doesNotMatch(JSON.stringify(failed), /\/secret\/path|\n\s*at /);
  const callsBefore = h.executor.calls.length;
  const repeated = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.execution_attempt_id, original.body.execution_attempt_id);
  assert.equal(repeated.body.status, "SUCCESS");
  assert.equal(repeated.body.execution_requested, false);
  assert.equal(h.executor.calls.length, callsBefore);

  const diagnosticPath = join(
    h.root, "runs", original.body.run_id, "attempts", failedReceipt.body.execution_attempt_id,
    "diagnostic.json",
  );
  assert.match(await readFile(diagnosticPath, "utf8"), /internal diagnostic/,
    "detailed diagnostics are retained in the temporary store");
  await rm(join(
    h.root, "runs", original.body.run_id, "attempts", failedReceipt.body.execution_attempt_id,
    "result.json",
  ));
  await assert.rejects(
    h.service.getRun(original.body.run_id),
    (error: unknown) => error instanceof WorkbenchRunStoreError &&
      error.code === "RESULT_NOT_AVAILABLE",
    "a missing terminal result must surface instead of becoming NOT_SUPPORTED",
  );
});

test("O: store paths are confined to temporary storage and protected roots are rejected before mutation", async (t) => {
  await assert.rejects(
    WorkbenchRunStore.open({ root: tmpdir(), repositoryRoot: process.cwd() }),
    (error: unknown) => error instanceof WorkbenchRunStoreError && error.code === "UNSAFE_RUN_ROOT",
  );
  const protectedRoot = await mkdtemp(join(tmpdir(), "allocationlab-certified-probe-"));
  const sentinel = join(protectedRoot, "sentinel.txt");
  await writeFile(sentinel, "unchanged\n", "utf8");
  const before = await stat(protectedRoot);
  const forbiddenTarget = join(protectedRoot, "reports", "cl02", "workbench-runs");
  t.after(() => rm(protectedRoot, { recursive: true, force: true }));
  await assert.rejects(
    WorkbenchRunStore.open({ root: forbiddenTarget, repositoryRoot: protectedRoot }),
    (error: unknown) => error instanceof WorkbenchRunStoreError && error.code === "UNSAFE_RUN_ROOT",
  );
  await assert.rejects(access(forbiddenTarget));
  assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
  assert.equal((await stat(protectedRoot)).mode & 0o777, before.mode & 0o777);

  const h = await harness(t);
  const receipt = await fetchJson(h.baseUrl, "/workbench/runs", post(submission(0)));
  await waitForStatus(h.service, receipt.body.run_id, "SUCCESS");
  const walk = async (directory: string): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      found.push(path);
      if (entry.isDirectory()) found.push(...await walk(path));
    }
    return found;
  };
  for (const path of await walk(h.root)) {
    const rel = relative(h.root, resolve(path));
    assert.ok(rel !== ".." && !rel.startsWith("../"), `store artifact escaped temporary root: ${path}`);
  }
  for (const certified of ["reports/cl02", "reports/al01", "reports/pipe03", "reports/bank01"])
    assert.equal((await readdir(h.root, { recursive: true }) as string[]).some((path) => path === certified), false);
});

test("O: default store discovery fails closed from an unrelated Git working directory", {
  concurrency: false,
}, async (t) => {
  const repositoryRoot = process.cwd();
  const unrelated = await mkdtemp(join(tmpdir(), "allocationlab-unrelated-git-"));
  const forbiddenTarget = join(repositoryRoot, ".workbench-store-must-not-exist");
  await mkdir(join(unrelated, ".git"));
  t.after(async () => {
    process.chdir(repositoryRoot);
    await rm(unrelated, { recursive: true, force: true });
    await rm(forbiddenTarget, { recursive: true, force: true });
  });
  process.chdir(unrelated);
  await assert.rejects(
    WorkbenchRunStore.open({ root: forbiddenTarget }),
    (error: unknown) => error instanceof WorkbenchRunStoreError && error.code === "UNSAFE_RUN_ROOT",
  );
  await assert.rejects(access(forbiddenTarget));
  process.chdir(repositoryRoot);
});

test("concurrent-abuse bound caps immutable attempts without making the run unreadable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-attempt-cap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await WorkbenchRunStore.open({
    root,
    repositoryRoot: process.cwd(),
    limits: { maxListResults: 2 },
  });
  const normalized = normalizeResearchRunSpec(submission(0));
  const runId = calculateRunId(normalized);
  await store.ensureRun(runId, normalized);
  await store.createAttempt(runId);
  await store.createAttempt(runId);
  await assert.rejects(
    store.createAttempt(runId),
    (error: unknown) => error instanceof WorkbenchRunStoreError &&
      error.code === "ATTEMPT_LIMIT_REACHED",
  );
  const readable = await store.getRun(runId);
  assert.equal(readable.attempt_history.length, 2);
});

test("integrated application returns labelled JSON for parser and route-boundary failures", async (t) => {
  const previousPreviewToken = process.env[WORKBENCH_PREVIEW_TOKEN_ENV];
  delete process.env[WORKBENCH_PREVIEW_TOKEN_ENV];
  const server = apiApp.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise<void>((resolveClose, rejectClose) => server.close((error) =>
    error ? rejectClose(error) : resolveClose())));
  t.after(() => {
    if (previousPreviewToken === undefined) delete process.env[WORKBENCH_PREVIEW_TOKEN_ENV];
    else process.env[WORKBENCH_PREVIEW_TOKEN_ENV] = previousPreviewToken;
  });

  const unconfigured = await fetch(`${baseUrl}/api/workbench/capabilities`);
  assert.equal(unconfigured.status, 503);
  assert.equal(((await unconfigured.json()) as any).error.code, "WORKBENCH_PREVIEW_ACCESS_NOT_CONFIGURED");

  process.env[WORKBENCH_PREVIEW_TOKEN_ENV] = "phase-b2-injected-test-token";
  const unauthorized = await fetch(`${baseUrl}/api/workbench/capabilities`);
  assert.equal(unauthorized.status, 401);
  assert.equal(((await unauthorized.json()) as any).error.code, "WORKBENCH_PREVIEW_UNAUTHORIZED");

  const wrong = await fetch(`${baseUrl}/api/workbench/capabilities`, {
    headers: { authorization: "Bearer wrong-token" },
  });
  assert.equal(wrong.status, 401);

  const authorized = await fetch(`${baseUrl}/api/workbench/capabilities`, {
    headers: { authorization: "Bearer phase-b2-injected-test-token" },
  });
  assert.equal(authorized.status, 200);

  const unrelated = await fetch(`${baseUrl}/api/phase-b2-unrelated-route-probe`);
  assert.notEqual(unrelated.status, 401, "preview access must not alter unrelated API routes");

  const cases: Array<{ path: string; init?: RequestInit; status: number; code: string }> = [
    {
      path: "/api/workbench/runs",
      init: { method: "POST", headers: { "content-type": "application/json" }, body: '{"broken":' },
      status: 400,
      code: "INVALID_REQUEST_BODY",
    },
    {
      path: "/api/workbench/runs",
      init: {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `x=${"a".repeat(120_000)}`,
      },
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
    {
      path: "/api/workbench/runs",
      init: {
        method: "POST",
        headers: { "content-type": "application/json; charset=iso-8859-1" },
        body: "{}",
      },
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      path: "/api/workbench/runs",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "deflate" },
        body: new Uint8Array([0, 1, 2, 3]),
      },
      status: 400,
      code: "INVALID_REQUEST_BODY",
    },
    {
      path: "/api/workbench/runs/%E0%A4%A",
      status: 400,
      code: "INVALID_REQUEST_PATH",
    },
  ];

  for (const expected of cases) {
    const init = expected.init ?? {};
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer phase-b2-injected-test-token");
    const response = await fetch(`${baseUrl}${expected.path}`, { ...init, headers });
    const text = await response.text();
    assert.equal(response.status, expected.status, text);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const body = JSON.parse(text);
    assert.equal(body.error.code, expected.code);
    assert.equal(body.research_boundary, RESEARCH_BOUNDARY);
    assert.equal(body.pit_classification, PIT_CLASSIFICATION);
    assert.equal(body.storage_classification, STORAGE_CLASSIFICATION);
    assert.doesNotMatch(text, /\/workspace|node_modules|\n\s*at /);
  }
});

test("empirical API acceptance: A, B and A-rerun certify actual engine results", {
  skip: process.env.WORKBENCH_EMPIRICAL_ACCEPTANCE !== "1",
  timeout: 8 * 60_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-workbench-empirical-"));
  const previousRoot = process.env.WORKBENCH_RUN_DIR;
  process.env.WORKBENCH_RUN_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.WORKBENCH_RUN_DIR;
    else process.env.WORKBENCH_RUN_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });
  const store = await WorkbenchRunStore.open({ root, repositoryRoot: process.cwd() });
  const service = await createWorkbenchService({ store });
  const app = express();
  app.use(express.json());
  app.use("/api", createWorkbenchRouter(service));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  t.after(() => new Promise<void>((resolveClose, rejectClose) => server.close((error) =>
    error ? rejectClose(error) : resolveClose())));

  const aReceipt = await fetchJson(baseUrl, "/workbench/runs", post(submission(0)));
  const a = await waitForStatus(service, aReceipt.body.run_id, "SUCCESS", 180_000);
  const bReceipt = await fetchJson(baseUrl, "/workbench/runs", post(submission(5)));
  const b = await waitForStatus(service, bReceipt.body.run_id, "SUCCESS", 180_000);
  const arReceipt = await fetchJson(baseUrl, `/workbench/runs/${aReceipt.body.run_id}/rerun`, post({}));
  const ar = await waitForStatus(service, aReceipt.body.run_id, "SUCCESS", 180_000);
  const aResults = await Promise.all(ar.attempt_history.map((attempt: any) => store.readResult({
    runId: aReceipt.body.run_id, executionAttemptId: attempt.execution_attempt_id,
  }))) as any[];
  assert.equal(aReceipt.body.run_id, arReceipt.body.run_id);
  assert.notEqual(aReceipt.body.execution_attempt_id, arReceipt.body.execution_attempt_id);
  assert.equal(aResults[0].financial_result_hash,
    "426533ad89ffb1ad72246a8c8ecdb2a6e7ad8e9d1c50f8e6db713d36e1af7e0d");
  assert.equal(aResults[0].financial_result_hash, aResults[1].financial_result_hash);
  assert.equal(a.latest_result.metrics.observations, 501);
  assert.equal(a.latest_result.metrics.final_research_index, 107.25445949277757);
  assert.equal(b.latest_result.financial_result_hash,
    "ed95b4e9782f942905539d37f3a655358e7f106c8162f6a905985288f53f40b8");
  assert.equal(b.latest_result.metrics.observations, 501);
  assert.equal(b.latest_result.costs.realized_transaction_cost, 0.1130073297533634);
  const compared = await fetchJson(baseUrl,
    `/workbench/compare?leftRunId=${aReceipt.body.run_id}&rightRunId=${bReceipt.body.run_id}`);
  assert.deepEqual(compared.body.spec_differences.map((item: { path: string }) => item.path),
    ["/transaction_cost_bps"]);
  assert.equal(compared.body.calculation, "READ_ONLY_NO_RECALCULATION");
});
