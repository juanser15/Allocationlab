export const COORDINATED_SPEC = "allocationlab-coordinated-1.0.0" as const;
export const ETF_UNIVERSE = [
  "SPY",
  "EFA",
  "EEM",
  "IEF",
  "TLT",
  "GLD",
  "DBC",
  "VNQ",
] as const;
export interface CoordinatedRequest {
  dataset_id?: string;
  forecast?: ForecastConfig;
  research_scope?: "PORTFOLIO";
  contract_version: typeof COORDINATED_SPEC;
  evaluation_start: string;
  evaluation_end_exclusive: string;
  training_window_months: number;
  window_type: "ROLLING" | "EXPANDING";
  rebalance_frequency: "MONTHLY" | "QUARTERLY";
  transaction_cost_bps: number;
  control_mode: "MAX_EXPOSURE" | "RISK_BUDGET";
  maximum_exposure: number;
  risk_budget: number;
  regime_model: "CURRENT" | "TREND" | "TREND_VOL" | "HMM";
  regime_response: "FIXED" | "ADAPTIVE";
  defensive_multiplier: number;
  etfs: string[];
  maximum_etf_weight: number;
  risk_aversion: number;
  covariance_shrinkage: number;
}
export const PORTFOLIO_FIELDS = [
  "forecast",
  "etfs",
  "maximum_etf_weight",
  "risk_aversion",
  "covariance_shrinkage",
] as const;
export type CapitalStudyRequest = Omit<
  CoordinatedRequest,
  (typeof PORTFOLIO_FIELDS)[number] | "research_scope"
> & {
  research_scope: "CAPITAL_EXPOSURE";
};
export type ResearchSubmission = CoordinatedRequest | CapitalStudyRequest;
export const isCapitalStudy = (
  request: ResearchSubmission,
): request is CapitalStudyRequest =>
  request.research_scope === "CAPITAL_EXPOSURE";

export type AssetSignal = {
  id: "MOMENTUM" | "RELATIVE_MOMENTUM" | "TREND" | "REVERSAL";
  enabled: boolean;
  lookback_sessions: number;
  skip_sessions: number;
  weight: number;
};
export interface ForecastConfig {
  model: "HISTORICAL_MEAN" | "MANUAL_SCORE" | "SIGNAL_RIDGE";
  horizon_sessions: number;
  training_sessions: number;
  ridge_penalty: number;
  manual_base_return: number;
  manual_score_return: number;
  signals: AssetSignal[];
}
export const DEFAULT_FORECAST: ForecastConfig = {
  model: "HISTORICAL_MEAN",
  horizon_sessions: 21,
  training_sessions: 126,
  ridge_penalty: 1,
  manual_base_return: 0,
  manual_score_return: 0.01,
  signals: [
    {
      id: "MOMENTUM",
      enabled: true,
      lookback_sessions: 126,
      skip_sessions: 21,
      weight: 1,
    },
    {
      id: "RELATIVE_MOMENTUM",
      enabled: true,
      lookback_sessions: 126,
      skip_sessions: 21,
      weight: 1,
    },
    {
      id: "TREND",
      enabled: true,
      lookback_sessions: 63,
      skip_sessions: 0,
      weight: 1,
    },
    {
      id: "REVERSAL",
      enabled: false,
      lookback_sessions: 5,
      skip_sessions: 0,
      weight: 1,
    },
  ],
};
export const forecastNames = {
  HISTORICAL_MEAN: "Historical Mean · Reference",
  MANUAL_SCORE: "Signal score · Manual mapping",
  SIGNAL_RIDGE: "Signal Ridge · Pooled assets",
};
