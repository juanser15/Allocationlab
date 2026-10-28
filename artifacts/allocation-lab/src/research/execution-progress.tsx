import React from "react";

const duration = (ms: number | null | undefined) => {
  if (!Number.isFinite(ms)) return "Not recorded";
  const seconds = Math.max(0, Math.ceil(ms! / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** Terminal server status always takes precedence over missing or stale progress. */
export function ExecutionProgress({ record, runId }: { record: any; runId: string | null }) {
  const status = record?.latest_status;
  const progress = record?.progress ?? record?.latest_result?.runtime_progress;
  const failure = record?.latest_result;
  const stopped = status === "FAILED";
  const running = status === "RUNNING" || status === "PENDING";
  const finished = status === "SUCCESS";
  const percent = Number.isFinite(progress?.percent_complete) ? progress.percent_complete : null;
  const timedOut = failure?.error_class === "EXECUTION_TIMEOUT";
  return (
    <div data-testid="execution-progress">
      <p aria-live="polite" data-testid="text-execution-state">
        <strong>{stopped ? (timedOut ? "Stopped · time limit reached" : "Execution stopped")
          : finished ? "Completed and saved"
          : status === "BLOCKED" ? "Not started · worker capacity occupied"
          : running ? "Running" : runId ? "Checking execution status…" : "No execution started in this section."}</strong>
      </p>
      {stopped && (
        <>
          <p role="alert">{failure?.safe_message ?? "This attempt ended without producing a new result."}</p>
          <p className="cp-note">This attempt is not running. No new result was substituted, and earlier saved results are unchanged.</p>
        </>
      )}
      {progress && (
        <>
          <p>{progress.stage}{percent !== null ? ` · ${Math.round(percent)}%${stopped ? " at stop" : ""}` : ""}</p>
          {percent !== null && <progress aria-label="Completed research work" max={100} value={percent} />}
          {Number.isFinite(progress.completed_signals) && Number.isFinite(progress.total_signals) ? (
            <p className="cp-note" data-testid="text-signal-progress">
              {progress.completed_signals} / {progress.total_signals} daily capital signals completed
              {progress.current_signal_date ? ` · through ${progress.current_signal_date}` : ""}
            </p>
          ) : Number.isFinite(progress.completed_work_units) ? (
            <p className="cp-note">{progress.completed_work_units} / {progress.total_work_units} tasks completed</p>
          ) : null}
          <p className="cp-note" data-testid="text-execution-time">
            Elapsed: {duration(progress.elapsed_ms)}
            {running ? progress.estimated_remaining_ms == null
              ? " · Estimating remaining time"
              : ` · Estimated remaining: ${duration(progress.estimated_remaining_ms)}` : ""}
          </p>
          {running && <p className="cp-note">The estimate updates as work completes. You can navigate away; the server continues this attempt.</p>}
          {Number.isFinite(progress.execution_timeout_ms) && (
            <details>
              <summary>Execution safeguards</summary>
              <p className="cp-note">
                Maximum runtime: {duration(progress.execution_timeout_ms)}.
                {" "}The worker also stops after {duration(progress.stall_timeout_ms)} without forward progress.
              </p>
            </details>
          )}
        </>
      )}
      {stopped && !progress && (
        <p className="cp-note">This older attempt did not save its progress counters. Its failed status is recorded; no worker is still running for this attempt.</p>
      )}
    </div>
  );
}
