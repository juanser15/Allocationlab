/** AL-01: isolated contracts, no optimizer/API/research-engine dependency. */
export const CONTRACT_VERSION = "allocation-core-1.1.0" as const;
export const WEIGHT_TOLERANCE = 1e-10;
export const NUMERICAL_TOLERANCE = 1e-12;
export const RISK_CONTRACT_VERSION = "allocation-risk-1.1.0" as const;
/** Absolute dimensionless beta floor for division; never rounds a target to zero. */
export const BETA_DIVISION_TOLERANCE = 64 * Number.EPSILON;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type AllocationMode = "ASSETS" | "FACTORS" | "ALPHA_STREAMS";
export type AllocationStatus = "VALID" | "INFEASIBLE" | "INVALID_INPUT" | "NUMERICAL_FAILURE" | "MAPPING_FAILURE" | "INSUFFICIENT_DATA";
export interface Provenance {
  data_hash: string;
  configuration_hash: string;
  source_ids: string[];
  /** Latest publication/availability of input data, distinct from serialization time. */
  data_available_at: string;
  model: { id: string; version: string } | null;
}
export interface PointInTime {
  as_of: string;
  information_cutoff: string;
  provenance: Provenance;
}
/** @deprecated LEGACY cash/risk primitive. Use RiskMandate in the primary pipeline. */
export interface CapitalLayerOutput extends PointInTime {
  schema_version: typeof CONTRACT_VERSION | "allocation-core-1.0.0";
  policy_id: string;
  policy_version: string;
  risk_budget: number;
  cash_budget: number;
  state: Json;
  confidence: number | null;
  confidence_semantics: "POLICY_DEFINED_SCORE" | "PROBABILITY";
  generated_at: string;
}
export interface TradableInstrument { instrument_id: string; kind: "TRADABLE_INSTRUMENT"; }
export interface AllocationConvention {
  kind: "LONG_ONLY_FULLY_INVESTED" | "SIGNED_EXPOSURES";
  funding: "NET_ONE_WITH_GLOBAL_CASH" | "EXPOSURES_WITH_EXTERNAL_FINANCING";
  /** All these limits are in risk-sleeve exposure units, not total NAV units. */
  mandate: { allow_short: boolean; allow_leverage: boolean; allow_external_financing: boolean;
    max_gross_exposure: number; min_net_exposure: number; max_net_exposure: number };
}
export const LONG_ONLY: AllocationConvention = {
  kind: "LONG_ONLY_FULLY_INVESTED", funding: "NET_ONE_WITH_GLOBAL_CASH",
  mandate: { allow_short: false, allow_leverage: false, allow_external_financing: false,
    max_gross_exposure: 1, min_net_exposure: 1, max_net_exposure: 1 },
};
export interface AllocationConstraints {
  convention: AllocationConvention;
  asset_bounds: Record<string, { min: number; max: number }>;
}
export interface ExpectedReturns extends PointInTime {
  units: "daily_decimal_return";
  values: Record<string, number>;
}
export interface CovarianceRiskModel extends PointInTime {
  representation: "COVARIANCE";
  units: "daily_decimal_return_squared";
  axis_ids: string[];
  covariance: number[][];
}
export interface PreviousHoldings extends PointInTime {
  units: "fraction_of_risk_capital";
  asset_weights: Record<string, number>;
}
export interface AssetsAllocationInput extends PointInTime {
  schema_version: typeof CONTRACT_VERSION;
  allocation_mode: "ASSETS";
  candidate_assets: TradableInstrument[];
  expected_returns: ExpectedReturns;
  risk_model: CovarianceRiskModel;
  constraints: AllocationConstraints;
  previous_holdings: PreviousHoldings | null;
}
export interface AssetDecisionWeights extends PointInTime {
  units: "fraction_of_risk_capital";
  asset_decision_weights: Record<string, number>;
  explicit_unallocated_risk_budget: number;
}
export interface FactorExposureTarget extends PointInTime {
  units: "factor_exposure";
  exposures: Record<string, number>;
}
export interface FactorModel extends PointInTime {
  model_id: string;
  model_version: string;
  factor_ids: string[];
  /** Economic meaning/unit of each exposure, not capital weights. */
  factor_units: Record<string, string>;
  risk_model: CovarianceRiskModel;
}
export interface AssetFactorLoadingMatrix extends PointInTime {
  units: "factor_exposure_per_unit_risk_weight";
  orientation: "FACTORS_BY_ASSETS";
  factor_ids: string[];
  instrument_ids: string[];
  values: number[][];
  /** SHA256 of canonical {units,orientation,factor_ids,instrument_ids,values}. */
  matrix_hash: string;
}
export interface FactorsAllocationInput extends PointInTime {
  schema_version: typeof CONTRACT_VERSION;
  allocation_mode: "FACTORS";
  candidate_assets: TradableInstrument[];
  target: FactorExposureTarget;
  factor_model: FactorModel;
  loading_matrix: AssetFactorLoadingMatrix;
  constraints: AllocationConstraints;
  /** AL-01 only: unique square linear system. No optimization/regularization. */
  implementation: { method: "UNIQUE_SQUARE_EXACT"; regularization: "NONE" };
}
export interface FactorImplementationResult extends PointInTime {
  factor_model_identity: PointInTime & { model_id: string; model_version: string };
  target_factor_exposures: Record<string, number>;
  achieved_factor_exposures: Record<string, number> | null;
  implementation_asset_weights: Record<string, number> | null;
  asset_weight_units: "fraction_of_risk_capital";
  tracking_residual: Record<string, number> | null;
  tracking_error: number | null;
  tracking_error_definition: "EUCLIDEAN_EXPOSURE_RESIDUAL_NOT_ANNUALIZED_RISK";
  feasibility_status: AllocationStatus;
  method: "UNIQUE_SQUARE_EXACT";
  regularization: "NONE";
  matrix_date: string;
  matrix_information_cutoff: string;
  matrix_hash: string;
  mapping_provenance: Provenance;
}
export interface AlphaHistory extends PointInTime {
  kind: "REALIZED_RETURNS" | "REALIZED_PNL";
  units: "daily_decimal_return" | "pnl_per_unit_stream_capital";
  observations: Array<{ date: string; value: number }>;
}
export interface AlphaPositionMap extends PointInTime {
  units: "asset_exposure_per_unit_stream_capital";
  asset_exposures: Record<string, number>;
  explicit_unallocated_stream_capital: number;
}
export interface AlphaStream extends PointInTime {
  alpha_stream_id: string;
  version: string;
  historical_series: AlphaHistory;
  expected_return_forecast: ExpectedReturns | null;
  risk_model: CovarianceRiskModel;
  unit_position_map: AlphaPositionMap;
  execution_convention: { rebalance: string; execution: "same_close" | "next_close" | "next_open";
    signal_cutoff: "STRICT_PREVIOUS_CLOSE" | "CLOSE_T_FILL_OPEN_T_PLUS_1" };
}
export interface AlphaStreamsAllocationInput extends PointInTime {
  schema_version: typeof CONTRACT_VERSION;
  allocation_mode: "ALPHA_STREAMS";
  candidate_assets: TradableInstrument[];
  alpha_streams: AlphaStream[];
  /** Cross-stream covariance in stream capital return units. */
  risk_model: CovarianceRiskModel;
  constraints: AllocationConstraints;
}
export interface AlphaCapitalDecision extends PointInTime {
  units: "fraction_of_risk_capital";
  alpha_allocations: Record<string, number>;
  explicit_unallocated_risk_budget: number;
}
export interface AlphaAggregationResult extends PointInTime {
  alpha_allocations: Record<string, number>;
  aggregated_asset_exposures: Record<string, number>;
  /** Gross before cross-stream netting, different from tradable asset gross. */
  pre_netting_gross_exposure: number;
  contributions: Record<string, Record<string, number>>;
  stream_versions: Record<string, string>;
  position_map_provenance: Record<string, PointInTime>;
}
export type ModeDetails =
  | { allocation_mode: "ASSETS"; asset_decision_weights: Record<string, number> }
  | { allocation_mode: "FACTORS"; implementation: FactorImplementationResult }
  | { allocation_mode: "ALPHA_STREAMS"; aggregation: AlphaAggregationResult }
  | { allocation_mode: AllocationMode; failure: string[] };
