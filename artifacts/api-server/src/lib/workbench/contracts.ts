/**
 * Workbench Phase B1 contracts.
 *
 * This module deliberately exposes a very small request DTO.  The service
 * expands the request into the complete, auditable Phase A research spec;
 * callers cannot provide paths, commands, campaign definitions, or other
 * fields that the adapter does not support.
 */

export const RESEARCH_RUN_SPEC_VERSION = "workbench-research-run-spec-1.0.0" as const;
export const RESEARCH_RUN_RESULT_VERSION = "workbench-research-run-result-1.0.0" as const;
export const RESEARCH_MODE = "CAPITAL_MARKET_EXPOSURE" as const;
export const EXECUTION_SCOPE = "EMPIRICAL" as const;
export const SUPPORTED_UNIVERSE = "SPY" as const;
export const VALIDATION_PROTOCOL = "TRADITIONAL_WALK_FORWARD" as const;
export const PIT_CLASSIFICATION = "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED" as const;
export const RESEARCH_BOUNDARY = "RESEARCH_ONLY" as const;
export const STORAGE_CLASSIFICATION = "TEMPORARY_RESEARCH_STORAGE" as const;
export const CERTIFIED_ENGINE_COMMIT = "b9950f7cbe128f9d761597a5e216d777cc3059a3" as const;
export const WORKBENCH_ADAPTER_VERSION = "workbench-b1-capital-adapter-1.0.0" as const;
export const CAPITAL_ENGINE_VERSION = "capital-research-1.0.1" as const;
export const SUPPORTED_TRANSACTION_COSTS_BPS = [0, 5] as const;

export type SupportedTransactionCostBps = (typeof SUPPORTED_TRANSACTION_COSTS_BPS)[number];

/** The only client-controlled financial contract in Phase B1. */
export interface ResearchRunSubmission {
  research_mode: typeof RESEARCH_MODE;
  execution_scope: typeof EXECUTION_SCOPE;
  universe: typeof SUPPORTED_UNIVERSE;
  validation_protocol: typeof VALIDATION_PROTOCOL;
  transaction_cost_bps: SupportedTransactionCostBps;
}

export interface ContractValidationIssue {
  field: string;
  code: "MISSING_FIELD" | "UNEXPECTED_FIELD" | "INVALID_VALUE" | "INVALID_TYPE";
  message: string;
}

export class WorkbenchContractValidationError extends Error {
  readonly code = "INVALID_RESEARCH_RUN_SPEC";
  readonly statusCode = 400;

  constructor(readonly issues: readonly ContractValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "WorkbenchContractValidationError";
  }
}

const SUBMISSION_FIELDS = [
  "research_mode",
  "execution_scope",
  "universe",
  "validation_protocol",
  "transaction_cost_bps",
] as const;
const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Strictly validates the wire DTO.  Unknown properties are errors rather
 * than ignored values, which prevents unsupported financial controls and
 * user-provided paths or commands from entering the adapter.
 */
