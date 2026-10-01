export function loadedPolicyMatches(requestedId: number | null, loadedId: number | null): boolean {
  return requestedId !== null && loadedId === requestedId;
}

export function portfolioStateLabel(status: unknown): string {
  if (typeof status !== "string") return "Draft";
  switch (status.toLowerCase()) {
    case "draft": return "Draft";
    case "frozen": return "Frozen";
    case "queued": return "Queued";
    case "running": return "Running";
    case "pending": return "Queued";
    case "completed":
    case "success":
    case "solved": return "Completed";
    case "failed":
    case "fail":
    case "engine_mismatch": return "Failed";
    default: return status;
  }
}

export function isFailedAllocationOutcome(status: unknown): boolean {
  return typeof status === "string" && ["FAILED", "FAIL", "ENGINE_MISMATCH"].includes(status.toUpperCase());
}

export function allocationSummaryState(status: unknown): unknown {
  if (isFailedAllocationOutcome(status)) return "failed";
  if (status === "SOLVED") return "frozen";
  return status;
}

export function pmValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "Not recorded";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "Not recorded";
  } catch {
    return "Not recorded";
  }
}

export function pmPercent(value: unknown, missingLabel = "Undefined"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return missingLabel;
  const percentage = value * 100;
  const fixed = percentage.toFixed(2);
  return percentage !== 0 && Number(fixed) === 0
    ? `${percentage.toExponential(5)}%`
    : `${fixed}%`;
}

export function viewedValidationRunId({
  inspectRunId,
  inspectedJobId,
  inspectedJob,
  selectedRunId,
}: {
  inspectRunId: number | null | undefined;
  inspectedJobId: string | null | undefined;
  inspectedJob: { jobId?: unknown; validationRunId?: number | null } | null;
  selectedRunId: number | null;
}): number | null {
  if (inspectRunId !== null && inspectRunId !== undefined) return inspectRunId;
  if (inspectedJobId) return inspectedJob?.jobId === inspectedJobId
    ? inspectedJob.validationRunId ?? null
    : null;
  return selectedRunId;
}

export function needsHistoricalJobPolling(status: unknown): boolean {
  return status === "queued" || status === "running";
}

export function replayAvailability({
  domain,
  status,
}: {
  domain: "b3" | "legacy" | null;
  status: unknown;
}): string {
  if (domain === null) return "Not recorded";
  if (domain !== "b3") return "Not available for legacy runs";
  if (status === "failed" || status === "fail") return "Failed run · explicit Replay only";
  return "Available · explicit action";
}