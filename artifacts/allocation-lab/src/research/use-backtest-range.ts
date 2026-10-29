import { useEffect, useRef, useState } from "react";
import type { ResearchSubmission } from "../../../api-server/src/lib/workbench/coordinated-contract";
import { researchApi } from "./coordinated-ui";
import { BacktestRangeIntent, backtestBoundsKey, currentBacktestBounds, executableDates, nextCalendarDay, type BacktestBoundsState, type CalendarDates, type DateField } from "./backtest-range";

/** Lives in the parent workbench, not in a tab that can be unmounted. */
export function useBacktestRange(
  draft: ResearchSubmission,
  caps: any,
  apply: (dates: Partial<CalendarDates>) => void,
) {
  const intent = useRef(new BacktestRangeIntent());
  const context = backtestBoundsKey(draft as unknown as Record<string, unknown>, caps);
  const ready = !!draft.dataset_id && caps?.dataset_id === draft.dataset_id;
  const current = useRef({ draft, caps, apply, context });
  current.current = { draft, caps, apply, context };
  const mounted = useRef(true);
  const [state, setState] = useState<BacktestBoundsState>({ context: "", busy: false, error: "", bounds: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function request(ticket: NonNullable<ReturnType<BacktestRangeIntent["enterDataset"]>>) {
    const snapshot = current.current;
    setState({ context: ticket.context, busy: true, error: "", bounds: null });
    try {
      // Dates only seed validation of the existing bounds endpoint; they are not
      // committed to the draft or submitted as a run.
      const bounds = await researchApi("/bounds", {
        ...snapshot.draft,
        evaluation_start: snapshot.caps.data_first_observation,
        evaluation_end_exclusive: nextCalendarDay(snapshot.caps.data_last_observation),
      });
      if (!mounted.current || !intent.current.isCurrent(ticket) || current.current.context !== ticket.context || current.current.draft.dataset_id !== ticket.dataset) return;
      const dates = executableDates(bounds, snapshot.caps);
      const patch = intent.current.resolve(ticket, dates, current.current.draft);
      if (patch && Object.keys(patch).length) current.current.apply(patch);
      setState({ context: ticket.context, busy: false, error: "", bounds });
    } catch (error) {
      if (mounted.current && intent.current.isCurrent(ticket) && current.current.context === ticket.context && current.current.draft.dataset_id === ticket.dataset)
        setState({ context: ticket.context, busy: false, error: (error as Error).message, bounds: null });
    }
  }
  useEffect(() => {
    if (!draft.dataset_id || caps?.dataset_id !== draft.dataset_id) return;
    const ticket = intent.current.observe(draft.dataset_id, context);
    if (ticket) void request(ticket);
    // Refresh metadata on design changes, without applying new dates.
  }, [draft.dataset_id, caps?.dataset_id, context]);

  return {
    ...currentBacktestBounds(state, context, ready),
    edit: (field: DateField) => intent.current.edit(field),
    reset: () => {
      const now = current.current;
      if (!now.draft.dataset_id || now.caps?.dataset_id !== now.draft.dataset_id) return;
      void request(intent.current.reset(now.draft.dataset_id, now.context));
    },
  };
}
