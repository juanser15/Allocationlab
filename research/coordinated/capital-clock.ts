import { ResearchError } from "./models";

export const CAPITAL_CLOCK_VERSION = "separate-capital-clock-1.0.0";
export const CAPITAL_TIMING = "Decision D uses observations strictly before D; execute at the next observed close after D. A final signal without an in-window next close is not executed.";
export const EXPOSURE_TOLERANCE = 1e-10;

/** Persist independently of current holdings, including while entirely in cash. */
export function riskyTemplate(weights: number[]) {
  if (weights.some(w => !Number.isFinite(w) || w < -EXPOSURE_TOLERANCE))
    throw new ResearchError("INVALID_RISKY_TEMPLATE", "The optimizer produced invalid long-only sleeve weights.");
  const exposure = weights.reduce((s, w) => s + Math.max(0, w), 0);
  return { maximum_exposure: exposure, proportions: weights.map(w => exposure > EXPOSURE_TOLERANCE ? Math.max(0, w) / exposure : 0) };
}

/** Existing allocation's cash preference/limits are retained; the overlay only scales its risky sleeve. */
export function overlayExposure(
  template: ReturnType<typeof riskyTemplate>,
  covariance: number[][],
  cap: number,
  budget: number | null,
) {
  const variance = template.proportions.reduce((sum, a, i) =>
    sum + template.proportions.reduce((s, b, j) => s + a * b * covariance[i][j], 0), 0);
  if (!Number.isFinite(variance) || variance < -1e-10) throw new ResearchError("INVALID_RISKY_TEMPLATE", "Frozen-sleeve variance is invalid.");
  const volatility = Math.sqrt(Math.max(0, variance));
  const allowed = budget === null ? cap : volatility > 0 ? budget / volatility : 1;
  const exposure = Math.max(0, Math.min(1, template.maximum_exposure, allowed));
  return { exposure, weights: template.proportions.map(p => p * exposure), volatility: exposure * volatility };
}

export function capitalClockEvidence(frequency: "DAILY" | "REBALANCE_ONLY", signals: any[], ledger: any[]) {
  const overlayDates = new Set(signals.filter(s => !s.rebalance_date && s.trade_requested).map(s => s.decision_date));
  const overlay = ledger.filter(d => overlayDates.has(d.executionSignalDate));
  const tradingDays = overlay.filter(d => d.trades.some((t: any) => Math.abs(t.notional) > EXPOSURE_TOLERANCE));
  const sum = (days: any[], field: string) => days.reduce((s, d) => s + d[field], 0);
  const fees = sum(overlay, "transactionCosts"), slippage = sum(overlay, "slippage");
  return {
    frequency, execution_convention: CAPITAL_TIMING, signals,
    intramonth_exposure_changes: tradingDays.length,
    capital_overlay_transaction_costs: fees, capital_overlay_slippage: slippage,
    capital_overlay_costs: fees + slippage,
    joint_rebalance_costs: sum(ledger.filter(d => d.executionSignalDate && !overlayDates.has(d.executionSignalDate)), "transactionCosts") +
      sum(ledger.filter(d => d.executionSignalDate && !overlayDates.has(d.executionSignalDate)), "slippage"),
    cost_attribution: "Cash amounts on initial NAV 100. Overlay-only costs are actual fees/slippage on non-optimizer-date signals. Joint scheduled-rebalance trades are reported separately; no hypothetical causal split is claimed.",
    sleeve_convention: "Normalize the existing optimizer's unadjusted-policy risky weights; retain its total-risk allocation as the overlay ceiling. Regime changes never invoke the optimizer between rebalance dates. Zero optimizer allocation stays cash until the next optimizer decision.",
    mandate_convention: "In Daily mode, positive-risk targets retain weight and holding mandates; a deliberate fully-cash capital signal is exempt from minimum holdings. No floor uplift or fallback allocation is introduced.",
  };
}
