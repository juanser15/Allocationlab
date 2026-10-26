import { useEffect, useMemo, useState } from "react";
import { datasetMetadataSchema, datasetQualitySchema, fetchDatasetCsv, libraryApi, readDatasetLibrary, readWorkspaceDataset, setWorkspaceDataset, sourceLabel, type DatasetMetadata, type DatasetQuality, type WorkspaceDataset } from "./dataset-persistence";
import "./data-universe.css";

type DataTab = "Library" | "Fetch Data" | "Quality" | "Metadata";
export function DatasetQualityTable({ qa }: { qa: DatasetQuality }) {
  return <>
    <dl className="du-quality-summary">
      <div><dt>Union calendar</dt><dd>{qa.union_calendar_observations.toLocaleString()}</dd></div>
      <div><dt>Complete cases</dt><dd>{qa.complete_case_observations.toLocaleString()}</dd></div>
      <div><dt>Duplicate dates</dt><dd>{qa.duplicate_dates}</dd></div>
      <div><dt>Invalid / nonpositive</dt><dd>{qa.invalid_nonpositive_prices}</dd></div>
      <div><dt>Large gaps</dt><dd>{qa.large_gaps.length}</dd></div>
    </dl>
    <div className="du-table-scroll" tabIndex={0} aria-label="Dataset quality by ticker"><table><thead><tr><th>Ticker</th><th>Observations</th><th>First</th><th>Last</th><th>Missing</th><th>Coverage</th></tr></thead><tbody>{qa.per_ticker.map(r => <tr key={r.ticker}><th scope="row">{r.ticker}</th><td>{r.observations.toLocaleString()}</td><td>{r.first ?? "Unavailable"}</td><td>{r.last ?? "Unavailable"}</td><td>{r.missing}</td><td>{r.coverage_percent.toFixed(1)}%</td></tr>)}</tbody></table></div>
    <p className="du-note">Coverage uses the union calendar. Missing observations remain missing; no forward-fill or interpolation is applied.</p>
    {qa.warnings.length > 0 && <ul className="du-warnings">{qa.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    {qa.failed_tickers.length > 0 && <div className="du-warning"><strong>Some symbols could not be fetched</strong><ul>{qa.failed_tickers.map((r: any, i) => <li key={i}>{typeof r === "string" ? r : `${r.ticker}: ${r.error ?? r.reason ?? "No usable observations"}`}</li>)}</ul></div>}
    {qa.large_gaps.length > 0 && <details><summary>Inspect large gaps</summary><pre>{JSON.stringify(qa.large_gaps, null, 2)}</pre></details>}
  </>;
}

export function DataUniverse({ onDatasetChange, capabilities }: { onDatasetChange?: () => void | Promise<void>; capabilities?: any }) {
  const [tab, setTab] = useState<DataTab>("Library"), [workspace, setWorkspace] = useState<WorkspaceDataset | null>(null), [datasets, setDatasets] = useState<DatasetMetadata[]>([]), [selected, setSelected] = useState<DatasetMetadata | null>(null);
  const [tickers, setTickers] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [name, setName] = useState(""), [refreshOf, setRefreshOf] = useState<string | undefined>();
  const [draft, setDraft] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const parsed = useMemo(() => [...new Set(tickers.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean))], [tickers]);
  const active = workspace?.active_dataset;
  const load = async () => {
    const [next, list] = await Promise.all([readWorkspaceDataset(), readDatasetLibrary()]);
    setWorkspace(next); setDatasets(list); setSelected(previous => previous ? list.find(x => x.dataset_id === previous.dataset_id) ?? previous : next.active_dataset);
  };
  useEffect(() => { void load().catch(e => setError(e.message)); }, [capabilities?.dataset_id]);
  async function operation(action: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function fetchYahoo() {
    await operation(async () => {
      const value = await libraryApi("/fetch", { tickers: parsed, start: from, end: to, frequency: "DAILY", price_field: "ADJUSTED_CLOSE" });
      datasetQualitySchema.parse(value.draft.qa);
      setDraft(value.draft); if (!refreshOf) setName(`Yahoo Daily — ${from} to ${to}`); setNotice("Fetch complete. Inspect quality, then save a named version. Your active dataset has not changed.");
    });
  }
  async function save() {
    await operation(async () => {
      const value = await libraryApi("/save", { draft_id: draft.draft_id, dataset_name: name.trim(), ...(refreshOf ? { refresh_of: refreshOf } : {}) });
      const saved = datasetMetadataSchema.parse(value.dataset);
      setSelected(saved); setDraft(null); setRefreshOf(undefined); await load(); setTab("Library"); setNotice(`${saved.dataset_name} v${saved.dataset_version} saved. Select Use this dataset to activate it.`);
    });
  }
  async function activate(id: string) {
    await operation(async () => { const next = await setWorkspaceDataset(id); setWorkspace(next); await load(); await onDatasetChange?.(); setNotice(`${next.active_dataset.dataset_name} v${next.active_dataset.dataset_version} is now active.`); });
  }
  async function download(ds: DatasetMetadata) {
    await operation(async () => { const csv = await fetchDatasetCsv(ds.dataset_id); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${ds.dataset_id}.csv`; anchor.click(); URL.revokeObjectURL(url); });
  }
  function refresh(ds: DatasetMetadata) { setTickers(ds.tickers.join(", ")); setFrom(ds.requested_start); setTo(ds.requested_end); setRefreshOf(ds.dataset_id); setName(ds.dataset_name); setDraft(null); setTab("Fetch Data"); setNotice("Review the requested dates before fetching. Refresh creates a new immutable version."); }
  const qa = draft?.qa ?? selected?.qa;
  return <section className="du-module" aria-label="Data and Universe">
    <div className="du-active">
      <div><small>Active dataset</small><h2>{active ? `${active.dataset_name} v${active.dataset_version}` : "Dataset library unavailable"}</h2>{active && <><p>{sourceLabel(active.source)} · Daily Adjusted Close</p><p>{active.actual_start} → {active.actual_end} · {active.tickers.length} symbols · {active.row_count.toLocaleString()} calendar observations</p></>}</div>
      <button onClick={() => setTab("Library")} disabled={busy}>Change Dataset</button>
    </div>
    <p className="du-note">Saved versions and active selection are stored on the server. Yahoo data is research data; its historical vintage is not independently verified.</p>
    <nav className="du-tabs" aria-label="Data sections">{(["Library", "Fetch Data", "Quality", "Metadata"] as DataTab[]).map(label => <button key={label} aria-current={tab === label ? "page" : undefined} onClick={() => setTab(label)}>{label}</button>)}</nav>
    {error && <div className="du-error" role="alert"><strong>Data request could not complete</strong><p>{error}</p><button disabled={busy} onClick={() => void operation(load)}>Refresh library</button></div>}
    {notice && <p className="du-notice" role="status">{notice}</p>}
    {tab === "Library" && <>
      <div className="du-section-heading"><h2>Saved datasets</h2><button disabled={busy} onClick={() => void operation(load)}>Refresh library</button></div>
      <div className="du-table-scroll" tabIndex={0} aria-label="Persistent dataset library"><table><thead><tr><th>Name</th><th>Source</th><th>Version</th><th>Tickers</th><th>Coverage</th><th>Frequency</th><th>Created</th><th>QA</th><th>Active</th><th>Actions</th></tr></thead><tbody>{datasets.map(ds => <tr key={ds.dataset_id} data-dataset-id={ds.dataset_id}><th scope="row">{ds.dataset_name}</th><td>{sourceLabel(ds.source)}</td><td>v{ds.dataset_version}</td><td>{ds.tickers.length}</td><td>{ds.actual_start} → {ds.actual_end}</td><td>Daily</td><td>{ds.created_at.slice(0, 10)}</td><td>{ds.qa_status.replaceAll("_", " ")}</td><td>{active?.dataset_id === ds.dataset_id ? <strong className="du-active-tag">ACTIVE</strong> : "—"}</td><td><div className="du-row-actions"><button disabled={busy || active?.dataset_id === ds.dataset_id} onClick={() => void activate(ds.dataset_id)}>Use this dataset</button><button onClick={() => { setSelected(ds); setDraft(null); setTab("Quality"); }}>Inspect</button><button disabled={busy} onClick={() => void download(ds)}>Download CSV</button>{ds.source === "YAHOO_FINANCE" && <button disabled={busy} onClick={() => refresh(ds)}>Refresh as new version</button>}</div></td></tr>)}</tbody></table></div>
      {!datasets.length && <p className="du-note">No saved datasets loaded. Refresh the library to read persistent storage.</p>}
    </>}
    {tab === "Fetch Data" && <div className="du-fetch">
      <div className="du-section-heading"><h2>Fetch historical data</h2><span>Yahoo Finance</span></div>
      <div className="du-form">
        <label className="du-tickers">Tickers<input aria-label="Tickers" value={tickers} onChange={e => setTickers(e.target.value)} placeholder="Enter symbols separated by commas" /></label>
        <label>From<input aria-label="Fetch from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To · inclusive<input aria-label="Fetch to" type="date" max={new Date().toISOString().slice(0,10)} value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Frequency<select aria-label="Data frequency" value="DAILY" disabled><option value="DAILY">Daily</option></select></label>
        <label>Price field<select aria-label="Price field" value="ADJUSTED_CLOSE" disabled><option value="ADJUSTED_CLOSE">Adjusted Close</option></select></label>
      </div>
      <div className="du-actions"><button className="cp-primary" disabled={busy || !parsed.length || !from || !to || from > to} onClick={() => void fetchYahoo()}>{busy ? "Working…" : "FETCH DATA"}</button>{capabilities?.model_data_requirements?.CURRENT && <button disabled={busy} onClick={() => { const r = capabilities.model_data_requirements.CURRENT; setTickers([...r.mandatory_symbols, ...(r.optional_symbols ?? [])].join(", ")); }}>Use Current model inputs</button>}</div>
      {draft && <div className="du-fetched"><h2>Fetched quality</h2><p className="du-note">{draft.qa.successful_tickers.length} successful symbols · {draft.qa.failed_tickers.length} failed · fetched {draft.metadata.fetched_at}</p><DatasetQualityTable qa={draft.qa} /><div className="du-save"><label>Dataset name<input aria-label="Dataset name" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label><button className="cp-primary" disabled={busy || !name.trim()} onClick={() => void save()}>SAVE DATASET</button></div><p className="du-note">Saving creates an immutable version. Activation is a separate, explicit action.</p></div>}
    </div>}
    {tab === "Quality" && (qa ? <><h2>{draft ? "Fetched data" : `${selected?.dataset_name} v${selected?.dataset_version}`}</h2><DatasetQualityTable qa={qa}/></> : <p className="du-note">Inspect a saved dataset or fetch data to see quality.</p>)}
    {tab === "Metadata" && (selected ? <><h2>{selected.dataset_name} v{selected.dataset_version}</h2><dl className="du-metadata">{[["Source", sourceLabel(selected.source)], ["Fetched", selected.fetched_at], ["Created", selected.created_at], ["Requested coverage", `${selected.requested_start} → ${selected.requested_end}`], ["Actual coverage", `${selected.actual_start} → ${selected.actual_end}`], ["Frequency / price", "Daily / Adjusted Close"], ["PIT status", selected.pit_status], ["QA status", selected.qa_status], ["Dataset ID", selected.dataset_id], ["Dataset hash", selected.dataset_hash], ["Adjustment convention", String(selected.adjustment_convention ?? "Recorded by source")], ["Raw source hash", String(selected.raw_source_hash ?? "Not applicable")], ["Notes", String(selected.notes ?? "—")]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><button disabled={busy} onClick={() => void download(selected)}>Download CSV</button></> : <p className="du-note">Select a saved dataset to inspect immutable metadata.</p>)}
  </section>;
}
