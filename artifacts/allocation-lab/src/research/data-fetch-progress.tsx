import { useEffect, useState } from "react";
import type { DataFetchProgress } from "@workspace/api-client-react";

export function duration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function DataFetchProgressView({ progress, status, startedAt, total }: {
  progress: DataFetchProgress | null;
  status: "RUNNING" | "COMPLETE" | "FAILED";
  startedAt: number;
  total: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "RUNNING") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status, startedAt]);
  const elapsed = Math.max(progress?.elapsed_ms ?? 0, now - startedAt, 0);
  const done = progress?.completed ?? 0, count = progress?.total ?? total, remaining = count - done;
  const eta = done > 0 && remaining > 0 ? elapsed / done * remaining : null;
  const percent = status === "COMPLETE" ? 100 : Math.min(99, progress?.percent ?? 0);
  return <section className="du-fetch-progress" aria-label="Data fetch progress">
    <div className="du-section-heading"><h3>{status === "COMPLETE" ? "Fetch complete" : status === "FAILED" ? "Fetch not completed" : "Fetching Yahoo data"}</h3><strong>{percent}%</strong></div>
    <progress aria-label="Confirmed fetch progress" max={100} value={percent} />
    <p role="status">{status === "FAILED" ? "Completion could not be confirmed. Progress below is the last confirmed update." : progress?.message ?? "Connecting to Yahoo Finance…"}</p>
    <dl className="du-fetch-stats">
      <div><dt>Symbols processed</dt><dd>{done} / {count}</dd></div>
      <div><dt>Remaining</dt><dd>{remaining}</dd></div>
      <div><dt>Elapsed</dt><dd>{duration(elapsed)}</dd></div>
      <div><dt>Estimated remaining</dt><dd>{status !== "RUNNING" ? "—" : progress?.phase !== "DOWNLOADING" && progress ? "Finalizing…" : eta === null ? "Estimating…" : `~${duration(eta)}`}</dd></div>
    </dl>
    {!!progress?.current_symbols.length && status === "RUNNING" && <p>Downloading: {progress.current_symbols.join(", ")}</p>}
    <p className="du-note">{progress?.successful ?? 0} successful · {progress?.failed ?? 0} failed. Time remaining is approximate and can increase while Yahoo responds or retries.</p>
    {!!progress?.failed_symbols.length && <p className="du-warning">Failed symbols: {progress.failed_symbols.join(", ")}. Inspect individual coverage before saving.</p>}
    {status === "COMPLETE" && <p className="du-note">Fetched draft is ready. Saving a named dataset and activating it remain separate actions.</p>}
  </section>;
}
