import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WorkbenchApiClient,
  WorkbenchApiError,
  WORKBENCH_PIT_CLASSIFICATION,
  WORKBENCH_RESEARCH_BOUNDARY,
  WORKBENCH_STORAGE_CLASSIFICATION,
  researchRunResultSchema,
  validatePhaseB2Capabilities,
  workbenchCapabilitiesSchema,
} from "./workbench-api.ts";
import {
  ADVANCED_DETAILS_DEFAULT_OPEN,
  attemptFinancialHash,
  buildResearchRunSubmission,
  isTerminalStatus,
  primaryResultSummary,
  researchIndexPoints,
  safeUiError,
  shouldPollRun,
  walkForwardRows,
} from "./workbench-state.ts";

const boundary = {
  research_boundary: WORKBENCH_RESEARCH_BOUNDARY,
  storage_classification: WORKBENCH_STORAGE_CLASSIFICATION,
  pit_classification: WORKBENCH_PIT_CLASSIFICATION,
};

const capabilities = workbenchCapabilitiesSchema.parse({
  contract_version: "workbench-capabilities-1.0.0",
  research_boundary: WORKBENCH_RESEARCH_BOUNDARY,
  pit_classification: WORKBENCH_PIT_CLASSIFICATION,
  supported_research_modes: ["CAPITAL_MARKET_EXPOSURE"],
  supported_universe: ["SPY"],
  supported_validation_methods: ["TRADITIONAL_WALK_FORWARD"],
  editable_fields: [{
    field: "transaction_cost_bps", editable: true, type: "number", allowed_values: [0, 5],
    validation_rule: "exact", default_source: "USER_SUPPLIED", financial_meaning: "cost",
    backend_mapping: "campaign scenario", unsupported_reason: null,
  }],
  fixed_fields: [
    ["start_date", "2020-01-01"], ["end_date", "2024-01-01"],
    ["rebalance_frequency", "monthly"], ["benchmark", "NOT_SUPPORTED"],
  ].map(([field, value]) => ({
    field, value, editable: false, type: "string", validation_rule: "fixed",
    default_source: "SAVED_CONFIGURATION", financial_meaning: "fixed context",
    backend_mapping: "campaign", unsupported_reason: "not editable",
  })),
  data_coverage: {
    snapshot_id: "cl02-adjusted-closes-b4a4fa0e0ddb", observations: 4023,
    coverage_start: "2010-10-01", coverage_end: "2026-09-30",
    configured_research_start: "2020-01-01", configured_research_end_exclusive: "2024-01-01",
    provenance_status: "VENDOR_AUTHENTICITY_AND_DATA_VINTAGE_UNVERIFIED",
  },
  engine_identity: {
    entry_point: "research/capital/engine.ts::runCampaign", engine_version: "capital-research-1.0.1",
    certified_engine_commit: "b9950f7cbe128f9d761597a5e216d777cc3059a3",
    adapter_version: "workbench-b1-capital-adapter-1.0.0",
  },
  temporary_storage: { status: WORKBENCH_STORAGE_CLASSIFICATION, durability_claim: "NONE", database: "NOT_USED" },
  execution_limits: {
    maximum_concurrent_executions: 1, maximum_immutable_attempts_per_run: 100,
    timeout_ms: 120000, maximum_engine_output_bytes: 67108864, maximum_log_bytes: 1048576,
  },
  blocked_modes: [{ mode: "ASSET_ALLOCATION", blocker_code: "OUTSIDE_PHASE_B1_EXECUTION_ALLOWLIST", human_explanation: "Not supported." }],
  real_money_boundary: { status: WORKBENCH_RESEARCH_BOUNDARY, prohibited_contracts: ["ORDER_OBJECT"], state_non_implications: ["AUTHORIZED"] },
});
const runIdA = `rr_${"a".repeat(64)}`;
const runIdB = `rr_${"b".repeat(64)}`;
const attemptA = "ea_11111111-1111-4111-8111-111111111111";

