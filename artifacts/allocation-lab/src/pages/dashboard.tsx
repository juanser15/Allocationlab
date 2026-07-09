import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import {
  useGetPricesStatus,
  useRunPipeline,
  useGetLatestResults,
  useListArchive,
  useGetArchiveEntry,
  useGetBacktest,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Play, RefreshCw, AlertCircle, Loader2, ArrowRight, DollarSign, Activity,
  ShieldAlert, Eye, FileCheck2, ShieldCheck, ExternalLink, Gauge, ClipboardList,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useWorkflowStage } from "@/lib/workflow";
import { WorkflowStatusBar } from "@/components/shared/WorkflowStatusBar";

type Preset = "today" | "week" | "month" | "ytd" | "custom";

function getRegimeBadgeStyle(label: string) {
  switch (label) {
    case "Risk-On": return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral": return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious": return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off": return "bg-red-100 text-red-800 border-red-200";
    default: return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function EtfLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/etf/${ticker}`} className="inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group font-medium">
      {ticker}
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { stage } = useWorkflowStage();
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const runPipeline = useRunPipeline();
  const { toast } = { toast: (_: any) => {} };

  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(30));
  const [customTo, setCustomTo] = useState(isoDaysAgo(0));

  const range = useMemo(() => {
    switch (preset) {
      case "today": return { fromDate: isoDaysAgo(1), toDate: isoDaysAgo(0) };
      case "week": return { fromDate: isoDaysAgo(7), toDate: isoDaysAgo(0) };
      case "month": return { fromDate: isoDaysAgo(30), toDate: isoDaysAgo(0) };
      case "ytd": return { fromDate: startOfYear(), toDate: isoDaysAgo(0) };
      case "custom": return { fromDate: customFrom, toDate: customTo };
    }
  }, [preset, customFrom, customTo]);

  const { data: archiveList } = useListArchive(range);
  const entries = archiveList?.entries ?? [];

  const [selectedSessionId, setSelectedSessionId] = useState<number | "latest" | null>(null);
  const effectiveSessionId = selectedSessionId === "latest" || selectedSessionId === null
    ? (entries[0]?.sessionId ?? null)
    : selectedSessionId;

  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();
  const isViewingLatest = effectiveSessionId === null || effectiveSessionId === latestResult?.sessionId;

  const { data: archiveEntry, isLoading: loadingArchiveEntry } = useGetArchiveEntry(
    effectiveSessionId ?? 0,
    { query: { enabled: !!effectiveSessionId && !isViewingLatest } as any }
  );

  const { data: backtest } = useGetBacktest();

  const view = isViewingLatest ? latestResult : archiveEntry;
  const isLoading = isViewingLatest ? loadingLatest : loadingArchiveEntry;

  const handleRun = () => {
    runPipeline.mutate(
      { data: {} },
      { onSuccess: () => setLocation("/portfolio-lab") }
    );
  };

  const handleRefreshData = () => setLocation("/settings");

  const hasData = pricesStatus?.hasData;

  const topChanges = useMemo(() => {
    if (!view) return [];
    return view.allocations
      .slice()
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);
  }, [view]);

  const biggestRisks = useMemo(() => {
    if (!view) return [];
    return view.diagnostics.riskContributions
      .slice()
      .sort((a, b) => b.riskContributionPct - a.riskContributionPct)
      .slice(0, 3);
  }, [view]);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="1 · Dashboard"
        title="Dashboard"
        description="Interactive overview of the portfolio, market regime, allocation, and risk — for today or any historical date."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleRefreshData}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh Data
            </Button>
            <Button size="sm" onClick={handleRun} disabled={!hasData || runPipeline.isPending}>
              {runPipeline.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
              Run Committee
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="py-3">
          <WorkflowStatusBar stage={stage} />
        </CardContent>
      </Card>

      {!loadingPrices && !hasData && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2 flex items-center justify-between w-full flex-wrap gap-2">
            <span>No price data loaded. You must upload price history before running the committee.</span>
            <Link href="/settings" className="text-sm font-medium underline flex items-center">
              Go to Settings <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Date range / as-of selector */}
      <Card>
        <CardContent className="pt-5 pb-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date Range</p>
            <div className="flex gap-1.5 flex-wrap">
              {([
                ["today", "Today"], ["week", "Last Week"], ["month", "Last Month"], ["ytd", "YTD"], ["custom", "Custom"],
              ] as [Preset, string][]).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={preset === key ? "default" : "outline"}
                  onClick={() => { setPreset(key); setSelectedSessionId(null); }}
                  className="h-8 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">From</p>
                <Input type="date" className="h-8 text-xs w-[140px]" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">To</p>
                <Input type="date" className="h-8 text-xs w-[140px]" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1 ml-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">As Of</p>
            <Select
              value={selectedSessionId === null ? "latest" : String(selectedSessionId)}
              onValueChange={(v) => setSelectedSessionId(v === "latest" ? "latest" : Number(v))}
            >
              <SelectTrigger className="h-8 text-xs w-[260px]">
                <SelectValue placeholder="Latest" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest (current)</SelectItem>
                {entries.map((e) => (
                  <SelectItem key={e.sessionId} value={String(e.sessionId)}>
                    {new Date(e.runAt).toLocaleDateString()} {e.label ? `· ${e.label}` : ""} · {e.regimeLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {entries.length === 0 && (
              <p className="text-xs text-muted-foreground">No sessions in this range.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !view ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No allocation run available for this range yet. Run the committee to generate one.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top summary row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market Health</p>
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border mt-2 ${getRegimeBadgeStyle(view.regime.label)}`}>
                  {view.regime.label}
                </div>
                <p className="text-2xl font-bold text-primary mt-2">{view.regime.composite.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Composite score</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5 text-primary/60" /> Cash
                </p>
                <p className="text-2xl font-bold text-primary mt-2">{(view.cashWeight * 100).toFixed(1)}%</p>
                <Badge variant="secondary" className={view.cashChange > 0 ? "bg-green-100 text-green-800" : view.cashChange < 0 ? "bg-red-100 text-red-800" : "bg-gray-100"}>
                  {view.cashChange > 0 ? "+" : ""}{(view.cashChange * 100).toFixed(1)}pp vs prior
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3.5 w-3.5 text-primary/60" /> Active ETFs
                </p>
                <p className="text-2xl font-bold text-primary mt-2">{view.activeEtfCount}</p>
                <p className="text-xs text-muted-foreground">of {view.allocations.length} evaluated</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FileCheck2 className="h-3.5 w-3.5 text-primary/60" /> Report Status
                </p>
                <p className="text-sm font-medium text-gray-900 mt-2">
                  {view ? "Available" : "Not generated"}
                </p>
                <Link href="/investment-committee" className="text-xs text-primary underline">Go to Investment Committee</Link>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Portfolio summary / recommended allocation */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recommended Allocation</CardTitle>
                <CardDescription>Top changes vs. prior weights. Full breakdown in Portfolio Lab.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topChanges.map((etf) => (
                    <div key={etf.ticker} className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0">
                      <div className="flex items-center gap-2">
                        <EtfLink ticker={etf.ticker} />
                        <span className="text-xs text-muted-foreground">{etf.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium tabular-nums">{(etf.weight * 100).toFixed(1)}%</span>
                        <span className={`text-xs tabular-nums ${etf.change > 0 ? "text-green-600" : etf.change < 0 ? "text-red-600" : "text-gray-400"}`}>
                          {etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(1)}pp
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="w-full mt-4" asChild>
                  <Link href="/portfolio-lab">Open Portfolio Lab <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                </Button>
              </CardContent>
            </Card>

            {/* Biggest risks + watchlist */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600" /> Biggest Risks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {biggestRisks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No risk data available.</p>
                  ) : biggestRisks.map((r) => (
                    <div key={r.ticker} className="flex items-center justify-between text-sm">
                      <EtfLink ticker={r.ticker} />
                      <span className="text-xs tabular-nums text-gray-600">{r.riskContributionPct.toFixed(0)}% of risk</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {isViewingLatest && latestResult && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-primary/70" /> Watchlist
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {latestResult.watchlist.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No near-miss ETFs this cycle.</p>
                    ) : latestResult.watchlist.slice(0, 3).map((w) => (
                      <div key={w.ticker} className="flex items-center justify-between text-sm">
                        <EtfLink ticker={w.ticker} />
                        <span className="text-xs tabular-nums text-gray-600">{w.compositeScore.toFixed(0)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Data / backtest integrity strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Latest Data</p>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {pricesStatus?.hasData ? `Through ${pricesStatus.endDate}` : "No data loaded"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Backtest Integrity
                </p>
                {backtest?.hasSufficientData ? (
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {backtest.integrity.score}/100 ({backtest.integrity.grade}){backtest.integrity.hardFail ? " · Hard Fail" : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">Insufficient data</p>
                )}
                <Link href="/market-monitor" className="text-xs text-primary underline">View details</Link>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" /> Perf / Risk Summary
                </p>
                {backtest?.hasSufficientData ? (
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {backtest.cumulativeReturn !== null ? `${(backtest.cumulativeReturn * 100).toFixed(1)}%` : "N/A"} cum.
                    {" "}· Sharpe {backtest.sharpeRatio !== null ? backtest.sharpeRatio.toFixed(2) : "N/A"}
                    {" "}· Vol {(view.diagnostics.expectedVolatility * 100).toFixed(1)}%
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">Vol {(view.diagnostics.expectedVolatility * 100).toFixed(1)}%</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
