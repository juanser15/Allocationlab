import { z } from "zod";
export const SPEC = "allocationlab-interactive-spec-3.0.0";
export const TURNOVER = "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2";
const boundary = {
  research_boundary: z.literal("RESEARCH_ONLY"),
  storage_classification: z.literal("TEMPORARY_RESEARCH_STORAGE"),
  pit_classification: z.literal(
    "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED",
  ),
};
export const requestSchema = z
  .object({
    contract_version: z.literal(SPEC),
    research_mode: z.literal("CAPITAL_MARKET_EXPOSURE"),
    execution_scope: z.literal("EMPIRICAL"),
    universe: z.literal("SPY"),
    validation_protocol: z.literal("TRADITIONAL_WALK_FORWARD"),
    evaluation_start: z.string(),
    evaluation_end_exclusive: z.string(),
    window_type: z.enum(["ROLLING", "EXPANDING"]),
    training_window_months: z.number().int().positive(),
    rebalance_frequency: z.enum(["MONTHLY", "QUARTERLY"]),
    transaction_cost_bps: z.number().finite().nonnegative(),
    selection_cost_bps: z.number().finite().nonnegative(),
    turnover_constraint_methodology_version: z.literal(TURNOVER),
  })
  .strict();
export type RequestSpec = z.infer<typeof requestSchema>;
export const capabilitiesSchema = z
  .object({
    ...boundary,
    contract_version: z.literal("allocationlab-interactive-capabilities-3.0.0"),
    supported_spec_version: z.literal(SPEC),
    supported_modes: z.tuple([z.literal("CAPITAL_MARKET_EXPOSURE")]),
    supported_universe: z.tuple([z.literal("SPY")]),
    data_first_observation: z.string(),
    data_last_observation: z.string(),
    supported_evaluation_end_max: z.string(),
    supported_window_types: z.array(z.enum(["ROLLING", "EXPANDING"])),
    supported_rebalance_frequencies: z.array(z.enum(["MONTHLY", "QUARTERLY"])),
    date_rules: z
      .object({
        arbitrary_calendar_dates: z.literal(true),
        trading_day_rule: z.literal("NEXT_TRADING_DAY"),
        to_is_exclusive: z.literal(true),
      })
      .passthrough(),
    training_window_rules: z
      .object({
        minimum_months: z.number(),
        maximum_months: z.number(),
        minimum_training_observations: z.number(),
        warmup_observations: z.number(),
      })
      .passthrough(),
    cost_rules: z
      .object({
        minimum: z.literal(0),
        finite: z.literal(true),
        standard_mode: z.literal("SELECTION_EQUALS_OOS"),
      })
      .passthrough(),
    model_definition: z.record(z.string(), z.unknown()),
    resource_limits: z
      .object({
        max_jobs: z.number(),
        max_engine_files: z.number(),
        timeout_ms: z.number(),
        max_output_bytes: z.number(),
        maximum_concurrent_executions: z.literal(1),
      })
      .passthrough(),
    comparison: z.object({
      maximum_table_runs: z.number(),
      maximum_displayed_curves: z.number(),
    }),
    code_version: z.string(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export const foldSchema = z.object({
  fold_id: z.number(),
  training_start: z.string(),
  training_end_exclusive: z.string(),
  decision_date: z.string(),
  information_cutoff: z.string(),
  oos_start: z.string(),
  oos_end_exclusive: z.string(),
  intended_rebalance_date: z.string(),
  training_observations: z.number(),
  warmup_observations: z.number(),
  oos_observations: z.number(),
  partial_final_period: z.boolean(),
});
export const planSchema = z
  .object({
    ...boundary,
    normalized_request: requestSchema,
    folds: z.array(foldSchema),
    number_of_folds: z.number(),
    total_work_units: z.number(),
    plan_hash: z.string(),
    warnings: z.array(z.string()),
  })
  .passthrough();
export type Plan = z.infer<typeof planSchema>;
export const pointSchema = z
  .object({
    date: z.string(),
    index: z.number().finite(),
    drawdown: z.number().finite(),
    spy_exposure: z.number().finite(),
    cash_allocation: z.number().finite(),
    fold_id: z.number(),
  })
  .passthrough();
export type Point = z.infer<typeof pointSchema>;
const diagnosticMetric = z
  .object({ value: z.number().nullable() })
  .passthrough();
export const metricSchema = z
  .object({
    observations: z.number(),
    cagr: z.number().finite(),
    annualized_volatility: z.number().finite(),
    max_drawdown: z.number().finite(),
    net_sharpe: z.number().finite().nullable(),
    final_research_index: z.number().finite(),
    average_risky_exposure: z.number().finite(),
    average_cash_allocation: z.number().finite(),
    gross_turnover: z.number().finite(),
    realized_simulated_cost: z.number().finite(),
    full_sample_beta: diagnosticMetric,
    upside_beta: diagnosticMetric,
    downside_beta: diagnosticMetric,
    upside_capture: diagnosticMetric,
    downside_capture: diagnosticMetric,
  })
  .passthrough();
export type Metrics = z.infer<typeof metricSchema>;
export const resultSchema = z
  .object({
    ...boundary,
    status: z.literal("SUCCESS"),
    run_id: z.string(),
    execution_attempt_id: z.string(),
    plan: planSchema,
    metrics: metricSchema,
    benchmark_tracks: z.record(z.string(), z.array(pointSchema)),
    benchmark_metrics: z.record(
      z.string(),
      z.union([metricSchema, z.literal("NOT_SUPPORTED")]),
    ),
    turnover: z.record(
      z.string(),
      z.union([
        z.object({
          initial_implementation_turnover: z.number(),
          recurring_gross_turnover: z.number(),
          total_gross_turnover: z.number(),
        }),
        z.literal("NOT_SUPPORTED"),
      ]),
    ),
    attribution: z.union([
      z.object({
        total_dynamic_effect_cagr_difference: z.number(),
        exposure_level_effect_cagr_difference: z.number(),
        timing_residual_cagr_difference: z.number(),
      }),
      z.literal("NOT_SUPPORTED"),
    ]),
    financial_result_hash: z.string(),
    selected_policy_by_fold: z.array(z.record(z.string(), z.unknown())),
    warnings: z.array(z.string()),
    provenance: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export type Result = z.infer<typeof resultSchema>;
const statusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "BLOCKED",
]);
export const progressSchema = z.object({
  status: z.string(),
  stage: z.string(),
  completed_work_units: z.number().nonnegative(),
  total_work_units: z.number().positive(),
  percent_complete: z.number().min(0).max(100),
  current_fold: z.number(),
  total_folds: z.number(),
  completed_candidates: z.number(),
  total_candidates: z.number(),
  elapsed_ms: z.number().nonnegative(),
  estimated_remaining_ms: z.number().nonnegative().nullable(),
  eta_confidence: z.enum(["ESTIMATING", "LOW", "OBSERVED"]),
});
const attemptSchema = z.object({
  attempt: z.object({
    run_id: z.string(),
    execution_attempt_id: z.string(),
    requested_at: z.string(),
    source: z.string(),
  }),
  status: statusSchema,
  stage: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  terminal: z.unknown(),
});
export const detailSchema = z.object({
  ...boundary,
  run_id: z.string(),
  created_at: z.string(),
  spec: requestSchema.passthrough(),
  latest_status: statusSchema.nullable(),
  latest_attempt: attemptSchema.nullable(),
  attempt_history: z.array(attemptSchema),
  latest_result: z.unknown(),
  latest_successful_result: z.unknown(),
  progress: progressSchema.nullable(),
});
export type Detail = z.infer<typeof detailSchema>;
export const receiptSchema = z.object({
  ...boundary,
  run_id: z.string(),
  execution_attempt_id: z.string(),
  status: statusSchema,
  reused_existing_attempt: z.boolean(),
  execution_requested: z.boolean(),
});
export const listSchema = z.object({
  ...boundary,
  runs: z.array(
    z.object({
      run_id: z.string(),
      created_at: z.string(),
      spec: requestSchema.passthrough(),
      status: statusSchema.nullable(),
      latest_attempt: attemptSchema.nullable(),
      metrics: z.union([metricSchema, z.literal("NOT_SUPPORTED")]),
      fold_count: z.number().nullable(),
    }),
  ),
});
export type RunRow = z.infer<typeof listSchema>["runs"][number];
export const comparisonSchema = z.object({
  ...boundary,
  calculation: z.literal("READ_ONLY_NO_RECALCULATION"),
  warnings: z.array(z.string()),
  display_curve_limit: z.number(),
  configuration_matrix: z.array(
    z.object({
      field: z.string(),
      differs: z.boolean(),
      values: z.array(z.object({ run_id: z.string(), value: z.unknown() })),
    }),
  ),
  runs: z.array(
    z.object({
      run_id: z.string(),
      execution_attempt_id: z.string(),
      latest_status: statusSchema.nullable(),
      comparison_attempt_status: z.literal("SUCCESS"),
      spec: requestSchema.passthrough(),
      metrics: metricSchema,
      turnover: z.object({
        initial_implementation_turnover: z.number(),
        recurring_gross_turnover: z.number(),
        total_gross_turnover: z.number(),
      }),
      fold_count: z.number(),
      points: z.array(pointSchema),
      financial_result_hash: z.string(),
    }),
  ),
});
export type Comparison = z.infer<typeof comparisonSchema>;
export class ResearchApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = {},
  ) {
    super(message);
  }
}
export class ResearchClient {
  constructor(private token: string) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const r = await fetch("/api/workbench/interactive" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const json = await r.json();
    if (!r.ok)
      throw new ResearchApiError(
        r.status,
        json.error?.code ?? "REQUEST_FAILED",
        json.error?.message ?? "The research request could not be completed.",
        json.error?.issues ?? {},
      );
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ResearchApiError(
        502,
        "CAPABILITY_CONTRACT_MISMATCH",
        "The service returned an incompatible research contract. Execution is unavailable until the preview owner checks the service.",
      );
    return parsed.data;
  }
  capabilities() {
    return this.request("/capabilities", capabilitiesSchema);
  }
  plan(spec: RequestSpec) {
    return this.request("/plan", planSchema, spec);
  }
  submit(spec: RequestSpec) {
    return this.request("/runs", receiptSchema, spec);
  }
  list() {
    return this.request("/runs", listSchema);
  }
  get(id: string) {
    return this.request("/runs/" + encodeURIComponent(id), detailSchema);
  }
  rerun(id: string) {
    return this.request(
      "/runs/" + encodeURIComponent(id) + "/rerun",
      receiptSchema,
      {},
    );
  }
  compare(ids: string[]) {
    return this.request("/compare", comparisonSchema, { run_ids: ids });
  }
}
