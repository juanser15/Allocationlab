import type { ResearchSubmission } from "./coordinated-contract";
import { CURRENT_CASH_POLICY, type ResearchCashPolicy } from "./coordinated-contract";
import type { PriceRow } from "../calculator";
import { CalendarContractError } from "./calendar-v2";
import { portfolioFeasibilityIssue } from "./portfolio-feasibility";
export const INSTITUTIONAL_VERSION = "institutional-accounting-4.0.0-zero-cash-capital-clock";
export const INSTITUTIONAL_FIELDS = ["cash_policy", "slippage_bps", "mandate", "quality_control"] as const;
export function parseInstitutional(value: ResearchSubmission) {
  const fail = (message: string): never => { throw new CalendarContractError("INVALID_FINANCIAL_CONVENTION", message, {}, 422); };
  const c = value.cash_policy;
  if (!c || Object.keys(c).sort().join() !== "annual_rate,type" || c.type !== "ZERO_RETURN" || c.annual_rate !== 0)
    fail("Cash return is currently forced to 0%. New research requires cash_policy { type: ZERO_RETURN, annual_rate: 0 }. Saved SGOV results remain unchanged; create a new experiment to use the current policy.");
  const slippage = value.slippage_bps ?? 0;
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1000) fail("Slippage must be 0–1000 basis points per absolute traded notional.");
  const m = value.mandate;
  const q = value.quality_control;
  if (value.research_scope === "CAPITAL_EXPOSURE") {
    if (q !== undefined) fail("The isolated SPY/cash study cannot receive portfolio Quality Control.");
  } else if (!q || Object.keys(q).sort().join() !== "enabled,policy_version" || typeof q.enabled !== "boolean" || q.policy_version !== "STRUCTURAL_V1")
    fail("Explicit Quality Control ON/OFF and policy STRUCTURAL_V1 are required for a new portfolio run.");
  if (m !== undefined) {
    if (value.research_scope === "CAPITAL_EXPOSURE") fail("The isolated SPY/cash study cannot receive ETF selection or mandate inputs.");

  }
  const conflict = portfolioFeasibilityIssue(value);
  if (conflict)
    throw new CalendarContractError(conflict.code, `${conflict.message} ${conflict.suggestion}`, { category: conflict.code, fields: conflict.fields, suggestion: conflict.suggestion, ...conflict.details }, 422);
  return { cash_policy: { ...CURRENT_CASH_POLICY }, slippage_bps: slippage, ...(m ? { mandate: { ...m } } : {}), ...(q ? { quality_control: { ...q } } : {}) };
}
/** Current cash return is explicitly zero on each observed calendar interval.
 * Historical SGOV interpretation remains explicit, with no price fill or yield conversion.
 */
export function cashIntervals(rows: PriceRow[], start: string, end: string, policy: ResearchCashPolicy = CURRENT_CASH_POLICY) {
  const returns = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1], current = rows[i];
    if (current.date < start || current.date >= end) continue;
    if (policy.type === "ZERO_RETURN") {
      if (policy.annual_rate !== 0) throw new CalendarContractError("INVALID_FINANCIAL_CONVENTION", "Zero-return cash requires annual_rate: 0.", {}, 422);
      returns.set(current.date, 0);
      continue;
    }
    const a = previous.prices.SGOV, b = current.prices.SGOV;
    if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0))
      throw new CalendarContractError("CASH_HISTORY_REQUIRED", "SGOV adjusted-close observations are required for every cash accrual interval. No zero yield or price fill was substituted.", { interval_start: previous.date, interval_end: current.date, ticker: "SGOV" }, 422);
    const r = b / a - 1;
    if (!Number.isFinite(r) || r <= -1) throw new CalendarContractError("CASH_HISTORY_REQUIRED", "Invalid SGOV cash-proxy interval return.", { date: current.date }, 422);
    returns.set(current.date, r);
  }
  if (!returns.size) throw new CalendarContractError("CASH_HISTORY_REQUIRED", "No cash-accounting intervals are available in the evaluation window.", {}, 422);
  return returns;
}
