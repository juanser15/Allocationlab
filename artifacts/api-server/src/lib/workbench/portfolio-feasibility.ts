/** Necessary, data-independent feasibility conditions, shared with the UI.
 * Exposure is an upper bound, NOT an equality. Passing this check does not
 * replace the existing solver or its final-target mandate checks. */
export interface PortfolioFeasibilityInput {
  research_scope?: string;
  etfs?: string[];
  maximum_etf_weight?: number;
  maximum_exposure: number;
  control_mode: string;
  capital_signal_frequency?: string;
  mandate?: {
    minimum_positions: number;
    maximum_positions: number;
    minimum_weight: number;
  };
}
export interface PortfolioFeasibilityIssue {
  code: string;
  message: string;
  fields: string[];
  suggestion: string;
}
const percent = (x: number) => `${Number((x * 100).toFixed(4))}%`;
export function portfolioFeasibilityIssue(
  request: PortfolioFeasibilityInput,
): PortfolioFeasibilityIssue | null {
  if (request.research_scope === "CAPITAL_EXPOSURE") return null;
  const issue = (message: string, fields: string[], suggestion: string): PortfolioFeasibilityIssue =>
    ({ code: "PORTFOLIO_CONSTRAINT_CONFLICT", message, fields, suggestion });
  const candidates = request.etfs;
  if (!Array.isArray(candidates) || !candidates.length)
    return issue("No candidate assets are selected.", ["etfs"], "Select at least one asset from the active dataset.");
  if (new Set(candidates).size !== candidates.length)
    return issue("The candidate universe contains duplicate symbols.", ["etfs"], "Select each asset only once.");
  const max = request.maximum_etf_weight;
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0.001 || max > 1)
    return issue("Maximum weight per asset must be between 0.1% and 100%.", ["maximum_etf_weight"], "Enter a valid per-asset maximum weight.");
  const cap = request.control_mode === "MAX_EXPOSURE" ? request.maximum_exposure : 1;
  if (!Number.isFinite(cap) || cap < 0 || cap > 1)
    return issue("Maximum invested exposure must be between 0% and 100%.", ["maximum_exposure"], "Enter a valid exposure ceiling.");
  const m = request.mandate;
  if (!m) return null;
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
  if (!Number.isFinite(m.minimum_weight) || m.minimum_weight < 0 || m.minimum_weight > 1)
    return issue("Minimum weight per held asset must be between 0% and 100%.", ["mandate.minimum_weight"], "Enter a valid minimum weight on total portfolio value.");
  // Daily's explicit all-cash target is already exempt from holding/floor
  // mandates. Do not reject the legitimate 0%-exposure policy here.
  if (cap === 0 && request.capital_signal_frequency === "DAILY") return null;
  if (m.minimum_weight > max + 1e-12)
    return issue(`Minimum asset weight (${percent(m.minimum_weight)}) exceeds maximum asset weight (${percent(max)}).`,
      ["mandate.minimum_weight", "maximum_etf_weight"], "Lower the minimum weight or raise the maximum weight.");
  if (cap === 0)
    return issue(`The 0% exposure ceiling conflicts with minimum holdings (${m.minimum_positions}).`,
      ["maximum_exposure", "mandate.minimum_positions"], "Raise the exposure ceiling or remove the final-holdings mandate.");
  const required = m.minimum_positions * m.minimum_weight;
  if (required > cap + 1e-12)
    return issue(`${m.minimum_positions} minimum holdings at ${percent(m.minimum_weight)} each require ${percent(required)} invested, above the ${percent(cap)} exposure ceiling.`,
      ["mandate.minimum_positions", "mandate.minimum_weight", "maximum_exposure"],
      "Lower minimum holdings or minimum weight, or raise the exposure ceiling.");
  // max_positions * max_weight < cap is valid: the unused budget stays cash.
  return null;
}
