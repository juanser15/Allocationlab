import { useState } from "react";
import { useLocation } from "wouter";
import { useGetPricesStatus, useRunPipeline, useGetLatestResults } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CardFooter } from "@/components/ui/card";
import { Play, CheckCircle2, Circle, AlertCircle, Loader2, ArrowRight, CheckSquare, Square } from "lucide-react";
import { Link } from "wouter";

export default function InvestmentCommittee() {
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
  ];
  const iterationNext = [
    "Historical regime trend chart (rolling composite over time)",
    "Session comparison view (diff between two runs)",
    "Dollar & Rates components (add DXY, IEF/TLT to universe)",
  ];
  const CURRENT_ITERATION = iterationCompleted.length;
  const MAX_ITERATIONS = iterationCompleted.length;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Investment Committee</h1>
        <p className="text-muted-foreground mt-2">Monthly rebalance and allocation run workflow.</p>
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
    </div>
  );
}
