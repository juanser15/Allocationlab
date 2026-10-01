import { useEffect, useRef, useState } from "react";
import {
  useGetValidationJob, useReplayAllocation, useReplayValidationRun, getGetValidationJobQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { jobIsPending, type PortfolioHistoryEntry } from "./portfolio-history-state";
import { replayTargetFor } from "./replay-target";

interface Outcome { key: string; status?: string; differences?: string[]; maxDiff?: number; error?: string }

export function HistoryReplayInspector({ entry }: { entry: PortfolioHistoryEntry | null }) {
  const needJob = !!entry && entry.kind === "job" && !!entry.jobId && entry.validationRunId === null;
  const { data: job } = useGetValidationJob(entry?.jobId ?? "", {
    query: {
      enabled: needJob, queryKey: getGetValidationJobQueryKey(entry?.jobId ?? ""),
      refetchInterval: (q: any) => (jobIsPending(q.state?.data?.status) ? 3000 : false),
    } as any,
  });
  const target = replayTargetFor(entry, job?.validationRunId ?? null, job?.request);
  const key = entry ? `${entry.kind}:${entry.id}` : "";
  const keyRef = useRef(key);
  keyRef.current = key;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => { setOutcome(null); setPendingKey(null); }, [key]);
  const replayAlloc = useReplayAllocation();
  const replayRun = useReplayValidationRun();

  if (!entry) return null;
  const finish = (k: string, o: Omit<Outcome, "key">) => {
    if (keyRef.current !== k) return; // stale identity guard
    setPendingKey(null);
    setOutcome({ key: k, ...o });
  };
  const run = () => {
    if (!target) return;
    const k = key;
    setPendingKey(k);
    setOutcome(null);
    const onError = (e: unknown) => finish(k, { error: e instanceof Error ? e.message : "Replay failed" });
    if (target.type === "allocation") {
      replayAlloc.mutate({ allocationId: target.id }, {
        onSuccess: (r) => finish(k, { status: r.status, differences: r.differences, maxDiff: r.maximumNumericDifference }), onError });
    } else {
      replayRun.mutate({ validationRunId: target.id }, {
        onSuccess: (r) => finish(k, { status: r.status, differences: r.differences, maxDiff: r.maximumNumericDifference }), onError });
    }
  };
  const busy = pendingKey === key;
  const mine = outcome && outcome.key === key ? outcome : null;
  return (
    <div className="rounded-md border bg-white p-4 space-y-3" data-testid="panel-history-replay">
      <div className="text-sm font-medium">Selected record</div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div><dt className="text-muted-foreground">Kind</dt><dd>{entry.kind}</dd></div>
        <div><dt className="text-muted-foreground">Status</dt><dd>{entry.status}</dd></div>
        <div><dt className="text-muted-foreground">Saved</dt><dd>{new Date(entry.createdAt).toLocaleString()}</dd></div>
        <div><dt className="text-muted-foreground">Mode</dt><dd>{entry.representation ?? entry.executionMode ?? "legacy"}</dd></div>
      </dl>
      {target ? (
        <Button size="sm" variant="outline" onClick={run} disabled={busy} data-testid="button-history-replay">
          {busy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Replaying…</> : "Replay this record"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="text-replay-unavailable">
          {needJob && jobIsPending(job?.status) ? "Job still running; replay becomes available once it saves a run."
            : "Replay is unavailable for this record."}
        </p>
      )}
      {mine?.error && <p className="text-xs text-destructive" data-testid="text-replay-error">{mine.error}</p>}
      {mine?.status && (
        <div className="text-xs space-y-1" data-testid="text-replay-result">
          <div>Replay status: <span className="font-medium">{mine.status}</span>
            {mine.maxDiff !== undefined && <> · max numeric difference {mine.maxDiff}</>}</div>
          {mine.differences && mine.differences.length > 0 && (
            <ul className="list-disc pl-4">{mine.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>)}
        </div>
      )}
    </div>
  );
}