const result = researchRunResultSchema.parse({
  run_id: runIdA, execution_attempt_id: attemptA, status: "SUCCESS",
  started_at: "2026-10-20T12:00:00.000Z", completed_at: "2026-10-20T12:00:01.000Z",
  stage: "OUTER_OOS_AGGREGATE", pit_classification: WORKBENCH_PIT_CLASSIFICATION,
  real_money_boundary: WORKBENCH_RESEARCH_BOUNDARY, storage_classification: WORKBENCH_STORAGE_CLASSIFICATION,
  metrics: { observations: 501, final_research_index: 107.25445949277757, economic_claim: "NONE" },
  costs: { transaction_cost_bps: 0, realized_transaction_cost: 0, cost_basis: "actual absolute traded notional" },
  time_series: { status: "AVAILABLE", meaning: "OOS", observations: 2, points: [
    { date: "2022-01-03", index: 100, outer_fold: 0, candidate_id: "candidate-a", net_return: 0, drawdown: 0, exposure: 1 },
    { date: "2022-01-04", index: 100.1, outer_fold: 0, candidate_id: "candidate-a", net_return: .001, drawdown: 0, exposure: 1 },
  ] },
  validation_diagnostics: { mode: "TRADITIONAL_WALK_FORWARD", outer_folds: [
    { outer_fold: 0, train_start: "2020-01-01", train_end: "2022-01-01", test_start: "2022-01-01", test_end: "2023-01-01", candidate_id: "candidate-a" },
  ], selected_jobs: [{ outer_fold: 0, candidate_id: "candidate-a", job_hash: "job", result_hash: "result", fit_keys: ["fit"] }], job_hashes: ["job"], result_hashes: ["result"], selected_candidates: ["candidate-a"] },
  result_artifacts: [], warnings: [WORKBENCH_PIT_CLASSIFICATION], blockers: [], error_class: null,
  error_message: null, provenance: { engine_version: "capital-research-1.0.1" },
  reproducibility: { financial_result_hash: "financial-a" }, financial_result_hash: "financial-a", runtime_hash: "runtime-a",
});

function receipt(runId = runIdA, status = "RUNNING") {
  return { ...boundary, run_id: runId, execution_attempt_id: attemptA, status, stage: "EMPIRICAL_EXECUTION", reused_existing_attempt: false, execution_requested: true };
}

test("A/B/C/P: capability gate accepts only the single certified vertical slice and visible boundaries", () => {
  assert.deepEqual(validatePhaseB2Capabilities(capabilities), []);
  assert.deepEqual(validatePhaseB2Capabilities({ ...capabilities, supported_universe: ["SPY", "QQQ"] }), ["supported universe"]);
  assert.deepEqual(validatePhaseB2Capabilities({ ...capabilities, editable_fields: [{ ...capabilities.editable_fields[0], allowed_values: [0, 5, 10] }] }), ["transaction cost allowlist"]);
  assert.equal(capabilities.temporary_storage.status, WORKBENCH_STORAGE_CLASSIFICATION);
  assert.equal(capabilities.pit_classification, WORKBENCH_PIT_CLASSIFICATION);
});

test("C/D/E: submission is exactly five fields and uses the real Phase B1 route", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const mockedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify(receipt()), { status: 202, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new WorkbenchApiClient("injected-test-token", mockedFetch);
  await client.submitRun(buildResearchRunSubmission(0));
  assert.equal(calls[0].input, "/api/workbench/runs");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    research_mode: "CAPITAL_MARKET_EXPOSURE", execution_scope: "EMPIRICAL", universe: "SPY",
    validation_protocol: "TRADITIONAL_WALK_FORWARD", transaction_cost_bps: 0,
  });
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer injected-test-token");
});

