import { useState } from "react";
import { useGetBacktest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Loader2, Info, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, XCircle, MinusCircle, ShieldAlert,
} from "lucide-react";
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

export default function Backtesting({ embedded = false }: { embedded?: boolean } = {}) {
  const [benchmark, setBenchmark] = useState<string>("none");
  const [frequency, setFrequency] = useState<"monthly" | "quarterly">("monthly");
  const [timing, setTiming] = useState<"same_close" | "next_close" | "next_open">("next_close");
  const [txnCostBps, setTxnCostBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [turnoverCap, setTurnoverCap] = useState(100);
  const [cashYield, setCashYield] = useState(4);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const { data: bt, isLoading, error } = useGetBacktest({
    ...(benchmark !== "none" ? { benchmark } : {}),
    rebalanceFrequency: frequency,
    executionTiming: timing,
    transactionCostBps: txnCostBps,
    slippageBps: slippageBps,
    maxTurnoverPerRebalance: turnoverCap / 100,
    cashYieldAnnual: cashYield / 100,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  });

  const dataMin = bt?.dataStartDate ?? undefined;
  const dataMax = bt?.dataEndDate ?? undefined;
  const hasRangeFilter = !!startDate || !!endDate;

  return (
    <div className={embedded ? "pt-4 space-y-6" : "p-4 sm:p-8 max-w-6xl mx-auto space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">Backtesting</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Bias-resistant, point-in-time walk-forward backtest of the current allocation model. Signals are computed
            only from data strictly before each rebalance date.
          </p>
        </div>
      )}

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
              <Link href="/" className="text-primary underline">Run the pipeline</Link>
              <Link href="/configuration" className="text-primary underline">Upload price data</Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && bt && bt.hasSufficientData && (
        <>
          {/* Integrity Score */}
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

          {/* Warnings */}
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

          {/* Header status */}
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

          {/* Walk-Forward */}
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

          {/* Sensitivity */}
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
