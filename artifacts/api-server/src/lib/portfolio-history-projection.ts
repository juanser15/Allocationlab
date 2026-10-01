export type PortfolioHistoryStatus = "frozen" | "queued" | "running" | "completed" | "failed";
export type PortfolioHistoryKind = "optimization" | "allocation" | "validation" | "job";

export type PortfolioHistoryEntry = {
  kind: PortfolioHistoryKind;
  id: string;
  createdAt: string;
  status: PortfolioHistoryStatus;
  representation: string | null;
  executionMode: string | null;
  replayAvailable: boolean;
  sessionId: number | null;
  allocationId: number | null;
  validationRunId: number | null;
  jobId: string | null;
};

type TimestampRow = { createdAt: Date | string };

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Portfolio history contains an invalid timestamp.");
  return date.toISOString();
}

function recordedText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function projectOptimizationHistory(row: TimestampRow & {
  id: number;
  representation: string | null;
  executionMode: string | null;
}): PortfolioHistoryEntry {
  return {
    kind: "optimization",
    id: String(row.id),
    createdAt: isoDate(row.createdAt),
    status: "frozen",
    representation: recordedText(row.representation),
    executionMode: recordedText(row.executionMode),
    replayAvailable: false,
    sessionId: row.id,
    allocationId: null,
    validationRunId: null,
    jobId: null,
  };
}

export function projectAllocationHistory(row: TimestampRow & {
  id: number;
  representation: string | null;
  resultStatus: string | null;
  executionMode: string | null;
}): PortfolioHistoryEntry {
  return {
    kind: "allocation",
    id: String(row.id),
    createdAt: isoDate(row.createdAt),
    status: row.resultStatus === "SOLVED" ? "frozen" : "failed",
    representation: recordedText(row.representation),
    executionMode: recordedText(row.executionMode),
    replayAvailable: true,
    sessionId: null,
    allocationId: row.id,
    validationRunId: null,
    jobId: null,
  };
}

export function projectValidationHistory(row: TimestampRow & {
  id: number;
  strategySnapshotId: number | null;
  allocationId: number | null;
  reconciliationStatus: string;
  reproducibilityStatus: string;
  representation: string | null;
  executionMode: string | null;
}): PortfolioHistoryEntry {
  return {
    kind: "validation",
    id: String(row.id),
    createdAt: isoDate(row.createdAt),
    status: row.reconciliationStatus === "pass" && row.reproducibilityStatus === "pass"
      ? "completed"
      : "failed",
    representation: recordedText(row.representation),
    executionMode: recordedText(row.executionMode),
    replayAvailable: row.allocationId !== null,
    sessionId: row.strategySnapshotId,
    allocationId: row.allocationId,
    validationRunId: row.id,
    jobId: null,
  };
}

export function projectJobHistory(row: TimestampRow & {
  id: string;
  status: string;
  sessionId: number | null;
  allocationId: number | null;
  validationRunId: number | null;
  representation: string | null;
  executionMode: string | null;
}): PortfolioHistoryEntry {
  if (row.status !== "queued" && row.status !== "running" &&
      row.status !== "completed" && row.status !== "failed")
    throw new Error(`Portfolio history contains an unknown validation job status: ${row.status}.`);
  return {
    kind: "job",
    id: row.id,
    createdAt: isoDate(row.createdAt),
    status: row.status,
    representation: recordedText(row.representation),
    executionMode: recordedText(row.executionMode),
    replayAvailable: row.allocationId !== null && row.validationRunId !== null,
    sessionId: row.sessionId,
    allocationId: row.allocationId,
    validationRunId: row.validationRunId,
    jobId: row.id,
  };
}

export function sortPortfolioHistory(entries: PortfolioHistoryEntry[]): PortfolioHistoryEntry[] {
  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) ||
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
