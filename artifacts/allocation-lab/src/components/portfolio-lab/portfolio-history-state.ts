export type HistoryKind = "optimization" | "allocation" | "validation" | "job";
export type HistoryStatus = "frozen" | "queued" | "running" | "completed" | "failed";

export interface PortfolioHistoryEntry {
  kind: HistoryKind;
  id: string;
  createdAt: string;
  status: HistoryStatus;
  representation: string | null;
  executionMode: string | null;
  replayAvailable: boolean;
  sessionId: number | null;
  allocationId: number | null;
  validationRunId: number | null;
  jobId: string | null;
}

export interface HistorySelection { kind: HistoryKind; id: string }

/** Read-only inspection plan. Contains no mutation, token or submit fields by construction. */
export interface InspectionPlan {
  tab: "overview" | "backtest" | "allocation";
  b2Mode: boolean;
  inspectRunId: number | null;
  inspectedJobId: string | null;
  inspectedAllocationId: number | null;
  pinnedSessionId: number | null;
  pinnedLegacyRunId: number | null;
  /** Legacy optimization sessions are summarised separately, never replacing the working latest. */
  legacySessionSummaryId: number | null;
}

export const HISTORY_SELECTION_KEY = "allocation-lab:pm-history-selection";
export const HISTORY_KINDS: HistoryKind[] = ["optimization", "allocation", "validation", "job"];

export function filterHistory(entries: PortfolioHistoryEntry[], kind: HistoryKind | "all"): PortfolioHistoryEntry[] {
  return kind === "all" ? entries : entries.filter(e => e.kind === kind);
}

export function sortHistory(entries: PortfolioHistoryEntry[]): PortfolioHistoryEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function isLegacyEntry(e: PortfolioHistoryEntry): boolean {
  return e.allocationId === null && e.representation === null && e.sessionId !== null;
}

export function planInspection(e: PortfolioHistoryEntry): InspectionPlan {
  const base: InspectionPlan = {
    tab: "overview", b2Mode: true, inspectRunId: null, inspectedJobId: null,
    inspectedAllocationId: null, pinnedSessionId: null, pinnedLegacyRunId: null,
    legacySessionSummaryId: null,
  };
  const legacy = isLegacyEntry(e);
  if (e.kind === "optimization") {
    return { ...base, b2Mode: !legacy, tab: legacy ? "overview" : "allocation",
      inspectedAllocationId: legacy ? null : e.allocationId,
      legacySessionSummaryId: legacy ? e.sessionId : null };
  }
  if (e.kind === "allocation") {
    return { ...base, tab: "allocation", b2Mode: !legacy, inspectedAllocationId: e.allocationId,
      legacySessionSummaryId: legacy ? e.sessionId : null };
  }
  // validation or job
  if (legacy) {
    return { ...base, tab: "backtest", b2Mode: false, pinnedSessionId: e.sessionId,
      pinnedLegacyRunId: e.validationRunId, inspectedJobId: e.jobId };
  }
  return { ...base, tab: "backtest", b2Mode: true, inspectRunId: e.validationRunId,
    inspectedJobId: e.jobId, inspectedAllocationId: e.allocationId };
}

/** True when a job record has no linked run and so needs its status fetched (GET only). */
export function needsJobStatusFetch(e: PortfolioHistoryEntry | null): boolean {
  return !!e && !!e.jobId && e.validationRunId === null;
}

export function historyReplayAvailable(e: PortfolioHistoryEntry): boolean {
  // Saved B2 allocations can be replayed explicitly from the allocation
  // inspector even though the legacy history projection predates that action.
  return e.kind === "allocation" || e.replayAvailable;
}

export function statusLabel(s: HistoryStatus): string {
  return { frozen: "Frozen", queued: "Job queued", running: "Job running",
    completed: "Job completed", failed: "Job failed" }[s];
}

export function parseSelection(raw: string | null): HistorySelection | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HistorySelection>;
    if (v && typeof v.id === "string" && HISTORY_KINDS.includes(v.kind as HistoryKind))
      return { kind: v.kind as HistoryKind, id: v.id };
  } catch { /* ignore */ }
  return null;
}

export function findSelected(entries: PortfolioHistoryEntry[], sel: HistorySelection | null) {
  return sel ? entries.find(e => e.kind === sel.kind && e.id === sel.id) ?? null : null;
}

export type WorkingState = "draft" | "frozen-inspected" | "job-inspected" | "none";
export function workingState(inspected: PortfolioHistoryEntry | null, hasDraft: boolean): WorkingState {
  if (inspected) return inspected.status === "frozen" || inspected.status === "completed" && inspected.kind !== "job"
    ? "frozen-inspected" : "job-inspected";
  return hasDraft ? "draft" : "none";
}

/** Poll the read-only list only while some job is still queued or running. */
export function hasPendingJobs(entries: PortfolioHistoryEntry[] | undefined): boolean {
  return !!entries?.some(e => e.status === "queued" || e.status === "running");
}

/** Run to view for a legacy inspection: pinned run, else the run linked by the inspected job. Never any other run. */
export function effectiveInspectedRunId(plan: InspectionPlan | null, jobRunId: number | null | undefined): number | null {
  if (!plan || plan.b2Mode) return null;
  return plan.pinnedLegacyRunId ?? jobRunId ?? null;
}

/** Dropdown navigation while inspecting: re-pin the viewed run read-only; working selection untouched. */
export function repinLegacyRun(plan: InspectionPlan, runId: number): InspectionPlan {
  return { ...plan, pinnedLegacyRunId: runId, inspectedJobId: null };
}

export function jobIsPending(status: string | undefined | null): boolean {
  return status === "queued" || status === "running";
}
