import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, WifiOff } from "lucide-react";
import type { ValidationJob } from "@workspace/api-client-react";
import { formatJobElapsed } from "./use-validation-job";

export function ValidationJobStatus({ job, active, submitting, reconnecting, seconds, submissionError }:
  { job: ValidationJob | null; active: boolean; submitting: boolean; reconnecting: boolean; seconds: number; submissionError: string | null }) {
  if (!job && !submitting && !submissionError) return null;
  const failed = job?.status === "failed" || !!submissionError;
  const completed = job?.status === "completed";
  const status = submissionError ? "Submission failed" : job?.status ?? "submitting";
  const description = submissionError ?? job?.error?.message ??
    (completed ? `Validation Run #${job.validationRunId} is ready.` :
      reconnecting ? "Connection interrupted. Reconnecting to the saved validation job…" :
        submitting ? "Submitting validation job…" : `${job?.phase ?? "Queued"} · elapsed ${formatJobElapsed(seconds)}`);
  return <Alert
    variant={failed ? "destructive" : "default"}
    role="status"
    aria-live="polite"
    data-testid="status-validation-job"
  >
    {active ? <Loader2 className="h-4 w-4 animate-spin" /> : reconnecting ? <WifiOff className="h-4 w-4" /> : null}
    <AlertDescription className="ml-2 flex flex-wrap items-center gap-2">
      <Badge variant={failed ? "destructive" : completed ? "default" : "outline"}>
        {status}
      </Badge>
      <span>{description}</span>
      {job?.attempts ? <span className="text-xs text-muted-foreground">Attempt {job.attempts}</span> : null}
      {job?.status === "failed" && job.error?.code ? <span className="text-xs">({job.error.code})</span> : null}
    </AlertDescription>
  </Alert>;
}