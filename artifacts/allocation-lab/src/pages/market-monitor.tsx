import { useState } from "react";
import { useGetLatestResults, useGetUniverse, useGetPricesStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, Info, AlertTriangle, Activity } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";

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

function getCellColorClass(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function getRegimeBarColor(score: number) {
  if (score >= 65) return "bg-green-500";
  if (score >= 45) return "bg-amber-400";
  return "bg-red-500";
}

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

function methodBadge(method: string) {
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

export default function MarketMonitor() {
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: universe, isLoading: loadingUniverse } = useGetUniverse();
  const { data: result, isLoading: loadingResult } = useGetLatestResults();
  const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null);

  const hasData = !!pricesStatus?.hasData;

  const scoreByTicker = new Map((result?.allocations ?? []).map((a) => [a.ticker, a.factorScores.composite]));
  const diag = result?.diagnostics;
  const regime = result?.regime;
  const hasInsufficient = (diag?.insufficientDataReasons.length ?? 0) > 0;
  const benchmark = selectedBenchmark ?? (diag?.trackingErrors.length ? diag.trackingErrors[0].benchmarkTicker : null);
  const teEntry = diag?.trackingErrors.find((t) => t.benchmarkTicker === benchmark);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="Market Monitor"
        title="Market Monitor"
        description="Explore individual ETFs and factors, and review market health detail derived from the latest committee run."
      />

      {loadingPrices ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !hasData ? (
        <EmptyState
          icon={Activity}
          title="No price data yet"
          description="Upload or refresh price data in Settings, then run the Investment Committee to populate market health and factor scores."
          actionLabel="Go to Settings"
          actionHref="/settings"
        />
      ) : (
      <Tabs defaultValue="explorer">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="explorer">ETF Explorer</TabsTrigger>
          <TabsTrigger value="factors">Factor Explorer</TabsTrigger>
          <TabsTrigger value="market-health">Market Health</TabsTrigger>
        </TabsList>

        {/* ── ETF Explorer ── */}
        <TabsContent value="explorer" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>ETF Universe</CardTitle>
              <CardDescription>Click any ticker to open its price chart, factor breakdown, and score history.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUniverse ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : (
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Sector</TableHead>
                      <TableHead className="text-center">Enabled</TableHead>
                      <TableHead className="text-right">Latest Composite</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(universe?.etfs ?? []).map((etf) => (
                      <TableRow key={etf.ticker}>
                        <TableCell className="font-medium">
                          <EtfLink ticker={etf.ticker} />
                        </TableCell>
                        <TableCell>{etf.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                        <TableCell className="text-center">
                          {etf.enabled ? (
                            <span className="text-xs px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">Yes</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded border text-gray-400 border-gray-200">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {scoreByTicker.has(etf.ticker) ? scoreByTicker.get(etf.ticker)!.toFixed(1) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Factor Explorer ── */}
        <TabsContent value="factors" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Factor Score Heatmap</CardTitle>
              <CardDescription>
                Underlying component scores for all evaluated ETFs (0–100 cross-sectional rank).
                Click any ticker to open its ETF Explorer.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loadingResult ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : !result ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No allocation run yet.</p>
              ) : (
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Market Health ── */}
        <TabsContent value="market-health" className="space-y-6 pt-4">
          {!result || !regime || !diag ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No allocation run yet.</CardContent></Card>
          ) : (
            <>
              <Card>
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
                    {(regime.components ?? []).map((c) => (
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
                    <MetricTooltip tip="Annualized portfolio volatility computed from the covariance matrix of daily returns based on current weights.">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected Volatility</p>
                    </MetricTooltip>
                    <p className="text-2xl font-bold text-primary mt-2">{(diag.expectedVolatility * 100).toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <MetricTooltip tip="Herfindahl-Hirschman Index of portfolio weights, 0-1. Higher means more concentrated.">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">HHI</p>
                    </MetricTooltip>
                    <p className="text-2xl font-bold text-primary mt-2">{diag.hhi.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <MetricTooltip tip="Effective number of independent bets (1/HHI). Higher means more diversified.">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Eff. Bets</p>
                    </MetricTooltip>
                    <p className="text-2xl font-bold text-primary mt-2">{diag.effectiveNumberOfBets.toFixed(1)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <MetricTooltip tip="Diversification score 0-100 based on average pairwise correlation among active positions.">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diversification</p>
                    </MetricTooltip>
                    <p className="text-2xl font-bold text-primary mt-2">{diag.diversificationScore.toFixed(0)}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Risk Contributions</CardTitle>
                  <CardDescription>Percentage of total portfolio variance attributed to each position.</CardDescription>
                </CardHeader>
                <CardContent>
                  {diag.riskContributions.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Insufficient data for risk contribution analysis.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs uppercase tracking-wider text-muted-foreground">
                          <TableHead>Ticker</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                          <TableHead className="text-right">Risk Contribution</TableHead>
                          <TableHead className="text-right">Marginal Vol</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {diag.riskContributions
                          .slice()
                          .sort((a, b) => b.riskContributionPct - a.riskContributionPct)
                          .map((r) => (
                            <TableRow key={r.ticker}>
                              <TableCell className="font-medium"><EtfLink ticker={r.ticker} /></TableCell>
                              <TableCell className="text-right">{(r.weight * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-right">{r.riskContributionPct.toFixed(1)}%</TableCell>
                              <TableCell className="text-right">{(r.marginalVolContribution * 100).toFixed(2)}%</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {diag.trackingErrors.length > 0 && teEntry && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Tracking Error</CardTitle>
                    <CardDescription>Portfolio deviation from auto-detected benchmark(s) in your price data.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-primary">{(teEntry.trackingError * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">vs {teEntry.benchmarkTicker}</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
