import { useState } from "react";
import { useGetLatestResults, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Download, DollarSign, Activity, FileDown, PieChart as PieChartIcon,
  AlertTriangle, Info, ShieldAlert, Eye, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";

function EtfLink({ ticker, className }: { ticker: string; className?: string }) {
  return (
    <Link
      href={`/etf/${ticker}`}
      className={`inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group ${className ?? ""}`}
    >
      {ticker}
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

function riskColor(pct: number): string {
  if (pct >= 25) return "#be123c";
  if (pct >= 15) return "#d97706";
  if (pct >= 8) return "#1d4ed8";
  return "#059669";
}

function corrToRgb(corr: number): string {
  const c = Math.max(-1, Math.min(1, corr));
  if (c >= 0) {
    const t = c;
    const r = Math.round(255 - t * (255 - 30));
    const g = Math.round(255 - t * (255 - 64));
    const b = Math.round(255 - t * (255 - 175));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = -c;
    const r = Math.round(255 - t * (255 - 22));
    const g = Math.round(255 - t * (255 - 163));
    const b = Math.round(255 - t * (255 - 74));
    return `rgb(${r},${g},${b})`;
  }
}

function corrTextColor(corr: number): string {
  return Math.abs(corr) > 0.5 ? "#fff" : "#1e293b";
}

function MetricTooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 cursor-default">
          {children}
          <Info className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  );
}

export default function ResultsDashboard() {
  const { data: result, isLoading } = useGetLatestResults();
  const generateReport = useGenerateReport();
  const { toast } = useToast();
  const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="p-8 max-w-5xl mx-auto h-[calc(100vh-4rem)] flex flex-col items-center justify-center text-center">
        <PieChartIcon className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Results Available</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          You haven't run the allocation pipeline yet. Configure your portfolio and run the rebalance workflow to see results here.
        </p>
        <Button asChild size="lg">
          <Link href="/">Go to Command Center</Link>
        </Button>
      </div>
    );
  }

  const handleDownload = (format: "pdf" | "png" | "csv") => {
    generateReport.mutate(
      { data: { format, sessionId: result.sessionId } },
      {
        onSuccess: (data) => {
          window.open(`/api/reports/download/${data.downloadToken}`, "_blank");
        },
        onError: () => {
          toast({ title: "Failed to generate report", variant: "destructive" });
        },
      }
    );
  };

  const getRegimeBarColor = (score: number) => {
    if (score >= 65) return "bg-green-500";
    if (score >= 45) return "bg-amber-400";
    return "bg-red-500";
  };

  const getCellColorClass = (val: number) => {
    if (val >= 80) return "bg-green-100 text-green-800";
    if (val >= 60) return "bg-green-50 text-green-700";
    if (val >= 40) return "bg-amber-50 text-amber-700";
    if (val >= 20) return "bg-red-50 text-red-700";
    return "bg-red-100 text-red-800";
  };

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

  const methodBadge = (method: string) => {
    switch (method) {
      case "computed":
        return <span className="text-[10px] font-medium uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1 py-0.5">Computed</span>;
      case "proxy":
        return <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">Proxy</span>;
      case "unavailable":
        return <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 bg-gray-100 border border-gray-200 rounded px-1 py-0.5">N/A</span>;
      default:
        return null;
    }
  };

  const donutData = [
    { name: "Cash", value: result.cashWeight * 100, color: "#1B2F5B" },
    ...result.allocations
      .filter((a) => a.weight > 0)
      .map((a, i) => ({
        name: a.ticker,
        value: a.weight * 100,
        color: ["#D4AF37", "#4A5568", "#64748B", "#A0AEC0", "#CBD5E1", "#6B7280", "#9CA3AF", "#E2E8F0"][i % 8],
      })),
  ];

  const regime = result.regime;
  const components = regime.components ?? [];
  const diag = result.diagnostics;
  const hasInsufficient = diag.insufficientDataReasons.length > 0;
  const hasFull = diag.riskContributions.length > 0;
  const volPct = (diag.expectedVolatility * 100).toFixed(1);
  const benchmark = selectedBenchmark ?? (diag.trackingErrors.length > 0 ? diag.trackingErrors[0].benchmarkTicker : null);
  const teEntry = diag.trackingErrors.find((t) => t.benchmarkTicker === benchmark);
  const tePct = teEntry ? (teEntry.trackingError * 100).toFixed(1) : null;
  const diversityBand =
    diag.diversificationScore >= 70
      ? { label: "Well Diversified", color: "bg-green-100 text-green-800 border-green-200" }
      : diag.diversificationScore >= 50
      ? { label: "Moderate Diversification", color: "bg-blue-100 text-blue-800 border-blue-200" }
      : diag.diversificationScore >= 30
      ? { label: "Concentrated", color: "bg-amber-100 text-amber-800 border-amber-200" }
      : { label: "Highly Concentrated", color: "bg-red-100 text-red-800 border-red-200" };
  const heatTickers = diag.activeTickers;
  const nT = heatTickers.length;

  function getCorr(a: string, b: string): number {
    const cell = diag.correlationMatrix.find((c) => c.tickerA === a && c.tickerB === b);
    return cell?.correlation ?? 0;
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="4 · Results & Diagnostics"
        title="Results & Diagnostics"
        description={`Allocation generated ${new Date(result.runAt).toLocaleDateString()}${result.label ? ` · ${result.label}` : ""} · Price data through ${result.priceDataEnd}`}
        actions={
          <>
            <Button variant="outline" onClick={() => handleDownload("csv")} disabled={generateReport.isPending}>
              <FileDown className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={() => handleDownload("pdf")} disabled={generateReport.isPending}>
              <Download className="mr-2 h-4 w-4" /> PDF Report
            </Button>
          </>
        }
      />

      <Tabs defaultValue="allocation">
        <TabsList>
          <TabsTrigger value="allocation">Allocation</TabsTrigger>
          <TabsTrigger value="risk">Risk Diagnostics</TabsTrigger>
        </TabsList>

        {/* ── Allocation Tab ── */}
        <TabsContent value="allocation" className="space-y-6 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">Global Market Health</CardTitle>
                    <CardDescription className="mt-0.5">10-component regime framework</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className={`text-sm py-1 px-2 font-semibold ${getRegimeBadgeStyle(regime.label)}`}>
                      {regime.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Confidence: <span className={regime.confidence >= 70 ? "text-green-700 font-semibold" : regime.confidence >= 40 ? "text-amber-700 font-semibold" : "text-red-700 font-semibold"}>{regime.confidence.toFixed(0)}%</span>
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-bold text-gray-900">Composite Score</span>
                    <span className="font-bold text-lg text-primary">{regime.composite.toFixed(1)}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${getRegimeBarColor(regime.composite)}`} style={{ width: `${regime.composite}%` }} />
                  </div>
                  {regime.drivers && <p className="text-xs text-muted-foreground pt-1 leading-snug">{regime.drivers}</p>}
                </div>
                <div className="border-t pt-3 space-y-2">
                  {components.map((c) => (
                    <div key={c.key} className="space-y-1">
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {methodBadge(c.method)}
                          <span className={`text-sm truncate ${c.method === "unavailable" ? "text-gray-400" : "text-gray-700"}`}>{c.label}</span>
                        </div>
                        <span className={`text-sm font-medium tabular-nums shrink-0 ${c.score === null ? "text-gray-400" : "text-gray-900"}`}>
                          {c.score !== null ? c.score.toFixed(1) : "—"}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        {c.score !== null ? (
                          <div className={`h-full rounded-full ${getRegimeBarColor(c.score)}`} style={{ width: `${c.score}%` }} />
                        ) : (
                          <div className="h-full w-full bg-gray-200 rounded-full" style={{ backgroundImage: "repeating-linear-gradient(90deg, #d1d5db 0, #d1d5db 4px, #f3f4f6 4px, #f3f4f6 8px)" }} />
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 leading-tight">{c.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardContent className="pt-5 pb-4">
                  <p className="text-sm font-medium text-muted-foreground flex items-center">
                    <DollarSign className="h-4 w-4 mr-1 text-primary/60" /> Cash Reserve
                  </p>
                  <p className="text-4xl font-bold text-primary mt-1">{(result.cashWeight * 100).toFixed(1)}%</p>
                  <div className="mt-3 flex items-center">
                    <Badge variant="secondary" className={result.cashChange > 0 ? "bg-green-100 text-green-800" : result.cashChange < 0 ? "bg-red-100 text-red-800" : "bg-gray-100"}>
                      {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}pp vs prior
                    </Badge>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <p className="text-sm font-medium text-muted-foreground flex items-center">
                    <Activity className="h-4 w-4 mr-1 text-primary/60" /> Active ETFs
                  </p>
                  <p className="text-4xl font-bold text-primary mt-1">{result.activeEtfCount}</p>
                  <p className="text-sm text-muted-foreground mt-3">Invested: {(result.investedSleeve * 100).toFixed(1)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={72} paddingAngle={2} dataKey="value">
                        {donutData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                      </Pie>
                      <RechartTooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                      <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={8} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary/70" />
                  Investment Committee Summary
                </CardTitle>
                <CardDescription>Model output translated into portfolio manager language.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What Changed</p>
                  <p className="text-gray-800 leading-relaxed">{result.icSummary.whatChanged}</p>
                </div>
                <div className="border-t pt-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why</p>
                  <p className="text-gray-800 leading-relaxed">{result.icSummary.why}</p>
                </div>
                <div className="border-t pt-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> Key Risks
                  </p>
                  <p className="text-gray-800 leading-relaxed">{result.icSummary.risks}</p>
                </div>
                <div className="border-t pt-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5 text-primary/70" /> Watch Next
                  </p>
                  <p className="text-gray-800 leading-relaxed">{result.icSummary.watchNext}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Near-Miss Watchlist
                </CardTitle>
                <CardDescription>ETFs that almost entered the portfolio this cycle. Click a ticker to explore.</CardDescription>
              </CardHeader>
              <CardContent>
                {result.watchlist.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No near-miss ETFs — all enabled tickers are either active or well below threshold.</p>
                ) : (
                  <div className="space-y-3">
                    {result.watchlist.map((entry) => (
                      <div key={entry.ticker} className="border rounded-md p-3 space-y-1.5 bg-gray-50/60">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <EtfLink ticker={entry.ticker} className="font-semibold text-sm text-gray-900" />
                            <span className="text-xs text-muted-foreground">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={entry.blockingReason === "rank_cutoff" ? "bg-amber-50 text-amber-800 border-amber-200 text-xs" : "bg-red-50 text-red-800 border-red-200 text-xs"}>
                              {entry.blockingReason === "rank_cutoff" ? "Rank Cutoff" : "Below Threshold"}
                            </Badge>
                            <span className="text-sm font-medium tabular-nums">{entry.compositeScore.toFixed(1)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${entry.compositeScore}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 leading-snug">
                          <span className="font-medium text-gray-600">Blocking factor:</span> {entry.blockingFactor}
                        </p>
                        <p className="text-xs text-gray-500 leading-snug">{entry.improvement}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Factor Score Heatmap</CardTitle>
              <CardDescription>
                Underlying component scores for all evaluated ETFs (0–100 cross-sectional rank).
                Click any ticker to open its ETF Explorer.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs uppercase tracking-wider text-muted-foreground">
                    <TableHead>Ticker</TableHead>
                    <TableHead className="text-center">Comp</TableHead>
                    <TableHead className="text-center">Mom20</TableHead>
                    <TableHead className="text-center">Mom60</TableHead>
                    <TableHead className="text-center">Mom120</TableHead>
                    <TableHead className="text-center">Mom252</TableHead>
                    <TableHead className="text-center">TrendQ</TableHead>
                    <TableHead className="text-center">RealVol</TableHead>
                    <TableHead className="text-center">Drawdn</TableHead>
                    <TableHead className="text-center">MeanRev</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.allocations
                    .slice()
                    .sort((a, b) => b.factorScores.composite - a.factorScores.composite)
                    .map((etf) => (
                      <TableRow key={etf.ticker} className="border-b border-gray-100 hover:bg-primary/3">
                        <TableCell className="font-medium border-r border-gray-100">
                          <EtfLink ticker={etf.ticker} />
                        </TableCell>
                        <TableCell className={`text-center font-bold border-r border-gray-100 ${getCellColorClass(etf.factorScores.composite)}`}>
                          {etf.factorScores.composite.toFixed(0)}
                        </TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom20)}`}>{etf.factorScores.mom20.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom60)}`}>{etf.factorScores.mom60.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom120)}`}>{etf.factorScores.mom120.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.mom252)}`}>{etf.factorScores.mom252.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.trendQuality)}`}>{etf.factorScores.trendQuality.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.realizedVol60)}`}>{etf.factorScores.realizedVol60.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.drawdown)}`}>{etf.factorScores.drawdown.toFixed(0)}</TableCell>
                        <TableCell className={`text-center ${getCellColorClass(etf.factorScores.meanReversion)}`}>{etf.factorScores.meanReversion.toFixed(0)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground max-w-2xl mx-auto text-center pb-4">
            Methodology: allocations are constructed using a score-weighted approach with continuity constraints.
            Cash is dynamically adjusted by the regime composite. Regime components marked N/A require additional data
            (DXY for Dollar; IEF/TLT for Rates; external EPS feed for Earnings Revision).
          </p>
        </TabsContent>

        {/* ── Risk Diagnostics Tab ── */}
        <TabsContent value="risk" className="space-y-6 pt-4">
          {hasInsufficient && (
            <div className="space-y-1">
              {diag.insufficientDataReasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {r}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <MetricTooltip tip="Annualized portfolio volatility computed from the covariance matrix of daily returns. Based on current weights applied to the historical return window. Includes active ETF positions only; cash has zero volatility.">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected Volatility</p>
                </MetricTooltip>
                {hasFull ? (
                  <p className="text-3xl font-bold text-primary mt-1">{volPct}<span className="text-base font-normal text-muted-foreground">%</span></p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2 italic">Insufficient data</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">annualized</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5 pb-4">
                <MetricTooltip tip="Herfindahl-Hirschman Index: sum of squared portfolio weights for active ETFs (normalized). Ranges 1/N (perfectly equal) to 1 (fully concentrated). Lower values indicate more evenly distributed positions.">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">HHI</p>
                </MetricTooltip>
                <p className="text-3xl font-bold text-primary mt-1">{diag.hhi.toFixed(3)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">1/N min = {diag.activeTickers.length > 0 ? (1 / diag.activeTickers.length).toFixed(3) : "—"}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5 pb-4">
                <MetricTooltip tip="Effective Number of Bets (1/HHI). The implied number of equally-weighted positions that would produce the same HHI. Higher means more diversified. A fully equal-weighted 8-ETF portfolio has ENB = 8.">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Eff. No. of Bets</p>
                </MetricTooltip>
                <p className="text-3xl font-bold text-primary mt-1">{diag.effectiveNumberOfBets.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">of {diag.activeTickers.length} active ETFs</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5 pb-4">
                <MetricTooltip tip="Diversification score based on average pairwise return correlation of active ETFs. Score = (1 − avg correlation) × 100, capped 0–100. A score of 100 means zero average correlation; a score of 0 means all positions move together.">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diversification</p>
                </MetricTooltip>
                <p className="text-3xl font-bold text-primary mt-1">{diag.diversificationScore.toFixed(0)}<span className="text-base font-normal text-muted-foreground">/100</span></p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded border mt-1 inline-block ${diversityBand.color}`}>
                  {diversityBand.label}
                </span>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <MetricTooltip tip="Each ETF's marginal contribution to total portfolio variance. RC_i = w_i × (Σw)_i / σ²_p, expressed as a percentage. Positions with weight risk contributions higher than their capital weight are risk concentrators. Uses the annualized covariance matrix.">
                  <CardTitle className="text-base">Risk Contribution by ETF</CardTitle>
                </MetricTooltip>
                <CardDescription className="text-xs">
                  % of total portfolio variance attributed to each active position
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!hasFull ? (
                  <div className="h-48 flex items-center justify-center text-sm text-muted-foreground italic">
                    Insufficient price history to compute risk contributions.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={diag.riskContributions.length * 38 + 20}>
                    <BarChart data={diag.riskContributions} layout="vertical" margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                      <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="ticker" tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }} width={44} axisLine={false} tickLine={false} />
                      <RechartTooltip
                        formatter={(val: number, _name: string, props) => {
                          const item = props.payload;
                          return [
                            <>
                              <div className="font-semibold">{item.ticker}</div>
                              <div>Risk contrib: {val.toFixed(1)}%</div>
                              <div>Weight: {(item.weight * 100).toFixed(1)}%</div>
                              <div>Marginal vol: {(item.marginalVolContribution * 100).toFixed(2)}%</div>
                            </>,
                            "",
                          ];
                        }}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="riskContributionPct" radius={[0, 3, 3, 0]}>
                        {diag.riskContributions.map((entry) => (
                          <Cell key={entry.ticker} fill={riskColor(entry.riskContributionPct)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {hasFull && (
                  <div className="mt-4 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Weight vs Risk Contribution</p>
                    <div className="space-y-1.5">
                      {diag.riskContributions.map((rc) => {
                        const wPct = rc.weight * 100;
                        const diff = rc.riskContributionPct - wPct;
                        const isRiskConcentrator = diff > 1.5;
                        const isRiskReducer = diff < -1.5;
                        return (
                          <div key={rc.ticker} className="flex items-center gap-2 text-xs">
                            <span className="w-10 font-semibold text-gray-700 shrink-0">{rc.ticker}</span>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                              <div className="h-full bg-primary/30 rounded-l-full" style={{ width: `${Math.min(wPct * 2, 100)}%` }} title={`Weight: ${wPct.toFixed(1)}%`} />
                            </div>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                              <div className="h-full rounded-l-full" style={{ width: `${Math.min(rc.riskContributionPct * 2, 100)}%`, background: riskColor(rc.riskContributionPct) }} title={`Risk: ${rc.riskContributionPct.toFixed(1)}%`} />
                            </div>
                            <span className={`w-20 text-right shrink-0 font-medium ${isRiskConcentrator ? "text-red-600" : isRiskReducer ? "text-green-700" : "text-gray-500"}`}>
                              {diff >= 0 ? "+" : ""}{diff.toFixed(1)}pp
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-primary/30 inline-block" /> Weight</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-600 inline-block" /> Risk contrib</span>
                      <span className="text-muted-foreground/70">(+pp = risk concentrator)</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <MetricTooltip tip="Pairwise Pearson correlation of daily returns over the covariance estimation window. Blue = positive correlation (assets move together). Green = negative (assets hedge each other). Diagonal always = 1.0.">
                  <CardTitle className="text-base">Return Correlation Heatmap</CardTitle>
                </MetricTooltip>
                <CardDescription className="text-xs">
                  Active ETF pairwise correlations · {diag.lookbackDays}-day window
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!hasFull || nT === 0 ? (
                  <div className="h-48 flex items-center justify-center text-sm text-muted-foreground italic">
                    Insufficient price history to compute correlations.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="border-collapse text-xs" style={{ minWidth: nT * 42 + 44 }}>
                      <thead>
                        <tr>
                          <th className="w-11 h-6" />
                          {heatTickers.map((t) => (
                            <th key={t} className="w-10 h-6 text-center font-semibold text-gray-600 text-[10px] pb-1">{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatTickers.map((rowTicker) => (
                          <tr key={rowTicker}>
                            <td className="pr-1 text-right font-semibold text-gray-600 text-[10px] w-11 h-9">{rowTicker}</td>
                            {heatTickers.map((colTicker) => {
                              const corr = getCorr(rowTicker, colTicker);
                              const bg = corrToRgb(corr);
                              const fg = corrTextColor(corr);
                              const isDiag = rowTicker === colTicker;
                              return (
                                <td key={colTicker} style={{ backgroundColor: bg, color: fg }} className="w-10 h-9 text-center font-medium text-[10px] leading-none select-none" title={`${rowTicker} vs ${colTicker}: ${corr.toFixed(3)}`}>
                                  {isDiag ? <span className="opacity-60">1.0</span> : corr.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>−1.0</span>
                      <div className="flex-1 h-3 rounded" style={{ background: "linear-gradient(to right, rgb(22,163,74), rgb(255,255,255), rgb(30,64,175))" }} />
                      <span>+1.0</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Green = negative corr · Blue = positive corr</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <MetricTooltip tip="Annualized standard deviation of the daily return difference between the portfolio and the selected benchmark. Lower tracking error = portfolio moves more like the benchmark. Computed using current portfolio weights and the lookback window. Only available if benchmark ticker is present in the uploaded price data.">
                <CardTitle className="text-base">Tracking Error vs Benchmark</CardTitle>
              </MetricTooltip>
              <CardDescription className="text-xs">
                Benchmarks are auto-detected from tickers in your uploaded price data (SPY, QQQ, IWM, VTI, AGG, EFA, GLD).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {diag.trackingErrors.length === 0 ? (
                <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    No benchmark tickers detected in the uploaded price data.
                    Add <strong>SPY</strong>, <strong>QQQ</strong>, <strong>IWM</strong>, <strong>VTI</strong>, <strong>AGG</strong>, <strong>EFA</strong>, or <strong>GLD</strong> as a column in your price CSV (in{" "}
                    <Link href="/setup-data" className="underline">Setup &amp; Data</Link>) to enable tracking error.
                  </span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {diag.trackingErrors.map((te) => (
                      <button
                        key={te.benchmarkTicker}
                        onClick={() => setSelectedBenchmark(te.benchmarkTicker)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                          benchmark === te.benchmarkTicker ? "bg-primary text-white border-primary" : "bg-white text-gray-600 border-gray-200 hover:border-primary/50"
                        }`}
                      >
                        {te.benchmarkTicker}
                      </button>
                    ))}
                  </div>

                  {benchmark && tePct && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-md p-4 border">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tracking Error</p>
                        <p className="text-3xl font-bold text-primary">{tePct}<span className="text-base font-normal text-muted-foreground">%</span></p>
                        <p className="text-xs text-muted-foreground mt-0.5">annualized · vs {benchmark}</p>
                      </div>
                      <div className="bg-gray-50 rounded-md p-4 border sm:col-span-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Interpretation</p>
                        <p className="text-xs text-gray-700 leading-relaxed">
                          {parseFloat(tePct) < 5
                            ? `Low tracking error vs ${benchmark} — the portfolio's daily returns move closely with the benchmark. Active bets are modest.`
                            : parseFloat(tePct) < 10
                            ? `Moderate tracking error vs ${benchmark} — the portfolio has meaningful active tilts but broadly follows the benchmark.`
                            : `High tracking error vs ${benchmark} — the portfolio diverges substantially from the benchmark. This reflects the model's active sector/factor positioning.`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          Computed over {diag.lookbackDays} trading days using constant current weights.
                        </p>
                      </div>
                    </div>
                  )}

                  {diag.trackingErrors.length > 1 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">All Detected Benchmarks</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {diag.trackingErrors.map((te) => (
                          <button
                            key={te.benchmarkTicker}
                            onClick={() => setSelectedBenchmark(te.benchmarkTicker)}
                            className={`text-left p-3 rounded border text-xs transition-colors hover:border-primary/30 ${
                              benchmark === te.benchmarkTicker ? "border-primary/40 bg-primary/5" : "border-gray-200 bg-gray-50"
                            }`}
                          >
                            <p className="font-semibold text-gray-700">{te.benchmarkTicker}</p>
                            <p className="text-lg font-bold text-primary mt-0.5">{(te.trackingError * 100).toFixed(1)}%</p>
                            <p className="text-muted-foreground text-[10px]">ann. TE</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-4 pb-4">
            <Activity className="h-3.5 w-3.5 shrink-0" />
            <span>
              Diagnostics computed from {diag.activeTickers.length} active ETF positions using a {diag.lookbackDays}-day daily return window.
              Cash (zero-volatility) is excluded from the covariance matrix. All values are annualized.
            </span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
