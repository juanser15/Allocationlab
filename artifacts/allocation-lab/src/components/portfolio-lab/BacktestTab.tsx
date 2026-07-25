import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { FlaskConical, CheckCircle2, XCircle, ShieldAlert, Info, Loader2 } from "lucide-react";
import type { BacktestResult } from "@workspace/api-client-react";

interface Props {
  bt: BacktestResult | undefined;
  loading: boolean;
  hasData: boolean;
  hasRun: boolean;
  validationRequested: boolean;
  onRunValidation: () => void;
  benchmark: string; setBenchmark: (v: string) => void;
  frequency: "monthly" | "quarterly"; setFrequency: (v: "monthly" | "quarterly") => void;
  timing: "same_close" | "next_close" | "next_open"; setTiming: (v: "same_close" | "next_close" | "next_open") => void;
  txnCostBps: number; setTxnCostBps: (v: number) => void;
  slippageBps: number; setSlippageBps: (v: number) => void;
  cashYield: number; setCashYield: (v: number) => void;
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
}

function pct(v: number | null | undefined, d = 1) {
  if (v === null || v === undefined) return "N/A";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
}
function pctPlain(v: number | null | undefined, d = 1) {
  if (v === null || v === undefined) return "N/A";
  return `${(v * 100).toFixed(d)}%`;
}
function num2(v: number | null | undefined) {
  if (v === null || v === undefined) return "N/A";
  return v.toFixed(2);
}

const GRADE_CLASS: Record<string, string> = {
  research_grade: "bg-green-100 text-green-800 border-green-300",
  developmental: "bg-amber-100 text-amber-800 border-amber-300",
  not_reliable: "bg-red-100 text-red-800 border-red-300",
};
const GRADE_LABEL: Record<string, string> = {
  research_grade: "Research Grade",
  developmental: "Developmental",
  not_reliable: "Not Reliable",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "warn") return <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
}

