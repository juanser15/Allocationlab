import { generateRebalanceDates, type PriceRow } from "../calculator";
import {
  campaignV2,
  CalendarContractError,
  type DatasetV2,
  type SubmissionV2,
  planCalendarV2,
} from "./calendar-v2";
import { DEFAULT_STORE_LIMITS } from "./run-store";

type Candidate = {
  candidate_id: string;
  spec: {
    model_family: string;
    input_set: string[];
    transformations: { name: string }[];
    model_parameters: Record<string, number>;
    exposure_policy: string;
    exposure_parameters: Record<string, number>;
    rebalance_frequency: "monthly" | "quarterly";
    recalibration_frequency: string;
  };
};
const { generateCandidates, hash } =
  require("../../../../../research/capital/spec") as {
    generateCandidates(c: unknown): { candidates: Candidate[] };
    hash(x: unknown): string;
  };
const { defaultRegistry, modelSpec } =
  require("../../../../../research/capital/registry") as {
    defaultRegistry(): any;
    modelSpec(c: Candidate["spec"]): unknown;
  };
export const PREFLIGHT_VERSION = "workbench-selection-necessity-1.0.0";
export type CalendarPlan = ReturnType<typeof planCalendarV2>;

/** Necessary conditions only. No runCampaign, ledger, returns, ranking or OOS
 * evaluation is performed. The stateless model is queried once per initial
 * training decision using the exact registry and strictly prior information. */
