import { useEffect, useMemo, useState } from "react";
import { Card, researchApi } from "./coordinated-ui";
import {
  fetchDatasetCsv,
  forgetYahooSnapshot,
  rememberYahooSnapshot,
} from "./dataset-persistence";

const today = () => new Date().toISOString().slice(0, 10);
const defaultStart = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return d.toISOString().slice(0, 10);
};

export function DataUniverse({
  onDatasetChange,
}: {
  onDatasetChange?: () => void;
}) {
  const [status, setStatus] = useState<any>(null);
  const [dataset, setDataset] = useState<any>(null);
  const [source, setSource] = useState<"YAHOO" | "INTERNAL">("YAHOO");
  const [tickers, setTickers] = useState("SPY, QQQ, TLT, GLD");
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const parsed = useMemo(
    () =>
      [...new Set(
        tickers
          .split(/[\s,;]+/)
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      )],
    [tickers],
  );

  const load = async () => {
    const value = await researchApi("/data");
    setStatus(value);
    const active = value.active_dataset;
    if (active?.source === "YAHOO_FINANCE_RESEARCH") {
      setSource("YAHOO");
      setDataset(active);
      if (active.tickers) setTickers(active.tickers.join(", "));
      if (active.requested_start) setFrom(active.requested_start);
      if (active.requested_end) setTo(active.requested_end);
    }
  };

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function fetchYahoo() {
    setBusy(true);
    setError("");
    setWarning("");
    try {
      const response = await researchApi("/data/yahoo", {
        tickers: parsed,
        start: from,
        end: to,
      });
      const ds = response.dataset;
      setDataset(ds);
      if (ds.activation_eligible) {
        await researchApi("/data/active", { dataset_id: ds.dataset_id });
        try {
          await rememberYahooSnapshot(ds);
        } catch {
          setWarning(
            "Yahoo data is active, but this browser could not save the exact snapshot for restart recovery. Download the CSV as a backup.",
          );
        }
        onDatasetChange?.();
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function useInternal() {
    setBusy(true);
    setError("");
    try {
      await researchApi("/data/active", { dataset_id: "internal" });
      forgetYahooSnapshot();
      setDataset(null);
      setSource("INTERNAL");
      await load();
      onDatasetChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!dataset?.dataset_id) return;
    try {
      const csv = await fetchDatasetCsv(dataset.dataset_id);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `allocationlab-${dataset.dataset_id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = status?.active_dataset;
  const activeYahoo = active?.source === "YAHOO_FINANCE_RESEARCH";

  return (
    <div className="cp-section-body">
      {error && <div className="cp-error">{error}</div>}
      {warning && <div className="cp-error">{warning}</div>}

      <Card title="Active dataset">
        <div className="cp-metrics">
          <div>
            <small>Source</small>
            <strong>{activeYahoo ? "Yahoo Finance" : "Internal snapshot"}</strong>
          </div>
          <div>
            <small>Coverage</small>
            <strong>
              {active?.first_observation ?? active?.data_first_observation ?? "—"}
              {" → "}
              {active?.last_observation ?? active?.data_last_observation ?? "—"}
            </strong>
          </div>
          <div>
            <small>Dataset</small>
            <strong>
              {active?.dataset_id && active.dataset_id !== "internal"
                ? active.dataset_id.slice(0, 16) + "…"
                : "internal"}
            </strong>
          </div>
        </div>
        <p className="cp-note">
          The active dataset is shared by every research section. Changing tabs
          does not change it.
        </p>
      </Card>

      <Card title="Get market data">
        <div className="cp-fields">
          <label>
            Source
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as any)}
            >
              <option value="YAHOO">Yahoo Finance · adjusted close</option>
              <option value="INTERNAL">Internal research snapshot</option>
            </select>
          </label>
        </div>

        {source === "YAHOO" ? (
          <>
            <div className="cp-fields">
              <label>
                Tickers
                <input value={tickers} onChange={(e) => setTickers(e.target.value)} />
              </label>
              <label>
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" max={today()} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <div className="cp-actions">
              <button
                onClick={() =>
                  setTickers((status?.required_research_symbols ?? []).join(", "))
                }
              >
                Load model universe
              </button>
              <button
                className="cp-primary"
                disabled={busy || !parsed.length}
                onClick={() => void fetchYahoo()}
              >
                {busy ? "Fetching…" : "Fetch & activate"}
              </button>
            </div>
            <p className="cp-note">
              A valid Yahoo snapshot becomes active immediately and is saved in
              this browser for exact recovery after a Render restart. Yahoo data
              remains research-grade and not independently PIT-certified.
            </p>
          </>
        ) : (
          <div className="cp-actions">
            <button
              className="cp-primary"
              disabled={busy || active?.dataset_id === "internal"}
              onClick={() => void useInternal()}
            >
              {active?.dataset_id === "internal"
                ? "Internal snapshot active"
                : "Switch to internal snapshot"}
            </button>
          </div>
        )}
      </Card>

      {dataset && (
        <Card title="Dataset quality">
          <div className="cp-metrics">
            <div><small>Rows</small><strong>{dataset.observations ?? "—"}</strong></div>
            <div><small>First</small><strong>{dataset.first_observation ?? "—"}</strong></div>
            <div><small>Last</small><strong>{dataset.last_observation ?? "—"}</strong></div>
            <div>
              <small>Tickers</small>
              <strong>
                {dataset.successful_tickers?.length ?? 0} / {dataset.tickers?.length ?? 0}
              </strong>
            </div>
          </div>

          {dataset.missing_required_symbols?.length > 0 && (
            <div className="cp-error">
              Missing model-universe symbols:{" "}
              {dataset.missing_required_symbols.join(", ")}
            </div>
          )}

          {dataset.coverage?.length > 0 && (
            <div className="cp-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th><th>Obs.</th><th>First</th><th>Last</th><th>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.coverage.map((r: any) => (
                    <tr key={r.ticker}>
                      <td>{r.ticker}</td>
                      <td>{r.observations}</td>
                      <td>{r.first_observation ?? "—"}</td>
                      <td>{r.last_observation ?? "—"}</td>
                      <td>{r.missing_on_union_calendar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cp-actions">
            <button onClick={() => void download()}>Download CSV</button>
            {dataset.activation_eligible && (
              <span className="cp-valid">
                {active?.dataset_id === dataset.dataset_id
                  ? "Active"
                  : "Ready"}
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
