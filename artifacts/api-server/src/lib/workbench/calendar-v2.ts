import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv, type PriceRow } from "../calculator";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
import { canonicalJson, calculateRunId } from "./identity";
import { CERTIFIED_ENGINE_COMMIT, PIT_CLASSIFICATION, RESEARCH_BOUNDARY, STORAGE_CLASSIFICATION } from "./contracts";

// Fixed module paths, matching the existing typed worker integration convention.
const { makeFolds, addMonths, hash, generateCandidates } = require("../../../../../research/capital/spec") as {
  makeFolds(c: EngineCampaign): EngineFold[];
  addMonths(date: string, months: number): string;
  hash(value: unknown): string;
  generateCandidates(c: EngineCampaign): { candidates: unknown[] };
};

export const SPEC_V2 = "workbench-research-run-spec-2.0.0";
export const ADAPTER_V2 = "workbench-capital-calendar-2.0.0";
export const DATA_PATH = "reports/cl02/adjusted-closes.csv";
export const MODEL_HISTORY_ROWS = 252;
// The committed current_regime fit is stateless. Indicator lookback is not a
// learned-model training minimum. Ranking net Sharpe still needs >=2 returns.
export const MODEL_FIT_MINIMUM_ROWS = 0;
export const SELECTION_MINIMUM_ROWS = 2;
export const MAX_JOBS = 2000;
export const boundaryV2 = {
  research_boundary: RESEARCH_BOUNDARY, pit_classification: PIT_CLASSIFICATION,
  storage_classification: STORAGE_CLASSIFICATION,
} as const;

