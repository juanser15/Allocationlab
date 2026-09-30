import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Legend,
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
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { FlaskConical, CheckCircle2, XCircle, ShieldAlert, Info, Loader2, ShieldCheck, Lock } from "lucide-react";
import type { BacktestResult, ValidationJob, ValidationRun, ValidationRunSummary } from "@workspace/api-client-react";
import { ScenarioStressLab } from "@/components/research-lab/ScenarioStressLab";
import { ValidationJobStatus } from "./ValidationJobStatus";

interface Props {
  bt: BacktestResult | undefined;
  loading: boolean;
  hasData: boolean;
  hasRun: boolean;
  validationRequested: boolean;
  onRunValidation: () => void;
  validationRun: ValidationRun | undefined;
  validationRuns: ValidationRunSummary[];
  selectedValidationRunId: number | null;
  onSelectValidationRun: (id: number) => void;
  validationError: string | null;
  validationJob: ValidationJob | null;
  validationJobActive: boolean;
  validationJobSubmitting: boolean;
  validationJobReconnecting: boolean;
  validationJobSeconds: number;
  validationJobSubmissionError: string | null;
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      <div className="border-b border-gray-200 mt-3" />
    </div>
  );
}

// ─── Robustness definitions (inlined) ────────────────────────────────────────

const ROBUSTNESS_FORMULA = `Robustness =
  0.25 × ParameterStability
+ 0.20 × BootstrapStability
+ 0.20 × CovarianceStability
+ 0.20 × ModelAgreement
+ 0.15 × OutOfSampleStability`;

