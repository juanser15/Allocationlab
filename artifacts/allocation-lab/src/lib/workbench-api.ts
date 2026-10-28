import { z } from "zod";

export const WORKBENCH_SESSION_TOKEN_KEY = "allocationlab.workbench.preview-token";
export const WORKBENCH_RESEARCH_BOUNDARY = "RESEARCH_ONLY" as const;
export const WORKBENCH_STORAGE_CLASSIFICATION = "TEMPORARY_RESEARCH_STORAGE" as const;
export const WORKBENCH_PIT_CLASSIFICATION =
  "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED" as const;

const boundarySchema = z.object({
  research_boundary: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
  storage_classification: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
  pit_classification: z.literal(WORKBENCH_PIT_CLASSIFICATION),
});

export const runStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED"]);
export type WorkbenchRunStatus = z.infer<typeof runStatusSchema>;

const fixedFieldSchema = z.object({
  field: z.string(),
  editable: z.literal(false),
  value: z.unknown(),
  type: z.enum(["string", "number", "array", "object"]),
  validation_rule: z.string(),
  default_source: z.string(),
  financial_meaning: z.string(),
  backend_mapping: z.string(),
  unsupported_reason: z.string(),
}).passthrough();

const editableFieldSchema = z.object({
  field: z.string(),
  editable: z.literal(true),
  type: z.literal("number"),
  allowed_values: z.array(z.number().finite()),
  validation_rule: z.string(),
  default_source: z.string(),
  financial_meaning: z.string(),
  backend_mapping: z.string(),
  unsupported_reason: z.null(),
}).passthrough();

export const workbenchCapabilitiesSchema = z.object({
  contract_version: z.string(),
  research_boundary: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
  pit_classification: z.literal(WORKBENCH_PIT_CLASSIFICATION),
  supported_research_modes: z.array(z.string()),
  supported_universe: z.array(z.string()),
  supported_validation_methods: z.array(z.string()),
  editable_fields: z.array(editableFieldSchema),
  fixed_fields: z.array(fixedFieldSchema),
  data_coverage: z.object({
    snapshot_id: z.string(),
    observations: z.number().int().positive(),
    coverage_start: z.string(),
    coverage_end: z.string(),
    configured_research_start: z.string(),
    configured_research_end_exclusive: z.string(),
    provenance_status: z.string(),
  }).passthrough(),
  engine_identity: z.object({
    entry_point: z.string(),
    engine_version: z.string(),
    certified_engine_commit: z.string(),
    adapter_version: z.string(),
  }).passthrough(),
  temporary_storage: z.object({
    status: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
    durability_claim: z.literal("NONE"),
    database: z.literal("NOT_USED"),
  }).passthrough(),
  execution_limits: z.object({
    maximum_concurrent_executions: z.number().int().positive(),
    maximum_immutable_attempts_per_run: z.number().int().positive(),
    timeout_ms: z.number().int().positive(),
    maximum_engine_output_bytes: z.number().int().positive(),
    maximum_log_bytes: z.number().int().positive(),
  }).passthrough(),
  blocked_modes: z.array(z.object({
    mode: z.string(),
    blocker_code: z.string(),
    human_explanation: z.string(),
  }).passthrough()),
  real_money_boundary: z.object({
    status: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
    prohibited_contracts: z.array(z.string()),
    state_non_implications: z.array(z.string()),
  }).passthrough(),
}).passthrough();
export type WorkbenchCapabilities = z.infer<typeof workbenchCapabilitiesSchema>;

export const researchRunSubmissionSchema = z.object({
  research_mode: z.literal("CAPITAL_MARKET_EXPOSURE"),
  execution_scope: z.literal("EMPIRICAL"),
  universe: z.literal("SPY"),
  validation_protocol: z.literal("TRADITIONAL_WALK_FORWARD"),
  transaction_cost_bps: z.union([z.literal(0), z.literal(5)]),
}).strict();
export type ResearchRunSubmission = z.infer<typeof researchRunSubmissionSchema>;

const submissionReceiptSchema = boundarySchema.extend({
  run_id: z.string().regex(/^rr_[0-9a-f]{64}$/),
  execution_attempt_id: z.string().regex(/^ea_[0-9a-f-]{36}$/),
  status: runStatusSchema,
  stage: z.string(),
  reused_existing_attempt: z.boolean(),
  execution_requested: z.boolean(),
});
export type WorkbenchSubmissionReceipt = z.infer<typeof submissionReceiptSchema>;

export const attemptSchema = z.object({
  run_id: z.string(),
  execution_attempt_id: z.string(),
  source: z.enum(["SUBMIT", "RERUN"]),
  requested_at: z.string(),
  status: runStatusSchema,
  stage: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  error_class: z.string().nullable(),
  error_message: z.string().nullable(),
  blocker: z.unknown().nullable(),
  runtime_diagnostic_reference: z.string(),
});
export type WorkbenchAttempt = z.infer<typeof attemptSchema>;

