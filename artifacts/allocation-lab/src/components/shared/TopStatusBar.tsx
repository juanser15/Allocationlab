import { useMemo } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, Upload, CalendarDays, FolderKanban } from "lucide-react";
import { useGetPricesStatus, useGetLatestResults } from "@workspace/api-client-react";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { useWorkflowStage } from "@/lib/workflow";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

function HealthDot({ ok, label, warn }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 cursor-help">
          <span className={`h-2 w-2 rounded-full ${ok ? "bg-green-500" : warn ? "bg-amber-500" : "bg-gray-300"}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Persistent top status bar shown under the app header on every page:
 * selected portfolio/version, as-of freshness, workflow stage, and compact
 * health indicators. Gives non-technical users constant orientation without
 * having to hunt through each page.
 */
export function TopStatusBar() {
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: latestResult, isLoading: loadingResult } = useGetLatestResults();
  const { openSettings } = useSettingsDrawer();
  const stageInfo = useWorkflowStage();

  const hasData = !!pricesStatus?.hasData;
  const matchesD6TestFixture = pricesStatus?.hasData === true
    && pricesStatus.rowCount === 620
    && pricesStatus.startDate === "2024-01-02"
    && pricesStatus.endDate === "2026-05-18"
    && pricesStatus.tickers.length === 5
    && ["D6A", "D6B", "D6C", "D6D", "D6E"].every((ticker) => pricesStatus.tickers.includes(ticker));

  const freshnessLabel = useMemo(() => {
    if (!hasData || !pricesStatus?.endDate) return "No data";
    const end = new Date(pricesStatus.endDate);
    const days = Math.floor((Date.now() - end.getTime()) / 86400000);
    if (days <= 1) return "Up to date";
    if (days <= 5) return `${days}d stale`;
    return `${days}d stale — refresh recommended`;
  }, [hasData, pricesStatus?.endDate]);

  const stageLabel = useMemo(() => {
    if (!hasData) return "Awaiting data";
    if (!latestResult) return "Ready to rebalance";
    if (stageInfo.isApproved) return "Approved";
    if (stageInfo.isUnderReview) return "Under review";
    if (stageInfo.hasCommittee) return "Committee pack ready";
    if (stageInfo.hasBacktest) return "Validated";
    return "Rebalanced";
  }, [hasData, latestResult, stageInfo]);

  if (loadingPrices || loadingResult) {
    return (
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-gray-50 shrink-0">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-x-4 gap-y-1.5 px-4 py-1.5 text-xs border-b bg-gray-50 text-gray-600 shrink-0 flex-wrap">
      {matchesD6TestFixture && (
        <div role="alert" className="w-full rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">
          TEST_ONLY — Latest price metadata matches the retained synthetic D6 fixture (D6A–D6E, 620 rows, 2024-01-02–2026-05-18). This is synthetic test data, not market evidence. Explicitly select market data before producing real-market reports.
        </div>
      )}
      <span className="inline-flex items-center gap-1.5 font-medium text-gray-900 shrink-0">
        <FolderKanban className="h-3.5 w-3.5 text-primary/70" />
        {latestResult ? `Session #${latestResult.sessionId}` : "No active session"}
      </span>

      <span className="inline-flex items-center gap-1.5 shrink-0">
        <CalendarDays className="h-3.5 w-3.5 text-primary/60" />
        {hasData ? `As of ${pricesStatus?.endDate}` : "No as-of date"}
      </span>

      <span className="inline-flex items-center gap-1 shrink-0">
        {hasData ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        )}
        {freshnessLabel}
      </span>

      <Badge variant="secondary" className="text-[10.5px] font-medium bg-primary/10 text-primary border-0">
        {stageLabel}
      </Badge>

      <span className="hidden sm:flex items-center gap-2.5 shrink-0">
        <HealthDot ok={hasData} label={hasData ? "Price data healthy" : "No price data"} />
        <HealthDot ok={!!stageInfo.hasBacktest && !stageInfo.backtest?.integrity.hardFail} warn={!!stageInfo.backtest?.integrity.hardFail} label={stageInfo.hasBacktest ? "Backtest integrity checked" : "Backtest not yet run"} />
        <HealthDot ok={stageInfo.isApproved} warn={stageInfo.isUnderReview} label={stageInfo.isApproved ? "Committee approved" : stageInfo.isUnderReview ? "Awaiting approval" : "Not yet reviewed"} />
      </span>

      <span className="ml-auto flex items-center gap-3 shrink-0">
        <button onClick={() => openSettings("data-sources")} className="inline-flex items-center gap-1 hover:underline font-medium text-primary">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
        <button onClick={() => openSettings("data-sources")} className="inline-flex items-center gap-1 hover:underline font-medium text-primary">
          <Upload className="h-3 w-3" /> Upload
        </button>
      </span>
    </div>
  );
}
