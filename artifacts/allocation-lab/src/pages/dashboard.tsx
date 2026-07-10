import { useMemo, useState } from "react";
import {
  useGetPricesStatus,
  useGetLatestResults,
  useListArchive,
  useGetArchiveEntry,
  useGetBacktest,
  useGetRiskModel,
  useGetTradeImplementationMeta,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Loader2, DollarSign, Activity, Eye, ShieldAlert,
  FileCheck2, Compass, ShieldCheck, Gauge, ArrowLeftRight, PieChart as PieChartIcon
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AttributionSummaryCard } from "@/components/archive/AttributionSummaryCard";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

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

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

// Colors for the donut chart
const COLORS = ["#1B2F5B", "#3B5284", "#6B84B5", "#9BB5E0", "#C1D2EE", "#E2E8F4"];

export default function Dashboard() {
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();

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
  const { data: riskModel } = useGetRiskModel(undefined, { query: { enabled: isViewingLatest } as any });

  const { data: archiveEntry, isLoading: loadingArchiveEntry } = useGetArchiveEntry(
    effectiveSessionId ?? 0,
    { query: { enabled: !!effectiveSessionId && !isViewingLatest } as any }
  );

  const { data: backtest } = useGetBacktest();
  const { data: tradeImplMeta } = useGetTradeImplementationMeta();

  const view = isViewingLatest ? latestResult : archiveEntry;
  const isLoading = isViewingLatest ? loadingLatest : loadingArchiveEntry;

  const hasData = pricesStatus?.hasData;

  const nextStep = useMemo(() => {
    if (!hasData) return { label: "Upload price data", desc: "Use the Upload action in the top status bar to load price history." };
    if (!latestResult) return { label: "Run Rebalance", desc: "Navigate to Portfolio Lab to run the systematic rebalance." };
    if (!backtest?.hasSufficientData) return { label: "Review Backtester", desc: "Validate the model historically before committee review in Research Lab." };
    return { label: "Open Investment Committee", desc: "Generate the committee pack in the Investment Committee section." };
  }, [hasData, latestResult, backtest]);

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

  const pieData = useMemo(() => {
    if (!view) return [];
    return view.allocations
      .filter((a) => a.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((a) => ({ name: a.ticker, value: a.weight, fullName: a.name }));
  }, [view]);

  const [drawerData, setDrawerData] = useState<{
    type: "etf" | "risk" | "none";
    title?: string;
    ticker?: string;
    content?: React.ReactNode;
  }>({ type: "none" });

  const handleOpenEtfDrawer = (ticker: string) => {
    const alloc = view?.allocations.find((a) => a.ticker === ticker);
    setDrawerData({
      type: "etf",
      title: `${ticker} Analysis`,
      ticker,
      content: (
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-sm mb-2">ETF Information</h4>
            <p className="text-muted-foreground">{alloc?.name || ticker}</p>
            <div className="flex gap-4 mt-4">
              <div>
                <p className="text-xs text-muted-foreground">Target Weight</p>
                <p className="font-medium">{alloc ? (alloc.weight * 100).toFixed(1) : 0}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Change</p>
                <p className={`font-medium ${alloc && alloc.change > 0 ? "text-green-600" : alloc && alloc.change < 0 ? "text-red-600" : ""}`}>
                  {alloc && alloc.change > 0 ? "+" : ""}{alloc ? (alloc.change * 100).toFixed(1) : 0}pp
                </p>
              </div>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-2">Rationale & Factor Scores</h4>
            <div className="p-4 bg-gray-50 border rounded-md text-sm text-gray-700">
              Factor breakdown and methodology rationale for this ETF's selection would be displayed here, based on the systematic strategy.
            </div>
          </div>
        </div>
      )
    });
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="1 · Dashboard"
        title="Dashboard"
        description="Cockpit overview of the systematic strategy. Review daily allocation, market regimes, and risk concentrations."
      />

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

      {loadingPrices || isLoading ? (
        <div className="space-y-6 mt-6">
          <Skeleton className="h-[120px] w-full" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[100px] w-full" />
          </div>
          <Skeleton className="h-[300px] w-full" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={Loader2}
          title="Data Upload Required"
          description="Price data must be uploaded before the dashboard can populate."
        />
      ) : !view ? (
        <EmptyState
          icon={Compass}
          title="No Allocation Run"
          description="A rebalance run must be executed to populate the dashboard metrics for this date range."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <MetricTooltip label="Market Health" explanation="Composite score combining multiple macro-economic indicators to determine the current market regime." />
                </p>
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border mt-2 ${getRegimeBadgeStyle(view.regime.label)}`}>
                  {view.regime.label}
                </div>
                <p className="text-2xl font-bold text-primary mt-2">{view.regime.composite.toFixed(1)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5 text-primary/60" /> Cash Allocation
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
                  <Activity className="h-3.5 w-3.5 text-primary/60" /> 
                  <MetricTooltip label="Active ETFs" explanation="Number of ETFs currently allocated a non-zero weight out of the total evaluated universe." />
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
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <PieChartIcon className="h-4 w-4" /> Recommended Allocation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className="w-full md:w-1/2 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          onClick={(data) => handleOpenEtfDrawer(data.name)}
                          className="cursor-pointer outline-none"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                          contentStyle={{ borderRadius: "8px", fontSize: "12px", border: "1px solid #e2e8f0" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <p className="text-center text-xs text-muted-foreground mt-2">Click a slice for details</p>
                  </div>
                  <div className="w-full md:w-1/2 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Movers</h4>
                    <div className="space-y-2">
                      {topChanges.map((etf) => (
                        <div 
                          key={etf.ticker} 
                          className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0 cursor-pointer hover:bg-gray-50 p-1 -mx-1 rounded"
                          onClick={() => handleOpenEtfDrawer(etf.ticker)}
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-primary hover:underline">{etf.ticker}</span>
                            <span className="text-[10px] text-muted-foreground truncate w-32">{etf.name}</span>
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
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600" /> 
                    <MetricTooltip label="Biggest Risks" explanation="Assets contributing the highest percentage to overall portfolio volatility." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {biggestRisks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No risk data available.</p>
                  ) : biggestRisks.map((r) => (
                    <div 
                      key={r.ticker} 
                      className="flex items-center justify-between text-sm p-1 -mx-1 rounded hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleOpenEtfDrawer(r.ticker)}
                    >
                      <span className="font-medium text-primary hover:underline">{r.ticker}</span>
                      <span className="text-xs tabular-nums text-gray-600">{r.riskContributionPct.toFixed(0)}% of risk</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {isViewingLatest && latestResult && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-primary/70" /> 
                      <MetricTooltip label="Watchlist" explanation="ETFs that narrowly missed inclusion in the current systematic model allocation." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {latestResult.watchlist.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No near-miss ETFs this cycle.</p>
                    ) : latestResult.watchlist.slice(0, 3).map((w) => (
                      <div 
                        key={w.ticker} 
                        className="flex items-center justify-between text-sm p-1 -mx-1 rounded hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleOpenEtfDrawer(w.ticker)}
                      >
                        <span className="font-medium text-primary hover:underline">{w.ticker}</span>
                        <span className="text-xs tabular-nums text-gray-600">{w.compositeScore.toFixed(0)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Deep dive sections using Accordion for progressive disclosure */}
          <Accordion type="single" collapsible className="w-full bg-white rounded-lg border shadow-sm">
            <AccordionItem value="diagnostics" className="border-b-0 px-4">
              <AccordionTrigger className="text-sm font-semibold text-primary hover:no-underline">
                Diagnostic & System Integrity
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-gray-50 rounded-md border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" /> 
                      <MetricTooltip label="Backtest Integrity" explanation="A score representing the robustness and reliability of historical data used for model validation." />
                    </p>
                    {backtest?.hasSufficientData ? (
                      <p className="text-sm font-medium text-gray-900 mt-2">
                        {backtest.integrity.score}/100 ({backtest.integrity.grade}){backtest.integrity.hardFail ? " · Hard Fail" : ""}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">Insufficient data</p>
                    )}
                  </div>
                  <div className="p-4 bg-gray-50 rounded-md border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Gauge className="h-3.5 w-3.5" /> 
                      <MetricTooltip label="Perf / Risk Summary" explanation="Expected annualized volatility and historical metrics based on the current allocation." />
                    </p>
                    {backtest?.hasSufficientData ? (
                      <p className="text-sm font-medium text-gray-900 mt-2 leading-tight">
                        {backtest.cumulativeReturn !== null ? `${(backtest.cumulativeReturn * 100).toFixed(1)}%` : "N/A"} cum.
                        <br />Sharpe {backtest.sharpeRatio !== null ? backtest.sharpeRatio.toFixed(2) : "N/A"}
                        <br />Vol {(view.diagnostics.expectedVolatility * 100).toFixed(1)}%
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">Vol {(view.diagnostics.expectedVolatility * 100).toFixed(1)}%</p>
                    )}
                  </div>
                  <div className="p-4 bg-gray-50 rounded-md border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" /> 
                      <MetricTooltip label="Risk Model Pro" explanation="Detailed risk factors, concentration risk, and diversification metrics." />
                    </p>
                    {!isViewingLatest ? (
                      <p className="text-sm text-muted-foreground mt-2">Latest session only</p>
                    ) : riskModel?.hasSufficientData ? (
                      <div className="text-sm font-medium text-gray-900 mt-2 leading-tight">
                        Ann. vol {(riskModel.annualizedVolatility! * 100).toFixed(1)}%
                        <br />Concentration {riskModel.concentrationRisk!.toFixed(2)}
                        <br />Div. score {riskModel.diversificationScore!.toFixed(0)}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">
                        {riskModel?.insufficientReason ?? "Loading…"}
                      </p>
                    )}
                  </div>
                  <div className="p-4 bg-gray-50 rounded-md border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ArrowLeftRight className="h-3.5 w-3.5" /> 
                      <MetricTooltip label="Implementation" explanation="Status of trade lists and execution assumptions for the current allocation." />
                    </p>
                    {tradeImplMeta?.ready ? (
                      <p className="text-sm font-medium text-gray-900 mt-2">
                        Ready · {tradeImplMeta.activeEtfCount} active ETFs
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">
                        {tradeImplMeta?.reason ?? "Loading…"}
                      </p>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      <DetailDrawer 
        open={drawerData.type !== "none"} 
        onOpenChange={(open) => !open && setDrawerData({ type: "none" })}
        title={drawerData.title}
        description="Detailed analysis based on the current systematic run."
      >
        {drawerData.content}
      </DetailDrawer>

    </div>
  );
}