export function parseResearchRunSubmission(value: unknown): ResearchRunSubmission {
  if (!isPlainRecord(value)) {
    throw new WorkbenchContractValidationError([
      { field: "$", code: "INVALID_TYPE", message: "request body must be a JSON object" },
    ]);
  }

  const issues: ContractValidationIssue[] = [];
  const allowed = new Set<string>(SUBMISSION_FIELDS);
  for (const field of Object.keys(value).sort()) {
    if (!allowed.has(field)) {
      issues.push({ field, code: "UNEXPECTED_FIELD", message: "field is not supported in Phase B1" });
    }
  }
  for (const field of SUBMISSION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      issues.push({ field, code: "MISSING_FIELD", message: "field is required" });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, "research_mode") && value.research_mode !== RESEARCH_MODE) {
    issues.push({
      field: "research_mode",
      code: typeof value.research_mode === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
      message: `must equal ${RESEARCH_MODE}`,
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, "execution_scope") && value.execution_scope !== EXECUTION_SCOPE) {
    issues.push({
      field: "execution_scope",
      code: typeof value.execution_scope === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
      message: `must equal ${EXECUTION_SCOPE}`,
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, "universe") && value.universe !== SUPPORTED_UNIVERSE) {
    issues.push({
      field: "universe",
      code: typeof value.universe === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
      message: `must equal ${SUPPORTED_UNIVERSE}`,
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "validation_protocol") &&
    value.validation_protocol !== VALIDATION_PROTOCOL
  ) {
    issues.push({
      field: "validation_protocol",
      code: typeof value.validation_protocol === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
      message: `must equal ${VALIDATION_PROTOCOL}`,
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, "transaction_cost_bps")) {
    const cost = value.transaction_cost_bps;
    if (typeof cost !== "number" || !Number.isFinite(cost)) {
      issues.push({
        field: "transaction_cost_bps",
        code: "INVALID_TYPE",
        message: "must be a finite number",
      });
    } else if (!SUPPORTED_TRANSACTION_COSTS_BPS.some((supported) => Object.is(cost, supported) || cost === supported)) {
      issues.push({
        field: "transaction_cost_bps",
        code: "INVALID_VALUE",
        message: `must be one of ${SUPPORTED_TRANSACTION_COSTS_BPS.join(", ")}`,
      });
    }
  }

  if (issues.length) throw new WorkbenchContractValidationError(issues);

  return {
    research_mode: RESEARCH_MODE,
    execution_scope: EXECUTION_SCOPE,
    universe: SUPPORTED_UNIVERSE,
    validation_protocol: VALIDATION_PROTOCOL,
    transaction_cost_bps: Object.is(value.transaction_cost_bps, -0)
      ? 0
      : (value.transaction_cost_bps as SupportedTransactionCostBps),
  };
}

/** Alias used by route and unit-test code. */
export const validateResearchRunSubmission = parseResearchRunSubmission;

export interface NormalizedResearchRunSpec {
  contract_version: typeof RESEARCH_RUN_SPEC_VERSION;
  research_mode: typeof RESEARCH_MODE;
  execution_scope: typeof EXECUTION_SCOPE;
  universe: {
    operated: readonly [typeof SUPPORTED_UNIVERSE];
    information: readonly string[];
    user_change_supported: false;
    support_note: string;
  };
  start_date: "2020-01-01";
  end_date: "2024-01-01";
  information_cutoff_policy: {
    signal_rule: string;
    execution_rule: "next_close";
    fit_rule: string;
    data_vintage_status: "NOT_INDEPENDENTLY_ESTABLISHED";
    pit_label: typeof PIT_CLASSIFICATION;
  };
  benchmark: "NOT_SUPPORTED";
  strategy_or_allocator_id: "capital-research-grid-selector";
  strategy_or_allocator_version: typeof CAPITAL_ENGINE_VERSION;
  parameters: {
    saved_configuration_reference: { path: string; sha256: string };
    backend_experiment_id: "cl03-acceptance-traditional";
    search_method: "grid";
    candidate_budget: 200;
    candidate_space: readonly unknown[];
    model_family: "current_regime";
    model_version: "production-regime-adapter-1";
    model_parameters: { lookback_rows: 252 };
    transformations: readonly [{ readonly name: "identity" }];
    exposure_policies: {
      cash_band: "current-cash-policy-1";
      constant: "fixed-risk-policy-1";
    };
    candidate_space_hash: string;
    selection_metric: "net_sharpe";
    selection_cost_bps: 5;
    backend_cost_scenarios_bps: readonly [0, 5];
    cash_yield_daily: 0;
    reference_yield_daily: 0;
    slippage_bps: 0;
    initial_nav_per_fold: 100;
    inner_validation_clock: {
      train_months: 12;
      test_months: 6;
      step_months: 6;
      status_for_traditional_run: "CONFIGURED_BUT_NOT_USED";
    };
    warmup_rows: 252;
    max_jobs: 2000;
    shorting: false;
    leverage: false;
  };
  rebalance_frequency: "monthly";
  transaction_cost_bps: SupportedTransactionCostBps;
  expected_return_method: "NOT_APPLICABLE";
  covariance_method: "NOT_APPLICABLE";
  risk_mandate: "NOT_APPLICABLE";
  constraints: {
    max_turnover_annualized: 8;
    max_drawdown_absolute: 0.6;
    min_mean_beginning_risky_exposure: 0;
    max_mean_beginning_risky_exposure: 1;
  };
  validation_protocol: {
    mode: "traditional";
    contract_mode: typeof VALIDATION_PROTOCOL;
    window_type: "rolling";
    selection_basis: string;
    outer_oos_aggregation: string;
    outer_folds: readonly {
      outer_fold: number;
      training_start: string;
      training_end_exclusive: string;
      validation_start: "NOT_APPLICABLE";
      validation_end_exclusive: "NOT_APPLICABLE";
      outer_oos_start: string;
      outer_oos_end_exclusive: string;
    }[];
  };
  walk_forward_configuration: {
    train_months: 24;
    test_months: 12;
    step_months: 12;
    recalibration_frequency: "monthly";
    overlapping_tests: false;
  };
  random_seed: "NOT_APPLICABLE";
  data_snapshot: {
    snapshot_id: "cl02-adjusted-closes-b4a4fa0e0ddb";
    path: "reports/cl02/adjusted-closes.csv";
    sha256: string;
    parsed_data_hash: string;
    observations: 4023;
    coverage_start: "2010-10-01";
    coverage_end: "2026-09-30";
    as_of: "2026-10-13T13:36:42.846Z";
    as_of_status: "AVAILABLE_EXTERNAL_METADATA_NOT_ENGINE_BOUND";
    price_convention: "adjusted close";
    provenance_status: "VENDOR_AUTHENTICITY_UNVERIFIED";
  };
  engine_versions: {
    capital_engine: typeof CAPITAL_ENGINE_VERSION;
    model_current_regime: "production-regime-adapter-1";
    policy_cash_band: "current-cash-policy-1";
    policy_constant: "fixed-risk-policy-1";
    code_hash: string;
    certified_engine_commit: typeof CERTIFIED_ENGINE_COMMIT;
    workbench_adapter: typeof WORKBENCH_ADAPTER_VERSION;
  };
  code_commit: typeof CERTIFIED_ENGINE_COMMIT;
  pit_classification: typeof PIT_CLASSIFICATION;
  real_money_boundary: typeof RESEARCH_BOUNDARY;
}

export interface ResearchRunSpec extends NormalizedResearchRunSpec {
  run_id: string;
  created_at: string;
  requested_by: "WORKBENCH_API_CLIENT";
  storage_policy: {
    kind: typeof STORAGE_CLASSIFICATION;
    durability: "NOT_GUARANTEED";
    root_source: "SERVER_CONFIGURED";
    attempt_policy: "IMMUTABLE_APPEND_ONLY";
  };
}

const INFORMATION_UNIVERSE = [
  "XLK", "XLC", "XLRE", "XLI", "XLY", "XLF", "XLU", "XLE", "XLV", "XLB", "EEM",
  "EWJ", "AAXJ", "EWG", "EUFN", "SPY", "GLD", "TLT", "IEF", "VNQ", "EFA", "DBC",
] as const;

const CANDIDATE_SPACE = [
  {
    base: {
      model_family: "current_regime",
      input_set: INFORMATION_UNIVERSE,
      transformations: [{ name: "identity" }],
      model_parameters: { lookback_rows: 252 },
      exposure_policy: "cash_band",
      exposure_parameters: { cash_min: 0.1, cash_max: 0.2 },
    },
    axes: {
      "exposure_parameters.cash_min": [0.1, 0.2],
      "exposure_parameters.cash_max": [0.2, 0.4],
    },
  },
  {
    base: {
      model_family: "current_regime",
      input_set: INFORMATION_UNIVERSE,
      transformations: [{ name: "identity" }],
      model_parameters: { lookback_rows: 252 },
      exposure_policy: "constant",
      exposure_parameters: { risk: 1 },
    },
  },
] as const;

/** Expands all fixed Phase B1 values before identity calculation or storage. */
export function normalizeResearchRunSpec(value: unknown): NormalizedResearchRunSpec {
  const submission = parseResearchRunSubmission(value);
  return {
    contract_version: RESEARCH_RUN_SPEC_VERSION,
    research_mode: RESEARCH_MODE,
    execution_scope: EXECUTION_SCOPE,
    universe: {
      operated: [SUPPORTED_UNIVERSE],
      information: [...INFORMATION_UNIVERSE],
      user_change_supported: false,
      support_note: "Phase B1 fixes the operated universe to SPY and the committed 22-symbol information universe.",
    },
    start_date: "2020-01-01",
    end_date: "2024-01-01",
    information_cutoff_policy: {
      signal_rule: "Every market row supplied to predict has row.date < signalDate.",
      execution_rule: "next_close",
      fit_rule: "Fit rows are bounded by [training_start, training_end); the fitted model is frozen through each OOS fold.",
      data_vintage_status: "NOT_INDEPENDENTLY_ESTABLISHED",
      pit_label: PIT_CLASSIFICATION,
    },
    benchmark: "NOT_SUPPORTED",
    strategy_or_allocator_id: "capital-research-grid-selector",
    strategy_or_allocator_version: CAPITAL_ENGINE_VERSION,
    parameters: {
      saved_configuration_reference: {
        path: "configs/capital-research/acceptance-traditional.json",
        sha256: "9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64",
      },
      backend_experiment_id: "cl03-acceptance-traditional",
      search_method: "grid",
      candidate_budget: 200,
      candidate_space: structuredClone(CANDIDATE_SPACE),
      model_family: "current_regime",
      model_version: "production-regime-adapter-1",
      model_parameters: { lookback_rows: 252 },
      transformations: [{ name: "identity" }],
      exposure_policies: {
        cash_band: "current-cash-policy-1",
        constant: "fixed-risk-policy-1",
      },
      candidate_space_hash: "f6c6316d66c14f03ec9f3ce583ee6cef6bf5d427aa46fbbd37da06372f4a7d72",
      selection_metric: "net_sharpe",
      selection_cost_bps: 5,
      backend_cost_scenarios_bps: [0, 5],
      cash_yield_daily: 0,
      reference_yield_daily: 0,
      slippage_bps: 0,
      initial_nav_per_fold: 100,
      inner_validation_clock: {
        train_months: 12,
        test_months: 6,
        step_months: 6,
        status_for_traditional_run: "CONFIGURED_BUT_NOT_USED",
      },
      warmup_rows: 252,
      max_jobs: 2000,
      shorting: false,
      leverage: false,
    },
    rebalance_frequency: "monthly",
    transaction_cost_bps: submission.transaction_cost_bps,
    expected_return_method: "NOT_APPLICABLE",
    covariance_method: "NOT_APPLICABLE",
    risk_mandate: "NOT_APPLICABLE",
    constraints: {
      max_turnover_annualized: 8,
      max_drawdown_absolute: 0.6,
      min_mean_beginning_risky_exposure: 0,
      max_mean_beginning_risky_exposure: 1,
    },
    validation_protocol: {
      mode: "traditional",
      contract_mode: VALIDATION_PROTOCOL,
      window_type: "rolling",
      selection_basis: "training scores at 5 bps",
      outer_oos_aggregation: "Concatenate two independent validation sleeves by daily return; each sleeve starts NAV=100 cash.",
      outer_folds: [
        {
          outer_fold: 0,
          training_start: "2020-01-01",
          training_end_exclusive: "2022-01-01",
          validation_start: "NOT_APPLICABLE",
          validation_end_exclusive: "NOT_APPLICABLE",
          outer_oos_start: "2022-01-01",
          outer_oos_end_exclusive: "2023-01-01",
        },
        {
          outer_fold: 1,
          training_start: "2021-01-01",
          training_end_exclusive: "2023-01-01",
          validation_start: "NOT_APPLICABLE",
          validation_end_exclusive: "NOT_APPLICABLE",
          outer_oos_start: "2023-01-01",
          outer_oos_end_exclusive: "2024-01-01",
        },
      ],
    },
    walk_forward_configuration: {
      train_months: 24,
      test_months: 12,
      step_months: 12,
      recalibration_frequency: "monthly",
      overlapping_tests: false,
    },
    random_seed: "NOT_APPLICABLE",
    data_snapshot: {
      snapshot_id: "cl02-adjusted-closes-b4a4fa0e0ddb",
      path: "reports/cl02/adjusted-closes.csv",
      sha256: "b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0",
      parsed_data_hash: "f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e",
      observations: 4023,
      coverage_start: "2010-10-01",
      coverage_end: "2026-09-30",
      as_of: "2026-10-13T13:36:42.846Z",
      as_of_status: "AVAILABLE_EXTERNAL_METADATA_NOT_ENGINE_BOUND",
      price_convention: "adjusted close",
      provenance_status: "VENDOR_AUTHENTICITY_UNVERIFIED",
    },
    engine_versions: {
      capital_engine: CAPITAL_ENGINE_VERSION,
      model_current_regime: "production-regime-adapter-1",
      policy_cash_band: "current-cash-policy-1",
      policy_constant: "fixed-risk-policy-1",
      code_hash: "94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf",
      certified_engine_commit: CERTIFIED_ENGINE_COMMIT,
      workbench_adapter: WORKBENCH_ADAPTER_VERSION,
    },
    code_commit: CERTIFIED_ENGINE_COMMIT,
    pit_classification: PIT_CLASSIFICATION,
    real_money_boundary: RESEARCH_BOUNDARY,
  };
}

export type ResearchRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "BLOCKED";
export type ExplicitUnavailable =
  | "NOT_SUPPORTED"
  | "NOT_APPLICABLE"
  | "FUTURE_NOT_IMPLEMENTED"
  | `BLOCKED_MISSING_${string}`;

export interface ResultArtifactReference {
  path: string;
  sha256: string;
  selector?: string;
  selected_rows_sha256?: string;
  media_type?: string;
}

export interface CapitalResearchMetrics {
  observations: number;
  cagr: number;
  net_sharpe: number;
  max_drawdown: number;
  return_drawdown_ratio: number;
  annualized_volatility: number;
  gross_turnover: number;
  annualized_turnover: number;
  mean_beginning_risky_exposure: number;
  final_research_index: number;
  economic_claim: "NONE";
}

export interface ResearchRunResult {
  contract_version: typeof RESEARCH_RUN_RESULT_VERSION;
  run_id: string;
  execution_attempt_id: string;
  status: ResearchRunStatus;
  started_at: string | "NOT_APPLICABLE";
  completed_at: string | "NOT_APPLICABLE";
  input_spec_reference: string;
  stage: string;
  pit_classification: typeof PIT_CLASSIFICATION;
  real_money_boundary: typeof RESEARCH_BOUNDARY;
  storage_classification: typeof STORAGE_CLASSIFICATION;
  result_artifacts: readonly ResultArtifactReference[];
  metrics: CapitalResearchMetrics | ExplicitUnavailable;
  time_series: Record<string, unknown> | ExplicitUnavailable;
  weights_or_positions: Record<string, unknown> | ExplicitUnavailable;
  trades_or_rebalances: Record<string, unknown> | ExplicitUnavailable;
  costs: Record<string, unknown> | ExplicitUnavailable;
  risk_diagnostics: Record<string, unknown> | ExplicitUnavailable;
  validation_diagnostics: Record<string, unknown> | ExplicitUnavailable;
  warnings: readonly string[];
  blockers: readonly (string | Record<string, unknown>)[];
  error_class: string | null;
  error_message: string | null;
  provenance: Record<string, unknown>;
  reproducibility: Record<string, unknown> | ExplicitUnavailable;
  financial_result_hash: string | ExplicitUnavailable;
  runtime_hash: string | ExplicitUnavailable;
  execution?: Record<string, unknown>;
}

export const EDITABLE_FIELD_METADATA = [
  {
    field: "transaction_cost_bps",
    editable: true,
    type: "number",
    allowed_values: SUPPORTED_TRANSACTION_COSTS_BPS,
    validation_rule: "Required finite number; exactly 0 or 5 basis points.",
    default_source: "USER_SUPPLIED",
    financial_meaning: "One-way basis-point fee on absolute traded notional.",
    backend_mapping: "Capital job scenario and calculator transactionCostBps.",
    unsupported_reason: null,
  },
] as const;
