export type CalendarDates = {
  evaluation_start: string;
  evaluation_end_exclusive: string;
};
export type DateField = keyof CalendarDates;
type Ticket = { dataset: string; generation: number; edits: Record<DateField, number> };

/** Session-owned intent: tab changes and repeated metadata reads are not resets. */
export class BacktestRangeIntent {
  private dataset = "";
  private generation = 0;
  private edits: Record<DateField, number> = { evaluation_start: 0, evaluation_end_exclusive: 0 };

  enterDataset(dataset: string): Ticket | null {
    if (!dataset || dataset === this.dataset) return null;
    this.dataset = dataset;
    this.edits = { evaluation_start: 0, evaluation_end_exclusive: 0 };
    return this.reset(dataset);
  }
  reset(dataset: string): Ticket {
    this.dataset = dataset;
    return { dataset, generation: ++this.generation, edits: { ...this.edits } };
  }
  edit(field: DateField) { this.edits[field]++; }
  isCurrent(ticket: Ticket) {
    return ticket.dataset === this.dataset && ticket.generation === this.generation;
  }
  resolve(ticket: Ticket, dates: CalendarDates): Partial<CalendarDates> | null {
    if (!this.isCurrent(ticket)) return null;
    return Object.fromEntries(
      (Object.keys(dates) as DateField[])
        .filter(field => ticket.edits[field] === this.edits[field])
        .map(field => [field, dates[field]]),
    );
  }
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
