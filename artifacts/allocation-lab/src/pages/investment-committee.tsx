import { useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import {
  useGetPricesStatus,
  useRunPipeline,
  useGetLatestResults,
  useGetOrCreateDecisionLog,
  useUpdateDecisionLogStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Play,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  ArrowRight,
  CheckSquare,
  Square,
  TrendingUp,
  ShieldAlert,
  Eye,
  ListChecks,
  ClipboardList,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  X,
  Plus,
} from "lucide-react";
import { Link } from "wouter";

const ACTION_STYLES: Record<string, { icon: ReactElement; className: string }> = {
  ADD: { icon: <Plus className="h-3 w-3" />, className: "bg-green-50 text-green-700 border-green-200" },
  INCREASE: { icon: <ArrowUpRight className="h-3 w-3" />, className: "bg-green-50 text-green-700 border-green-200" },
  DECREASE: { icon: <ArrowDownRight className="h-3 w-3" />, className: "bg-amber-50 text-amber-700 border-amber-200" },
  TRIM: { icon: <ArrowDownRight className="h-3 w-3" />, className: "bg-amber-50 text-amber-700 border-amber-200" },
  REMOVE: { icon: <X className="h-3 w-3" />, className: "bg-red-50 text-red-700 border-red-200" },
  HOLD: { icon: <Minus className="h-3 w-3" />, className: "bg-gray-50 text-gray-600 border-gray-200" },
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-300",
  under_review: "bg-amber-50 text-amber-700 border-amber-300",
  approved: "bg-green-50 text-green-700 border-green-300",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  under_review: "Under Review",
  approved: "Approved",
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default function InvestmentCommittee() {
  const [, setLocation] = useLocation();
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();

  const [runLabel, setRunLabel] = useState("");
  const runPipeline = useRunPipeline();

  const sessionId = latestResult?.sessionId;
  const {
    data: decisionLog,
    isLoading: loadingDecisionLog,
    refetch: refetchDecisionLog,
  } = useGetOrCreateDecisionLog(sessionId ?? 0);
  const updateStatus = useUpdateDecisionLogStatus();

  const handleStatusChange = (status: "draft" | "under_review" | "approved") => {
    if (!decisionLog) return;
    updateStatus.mutate(
      { id: decisionLog.id, data: { status, approvedBy: status === "approved" ? "Investment Committee" : undefined } },
      { onSuccess: () => refetchDecisionLog() }
    );
  };

  const handleRun = () => {
    runPipeline.mutate(
      { data: { label: runLabel || undefined } },
      {
        onSuccess: () => {
          setLocation("/results");
        },
      }
    );
  };

  const hasData = pricesStatus?.hasData;

  const steps = runPipeline.isPending
    ? [
        { step: "load_data", label: "Load Data", status: "done" },
        { step: "compute_factors", label: "Compute Factors", status: "running" },
        { step: "estimate_regime", label: "Estimate Regime (10 components)", status: "pending" },
        { step: "score_etfs", label: "Score ETFs", status: "pending" },
        { step: "construct_allocation", label: "Construct Allocation", status: "pending" },
        { step: "generate_report", label: "Generate Report", status: "pending" },
      ]
    : [
        { step: "load_data", label: "Load Data", status: "pending" },
        { step: "compute_factors", label: "Compute Factors", status: "pending" },
        { step: "estimate_regime", label: "Estimate Regime (10 components)", status: "pending" },
        { step: "score_etfs", label: "Score ETFs", status: "pending" },
        { step: "construct_allocation", label: "Construct Allocation", status: "pending" },
        { step: "generate_report", label: "Generate Report", status: "pending" },
      ];

  const getStepIcon = (status: string) => {
    switch (status) {
      case "done": return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "running": return <Loader2 className="h-5 w-5 text-accent animate-spin" />;
      case "error": return <AlertCircle className="h-5 w-5 text-destructive" />;
      default: return <Circle className="h-5 w-5 text-gray-300" />;
    }
  };

  // Iteration progress data
  const iterationCompleted = [
    "Core UI scaffold & navigation",
    "Price data upload & live Yahoo Finance integration",
    "Factor computation engine (8 factors)",
    "Regime estimation (4 computed components)",
    "Allocation constructor with constraints",
    "Results dashboard with heatmap",
    "Report generation (CSV + PDF)",
    "10-component Market Health module + IC Summary + Watchlist",
    "Portfolio Diagnostics (vol, HHI, ENB, risk contributions, correlation heatmap, tracking error)",
    "ETF Explorer (price chart, factor breakdown, score history, IC narrative, clickable links)",
    "Backtesting workspace (equity curve, return/vol/Sharpe/drawdown/turnover, monthly returns, benchmark comparison, contribution summary)",
    "Committee report builder (editable one-page report, preview mode, polished PDF/PNG export, quality checklist)",
    "PM Decision Room with structured recommendation cards and an auditable Decision Log",
  ];
  const iterationNext = [
    "Historical regime trend chart (rolling composite over time)",
    "Session comparison view (diff between two runs)",
    "Dollar & Rates components (add DXY, IEF/TLT to universe)",
  ];
  const CURRENT_ITERATION = 7;
  const MAX_ITERATIONS = 10;

  const content = decisionLog?.content;
  const tradeList = content?.tradeList ?? [];
  const activeTrades = tradeList.filter((t) => t.action !== "HOLD");

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Investment Committee</h1>
        <p className="text-muted-foreground mt-2">Monthly rebalance decision room and auditable record of committee action.</p>
      </div>

      {!loadingPrices && !hasData && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2 flex items-center justify-between w-full">
            <span>No price data loaded. You must upload price history to run the pipeline.</span>
            <Link href="/portfolio" className="text-sm font-medium underline flex items-center">
              Go to Portfolio Construction <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {!loadingPrices && hasData && (
        <Alert className="bg-primary/5 border-primary/20">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="ml-2 text-primary font-medium">
            Price data ready. Coverage: {pricesStatus.rowCount} rows, {pricesStatus.tickers.length} tickers.
            {pricesStatus.startDate && pricesStatus.endDate && ` (${pricesStatus.startDate} to ${pricesStatus.endDate})`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pipeline card */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline Execution</CardTitle>
            <CardDescription>Configure and run the monthly allocation model.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="runLabel">Run Label (Optional)</Label>
              <Input
                id="runLabel"
                placeholder="e.g. July 2026 Monthly Rebalance"
                value={runLabel}
                onChange={(e) => setRunLabel(e.target.value)}
                disabled={runPipeline.isPending}
              />
            </div>

            <div className="border rounded-md p-4 space-y-4 bg-gray-50/50">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Execution Steps</h4>
              <div className="space-y-3">
                {steps.map((step, idx) => (
                  <div key={step.step} className="flex items-center text-sm">
                    {getStepIcon(step.status)}
                    <span
                      className={`ml-3 font-medium ${
                        step.status === "running"
                          ? "text-accent font-bold"
                          : step.status === "done"
                          ? "text-gray-900"
                          : "text-gray-500"
                      }`}
                    >
                      {idx + 1}. {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-gray-50 border-t py-4">
            <Button
              onClick={handleRun}
              disabled={!hasData || runPipeline.isPending}
              className="w-full h-12 text-base font-semibold shadow-sm"
              size="lg"
            >
              {runPipeline.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Running Pipeline...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-5 w-5" />
                  Run Monthly Rebalance
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        {/* Right column: Latest Run + Iteration Progress */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Latest Run Status</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLatest ? (
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                  <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                </div>
              ) : latestResult ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Last Executed</p>
                    <p className="font-medium text-gray-900 text-sm">{new Date(latestResult.runAt).toLocaleString()}</p>
                  </div>
                  {latestResult.label && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Label</p>
                      <p className="font-medium text-gray-900 text-sm">{latestResult.label}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Market Regime</p>
                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary mt-1">
                      {latestResult.regime.label}
                      {latestResult.regime.confidence > 0 && (
                        <span className="ml-1.5 text-primary/60">· {latestResult.regime.confidence.toFixed(0)}% conf.</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Cash / Active ETFs</p>
                    <p className="font-medium text-gray-900 text-sm">
                      {(latestResult.cashWeight * 100).toFixed(1)}% cash · {latestResult.activeEtfCount} ETFs
                    </p>
                  </div>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/results">View Results Dashboard</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">No previous runs found.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Iteration Progress card */}
          <Card className="bg-gray-50 border-gray-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                  Build Progress
                </CardTitle>
                <span className="text-xs font-semibold text-primary bg-primary/10 rounded px-2 py-0.5">
                  {CURRENT_ITERATION} / {MAX_ITERATIONS}
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${(CURRENT_ITERATION / MAX_ITERATIONS) * 100}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">Completed</p>
                <div className="space-y-1">
                  {iterationCompleted.map((item) => (
                    <div key={item} className="flex items-start gap-1.5">
                      <CheckSquare className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                      <span className="text-xs text-gray-500 line-through leading-tight">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1.5">Up Next</p>
                <div className="space-y-1">
                  {iterationNext.map((item) => (
                    <div key={item} className="flex items-start gap-1.5">
                      <Square className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <span className="text-xs text-gray-700 leading-tight">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* PM Decision Room */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold tracking-tight text-primary">PM Decision Room</h2>
          {decisionLog && (
            <Badge variant="outline" className={STATUS_STYLES[decisionLog.status]}>
              {STATUS_LABELS[decisionLog.status]}
            </Badge>
          )}
        </div>

        {!sessionId && !loadingLatest && (
          <Alert className="bg-gray-50 border-gray-200">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="ml-2 text-muted-foreground">
              Run the pipeline to generate a committee recommendation.
            </AlertDescription>
          </Alert>
        )}

        {sessionId && loadingDecisionLog && (
          <div className="space-y-2">
            <div className="h-24 bg-gray-100 rounded animate-pulse" />
          </div>
        )}

        {sessionId && content && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Market View */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" /> Market View
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700 leading-relaxed">{content.marketView}</p>
                </CardContent>
              </Card>

              {/* Key Risks */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-600" /> Key Risks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {content.keyRisks.map((risk, i) => (
                      <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-amber-600 mt-1">&bull;</span>
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Portfolio Actions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" /> Portfolio Actions
                </CardTitle>
                <CardDescription>Recommended allocation changes with rationale tied to model factors.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeTrades.length === 0 && (
                  <p className="text-sm text-muted-foreground">No allocation changes recommended this cycle.</p>
                )}
                {activeTrades.map((trade) => {
                  const style = ACTION_STYLES[trade.action] ?? ACTION_STYLES.HOLD;
                  return (
                    <div key={trade.ticker} className="border rounded-md p-3 bg-gray-50/50">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`${style.className} flex items-center gap-1`}>
                            {style.icon} {trade.action}
                          </Badge>
                          <span className="font-semibold text-gray-900 text-sm">{trade.ticker}</span>
                          <span className="text-xs text-muted-foreground">{trade.name}</span>
                        </div>
                        <div className="text-sm font-medium text-gray-900">
                          {pct(trade.fromWeight)} &rarr; {pct(trade.toWeight)}
                          <span className={trade.deltaWeight >= 0 ? "text-green-700 ml-1.5" : "text-red-700 ml-1.5"}>
                            ({trade.deltaWeight >= 0 ? "+" : ""}
                            {(trade.deltaWeight * 100).toFixed(1)}pp)
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 mt-2 leading-relaxed">{trade.rationale}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Watchlist */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" /> Watchlist
                  </CardTitle>
                  <CardDescription>Names close to inclusion, blocked this cycle.</CardDescription>
                </CardHeader>
                <CardContent>
                  {content.watchlist.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No names on the watchlist.</p>
                  ) : (
                    <div className="space-y-2">
                      {content.watchlist.map((w) => (
                        <div key={w.ticker} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900">{w.ticker}</span>
                            <span className="text-xs text-muted-foreground">score {w.compositeScore.toFixed(0)}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">{w.improvement}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Trade List (full table) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-primary" /> Trade List
                  </CardTitle>
                  <CardDescription>Full execution list for this rebalance.</CardDescription>
                </CardHeader>
                <CardContent className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Ticker</TableHead>
                        <TableHead className="text-xs">Action</TableHead>
                        <TableHead className="text-xs text-right">Weight</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tradeList.map((t) => (
                        <TableRow key={t.ticker}>
                          <TableCell className="text-xs font-medium">{t.ticker}</TableCell>
                          <TableCell className="text-xs">{t.action}</TableCell>
                          <TableCell className="text-xs text-right">{pct(t.toWeight)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Decision Log */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm">Decision Log</CardTitle>
                    <CardDescription>Auditable record of committee review and approval.</CardDescription>
                  </div>
                  <Badge variant="outline" className={STATUS_STYLES[decisionLog!.status]}>
                    {STATUS_LABELS[decisionLog!.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Portfolio Version</p>
                    <p className="font-medium text-gray-900">{decisionLog!.portfolioVersion}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Regime</p>
                    <p className="font-medium text-gray-900">
                      {decisionLog!.regimeLabel} ({decisionLog!.regimeComposite})
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Created</p>
                    <p className="font-medium text-gray-900">{new Date(decisionLog!.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Approved By</p>
                    <p className="font-medium text-gray-900">{decisionLog!.approvedBy ?? "—"}</p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center gap-2 flex-wrap">
                  {decisionLog!.status === "draft" && (
                    <Button size="sm" onClick={() => handleStatusChange("under_review")} disabled={updateStatus.isPending}>
                      Submit for Review
                    </Button>
                  )}
                  {decisionLog!.status === "under_review" && (
                    <>
                      <Button size="sm" onClick={() => handleStatusChange("approved")} disabled={updateStatus.isPending}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange("draft")} disabled={updateStatus.isPending}>
                        Send Back to Draft
                      </Button>
                    </>
                  )}
                  {decisionLog!.status === "approved" && (
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange("draft")} disabled={updateStatus.isPending}>
                      Reopen as Draft
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