export interface RiskSleeveAllocationResult extends PointInTime {
  schema_version: typeof CONTRACT_VERSION;
  allocation_id: string;
  allocation_mode: AllocationMode;
  input_snapshot_id: string;
  status: AllocationStatus;
  asset_weight_units: "fraction_of_risk_capital";
  asset_weights_risk_sleeve: Record<string, number> | null;
  gross_exposure: number | null;
  net_exposure: number | null;
  /** Unscaled sleeve estimates; null explicitly means no estimate was supplied. */
  estimated_market_beta: number | null;
  estimated_volatility: number | null;
  asset_market_betas: Record<string, number> | null;
  beta_model: BetaModel | null;
  risk_model_provenance: PointInTime | null;
  risk_measurement_status: "NOT_ESTIMATED" | "AVAILABLE";
  /** Risk-capital units; never merged into global cash. */
  explicit_unallocated_risk_budget: number;
  convention: AllocationConvention;
  turnover_estimate: number | null;
  mode_specific_details: ModeDetails;
  warnings: string[];
  errors: string[];
}
export interface FinalPortfolio extends PointInTime {
  schema_version: typeof CONTRACT_VERSION;
  portfolio_id: string;
  status: AllocationStatus;
  semantics: "LEGACY_RISK_FRACTION";
  capital_policy: { id: string; version: string } | null;
  capital_output_hash: string;
  risk_allocation_id: string | null;
  units: "fraction_of_total_nav";
  total_asset_weights: Record<string, number> | null;
  /** Preserved from validated CapitalLayerOutput, including on infeasible composition. */
  total_cash_weight: number | null;
  gross_exposure: number | null;
  net_exposure: number | null;
  explicit_unallocated_risk_budget: number | null;
  balance_convention: "NET_ASSET_WEIGHTS_PLUS_CASH_EQUAL_ONE" | "EXPOSURES_NOT_BALANCE_SHEET" | null;
  warnings: string[];
  errors: string[];
}
export interface ValidationResult<T> {
  status: "VALID" | "INVALID_INPUT" | "INSUFFICIENT_DATA";
  value: T | null;
  errors: string[];
}
/** A malformed envelope has no canonical result: provenance is never invented. */
export interface AllocationResponse {
  status: AllocationStatus;
  result: RiskSleeveAllocationResult | null;
  errors: string[];
}
export interface CompositionResponse {
  status: AllocationStatus;
  portfolio: FinalPortfolio | null;
  errors: string[];
}