export function BacktestTab(props: Props) {
  const {
    bt, loading, hasData, hasRun, validationRequested, onRunValidation,
    benchmark, setBenchmark, frequency, setFrequency, timing, setTiming,
    txnCostBps, setTxnCostBps, slippageBps, setSlippageBps,
    cashYield, setCashYield, startDate, setStartDate, endDate, setEndDate,
  } = props;

  const [metricDetail, setMetricDetail] = useState<{ title: string; content: string } | null>(null);

  if (!hasData) return <EmptyState icon={FlaskConical} title="Valid price history is required." description="Upload price data to configure and run the backtester." />;
  if (!hasRun) return <EmptyState icon={FlaskConical} title="Run Optimizer to generate model allocations." description="The backtester simulates the official portfolio process historically. An optimizer run is required first." />;

  const hasBt = !!bt && bt.hasSufficientData;

  return (
    <div className="space-y-6">
      <DetailDrawer
        open={!!metricDetail}
        onOpenChange={(o) => !o && setMetricDetail(null)}
        title={metricDetail?.title ?? ""}
      >
        {metricDetail && <p className="text-sm text-gray-700 leading-relaxed">{metricDetail.content}</p>}
      </DetailDrawer>

      {/* Configuration panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Validation Configuration</CardTitle>
          <CardDescription>
            Point-in-time backtester: at each rebalance date, all factors, regime, models, and constraints are recomputed using only data available up to that date. No look-ahead bias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Benchmark</Label>
              <Select value={benchmark} onValueChange={setBenchmark}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Benchmark</SelectItem>
                  {(bt?.availableBenchmarkTickers ?? ["SPY", "AGG", "QQQ"]).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Rebalance Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Execution Timing</Label>
              <Select value={timing} onValueChange={(v) => setTiming(v as typeof timing)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="next_close">Next Close</SelectItem>
                  <SelectItem value="next_open">Next Open</SelectItem>
                  <SelectItem value="same_close">Same Close</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Transaction Costs (bps): {txnCostBps}</Label>
              <Slider min={0} max={50} step={1} value={[txnCostBps]} onValueChange={([v]) => setTxnCostBps(v)} className="mt-2" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Slippage (bps): {slippageBps}</Label>
              <Slider min={0} max={30} step={1} value={[slippageBps]} onValueChange={([v]) => setSlippageBps(v)} className="mt-2" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Cash Yield (% ann.): {cashYield.toFixed(1)}%</Label>
              <Slider min={0} max={10} step={0.25} value={[cashYield]} onValueChange={([v]) => setCashYield(v)} className="mt-2" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Start Date (optional)</Label>
              <Input type="date" className="h-8 text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">End Date (optional)</Label>
              <Input type="date" className="h-8 text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t">
            <Button size="sm" onClick={onRunValidation} disabled={loading} className="gap-1.5">
              {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running Validation…</> : <><FlaskConical className="h-3.5 w-3.5" /> Run Validation</>}
            </Button>
            {hasBt && bt && (
              <span className="text-xs text-muted-foreground">
                Data: {bt.dataStartDate ?? "—"} → {bt.dataEndDate ?? "—"} · {bt.tradingDays} trading days
              </span>
            )}
          </div>

          {!validationRequested && (
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
              <span>
                <strong>Validation has not been run.</strong> Configure assumptions above and select Run Validation.
                The backtester will simulate the full portfolio process historically, preventing look-ahead bias, data leakage, and execution timing errors.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results — only shown after validation */}
      {validationRequested && loading && (
        <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Running validation — computing factors, regimes, models, and ensemble allocation at each historical rebalance date…</p>
        </div>
      )}

      {validationRequested && !loading && bt && !bt.hasSufficientData && (
        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{bt.insufficientReason ?? "Insufficient data for backtesting."}</span>
        </div>
      )}

      {hasBt && bt && (
        <Tabs defaultValue="summary">
          <TabsList className="flex-wrap h-auto gap-0.5 bg-gray-100/70 p-1">
            <TabsTrigger value="summary" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Summary</TabsTrigger>
            <TabsTrigger value="equity" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Equity Curve</TabsTrigger>
            <TabsTrigger value="monthly" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Monthly Returns</TabsTrigger>
            <TabsTrigger value="walkforward" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Walk-Forward</TabsTrigger>
            <TabsTrigger value="integrity" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Bias Audit</TabsTrigger>
          </TabsList>

          {/* Summary */}
          <TabsContent value="summary" className="pt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {[
                { label: "CAGR (net)", value: bt.canAnnualize ? pct(bt.annualizedReturn) : "N/A (short)", tip: "Compound Annual Growth Rate net of transaction costs, slippage, and cash drag." },
                { label: "Ann. Volatility", value: bt.canAnnualize ? pctPlain(bt.annualizedVolatility) : "N/A", tip: "Annualized standard deviation of daily net returns." },
                { label: "Sharpe Ratio", value: bt.canAnnualize ? num2(bt.sharpeRatio) : "N/A", tip: "Risk-adjusted return. (CAGR − risk-free) / Ann. Volatility. Higher is better." },
                { label: "Max Drawdown", value: pctPlain(bt.maxDrawdown), tip: "Largest peak-to-trough decline in portfolio value over the full backtest period." },
                { label: "Avg Turnover", value: bt.avgTurnover !== null ? pctPlain(bt.avgTurnover) : "N/A", tip: "Average one-way portfolio turnover per rebalance period." },
              ].map(({ label, value, tip }) => (
                <button
                  key={label}
                  className="border rounded-md p-3 text-left hover:border-primary/40 transition-colors"
                  onClick={() => setMetricDetail({ title: label, content: tip })}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
                </button>
              ))}
            </div>

            {bt.benchmarkTicker && (
              <Card className="border-blue-100">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">vs. {bt.benchmarkTicker}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-6 text-sm flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground">Benchmark CAGR</p>
                      <p className="font-semibold">{bt.canAnnualize ? pct(bt.benchmarkAnnualizedReturn) : "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Excess Return (CAGR)</p>
                      <p className={`font-semibold ${(bt.annualizedReturn ?? 0) > (bt.benchmarkAnnualizedReturn ?? 0) ? "text-green-600" : "text-red-600"}`}>
                        {bt.canAnnualize && bt.annualizedReturn !== null && bt.benchmarkAnnualizedReturn !== null
                          ? pct(bt.annualizedReturn - bt.benchmarkAnnualizedReturn)
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {bt.warnings.length > 0 && (
              <div className="space-y-2">
                {bt.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground border-t pt-3">{bt.methodologyNote}</div>
          </TabsContent>

          {/* Equity Curve */}
          <TabsContent value="equity" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Equity Curve</CardTitle>
                <CardDescription>Net portfolio value (rebased to 100). Separate In-Sample and Out-of-Sample periods where applicable.</CardDescription>
              </CardHeader>
              <CardContent>
                {bt.equityCurve.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No equity curve data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={bt.equityCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(0, 7)} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(0)} />
                      <RechartTooltip
                        formatter={(v: number) => [v.toFixed(2), ""]}
                        labelFormatter={(l) => l}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="portfolioIndex" stroke="#1B2F5B" strokeWidth={2} dot={false} name="Portfolio (net)" />
                      {bt.benchmarkTicker && (
                        <Line type="monotone" dataKey="benchmarkIndex" stroke="#D97706" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name={bt.benchmarkTicker} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Monthly Returns */}
          <TabsContent value="monthly" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Monthly Returns Table</CardTitle>
                <CardDescription>Net monthly returns. Green = positive, Red = negative.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {bt.monthlyReturns.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No monthly data.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="text-xs">Year</TableHead>
                        {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => (
                          <TableHead key={m} className="text-xs text-center">{m}</TableHead>
                        ))}
                        <TableHead className="text-xs text-right">Annual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(
                        bt.monthlyReturns.reduce((acc: Record<string, Record<string, number>>, r) => {
                          const [y, m] = r.month.split("-");
                          if (!acc[y]) acc[y] = {};
                          acc[y][m] = r.portfolioReturn;
                          return acc;
                        }, {})
                      ).sort(([a], [b]) => b.localeCompare(a)).map(([year, months]) => {
                        const annual = Object.values(months).reduce((p, r) => p * (1 + r), 1) - 1;
                        return (
                          <TableRow key={year}>
                            <TableCell className="text-xs font-semibold">{year}</TableCell>
                            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => {
                              const r = months[m];
                              return (
                                <TableCell key={m} className={`text-xs text-center tabular-nums ${r === undefined ? "text-gray-200" : r >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                  {r !== undefined ? `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}` : "—"}
                                </TableCell>
                              );
                            })}
                            <TableCell className={`text-xs text-right font-semibold ${annual >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {annual >= 0 ? "+" : ""}{(annual * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Walk-Forward */}
          <TabsContent value="walkforward" className="pt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Walk-Forward Validation</CardTitle>
                <CardDescription>
                  Train[t−L : t] → Trade[t+1 : t+h]. Each fold trains on a fixed historical window and trades the next hold period. Prevents parameter fitting to the full sample.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {bt.walkForward.folds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Insufficient data for walk-forward folds (minimum 2 complete periods required).</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="text-xs">Fold</TableHead>
                        <TableHead className="text-xs">Train Period</TableHead>
                        <TableHead className="text-xs">Test Period</TableHead>
                        <TableHead className="text-xs text-right">Test Return</TableHead>
                        <TableHead className="text-xs text-right">Test Sharpe</TableHead>
                        <TableHead className="text-xs text-right">Max DD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bt.walkForward.folds.map((fold, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">{fold.foldIndex + 1}</TableCell>
                          <TableCell className="text-xs text-muted-foreground" colSpan={2}>{fold.startDate} → {fold.endDate} · {fold.tradingDays}d</TableCell>
                          <TableCell className={`text-xs text-right font-semibold ${(fold.cumulativeReturn ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {fold.cumulativeReturn !== null ? pct(fold.cumulativeReturn) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right">{fold.sharpeRatio !== null ? fold.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-xs text-right text-red-600">{fold.maxDrawdown !== null ? pctPlain(fold.maxDrawdown) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {bt.walkForward.folds.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {bt.walkForward.note}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bias Audit */}
          <TabsContent value="integrity" className="pt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">Bias Audit — Integrity Assessment</CardTitle>
                    <CardDescription>Systematic checks for look-ahead bias, data leakage, and execution timing errors.</CardDescription>
                  </div>
                  <Badge variant="outline" className={`text-xs ${GRADE_CLASS[bt.integrity.grade] ?? "bg-gray-100 text-gray-800"}`}>
                    {GRADE_LABEL[bt.integrity.grade] ?? bt.integrity.grade}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {bt.integrity.checklist.map((check) => (
                  <div key={check.id} className={`flex items-start gap-2 border rounded-md px-4 py-3 ${check.status === "pass" ? "border-green-200 bg-green-50" : check.status === "warn" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                    <StatusIcon status={check.status} />
                    <div>
                      <p className={`text-sm font-medium ${check.status === "pass" ? "text-green-800" : check.status === "warn" ? "text-amber-800" : "text-red-800"}`}>{check.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
