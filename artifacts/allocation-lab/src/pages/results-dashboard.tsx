import { useGetLatestResults, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Download, DollarSign, Activity, FileDown, PieChart as PieChartIcon,
  AlertTriangle, Info, ShieldAlert, Eye, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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

export default function ResultsDashboard() {
  const { data: result, isLoading } = useGetLatestResults();
  const generateReport = useGenerateReport();
  const { toast } = useToast();

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
          <Link href="/">Go to Investment Committee</Link>
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Results Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Allocation generated {new Date(result.runAt).toLocaleDateString()}
            {result.label && ` · ${result.label}`}
            {" "}·{"  "}Price data through {result.priceDataEnd}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleDownload("csv")} disabled={generateReport.isPending}>
            <FileDown className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => handleDownload("pdf")} disabled={generateReport.isPending}>
            <Download className="mr-2 h-4 w-4" /> PDF Report
          </Button>
        </div>
      </div>

      {/* ── Row 1: Market Health + KPIs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Market Health card */}
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

        {/* KPI column */}
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
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                  <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Row 2: IC Summary + Watchlist ── */}
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

      {/* ── Row 3: Allocation Table ── */}
      <Card>
        <CardHeader>
          <CardTitle>Final Allocation</CardTitle>
          <CardDescription>Target weights and changes versus prior month. Click any ticker to open its ETF Explorer.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Comp Score</TableHead>
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
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">{(result.cashPriorWeight * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right text-primary font-bold">{(result.cashWeight * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right">
                  <span className={result.cashChange > 0 ? "text-green-600" : result.cashChange < 0 ? "text-red-600" : "text-gray-500"}>
                    {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="bg-gray-100">BASE</Badge>
                </TableCell>
              </TableRow>
              {result.allocations
                .slice()
                .sort((a, b) => b.weight - a.weight)
                .map((etf) => (
                  <TableRow key={etf.ticker} className={!etf.active ? "opacity-60 bg-gray-50/50" : "hover:bg-primary/3 cursor-pointer"}>
                    <TableCell className="font-medium">
                      <EtfLink ticker={etf.ticker} className="font-semibold" />
                    </TableCell>
                    <TableCell>{etf.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                    <TableCell className="text-right font-mono">{etf.factorScores.composite.toFixed(1)}</TableCell>
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
                        <Badge variant="outline" className="bg-accent/10 text-accent border-accent/20">ACTIVE</Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-400 border-gray-200">OUT</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Row 4: Factor Heatmap ── */}
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
                  <TableRow key={etf.ticker} className="border-b border-gray-100 hover:bg-primary/3 cursor-pointer">
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

      <div className="text-center pb-8 pt-4">
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Methodology: allocations are constructed using a score-weighted approach with continuity constraints.
          Cash is dynamically adjusted by the regime composite. Regime components marked N/A require additional data
          (DXY for Dollar; IEF/TLT for Rates; external EPS feed for Earnings Revision).
        </p>
      </div>
    </div>
  );
}
