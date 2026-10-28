import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, calculateRunId } from "./identity";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
import { campaignV2, CalendarContractError, loadDatasetV2, parseSubmissionV2, planCalendarV2, sha256, capabilitiesV2,
  boundaryV2, type DatasetV2, type SubmissionV2 } from "./calendar-v2";
import { readExecutionCapacity, type ExecutionCapacity } from "./execution-capacity";
import { exposureModelDefinition } from "./exposure-model-definition";
export const TOTAL_V1 = "TOTAL_TURNOVER_INCLUDING_INITIAL_V1" as const;
export const RECURRING_V2 = "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2" as const;
export const PRODUCT_SPEC = "workbench-research-run-spec-2.1.0" as const;
export const PRODUCT_ADAPTER = "workbench-capital-recurring-turnover-2.0.0";
const { generateCandidates } = require("../../../../../research/capital/spec") as { generateCandidates(c: unknown): { candidates: any[] } };
export type ProductSubmission = Omit<SubmissionV2, "contract_version"> & { contract_version: typeof PRODUCT_SPEC; turnover_constraint_methodology_version: typeof RECURRING_V2 };
export function legacyTransport(spec: ProductSubmission): SubmissionV2 {
  const { research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
    window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps } = spec;
  return parseSubmissionV2({ research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
    window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps, contract_version: "workbench-research-run-spec-2.0.0" });
}
export function parseProductSubmission(value: unknown): ProductSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CalendarContractError("INVALID_RESEARCH_RUN_SPEC", "An explicit versioned research design is required.");
  const v = value as Record<string, unknown>;
  if (v.contract_version !== PRODUCT_SPEC || v.turnover_constraint_methodology_version !== RECURRING_V2) throw new CalendarContractError("INVALID_TURNOVER_METHODOLOGY", "The ordinary Workbench uses the explicit recurring-turnover V2 model definition.");
  const { turnover_constraint_methodology_version: _, ...rest } = v;
  return { ...parseSubmissionV2({ ...rest, contract_version: "workbench-research-run-spec-2.0.0" }),
    contract_version: PRODUCT_SPEC, turnover_constraint_methodology_version: RECURRING_V2 };
}
export function productCampaign(spec: ProductSubmission, data: DatasetV2) {
  // The certified schema requires max_jobs. It is a runtime-only argument:
  // the versioned engine removes it from every economic artifact and hash.
  const { max_jobs: _, ...campaign } = campaignV2(legacyTransport(spec), data);
  return { ...campaign, max_jobs: readExecutionCapacity().max_jobs, experiment_id: "workbench-capital-recurring-v2", turnover_constraint_methodology_version: RECURRING_V2 };
}
export function productPlan(value: unknown, data = loadDatasetV2(), capacity = readExecutionCapacity()) {
  const request = parseProductSubmission(value), transport = legacyTransport(request);
  let plan: ReturnType<typeof planCalendarV2>;
  try { plan = planCalendarV2(transport, data); }
  catch (error) {
    // This exact legacy error is raised only after every history/PIT/fold check.
    // Capacity is checked below against the current operational configuration.
    if (!(error instanceof CalendarContractError) || error.code !== "RESEARCH_RESOURCE_LIMIT") throw error;
    plan = planCalendarV2(transport, data, false);
  }
  const jobs = Number(plan.estimated_jobs.total_jobs_estimated);
  const fits = Number(plan.estimated_jobs.model_fits_estimated_upper_bound);
  const files = 3 + Number(plan.estimated_jobs.backtests_estimated) + plan.number_of_folds + 2 * fits;
  const candidates = generateCandidates(campaignV2(transport, data)).candidates;
  const groups = new Set(candidates.map(c => canonicalJson({ family: c.spec.model_family, parameters: c.spec.model_parameters,
    inputs: c.spec.input_set, transformations: c.spec.transformations, cadence: c.spec.recalibration_frequency })));
  if (groups.size !== 1 || !candidates.every(c => c.spec.model_family === "current_regime" &&
      c.spec.rebalance_frequency === c.spec.recalibration_frequency && c.spec.transformations.every((t: any) => t.name === "identity")) ||
      !Number.isSafeInteger(files) || files < 0) throw new CalendarContractError("PREFLIGHT_MODEL_CONTRACT_MISMATCH", "The current model's file bound could not be verified.", {}, 500);
  const capacityEvidence = { number_of_folds: plan.number_of_folds, estimated_jobs: jobs, maximum_jobs: capacity.max_jobs,
    minimum_required_engine_files: files, maximum_engine_files: capacity.max_engine_files, no_attempt_created: true };
  const common = { turnover_constraint_methodology_version: RECURRING_V2, number_of_folds: plan.number_of_folds,
    estimated_jobs: jobs, maximum_jobs: capacity.max_jobs, minimum_required_engine_files: files, maximum_engine_files: capacity.max_engine_files,
    no_attempt_created: true, financially_plannable: true, failed_fold_id: null, failed_decision_date: null,
    diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED", capacity: capacityEvidence };
  if (jobs > capacity.max_jobs || files > capacity.max_engine_files) {
    const jobBound = jobs > capacity.max_jobs;
    const safe = jobBound ? `This backtest is larger than the current interactive execution capacity: ${jobs.toLocaleString("en-US")} estimated tasks versus a ${capacity.max_jobs.toLocaleString("en-US")}-task limit.`
      : `This backtest needs at least ${files.toLocaleString("en-US")} engine files; current interactive execution capacity is ${capacity.max_engine_files.toLocaleString("en-US")} files.`;
    throw new CalendarContractError("INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED", safe, { ...common,
      error_class: "INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED", failed_stage: "EXECUTION_CAPACITY_PREFLIGHT", safe_message: safe,
      actionable_explanation: "This design is financially valid enough to plan, but exceeds the current interactive execution capacity. Candidate eligibility still requires execution. No attempt was created.",
      suggested_user_action: "Ask the preview owner about extended-run capacity, or explicitly preview a smaller design." }, 422);
  }
  const { max_jobs: _legacyBudget, ...estimated } = plan.estimated_jobs;
  return { ...plan, contract_version: PRODUCT_SPEC, normalized_request: request, estimated_jobs: estimated,
    turnover_constraint_methodology_version: RECURRING_V2, model_definition: productModelDefinition(data),
    preflight: { version: "workbench-recurring-necessity-2.0.0", status: "NECESSARY_CONDITIONS_PASSED", candidate_viability_guaranteed: false,
      financial_backtests_executed: 0, initial_entry_bounds_checked: false, minimum_required_engine_files: files,
      maximum_engine_files: capacity.max_engine_files, capacity: { ...capacity },
      warning: "Initial implementation cannot prove recurring-turnover infeasibility. Net-Sharpe, drawdown and recurring turnover require candidate backtesting; preflight does not guarantee eligibility." },
    warnings: [...plan.warnings, "Candidate eligibility is not guaranteed by preflight."], blockers: [] as unknown[] };
}
export function productCodeVersion(data: DatasetV2) {
  const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const files = ["research/workbench/recurring-turnover-engine.ts", "research/workbench/turnover-selection.ts",
    "artifacts/api-server/src/lib/workbench/turnover-product.ts", "artifacts/api-server/src/lib/workbench/turnover-execution.ts",
    "artifacts/api-server/src/lib/workbench/turnover-service.ts", "artifacts/api-server/src/lib/workbench/turnover-failure.ts", "artifacts/api-server/src/workbench-runtime-worker.ts"];
  return sha256(canonicalJson({ legacy_certified_source: data.code_version,
    recurring_turnover_source: Object.fromEntries(files.map(p => [p, sha256(readFileSync(resolve(root, p)))])) }));
}
export function normalizeProduct(value: unknown, data = loadDatasetV2(), capacity?: ExecutionCapacity) {
  const spec = parseProductSubmission(value);
  productPlan(spec, data, capacity);
  const campaign = productCampaign(spec, data);
  return { ...spec, identity_namespace: PRODUCT_SPEC, data_snapshot: data.snapshot,
    engine_versions: { capital_engine: "capital-research-recurring-turnover-2.0.0", model: "production-regime-adapter-1", adapter: PRODUCT_ADAPTER,
      certified_engine_commit: "b9950f7cbe128f9d761597a5e216d777cc3059a3" },
    code_version: productCodeVersion(data), code_commit: "05fe3469d74892cf3ef0e9f9335dd27bfaf552f8",
    model_definition: { candidate_space: campaign.candidate_space, selection_metric: campaign.selection_metric, constraints: campaign.constraints,
      turnover_constraint_methodology_version: RECURRING_V2, information_universe: campaign.reference_universe, warmup_rows: campaign.warmup_rows,
      model_fit_minimum_observations: 0, selection_minimum_observations: 2, cash_yield: campaign.cash_yield,
      execution: "next_close", slippage_bps: 0, initial_nav_per_independent_fold: 100, shorting: false, leverage: false }, ...boundaryV2 };
}
export type NormalizedProduct = ReturnType<typeof normalizeProduct>;
export const productRunId = (spec: NormalizedProduct) => calculateRunId(spec);
export function requestFromProduct(spec: NormalizedProduct): ProductSubmission {
  const legacy = legacyTransport(spec);
  return { ...legacy, contract_version: PRODUCT_SPEC, turnover_constraint_methodology_version: RECURRING_V2 };
}
export function productModelDefinition(data = loadDatasetV2()) {
  return { ...exposureModelDefinition(data), policy_selection: "Net Sharpe after costs", turnover_constraint_methodology_version: RECURRING_V2,
    turnover_rule: "Recurring turnover constraint; initial implementation still pays costs",
    turnover_rule_source: "MODEL_DEFINITION_FIXED", turnover_constraint_limit: data.fixture.constraints.max_turnover };
}
export function productCapabilities(data = loadDatasetV2(), capacity = readExecutionCapacity()) {
  const legacy = capabilitiesV2(data);
  return { ...legacy, supported_spec_version: PRODUCT_SPEC, supported_legacy_spec_versions: ["workbench-research-run-spec-2.0.0"],
    turnover_constraint_methodology_version: RECURRING_V2, turnover_methodology_source: "MODEL_DEFINITION_FIXED",
    model_definition: productModelDefinition(data), fixed_model_definition: { ...legacy.fixed_model_definition, turnover_constraint_methodology_version: RECURRING_V2 },
    engine_identity: { ...legacy.engine_identity, version: "capital-research-recurring-turnover-2.0.0", adapter_version: PRODUCT_ADAPTER, code_version: productCodeVersion(data) },
    resource_limits: { maximum_concurrent_executions: 1, ...capacity, classification: "CURRENT_EXECUTION_CAPACITY", financial_identity_input: false },
    max_engine_files: capacity.max_engine_files,
    turnover_metrics: { source: "ACTUAL_CERTIFIED_LEDGER", annualization: "sum(actual absolute traded notional / pre-cost NAV) * 252 / full observed interval", limit: 8,
      no_recurring_warning: "NO_RECURRING_REBALANCE_OBSERVED", implementation_still_costed: true },
    compatibility: { ...legacy.compatibility, legacy_turnover_spec: "workbench-research-run-spec-2.0.0", legacy_turnover_methodology: TOTAL_V1, old_runs_migrated: false } };
}
