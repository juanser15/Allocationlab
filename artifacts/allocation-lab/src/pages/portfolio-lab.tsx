import { Link } from "wouter";
import { useGetLatestResults, useGetOrCreateDecisionLog, useGetBacktest } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Info, ExternalLink, ClipboardList, History, Repeat, Dices, FlaskConical, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

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

export default function PortfolioLab() {
  const { data: result, isLoading: loadingResult } = useGetLatestResults();
  const sessionId = result?.sessionId;
  const { data: decisionLog } = useGetOrCreateDecisionLog(sessionId ?? 0);
  const tradeList = decisionLog?.content?.tradeList ?? [];
  const { data: backtest } = useGetBacktest();

  if (loadingResult) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="2 · Portfolio Lab"
        title="Portfolio Lab"
        description="Rebalance construction rules, the resulting allocation and trade list, factor heatmap and ETF ranking, and inline validation of the current portfolio."
      />

      {!result ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No allocation run yet. Run the committee from the{" "}
            <Link href="/" className="underline font-medium">Dashboard</Link>.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Construction rules summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rebalance Construction</CardTitle>
              <CardDescription>How ETF composite scores and constraints translate into target weights.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                <span>
                  ETFs are ranked by composite factor score; the top-ranked names receive score-weighted allocations,
                  dampened 30% toward prior weights for continuity. Cash is dynamically adjusted by the regime composite.
                  Constraints (cash range, max weight, inclusion threshold, target active ETFs) are configured in{" "}
                  <Link href="/configuration" className="underline font-medium text-primary">Configuration</Link>.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Allocation Output */}
          <Card>
            <CardHeader>
              <CardTitle>Allocation Output</CardTitle>
              <CardDescription>Target weights from the most recent run. Click any ticker to open its ETF Explorer.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead className="text-right">Prior</TableHead>
                    <TableHead className="text-right">New Weight</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-primary/5 font-medium border-b-2 border-primary/20">
                    <TableCell>CASH</TableCell>
                    <TableCell>Cash Reserve</TableCell>
                    <TableCell>Cash</TableCell>
                    <TableCell className="text-right">{(result.cashPriorWeight * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right text-primary font-bold">{(result.cashWeight * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      <span className={result.cashChange > 0 ? "text-green-600" : result.cashChange < 0 ? "text-red-600" : "text-gray-500"}>
                        {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-xs px-2 py-0.5 rounded border bg-gray-100">BASE</span>
                    </TableCell>
                  </TableRow>
                  {result.allocations
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((etf) => (
                      <TableRow key={etf.ticker} className={!etf.active ? "opacity-60 bg-gray-50/50" : ""}>
                        <TableCell className="font-medium"><EtfLink ticker={etf.ticker} className="font-semibold" /></TableCell>
                        <TableCell>{etf.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                        <TableCell className="text-right">{(etf.priorWeight * 100).toFixed(1)}%</TableCell>
                        <TableCell className={`text-right font-medium ${etf.active ? "text-gray-900" : "text-gray-400"}`}>
                          {(etf.weight * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {Math.abs(etf.change) > 0.0001 ? (
                            <span className={etf.change > 0 ? "text-green-600" : "text-red-600"}>
                              {etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {etf.active ? (
                            <span className="text-xs px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">ACTIVE</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded border text-gray-400 border-gray-200">OUT</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Trade List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" /> Trade List
              </CardTitle>
              <CardDescription>Full execution list implied by this rebalance. Committee approval happens in Investment Committee.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-72 overflow-y-auto">
              {tradeList.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No trade list available yet — run the committee to generate one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Ticker</TableHead>
                      <TableHead className="text-xs">Action</TableHead>
                      <TableHead className="text-xs text-right">Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradeList.map((t: any) => (
                      <TableRow key={t.ticker}>
                        <TableCell className="text-xs font-medium">{t.ticker}</TableCell>
                        <TableCell className="text-xs">{t.action}</TableCell>
                        <TableCell className="text-xs text-right">{pct(t.toWeight)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Factor Heatmap & ETF Ranking */}
          <Card>
            <CardHeader>
              <CardTitle>Factor Heatmap & ETF Ranking</CardTitle>
              <CardDescription>
                All evaluated ETFs ranked by composite factor score (0–100 cross-sectional rank). Click any ticker to open its ETF Explorer.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs uppercase tracking-wider text-muted-foreground">
                    <TableHead className="text-center">Rank</TableHead>
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
                    .map((etf, idx) => (
                      <TableRow key={etf.ticker} className="border-b border-gray-100 hover:bg-primary/3">
                        <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
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

          {/* Inline Validate */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" /> Validate
              </CardTitle>
              <CardDescription>Quick checks on the current portfolio. Open Market Intelligence for full analysis.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border rounded-md p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <History className="h-3.5 w-3.5" /> Historical Backtest
                </p>
                {backtest?.hasSufficientData ? (
                  <p className="text-sm font-medium text-gray-900">
                    {backtest.cumulativeReturn !== null ? `${(backtest.cumulativeReturn * 100).toFixed(1)}%` : "N/A"} cum. ·
                    Sharpe {backtest.sharpeRatio !== null ? backtest.sharpeRatio.toFixed(2) : "N/A"}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Insufficient data</p>
                )}
                <Link href="/market-intelligence" className="text-xs text-primary underline inline-flex items-center gap-1">
                  View Details <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="border rounded-md p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Repeat className="h-3.5 w-3.5" /> Walk Forward
                </p>
                {backtest?.hasSufficientData ? (
                  <p className="text-sm font-medium text-gray-900">
                    {backtest.walkForward.folds.length} folds
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Insufficient data</p>
                )}
                <Link href="/market-intelligence" className="text-xs text-primary underline inline-flex items-center gap-1">
                  View Details <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="border rounded-md p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Dices className="h-3.5 w-3.5" /> Monte Carlo
                </p>
                <p className="text-xs text-muted-foreground">Not yet implemented — planned for a future build cycle.</p>
              </div>
              <div className="border rounded-md p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FlaskConical className="h-3.5 w-3.5" /> Scenario Analysis
                </p>
                {backtest?.hasSufficientData ? (
                  <p className="text-sm font-medium text-gray-900">{backtest.sensitivity.runs.length} configurations tested</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Insufficient data</p>
                )}
                <Link href="/market-intelligence" className="text-xs text-primary underline inline-flex items-center gap-1">
                  View Details <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