/** Primary architecture: systematic risk target; cash is an implementation result. */
export interface RiskMandate {
  schema_version: typeof RISK_CONTRACT_VERSION;
  as_of: string;
  policy_id: string;
  policy_version: string;
  state: Json;
  confidence: number | null;
  confidence_semantics: "POLICY_DEFINED_SCORE" | "PROBABILITY";
  semantics: "SYSTEMATIC_RISK" | "LEGACY";
  /** Mandatory for MARKET_BETA; never substitute a different beta benchmark. */
  market_benchmark: string | null;
  primary_target: { metric: "MARKET_BETA" | "VOLATILITY" | "RISK_FRACTION";
    target: number; lower_bound: number | null; upper_bound: number | null };
  constraints: { min_risky_allocation: number; max_risky_allocation: number;
    cash_floor: number; cash_ceiling: number; max_gross_exposure: number; max_net_exposure: number };
  exposure_policy: { controller: "LONG_ONLY_NO_LEVERAGE_V1"; constraint_action: "REJECT" | "CLIP" };
  provenance: Provenance & { information_cutoff: string; generated_at: string };
  legacy_source: { capital_output_hash: string; risk_budget: number; cash_budget: number } | null;
}
export interface BetaModel {
  benchmark: string;
  estimation_window: { start: string; end: string; observations: number };
  estimator: "OLS_COV_VARIANCE_SAMPLE_V1" | "SUPPLIED_ASSET_BETAS_V1";
  as_of: string;
  information_cutoff: string;
  data_hash: string;
}
export interface SleeveRiskEstimate extends PointInTime {
  schema_version: typeof RISK_CONTRACT_VERSION;
  units: "UNSCALED_SLEEVE_ANNUAL_VOLATILITY";
  allocation_weights_hash: string;
  asset_market_betas: Record<string, number>;
  estimated_market_beta: number;
  estimated_volatility: number;
  beta_model: BetaModel;
}
export interface ExposureControllerResult {
  schema_version: typeof RISK_CONTRACT_VERSION;
  controller: "LONG_ONLY_NO_LEVERAGE_V1";
  status: AllocationStatus;
  semantics: "SYSTEMATIC_RISK" | "LEGACY";
  mandate_hash: string;
  allocation_id: string;
  requested_target: RiskMandate["primary_target"];
  exposure_multiplier: number | null;
  total_asset_weights: Record<string, number> | null;
  implied_cash_weight: number | null;
  expected_final_beta: number | null;
  expected_final_volatility: number | null;
  beta_sleeve: number | null;
  volatility_sleeve: number | null;
  beta_model: BetaModel | null;
  risk_model_provenance: PointInTime | null;
  gross_exposure: number | null;
  net_exposure: number | null;
  explicit_unallocated_risk_budget: number;
  target_clipped: boolean;
  constraint_failures: string[];
  warnings: string[];
  as_of: string;
  information_cutoff: string;
  provenance: Provenance;
  composition_id: string;
}
export interface MandatedCompositionResponse { status: AllocationStatus; portfolio: ExposureControllerResult | null; errors: string[]; }
export interface ExposureController {
  readonly id: "LONG_ONLY_NO_LEVERAGE_V1";
  readonly version: "1";
  compose(mandate:RiskMandate,sleeve:RiskSleeveAllocationResult):MandatedCompositionResponse;
}
export interface RiskMandateResponse { status: AllocationStatus; mandate: RiskMandate | null; errors: string[]; }

