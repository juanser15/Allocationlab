import { useState, type ReactNode } from "react";
import { useGetBacktest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Loader2, Info, AlertTriangle, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Link } from "wouter";

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

export default function Backtesting() {
  const [benchmark, setBenchmark] = useState<string>("none");
  const { data: bt, isLoading, error } = useGetBacktest(
    benchmark !== "none" ? { benchmark } : undefined
  );

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Backtesting</h1>
        <p className="text-muted-foreground mt-1">
          Historical performance of the current allocation model over available price history.
        </p>
      </div>

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
              <Link href="/" className="text-primary underline">Run the pipeline</Link>
              <Link href="/portfolio" className="text-primary underline">Upload price data</Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && bt && bt.hasSufficientData && (
        <>
          {/* Header status + benchmark selector */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Backtest window: <strong className="text-gray-800">{bt.startDate}</strong> to{" "}
              <strong className="text-gray-800">{bt.endDate}</strong> ({bt.tradingDays} trading days)
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Benchmark</span>
              <Select value={benchmark} onValueChange={setBenchmark}>
                <SelectTrigger className="w-40 h-8 text-sm">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {bt.availableBenchmarkTickers.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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
              tip="Total compounded return of the portfolio over the full backtest window."
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
              tip="Average one-way turnover per rebalance: half the sum of absolute weight changes across all tickers."
              value={bt.avgTurnover !== null ? pctPlain(bt.avgTurnover) : "N/A"}
              valueClass="text-gray-700"
              sub={bt.avgTurnover === null ? "Needs 2+ rebalances" : undefined}
            />
            <KpiCard
              label="Benchmark Return"
              tip="Cumulative return of the selected benchmark ETF, buy-and-hold, over the same window."
              value={bt.benchmarkCumulativeReturn !== null ? pct(bt.benchmarkCumulativeReturn) : "N/A"}
              valueClass={bt.benchmarkCumulativeReturn !== null && bt.benchmarkCumulativeReturn >= 0 ? "text-amber-600" : bt.benchmarkCumulativeReturn !== null ? "text-red-600" : "text-gray-400"}
              sub={bt.benchmarkTicker ?? "No benchmark selected"}
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

          {/* Contribution Summary */}
          <Card className="border-l-4 border-l-primary/40 bg-primary/3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4 text-primary/70" />
                Contribution Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {bt.narrative ? (
                <p className="text-sm text-gray-800 leading-relaxed">{bt.narrative}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not enough priced rebalance periods to summarize contribution.</p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="text-left pb-2 font-semibold pr-4">Period</th>
                      <th className="text-left pb-2 font-semibold pr-4">Regime</th>
                      <th className="text-left pb-2 font-semibold pr-4">Top Holdings</th>
                      <th className="text-right pb-2 font-semibold pr-4">Return</th>
                      <th className="text-right pb-2 font-semibold pr-4">Contribution</th>
                      <th className="text-right pb-2 font-semibold">Turnover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const priced = bt.periods.filter((p) => p.tradingDays > 0);
                      const unpriced = bt.periods.filter((p) => p.tradingDays === 0);
                      const rows: ReactNode[] = priced.map((p) => (
                        <tr key={p.sessionId} className="border-b border-gray-50">
                          <td className="py-2 pr-4 text-gray-700">
                            {p.label && <span className="font-medium">{p.label}</span>}
                            {!p.label && <span>{p.startDate} → {p.endDate}</span>}
                          </td>
                          <td className="py-2 pr-4 text-gray-600 text-xs">{p.regimeLabel}</td>
                          <td className="py-2 pr-4 text-gray-600 text-xs">
                            {p.topHoldings.length > 0 ? p.topHoldings.join(", ") : "Cash only"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {p.periodReturn !== null ? (
                              <span className={p.periodReturn >= 0 ? "text-green-700" : "text-red-600"}>
                                {pct(p.periodReturn)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {p.contributionPct !== null ? (
                              <span className={`inline-flex items-center gap-0.5 font-semibold ${p.contributionPct >= 0 ? "text-green-700" : "text-red-600"}`}>
                                {p.contributionPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {pct(p.contributionPct)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-600">
                            {p.turnover !== null ? pctPlain(p.turnover) : "—"}
                          </td>
                        </tr>
                      ));
                      if (unpriced.length > 0) {
                        rows.push(
                          <tr key="unpriced-summary" className="border-b border-gray-50">
                            <td colSpan={6} className="py-2 text-xs text-gray-400 italic">
                              {unpriced.length} rebalance{unpriced.length > 1 ? "s" : ""} on{" "}
                              {Array.from(new Set(unpriced.map((p) => p.startDate))).join(", ")} had no subsequent price
                              data and could not be scored — only the most recent allocation carries forward.
                            </td>
                          </tr>
                        );
                      }
                      return rows;
                    })()}
                  </tbody>
                </table>
              </div>
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
    </div>
  );
}
