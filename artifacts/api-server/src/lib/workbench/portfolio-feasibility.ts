/** Shared necessary feasibility conditions for strategic portfolio construction.
 * Capital-overlay scaling and subsequent market drift do not reapply holdings or
 * position-size construction limits. Future strategic covariance is still unknown. */
import { MIN_ACTIVE_WEIGHT } from "./portfolio-numerics";
export interface PortfolioFeasibilityInput {
  research_scope?: string;
  etfs?: string[];
  maximum_etf_weight?: number;
  maximum_exposure: number;
  control_mode: string;
  risk_budget?: number;
  capital_signal_frequency?: string;
  regime_response?: string;
  defensive_multiplier?: number;
  mandate?: {
    minimum_positions: number;
    maximum_positions: number;
    minimum_weight: number;
  };
}
export interface PortfolioFeasibilityIssue {
  code: "PORTFOLIO_CONSTRAINT";
  message: string;
  fields: string[];
  suggestion: string;
  details?: Record<string, unknown>;
}
const percent = (x: number) => `${Number((x * 100).toFixed(4))}%`;
/** EXACT is an internal solver/preflight convention, not a new accepted API field.
 * Ordinary Workbench requests use the existing CEILING semantics. */
export function portfolioFeasibilityIssue(
  request: PortfolioFeasibilityInput,
  budgetMode: "CEILING" | "EXACT" = "CEILING",
): PortfolioFeasibilityIssue | null {
  if (request?.research_scope === "CAPITAL_EXPOSURE") return null;
  const issue = (message: string, fields: string[], suggestion: string, details?: Record<string, unknown>): PortfolioFeasibilityIssue =>
    ({ code: "PORTFOLIO_CONSTRAINT", message, fields, suggestion, ...(details ? { details } : {}) });
  const candidates = request?.etfs;
  if (!Array.isArray(candidates) || !candidates.length)
    return issue("No candidate assets are selected.", ["etfs"], "Select at least one asset from the active dataset.");
  if (candidates.some(t => typeof t !== "string" || !/^[A-Z0-9.^=-]{1,24}$/.test(t)))
    return issue("A candidate symbol has an invalid format.", ["etfs"], "Select assets using the active dataset selector.");
  if (new Set(candidates).size !== candidates.length)
    return issue("The candidate universe contains duplicate symbols.", ["etfs"], "Select each asset only once.");
  const max = request.maximum_etf_weight;
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0.001 || max > 1)
    return issue("Maximum weight per asset must be between 0.1% and 100%.", ["maximum_etf_weight"], "Enter a valid per-asset maximum weight.");
  if (!["MAX_EXPOSURE", "RISK_BUDGET"].includes(request.control_mode))
    return issue("Choose an exposure ceiling or risk-budget policy.", ["control_mode"], "Select a supported capital-control mode.");
  if (typeof request.maximum_exposure !== "number" || !Number.isFinite(request.maximum_exposure) || request.maximum_exposure < 0 || request.maximum_exposure > 1)
    return issue("Maximum invested exposure must be between 0% and 100%.", ["maximum_exposure"], "Enter a valid exposure ceiling.");
  if (request.control_mode === "RISK_BUDGET" && (typeof request.risk_budget !== "number" || !Number.isFinite(request.risk_budget) || request.risk_budget < .001 || request.risk_budget > 1))
    return issue("Risk budget must be a finite annualized volatility ceiling between 0.1% and 100%.", ["risk_budget"], "Enter a valid volatility budget; it is not an exposure equality.");
  if (request.capital_signal_frequency !== undefined && !["DAILY", "REBALANCE_ONLY"].includes(request.capital_signal_frequency))
    return issue("Capital monitoring must be Daily or Rebalance-only.", ["capital_signal_frequency"], "Choose one of the supported independent capital monitoring clocks.");
  if (request.regime_response !== undefined && !["FIXED", "ADAPTIVE"].includes(request.regime_response))
    return issue("Choose a fixed or adaptive capital policy.", ["regime_response"], "Select a supported capital response.");
  if (request.regime_response === "ADAPTIVE" && (typeof request.defensive_multiplier !== "number" || !Number.isFinite(request.defensive_multiplier) || request.defensive_multiplier < 0 || request.defensive_multiplier > 1))
    return issue("The defensive exposure multiplier must be finite and between 0 and 1.", ["defensive_multiplier"], "Enter an explicit stress reduction between 0% and 100%.");
  const cap = request.control_mode === "MAX_EXPOSURE" ? request.maximum_exposure : 1;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap < 0 || cap > 1)
    return issue("Maximum invested exposure must be between 0% and 100%.", ["maximum_exposure"], "Enter a valid exposure ceiling.");
  const m = request.mandate;
  if (m === undefined) return null;
  if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).sort().join() !== "maximum_positions,minimum_positions,minimum_weight")
    return issue("The final-holdings mandate requires minimum holdings, maximum holdings and minimum weight per held asset.", ["mandate"], "Supply all three mandate fields, or explicitly turn the mandate off.");
  if (!Number.isSafeInteger(m.minimum_positions) || m.minimum_positions < 1)
    return issue("Minimum final holdings must be a positive whole number.", ["mandate.minimum_positions"], "Enter the minimum number of assets the portfolio must hold.");
  if (!Number.isSafeInteger(m.maximum_positions) || m.maximum_positions < 1)
    return issue("Maximum final holdings must be a positive whole number.", ["mandate.maximum_positions"], "Enter a positive maximum number of holdings.");
  if (m.minimum_positions > m.maximum_positions)
    return issue(`Minimum holdings (${m.minimum_positions}) exceed maximum holdings (${m.maximum_positions}).`,
      ["mandate.minimum_positions", "mandate.maximum_positions"], "Lower minimum holdings or raise maximum holdings.");
  if (m.minimum_positions > candidates.length)
    return issue(`Minimum holdings (${m.minimum_positions}) exceed the selected candidates (${candidates.length}).`,
      ["mandate.minimum_positions", "etfs"], "Select more candidate assets or lower minimum holdings.");
  if (m.maximum_positions > candidates.length)
    return issue(`Maximum holdings (${m.maximum_positions}) exceed the selected candidates (${candidates.length}).`,
      ["mandate.maximum_positions", "etfs"], "Set maximum holdings no higher than the number of selected candidates.");
  if (typeof m.minimum_weight !== "number" || !Number.isFinite(m.minimum_weight) || m.minimum_weight < 0 || m.minimum_weight > 1)
    return issue("Minimum weight per held asset must be between 0% and 100%.", ["mandate.minimum_weight"], "Enter a valid minimum weight on total portfolio value.");
  if (m.minimum_weight > max)
    return issue(`Minimum asset weight (${percent(m.minimum_weight)}) exceeds maximum asset weight (${percent(max)}).`,
      ["mandate.minimum_weight", "maximum_etf_weight"], "Lower the minimum weight or raise the maximum weight.");
  // An explicit zero-exposure policy is valid in BOTH monitoring modes. The
  // mandate's input types/ranges still must be valid; no invalid draft is repaired.
  if (cap === 0) return null;
  const required = m.minimum_positions * Math.max(m.minimum_weight, MIN_ACTIVE_WEIGHT);
  if (required > cap)
    return issue(`${m.minimum_positions} minimum holdings at ${percent(m.minimum_weight)} each require ${percent(required)} invested, above the ${percent(cap)} exposure ceiling.`,
      ["mandate.minimum_positions", "mandate.minimum_weight", "maximum_exposure"],
      "Lower minimum holdings or minimum weight, or raise the exposure ceiling.",
      { inequality: "minimum_positions * effective_minimum_weight <= exposure_ceiling", required_exposure: required, exposure_ceiling: cap });
  if (budgetMode === "EXACT" && m.maximum_positions * max < cap)
    return issue(`${m.maximum_positions} maximum holdings at ${percent(max)} each can invest at most ${percent(m.maximum_positions * max)}, below the exact ${percent(cap)} investment requirement.`,
      ["mandate.maximum_positions", "maximum_etf_weight", "maximum_exposure"],
      "Increase position capacity or change the explicitly required investment budget.",
      { inequality: "maximum_positions * maximum_weight >= exact_exposure", maximum_position_capacity: m.maximum_positions * max, exact_exposure: cap });
  // The baseline cap funds strategic NAV targets at scheduled rebalances.
  // HMM scaling is a separate capital decision; its reduced exposure is not a
  // new portfolio construction budget and must not trigger a floor blocker.
  return null;
}
export function portfolioFeasibilityWarnings(request: PortfolioFeasibilityInput): string[] {
  if (!request.mandate) return [];
  return ["Holdings and position-size constraints apply to strategic NAV targets at scheduled allocation rebalances. Capital-overlay changes and market drift may move effective holdings outside those construction limits without an error or corrective trade. Static preflight does not guarantee future strategic risk estimates or solver convergence."];
}