test("F/H: bounded polling stops at terminal state or timeout and capacity never implies auto-retry", () => {
  const detail = { latest_status: "RUNNING" } as any;
  assert.equal(shouldPollRun(detail, 1_000, 2_000), true);
  assert.equal(shouldPollRun({ latest_status: "SUCCESS" } as any, 1_000, 2_000), false);
  assert.equal(shouldPollRun(detail, 1_000, 400_000), false);
  assert.equal(isTerminalStatus("BLOCKED"), true);
  const capacity = safeUiError(new WorkbenchApiError(429, "BLOCKED_EXECUTION_CAPACITY", "blocked"));
  assert.match(capacity.nextAction, /will not retry automatically/i);
});

test("G/I/J/K: successful API evidence drives the primary values and chart without invented metrics", () => {
  assert.deepEqual(primaryResultSummary(result), {
    observations: 501, finalResearchIndex: 107.25445949277757,
    realizedSimulatedCost: 0, transactionCostBps: 0, status: "SUCCESS",
  });
  assert.equal(researchIndexPoints(result).length, 2);
  assert.deepEqual(Object.keys(primaryResultSummary(result) ?? {}).sort(), [
    "finalResearchIndex", "observations", "realizedSimulatedCost", "status", "transactionCostBps",
  ]);
  assert.deepEqual(walkForwardRows(result)[0], {
    fold: 0, trainingInterval: "2020-01-01 – 2022-01-01 (exclusive)",
    oosInterval: "2022-01-01 – 2023-01-01 (exclusive)", candidate: "candidate-a",
    fitKeys: ["fit"], observationCount: 2,
  });
});

test("L/M: rerun uses an empty body and attempt evidence remains immutable and separately addressable", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const mockedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify(receipt()), { status: 202 });
  }) as typeof fetch;
  await new WorkbenchApiClient("token", mockedFetch).rerun(runIdA);
  assert.equal(calls[0].input, `/api/workbench/runs/${runIdA}/rerun`);
  assert.equal(calls[0].init?.body, "{}");
  const detail = { latest_result: result, latest_successful_result: result } as any;
  assert.equal(attemptFinancialHash({ execution_attempt_id: attemptA } as any, detail), "financial-a");
  assert.equal(attemptFinancialHash({ execution_attempt_id: "earlier" } as any, detail), "NOT_SUPPORTED");
});

test("N/O: compare calls the read-only route and the client contract has no winner field", async () => {
  let requested = "";
  const mockedFetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(JSON.stringify({ ...boundary, comparison_id: "cmp_1", calculation: "READ_ONLY_NO_RECALCULATION", left: { run_id: runIdA, execution_attempt_id: attemptA, financial_result_hash: "a" }, right: { run_id: runIdB, execution_attempt_id: attemptA, financial_result_hash: "b" }, spec_differences: [{ path: "/transaction_cost_bps", left: 0, right: 5 }], financial_input_differences: [{ path: "/transaction_cost_bps", left: 0, right: 5 }], transaction_cost_difference_bps: 5, oos_observation_difference: 0, final_research_index_difference: -0.1, realized_cost_difference: 0.1, warnings: ["No ranking"] }), { status: 200 });
  }) as typeof fetch;
  const compared = await new WorkbenchApiClient("token", mockedFetch).compareRuns(runIdA, runIdB);
  assert.match(requested, /^\/api\/workbench\/compare\?/);
  assert.equal(compared.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.equal(Object.prototype.hasOwnProperty.call(compared, "winner"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compared, "recommendation"), false);
});

test("Q/T/V: advanced evidence is collapsed, no execution controls exist, and legacy routes remain", async () => {
  assert.equal(ADVANCED_DETAILS_DEFAULT_OPEN, false);
  const page = await readFile("artifacts/allocation-lab/src/pages/workbench.tsx", "utf8");
  const app = await readFile("artifacts/allocation-lab/src/App.tsx", "utf8");
  assert.doesNotMatch(page, />\s*(TRADE|PLACE ORDER|AUTHORIZE CAPITAL)\s*</i);
  assert.match(app, /path="\/workbench"/);
  for (const route of ["/", "/portfolio-lab", "/investment-committee", "/etf/:ticker"])
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
});
