import { useEffect, useState } from "react";
import "./trading-blotter.css";
import type { BlotterView } from "../../../api-server/src/lib/workbench/trading-blotter-api";
export interface BlotterFilters {
  date_field: string;
  fill_id: string;
  symbol: string;
  side: string;
  reason: string;
  from: string;
  to: string;
  status: string;
  sort: string;
  direction: string;
}
export const emptyBlotterFilters: BlotterFilters = {
  date_field: "",
  fill_id: "",
  symbol: "",
  side: "",
  reason: "",
  from: "",
  to: "",
  status: "",
  sort: "",
  direction: "asc",
};
export function blotterPath(
  runId: string,
  attemptId: string,
  view: BlotterView,
  filters: BlotterFilters,
  page = 1,
  csv = false,
) {
  const query = new URLSearchParams({
    view,
    page: String(page),
    page_size: "50",
    ...(csv ? { format: "csv" } : {}),
  });
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  return `/api/workbench/p0/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(attemptId)}/blotter?${query}`;
}
export async function requestBlotter(
  path: string,
  csv = false,
  signal?: AbortSignal,
) {
  if (
    !/^\/api\/workbench\/p0\/runs\/[A-Za-z0-9_-]+\/attempts\/[A-Za-z0-9_-]+\/blotter\?/.test(
      path,
    )
  )
    throw new Error("Invalid same-origin blotter reference.");
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  const response = await fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(
      body.error?.message ?? "The recorded blotter could not be loaded.",
    );
  }
  return csv ? response.blob() : response.json();
}
const names: Record<string, string> = {
  execution_session_date: "Execution session",
  signal_date: "Signal date",
  symbol: "Symbol",
  side: "Side",
  quantity: "Quantity",
  execution_price: "Adjusted-close price",
  signed_notional: "Signed notional",
  fees: "Fees",
  slippage: "Slippage",
  reason_code: "Recorded reason",
  entry_date: "Entry session",
  entry_price: "Entry price",
  opening_reason: "Opening reason",
  exit_date: "Exit session",
  exit_price: "Exit price",
  closing_reason: "Closing reason",
  net_realized_pnl: "Realized net P&L",
  net_unrealized_pnl: "Unrealized net P&L",
  status: "Lot status",
  date: "Session",
  beginning_quantity: "Quantity before",
  ending_quantity: "Quantity after",
  beginning_price: "Prior close",
  ending_price: "Current close",
  beginning_weight: "Prior NAV weight",
  ending_weight: "Realized NAV weight",
  market_price_pnl: "Daily price P&L",
  observed_state: "Observed state",
  strategic_target: "Strategic target",
  effective_capital_target: "Effective capital target",
  net_return_on_invested_cost: "Net / invested cost",
};
const primary: Record<BlotterView, string[]> = {
  executions: [
    "execution_session_date",
    "signal_date",
    "symbol",
    "side",
    "quantity",
    "execution_price",
    "signed_notional",
    "fees",
    "slippage",
    "reason_code",
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
    "net_realized_pnl",
    "net_unrealized_pnl",
    "net_return_on_invested_cost",
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
    "strategic_target",
    "effective_capital_target",
    "market_price_pnl",
    "observed_state",
  ],
};
const percentFields = new Set([
  "beginning_weight",
  "ending_weight",
  "strategic_target",
  "effective_capital_target",
  "net_return_on_invested_cost",
]);
export function blotterValue(value: any, field: string) {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "number")
    return percentFields.has(field)
      ? `${(value * 100).toFixed(4)}%`
      : value.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return String(value).replaceAll("_", " ");
}
export function BlotterTable({
  rows,
  view,
  onInspect,
}: {
  rows: Record<string, any>[];
  view: BlotterView;
  onInspect: (row: any) => void;
}) {
  return (
    <div
      className="blotter-scroll"
      tabIndex={0}
      aria-label="Scrollable recorded trading evidence"
    >
      <table>
        <caption>
          {view === "executions"
            ? "Execution Blotter"
            : view === "lots"
              ? "Round-Trip Trade Blotter"
              : "Daily Position Drill-down"}
        </caption>
        <thead>
          <tr>
            {primary[view].map((k) => (
              <th key={k} scope="col">
                {names[k] ?? k}
              </th>
            ))}
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fill_id ?? row.match_id ?? row.position_id}>
              {primary[view].map((k) => (
                <td key={k}>{blotterValue(row[k], k)}</td>
              ))}
              <td>
                <button
                  onClick={() => onInspect(row)}
                  aria-label={`Inspect ${row.symbol} ${row.execution_session_date ?? row.entry_date ?? row.date}`}
                >
                  Inspect
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="blotter-empty">
          No records match these filters. Days without a fill do not appear as
          executions.
        </p>
      )}
    </div>
  );
}
export function TradingBlotterPanel({ record }: { record: any }) {
  const [attempt, setAttempt] = useState(""),
    [view, setView] = useState<BlotterView>("executions"),
    [filters, setFilters] = useState({ ...emptyBlotterFilters }),
    [page, setPage] = useState(1),
    [loaded, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [exporting, setExporting] = useState(false);
  const latest = record?.latest_attempt?.attempt?.execution_attempt_id ?? "";
  useEffect(() => {
    setAttempt(record?.latest_status === "SUCCESS" ? latest : "");
    setData(null);
    setSelected(null);
    setPage(1);
  }, [record?.run_id, latest, record?.latest_status]);
  const path =
    record?.run_id && attempt
      ? blotterPath(record.run_id, attempt, view, filters, page)
      : "";
  const data = loaded?.path === path ? loaded.value : null;
  useEffect(() => {
    setData(null);
    setError("");
    setSelected(null);
    if (!path) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setBusy(true);
    requestBlotter(path, false, controller.signal)
      .then((value) => {
        if (active) setData({ path, value });
      })
      .catch((e) => {
        if (active && e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path]);
  const edit = (field: keyof BlotterFilters, value: string) => {
    setFilters((f) => ({ ...f, [field]: value }));
    setPage(1);
  };
  const changeView = (v: BlotterView) => {
    setView(v);
    setFilters({ ...emptyBlotterFilters });
    setPage(1);
  };
  async function download() {
    if (!attempt) return;
    setExporting(true);
    setError("");
    try {
      const blob = (await requestBlotter(
        blotterPath(record.run_id, attempt, view, filters, 1, true),
        true,
      )) as Blob;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `allocationlab-${view}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const history = record?.attempt_history ?? [];
  return (
    <section
      className="trading-blotter"
      aria-label="Institutional trading blotter"
    >
      <header>
        <h2>Trading Blotter</h2>
        <p>
          Recorded simulated executions, FIFO lots and daily positions ·{" "}
          {record?.spec?.research_scope === "CAPITAL_EXPOSURE"
            ? "SPY/cash study"
            : "Portfolio"}
        </p>
        <p className="blotter-note">
          Research only. Prices are simulated adjusted closes. Intraday
          execution time is not available. Amounts and P&L are NAV/index units
          on initial value 100, not dollars.
        </p>
      </header>
      {!record ? (
        <p>
          Open a completed run from History to inspect its immutable execution
          evidence.
        </p>
      ) : (
        <>
          <label className="blotter-attempt">
            Immutable execution attempt
            <select
              aria-label="Execution attempt"
              value={attempt}
              onChange={(e) => {
                setAttempt(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Select a successful attempt</option>
              {history.map((a: any) => (
                <option
                  key={a.attempt.execution_attempt_id}
                  value={a.attempt.execution_attempt_id}
                  disabled={a.status !== "SUCCESS"}
                >
                  {a.status} ·{" "}
                  {a.completed_at ??
                    a.attempt.requested_at ??
                    "Date not recorded"}{" "}
                  · {a.attempt.execution_attempt_id}
                </option>
              ))}
            </select>
          </label>
          {record.latest_status !== "SUCCESS" && (
            <p role="status">
              Latest attempt: {record.latest_status}. No completed trades are
              implied. You may explicitly inspect an earlier successful attempt.
            </p>
          )}
          <nav className="blotter-tabs" aria-label="Blotter views">
            {(["executions", "lots", "positions"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => changeView(v)}
              >
                {v === "executions"
                  ? "Execution Blotter"
                  : v === "lots"
                    ? "Round-Trip Trade Blotter"
                    : "Position Drill-down"}
              </button>
            ))}
          </nav>
          <details>
            <summary>Filter and sort records</summary>
            <div className="blotter-filters">
              {view === "executions" && (
                <label>
                  Date basis
                  <select
                    aria-label="Date basis"
                    value={filters.date_field}
                    onChange={(e) => edit("date_field", e.target.value)}
                  >
                    <option value="">Execution sessions</option>
                    <option value="signal_date">Signal dates</option>
                  </select>
                </label>
              )}
              <label>
                Symbol search
                <input
                  aria-label="Symbol search"
                  value={filters.symbol}
                  maxLength={24}
                  onChange={(e) => edit("symbol", e.target.value.toUpperCase())}
                />
              </label>
              <label>
                From session
                <input
                  type="date"
                  aria-label="From session"
                  value={filters.from}
                  onChange={(e) => edit("from", e.target.value)}
                />
              </label>
              <label>
                Through session
                <input
                  type="date"
                  aria-label="Through session"
                  value={filters.to}
                  onChange={(e) => edit("to", e.target.value)}
                />
              </label>
              {view === "executions" && (
                <label>
                  Side
                  <select
                    aria-label="Side"
                    value={filters.side}
                    onChange={(e) => edit("side", e.target.value)}
                  >
                    <option value="">Both</option>
                    <option>BUY</option>
                    <option>SELL</option>
                  </select>
                </label>
              )}
              {view === "lots" && (
                <label>
                  Lot status
                  <select
                    aria-label="Lot status"
                    value={filters.status}
                    onChange={(e) => edit("status", e.target.value)}
                  >
                    <option value="">Open and closed</option>
                    <option>OPEN</option>
                    <option>CLOSED</option>
                  </select>
                </label>
              )}
              {view !== "positions" && (
                <label>
                  Recorded reason
                  <select
                    aria-label="Recorded reason"
                    value={filters.reason}
                    onChange={(e) => edit("reason", e.target.value)}
                  >
                    <option value="">All reasons</option>
                    {[
                      "INITIAL_ALLOCATION",
                      "SCHEDULED_REBALANCE",
                      "HMM_EXPOSURE_REDUCTION",
                      "HMM_EXPOSURE_INCREASE",
                      "HMM_EXIT_TO_CASH",
                      "HMM_REENTRY",
                      "JOINT_REBALANCE_AND_EXPOSURE",
                      "CAPITAL_RULE_EXPOSURE_REDUCTION",
                      "CAPITAL_RULE_EXPOSURE_INCREASE",
                      "CAPITAL_RULE_EXIT_TO_CASH",
                      "CAPITAL_RULE_REENTRY",
                      "UNCLASSIFIED",
                    ].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Sort by
                <select
                  aria-label="Sort by"
                  value={filters.sort}
                  onChange={(e) => edit("sort", e.target.value)}
                >
                  <option value="">Session / default</option>
                  {primary[view].map((k) => (
                    <option key={k} value={k}>
                      {names[k] ?? k}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Direction
                <select
                  aria-label="Direction"
                  value={filters.direction}
                  onChange={(e) => edit("direction", e.target.value)}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>
          </details>
          <div className="blotter-toolbar">
            <button
              disabled={!data || busy || exporting}
              onClick={() => void download()}
            >
              {exporting ? "Exporting…" : "Download filtered CSV"}
            </button>
            <button
              onClick={() => {
                setFilters({ ...emptyBlotterFilters });
                setPage(1);
              }}
            >
              Clear filters
            </button>
            <span>
              {filters.fill_id && (
                <span>
                  Showing lots linked to the selected execution. Clear filters
                  to restore all lots.
                </span>
              )}
              FIFO is a reporting convention. Cash income is separate from trade
              P&L.
            </span>
          </div>
          {busy && <p role="status">Reading immutable ledger evidence…</p>}
          {error && <p role="alert">{error}</p>}
          {data && (
            <>
              <p className="blotter-note">
                {data.total} records · {data.scope} ·{" "}
                {view === "lots"
                  ? "Dates filter exit session for closed lots and entry session for open lots."
                  : "Dates filter the selected session basis, or the observed position session."}
              </p>
              <BlotterTable
                rows={data.rows}
                view={view}
                onInspect={setSelected}
              />
              <div className="blotter-pages">
                <button
                  disabled={page === 1 || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page} · {data.page_size} rows per page
                </span>
                <button
                  disabled={page * data.page_size >= data.total || busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
              {selected && (
                <section
                  className="blotter-detail"
                  aria-label="Selected evidence"
                >
                  <h3>
                    {selected.symbol} ·{" "}
                    {view === "lots"
                      ? "FIFO lot evidence"
                      : view === "positions"
                        ? "Position evidence"
                        : "Execution evidence"}
                  </h3>
                  <button onClick={() => setSelected(null)}>
                    Close detail
                  </button>
                  {view === "executions" && (
                    <button
                      onClick={() => {
                        changeView("lots");
                        setFilters({
                          ...emptyBlotterFilters,
                          fill_id: selected.fill_id,
                        });
                      }}
                    >
                      Inspect related FIFO lots
                    </button>
                  )}
                  {view === "positions" && (
                    <button
                      onClick={() => {
                        changeView("executions");
                        setFilters({
                          ...emptyBlotterFilters,
                          symbol: selected.symbol,
                          from: selected.date,
                          to: selected.date,
                        });
                      }}
                    >
                      Inspect recorded fills for this session
                    </button>
                  )}
                  <dl>
                    {Object.entries(selected)
                      .filter(
                        ([k]) =>
                          ![
                            "realized_position",
                            "fill_ids",
                            "fill_id",
                            "event_id",
                            "run_id",
                            "attempt_id",
                            "code_version",
                            "dataset_hash",
                            "lot_id",
                            "match_id",
                            "entry_fill_id",
                            "exit_fill_id",
                            "position_id",
                            "ledger_day_index",
                            "ledger_trade_index",
                          ].includes(k),
                      )
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{names[k] ?? k.replaceAll("_", " ")}</dt>
                          <dd>{blotterValue(v, k)}</dd>
                        </div>
                      ))}
                  </dl>
                  <BlotterDecisionDetail selected={selected} data={data} />
                  <details>
                    <summary>
                      Original decision, capital state and source audit
                    </summary>
                    <pre>
                      {JSON.stringify(
                        {
                          record: selected,
                          event: data.events?.find(
                            (e: any) => e.event_id === selected.event_id,
                          ),
                          linked_fills: data.linked_fills?.filter(
                            (f: any) =>
                              f.fill_id === selected.entry_fill_id ||
                              f.fill_id === selected.exit_fill_id,
                          ),
                          linked_lots: data.linked_lots?.filter(
                            (l: any) =>
                              l.entry_fill_id === selected.fill_id ||
                              l.exit_fill_id === selected.fill_id,
                          ),
                          source_events: data.events?.filter(
                            (e: any) =>
                              e.event_id === selected.event_id ||
                              data.linked_fills?.some(
                                (f: any) =>
                                  (f.fill_id === selected.entry_fill_id ||
                                    f.fill_id === selected.exit_fill_id) &&
                                  f.event_id === e.event_id,
                              ),
                          ),
                          provenance: data.provenance,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </section>
              )}
              <details className="blotter-audit">
                <summary>
                  Reconciliation, methodology and immutable source
                </summary>
                <p>
                  Daily price P&L, cash income and net portfolio P&L remain
                  authoritative in the source ledger. Realized plus unrealized
                  FIFO net P&L reconciles to equity price P&L less all
                  fees/slippage when original cost basis is known. Open-lot net
                  unrealized P&L deducts entry charges only, with no assumed
                  liquidation cost. Open lots have no fabricated exit. Joint
                  events do not assign P&L to a single cause.
                </p>
                <pre>
                  {JSON.stringify(
                    {
                      version: data.version,
                      run_id: data.run_id,
                      attempt_id: data.attempt_id,
                      ledger_checksum: data.ledger_checksum,
                      blotter_hash: data.blotter_hash,
                      provenance: data.provenance,
                      reconciliation: data.reconciliation,
                      warnings: data.warnings,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {data.warnings?.length > 0 && (
                <p className="blotter-note">
                  Limitations:{" "}
                  {data.warnings
                    .map(
                      (w: string) =>
                        ({
                          UNCLASSIFIED_HISTORICAL_EVENT:
                            "Some saved fills lack a unique recorded decision reason",
                          UNKNOWN_INITIAL_COST_BASIS:
                            "Original entry cost basis is unavailable for carried-in holdings",
                          SOURCE_CODE_VERSION_NOT_RECORDED:
                            "The source did not record its code version",
                        })[w] ?? w,
                    )
                    .join(" · ")}
                  . Unrecorded reasons and initial entry cost bases are not
                  reconstructed.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function BlotterDecisionDetail({
  selected,
  data,
}: {
  selected: any;
  data: any;
}) {
  const event = data.events?.find((e: any) => e.event_id === selected.event_id),
    position = data.position_evidence?.find(
      (p: any) =>
        p.date === selected.execution_session_date &&
        p.symbol === selected.symbol,
    ),
    entry = data.linked_fills?.find(
      (f: any) => f.fill_id === selected.entry_fill_id,
    ),
    exit = data.linked_fills?.find(
      (f: any) => f.fill_id === selected.exit_fill_id,
    );
  const openingEvent = data.events?.find(
      (e: any) => e.event_id === entry?.event_id,
    ),
    closingEvent = data.events?.find((e: any) => e.event_id === exit?.event_id);
  if (!event && !entry && !exit) return null;
  const rows: [string, any][] = event
    ? [
        ["Signal session", event.signal_date],
        ["Information cutoff", event.information_cutoff],
        [
          "Recorded regime",
          event.capital_signal?.regime?.label ??
            event.capital_signal?.regime?.model,
        ],
        [
          "High-risk probability",
          event.capital_signal?.regime?.high_risk_probability,
        ],
        ["Defensive score", event.capital_signal?.regime?.defensive_score],
        ["Policy multiplier (recorded)", event.recorded_multiplier],
        ["Strategic NAV target", position?.strategic_target],
        ["Effective capital NAV target", position?.effective_capital_target],
        ["Realized NAV weight after fill", selected.weight_after_fill],
        [
          "Quantity at information cutoff",
          position?.quantity_at_information_cutoff,
        ],
        ["Cutoff NAV weight", position?.weight_at_information_cutoff],
        ["Recorded event causes", event.causes?.join(" + ") || "Not available"],
        ["Reason evidence", event.evidence_status],
      ]
    : [
        ["Opening signal session", entry?.signal_date],
        ["Opening information cutoff", entry?.information_cutoff],
        ["Opening event", entry?.reason_code],
        [
          "Opening high-risk probability (recorded)",
          openingEvent?.capital_signal?.regime?.high_risk_probability,
        ],
        [
          "Opening policy multiplier (recorded)",
          openingEvent?.recorded_multiplier,
        ],
        ["Closing signal session", exit?.signal_date],
        ["Closing information cutoff", exit?.information_cutoff],
        ["Closing event", exit?.reason_code],
        [
          "Closing high-risk probability (recorded)",
          closingEvent?.capital_signal?.regime?.high_risk_probability,
        ],
        [
          "Closing policy multiplier (recorded)",
          closingEvent?.recorded_multiplier,
        ],
      ];
  return (
    <section aria-label="Readable decision evidence">
      <h4>Recorded decision evidence</h4>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value === null || value === undefined
                ? "Not recorded"
                : typeof value === "number"
                  ? value.toLocaleString("en-US", { maximumFractionDigits: 10 })
                  : String(value).replaceAll("_", " ")}
            </dd>
          </div>
        ))}
      </dl>
      {event?.reason_code === "JOINT_REBALANCE_AND_EXPOSURE" && (
        <p>
          Portfolio construction and the capital policy jointly affected this
          event. Individual fill P&L is not assigned to a single cause.
        </p>
      )}
    </section>
  );
}