const metricsSchema = z.object({
  observations: z.number().int().nonnegative(),
  final_research_index: z.number().finite(),
  economic_claim: z.literal("NONE"),
}).passthrough();

const costsSchema = z.object({
  transaction_cost_bps: z.union([z.literal(0), z.literal(5)]),
  realized_transaction_cost: z.number().finite().nonnegative(),
  cost_basis: z.string(),
}).passthrough();

export const researchIndexPointSchema = z.object({
  date: z.string(),
  index: z.number().finite(),
  outer_fold: z.number().int().nonnegative(),
  candidate_id: z.string(),
  net_return: z.number().finite(),
  drawdown: z.number().finite(),
  exposure: z.number().finite(),
}).passthrough();
export type ResearchIndexPoint = z.infer<typeof researchIndexPointSchema>;

const timeSeriesSchema = z.object({
  status: z.literal("AVAILABLE"),
  meaning: z.string(),
  observations: z.number().int().nonnegative(),
  points: z.array(researchIndexPointSchema),
}).passthrough();

const outerFoldSchema = z.object({
  outer_fold: z.number().int().nonnegative(),
  train_start: z.string(),
  train_end: z.string(),
  test_start: z.string(),
  test_end: z.string(),
  candidate_id: z.string(),
}).passthrough();

const selectedJobSchema = z.object({
  outer_fold: z.number().int().nonnegative(),
  candidate_id: z.string(),
  job_hash: z.string(),
  result_hash: z.string(),
  fit_keys: z.array(z.string()),
}).passthrough();

const validationDiagnosticsSchema = z.object({
  mode: z.literal("TRADITIONAL_WALK_FORWARD"),
  outer_folds: z.array(outerFoldSchema),
  selected_jobs: z.array(selectedJobSchema),
  job_hashes: z.array(z.string()),
  result_hashes: z.array(z.string()),
  selected_candidates: z.array(z.string()),
}).passthrough();

export const researchRunResultSchema = z.object({
  run_id: z.string(),
  execution_attempt_id: z.string(),
  status: runStatusSchema,
  started_at: z.string(),
  completed_at: z.string(),
  stage: z.string(),
  pit_classification: z.literal(WORKBENCH_PIT_CLASSIFICATION),
  real_money_boundary: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
  storage_classification: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
  metrics: z.union([metricsSchema, z.string()]),
  time_series: z.union([timeSeriesSchema, z.string()]),
  costs: z.union([costsSchema, z.string()]),
  validation_diagnostics: z.union([validationDiagnosticsSchema, z.string()]),
  result_artifacts: z.array(z.object({ path: z.string(), sha256: z.string() }).passthrough()),
  warnings: z.array(z.string()),
  blockers: z.array(z.unknown()),
  error_class: z.string().nullable(),
  error_message: z.string().nullable(),
  provenance: z.record(z.string(), z.unknown()),
  reproducibility: z.union([z.record(z.string(), z.unknown()), z.string()]),
  financial_result_hash: z.string(),
  runtime_hash: z.string(),
}).passthrough();
export type ResearchRunResult = z.infer<typeof researchRunResultSchema>;

const runSpecSchema = z.object({
  run_id: z.string(),
  created_at: z.string(),
  research_mode: z.literal("CAPITAL_MARKET_EXPOSURE"),
  execution_scope: z.literal("EMPIRICAL"),
  universe: z.object({
    operated: z.tuple([z.literal("SPY")]),
    information: z.array(z.string()),
    user_change_supported: z.literal(false),
  }).passthrough(),
  start_date: z.literal("2020-01-01"),
  end_date: z.literal("2024-01-01"),
  rebalance_frequency: z.literal("monthly"),
  transaction_cost_bps: z.union([z.literal(0), z.literal(5)]),
  validation_protocol: z.object({
    contract_mode: z.literal("TRADITIONAL_WALK_FORWARD"),
  }).passthrough(),
}).passthrough();

export const runDetailSchema = boundarySchema.extend({
  run_id: z.string(),
  spec: runSpecSchema,
  attempt_history: z.array(attemptSchema),
  latest_status: runStatusSchema.nullable(),
  latest_attempt: attemptSchema.nullable(),
  latest_result: z.union([researchRunResultSchema, z.string()]),
  latest_successful_result: z.union([researchRunResultSchema, z.string()]),
  warnings: z.array(z.string()),
  blockers: z.array(z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
});
export type WorkbenchRunDetail = z.infer<typeof runDetailSchema>;

export const runListSchema = boundarySchema.extend({
  runs: z.array(z.object({
    run_id: z.string(),
    created_at: z.string(),
    latest_status: runStatusSchema.nullable(),
    latest_execution_attempt_id: z.string().nullable(),
    successful_execution_attempt_id: z.string().nullable(),
    transaction_cost_bps: z.union([z.literal(0), z.literal(5)]),
  })),
});
export type WorkbenchRunList = z.infer<typeof runListSchema>;

const specDifferenceSchema = z.object({
  path: z.string(),
  left: z.unknown(),
  right: z.unknown(),
});

export const comparisonSchema = boundarySchema.extend({
  comparison_id: z.string(),
  calculation: z.literal("READ_ONLY_NO_RECALCULATION"),
  left: z.object({
    run_id: z.string(),
    execution_attempt_id: z.string(),
    financial_result_hash: z.string(),
  }),
  right: z.object({
    run_id: z.string(),
    execution_attempt_id: z.string(),
    financial_result_hash: z.string(),
  }),
  spec_differences: z.array(specDifferenceSchema),
  financial_input_differences: z.array(specDifferenceSchema),
  transaction_cost_difference_bps: z.number().finite(),
  oos_observation_difference: z.number().finite(),
  final_research_index_difference: z.number().finite(),
  realized_cost_difference: z.number().finite(),
  warnings: z.array(z.string()),
});
export type WorkbenchComparison = z.infer<typeof comparisonSchema>;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).passthrough(),
}).passthrough();

