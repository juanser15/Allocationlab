/** Opt-in interval return adapter. Legacy callers retain their exact arithmetic. */
import { runScheduledLedger } from "./interactive-ledger";
import { CalendarContractError } from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
export function remuneratedLedger(
  intervalReturns: Map<string, number>,
  slippageBps: number,
  targetCheck: (date: string, targets: Record<string, number>) => void,
): typeof runScheduledLedger {
  return (...args) => {
    const [rows, etfs, constraints, config, benchmark, factors, targets, state, dates, regime] = args;
    return runScheduledLedger(rows, etfs, constraints, { ...config, slippageBps }, benchmark, factors,
      targets ? (date, history, context) => {
        const weights = targets(date, history, context);
        if (weights) targetCheck(date, weights);
        return weights;
      } : undefined, state, dates, regime,
      (_previous, current) => {
        const r = intervalReturns.get(current.date);
        if (r === undefined) throw new CalendarContractError("CASH_HISTORY_REQUIRED", "Missing declared cash interval. No unconfigured return was substituted.", { date: current.date }, 422);
        return r;
      });
  };
}