export interface SubmissionV2 {
  contract_version: typeof SPEC_V2;
  research_mode: "CAPITAL_MARKET_EXPOSURE";
  execution_scope: "EMPIRICAL";
  universe: "SPY";
  validation_protocol: "TRADITIONAL_WALK_FORWARD";
  evaluation_start: string;
  evaluation_end_exclusive: string;
  window_type: "ROLLING" | "EXPANDING";
  training_window_months: number;
  rebalance_frequency: "MONTHLY" | "QUARTERLY";
  transaction_cost_bps: number;
  selection_cost_bps: number;
}
export interface EngineFold { outer_fold: number; train_start: string; train_end: string; test_start: string; test_end: string; }
export interface EngineCampaign {
  experiment_id: string; validation_mode: "traditional"; window_type: "rolling" | "expanding";
  dates: { start: string; end_exclusive: string }; train_months: number; test_months: number; step_months: number;
  rebalance_frequency: "monthly" | "quarterly"; recalibration_frequency: "monthly" | "quarterly";
  search_method: "grid"; candidate_budget: number; candidate_space: any[];
  selection_metric: string; constraints: Record<string, number>; transaction_cost_bps: number[]; selection_cost_bps: number;
  cash_yield: { type: "constant"; daily: number; reference_daily: number }; risk_asset: string;
  reference_universe: string[]; data_csv: string; data_sha256: string; data_provenance: string; warmup_rows: number; max_jobs: number;
}
export class CalendarContractError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}, readonly statusCode = 400) {
    super(message); this.name = "CalendarContractError";
  }
}
const fields = ["contract_version", "research_mode", "execution_scope", "universe", "validation_protocol", "evaluation_start", "evaluation_end_exclusive", "window_type", "training_window_months", "rebalance_frequency", "transaction_cost_bps", "selection_cost_bps"];
const monthStart = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-01$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function parseSubmissionV2(value: unknown): SubmissionV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CalendarContractError("INVALID_RESEARCH_RUN_SPEC", "A V2 JSON object is required.");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter(key => !fields.includes(key));
  const missing = fields.filter(key => !Object.hasOwn(record, key));
  if (unknown.length || missing.length) throw new CalendarContractError("INVALID_RESEARCH_RUN_SPEC", "Every V2 financial field must be explicit; unknown fields are rejected.", { unknown_fields: unknown, missing_fields: missing });
  const fixed = { contract_version: SPEC_V2, research_mode: "CAPITAL_MARKET_EXPOSURE", execution_scope: "EMPIRICAL", universe: "SPY", validation_protocol: "TRADITIONAL_WALK_FORWARD" };
  for (const [key, expected] of Object.entries(fixed)) if (record[key] !== expected) throw new CalendarContractError("INVALID_RESEARCH_RUN_SPEC", `Unsupported ${key}.`, { field: key, expected });
  if (!monthStart(record.evaluation_start) || !monthStart(record.evaluation_end_exclusive)) throw new CalendarContractError("INVALID_DATE_BOUNDARY", "Evaluation dates must be valid ISO month-start dates.");
  if (record.evaluation_start >= record.evaluation_end_exclusive) throw new CalendarContractError("INVALID_DATE_ORDER", "OOS end exclusive must follow OOS start.");
  if (!["ROLLING", "EXPANDING"].includes(String(record.window_type))) throw new CalendarContractError("UNSUPPORTED_WINDOW_TYPE", "Window type must be ROLLING or EXPANDING.");
  if (!["MONTHLY", "QUARTERLY"].includes(String(record.rebalance_frequency))) throw new CalendarContractError("UNSUPPORTED_CADENCE", "Cadence must be MONTHLY or QUARTERLY.");
  if (!Number.isSafeInteger(record.training_window_months) || Number(record.training_window_months) <= 0 || Number(record.training_window_months) > 1200) throw new CalendarContractError("INVALID_TRAINING_WINDOW", "Training window must be a positive integer of at most 1200 calendar months.");
  for (const key of ["transaction_cost_bps", "selection_cost_bps"]) if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || Number(record[key]) < 0) throw new CalendarContractError("INVALID_TRANSACTION_COST", `${key} must be an explicit finite nonnegative number.`, { field: key });
  if (record.rebalance_frequency === "QUARTERLY" && (Number(record.evaluation_start.slice(5, 7)) - 1) % 3 !== 0) throw new CalendarContractError("INVALID_QUARTER_BOUNDARY", "Quarterly evaluation must start at a calendar-quarter boundary to match the existing engine rebalance calendar.");
  return Object.fromEntries(fields.map(key => [key, Object.is(record[key], -0) ? 0 : record[key]])) as unknown as SubmissionV2;
}
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export interface DatasetV2 { rows: PriceRow[]; fixture: EngineCampaign; snapshot: { path: string; sha256: string; parsed_data_hash: string; observations: number; data_first_observation: string; data_last_observation: string }; code_version: string; }
export function loadDatasetV2(): DatasetV2 {
  const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const fixtureText = readFileSync(resolve(root, "configs/capital-research/acceptance-traditional.json"), "utf8");
  if (sha256(fixtureText) !== "9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64") throw new CalendarContractError("CERTIFIED_MODEL_DEFINITION_MISMATCH", "The certified model definition has changed.", {}, 500);
  const fixture = JSON.parse(fixtureText) as EngineCampaign;
  const csv = readFileSync(resolve(root, DATA_PATH), "utf8");
  if (sha256(csv) !== fixture.data_sha256) throw new CalendarContractError("DATA_SNAPSHOT_MISMATCH", "The empirical snapshot hash does not match its committed identity.", {}, 500);
  const rows = parseCsv(csv);
  if (!rows.length || rows.some((row, i) => i > 0 && row.date <= rows[i - 1].date)) throw new CalendarContractError("INVALID_DATA_CALENDAR", "Dataset dates must be sorted and unique.", {}, 500);
  const paths = [
    ...readdirSync(resolve(root, "research/capital")).filter(name => /\.(ts|py)$/.test(name)).map(name => `research/capital/${name}`),
    "artifacts/api-server/src/lib/calculator.ts", "artifacts/api-server/src/lib/factor-library.ts", "artifacts/api-server/src/lib/d6-trace.ts",
    "artifacts/api-server/src/lib/workbench/calendar-v2.ts", "artifacts/api-server/src/lib/workbench/execution-v2.ts",
    "artifacts/api-server/src/lib/workbench/execution-adapter.ts", "artifacts/api-server/src/lib/workbench/service-v2.ts",
    "artifacts/api-server/src/lib/workbench/service.ts",
    "artifacts/api-server/src/lib/workbench/identity.ts", "artifacts/api-server/src/workbench-run-worker.ts",
  ].sort();
  const code_version = hash(Object.fromEntries(paths.map(path => [path, sha256(readFileSync(resolve(root, path)))])));
  return { rows, fixture, code_version, snapshot: { path: DATA_PATH, sha256: sha256(csv), parsed_data_hash: hash(rows), observations: rows.length,
    data_first_observation: rows[0].date, data_last_observation: rows.at(-1)!.date } };
}
export function campaignV2(spec: SubmissionV2, dataset: DatasetV2): EngineCampaign {
  const base = dataset.fixture;
  const months = spec.rebalance_frequency === "MONTHLY" ? 1 : 3;
  return {
    experiment_id: "workbench-capital-v2", validation_mode: "traditional", window_type: spec.window_type === "ROLLING" ? "rolling" : "expanding",
    dates: { start: addMonths(spec.evaluation_start, -spec.training_window_months), end_exclusive: spec.evaluation_end_exclusive },
    train_months: spec.training_window_months, test_months: months, step_months: months,
    rebalance_frequency: spec.rebalance_frequency === "MONTHLY" ? "monthly" : "quarterly",
    recalibration_frequency: spec.rebalance_frequency === "MONTHLY" ? "monthly" : "quarterly",
    search_method: "grid", candidate_budget: base.candidate_budget,
    candidate_space: structuredClone(base.candidate_space), selection_metric: base.selection_metric,
    constraints: structuredClone(base.constraints), cash_yield: structuredClone(base.cash_yield), risk_asset: base.risk_asset,
    reference_universe: [...base.reference_universe], data_csv: DATA_PATH, data_sha256: dataset.snapshot.sha256,
    data_provenance: base.data_provenance, warmup_rows: base.warmup_rows, max_jobs: MAX_JOBS,
    transaction_cost_bps: [...new Set([spec.transaction_cost_bps, spec.selection_cost_bps])].sort((a, b) => a - b),
    selection_cost_bps: spec.selection_cost_bps,
  };
}
export interface PlannedFoldV2 {
  fold_id: number; training_start: string; training_end_exclusive: string; decision_date: string; information_cutoff: string;
  oos_start: string; oos_end_exclusive: string; rebalance_frequency: SubmissionV2["rebalance_frequency"]; window_type: SubmissionV2["window_type"];
  training_observations: number; warmup_observations: number; oos_observations: number;
}
export function planCalendarV2(spec: SubmissionV2, dataset: DatasetV2, validateHistory = true) {
  const maxEnd = addMonths(dataset.snapshot.data_last_observation.slice(0, 7) + "-01", 1);
  // A snapshot ending mid-month cannot certify that remaining calendar month.
  const last = dataset.snapshot.data_last_observation;
  const nextDay = new Date(Date.parse(last) + 86400000);
  while ([0, 6].includes(nextDay.getUTCDay())) nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const supportedEnd = nextDay.toISOString().slice(0, 7) !== last.slice(0, 7) ? maxEnd : last.slice(0, 7) + "-01";
  if (spec.evaluation_end_exclusive > supportedEnd) throw new CalendarContractError("EVALUATION_BEYOND_DATA_RANGE", "Requested OOS end exceeds the last complete observed calendar month.", { supported_evaluation_end_max: supportedEnd });
  if (spec.evaluation_start <= dataset.snapshot.data_first_observation) throw new CalendarContractError("INSUFFICIENT_TRAINING_HISTORY", "The requested OOS start has no sufficient preceding training history.", { requested_training_window_months: spec.training_window_months, model_fit_requirement_observations: MODEL_FIT_MINIMUM_ROWS, selection_requirement_observations: SELECTION_MINIMUM_ROWS, available_observations: 0, data_first_observation: dataset.snapshot.data_first_observation });
  const campaign = campaignV2(spec, dataset);
  const engineFolds = makeFolds(campaign);
  if (!engineFolds.length || engineFolds.at(-1)!.test_end !== spec.evaluation_end_exclusive) throw new CalendarContractError("INCOMPLETE_EVALUATION_FOLDS", "The exact requested OOS interval must be covered by complete rebalance periods.");
  const folds = engineFolds.map((fold): PlannedFoldV2 => {
    const training = dataset.rows.filter(row => row.date >= fold.train_start && row.date < fold.train_end);
    const beforeTrain = dataset.rows.filter(row => row.date < fold.train_start);
    const oos = dataset.rows.filter(row => row.date >= fold.test_start && row.date < fold.test_end);
    const cutoff = dataset.rows.filter(row => row.date < fold.train_end).at(-1)?.date;
    if (validateHistory) {
      if (fold.train_start < dataset.snapshot.data_first_observation || training.length < Math.max(MODEL_FIT_MINIMUM_ROWS, SELECTION_MINIMUM_ROWS)) throw new CalendarContractError("INSUFFICIENT_TRAINING_HISTORY", "The explicit training window does not contain enough observations for the declared model and selection score.", { fold_id: fold.outer_fold, requested_training_window_months: spec.training_window_months, training_start: fold.train_start, model_fit_requirement_observations: MODEL_FIT_MINIMUM_ROWS, selection_requirement_observations: SELECTION_MINIMUM_ROWS, available_observations: training.length, data_first_observation: dataset.snapshot.data_first_observation });
      const warmup = beforeTrain.slice(-campaign.warmup_rows);
      if (warmup.length < campaign.warmup_rows || [...warmup, ...training, ...oos].some(row => campaign.reference_universe.some(ticker => !Number.isFinite(row.prices[ticker]) || row.prices[ticker] <= 0))) throw new CalendarContractError("INSUFFICIENT_MODEL_WARMUP_HISTORY", "The model needs complete information-universe observations before training and throughout the fold.", { fold_id: fold.outer_fold, warmup_requirement_observations: campaign.warmup_rows, available_warmup_observations: warmup.length, training_observations: training.length, requested_training_window_months: spec.training_window_months });
      if (oos.length < 2 || !cutoff) throw new CalendarContractError("INCOMPLETE_OOS_DATA", "Every OOS fold requires a prior information cutoff and at least two actual observations.");
    }
    return { fold_id: fold.outer_fold, training_start: fold.train_start, training_end_exclusive: fold.train_end,
      decision_date: oos[0]?.date ?? fold.test_start, information_cutoff: cutoff ?? "NOT_AVAILABLE",
      oos_start: fold.test_start, oos_end_exclusive: fold.test_end, rebalance_frequency: spec.rebalance_frequency, window_type: spec.window_type,
      training_observations: training.length, warmup_observations: beforeTrain.length, oos_observations: oos.length };
  });
  const candidateCount = generateCandidates(campaign).candidates.length;
  const backtests = folds.length * (candidateCount + 1) * campaign.transaction_cost_bps.length;
  // Exact engine plan is computed using the committed plan function, with no backtest.
  const { plan } = require("../../../../../research/capital/engine") as { plan(c: EngineCampaign, rows: PriceRow[]): { total_jobs_estimated: number; backtests_estimated: number; [key: string]: unknown } };
  const jobs = plan(campaign, dataset.rows);
  if (validateHistory && jobs.total_jobs_estimated > MAX_JOBS) throw new CalendarContractError("RESEARCH_RESOURCE_LIMIT", "The requested design exceeds the bounded estimated-job budget.", { estimated_jobs: jobs.total_jobs_estimated, maximum_jobs: MAX_JOBS });
  return { ...boundaryV2, contract_version: SPEC_V2, normalized_request: spec, derived_engine_calendar: {
    dates: campaign.dates, train_months: campaign.train_months, test_months: campaign.test_months, step_months: campaign.step_months,
    window_type: campaign.window_type, rebalance_frequency: campaign.rebalance_frequency, recalibration_frequency: campaign.recalibration_frequency,
  }, number_of_folds: folds.length, first_training_date: folds[0].training_start, first_oos_date: spec.evaluation_start,
    last_oos_date: dataset.rows.filter(row => row.date < spec.evaluation_end_exclusive && row.date >= spec.evaluation_start).at(-1)?.date ?? "NOT_AVAILABLE",
    folds, estimated_jobs: jobs, backtests_estimated: backtests, warnings: [PIT_CLASSIFICATION, "Independent fold sleeves reset NAV/cash; the compounded OOS index is not a carried-holdings account."], blockers: [] as unknown[] };
}
export function normalizedSpecV2(request: unknown, dataset = loadDatasetV2()) {
  const spec = parseSubmissionV2(request);
  planCalendarV2(spec, dataset);
  const campaign = campaignV2(spec, dataset);
  return { ...spec, identity_namespace: SPEC_V2, data_snapshot: dataset.snapshot,
    engine_versions: { capital_engine: "capital-research-1.0.1", model: "production-regime-adapter-1", adapter: ADAPTER_V2, certified_engine_commit: CERTIFIED_ENGINE_COMMIT },
    code_version: dataset.code_version, code_commit: CERTIFIED_ENGINE_COMMIT,
    model_definition: { candidate_space: campaign.candidate_space, selection_metric: campaign.selection_metric, constraints: campaign.constraints,
      information_universe: campaign.reference_universe, warmup_rows: campaign.warmup_rows, model_fit_minimum_observations: MODEL_FIT_MINIMUM_ROWS, selection_minimum_observations: SELECTION_MINIMUM_ROWS, cash_yield: campaign.cash_yield,
      execution: "next_close", slippage_bps: 0, initial_nav_per_independent_fold: 100, shorting: false, leverage: false },
    ...boundaryV2 };
}
export type NormalizedSpecV2 = ReturnType<typeof normalizedSpecV2>;
export const runIdV2 = (spec: NormalizedSpecV2) => calculateRunId(spec);
export function capabilitiesV2(dataset = loadDatasetV2()) {
  const complete = (row: PriceRow) => dataset.fixture.reference_universe.every(ticker => Number.isFinite(row.prices[ticker]) && row.prices[ticker] > 0);
  let earliestTrain = "NOT_AVAILABLE";
  for (let i = MODEL_HISTORY_ROWS; i < dataset.rows.length; i++) {
    const row = dataset.rows[i];
    if (i > 0 && dataset.rows[i - 1].date.slice(0, 7) === row.date.slice(0, 7)) continue;
    if (dataset.rows.slice(i - MODEL_HISTORY_ROWS, i).every(complete)) { earliestTrain = row.date.slice(0, 7) + "-01"; break; }
  }
  let earliestEvaluation = earliestTrain;
  if (earliestTrain !== "NOT_AVAILABLE") {
    earliestEvaluation = addMonths(earliestTrain, 1);
    while (dataset.rows.filter(row => row.date >= earliestTrain && row.date < earliestEvaluation).length < Math.max(MODEL_FIT_MINIMUM_ROWS, SELECTION_MINIMUM_ROWS)) earliestEvaluation = addMonths(earliestEvaluation, 1);
  }
  const last = dataset.snapshot.data_last_observation;
  const next = new Date(Date.parse(last) + 86400000);
  while ([0, 6].includes(next.getUTCDay())) next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 7) === last.slice(0, 7) ? last.slice(0, 7) + "-01" : addMonths(last.slice(0, 7) + "-01", 1);
  return { ...boundaryV2, contract_version: "workbench-capabilities-2.0.0", supported_spec_version: SPEC_V2,
    supported_research_modes: ["CAPITAL_MARKET_EXPOSURE"], supported_universe: ["SPY"], supported_validation_methods: ["TRADITIONAL_WALK_FORWARD"],
    ...dataset.snapshot, supported_evaluation_start_min: earliestEvaluation, supported_evaluation_end_max: end,
    earliest_complete_training_start: earliestTrain, evaluation_start_min_rule: "Conditional on user training months/cadence; plan validates each fold without shifting dates.",
    supported_window_types: ["ROLLING", "EXPANDING"], supported_rebalance_frequencies: ["MONTHLY", "QUARTERLY"],
    training_window_rules: { required: true, positive_integer_months: true, maximum_months: 1200, minimum_training_observations: SELECTION_MINIMUM_ROWS, model_fit_required_observations: MODEL_FIT_MINIMUM_ROWS, model_fit: "STATELESS", selection_score: "net_sharpe requires at least two training returns and a defined score; eligibility is determined by the unchanged engine", model_warmup_observations_before_training: MODEL_HISTORY_ROWS, no_automatic_extension: true },
    date_rules: { evaluation_is_oos: true, month_start_required: true, quarterly_start: "CALENDAR_QUARTER_START", complete_folds_required: true, no_date_adjustment: true },
    transaction_cost_rules: { fields: ["transaction_cost_bps", "selection_cost_bps"], required: true, finite: true, minimum: 0, rounding: "NONE", selection_and_oos_distinct: true },
    timing_semantics: { oos_horizon_source: "REBALANCE_FREQUENCY", step_source: "REBALANCE_FREQUENCY", recalibration_source: "REBALANCE_FREQUENCY", monthly_months: 1, quarterly_months: 3 },
    editable_fields: fields.filter(field => !["contract_version", "research_mode", "execution_scope", "universe", "validation_protocol"].includes(field)).map(field => ({
      field, editable: true, required: true, default_source: "USER_SUPPLIED", default_value: "NO_DEFAULT",
      type: field.endsWith("_bps") || field === "training_window_months" ? "number" : "string",
      validation_rule: field.endsWith("_bps") ? "Finite nonnegative number, no rounding" : field.startsWith("evaluation_") ? "ISO month start; exact complete OOS periods within dataset/history bounds" : field === "training_window_months" ? "Positive integer <=1200; actual training >=2 rows for ranking, stateless fit has no learned-history minimum, separate 252-row indicator warmup required" : field === "window_type" ? "ROLLING | EXPANDING" : "MONTHLY | QUARTERLY",
      backend_mapping: field === "transaction_cost_bps" ? "Campaign.transaction_cost_bps OOS scenario" : field === "selection_cost_bps" ? "Campaign.selection_cost_bps training ranking scenario" : field === "evaluation_start" ? "Campaign.dates.start = evaluation_start - training_window_months" : field === "evaluation_end_exclusive" ? "Campaign.dates.end_exclusive" : field === "training_window_months" ? "Campaign.train_months" : field === "rebalance_frequency" ? "Campaign.rebalance_frequency, recalibration_frequency, test_months and step_months" : "Campaign.window_type",
    })),
    fixed_model_definition: { strategy_id: "capital-research-grid-selector", model_family: "current_regime", model_fit: "STATELESS", candidate_space: dataset.fixture.candidate_space,
      constraints: dataset.fixture.constraints, selection_metric: dataset.fixture.selection_metric, information_universe: dataset.fixture.reference_universe,
      warmup_rows: MODEL_HISTORY_ROWS, cash_yield: dataset.fixture.cash_yield, slippage_bps: 0, execution: "next_close", independent_fold_initial_nav: 100 },
    engine_identity: { certified_engine_commit: CERTIFIED_ENGINE_COMMIT, version: "capital-research-1.0.1", adapter_version: ADAPTER_V2, code_version: dataset.code_version },
    temporary_storage: { status: STORAGE_CLASSIFICATION, durability: "NONE" }, resource_limits: { maximum_concurrent_executions: 1, max_jobs: MAX_JOBS, timeout_ms: 120000, max_output_bytes: 64 * 1024 * 1024 },
    compatibility: { old_preview_ui: "CAPABILITY_CONTRACT_MISMATCH_EXECUTION_DISABLED", legacy_api: "/api/workbench/v1", legacy_purpose: "CERTIFICATION_FIXTURE_ONLY" },
    warnings: [PIT_CLASSIFICATION, "Current-regime fit is stateless; no learned estimator is implied."] };
}