export type MarketRiskMetricName = "market_beta" | "rolling_market_beta" | "upside_beta" | "downside_beta" |
  "drawdown_beta" | "tail_beta" | "upside_capture" | "downside_capture";
export interface MarketRiskConfiguration {
  methodology_version: "market-risk-metrics-1.0.0";
  benchmark: string;
  rolling_window_observations: number; // default 63
  drawdown_threshold: number; // default -0.10
  tail_quantile: number; // default .05
  minimum_observations: number; // default 2
  capture_method: "GEOMETRIC_SUBSET_DAILY_RATIO_V1";
  quantile_method: "LINEAR_TYPE7_V1";
}
export interface PairedReturn { date: string; portfolio_return: number; market_return: number; }
export interface MarketRiskMetric extends PointInTime {
  name: MarketRiskMetricName;
  units: "BETA" | "CAPTURE_RATIO";
  value: number | null;
  status: "VALID" | "INSUFFICIENT_DATA" | "NUMERICAL_FAILURE";
  observations: number;
  sample_start: string | null;
  sample_end: string | null;
  methodology_version: MarketRiskConfiguration["methodology_version"];
  reason: string | null;
}
export interface MarketRiskMetricResult { status: "VALID" | "INVALID_INPUT"; metrics: MarketRiskMetric[];
  configuration: MarketRiskConfiguration; errors: string[]; }
/** Definition only in AL01; no regression fitting or t-stat computation added. */
export interface CapmAlphaResult extends PointInTime {
  status: "VALID" | "INSUFFICIENT_DATA" | "NUMERICAL_FAILURE" | "NOT_IMPLEMENTED";
  alpha_annualized: number | null;
  alpha_t_stat: number | null;
  beta: number | null;
  beta_t_stat: number | null;
  model_spec: { version: "CAPM_EXCESS_RETURN_OLS_V1"; benchmark: string; risk_free_source: string;
    return_frequency: "DAILY"; annualization: "252_TIMES_DAILY_INTERCEPT";
    standard_error_method: "OLS_HOMOSKEDASTIC" | "HAC_NEWEY_WEST"; hac_lags: number | null };
  sample_start: string | null;
  sample_end: string | null;
}
export interface PortfolioRiskAttribution extends PointInTime {
  schema_version: typeof RISK_CONTRACT_VERSION;
  cagr: number | null; annualized_volatility: number | null; max_drawdown: number | null;
  cvar: { value: number | null; quantile: number; methodology_version: string };
  average_beta: number | null;
  rolling_beta_summary: { window: number; mean: number | null; min: number | null; max: number | null };
  upside_beta: MarketRiskMetric | null; downside_beta: MarketRiskMetric | null;
  drawdown_beta: MarketRiskMetric | null; tail_beta: MarketRiskMetric | null;
  upside_capture: MarketRiskMetric | null; downside_capture: MarketRiskMetric | null;
  capm_alpha: CapmAlphaResult | null; capm_alpha_tstat: number | null;
  mean_risky_allocation: number | null; mean_cash: number | null;
  turnover: number | null; costs: number | null;
  /** No aggregate score or selection objective in this contract. */
  metric_methodology_versions: Record<string, string>;
}
