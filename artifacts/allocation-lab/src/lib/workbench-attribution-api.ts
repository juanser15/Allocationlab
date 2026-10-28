import { z } from "zod";
const numeric = z.number().finite();
const diagnostic = z
  .object({
    status: z.string(),
    value: numeric.nullable(),
    reason: z.string().nullable(),
    observations: z.number(),
  })
  .passthrough();
export const exposureModelSchema = z
  .object({
    name: z.string(),
    turnover_rule: z.string().optional(),
    decision: z.string(),
    information_window_observations: z.number().int().positive(),
    policy_selection: z.string(),
    recalibration: z.string(),
    output: z.string(),
    product_meaning: z.string(),
    limitation: z.string(),
    components: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        weight: numeric.nonnegative(),
        availability: z.string(),
      }),
    ),
    score_range: z.object({ minimum: numeric, maximum: numeric }),
    regime_thresholds: z.array(
      z.object({ minimum_score: numeric, label: z.string() }),
    ),
    weight_normalization: z.string(),
    cash_exposure_mapping: z.string(),
    candidate_policy_set: z.array(
      z
        .object({
          policy: z.string(),
          parameters: z.record(numeric),
          description: z.string(),
        })
        .passthrough(),
    ),
    fixed_selection_metric: z.string(),
    fixed_model_versions: z.object({
      models: z.record(z.string()),
      policies: z.record(z.string()),
    }),
    reference_universe: z.array(z.string()),
    execution: z.string(),
  })
  .passthrough();
export type ExposureModel = z.infer<typeof exposureModelSchema>;
const point = z
  .object({
    date: z.string(),
    fold_id: z.number().int(),
    net_return: numeric,
    index: numeric,
    drawdown: numeric,
    spy_exposure: numeric,
    cash_allocation: numeric,
    turnover: numeric,
    realized_cost: numeric,
  })
  .passthrough();
export type BenchmarkPoint = z.infer<typeof point>;
const track = z.object({
  label: z.string(),
  status: z.string(),
  fold_boundaries: z.array(
    z
      .object({
        fold_id: z.number(),
        oos_start: z.string(),
        oos_end_exclusive: z.string(),
      })
      .passthrough(),
  ),
  points: z.array(point),
  hash: z.string(),
});
const metrics = z
  .object({
    observations: numeric,
    cagr: numeric,
    annualized_volatility: numeric,
    max_drawdown: numeric,
    net_sharpe: numeric.nullable(),
    final_research_index: numeric,
    average_risky_exposure: numeric,
    average_cash_allocation: numeric,
    gross_turnover: numeric,
    realized_simulated_cost: numeric,
    full_sample_beta: diagnostic,
    upside_beta: diagnostic,
    downside_beta: diagnostic,
    drawdown_beta: z.record(diagnostic),
    tail_beta: z.record(diagnostic),
    upside_capture: diagnostic,
    downside_capture: diagnostic,
    capm_alpha_diagnostic: z
      .object({
        status: z.string(),
        inference_status: z.string(),
        inference_reason: z.string().nullable(),
        alpha_annualized: numeric.nullable(),
        standard_error_annualized: z.union([numeric, z.string()]),
        t_alpha: numeric.nullable(),
        observations: numeric,
        methodology_version: z.string(),
        configuration: z
          .object({ standard_errors: z.string(), hac_lags: numeric })
          .passthrough(),
      })
      .passthrough(),
    capital_efficiency: z
      .object({
        cagr_per_average_beta: diagnostic,
        cagr_per_average_spy_exposure: diagnostic,
        explanation: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type BenchmarkMetrics = z.infer<typeof metrics>;
export const attributionFields = {
  model_definition: exposureModelSchema.optional(),
  selected_policy_by_fold: z
    .union([
      z.array(
        z
          .object({
            fold: numeric,
            decision_date: z.string(),
            information_cutoff: z.string(),
            training_start: z.string(),
            training_end_exclusive: z.string(),
            oos_start: z.string(),
            oos_end_exclusive: z.string(),
            selected_exposure_policy: z.string(),
            parameters: z.record(numeric),
            training_net_sharpe: numeric,
            average_oos_spy_exposure: numeric,
            average_oos_cash: numeric,
            realized_turnover: numeric,
            training_turnover: z.object({ initial_implementation_turnover: numeric, recurring_gross_turnover: numeric, total_gross_turnover: numeric, annualized_recurring_turnover: numeric, annualized_total_turnover: numeric, turnover_constraint_limit: numeric, turnover_constraint_methodology_version: z.string(), turnover_constraint_metric: z.string(), turnover_constraint_status: z.string() }).passthrough().optional(),
            oos_turnover: z.object({ initial_implementation_turnover: numeric, recurring_gross_turnover: numeric, total_gross_turnover: numeric }).optional(),
            realized_simulated_cost: numeric,
            oos_observations: numeric,
            audit: z.object({
              candidate_id: z.string(),
              fit_keys: z.array(z.string()),
              job_hash: z.string(),
              result_hash: z.string(),
            }),
          })
          .passthrough(),
      ),
      z.string(),
    ])
    .optional(),
  benchmark_tracks: z
    .union([
      z.object({
        DYNAMIC_EXPOSURE: track,
        PASSIVE_SPY: track,
        STATIC_MATCHED_BETA: track,
      }),
      z.string(),
    ])
    .optional(),
  benchmark_metrics: z
    .union([
      z.object({
        DYNAMIC_EXPOSURE: metrics,
        PASSIVE_SPY: metrics,
        STATIC_MATCHED_BETA: z.union([metrics, z.string()]),
      }),
      z.string(),
    ])
    .optional(),
  matched_beta_diagnostic: z
    .object({
      status: z.string(),
      explanation: z.string().optional(),
      reason: z.string().optional(),
      code: z.string().optional(),
      minimum_attainable_control_beta: numeric.optional(),
      maximum_attainable_control_beta: numeric.optional(),
      best_attainable_lambda: numeric.optional(),
      remaining_beta_difference: numeric.optional(),
    })
    .passthrough()
    .optional(),
  attribution: z
    .object({
      status: z.string(),
      code: z.string().optional(),
      explanation: z.string(),
      alpha_claim: z.literal("NONE"),
      values: z
        .union([
          z
            .object({
              total_dynamic_effect_cagr_difference: numeric,
              exposure_level_effect_cagr_difference: numeric,
              timing_residual_cagr_difference: numeric,
            })
            .passthrough(),
          z.string(),
        ])
        .optional(),
    })
    .passthrough()
    .optional(),
  benchmark_methodology_version: z.string().optional(),
  passive_control_hash: z.string().optional(),
  matched_beta_control_hash: z.string().optional(),
  attribution_hash: z.string().optional(),
};
