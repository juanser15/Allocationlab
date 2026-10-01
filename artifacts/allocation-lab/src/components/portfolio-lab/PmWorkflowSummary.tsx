import { Loader2 } from "lucide-react";
import { useGetSession, useGetValidationJob, getGetSessionQueryKey, getGetValidationJobQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  needsJobStatusFetch, statusLabel, workingState,
  type PortfolioHistoryEntry,
} from "./portfolio-history-state";

interface Props {
  inspected: PortfolioHistoryEntry | null;
  hasDraft: boolean;
  draftLabel: string;
  legacySessionSummaryId: number | null;
  onClearInspection: () => void;
}

/** Distinguishes the editable working Draft from a restored, read-only historical record. */
export function PmWorkflowSummary({ inspected, hasDraft, draftLabel, legacySessionSummaryId, onClearInspection }: Props) {
  const state = workingState(inspected, hasDraft);
  const jobId = needsJobStatusFetch(inspected) ? inspected!.jobId! : null;
  const { data: job, isLoading: jobLoading, error: jobError } = useGetValidationJob(jobId ?? "", {
    query: { enabled: !!jobId, queryKey: getGetValidationJobQueryKey(jobId ?? ""), refetchInterval: false } as any,
  });
  const { data: session, isLoading: sessionLoading } = useGetSession(legacySessionSummaryId ?? 0, {
    query: { enabled: !!legacySessionSummaryId, queryKey: getGetSessionQueryKey(legacySessionSummaryId ?? 0) } as any,
  });
  return (
    <div className="rounded-md border bg-white p-3 text-xs space-y-2" data-testid="pm-workflow-summary">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="uppercase tracking-wider text-muted-foreground font-medium">Working state</span>
        {state === "draft" && <Badge variant="outline" className="text-[10px] bg-gray-50">Draft</Badge>}
        {state === "none" && <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-400">No selection</Badge>}
        {inspected && <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
          Inspecting saved {inspected.kind} {inspected.id}: {statusLabel(inspected.status)}</Badge>}
        {inspected && <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" onClick={onClearInspection}
          data-testid="button-clear-inspection">Return to working draft</Button>}
      </div>
      {!inspected && <p className="text-muted-foreground">{hasDraft ? `Draft: ${draftLabel}. Not saved until you run a new optimization.` : "Choose prepared inputs to start a draft."}</p>}
      {inspected && <p className="text-muted-foreground">Read-only historical record. Its inputs are not your current draft selection; running an action creates a new run.</p>}
      {jobId && (
        <div data-testid="text-inspected-job">
          {jobLoading ? <span className="flex items-center"><Loader2 className="h-3 w-3 animate-spin mr-1" /> Reading job status</span>
            : jobError ? <span className="text-destructive">Job status could not be read.</span>
            : job ? <span>Job {job.jobId}: {statusLabel(job.status as any)}{job.error?.message ? ` - ${job.error.message}` : ""}</span> : null}
        </div>
      )}
      {legacySessionSummaryId && (
        <div data-testid="text-inspected-session">
          {sessionLoading ? "Reading saved session" : session
            ? `Saved session ${session.session.id}: ${session.result.activeEtfCount} active ETFs, cash ${(session.result.cashWeight * 100).toFixed(1)}%, run ${new Date(session.result.runAt).toLocaleString()}`
            : "Saved session unavailable."}
        </div>
      )}
    </div>
  );
}
