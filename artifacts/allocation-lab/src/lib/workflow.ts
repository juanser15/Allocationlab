import {
  useGetPricesStatus,
  useGetLatestResults,
  useGetValidationRun,
  useListValidationRuns,
  useListDecisionLogs,
  useListArchive,
} from "@workspace/api-client-react";
import type { RailStep } from "@/components/shared/WorkflowRail";

export const STAGE_LABELS = [
  "No Data",
  "Data Loaded",
  "Rebalance Run",
  "Market Health",
  "Portfolio Construction",
  "Backtest Run",
  "Backtest Diagnostics",
  "Decision Draft",
  "Committee Pack",
  "Approval",
  "Report",
  "Archived",
] as const;

/**
 * Derives the current position (0-11) in the strict workflow dependency chain
 * from real backend state, so gated modules and empty states can reason about
 * what has and hasn't happened yet. Never infer a stage the user hasn't
 * actually reached — diagnostics must never appear ahead of the run that
 * generates them.
 */
export function useWorkflowStage() {
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: latestResult, isLoading: loadingResult } = useGetLatestResults();
  const sessionId = latestResult?.sessionId;

  // Workflow/status surfaces are read-only: list saved validations, then read
  // the latest saved validation for this session. Never call /api/backtest,
  // which calculates a new legacy backtest as a side effect of GET.
  const { data: validationRuns, isLoading: loadingValidationRuns } = useListValidationRuns(
    { sessionId: sessionId ?? 0 },
    { query: { enabled: !!sessionId } as any },
  );
  const legacyRuns = (validationRuns ?? []).filter(run => "strategySnapshotId" in run);
  const savedRunId = legacyRuns[0]?.validationRunId;
  const { data: savedValidation, isLoading: loadingSavedValidation } = useGetValidationRun(savedRunId ?? 0, {
    query: { enabled: !!savedRunId } as any,
  });
  const backtest = savedValidation && "strategySnapshotId" in savedValidation &&
    savedValidation.strategySnapshotId === sessionId ? savedValidation.result : undefined;

  const { data: decisionLogs, isLoading: loadingDecisionLogs } = useListDecisionLogs();
  const decisionLog = decisionLogs?.find(log => log.sessionId === sessionId);
  const { data: archiveList } = useListArchive({});

  const hasData = !!pricesStatus?.hasData;
  const hasRun = !!latestResult;
  const hasBacktest = !!backtest?.hasSufficientData;
  const hasDecisionLog = !!decisionLog;
  // Committee packs are computed by an explicit Generate action and are not
  // persisted as a pack. Only a saved decision-log state transition is
  // evidence that committee review occurred.
  const hasCommittee = decisionLog?.status === "under_review" || decisionLog?.status === "approved";
  const isApproved = decisionLog?.status === "approved";
  const isUnderReview = decisionLog?.status === "under_review";
  const archiveCount = archiveList?.entries?.length ?? 0;

  let stage = 0;
  if (!hasData) stage = 0;
  else if (!hasRun) stage = 1;
  else if (!hasBacktest) stage = 2;
  else if (!hasDecisionLog) stage = 5;
  else if (!hasCommittee) stage = 7;
  else if (isApproved) stage = archiveCount > 0 ? 11 : 9;
  else if (isUnderReview) stage = 8;
  else stage = 7;

  return {
    stage,
    hasData,
    hasRun,
    hasBacktest,
    hasDecisionLog,
    hasCommittee,
    isApproved,
    isUnderReview,
    archiveCount,
    latestResult,
    pricesStatus,
    backtest,
    decisionLog,
    isLoading: loadingPrices || loadingResult || loadingValidationRuns || loadingSavedValidation || loadingDecisionLogs,
  };
}

export type WorkflowStageInfo = ReturnType<typeof useWorkflowStage>;

/**
 * Maps the granular 12-point workflow stage to the 6-step guided rail shown
 * across the app: Data Ready -> Rebalance -> Validate -> Committee -> Report
 * -> Archive. Never marks a step complete/current ahead of real backend
 * state; steps whose prerequisites are missing are shown as "blocked" (not
 * silently skipped) so users always know what's stopping them.
 */
export function toGuidedRailSteps(info: WorkflowStageInfo): RailStep[] {
  const {
    hasData, hasRun, hasBacktest, hasDecisionLog, hasCommittee, isApproved, isUnderReview, archiveCount,
  } = info;

  const dataStatus: RailStep["status"] = hasData ? "complete" : "current";
  const rebalanceStatus: RailStep["status"] = hasRun ? "complete" : hasData ? "current" : "blocked";
  const validateStatus: RailStep["status"] = hasBacktest ? "complete" : hasRun ? "current" : "blocked";
  const committeeStatus: RailStep["status"] = hasCommittee
    ? "complete"
    : hasDecisionLog || hasBacktest
    ? "current"
    : "blocked";
  const reportStatus: RailStep["status"] = isApproved
    ? "complete"
    : isUnderReview
    ? "current"
    : hasCommittee
    ? "blocked"
    : "blocked";
  const archiveStatus: RailStep["status"] = archiveCount > 0 ? "complete" : isApproved ? "current" : "blocked";

  return [
    { key: "data", label: "Data Ready", status: dataStatus, detail: hasData ? "Price data loaded." : "Upload price data in Settings to begin." },
    { key: "rebalance", label: "Rebalance", status: rebalanceStatus, detail: hasRun ? "Rebalance has been run." : "Run the rebalance in Portfolio Lab." },
    { key: "validate", label: "Validate", status: validateStatus, detail: hasBacktest ? "Backtest validated." : "Run the backtester in Research Lab." },
    { key: "committee", label: "Committee", status: committeeStatus, detail: hasCommittee ? "Saved decision is under committee review or approved." : "Generate the committee pack and explicitly begin review in Investment Committee." },
    { key: "report", label: "Report", status: reportStatus, detail: isApproved ? "Decision approved." : "Awaiting committee approval." },
    { key: "archive", label: "Archive", status: archiveStatus, detail: archiveCount > 0 ? `${archiveCount} archived session${archiveCount === 1 ? "" : "s"}.` : "Archive this session once approved." },
  ];
}
