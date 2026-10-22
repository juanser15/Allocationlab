import { useEffect, useMemo, useState } from "react";
import { Card, researchApi } from "./coordinated-ui";

type DataStatus = {
  active_dataset: any;
  required_research_symbols: string[];
};
type YahooDataset = {
  dataset_id: string;
  source: string;
  fetched_at: string;
  requested_start: string;
  requested_end: string;
  price_field: string;
  tickers: string[];
  successful_tickers: string[];
  failed_tickers: Array<{ ticker: string; error: string }>;
  observations: number;
  first_observation: string | null;
  last_observation: string | null;
  complete_observations: number;
  missing_required_symbols: string[];
  activation_eligible: boolean;
  coverage: Array<{
    ticker: string;
    observations: number;
    first_observation: string | null;
    last_observation: string | null;
    missing_on_union_calendar: number;
  }>;
  sha256: string;
  note: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const defaultStart = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 7);
  return d.toISOString().slice(0, 10);
};
const tokenHeader = () => {
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function DataUniverse() {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [source, setSource] = useState<"INTERNAL" | "YAHOO">("YAHOO");
  const [tickers, setTickers] = useState("SPY, QQQ, TLT, GLD");
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState(today);
  const [dataset, setDataset] = useState<YahooDataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = async () => {
    try {
      const value = (await researchApi("/data")) as DataStatus;
      setStatus(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void loadStatus();
  }, []);

  const parsedTickers = useMemo(
    () =>
      [...new Set(
        tickers
          .split(/[\s,;]+/)
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      )],
    [tickers],
  );

  async function fetchYahoo() {
    setBusy(true);
    setError("");
    setDataset(null);
    try {
      const response = await researchApi("/data/yahoo", {
        tickers: parsedTickers,
        start: from,
        end: to,
      });
      setDataset(response.dataset as YahooDataset);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function activate(datasetId: string) {
    setBusy(true);
    setError("");
    try {
      await researchApi("/data/active", { dataset_id: datasetId });
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    if (!dataset) return;
    setError("");
    try {
      const response = await fetch(
        "/api/workbench/coordinated/data/" +
          encodeURIComponent(dataset.dataset_id) +
          ".csv",
        { headers: tokenHeader() },
      );
      if (!response.ok) throw new Error("CSV download failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `allocationlab-${dataset.dataset_id}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const active = status?.active_dataset;

  return (
    <div className="cp-section-body">
      {error && (
        <div className="cp-error" role="alert">
          {error}
        </div>
      )}

      <Card title="Research data source">
        <div className="cp-fields">
          <label>
            Source
            <select
              aria-label="Research data source"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "INTERNAL" | "YAHOO")
              }
            >
              <option value="INTERNAL">Internal research snapshot</option>
              <option value="YAHOO">Yahoo Finance · adjusted close</option>
            </select>
          </label>
        </div>

        <div className="cp-result-context">
          Active dataset ·{" "}
          <strong>
            {active?.source === "YAHOO_FINANCE_RESEARCH"
              ? "Yahoo Finance"
              : "Internal snapshot"}
          </strong>
          {active?.dataset_id && active.dataset_id !== "internal" && (
            <small>{active.dataset_id}</small>
          )}
        </div>

        {source === "INTERNAL" ? (
          <>
            <p className="cp-note">
              Use the committed Allocation Lab research snapshot. Switching the
              active dataset changes future run identity; existing results are
              not rewritten.
            </p>
            <div className="cp-actions">
              <button
                className="cp-primary"
                disabled={busy || active?.dataset_id === "internal"}
                onClick={() => void activate("internal")}
              >
                {active?.dataset_id === "internal"
                  ? "Internal snapshot active"
                  : "Use internal snapshot"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="cp-fields">
              <label>
                Tickers
                <input
                  value={tickers}
                  onChange={(e) => setTickers(e.target.value)}
                  placeholder="SPY, QQQ, TLT, GLD"
                />
              </label>
              <label>
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={to}
                  max={today()}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <div className="cp-actions">
              <button
                onClick={() =>
                  setTickers(
                    (status?.required_research_symbols ?? []).join(", "),
                  )
                }
                disabled={!status?.required_research_symbols?.length}
              >
                Load model-required universe
              </button>
              <button
                className="cp-primary"
                disabled={busy || !parsedTickers.length || !from || !to}
                onClick={() => void fetchYahoo()}
              >
                {busy ? "Fetching Yahoo…" : "Fetch Yahoo data"}
              </button>
            </div>
            <p className="cp-note">
              Yahoo Finance is a research source, not an independently
              point-in-time-certified vendor feed. Fetching data does not
              silently change the active backtest dataset.
            </p>
          </>
        )}
      </Card>

      {dataset && (
        <>
          <Card title="Fetched dataset">
            <div className="cp-metrics">
              <div>
                <small>Rows</small>
                <strong>{dataset.observations}</strong>
              </div>
              <div>
                <small>Coverage</small>
                <strong>
                  {dataset.first_observation ?? "—"} →{" "}
                  {dataset.last_observation ?? "—"}
                </strong>
              </div>
              <div>
                <small>Tickers</small>
                <strong>
                  {dataset.successful_tickers.length} / {dataset.tickers.length}
                </strong>
              </div>
              <div>
                <small>Complete model rows</small>
                <strong>{dataset.complete_observations}</strong>
              </div>
            </div>

            <p className="cp-note">{dataset.note}</p>

            {dataset.failed_tickers.length > 0 && (
              <div className="cp-error">
                {dataset.failed_tickers.map((row) => (
                  <div key={row.ticker}>
                    {row.ticker}: {row.error}
                  </div>
                ))}
              </div>
            )}

            <div className="cp-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Observations</th>
                    <th>First</th>
                    <th>Last</th>
                    <th>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.coverage.map((row) => (
                    <tr key={row.ticker}>
                      <td>{row.ticker}</td>
                      <td>{row.observations}</td>
                      <td>{row.first_observation ?? "—"}</td>
                      <td>{row.last_observation ?? "—"}</td>
                      <td>{row.missing_on_union_calendar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dataset.missing_required_symbols.length > 0 && (
              <p className="cp-note">
                Not activatable for the current models yet. Missing required
                research symbols: {dataset.missing_required_symbols.join(", ")}.
              </p>
            )}

            <div className="cp-actions">
              <button onClick={() => void downloadCsv()}>
                Download CSV
              </button>
              <button
                className="cp-primary"
                disabled={busy || !dataset.activation_eligible}
                onClick={() => void activate(dataset.dataset_id)}
              >
                {active?.dataset_id === dataset.dataset_id
                  ? "Active research dataset"
                  : "Use in research workspace"}
              </button>
            </div>

            <details>
              <summary>Dataset identity</summary>
              <pre>
                {JSON.stringify(
                  {
                    dataset_id: dataset.dataset_id,
                    source: dataset.source,
                    fetched_at: dataset.fetched_at,
                    price_field: dataset.price_field,
                    sha256: dataset.sha256,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}
