import { useEffect, useRef, useState } from "react";
import type { ResearchSubmission } from "../../../api-server/src/lib/workbench/coordinated-contract";
import { researchApi } from "./coordinated-ui";
import { BacktestRangeIntent, executableDates, nextCalendarDay, type CalendarDates, type DateField } from "./backtest-range";

/** Lives in the parent workbench, not in a tab that can be unmounted. */
export function useBacktestRange(
  draft: ResearchSubmission,
  caps: any,
  apply: (dates: Partial<CalendarDates>) => void,
) {
  const intent = useRef(new BacktestRangeIntent());
  const current = useRef({ draft, caps, apply });
  current.current = { draft, caps, apply };
  const mounted = useRef(true);
  const [state, setState] = useState<{ busy: boolean; error: string; bounds: any }>({ busy: false, error: "", bounds: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function request(ticket: NonNullable<ReturnType<BacktestRangeIntent["enterDataset"]>>) {
    const snapshot = current.current;
    setState({ busy: true, error: "", bounds: null });
    try {
      // Dates only seed validation of the existing bounds endpoint; they are not
      // committed to the draft or submitted as a run.
      const bounds = await researchApi("/bounds", {
        ...snapshot.draft,
        evaluation_start: snapshot.caps.data_first_observation,
        evaluation_end_exclusive: nextCalendarDay(snapshot.caps.data_last_observation),
      });
      if (!mounted.current || !intent.current.isCurrent(ticket) || current.current.draft.dataset_id !== ticket.dataset) return;
      const dates = executableDates(bounds, snapshot.caps);
      const patch = intent.current.resolve(ticket, dates);
      if (patch && Object.keys(patch).length) current.current.apply(patch);
      setState({ busy: false, error: "", bounds });
    } catch (error) {
      if (mounted.current && intent.current.isCurrent(ticket) && current.current.draft.dataset_id === ticket.dataset)
        setState({ busy: false, error: (error as Error).message, bounds: null });
    }
  }
  useEffect(() => {
    if (!draft.dataset_id || caps?.dataset_id !== draft.dataset_id) return;
    const ticket = intent.current.enterDataset(draft.dataset_id);
    if (ticket) void request(ticket);
    // Configuration edits deliberately do not move an existing calendar.
    // The explicit full-range action below uses the latest configuration.
  }, [draft.dataset_id, caps?.dataset_id]);

  return {
    ...state,
    edit: (field: DateField) => intent.current.edit(field),
    reset: () => {
      const now = current.current;
      if (!now.draft.dataset_id || now.caps?.dataset_id !== now.draft.dataset_id) return;
      void request(intent.current.reset(now.draft.dataset_id));
    },
  };
}
