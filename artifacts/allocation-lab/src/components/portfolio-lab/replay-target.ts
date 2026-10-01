import type { PortfolioHistoryEntry } from "./portfolio-history-state";

export type ReplayTarget = { type: "allocation" | "validation"; id: number } | null;

const isB3 = (e: PortfolioHistoryEntry) => e.allocationId !== null || e.representation !== null;

/**
 * Which explicit replay endpoint a history entry maps to. Replay exists only for frozen B2
 * allocations and B3 validation runs; legacy validations/jobs (session-based) are unavailable.
 */
export function replayTargetFor(
  e: PortfolioHistoryEntry | null,
  jobRunId?: number | null,
  jobRequest?: unknown,
): ReplayTarget {
  if (!e) return null;
  if (e.kind === "allocation" && e.allocationId) return { type: "allocation", id: e.allocationId };
  if (e.kind === "validation" && e.validationRunId && isB3(e)) return { type: "validation", id: e.validationRunId };
  if (e.kind === "job") {
    const legacyReq = !!jobRequest && typeof jobRequest === "object" && "sessionId" in (jobRequest as object);
    if (legacyReq || !isB3(e)) return null;
    const id = e.validationRunId ?? jobRunId ?? null;
    return id ? { type: "validation", id } : null;
  }
  return null;
}
