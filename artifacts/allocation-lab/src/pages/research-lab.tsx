import { useState, useEffect, type ReactNode } from "react";
import {
  useGetBacktest, useGetPricesStatus, useGetLatestResults, useGetUniverse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Loader2, Info, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, XCircle, ShieldAlert,
  FlaskConical, ExternalLink, Activity, Dices, NotebookPen, Save,
} from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenarioStressLab } from "@/components/research-lab/ScenarioStressLab";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { AttributionSummaryCard } from "@/components/archive/AttributionSummaryCard";

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

function MetricTooltip({ children, tip }: { children: ReactNode; tip: string }) {
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

function InfoTip({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground/50 inline-block cursor-default ml-1 shrink-0" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  );
}

function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "N/A";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

function pctPlain(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "N/A";
  return `${(v * 100).toFixed(digits)}%`;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleString("default", { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "numeric" });
}

function KpiCard({
  label, tip, value, valueClass, sub,
}: {
  label: string; tip: string; value: string; valueClass?: string; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          {label}
          <InfoTip tip={tip} />
        </p>
        <p className={`text-2xl font-bold mt-1 ${valueClass ?? "text-primary"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function EquityTooltip({
  active, payload, label, hasBenchmark, benchmarkTicker,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  hasBenchmark: boolean;
  benchmarkTicker: string | null;
}) {
  if (!active || !payload?.length) return null;
  const portfolio = payload.find((p) => p.dataKey === "portfolioIndex");
  const benchmark = payload.find((p) => p.dataKey === "benchmarkIndex");
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm px-3 py-2 text-xs space-y-1">
      <p className="text-muted-foreground">{label}</p>
      {portfolio && (
        <p className="font-semibold text-primary">Portfolio: {portfolio.value?.toFixed(2)}</p>
      )}
      {hasBenchmark && benchmark && (
        <p className="font-semibold text-amber-600">{benchmarkTicker}: {benchmark.value?.toFixed(2)}</p>
      )}
    </div>
  );
}

const GRADE_LABEL: Record<string, string> = {
  research_grade: "Research Grade",
  developmental: "Developmental",
  not_reliable: "Not Reliable",
};

const GRADE_CLASS: Record<string, string> = {
  research_grade: "bg-green-100 text-green-800 border-green-300",
  developmental: "bg-amber-100 text-amber-800 border-amber-300",
  not_reliable: "bg-red-100 text-red-800 border-red-300",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "warn") return <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
}

const NOTES_STORAGE_KEY = "allocation-lab.research-notes";

function ResearchNotesTab() {
  const [notes, setNotes] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(NOTES_STORAGE_KEY);
    if (stored) setNotes(stored);
  }, []);

  const handleSave = () => {
    window.localStorage.setItem(NOTES_STORAGE_KEY, notes);
    setSavedAt(new Date().toLocaleTimeString());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-primary" /> Research Notes
        </CardTitle>
        <CardDescription>
          Freeform notes on methodology, hypotheses, and observations. Saved locally to this browser only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Record research observations, hypotheses to test, or context for the next review cycle..."
          className="min-h-64 text-sm"
        />
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Save Notes
          </Button>
          {savedAt && <span className="text-xs text-muted-foreground">Saved at {savedAt}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResearchLab() {
  const { openSettings } = useSettingsDrawer();
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: universe, isLoading: loadingUniverse } = useGetUniverse();
  const { data: result, isLoading: loadingResult } = useGetLatestResults();

  const [benchmark, setBenchmark] = useState<string>("none");
  const [frequency, setFrequency] = useState<"monthly" | "quarterly">("monthly");
  const [timing, setTiming] = useState<"same_close" | "next_close" | "next_open">("next_close");
  const [txnCostBps, setTxnCostBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [turnoverCap, setTurnoverCap] = useState(100);
  const [cashYield, setCashYield] = useState(4);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const hasData = !!pricesStatus?.hasData;

  const scoreByTicker = new Map((result?.allocations ?? []).map((a) => [a.ticker, a.factorScores.composite]));
  const diag = result?.diagnostics;
  const regime = result?.regime;
  const hasInsufficient = (diag?.insufficientDataReasons.length ?? 0) > 0;

  const { data: bt, isLoading, error } = useGetBacktest(
    {
      sessionId: result?.sessionId,
      benchmark,
      rebalanceFrequency: frequency,
      executionTiming: timing,
      transactionCostBps: txnCostBps,
      slippageBps: slippageBps,
      maxTurnoverPerRebalance: turnoverCap / 100,
      cashYieldAnnual: cashYield / 100,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    },
    { query: { enabled: hasData && !!result?.sessionId } as any },
  );

  const dataMin = bt?.dataStartDate ?? undefined;
  const dataMax = bt?.dataEndDate ?? undefined;
  const hasRangeFilter = !!startDate || !!endDate;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="3 · Research Lab"
        title="Research Lab"
        description="ETF and factor exploration, market health detail, and a bias-resistant walk-forward backtest of the current allocation model. Diagnostics only appear once real price data and a backtest actually exist."
      />

      {loadingPrices ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !hasData ? (
        <EmptyState
          icon={FlaskConical}
          title="No price data yet"
          description="Upload or refresh price data in Settings before exploring ETFs, factors, or running a backtest."
          actionLabel="Open Settings"
          onAction={() => openSettings("data-sources")}
        />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">1 · Overview</TabsTrigger>
            <TabsTrigger value="explorer">2 · ETF &amp; Factor Explorer</TabsTrigger>
            <TabsTrigger value="backtester">3 · Backtesting</TabsTrigger>
            <TabsTrigger value="bias-audit">4 · Bias Audit</TabsTrigger>
            <TabsTrigger value="walk-forward">5 · Walk-Forward &amp; Sensitivity</TabsTrigger>
            <TabsTrigger value="scenario">6 · Scenario &amp; Stress Lab</TabsTrigger>
            <TabsTrigger value="notes">7 · Research Notes</TabsTrigger>
          </TabsList>

          {/* ── 2. ETF & Factor Explorer ── */}
          <TabsContent value="explorer" className="space-y-6 pt-4">
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
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No allocation run yet. Run a rebalance in Portfolio Lab.
                  </p>
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

          {/* ── 1. Overview / Research Status ── */}
          <TabsContent value="overview" className="space-y-6 pt-4">
            {!result || !regime || !diag ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No allocation run yet. Run a rebalance in Portfolio Lab to populate research status.
                </CardContent>
              </Card>
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

                {diag.trackingErrors.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Tracking Error</CardTitle>
                      <CardDescription>Portfolio deviation from auto-detected benchmark(s) in your price data.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {diag.trackingErrors.map((te) => (
                        <div key={te.benchmarkTicker}>
                          <p className="text-2xl font-bold text-primary">{(te.trackingError * 100).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground mt-1">vs {te.benchmarkTicker}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <AttributionSummaryCard />
              </>
            )}
          </TabsContent>

          {/* ── 3. Backtesting ── */}
          <TabsContent value="backtester" className="space-y-6 pt-4">
            {/* Config Panel */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Backtest Configuration</CardTitle>
                <CardDescription className="text-xs">
                  These settings directly affect realism — configure them deliberately rather than tuning to chase results.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 sm:gap-6">
                <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center">
                    Date Range
                    <InfoTip tip="Restrict the simulated window. Start date skips early rebalances (full history is still used for factor warmup); end date truncates price data to simulate an 'as of' date." />
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={startDate}
                      min={dataMin}
                      max={endDate || dataMax}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-8 text-sm w-[150px]"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={endDate}
                      min={startDate || dataMin}
                      max={dataMax}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-8 text-sm w-[150px]"
                    />
                    {hasRangeFilter && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground"
                        onClick={() => { setStartDate(""); setEndDate(""); }}
                      >
                        Reset to full history
                      </Button>
                    )}
                    {(dataMin || dataMax) && (
                      <span className="text-xs text-muted-foreground">
                        Available data: {dataMin ?? "—"} to {dataMax ?? "—"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center">
                    Rebalance Frequency
                    <InfoTip tip="How often the portfolio is re-scored and re-weighted." />
                  </Label>
                  <Select value={frequency} onValueChange={(v) => setFrequency(v as "monthly" | "quarterly")}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center">
                    Execution Timing
                    <InfoTip tip="When a rebalance decision actually gets filled. Same-close is unrealistic (assumes zero-latency execution); next-close and next-open impose a one-day implementation lag." />
                  </Label>
                  <Select value={timing} onValueChange={(v) => setTiming(v as typeof timing)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="same_close">Same Close (unrealistic)</SelectItem>
                      <SelectItem value="next_close">Next Close</SelectItem>
                      <SelectItem value="next_open">Next Open (approximated)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center">
                    Benchmark
                    <InfoTip tip="Buy-and-hold comparison ticker from the enabled universe." />
                  </Label>
                  <Select value={benchmark} onValueChange={setBenchmark}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {(bt?.availableBenchmarkTickers ?? []).map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center">Transaction Cost<InfoTip tip="Applied to turnover at each rebalance, in basis points." /></span>
                    <span className="text-gray-700 font-normal normal-case">{txnCostBps} bps</span>
                  </Label>
                  <Slider value={[txnCostBps]} min={0} max={100} step={1} onValueChange={(v) => setTxnCostBps(v[0])} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center">Slippage<InfoTip tip="Additional market-impact cost applied to turnover, in basis points." /></span>
                    <span className="text-gray-700 font-normal normal-case">{slippageBps} bps</span>
                  </Label>
                  <Slider value={[slippageBps]} min={0} max={100} step={1} onValueChange={(v) => setSlippageBps(v[0])} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center">Max Turnover / Rebalance<InfoTip tip="Caps how much the portfolio can change in a single rebalance, simulating implementation constraints." /></span>
                    <span className="text-gray-700 font-normal normal-case">{turnoverCap}%</span>
                  </Label>
                  <Slider value={[turnoverCap]} min={5} max={100} step={5} onValueChange={(v) => setTurnoverCap(v[0])} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center">Cash Yield (annual)<InfoTip tip="Interest earned on the uninvested cash sleeve, modeling cash drag realistically instead of assuming 0%." /></span>
                    <span className="text-gray-700 font-normal normal-case">{cashYield.toFixed(1)}%</span>
                  </Label>
                  <Slider value={[cashYield]} min={0} max={8} step={0.5} onValueChange={(v) => setCashYield(v[0])} />
                </div>
              </CardContent>
            </Card>

            {isLoading && (
              <div className="flex items-center gap-3 text-muted-foreground text-sm py-12 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Running backtest...
              </div>
            )}

            {error && !isLoading && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="py-6 text-center text-sm text-red-700">
                  Failed to load backtest results.
                </CardContent>
              </Card>
            )}

            {!isLoading && !error && bt && !bt.hasSufficientData && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="py-10 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-amber-800 mb-1">Not enough data to run a backtest yet.</p>
                  <p className="text-xs text-amber-700 max-w-md mx-auto">{bt.insufficientReason}</p>
                  <div className="flex items-center justify-center gap-4 mt-4 text-xs">
                    <Link href="/portfolio-lab" className="text-primary underline">Run a rebalance</Link>
                    <button onClick={() => openSettings("data-sources")} className="text-primary underline">Upload price data</button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isLoading && !error && bt && bt.hasSufficientData && (
              <>
                {bt.warnings.length > 0 && (
                  <div className="space-y-2">
                    {bt.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-sm text-muted-foreground">
                  Simulated window: <strong className="text-gray-800">{bt.startDate}</strong> to{" "}
                  <strong className="text-gray-800">{bt.endDate}</strong> ({bt.tradingDays} trading days)
                </p>

                {bt.benchmarkUnavailableReason && (
                  <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {bt.benchmarkUnavailableReason}
                  </div>
                )}

                {!bt.canAnnualize && (
                  <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Only {bt.tradingDays} trading day(s) of history — annualized return, volatility, and Sharpe ratio require at least 10 and are not shown to avoid misleading figures.
                  </div>
                )}

                {/* KPI Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard
                    label="Cumulative Return"
                    tip="Total compounded return of the portfolio over the full backtest window, net of transaction costs and slippage."
                    value={pct(bt.cumulativeReturn)}
                    valueClass={(bt.cumulativeReturn ?? 0) >= 0 ? "text-green-700" : "text-red-600"}
                  />
                  <KpiCard
                    label="Annualized Return"
                    tip="Cumulative return scaled to a 252-trading-day year (CAGR)."
                    value={bt.canAnnualize ? pct(bt.annualizedReturn) : "N/A"}
                    valueClass={bt.canAnnualize && (bt.annualizedReturn ?? 0) >= 0 ? "text-green-700" : bt.canAnnualize ? "text-red-600" : "text-gray-400"}
                    sub={!bt.canAnnualize ? "Sample too short" : undefined}
                  />
                  <KpiCard
                    label="Volatility"
                    tip="Annualized standard deviation of daily portfolio returns."
                    value={bt.canAnnualize ? pctPlain(bt.annualizedVolatility) : "N/A"}
                    valueClass="text-gray-700"
                    sub={!bt.canAnnualize ? "Sample too short" : undefined}
                  />
                  <KpiCard
                    label="Sharpe Ratio"
                    tip="Annualized return divided by annualized volatility, assuming a 0% risk-free rate."
                    value={bt.canAnnualize && bt.sharpeRatio !== null ? bt.sharpeRatio.toFixed(2) : "N/A"}
                    valueClass="text-gray-700"
                    sub={!bt.canAnnualize ? "Sample too short" : undefined}
                  />
                  <KpiCard
                    label="Max Drawdown"
                    tip="Largest peak-to-trough decline in portfolio value observed during the backtest."
                    value={pctPlain(bt.maxDrawdown)}
                    valueClass="text-red-600"
                  />
                  <KpiCard
                    label="Avg Turnover"
                    tip="Average one-way turnover per rebalance, after any turnover cap is applied."
                    value={bt.avgTurnover !== null ? pctPlain(bt.avgTurnover) : "N/A"}
                    valueClass="text-gray-700"
                    sub={bt.avgTurnover === null ? "Needs 1+ rebalance" : undefined}
                  />
                  <KpiCard
                    label="Total Txn Cost"
                    tip="Cumulative drag from transaction costs and slippage across all rebalances."
                    value={bt.totalTransactionCostPct !== null ? pctPlain(bt.totalTransactionCostPct, 2) : "N/A"}
                    valueClass="text-gray-700"
                  />
                  <KpiCard
                    label="Excess Return"
                    tip="Portfolio cumulative return minus benchmark cumulative return."
                    value={bt.benchmarkCumulativeReturn !== null && bt.cumulativeReturn !== null ? pct(bt.cumulativeReturn - bt.benchmarkCumulativeReturn) : "N/A"}
                    valueClass={
                      bt.benchmarkCumulativeReturn !== null && bt.cumulativeReturn !== null
                        ? bt.cumulativeReturn - bt.benchmarkCumulativeReturn >= 0 ? "text-green-700" : "text-red-600"
                        : "text-gray-400"
                    }
                    sub={bt.benchmarkTicker ?? "No benchmark selected"}
                  />
                </div>

                {/* Equity Curve */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Equity Curve</CardTitle>
                    <CardDescription className="text-xs">
                      Portfolio value indexed to 100 at backtest start{bt.benchmarkTicker ? ` · vs ${bt.benchmarkTicker}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={bt.equityCurve} margin={{ left: -12, right: 8, top: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={shortDate}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          interval={Math.floor(bt.equityCurve.length / 6)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          domain={["auto", "auto"]}
                          width={44}
                        />
                        <RechartTooltip content={<EquityTooltip hasBenchmark={!!bt.benchmarkTicker} benchmarkTicker={bt.benchmarkTicker} />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="portfolioIndex"
                          name="Portfolio"
                          stroke="#1B2F5B"
                          strokeWidth={1.75}
                          dot={false}
                          activeDot={{ r: 3, fill: "#1B2F5B" }}
                        />
                        {bt.benchmarkTicker && (
                          <Line
                            type="monotone"
                            dataKey="benchmarkIndex"
                            name={bt.benchmarkTicker}
                            stroke="#D97706"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            dot={false}
                            activeDot={{ r: 3, fill: "#D97706" }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Drawdown Chart */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Drawdown</CardTitle>
                    <CardDescription className="text-xs">Decline from running peak portfolio value</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={bt.equityCurve} margin={{ left: -12, right: 8, top: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={shortDate}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          interval={Math.floor(bt.equityCurve.length / 6)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                          width={44}
                        />
                        <RechartTooltip formatter={(v: number) => `${(v * 100).toFixed(2)}%`} labelFormatter={shortDate} />
                        <Line type="monotone" dataKey="drawdownPct" stroke="#DC2626" strokeWidth={1.25} dot={false} name="Drawdown" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Rebalance Log */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Rebalance Log</CardTitle>
                    <CardDescription className="text-xs">
                      Each row: the signal date (point-in-time computation), the execution date it actually traded at, and realized costs.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left pb-2 font-semibold pr-4">Signal Date</th>
                          <th className="text-left pb-2 font-semibold pr-4">Executed</th>
                          <th className="text-left pb-2 font-semibold pr-4">Lookback</th>
                          <th className="text-left pb-2 font-semibold pr-4">Regime</th>
                          <th className="text-left pb-2 font-semibold pr-4">Top Holdings</th>
                          <th className="text-right pb-2 font-semibold pr-4">Cash</th>
                          <th className="text-right pb-2 font-semibold pr-4">Turnover</th>
                          <th className="text-right pb-2 font-semibold">Txn Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bt.rebalanceLog.map((r) => (
                          <tr key={r.rebalanceDate} className="border-b border-gray-50">
                            <td className="py-2 pr-4 text-gray-700">{r.rebalanceDate}</td>
                            <td className="py-2 pr-4 text-gray-700">{r.executionDate}</td>
                            <td className="py-2 pr-4 text-gray-600 text-xs">{r.lookbackDays}d</td>
                            <td className="py-2 pr-4 text-gray-600 text-xs">{r.regimeLabel} ({r.regimeComposite.toFixed(0)})</td>
                            <td className="py-2 pr-4 text-gray-600 text-xs">
                              {r.topHoldings.length > 0 ? r.topHoldings.join(", ") : "Cash only"}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{pctPlain(r.cashWeight)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">
                              {pctPlain(r.turnoverApplied)}
                              {r.turnoverCapped && <span className="text-amber-600 font-semibold ml-1" title="Capped by max turnover constraint">*</span>}
                            </td>
                            <td className="py-2 text-right tabular-nums text-gray-600">{pctPlain(r.transactionCostPct, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {bt.rebalanceLog.some((r) => r.turnoverCapped) && (
                      <p className="text-xs text-muted-foreground mt-2">* turnover was capped by the max turnover per rebalance constraint.</p>
                    )}
                  </CardContent>
                </Card>

                {/* Monthly Returns */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Monthly Returns</CardTitle>
                    <CardDescription className="text-xs">
                      Compounded return by calendar month{bt.benchmarkTicker ? ` · portfolio vs ${bt.benchmarkTicker}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left pb-2 font-semibold pr-4">Month</th>
                          <th className="text-right pb-2 font-semibold pr-4">Portfolio</th>
                          {bt.benchmarkTicker && <th className="text-right pb-2 font-semibold">{bt.benchmarkTicker}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {bt.monthlyReturns.map((m) => (
                          <tr key={m.month} className="border-b border-gray-50">
                            <td className="py-1.5 pr-4 text-gray-700">{monthLabel(m.month)}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">
                              <span className={`inline-flex items-center gap-0.5 ${m.portfolioReturn >= 0 ? "text-green-700" : "text-red-600"}`}>
                                {m.portfolioReturn >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {pct(m.portfolioReturn, 2)}
                              </span>
                            </td>
                            {bt.benchmarkTicker && (
                              <td className="py-1.5 text-right tabular-nums">
                                {m.benchmarkReturn !== null ? (
                                  <span className={m.benchmarkReturn >= 0 ? "text-amber-700" : "text-red-600"}>
                                    {pct(m.benchmarkReturn, 2)}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                {/* Methodology footnote */}
                <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span>
                    <Badge variant="outline" className="mr-2 text-[10px] align-middle">Methodology</Badge>
                    {bt.methodologyNote}
                  </span>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── 4. Bias Audit / Integrity Checks ── */}
          <TabsContent value="bias-audit" className="space-y-6 pt-4">
            {!bt || !bt.hasSufficientData ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Run a backtest in the Backtesting tab first to compute the integrity audit.
                </CardContent>
              </Card>
            ) : (
              <Card className={bt.integrity.hardFail ? "border-red-300" : "border-l-4 border-l-primary/40"}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      Backtest Integrity Score
                      <InfoTip tip="A composite audit of whether this backtest is methodologically trustworthy — never labeled production-grade if any check fails." />
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold text-primary tabular-nums">{bt.integrity.score}/100</span>
                      <Badge variant="outline" className={GRADE_CLASS[bt.integrity.grade] ?? ""}>
                        {GRADE_LABEL[bt.integrity.grade] ?? bt.integrity.grade}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {bt.integrity.hardFail && (
                    <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      This configuration fails at least one integrity check. It is never labeled production-grade until every check passes.
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {bt.integrity.checklist.map((c) => (
                      <div key={c.id} className="flex items-start gap-2 rounded border border-gray-100 px-3 py-2">
                        <StatusIcon status={c.status} />
                        <div>
                          <p className="text-xs font-semibold text-gray-800">{c.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{c.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── 5. Walk-Forward & Sensitivity ── */}
          <TabsContent value="walk-forward" className="space-y-6 pt-4">
            {!bt || !bt.hasSufficientData ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Run a backtest in the Backtesting tab first to compute walk-forward folds and parameter sensitivity.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Walk-Forward Analysis</CardTitle>
                    <CardDescription className="text-xs">{bt.walkForward.note}</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left pb-2 font-semibold pr-4">Fold</th>
                          <th className="text-left pb-2 font-semibold pr-4">Window</th>
                          <th className="text-right pb-2 font-semibold pr-4">Days</th>
                          <th className="text-right pb-2 font-semibold pr-4">Rebalances</th>
                          <th className="text-right pb-2 font-semibold pr-4">Return</th>
                          <th className="text-right pb-2 font-semibold pr-4">Ann. Return</th>
                          <th className="text-right pb-2 font-semibold pr-4">Sharpe</th>
                          <th className="text-right pb-2 font-semibold">Max DD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bt.walkForward.folds.map((f) => (
                          <tr key={f.foldIndex} className="border-b border-gray-50">
                            <td className="py-2 pr-4 text-gray-700">{f.foldIndex}</td>
                            <td className="py-2 pr-4 text-gray-600 text-xs">{f.startDate} → {f.endDate}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{f.tradingDays}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{f.rebalanceCount}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              <span className={(f.cumulativeReturn ?? 0) >= 0 ? "text-green-700" : "text-red-600"}>{pct(f.cumulativeReturn)}</span>
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{f.annualizedReturn !== null ? pct(f.annualizedReturn) : "N/A"}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{f.sharpeRatio !== null ? f.sharpeRatio.toFixed(2) : "N/A"}</td>
                            <td className="py-2 text-right tabular-nums text-red-600">{pctPlain(f.maxDrawdown)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      Parameter Sensitivity
                      {bt.sensitivity.stabilityWarning && (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">Unstable</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">{bt.sensitivity.note}</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left pb-2 font-semibold pr-4">Frequency</th>
                          <th className="text-left pb-2 font-semibold pr-4">Timing</th>
                          <th className="text-right pb-2 font-semibold pr-4">Cost (bps)</th>
                          <th className="text-right pb-2 font-semibold pr-4">Cum. Return</th>
                          <th className="text-right pb-2 font-semibold">Sharpe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bt.sensitivity.runs.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="py-1.5 pr-4 text-gray-700 capitalize">{r.rebalanceFrequency}</td>
                            <td className="py-1.5 pr-4 text-gray-600 text-xs">{r.executionTiming.replace("_", " ")}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">{r.transactionCostBps}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">
                              {r.cumulativeReturn !== null ? (
                                <span className={r.cumulativeReturn >= 0 ? "text-green-700" : "text-red-600"}>{pct(r.cumulativeReturn)}</span>
                              ) : <span className="text-gray-400">N/A</span>}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{r.sharpeRatio !== null ? r.sharpeRatio.toFixed(2) : "N/A"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ── 6. Scenario & Stress Lab ── */}
          <TabsContent value="scenario" className="pt-4">
            <ScenarioStressLab />
          </TabsContent>

          {/* ── 7. Research Notes / Export ── */}
          <TabsContent value="notes" className="pt-4">
            <ResearchNotesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