export class WorkbenchApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkbenchApiError";
  }
}
export function validatePhaseB2Capabilities(capabilities: WorkbenchCapabilities): string[] {
  const problems: string[] = [];
  const exact = (actual: readonly unknown[], expected: readonly unknown[]) =>
    actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  if (!exact(capabilities.supported_research_modes, ["CAPITAL_MARKET_EXPOSURE"]))
    problems.push("supported research mode");
  if (!exact(capabilities.supported_universe, ["SPY"])) problems.push("supported universe");
  if (!exact(capabilities.supported_validation_methods, ["TRADITIONAL_WALK_FORWARD"]))
    problems.push("validation method");
  const editable = capabilities.editable_fields.filter((item) => item.editable);
  if (editable.length !== 1 || editable[0]?.field !== "transaction_cost_bps" ||
      !exact(editable[0]?.allowed_values ?? [], [0, 5])) problems.push("transaction cost allowlist");
  if (capabilities.temporary_storage.status !== WORKBENCH_STORAGE_CLASSIFICATION)
    problems.push("temporary storage classification");
  if (capabilities.pit_classification !== WORKBENCH_PIT_CLASSIFICATION)
    problems.push("PIT classification");
  if (capabilities.execution_limits.maximum_concurrent_executions !== 1)
    problems.push("maximum concurrent executions");
  const fixed = new Map(capabilities.fixed_fields.map((field) => [field.field, field.value]));
  const requiredFixed: Array<[string, unknown]> = [
    ["start_date", "2020-01-01"],
    ["end_date", "2024-01-01"],
    ["rebalance_frequency", "monthly"],
    ["benchmark", "NOT_SUPPORTED"],
  ];
  for (const [field, expected] of requiredFixed)
    if (fixed.get(field) !== expected) problems.push(`fixed ${field}`);
  return problems;
}

type FetchImplementation = typeof fetch;

export class WorkbenchApiClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchImplementation = (input, init) => fetch(input, init),
  ) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    acceptedErrorStatuses: readonly number[] = [],
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${this.token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(path, { ...init, headers });
    const text = await response.text();
    let body: unknown;
    try { body = text.length === 0 ? {} : JSON.parse(text); }
    catch { throw new WorkbenchApiError(response.status, "INVALID_JSON_RESPONSE", "The research service returned an unreadable response."); }
    if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
      const parsed = errorEnvelopeSchema.safeParse(body);
      throw new WorkbenchApiError(
        response.status,
        parsed.success ? parsed.data.error.code : "WORKBENCH_REQUEST_FAILED",
        parsed.success ? parsed.data.error.message : `Workbench request failed (${response.status}).`,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new WorkbenchApiError(502, "WORKBENCH_RESPONSE_CONTRACT_MISMATCH", "The research service response does not match the supported UI contract.");
    return parsed.data;
  }

  getCapabilities(): Promise<WorkbenchCapabilities> {
    return this.request("/api/workbench/capabilities", workbenchCapabilitiesSchema);
  }

  submitRun(spec: ResearchRunSubmission): Promise<WorkbenchSubmissionReceipt> {
    const exact = researchRunSubmissionSchema.parse(spec);
    return this.request("/api/workbench/runs", submissionReceiptSchema, {
      method: "POST",
      body: JSON.stringify(exact),
    }, [429]);
  }

  listRuns(): Promise<WorkbenchRunList> {
    return this.request("/api/workbench/runs", runListSchema);
  }

  getRun(runId: string): Promise<WorkbenchRunDetail> {
    return this.request(`/api/workbench/runs/${encodeURIComponent(runId)}`, runDetailSchema);
  }

  rerun(runId: string): Promise<WorkbenchSubmissionReceipt> {
    return this.request(`/api/workbench/runs/${encodeURIComponent(runId)}/rerun`, submissionReceiptSchema, {
      method: "POST",
      body: "{}",
    }, [429]);
  }

  compareRuns(leftRunId: string, rightRunId: string): Promise<WorkbenchComparison> {
    const query = new URLSearchParams({ leftRunId, rightRunId });
    return this.request(`/api/workbench/compare?${query.toString()}`, comparisonSchema);
  }
}
