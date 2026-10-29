import { CalendarContractError, boundaryV2 } from "./calendar-v2";
import {
  BlotterError,
  REASONS,
  projectTradingBlotter,
  type TradingBlotter,
} from "./trading-blotter";
import type { DurableResearchStore } from "./durable-research-store";
export type BlotterStore = Pick<
  DurableResearchStore,
  "getRun" | "readAttemptResult"
>;
export async function readTradingBlotter(
  store: BlotterStore,
  runId: string,
  attemptId: string,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(runId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId)
  )
    throw new CalendarContractError(
      "INVALID_BLOTTER_REFERENCE",
      "Invalid run or attempt reference.",
    );
  const record = await store.getRun(runId);
  const attempt = record.attempt_history.find(
    (a) =>
      a.attempt.execution_attempt_id === attemptId &&
      a.attempt.run_id === runId,
  );
  if (!attempt)
    throw new CalendarContractError(
      "ATTEMPT_NOT_FOUND",
      "This attempt does not belong to the selected run.",
      {},
      404,
    );
  if (attempt.status !== "SUCCESS")
    throw new CalendarContractError(
      "BLOTTER_NOT_AVAILABLE",
      "Select a successful immutable attempt. Failed, blocked and incomplete attempts have no completed blotter.",
      {},
      409,
    );
  const result = await store.readAttemptResult({
    runId,
    executionAttemptId: attemptId,
  });
  try {
    return projectTradingBlotter({
      run_id: runId,
      attempt_id: attemptId,
      status: attempt.status,
      spec: record.normalized_spec as Record<string, any>,
      result: result as any,
    });
  } catch (e) {
    if (e instanceof BlotterError)
      throw new CalendarContractError(e.code, e.message, {}, e.status);
    throw e;
  }
}
export const BLOTTER_COLUMNS = {
  executions: [
    "execution_session_date",
    "signal_date",
    "information_cutoff",
    "symbol",
    "side",
    "quantity",
    "execution_price",
    "signed_notional",
    "gross_notional",
    "fees",
    "slippage",
    "reason_code",
    "event_id",
    "exposure_before",
    "exposure_after",
    "weight_before_fill",
    "weight_after_fill",
    "pretrade_nav",
    "posttrade_nav",
    "run_id",
    "attempt_id",
    "fill_id",
    "target_source",
    "price_basis",
    "execution_time",
    "execution_convention",
    "cost_basis",
    "price_verification",
    "code_version",
    "dataset_hash",
  ],
  lots: [
    "symbol",
    "status",
    "entry_date",
    "entry_price",
    "opening_reason",
    "exit_date",
    "exit_price",
    "closing_reason",
    "quantity",
    "holding_sessions",
    "holding_calendar_days",
    "gross_realized_pnl",
    "net_realized_pnl",
    "entry_fees",
    "entry_slippage",
    "exit_fees",
    "exit_slippage",
    "valuation_date",
    "valuation_price",
    "gross_unrealized_pnl",
    "net_unrealized_pnl",
    "net_return_on_invested_cost",
    "basis_status",
    "lot_id",
    "match_id",
    "entry_fill_id",
    "exit_fill_id",
  ],
  positions: [
    "date",
    "symbol",
    "beginning_quantity",
    "ending_quantity",
    "beginning_price",
    "ending_price",
    "beginning_weight",
    "ending_weight",
    "beginning_market_value",
    "ending_market_value",
    "market_price_pnl",
    "source_information_cutoff",
    "quantity_at_information_cutoff",
    "weight_at_information_cutoff",
    "market_value_at_information_cutoff",
    "signed_traded_quantity",
    "observed_state",
    "strategic_target",
    "strategic_target_date",
    "effective_capital_target",
    "effective_hmm_target",
    "effective_target_signal_date",
    "execution_signal_date",
    "signal_date",
    "position_id",
  ],
} as const;
export type BlotterView = keyof typeof BLOTTER_COLUMNS;
export function validateBlotterQuery(q: Record<string, unknown>) {
  const allowed = [
    "view",
    "page",
    "page_size",
    "symbol",
    "side",
    "reason",
    "from",
    "to",
    "sort",
    "direction",
    "format",
    "status",
    "date_field",
    "fill_id",
  ];
  const fail = (): never => {
    throw new CalendarContractError(
      "INVALID_BLOTTER_QUERY",
      "Invalid blotter filter, sort or pagination.",
    );
  };
  if (
    Object.keys(q).some((k) => !allowed.includes(k)) ||
    Object.values(q).some((v) => typeof v !== "string")
  )
    fail();
  const view = (q.view ?? "executions") as BlotterView;
  if (!Object.hasOwn(BLOTTER_COLUMNS, view)) fail();
  const page = String(q.page ?? "1"),
    size = String(q.page_size ?? "50");
  if (
    !/^[1-9]\d{0,6}$/.test(page) ||
    !/^[1-9]\d{0,2}$/.test(size) ||
    +size > 100
  )
    fail();
  if (
    q.date_field !== undefined &&
    (view !== "executions" ||
      !["signal_date", "execution_session_date"].includes(String(q.date_field)))
  )
    fail();
  if (
    q.fill_id !== undefined &&
    (view !== "lots" || !/^fill_[a-f0-9]{32}$/.test(String(q.fill_id)))
  )
    fail();
  const sort = String(q.sort ?? BLOTTER_COLUMNS[view][0]);
  if (!(BLOTTER_COLUMNS[view] as readonly string[]).includes(sort)) fail();
  if (
    q.direction !== undefined &&
    !["asc", "desc"].includes(String(q.direction))
  )
    fail();
  if (q.format !== undefined && !["json", "csv"].includes(String(q.format)))
    fail();
  if (q.side !== undefined && !["BUY", "SELL"].includes(String(q.side))) fail();
  if (q.status !== undefined && !["OPEN", "CLOSED"].includes(String(q.status)))
    fail();
  if (q.symbol !== undefined && !/^[A-Z0-9.^= -]{0,24}$/.test(String(q.symbol)))
    fail();
  if (
    q.reason !== undefined &&
    !(REASONS as readonly string[]).includes(String(q.reason))
  )
    fail();
  if (
    (q.side && view !== "executions") ||
    (q.status && view !== "lots") ||
    (q.reason && view === "positions")
  )
    fail();
  for (const k of ["from", "to"])
    if (q[k] !== undefined) {
      const s = String(q[k]);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        !Number.isFinite(Date.parse(s)) ||
        new Date(s).toISOString().slice(0, 10) !== s
      )
        fail();
    }
  if (q.from && q.to && String(q.from) > String(q.to)) fail();
  return {
    ...q,
    view,
    page: +page,
    page_size: +size,
    sort,
    direction: String(q.direction ?? "asc"),
    format: String(q.format ?? "json"),
  } as Record<string, any> & {
    view: BlotterView;
    page: number;
    page_size: number;
    sort: string;
    direction: string;
    format: string;
  };
}
export function queryTradingBlotter(
  blotter: TradingBlotter,
  q: ReturnType<typeof validateBlotterQuery>,
) {
  const source = blotter[q.view] as unknown as Record<string, any>[];
  const rows = source
    .filter((r) => {
      const date = q.date_field
        ? (r[String(q.date_field)] ?? "")
        : (r.execution_session_date ??
          r.exit_date ??
          r.entry_date ??
          r.date ??
          "");
      return (
        (!q.symbol || r.symbol.includes(q.symbol)) &&
        (!q.fill_id ||
          r.entry_fill_id === q.fill_id ||
          r.exit_fill_id === q.fill_id) &&
        (!q.side || r.side === q.side) &&
        (!q.status || r.status === q.status) &&
        (!q.reason ||
          [r.reason_code, r.opening_reason, r.closing_reason].includes(
            q.reason,
          )) &&
        (!(q.from || q.to) || !!date) &&
        (!q.from || date >= q.from) &&
        (!q.to || date <= q.to)
      );
    })
    .slice()
    .sort((a, b) => {
      const x = a[q.sort],
        y = b[q.sort];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "en")) *
        (q.direction === "desc" ? -1 : 1)
      );
    });
  const metadata = {
    ...boundaryV2,
    version: blotter.version,
    run_id: blotter.run_id,
    attempt_id: blotter.attempt_id,
    scope: blotter.scope,
    blotter_hash: blotter.blotter_hash,
    projection_content_hash: blotter.projection_content_hash,
    ledger_checksum: blotter.ledger_checksum,
    amount_units: blotter.amount_units,
    price_basis: blotter.price_basis,
    execution_time: blotter.execution_time,
    execution_convention: blotter.execution_convention,
    provenance: blotter.provenance,
    warnings: blotter.warnings,
    reconciliation: blotter.reconciliation,
  };
  if (q.format === "csv") {
    if (rows.length > 50000)
      throw new CalendarContractError(
        "BLOTTER_EXPORT_CAPACITY",
        "Narrow filters to export at most 50,000 rows.",
        {},
        413,
      );
    const columns = [
      ...BLOTTER_COLUMNS[q.view],
      "source_run_id",
      "source_attempt_id",
      "source_blotter_hash",
      "amount_units",
      "price_basis",
      "execution_time",
    ];
    const escape = (v: unknown) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const csv =
      [
        columns.map(escape).join(","),
        ...rows.map((r) =>
          columns
            .map((c) =>
              escape(
                (
                  {
                    source_run_id: blotter.run_id,
                    source_attempt_id: blotter.attempt_id,
                    source_blotter_hash: blotter.blotter_hash,
                    amount_units: blotter.amount_units,
                    price_basis: blotter.price_basis,
                    execution_time: blotter.execution_time,
                    ...r,
                  } as Record<string, any>
                )[c],
              ),
            )
            .join(","),
        ),
      ].join("\r\n") + "\r\n";
    if (Buffer.byteLength(csv) > 12 * 1024 * 1024)
      throw new CalendarContractError(
        "BLOTTER_EXPORT_CAPACITY",
        "Narrow filters to export at most 12 MiB.",
        {},
        413,
      );
    return { csv };
  }
  const pageRows = rows.slice((q.page - 1) * q.page_size, q.page * q.page_size);
  const linkedFills =
    q.view === "lots"
      ? blotter.executions.filter((f) =>
          pageRows.some(
            (r) =>
              r.entry_fill_id === f.fill_id || r.exit_fill_id === f.fill_id,
          ),
        )
      : [];
  const eventIds = new Set([
    ...pageRows.map((r) => r.event_id),
    ...linkedFills.map((f) => f.event_id),
  ]);
  return {
    ...metadata,
    view: q.view,
    applied_filters: q,
    total: rows.length,
    page: q.page,
    page_size: q.page_size,
    columns: BLOTTER_COLUMNS[q.view],
    rows: pageRows,
    events: blotter.events.filter((e) => eventIds.has(e.event_id)),
    position_evidence:
      q.view === "executions"
        ? blotter.positions.filter((p) =>
            pageRows.some(
              (r) =>
                r.execution_session_date === p.date && r.symbol === p.symbol,
            ),
          )
        : [],
    // Detail lookup is keyed to returned rows only, never arbitrary filesystem paths.
    linked_lots:
      q.view === "executions"
        ? blotter.lots
            .filter((l) =>
              pageRows.some(
                (r) =>
                  l.entry_fill_id === r.fill_id || l.exit_fill_id === r.fill_id,
              ),
            )
            .slice(0, 100)
        : [],
    linked_fills: linkedFills,
  };
}