const ROBUSTNESS_TESTS = [
  { id: "parameter_stability",   label: "A — Parameter Perturbation",        weight: "25%", description: "Tests portfolio stability when key parameters are perturbed: factor weights ±10%/±20%, lookback window changes, turnover penalty adjustments.", formula: "WeightStability(ε) = 1 − 0.5 × Σᵢ |wᵢ_base − wᵢ_perturbed(ε)|", status: "requires_validation" as const },
  { id: "bootstrap",             label: "B — Bootstrap / Resampling",         weight: "20%", description: "Resamples the return and covariance history multiple times, runs the full optimizer on each sample, and measures weight dispersion and asset-selection frequency.", formula: "BootstrapStability = 1 − std(w_bootstrap) / mean(w_bootstrap)", status: "requires_validation" as const },
  { id: "covariance_sensitivity",label: "C — Covariance Sensitivity",         weight: "20%", description: "Runs the optimizer under sample, EWMA, and shrinkage covariance estimates and measures weight divergence across estimators.", formula: "CovStability = 1 − mean_{i≠j} |wᵢ_cov_A − wᵢ_cov_B| / 2", status: "requires_validation" as const },
  { id: "model_agreement",       label: "D — Model Disagreement",             weight: "20%", description: "Measures consensus across the three portfolio construction models (Momentum/Trend, MinVar, Risk Parity).", formula: "ModelAgreement = 1 − mean_k ‖wᵏ − mean(w)‖₁", status: "requires_multiple_models" as const },
  { id: "oos_stability",         label: "E — Rolling Out-of-Sample Stability", weight: "15%", description: "Measures stability of rolling out-of-sample Sharpe, drawdown, and asset selection from walk-forward folds.", formula: "OoSStability = 1 − std(fold_Sharpe) / (|mean(fold_Sharpe)| + ε)", status: "partial" as const },
  { id: "constraint_sensitivity",label: "F — Constraint Sensitivity",         weight: "—",  description: "Identifies which constraints materially change the solution by relaxing each one at a time.", formula: "ConstraintImpact_j = ‖w_constrained − w_unconstrained_j‖₁", status: "requires_validation" as const },
  { id: "turnover_sensitivity",  label: "G — Turnover Sensitivity",           weight: "—",  description: "Tests how different turnover penalty values affect resulting turnover, risk, and score metrics.", formula: "TurnoverCurve = {λ_turnover → (turnover, score, volatility)}", status: "requires_validation" as const },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function BacktestTab(props: Props) {
  const {
    bt, loading, hasData, hasRun, validationRequested, onRunValidation,
    validationRun, validationRuns, selectedValidationRunId, onSelectValidationRun, validationError,
    validationJob, validationJobActive, validationJobSubmitting, validationJobReconnecting,
    validationJobSeconds, validationJobSubmissionError,
    benchmark, setBenchmark, frequency, setFrequency, timing, setTiming,
    txnCostBps, setTxnCostBps, slippageBps, setSlippageBps,
    cashYield, setCashYield, startDate, setStartDate, endDate, setEndDate,
  } = props;

  const [metricDetail, setMetricDetail] = useState<{ title: string; content: string } | null>(null);
  const [openTest, setOpenTest] = useState<typeof ROBUSTNESS_TESTS[0] | null>(null);

  if (!hasData && !hasRun) return <EmptyState icon={FlaskConical} title="Valid price history is required." description="Upload price data to configure and run the backtester." />;
  if (!hasRun)  return <EmptyState icon={FlaskConical} title="Run Optimizer to generate model allocations." description="The backtester simulates the official portfolio process historically. An optimizer run is required first." />;

  const hasBt = !!bt && bt.hasSufficientData;

  // OoS stability from walk-forward
  const wf = bt?.walkForward;
  const oosStability = wf && wf.folds.length >= 2
    ? (() => {
        const sharpes = wf.folds.map((f) => f.sharpeRatio ?? 0);
        const mean = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
        const std = Math.sqrt(sharpes.reduce((a, b) => a + (b - mean) ** 2, 0) / sharpes.length);
        return Math.max(0, Math.min(100, (1 - std / (Math.abs(mean) + 0.01)) * 100));
      })()
    : null;
  const hasOoS = validationRequested && oosStability !== null;

  return (
    <div className="space-y-6">
      {/* Metric detail drawer */}
      <DetailDrawer
        open={!!metricDetail}
        onOpenChange={(o) => !o && setMetricDetail(null)}
        title={metricDetail?.title ?? ""}
      >
        {metricDetail && <p className="text-sm text-gray-700 leading-relaxed">{metricDetail.content}</p>}
      </DetailDrawer>

      {/* Robustness test drawer */}
      <DetailDrawer
        open={!!openTest}
        onOpenChange={(o) => !o && setOpenTest(null)}
        title={openTest?.label ?? ""}
      >
        {openTest && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={openTest.status === "partial" || openTest.status === "requires_validation" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}>
                {openTest.status === "partial" ? "Partial" : openTest.status === "requires_validation" ? "Requires Validation" : openTest.status === "requires_multiple_models" ? "Requires Multiple Models" : "Available"}
              </Badge>
              {openTest.weight !== "—" && <span className="text-xs text-muted-foreground">Composite weight: {openTest.weight}</span>}
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
              <p className="text-gray-700 leading-relaxed">{openTest.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Formula</h4>
              <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre leading-relaxed">{openTest.formula}</pre>
            </div>
            {openTest.id === "oos_stability" && hasOoS && bt && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Computed Result</h4>
                <div className="border rounded-md p-4">
                  <p className="text-3xl font-bold text-primary">{oosStability!.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">OoS Stability Score (0–100) · {bt.walkForward.folds.length} walk-forward folds</p>
                  <div className="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${oosStability! >= 65 ? "bg-green-500" : oosStability! >= 40 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${oosStability}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Fold Sharpes: {bt.walkForward.folds.map((f) => f.sharpeRatio?.toFixed(2) ?? "N/A").join(", ")}</p>
                </div>
              </div>
            )}
            {openTest.status === "requires_validation" && !validationRequested && (
              <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs">Run Validation to view this robustness component.</span>
              </div>
            )}
            {openTest.status === "requires_multiple_models" && (
              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-gray-600">
                <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs">Model Disagreement requires all three portfolio construction models (A, B, C). Currently only Model A is computed.</span>
              </div>
            )}
          </div>
        )}
      </DetailDrawer>

      {/* ═══════════════════════════════════
          CONFIGURATION
      ═══════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Validation Configuration</CardTitle>
          <CardDescription>
            Signals use only closes before their signal date. Existing holdings earn the return through the execution close; new holdings become active after that close.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ValidationJobStatus
            job={validationJob}
            active={validationJobActive}
            submitting={validationJobSubmitting}
            reconnecting={validationJobReconnecting}
            seconds={validationJobSeconds}
            submissionError={validationJobSubmissionError}
          />
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
                  <SelectItem value="next_open">Next Open (adjusted)</SelectItem>
                  <SelectItem value="same_close">Same Close</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Next-open execution uses the next trading day's adjusted open. A frozen dataset without adjusted OHLC cannot run this mode.</p>
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
              {loading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running Validation…</>
                : <><FlaskConical className="h-3.5 w-3.5" /> Run Validation</>
              }
            </Button>
            {hasBt && bt && (
              <span className="text-xs text-muted-foreground">
                Data: {bt.dataStartDate ?? "—"} → {bt.dataEndDate ?? "—"} · {bt.tradingDays} trading days
              </span>
            )}
            {validationRuns.length > 0 && selectedValidationRunId && (
              <Select value={String(selectedValidationRunId)} onValueChange={(id) => onSelectValidationRun(Number(id))}>
                <SelectTrigger aria-label="Saved Validation Run" className="h-8 w-56 text-xs">
                  <SelectValue placeholder="Saved Validation Runs" />
                </SelectTrigger>
                <SelectContent>
                  {validationRuns.map((run) => (
                    <SelectItem key={run.validationRunId} value={String(run.validationRunId)}>
                      Validation #{run.validationRunId} · {new Date(run.validatedAt).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {!validationRequested && (
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
              <span><strong>Validation has not been run.</strong> Configure assumptions above and click Run Validation.</span>
            </div>
          )}
          {validationRequested && bt && (
            <div className="text-[11px] text-muted-foreground">
              <p>
                Validation Run #{validationRun?.validationRunId} · Validated: {validationRun?.validatedAt}
                {" "}· Strategy Snapshot #{validationRun?.strategySnapshotId} · Reproduction: {validationRun?.reproducibilityStatus.toUpperCase()}
                {bt.validationIdentity && (
                  <> · Dataset SHA-256: {bt.validationIdentity.datasetHash} · Factor set: {bt.validationIdentity.factorSetVersion}
                    {" "}· Engine: {bt.validationIdentity.engineVersion}</>
                )}
                {bt.reproducibility.differences.length > 0 && <> · {bt.reproducibility.differences.join("; ")}</>}
              </p>
              {bt.validationIdentity && (
                <details className="mt-1">
                  <summary className="cursor-pointer">View exact validation specification</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded border bg-muted p-3 text-[10px]">
                    {JSON.stringify(bt.validationIdentity, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
          {validationError && (
            <p role="alert" className="text-xs text-red-700">{validationError}</p>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
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

      {/* ═══════════════════════════════════
          RESULTS (scroll sections)
      ═══════════════════════════════════ */}
      {hasBt && bt && (
        <div className="space-y-8">

          {/* Summary */}
          <section>
            <SectionHeader title="Summary" />
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                {[
                  { label: "CAGR (net)",     value: bt.canAnnualize ? pct(bt.annualizedReturn) : "N/A",        tip: "Compound Annual Growth Rate net of transaction costs, slippage, and cash drag." },
                  { label: "Ann. Volatility", value: bt.canAnnualize ? pctPlain(bt.annualizedVolatility) : "N/A", tip: "Annualized standard deviation of daily net returns." },
                  { label: "Sharpe Ratio",   value: bt.canAnnualize ? num2(bt.sharpeRatio) : "N/A",            tip: "Risk-adjusted return. (CAGR − risk-free) / Ann. Volatility." },
                  { label: "Max Drawdown",   value: pctPlain(bt.maxDrawdown),                                  tip: "Largest peak-to-trough decline in portfolio value over the full backtest period." },
                  { label: "Avg Turnover",   value: bt.avgTurnover !== null ? pctPlain(bt.avgTurnover) : "N/A", tip: "Average one-way portfolio turnover per rebalance period." },
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
            </div>
          </section>

          {/* Equity Curve */}
          <section>
            <SectionHeader title="Equity Curve" description="Net portfolio value rebased to 100. Separate In-Sample and Out-of-Sample periods where applicable." />
            <div className="pt-4">
              {bt.equityCurve.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No equity curve data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={bt.equityCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(0, 7)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(0)} />
                    <RechartTooltip formatter={(v: number) => [v.toFixed(2), ""]} labelFormatter={(l) => l} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="portfolioIndex" stroke="#1B2F5B" strokeWidth={2} dot={false} name="Portfolio (net)" />
                    {bt.benchmarkTicker && (
                      <Line type="monotone" dataKey="benchmarkIndex" stroke="#D97706" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name={bt.benchmarkTicker} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Monthly Returns */}
          <section>
            <SectionHeader title="Monthly Returns" description="Net monthly returns. Green = positive, Red = negative." />
            <div className="pt-4 overflow-x-auto">
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
            </div>
          </section>

          {/* Walk-Forward */}
          <section>
            <SectionHeader title="Walk-Forward Validation" description="Train[t−L : t] → Trade[t+1 : t+h]. Each fold trains on a fixed historical window and trades the next hold period." />
            <div className="pt-4">
              {bt.walkForward.folds.length === 0 ? (
                <p className="text-sm text-muted-foreground">Insufficient data for walk-forward folds (minimum 2 complete periods required).</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="text-xs">Fold</TableHead>
                        <TableHead className="text-xs">Period</TableHead>
                        <TableHead className="text-xs text-right">Return</TableHead>
                        <TableHead className="text-xs text-right">Sharpe</TableHead>
                        <TableHead className="text-xs text-right">Max DD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bt.walkForward.folds.map((fold, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">{fold.foldIndex + 1}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fold.startDate} → {fold.endDate} · {fold.tradingDays}d</TableCell>
                          <TableCell className={`text-xs text-right font-semibold ${(fold.cumulativeReturn ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {fold.cumulativeReturn !== null ? pct(fold.cumulativeReturn) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right">{fold.sharpeRatio !== null ? fold.sharpeRatio.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-xs text-right text-red-600">{fold.maxDrawdown !== null ? pctPlain(fold.maxDrawdown) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-3 text-xs text-muted-foreground">{bt.walkForward.note}</p>
                </>
              )}
            </div>
          </section>

          {/* Bias Audit */}
          <section>
            <SectionHeader title="Bias Audit" description="Systematic checks for look-ahead bias, data leakage, and execution timing errors." />
            <div className="pt-4 space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={`text-xs ${GRADE_CLASS[bt.integrity.grade] ?? "bg-gray-100 text-gray-800"}`}>
                  {GRADE_LABEL[bt.integrity.grade] ?? bt.integrity.grade}
                </Badge>
                <span className="text-xs text-muted-foreground">Integrity grade</span>
              </div>
              {bt.integrity.checklist.map((check) => (
                <div key={check.id} className={`flex items-start gap-2 border rounded-md px-4 py-3 ${check.status === "pass" ? "border-green-200 bg-green-50" : check.status === "warn" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                  <StatusIcon status={check.status} />
                  <div>
                    <p className={`text-sm font-medium ${check.status === "pass" ? "text-green-800" : check.status === "warn" ? "text-amber-800" : "text-red-800"}`}>{check.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}

      {/* ═══════════════════════════════════
          ROBUSTNESS FRAMEWORK
      ═══════════════════════════════════ */}
      <SectionHeader title="Robustness Analysis" description="Composite robustness score across 5 independent test dimensions." />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Robustness Framework
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Accordion type="single" collapsible>
            <AccordionItem value="formula" className="border rounded">
              <AccordionTrigger className="text-xs font-medium px-4 hover:no-underline">
                Robustness Score Formula & Composite Weights
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3">
                <pre className="font-mono text-[10px] bg-gray-50 border rounded p-3 whitespace-pre leading-relaxed text-gray-700">{ROBUSTNESS_FORMULA}</pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Score component cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Parameter Stability", weight: "25%", id: "parameter_stability", value: null,                                              status: "requires_validation" as const },
              { label: "Bootstrap Stability",  weight: "20%", id: "bootstrap",            value: null,                                              status: "requires_validation" as const },
              { label: "Covariance Stability", weight: "20%", id: "covariance_sensitivity",value: null,                                              status: "requires_validation" as const },
              { label: "Model Agreement",       weight: "20%", id: "model_agreement",       value: null,                                              status: "requires_multiple_models" as const },
              { label: "OoS Stability",         weight: "15%", id: "oos_stability",          value: hasOoS ? oosStability : null,                     status: hasOoS ? ("computed" as const) : ("requires_validation" as const) },
            ].map(({ label, weight, id, value, status }) => (
              <button
                key={id}
                onClick={() => setOpenTest(ROBUSTNESS_TESTS.find((t) => t.id === id) ?? null)}
                className="text-left border rounded-md p-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{weight}</span>
                </div>
                {value !== null ? (
                  <>
                    <p className="text-2xl font-bold text-primary">{value.toFixed(0)}</p>
                    <div className="mt-1.5 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${value >= 65 ? "bg-green-500" : value >= 40 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${value}%` }} />
                    </div>
                    <Badge variant="outline" className="mt-1.5 text-[10px] bg-green-50 text-green-700 border-green-200">Computed</Badge>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full bg-gray-100 rounded-full" />
                    <Badge variant="outline" className={`text-[10px] ${status === "requires_multiple_models" ? "bg-gray-50 text-gray-400" : "bg-amber-50 text-amber-600 border-amber-200"}`}>
                      {status === "requires_multiple_models" ? "Needs Multi-Model" : "Run Validation"}
                    </Badge>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!validationRequested && (
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
              <span>Run Validation to unlock Parameter Stability, Bootstrap, Covariance Sensitivity, and OoS Stability scores.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual test cards */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Test Components — click to inspect</p>
        {ROBUSTNESS_TESTS.map((test) => {
          const computed = test.id === "oos_stability" && hasOoS;
          return (
            <button
              key={test.id}
              onClick={() => setOpenTest(test)}
              className="w-full text-left border rounded-md p-4 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-primary">{test.label}</span>
                    {test.weight !== "—" && <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">{test.weight}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{test.description}</p>
                  <p className="font-mono text-[10px] text-gray-500 mt-1.5 truncate">{test.formula.split("\n")[0]}</p>
                </div>
                <div className="shrink-0">
                  {computed ? (
                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">Computed</Badge>
                  ) : test.status === "requires_multiple_models" ? (
                    <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-400">Needs Multi-Model</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-600 border-amber-200">Run Validation</Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════
          SCENARIO & STRESS TESTING
      ═══════════════════════════════════ */}
      <SectionHeader
        title="Scenario & Stress Testing"
        description="Simulate portfolio behaviour under hypothetical market shocks and custom scenarios."
      />
      <ScenarioStressLab />
    </div>
  );
}
