export type PersistedJobStatus = "queued" | "running" | "completed" | "failed";

export interface PersistedJobReference {
  jobId: string;
  status: PersistedJobStatus;
  validationRunId: number | null;
  updatedAt: string;
}

export interface PersistedJobRequest<TRequest> {
  idempotencyKey: string;
  request: TRequest;
  job: PersistedJobReference | null;
  submissionError: string | null;
}

export type ValidationJobRecoveryAction<TRequest> =
  | { type: "submit"; idempotencyKey: string; request: TRequest }
  | { type: "get"; jobId: string }
  | { type: "idle" };

export interface ValidationJobRequestIdentity {
  storageKey: string;
  generation: number;
  idempotencyKey: string;
  jobId: string | null;
}

export interface ValidationJobResponseVersion {
  jobId: string;
  updatedAt: string;
}

/** Resume an uncertain submission with its original key, or retrieve its known job. */
export function validationJobRecoveryAction<TRequest>(
  stored: PersistedJobRequest<TRequest> | null,
  verifiedTerminalJobId: string | null,
  forceTerminalRefresh = false,
): ValidationJobRecoveryAction<TRequest> {
  if (!stored || stored.submissionError) return { type: "idle" };
  const job = stored.job;
  if (!job) return { type: "submit", idempotencyKey: stored.idempotencyKey, request: stored.request };
  const terminal = job.status === "completed" || job.status === "failed";
  if (terminal && !forceTerminalRefresh && verifiedTerminalJobId === job.jobId)
    return { type: "idle" };
  return { type: "get", jobId: job.jobId };
}

/** Restore an already-linked Validation Run once, including one linked to failure. */
export function shouldRestoreValidationRun(
  job: PersistedJobReference,
  notifiedJobId: string | null,
): boolean {
  return (job.status === "completed" || job.status === "failed") &&
    job.validationRunId !== null && notifiedJobId !== job.jobId;
}

/** Reject async results from an obsolete request, tab generation, scope or older snapshot. */
export function mayApplyValidationJobResponse<TRequest, TJob extends PersistedJobReference & ValidationJobResponseVersion>(
  identity: ValidationJobRequestIdentity,
  currentScope: string,
  currentGeneration: number,
  current: PersistedJobRequest<TRequest> | null,
  response: TJob,
): boolean {
  if (identity.storageKey !== currentScope || identity.generation !== currentGeneration ||
      !current || current.idempotencyKey !== identity.idempotencyKey) return false;
  if (identity.jobId && current.job?.jobId !== identity.jobId) return false;
  if (current.job && current.job.jobId !== response.jobId) return false;
  if (response.jobId !== current.job?.jobId && identity.jobId) return false;
  if (current.job && current.job.jobId === response.jobId) {
    const currentUpdated = Date.parse(current.job.updatedAt);
    const responseUpdated = Date.parse(response.updatedAt);
    if (Number.isFinite(currentUpdated) && Number.isFinite(responseUpdated) &&
        currentUpdated > responseUpdated) return false;
  }
  return true;
}

export function mayApplyValidationJobError<TRequest>(
  identity: ValidationJobRequestIdentity,
  currentScope: string,
  currentGeneration: number,
  current: PersistedJobRequest<TRequest> | null,
): boolean {
  if (identity.storageKey !== currentScope || identity.generation !== currentGeneration ||
      !current || current.idempotencyKey !== identity.idempotencyKey) return false;
  return identity.jobId
    ? current.job?.jobId === identity.jobId
    : current.job === null;
}