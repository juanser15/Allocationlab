import {
  useGetPricesStatus,
  useGetLatestResults,
  useGetBacktest,
  useGetOrCreateDecisionLog,
  useGetCommittee,
  useListArchive,
} from "@workspace/api-client-react";

export const STAGE_LABELS = [
  "No Data",
  "Data Loaded",
  "Committee Run",
  "Market Health",
  "Portfolio Construction",
  "Backtest Run",
  "Backtest Diagnostics",
  "Decision Draft",
  "AI Committee",
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
  const { data: backtest, isLoading: loadingBacktest } = useGetBacktest();
  const sessionId = latestResult?.sessionId;

  const { data: decisionLog } = useGetOrCreateDecisionLog(sessionId ?? 0, {
    query: { enabled: !!sessionId },
  } as any);
  const { data: committee } = useGetCommittee({
    query: { enabled: !!sessionId },
  } as any);
  const { data: archiveList } = useListArchive({});

  const hasData = !!pricesStatus?.hasData;
  const hasRun = !!latestResult;
  const hasBacktest = !!backtest?.hasSufficientData;
  const hasDecisionLog = !!decisionLog;
  const hasCommittee = !!committee;
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
    committee,
    decisionLog,
    isLoading: loadingPrices || loadingResult || loadingBacktest,
  };
}
