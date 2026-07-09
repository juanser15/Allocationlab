import { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  useGetPricesStatus,
  useRunPipeline,
  useGetLatestResults,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  ArrowRight,
  CheckSquare,
  Square,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

const getRegimeBadgeStyle = (label: string) => {
  switch (label) {
    case "Risk-On": return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral": return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious": return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off": return "bg-red-100 text-red-800 border-red-200";
    default: return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

export default function CommandCenter() {
  const [, setLocation] = useLocation();
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();

  const [runLabel, setRunLabel] = useState("");
  const runPipeline = useRunPipeline();

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
    "Historical Archive workspace (browse prior rebalances, side-by-side comparison with turnover & realized return, filters, PDF/PNG/CSV export)",
    "Bias-resistant backtester (execution timing/costs/slippage, walk-forward testing, sensitivity checks, bias audit checklist, Integrity Score)",
    "AI Investment Committee reasoning layer (deterministic persona debate + CIO synthesis + exportable memo, zero fabrication)",
    "Navigation reorganized into a clear 9-section hierarchy",
  ];
  const CURRENT_ITERATION = 11;
  const MAX_ITERATIONS = 15;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        section="1 · Command Center"
        title="Command Center"
        description="Single entry point to run the monthly rebalance, check the latest result, and see overall system status."
      />

      {!loadingPrices && !hasData && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2 flex items-center justify-between w-full flex-wrap gap-2">
            <span>No price data loaded. You must upload price history to run the pipeline.</span>
            <Link href="/setup-data" className="text-sm font-medium underline flex items-center">
              Go to Setup & Data <ArrowRight className="ml-1 h-3 w-3" />
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
            <CardTitle>Run Monthly Rebalance</CardTitle>
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
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border mt-1 ${getRegimeBadgeStyle(latestResult.regime.label)}`}>
                      {latestResult.regime.label}
                      {latestResult.regime.confidence > 0 && (
                        <span className="ml-1.5 opacity-70">· {latestResult.regime.confidence.toFixed(0)}% conf.</span>
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
                    <Link href="/results">View Results & Diagnostics</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">No previous runs found.</p>
                </div>
              )}
            </CardContent>
          </Card>

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
            <CardContent className="space-y-1 pt-1">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">Recently Completed</p>
              <div className="space-y-1">
                {iterationCompleted.slice(-4).map((item) => (
                  <div key={item} className="flex items-start gap-1.5">
                    <CheckSquare className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-gray-500 leading-tight">{item}</span>
                  </div>
                ))}
              </div>
              <Link href="/methodology" className="text-xs text-primary underline inline-flex items-center gap-1 pt-1">
                View full roadmap <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