export function selectionPreflight(
  spec: SubmissionV2,
  data: DatasetV2,
  plan: CalendarPlan,
  maxFiles = DEFAULT_STORE_LIMITS.maxEngineFiles,
) {
  const campaign = campaignV2(spec, data),
    candidates = generateCandidates(campaign).candidates;
  const registry = defaultRegistry();
  const fixed = candidates.every(
    (c) =>
      c.spec.model_family === "current_regime" &&
      c.spec.transformations.every((t) => t.name === "identity") &&
      c.spec.rebalance_frequency === c.spec.recalibration_frequency,
  );
  if (!fixed)
    throw new CalendarContractError(
      "PREFLIGHT_MODEL_CONTRACT_MISMATCH",
      "The registered model no longer matches the certified preflight proof.",
      {},
      500,
    );
  const modelGroups = new Set(
    candidates.map((c) =>
      hash({
        family: c.spec.model_family,
        parameters: c.spec.model_parameters,
        inputs: c.spec.input_set,
        transforms: c.spec.transformations,
        cadence: c.spec.recalibration_frequency,
      }),
    ),
  );
  const boundProofs = [];
  for (const fold of plan.folds) {
    const training = data.rows.filter(
      (r) =>
        r.date >= fold.training_start && r.date < fold.training_end_exclusive,
    );
    const predictions = new Map<string, unknown>();
    const candidateBounds = candidates.map((candidate) => {
      registry.validate(candidate.spec);
      const signals = generateRebalanceDates(
        data.rows.filter((r) => r.date < fold.training_end_exclusive),
        candidate.spec.rebalance_frequency,
        campaign.warmup_rows,
        fold.training_start,
      );
      const first = signals[0];
      // Calendar validation already proves sufficient history. A missing signal
      // cannot support a turnover proof; leave selection viability to the engine.
      if (
        !first ||
        training.findIndex((r) => r.date === first) >= training.length - 1
      )
        return {
          candidate_id: candidate.candidate_id,
          exposure_policy: candidate.spec.exposure_policy,
          bound_status: "NOT_PROVEN",
        };
      const historical = data.rows.filter((r) => r.date < first);
      const history: PriceRow[] = historical.map((r) => ({
        date: r.date,
        prices: Object.fromEntries(
          candidate.spec.input_set.map((t) => [t, r.prices[t]]),
        ),
      }));
      const cutoff = history.at(-1)!.date;
      const key = hash({ spec: modelSpec(candidate.spec), first });
      let prediction = predictions.get(key);
      if (!prediction) {
        const model = registry.models.get(candidate.spec.model_family);
        const fitted = model.fit(modelSpec(candidate.spec), {
          rows: [],
          input_set: candidate.spec.input_set,
          training_start: fold.training_start,
          training_end: first,
          information_cutoff: cutoff,
        });
        prediction = model.predict(modelSpec(candidate.spec), fitted, {
          history,
          input_set: candidate.spec.input_set,
          information_cutoff: cutoff,
        });
        predictions.set(key, prediction);
      }
      const target: number = registry.policies
        .get(candidate.spec.exposure_policy)
        .map(prediction, candidate.spec.exposure_parameters);
      const entryTurnover =
        target / (1 + (spec.selection_cost_bps / 10000) * target);
      const annualizedLowerBound = (entryTurnover * 252) / training.length;
      const limit = campaign.constraints.max_turnover;
      return {
        candidate_id: candidate.candidate_id,
        exposure_policy: candidate.spec.exposure_policy,
        parameters: candidate.spec.exposure_parameters,
        bound_status: "PROVEN_INITIAL_ENTRY_LOWER_BOUND",
        training_observations: training.length,
        training_first_decision_date: first,
        information_cutoff: cutoff,
        initial_target_spy_exposure: target,
        initial_entry_turnover: entryTurnover,
        annualized_turnover_lower_bound: annualizedLowerBound,
        maximum_annualized_turnover: limit ?? "NOT_CONFIGURED",
        violates_turnover_constraint:
          Number.isFinite(limit) &&
          annualizedLowerBound > limit + 1e-10 * Math.max(1, Math.abs(limit)),
        minimum_observations_for_this_entry:
          limit > 0 ? Math.ceil((entryTurnover * 252) / limit) : "NOT_DEFINED",
      };
    });
    if (
      candidateBounds.every(
        (c) =>
          c.bound_status === "PROVEN_INITIAL_ENTRY_LOWER_BOUND" &&
          c.violates_turnover_constraint,
      )
    ) {
      const minimum = Math.min(
        ...candidateBounds.map((c) => c.annualized_turnover_lower_bound!),
      );
      const safe = `All exposure policies are necessarily rejected in fold ${fold.fold_id}: required initial-entry turnover alone exceeds the configured annualized-turnover limit.`;
      throw new CalendarContractError(
        "NO_VALID_CANDIDATE",
        safe,
        {
          error_class: "NO_VALID_CANDIDATE",
          failed_stage: "CANDIDATE_SELECTION_PREFLIGHT",
          failed_fold_id: fold.fold_id,
          failed_decision_date: fold.decision_date,
          safe_message: safe,
          actionable_explanation: `The training interval contains ${training.length} observations. Even the smallest required entry annualizes to ${minimum.toFixed(6)}, above the fixed limit ${campaign.constraints.max_turnover}. Net-Sharpe viability and later trading cannot remove this nonnegative entry turnover.`,
          suggested_user_action:
            "Review the training history and preview a revised design that can satisfy the existing turnover constraint. More observations may address this entry bound, but the revised plan must be checked again. No dates, window, policies or constraints were changed automatically.",
          diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED",
          preflight_version: PREFLIGHT_VERSION,
          number_of_folds: plan.number_of_folds,
          requested_training_window_months: spec.training_window_months,
          training_observations: training.length,
          training_start: fold.training_start,
          training_end_exclusive: fold.training_end_exclusive,
          configured_maximum_annualized_turnover:
            campaign.constraints.max_turnover,
          candidates: candidateBounds,
          estimated_jobs: plan.estimated_jobs,
        },
        422,
      );
    }
    boundProofs.push({
      fold_id: fold.fold_id,
      training_observations: training.length,
      necessary_entry_condition: "NOT_PROVEN_INFEASIBLE",
    });
  }
  // For the single stateless model group and coupled clocks, every successful
  // campaign writes every training/OOS job and one fit + prediction per planned
  // model event. Use only 3 assured root files (actual current engine writes 17),
  // so this conservative lower bound cannot reject a sealable campaign.
  const modelFits = Number(
    plan.estimated_jobs.model_fits_estimated_upper_bound,
  );
  if (!Number.isSafeInteger(modelFits) || modelFits < 0)
    throw new CalendarContractError(
      "PREFLIGHT_MODEL_CONTRACT_MISMATCH",
      "The engine's model-event plan cannot be verified.",
      {},
      500,
    );
  const filesLowerBound =
    3 +
    plan.estimated_jobs.backtests_estimated +
    plan.number_of_folds +
    2 * modelFits;
  if (modelGroups.size === 1 && filesLowerBound > maxFiles) {
    const safe =
      "This exact design cannot fit in the current immutable engine-artifact file budget.";
    throw new CalendarContractError(
      "OUTPUT_OR_LOG_LIMIT",
      safe,
      {
        error_class: "OUTPUT_OR_LOG_LIMIT",
        failed_stage: "OUTPUT_BUDGET_PREFLIGHT",
        failed_fold_id: null,
        failed_decision_date: null,
        safe_message: safe,
        actionable_explanation: `A successful campaign requires at least ${filesLowerBound} engine files; the unchanged store limit is ${maxFiles}.`,
        suggested_user_action:
          "This design requires an owner-reviewed resource-capacity change or an explicitly different research design. The service has not shortened dates, training or fold count.",
        diagnostic_reference: "PRE_RUN_NO_ATTEMPT_CREATED",
        resource: "ENGINE_FILE_COUNT",
        minimum_required_engine_files: filesLowerBound,
        maximum_engine_files: maxFiles,
        number_of_folds: plan.number_of_folds,
        estimated_jobs: plan.estimated_jobs,
        preflight_version: PREFLIGHT_VERSION,
      },
      422,
    );
  }
  return {
    version: PREFLIGHT_VERSION,
    status: "NECESSARY_CONDITIONS_PASSED",
    candidate_viability_guaranteed: false,
    financial_backtests_executed: 0,
    initial_entry_bounds_checked: boundProofs,
    minimum_required_engine_files: filesLowerBound,
    maximum_engine_files: maxFiles,
    warning:
      "Preflight checks necessary history, initial-entry turnover and deterministic storage bounds. Net-Sharpe definition, realized drawdown and later turnover still require actual candidate backtesting; eligibility is not guaranteed.",
  };
}
export function validatedWorkbenchPlan(spec: SubmissionV2, data: DatasetV2) {
  const plan = planCalendarV2(spec, data),
    preflight = selectionPreflight(spec, data, plan);
  return {
    ...plan,
    preflight,
    warnings: [...plan.warnings, preflight.warning],
  };
}
