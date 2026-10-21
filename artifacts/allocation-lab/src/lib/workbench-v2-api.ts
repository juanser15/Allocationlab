import { z } from "zod";
import { failureFields } from "./workbench-failure";
import {
  exposureModelSchema,
  attributionFields,
} from "./workbench-attribution-api";
import {
  WorkbenchApiError,
  WORKBENCH_PIT_CLASSIFICATION,
  WORKBENCH_RESEARCH_BOUNDARY,
  WORKBENCH_STORAGE_CLASSIFICATION,
  attemptSchema,
  researchIndexPointSchema,
  runStatusSchema,
} from "./workbench-api";

export const SPEC_V2 = "workbench-research-run-spec-2.0.0" as const;
export const PRODUCT_SPEC = "workbench-research-run-spec-2.1.0" as const;
export const RECURRING_V2 = "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2" as const;
const specVersion = z.enum([SPEC_V2, PRODUCT_SPEC]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonnegative = z.number().finite().nonnegative();
const boundary = z.object({
  research_boundary: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
  storage_classification: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
  pit_classification: z.literal(WORKBENCH_PIT_CLASSIFICATION),
});
export const submissionV2Schema = z
  .object({
    contract_version: z.literal(SPEC_V2),
    research_mode: z.literal("CAPITAL_MARKET_EXPOSURE"),
    execution_scope: z.literal("EMPIRICAL"),
    universe: z.literal("SPY"),
    validation_protocol: z.literal("TRADITIONAL_WALK_FORWARD"),
    evaluation_start: date,
    evaluation_end_exclusive: date,
    window_type: z.enum(["ROLLING", "EXPANDING"]),
    training_window_months: z.number().int().positive(),
    rebalance_frequency: z.enum(["MONTHLY", "QUARTERLY"]),
    transaction_cost_bps: nonnegative,
    selection_cost_bps: nonnegative,
  })
  .strict();
export const productSubmissionSchema = submissionV2Schema.extend({ contract_version: z.literal(PRODUCT_SPEC), turnover_constraint_methodology_version: z.literal(RECURRING_V2) }).strict();
export const versionedSubmissionSchema = z.union([submissionV2Schema, productSubmissionSchema]);
export type SubmissionV2 = Omit<z.infer<typeof submissionV2Schema>, "contract_version"> & { contract_version: typeof SPEC_V2 | typeof PRODUCT_SPEC; turnover_constraint_methodology_version?: typeof RECURRING_V2 };

export const capabilitiesV2Schema = boundary
  .extend({
    contract_version: z.literal("workbench-capabilities-2.0.0"),
    supported_spec_version: specVersion,
    turnover_constraint_methodology_version: z.literal(RECURRING_V2).optional(),
    supported_research_modes: z.array(z.string()),
    supported_universe: z.array(z.string()),
    supported_validation_methods: z.array(z.string()),
    data_first_observation: date,
    data_last_observation: date,
    supported_evaluation_start_min: date,
    supported_evaluation_end_max: date,
    earliest_complete_training_start: date,
    evaluation_start_min_rule: z.string(),
    supported_window_types: z
      .array(z.enum(["ROLLING", "EXPANDING"]))
      .nonempty(),
    supported_rebalance_frequencies: z
      .array(z.enum(["MONTHLY", "QUARTERLY"]))
      .nonempty(),
    training_window_rules: z
      .object({
        required: z.literal(true),
        positive_integer_months: z.literal(true),
        maximum_months: z.number().int().positive(),
        minimum_training_observations: nonnegative,
        model_fit_required_observations: nonnegative,
        model_fit: z.string(),
        selection_score: z.string(),
        model_warmup_observations_before_training: nonnegative,
        no_automatic_extension: z.literal(true),
      })
      .passthrough(),
    date_rules: z
      .object({
        evaluation_is_oos: z.literal(true),
        month_start_required: z.boolean(),
        quarterly_start: z.string(),
        complete_folds_required: z.literal(true),
        no_date_adjustment: z.literal(true),
      })
      .passthrough(),
    transaction_cost_rules: z
      .object({
        fields: z.array(z.string()),
        required: z.literal(true),
        finite: z.literal(true),
        minimum: nonnegative,
        rounding: z.literal("NONE"),
        selection_and_oos_distinct: z.literal(true),
      })
      .passthrough(),
    timing_semantics: z.object({
      oos_horizon_source: z.literal("REBALANCE_FREQUENCY"),
      step_source: z.literal("REBALANCE_FREQUENCY"),
      recalibration_source: z.literal("REBALANCE_FREQUENCY"),
      monthly_months: z.number().int().positive(),
      quarterly_months: z.number().int().positive(),
    }),
    editable_fields: z.array(
      z
        .object({
          field: z.string(),
          editable: z.literal(true),
          required: z.literal(true),
          default_source: z.literal("USER_SUPPLIED"),
          default_value: z.literal("NO_DEFAULT"),
          validation_rule: z.string(),
        })
        .passthrough(),
    ),
    engine_identity: z
      .object({
        version: z.string(),
        certified_engine_commit: z.string(),
        adapter_version: z.string(),
        code_version: z.string(),
      })
      .passthrough(),
    temporary_storage: z.object({
      status: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
      durability: z.literal("NONE"),
    }),
    resource_limits: z.object({
      maximum_concurrent_executions: z.literal(1),
      max_jobs: z.number().int().positive(),
      timeout_ms: z.number().int().positive(),
      max_output_bytes: z.number().int().positive(),
      max_engine_files: z.number().int().positive().optional(),
    }),
    warnings: z.array(z.string()),
    model_definition: exposureModelSchema.optional(),
    benchmark_methodology_version: z.string().optional(),
  })
  .passthrough();
export type CapabilitiesV2 = z.infer<typeof capabilitiesV2Schema>;
export const DESIGN_FIELDS = [
  "evaluation_start",
  "evaluation_end_exclusive",
  "window_type",
  "training_window_months",
  "rebalance_frequency",
  "transaction_cost_bps",
  "selection_cost_bps",
] as const;
export function capabilityProblemsV2(c: CapabilitiesV2): string[] {
  const same = (a: string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const issues: string[] = [];
  if (c.supported_spec_version === PRODUCT_SPEC && c.turnover_constraint_methodology_version !== RECURRING_V2) issues.push("turnover methodology");
  if (!same(c.supported_research_modes, ["CAPITAL_MARKET_EXPOSURE"]))
    issues.push("research mode");
  if (!same(c.supported_universe, ["SPY"])) issues.push("universe");
  if (!same(c.supported_validation_methods, ["TRADITIONAL_WALK_FORWARD"]))
    issues.push("validation method");
  if (
    !same(
      c.editable_fields.map((f) => f.field),
      DESIGN_FIELDS,
    )
  )
    issues.push("editable fields");
  if (
    !same(c.transaction_cost_rules.fields, [
      "transaction_cost_bps",
      "selection_cost_bps",
    ])
  )
    issues.push("separate cost fields");
  if (
    c.timing_semantics.monthly_months !== 1 ||
    c.timing_semantics.quarterly_months !== 3
  )
    issues.push("timing contract");
  return issues;
}

export const foldV2Schema = z
  .object({
    fold_id: z.number().int().nonnegative(),
    training_start: date,
    training_end_exclusive: date,
    decision_date: date,
    information_cutoff: date,
    oos_start: date,
    oos_end_exclusive: date,
    rebalance_frequency: z.enum(["MONTHLY", "QUARTERLY"]),
    window_type: z.enum(["ROLLING", "EXPANDING"]),
    training_observations: nonnegative,
    warmup_observations: nonnegative,
    oos_observations: nonnegative,
  })
  .strict();
export type FoldV2 = z.infer<typeof foldV2Schema>;
export const planV2Schema = boundary
  .extend({
    contract_version: specVersion,
    normalized_request: versionedSubmissionSchema,
    derived_engine_calendar: z.object({
      dates: z.object({ start: date, end_exclusive: date }),
      train_months: z.number().int().positive(),
      test_months: z.number().int().positive(),
      step_months: z.number().int().positive(),
      window_type: z.enum(["rolling", "expanding"]),
      rebalance_frequency: z.enum(["monthly", "quarterly"]),
      recalibration_frequency: z.enum(["monthly", "quarterly"]),
    }),
    number_of_folds: z.number().int().positive(),
    first_training_date: date,
    first_oos_date: date,
    last_oos_date: date,
    folds: z.array(foldV2Schema).nonempty(),
    estimated_jobs: z
      .object({ total_jobs_estimated: nonnegative })
      .passthrough(),
    warnings: z.array(z.string()),
    blockers: z.array(z.unknown()),
  })
  .passthrough();
export type PlanV2 = z.infer<typeof planV2Schema>;
export const normalizedSpecV2Schema = z.union([submissionV2Schema.passthrough(), productSubmissionSchema.passthrough()]);
const evaluationSchema = z.object({
  evaluation_start: date,
  evaluation_end_exclusive: date,
  fold_count: z.number().int().positive(),
  window_type: z.enum(["ROLLING", "EXPANDING"]),
  training_window_months: z.number().int().positive(),
  rebalance_frequency: z.enum(["MONTHLY", "QUARTERLY"]),
});
const optionalMetric = z
  .union([z.number().finite(), z.null(), z.literal("NOT_SUPPORTED")])
  .optional();
export const resultV2Schema = z
  .object({
    ...failureFields,
    ...attributionFields,
    contract_version: z.enum(["workbench-research-run-result-2.0.0", "workbench-research-run-result-2.1.0"]),
    run_id: z.string(),
    execution_attempt_id: z.string(),
    status: runStatusSchema,
    started_at: z.string(),
    completed_at: z.string(),
    stage: z.string(),
    real_money_boundary: z.literal(WORKBENCH_RESEARCH_BOUNDARY),
    storage_classification: z.literal(WORKBENCH_STORAGE_CLASSIFICATION),
    pit_classification: z.literal(WORKBENCH_PIT_CLASSIFICATION),
    evaluation: evaluationSchema.optional(),
    turnover: z.object({ oos: z.object({ initial_implementation_turnover: nonnegative, recurring_gross_turnover: nonnegative, total_gross_turnover: nonnegative }) }).passthrough().optional(),
    metrics: z.union([
      z
        .object({
          observations: nonnegative,
          final_research_index: z.number().finite(),
          economic_claim: z.literal("NONE"),
          cagr: optionalMetric,
          net_sharpe: optionalMetric,
          max_drawdown: optionalMetric,
          annualized_volatility: optionalMetric,
          gross_turnover: optionalMetric,
          annualized_turnover: optionalMetric,
          mean_beginning_risky_exposure: optionalMetric,
          evaluation: evaluationSchema,
        })
        .passthrough(),
      z.string(),
    ]),
    costs: z.union([
      z
        .object({
          transaction_cost_bps: nonnegative,
          selection_cost_bps: nonnegative,
          realized_transaction_cost: nonnegative,
          cost_basis: z.string(),
        })
        .passthrough(),
      z.string(),
    ]),
    time_series: z.union([
      z
        .object({
          status: z.literal("AVAILABLE"),
          observations: nonnegative,
          points: z.array(researchIndexPointSchema),
        })
        .passthrough(),
      z.string(),
    ]),
    validation_diagnostics: z.union([
      z
        .object({
          exact_fold_plan: z.array(foldV2Schema),
          selected_jobs: z.array(
            z
              .object({
                outer_fold: nonnegative,
                candidate_id: z.string(),
                fit_keys: z.array(z.string()),
                job_hash: z.string(),
                result_hash: z.string(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
      z.string(),
    ]),
    result_artifacts: z.array(
      z.object({ path: z.string(), sha256: z.string() }).passthrough(),
    ),
    warnings: z.array(z.string()),
    blockers: z.array(z.unknown()),
    error_class: z.string().nullable(),
    error_message: z.string().nullable(),
    provenance: z.record(z.unknown()),
    financial_result_hash: z.string(),
    runtime_hash: z.string(),
  })
  .passthrough();
export type ResultV2 = z.infer<typeof resultV2Schema>;
const attemptV2Schema = attemptSchema.extend(failureFields);
export const detailV2Schema = boundary.extend({
  contract_version: specVersion,
  run_id: z.string(),
  spec: normalizedSpecV2Schema,
  attempt_history: z.array(attemptV2Schema),
  latest_status: runStatusSchema.nullable(),
  latest_attempt: attemptV2Schema.nullable(),
  latest_result: z.union([resultV2Schema, z.string()]),
  latest_successful_result: z.union([resultV2Schema, z.string()]),
  warnings: z.array(z.string()),
  blockers: z.array(z.unknown()),
  provenance: z.record(z.unknown()),
});
export type DetailV2 = z.infer<typeof detailV2Schema>;
const receiptSchema = boundary.extend({
  run_id: z.string().regex(/^rr_[0-9a-f]{64}$/),
  execution_attempt_id: z.string(),
  status: runStatusSchema,
  stage: z.string(),
  reused_existing_attempt: z.boolean(),
  execution_requested: z.boolean(),
});
export type ReceiptV2 = z.infer<typeof receiptSchema>;
const listSchema = boundary.extend({
  contract_version: specVersion,
  runs: z.array(
    z.object({
      run_id: z.string(),
      created_at: z.string(),
      latest_status: runStatusSchema.nullable(),
      latest_execution_attempt_id: z.string(),
      spec: normalizedSpecV2Schema,
    }),
  ),
});
const difference = z.object({
  path: z.string(),
  left: z.unknown(),
  right: z.unknown(),
});
const compareSchema = boundary.extend({
  contract_version: z.literal("workbench-comparison-2.0.0"),
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
  spec_differences: z.array(difference),
  financial_input_differences: z.array(difference),
  transaction_cost_difference_bps: z.number().finite(),
  oos_observation_difference: z.number().finite(),
  final_research_index_difference: z.number().finite(),
  realized_cost_difference: z.number().finite(),
  warnings: z.array(z.string()),
});
export type ComparisonV2 = z.infer<typeof compareSchema>;
export class DesignerApiError extends WorkbenchApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly issues: unknown = undefined,
  ) {
    super(status, code, message);
  }
}
export class WorkbenchV2Client {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`/api/workbench${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new DesignerApiError(
        response.status,
        "INVALID_JSON_RESPONSE",
        "The research service returned an unreadable response.",
      );
    }
    if (!response.ok) {
      const parsed = z
        .object({
          error: z.object({
            code: z.string(),
            message: z.string(),
            issues: z.unknown().optional(),
          }),
        })
        .safeParse(json);
      if (parsed.success)
        throw new DesignerApiError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.issues,
        );
      // Capacity can return a labelled BLOCKED attempt receipt. Preserve its IDs without retrying.
      const blocked = receiptSchema.safeParse(json);
      if (
        response.status === 429 &&
        blocked.success &&
        blocked.data.status === "BLOCKED"
      )
        return blocked.data as T;
      throw new DesignerApiError(
        response.status,
        "WORKBENCH_REQUEST_FAILED",
        "The research request could not be accepted.",
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new DesignerApiError(
        502,
        "CAPABILITY_CONTRACT_MISMATCH",
        "The service response differs from the supported V2 contract. Execution is disabled.",
      );
    return parsed.data;
  }
  getCapabilities() {
    return this.request("/capabilities", capabilitiesV2Schema);
  }
  plan(spec: SubmissionV2) {
    return this.request("/plan", planV2Schema, versionedSubmissionSchema.parse(spec));
  }
  submitRun(spec: SubmissionV2) {
    return this.request("/runs", receiptSchema, versionedSubmissionSchema.parse(spec));
  }
  listRuns() {
    return this.request("/runs", listSchema);
  }
  getRun(id: string) {
    return this.request(`/runs/${encodeURIComponent(id)}`, detailV2Schema);
  }
  rerun(id: string) {
    return this.request(
      `/runs/${encodeURIComponent(id)}/rerun`,
      receiptSchema,
      {},
    );
  }
  compareRuns(left: string, right: string) {
    return this.request(
      `/compare?${new URLSearchParams({ leftRunId: left, rightRunId: right })}`,
      compareSchema,
    );
  }
}
