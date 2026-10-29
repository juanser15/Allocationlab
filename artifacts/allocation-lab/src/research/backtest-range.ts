export type CalendarDates = {
  evaluation_start: string;
  evaluation_end_exclusive: string;
};
export type DateField = keyof CalendarDates;
type Ticket = { dataset: string; context: string; mode: "INITIAL" | "OBSERVE" | "EXPLICIT"; generation: number; edits: Record<DateField, number> };

/** Session-owned intent: tab changes and repeated metadata reads are not resets. */
export class BacktestRangeIntent {
  private dataset = "";
  private context = "";
  private generation = 0;
  private edits: Record<DateField, number> = { evaluation_start: 0, evaluation_end_exclusive: 0 };

  enterDataset(dataset: string, context = ""): Ticket | null {
    if (!dataset || dataset === this.dataset) return null;
    this.dataset = dataset;
    this.edits = { evaluation_start: 0, evaluation_end_exclusive: 0 };
    return this.begin(dataset, context, "INITIAL");
  }
  private begin(dataset: string, context: string, mode: Ticket["mode"]): Ticket {
    this.dataset = dataset;
    this.context = context;
    return { dataset, context, mode, generation: ++this.generation, edits: { ...this.edits } };
  }
  observe(dataset: string, context: string): Ticket | null {
    if (dataset !== this.dataset) return this.enterDataset(dataset, context);
    return context === this.context ? null : this.begin(dataset, context, "OBSERVE");
  }
  reset(dataset: string, context = ""): Ticket {
    return this.begin(dataset, context, "EXPLICIT");
  }
  edit(field: DateField) { this.edits[field]++; }
  isCurrent(ticket: Ticket) {
    return ticket.dataset === this.dataset && ticket.context === this.context && ticket.generation === this.generation;
  }
  resolve(ticket: Ticket, dates: CalendarDates, existing?: CalendarDates): Partial<CalendarDates> | null {
    if (!this.isCurrent(ticket)) return null;
    if (ticket.mode === "OBSERVE") return {};
    return Object.fromEntries(
      (Object.keys(dates) as DateField[])
        .filter(field => ticket.edits[field] === this.edits[field])
        .filter(field => ticket.mode !== "INITIAL" || !existing?.[field])
        .map(field => [field, dates[field]]),
    );
  }
}

/** UI request correlation only; this is not a financial/run identity. Dates are
 * excluded because /bounds evaluates available history, not a requested run. */
export function backtestBoundsKey(draft: Record<string, unknown>, caps: any): string {
  const { evaluation_start: _start, evaluation_end_exclusive: _end, ...configuration } = draft;
  return researchDraftKey({ configuration, dataset: {
    dataset_id: caps?.dataset_id, dataset_version: caps?.dataset_version,
    dataset_hash: caps?.dataset_hash, first: caps?.data_first_observation, last: caps?.data_last_observation,
  } });
}
export function researchDraftKey(value: unknown): string {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return JSON.stringify(ordered(value));
}
export interface BacktestBoundsState { context: string; busy: boolean; error: string; bounds: any }
/** Mask old metadata during the render preceding the new request effect too. */
export function currentBacktestBounds(state: BacktestBoundsState, context: string, ready: boolean) {
  return ready && state.context === context ? state : { context, busy: ready, error: "", bounds: null };
}

/** Both success and failure belong to the design submitted to /plan. A late
 * failure must not describe old coverage requirements as current UI feedback. */
export const researchDesignChangedError = () => new Error("The design changed while it was being checked. Review the current configuration and run it again; no run was submitted.");
export async function requestCurrentPlan<T extends CalendarDates>(
  request: T,
  load: (request: T) => Promise<any>,
  isCurrent: () => boolean,
) {
  let plan: any;
  try {
    plan = await load(request);
  } catch (error) {
    if (!isCurrent()) throw researchDesignChangedError();
    throw error;
  }
  if (!isCurrent()) throw researchDesignChangedError();
  if (plan.normalized_request?.evaluation_start !== request.evaluation_start ||
      plan.normalized_request?.evaluation_end_exclusive !== request.evaluation_end_exclusive)
    throw new Error("The planner changed the requested dates. Execution is blocked.");
  return plan;
}

export function nextCalendarDay(date: string) {
  const stamp = Date.parse(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== date)
    throw new Error("Dataset coverage does not contain a valid date.");
  return new Date(stamp + 86400000).toISOString().slice(0, 10);
}

export function executableDates(bounds: any, caps: any): CalendarDates {
  const from = bounds?.earliest_supported_evaluation_start;
  const to = bounds?.latest_supported_evaluation_end_exclusive;
  nextCalendarDay(from);
  nextCalendarDay(to);
  if (bounds.dataset_id !== caps.dataset_id ||
      from < caps.data_first_observation || from >= caps.data_last_observation ||
      to > nextCalendarDay(caps.data_last_observation) || from >= to)
    throw new Error("No complete executable backtest interval is available for this dataset and training/warmup requirements.");
  return { evaluation_start: from, evaluation_end_exclusive: to };
}
