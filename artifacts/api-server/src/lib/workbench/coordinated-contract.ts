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
