import type {
  ResearchIndexPoint,
  ResearchRunResult,
  ResearchRunSubmission,
  WorkbenchApiError,
  WorkbenchAttempt,
  WorkbenchCapabilities,
  WorkbenchRunDetail,
  WorkbenchRunStatus,
} from "./workbench-api";

export const WORKBENCH_POLL_INTERVAL_MS = 2_000;
export const WORKBENCH_UI_POLL_TIMEOUT_MS = 5 * 60_000;
export const ADVANCED_DETAILS_DEFAULT_OPEN = false;

export function buildResearchRunSubmission(cost: 0 | 5): ResearchRunSubmission {
  return {
    research_mode: "CAPITAL_MARKET_EXPOSURE",
    execution_scope: "EMPIRICAL",
    universe: "SPY",
    validation_protocol: "TRADITIONAL_WALK_FORWARD",
    transaction_cost_bps: cost,
  };
}
export function isTerminalStatus(status: WorkbenchRunStatus | null | undefined): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "BLOCKED";
}

export function shouldPollRun(
  detail: WorkbenchRunDetail | undefined,
  pollingStartedAt: number | null,
  now = Date.now(),
): boolean {
  if (!detail || isTerminalStatus(detail.latest_status) || pollingStartedAt === null) return false;
  return now - pollingStartedAt < WORKBENCH_UI_POLL_TIMEOUT_MS;
}

export const STATUS_LABELS: Record<WorkbenchRunStatus, string> = {
  PENDING: "Queued",
  RUNNING: "Running empirical research",
  SUCCESS: "Completed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
};

export function successfulResult(detail: WorkbenchRunDetail | undefined): ResearchRunResult | null {
  if (!detail || typeof detail.latest_successful_result === "string") return null;
  return detail.latest_successful_result;
}

export function currentResult(detail: WorkbenchRunDetail | undefined): ResearchRunResult | null {
  if (!detail || typeof detail.latest_result === "string") return null;
  return detail.latest_result;
}

export function primaryResultSummary(result: ResearchRunResult | null) {
  if (!result || typeof result.metrics === "string" || typeof result.costs === "string") return null;
  return {
    observations: result.metrics.observations,
    finalResearchIndex: result.metrics.final_research_index,
    realizedSimulatedCost: result.costs.realized_transaction_cost,
    transactionCostBps: result.costs.transaction_cost_bps,
    status: result.status,
  };
}

export function researchIndexPoints(result: ResearchRunResult | null): ResearchIndexPoint[] {
  return result && typeof result.time_series !== "string" ? result.time_series.points : [];
}

export interface WalkForwardRow {
  fold: number;
  trainingInterval: string;
  oosInterval: string;
  candidate: string;
  fitKeys: string[];
  observationCount: number;
}

export function walkForwardRows(result: ResearchRunResult | null): WalkForwardRow[] {
  if (!result || typeof result.validation_diagnostics === "string") return [];
  const points = researchIndexPoints(result);
  const jobs = new Map(result.validation_diagnostics.selected_jobs.map((job) => [job.outer_fold, job]));
  return result.validation_diagnostics.outer_folds.map((fold) => {
    const job = jobs.get(fold.outer_fold);
    return {
      fold: fold.outer_fold,
      trainingInterval: `${fold.train_start} – ${fold.train_end} (exclusive)`,
      oosInterval: `${fold.test_start} – ${fold.test_end} (exclusive)`,
      candidate: job?.candidate_id ?? fold.candidate_id,
      fitKeys: job?.fit_keys ?? [],
      observationCount: points.filter((point) => point.outer_fold === fold.outer_fold).length,
    };
  });
}

export function attemptFinancialHash(
  attempt: WorkbenchAttempt,
  detail: WorkbenchRunDetail | undefined,
): string {
  if (!detail) return "NOT_SUPPORTED";
  for (const candidate of [detail.latest_result, detail.latest_successful_result]) {
    if (typeof candidate !== "string" && candidate.execution_attempt_id === attempt.execution_attempt_id)
      return candidate.financial_result_hash;
  }
  return "NOT_SUPPORTED";
}

export function capabilityFixedValue(capabilities: WorkbenchCapabilities, field: string): unknown {
  return capabilities.fixed_fields.find((item) => item.field === field)?.value;
}

export interface SafeUiError {
  title: string;
  message: string;
  nextAction: string;
  code: string;
}

export function safeUiError(error: unknown): SafeUiError {
  const candidate = error as Partial<WorkbenchApiError>;
  const status = typeof candidate.status === "number" ? candidate.status : 500;
  const code = typeof candidate.code === "string" ? candidate.code : "WORKBENCH_REQUEST_FAILED";
  if (status === 401) return {
    title: "Preview access denied",
    message: "The preview token was not accepted.",
    nextAction: "Enter the owner preview token again.", code,
  };
  if (status === 429 && code === "BLOCKED_EXECUTION_CAPACITY") return {
    title: "Research worker is occupied",
    message: "Another empirical run is currently using the available research worker.",
    nextAction: "Refresh status after the current run completes. This page will not retry automatically.", code,
  };
  const map: Record<number, [string, string]> = {
    400: ["Request was rejected", "Review the supported transaction-cost choice and try again."],
    404: ["Run was not found", "Refresh temporary run history and open an available run."],
    409: ["Comparison is not available", "Select two runs with successful immutable results."],
    413: ["Request was too large", "Reload the page; the Workbench sends only the strict five-field request."],
    415: ["Request format was rejected", "Reload the page and try again."],
    429: ["Execution limit reached", "Refresh status; do not submit repeatedly."],
    500: ["Research service error", "Refresh status. No automatic retry was started."],
    502: ["Capability contract mismatch", "Execution is disabled until the UI and service contracts agree."],
    503: ["Preview access is not configured", "Ask the preview owner to configure server-side access."],
  };
  const [title, nextAction] = map[status] ?? map[500];
  return { title, message: candidate.message ?? "The research request could not be completed.", nextAction, code };
}

export function shortIdentifier(value: string, head = 12): string {
  return value.length <= head + 5 ? value : `${value.slice(0, head)}…${value.slice(-4)}`;
}

export function formatResearchNumber(value: number, digits = 4): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
}
