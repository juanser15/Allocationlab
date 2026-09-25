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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DollarSign, Activity, ShieldAlert, ShieldCheck, Gauge,
  ArrowLeftRight, TrendingUp, TrendingDown, Compass,
} from "lucide-react";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS = [
  "#1B2F5B", "#3B5284", "#6B84B5", "#9BB5E0", "#C1D2EE",
  "#E2E8F4", "#A8BFD0", "#7A9AB0", "#4E6E8A", "#2D4E70",
];

function getRegimeBadgeStyle(label: string) {
  switch (label) {
    case "Risk-On":      return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral":      return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious":     return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off":     return "bg-red-100 text-red-800 border-red-200";
    default:             return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

export default function Dashboard() {
  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: archiveList } = useListArchive({ fromDate: "2019-01-01", toDate: today });
  const entries = archiveList?.entries ?? [];

  const [selectedSessionId, setSelectedSessionId] = useState<number | "latest" | null>(null);
  const effectiveSessionId =
    selectedSessionId === "latest" || selectedSessionId === null
      ? (entries[0]?.sessionId ?? null)
      : selectedSessionId;

  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();
  const isViewingLatest =
    effectiveSessionId === null || effectiveSessionId === latestResult?.sessionId;

  const { data: riskModel } = useGetRiskModel(undefined, {
    query: { enabled: isViewingLatest } as any,
  });
  const { data: archiveEntry, isLoading: loadingArchiveEntry } = useGetArchiveEntry(
    effectiveSessionId ?? 0,
    { query: { enabled: !!effectiveSessionId && !isViewingLatest } as any }
  );
  const { data: backtest } = useGetBacktest(
    { sessionId: effectiveSessionId ?? latestResult?.sessionId },
    { query: { enabled: !!(effectiveSessionId ?? latestResult?.sessionId) } as any },
  );
  const { data: tradeImplMeta } = useGetTradeImplementationMeta();

  const view = isViewingLatest ? latestResult : archiveEntry;
  const isLoading = isViewingLatest ? loadingLatest : loadingArchiveEntry;
  const hasData = !!pricesStatus?.hasData;

  const topChanges = useMemo(() => {
    if (!view) return [];
    return view.allocations
      .slice()
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 6);
  }, [view]);

  const biggestRisks = useMemo(() => {
    if (!view) return [];
    return view.diagnostics.riskContributions
      .slice()
      .sort((a, b) => b.riskContributionPct - a.riskContributionPct)
      .slice(0, 4);
  }, [view]);

  const pieData = useMemo(() => {
    if (!view) return [];
    return view.allocations
      .filter((a) => a.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((a) => ({ name: a.ticker, value: a.weight, fullName: a.name }));
  }, [view]);

  const [drawerData, setDrawerData] = useState<{
    open: boolean;
    title?: string;
    content?: React.ReactNode;
  }>({ open: false });

  const handleOpenEtfDrawer = (ticker: string) => {
    const alloc = view?.allocations.find((a) => a.ticker === ticker);
    setDrawerData({
      open: true,
      title: `${ticker} — ${alloc?.name ?? ticker}`,
      content: (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Target Weight</p>
              <p className="text-2xl font-bold text-primary mt-1">
                {alloc ? (alloc.weight * 100).toFixed(1) : 0}%
              </p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Change vs Prior</p>
              <p
                className={`text-2xl font-bold mt-1 ${
                  alloc && alloc.change > 0
                    ? "text-green-600"
                    : alloc && alloc.change < 0
                    ? "text-red-600"
                    : "text-gray-400"
                }`}
              >
                {alloc && alloc.change > 0 ? "+" : ""}
                {alloc ? (alloc.change * 100).toFixed(1) : 0}pp
              </p>
            </div>
          </div>
          <div className="p-4 bg-gray-50 border rounded-lg text-sm text-gray-600 leading-relaxed">
            Factor breakdown and methodology rationale for this ETF's selection are available in Portfolio Lab → Factors & Regimes.
          </div>
        </div>
      ),
    });
  };

  const sessionEntry = entries.find((e) => e.sessionId === effectiveSessionId);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">

      {/* ── Header + As Of selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            1 · Dashboard
          </p>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cockpit overview of the current systematic allocation.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Review session</span>
          <Select
            value={selectedSessionId === null ? "latest" : String(selectedSessionId)}
            onValueChange={(v) =>
              setSelectedSessionId(v === "latest" ? "latest" : Number(v))
            }
          >
            <SelectTrigger className="h-9 text-xs w-[250px] bg-white shadow-sm">
              <SelectValue placeholder="Latest session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest (current)</SelectItem>
              {entries.map((e) => (
                <SelectItem key={e.sessionId} value={String(e.sessionId)}>
                  {new Date(e.runAt).toLocaleDateString()} · {e.regimeLabel}
                  {e.label ? ` · ${e.label}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Loading / empty states ── */}
      {loadingPrices || isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={Compass}
          title="Data Upload Required"
          description="Upload price data in Settings before the dashboard can populate."
        />
      ) : !view ? (
        <EmptyState
          icon={Compass}
          title="No Allocation Run Yet"
          description="Run the optimizer in Portfolio Lab to populate the dashboard."
        />
      ) : (
        <>
          {/* ── Regime hero banner ── */}
          <div className="rounded-xl border bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-white px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
                  Market Regime
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  {view.regime.label === "Risk-On" || view.regime.label === "Constructive" ? (
                    <TrendingUp className="h-5 w-5 text-green-400 shrink-0" />
                  ) : view.regime.label === "Risk-Off" ? (
                    <TrendingDown className="h-5 w-5 text-red-400 shrink-0" />
                  ) : (
                    <Activity className="h-5 w-5 text-amber-400 shrink-0" />
                  )}
                  <span className="text-xl font-bold tracking-tight">
                    {view.regime.label}
                  </span>
                  <span className="text-2xl font-bold text-white/90">
                    {view.regime.composite.toFixed(1)}
                  </span>
                  <span className="text-xs text-white/40">/100</span>
                </div>
              </div>

              <div className="hidden sm:block w-px h-10 bg-white/15" />

              {(
                [
                  { label: "Trend",      value: view.regime.trend },
                  { label: "Breadth",    value: view.regime.breadth },
                  { label: "Volatility", value: view.regime.volatility },
                  { label: "Liquidity",  value: view.regime.liquidity },
                ] as const
              ).map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] text-white/50 uppercase tracking-wider">{label}</p>
                  <p className="text-base font-bold mt-0.5">{(value as number).toFixed(0)}</p>
                  <div className="mt-1 h-1 w-12 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        (value as number) >= 65
                          ? "bg-green-400"
                          : (value as number) >= 45
                          ? "bg-amber-400"
                          : "bg-red-400"
                      }`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              ))}

              <div className="ml-auto text-right hidden md:block">
                <p className="text-[10px] text-white/50 uppercase tracking-wider">Session</p>
                <p className="text-sm font-semibold mt-0.5">
                  {sessionEntry
                    ? new Date(sessionEntry.runAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "Latest"}
                </p>
              </div>
            </div>
          </div>

          {/* ── KPI strip ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-primary/30">
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-primary/50" />
                  <MetricTooltip label="Cash" explanation="Target cash weight in the current systematic allocation." />
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1.5">
                  {(view.cashWeight * 100).toFixed(1)}%
                </p>
                <p
                  className={`text-xs mt-1 font-medium ${
                    view.cashChange > 0
                      ? "text-green-600"
                      : view.cashChange < 0
                      ? "text-red-500"
                      : "text-gray-400"
                  }`}
                >
                  {view.cashChange > 0 ? "+" : ""}
                  {(view.cashChange * 100).toFixed(1)}pp vs prior
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-primary/30">
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3 text-primary/50" />
                  <MetricTooltip label="Active ETFs" explanation="ETFs currently allocated a non-zero weight out of the full evaluated universe." />
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1.5">
                  {view.activeEtfCount}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  of {view.allocations.length} evaluated
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-primary/30">
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Gauge className="h-3 w-3 text-primary/50" />
                  <MetricTooltip label="Expected Vol" explanation="Annualized portfolio volatility estimated from the current covariance matrix." />
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1.5">
                  {(view.diagnostics.expectedVolatility * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">Ann. volatility</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-primary/30">
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-primary/50" />
                  <MetricTooltip label="Backtest Sharpe" explanation="Historical risk-adjusted return from the point-in-time backtest. Run Validate in Portfolio Lab to unlock." />
                </p>
                {backtest?.hasSufficientData && backtest.sharpeRatio !== null ? (
                  <>
                    <p className="text-2xl font-bold text-gray-900 mt-1.5">
                      {backtest.sharpeRatio.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Integrity {backtest.integrity.score}/100
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-gray-300 mt-1.5">—</p>
                    <p className="text-xs text-muted-foreground mt-1">Run 2 · Validate</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Main content: allocation + movers/watchlist ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Allocation card */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Recommended Allocation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row items-start gap-4">
                  {/* Donut */}
                  <div className="w-full md:w-[200px] h-52 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={72}
                          paddingAngle={2}
                          dataKey="value"
                          onClick={(d) => handleOpenEtfDrawer(d.name)}
                          className="cursor-pointer outline-none"
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                          contentStyle={{
                            borderRadius: "8px",
                            fontSize: "11px",
                            border: "1px solid #e2e8f0",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Legend */}
                  <div className="flex-1 w-full space-y-1.5 py-1">
                    {pieData.slice(0, 9).map((entry, i) => (
                      <button
                        key={entry.name}
                        className="w-full flex items-center gap-2.5 text-left hover:bg-gray-50 px-2 py-1 -mx-2 rounded transition-colors"
                        onClick={() => handleOpenEtfDrawer(entry.name)}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="text-xs font-semibold text-primary w-12 shrink-0">
                          {entry.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-1 truncate">
                          {entry.fullName}
                        </span>
                        <span className="text-xs font-medium tabular-nums text-gray-700 shrink-0">
                          {(entry.value * 100).toFixed(1)}%
                        </span>
                      </button>
                    ))}
                    {pieData.length > 9 && (
                      <p className="text-[10px] text-muted-foreground px-2">
                        +{pieData.length - 9} more positions
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Right column: Top movers + watchlist */}
            <div className="flex flex-col gap-4">
              <Card className="flex-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Top Movers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {topChanges.map((etf) => (
                    <button
                      key={etf.ticker}
                      className="w-full flex items-center justify-between text-sm hover:bg-gray-50 px-1.5 py-1.5 -mx-1.5 rounded transition-colors"
                      onClick={() => handleOpenEtfDrawer(etf.ticker)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-primary text-xs shrink-0">
                          {etf.ticker}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {(etf.weight * 100).toFixed(1)}%
                        </span>
                      </div>
                      <span
                        className={`text-xs font-semibold tabular-nums shrink-0 ${
                          etf.change > 0
                            ? "text-green-600"
                            : etf.change < 0
                            ? "text-red-500"
                            : "text-gray-400"
                        }`}
                      >
                        {etf.change > 0 ? "+" : ""}
                        {(etf.change * 100).toFixed(1)}pp
                      </span>
                    </button>
                  ))}
                  {topChanges.length === 0 && (
                    <p className="text-xs text-muted-foreground">No allocation data.</p>
                  )}
                </CardContent>
              </Card>

              {isViewingLatest && latestResult && latestResult.watchlist.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-1">
                      <MetricTooltip
                        label="Near-Miss Watchlist"
                        explanation="ETFs that narrowly missed inclusion in the current systematic allocation."
                      />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {latestResult.watchlist.slice(0, 4).map((w) => (
                      <button
                        key={w.ticker}
                        className="w-full flex items-center justify-between hover:bg-gray-50 px-1.5 py-1 -mx-1.5 rounded transition-colors"
                        onClick={() => handleOpenEtfDrawer(w.ticker)}
                      >
                        <span className="text-xs font-semibold text-primary">
                          {w.ticker}
                        </span>
                        <span className="text-[10px] tabular-nums text-gray-500">
                          Score {w.compositeScore.toFixed(0)}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* ── Bottom row: Risk · Performance · Implementation ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Risk contributions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  <MetricTooltip
                    label="Biggest Risks"
                    explanation="Assets contributing the highest percentage to overall portfolio volatility."
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {biggestRisks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No risk data available.</p>
                ) : (
                  biggestRisks.map((r) => (
                    <button
                      key={r.ticker}
                      className="w-full flex items-center gap-3 hover:bg-gray-50 px-1 py-0.5 -mx-1 rounded transition-colors"
                      onClick={() => handleOpenEtfDrawer(r.ticker)}
                    >
                      <span className="text-xs font-semibold text-primary w-10 shrink-0 text-left">
                        {r.ticker}
                      </span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${Math.min(100, r.riskContributionPct)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-500 shrink-0 w-8 text-right">
                        {r.riskContributionPct.toFixed(0)}%
                      </span>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Performance summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-primary/60" />
                  Performance Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {backtest?.hasSufficientData ? (
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      {
                        label: "CAGR",
                        value:
                          backtest.canAnnualize && backtest.annualizedReturn !== null
                            ? `${backtest.annualizedReturn >= 0 ? "+" : ""}${(backtest.annualizedReturn * 100).toFixed(1)}%`
                            : "N/A",
                        green: backtest.annualizedReturn !== null && backtest.annualizedReturn > 0,
                      },
                      {
                        label: "Sharpe",
                        value:
                          backtest.sharpeRatio !== null
                            ? backtest.sharpeRatio.toFixed(2)
                            : "N/A",
                        green: backtest.sharpeRatio !== null && backtest.sharpeRatio > 0,
                      },
                      {
                        label: "Max DD",
                        value:
                          backtest.maxDrawdown !== null
                            ? `${(backtest.maxDrawdown * 100).toFixed(1)}%`
                            : "N/A",
                        green: false,
                        red: true,
                      },
                      {
                        label: "Integrity",
                        value: `${backtest.integrity.score}/100`,
                        green: backtest.integrity.score >= 70,
                      },
                    ].map(({ label, value, green, red }) => (
                      <div key={label}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {label}
                        </p>
                        <p
                          className={`text-xl font-bold mt-0.5 ${
                            red
                              ? "text-red-600"
                              : green
                              ? "text-green-600"
                              : "text-gray-900"
                          }`}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Run <span className="font-semibold">2 · Validate</span> in Portfolio
                    Lab to see historical performance metrics.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Implementation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <ArrowLeftRight className="h-4 w-4 text-primary/60" />
                  Implementation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tradeImplMeta?.ready ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500 shrink-0" />
                      <span className="text-sm font-semibold text-green-700">
                        Ready to trade
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tradeImplMeta.activeEtfCount} active ETFs · Trade list generated
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-gray-300 shrink-0" />
                      <span className="text-sm text-gray-500">Not ready</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tradeImplMeta?.reason ??
                        "Run the optimizer to generate a trade list."}
                    </p>
                  </>
                )}

                {isViewingLatest && riskModel?.hasSufficientData && (
                  <div className="pt-3 border-t grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Div. score</p>
                      <p className="font-semibold text-gray-700">
                        {riskModel.diversificationScore?.toFixed(0) ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Concentration</p>
                      <p className="font-semibold text-gray-700">
                        {riskModel.concentrationRisk?.toFixed(2) ?? "—"}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <DetailDrawer
        open={drawerData.open}
        onOpenChange={(open) => !open && setDrawerData({ open: false })}
        title={drawerData.title}
        description="From the current systematic run."
      >
        {drawerData.content}
      </DetailDrawer>
    </div>
  );
}
