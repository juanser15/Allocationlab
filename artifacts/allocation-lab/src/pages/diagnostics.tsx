import { useState } from "react";
import { useGetLatestResults } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Info, Loader2, AlertTriangle, Activity } from "lucide-react";
import { Link } from "wouter";

// ── Colour helpers ────────────────────────────────────────────────────────────

function riskColor(pct: number): string {
  if (pct >= 25) return "#be123c";
  if (pct >= 15) return "#d97706";
  if (pct >= 8)  return "#1d4ed8";
  return "#059669";
}

function corrToRgb(corr: number): string {
  const c = Math.max(-1, Math.min(1, corr));
  if (c >= 0) {
    const t = c;
    const r = Math.round(255 - t * (255 - 30));
    const g = Math.round(255 - t * (255 - 64));
    const b = Math.round(255 - t * (255 - 175));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = -c;
    const r = Math.round(255 - t * (255 - 22));
    const g = Math.round(255 - t * (255 - 163));
    const b = Math.round(255 - t * (255 - 74));
    return `rgb(${r},${g},${b})`;
  }
}

function corrTextColor(corr: number): string {
  return Math.abs(corr) > 0.5 ? "#fff" : "#1e293b";
}

// ── Tooltip wrapper ────────────────────────────────────────────────────────────

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

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className ?? ""}`} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioDiagnostics() {
  const { data: result, isLoading } = useGetLatestResults();
  const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-amber-800 mb-1">No allocation run found.</p>
            <p className="text-xs text-amber-700">
              Run the pipeline from the{" "}
              <Link href="/" className="underline font-medium">Investment Committee</Link>{" "}
              page to generate portfolio diagnostics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const diag = result.diagnostics;

  const hasInsufficient = diag.insufficientDataReasons.length > 0;
  const hasFull = diag.riskContributions.length > 0;

  const volPct = (diag.expectedVolatility * 100).toFixed(1);

  const benchmark =
    selectedBenchmark ??
    (diag.trackingErrors.length > 0 ? diag.trackingErrors[0].benchmarkTicker : null);

  const teEntry = diag.trackingErrors.find((t) => t.benchmarkTicker === benchmark);
  const tePct = teEntry ? (teEntry.trackingError * 100).toFixed(1) : null;

  const diversityBand =
    diag.diversificationScore >= 70
      ? { label: "Well Diversified", color: "bg-green-100 text-green-800 border-green-200" }
      : diag.diversificationScore >= 50
      ? { label: "Moderate Diversification", color: "bg-blue-100 text-blue-800 border-blue-200" }
      : diag.diversificationScore >= 30
      ? { label: "Concentrated", color: "bg-amber-100 text-amber-800 border-amber-200" }
      : { label: "Highly Concentrated", color: "bg-red-100 text-red-800 border-red-200" };

  // Build unique tickers for the heatmap
  const heatTickers = diag.activeTickers;
  const nT = heatTickers.length;

  function getCorr(a: string, b: string): number {
    const cell = diag.correlationMatrix.find((c) => c.tickerA === a && c.tickerB === b);
    return cell?.correlation ?? 0;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Portfolio Diagnostics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Risk decomposition for the current allocation run &middot;{" "}
            <span className="font-medium">{new Date(result.runAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
            {diag.lookbackDays > 0 && (
              <span className="text-muted-foreground/70"> · {diag.lookbackDays}-day covariance window</span>
            )}
          </p>
        </div>
        {result.label && (
          <Badge variant="outline" className="text-primary border-primary/30 font-medium">
            {result.label}
          </Badge>
        )}
      </div>

      {/* Insufficient data banner */}
      {hasInsufficient && (
        <div className="space-y-1">
          {diag.insufficientDataReasons.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {r}
            </div>
          ))}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <MetricTooltip tip="Annualized portfolio volatility computed from the covariance matrix of daily returns. Based on current weights applied to the historical return window. Includes active ETF positions only; cash has zero volatility.">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected Volatility</p>
            </MetricTooltip>
            {hasFull ? (
              <p className="text-3xl font-bold text-primary mt-1">{volPct}<span className="text-base font-normal text-muted-foreground">%</span></p>
            ) : (
              <p className="text-sm text-muted-foreground mt-2 italic">Insufficient data</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">annualized</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <MetricTooltip tip="Herfindahl-Hirschman Index: sum of squared portfolio weights for active ETFs (normalized). Ranges 1/N (perfectly equal) to 1 (fully concentrated). Lower values indicate more evenly distributed positions.">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">HHI</p>
            </MetricTooltip>
            <p className="text-3xl font-bold text-primary mt-1">{diag.hhi.toFixed(3)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">1/N min = {diag.activeTickers.length > 0 ? (1 / diag.activeTickers.length).toFixed(3) : "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <MetricTooltip tip="Effective Number of Bets (1/HHI). The implied number of equally-weighted positions that would produce the same HHI. Higher means more diversified. A fully equal-weighted 8-ETF portfolio has ENB = 8.">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Eff. No. of Bets</p>
            </MetricTooltip>
            <p className="text-3xl font-bold text-primary mt-1">{diag.effectiveNumberOfBets.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">of {diag.activeTickers.length} active ETFs</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <MetricTooltip tip="Diversification score based on average pairwise return correlation of active ETFs. Score = (1 − avg correlation) × 100, capped 0–100. A score of 100 means zero average correlation; a score of 0 means all positions move together.">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diversification</p>
            </MetricTooltip>
            <p className="text-3xl font-bold text-primary mt-1">{diag.diversificationScore.toFixed(0)}<span className="text-base font-normal text-muted-foreground">/100</span></p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded border mt-1 inline-block ${diversityBand.color}`}>
              {diversityBand.label}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Risk Contribution + Correlation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Risk Contribution chart */}
        <Card>
          <CardHeader className="pb-2">
            <MetricTooltip tip="Each ETF's marginal contribution to total portfolio variance. RC_i = w_i × (Σw)_i / σ²_p, expressed as a percentage. Positions with weight risk contributions higher than their capital weight are risk concentrators. Uses the annualized covariance matrix.">
              <CardTitle className="text-base">Risk Contribution by ETF</CardTitle>
            </MetricTooltip>
            <CardDescription className="text-xs">
              % of total portfolio variance attributed to each active position
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!hasFull ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground italic">
                Insufficient price history to compute risk contributions.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={diag.riskContributions.length * 38 + 20}>
                <BarChart
                  data={diag.riskContributions}
                  layout="vertical"
                  margin={{ left: 4, right: 20, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="ticker"
                    tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartTooltip
                    formatter={(val: number, _name: string, props) => {
                      const item = props.payload;
                      return [
                        <>
                          <div className="font-semibold">{item.ticker}</div>
                          <div>Risk contrib: {val.toFixed(1)}%</div>
                          <div>Weight: {(item.weight * 100).toFixed(1)}%</div>
                          <div>Marginal vol: {(item.marginalVolContribution * 100).toFixed(2)}%</div>
                        </>,
                        "",
                      ];
                    }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="riskContributionPct" radius={[0, 3, 3, 0]}>
                    {diag.riskContributions.map((entry) => (
                      <Cell key={entry.ticker} fill={riskColor(entry.riskContributionPct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {hasFull && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Weight vs Risk Contribution</p>
                <div className="space-y-1.5">
                  {diag.riskContributions.map((rc) => {
                    const wPct = rc.weight * 100;
                    const diff = rc.riskContributionPct - wPct;
                    const isRiskConcentrator = diff > 1.5;
                    const isRiskReducer = diff < -1.5;
                    return (
                      <div key={rc.ticker} className="flex items-center gap-2 text-xs">
                        <span className="w-10 font-semibold text-gray-700 shrink-0">{rc.ticker}</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-primary/30 rounded-l-full"
                            style={{ width: `${Math.min(wPct * 2, 100)}%` }}
                            title={`Weight: ${wPct.toFixed(1)}%`}
                          />
                        </div>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                          <div
                            className="h-full rounded-l-full"
                            style={{
                              width: `${Math.min(rc.riskContributionPct * 2, 100)}%`,
                              background: riskColor(rc.riskContributionPct),
                            }}
                            title={`Risk: ${rc.riskContributionPct.toFixed(1)}%`}
                          />
                        </div>
                        <span className={`w-20 text-right shrink-0 font-medium ${isRiskConcentrator ? "text-red-600" : isRiskReducer ? "text-green-700" : "text-gray-500"}`}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}pp
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-primary/30 inline-block" /> Weight</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-600 inline-block" /> Risk contrib</span>
                  <span className="text-muted-foreground/70">(+pp = risk concentrator)</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Correlation Heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <MetricTooltip tip="Pairwise Pearson correlation of daily returns over the covariance estimation window. Blue = positive correlation (assets move together). Green = negative (assets hedge each other). Diagonal always = 1.0.">
              <CardTitle className="text-base">Return Correlation Heatmap</CardTitle>
            </MetricTooltip>
            <CardDescription className="text-xs">
              Active ETF pairwise correlations · {diag.lookbackDays}-day window
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!hasFull || nT === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground italic">
                Insufficient price history to compute correlations.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs" style={{ minWidth: nT * 42 + 44 }}>
                  <thead>
                    <tr>
                      <th className="w-11 h-6" />
                      {heatTickers.map((t) => (
                        <th key={t} className="w-10 h-6 text-center font-semibold text-gray-600 text-[10px] pb-1">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatTickers.map((rowTicker) => (
                      <tr key={rowTicker}>
                        <td className="pr-1 text-right font-semibold text-gray-600 text-[10px] w-11 h-9">{rowTicker}</td>
                        {heatTickers.map((colTicker) => {
                          const corr = getCorr(rowTicker, colTicker);
                          const bg = corrToRgb(corr);
                          const fg = corrTextColor(corr);
                          const isDiag = rowTicker === colTicker;
                          return (
                            <td
                              key={colTicker}
                              style={{ backgroundColor: bg, color: fg }}
                              className="w-10 h-9 text-center font-medium text-[10px] leading-none select-none"
                              title={`${rowTicker} vs ${colTicker}: ${corr.toFixed(3)}`}
                            >
                              {isDiag ? (
                                <span className="opacity-60">1.0</span>
                              ) : (
                                corr.toFixed(2)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Colour legend */}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>−1.0</span>
                  <div
                    className="flex-1 h-3 rounded"
                    style={{ background: "linear-gradient(to right, rgb(22,163,74), rgb(255,255,255), rgb(30,64,175))" }}
                  />
                  <span>+1.0</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Green = negative corr · Blue = positive corr</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tracking Error */}
      <Card>
        <CardHeader className="pb-3">
          <MetricTooltip tip="Annualized standard deviation of the daily return difference between the portfolio and the selected benchmark. Lower tracking error = portfolio moves more like the benchmark. Computed using current portfolio weights and the lookback window. Only available if benchmark ticker is present in the uploaded price data.">
            <CardTitle className="text-base">Tracking Error vs Benchmark</CardTitle>
          </MetricTooltip>
          <CardDescription className="text-xs">
            Benchmarks are auto-detected from tickers in your uploaded price data (SPY, QQQ, IWM, VTI, AGG, EFA, GLD).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {diag.trackingErrors.length === 0 ? (
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <span>
                No benchmark tickers detected in the uploaded price data.
                Add <strong>SPY</strong>, <strong>QQQ</strong>, <strong>IWM</strong>, <strong>VTI</strong>, <strong>AGG</strong>, <strong>EFA</strong>, or <strong>GLD</strong> as a column in your price CSV to enable tracking error.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Benchmark selector */}
              <div className="flex flex-wrap gap-2">
                {diag.trackingErrors.map((te) => (
                  <button
                    key={te.benchmarkTicker}
                    onClick={() => setSelectedBenchmark(te.benchmarkTicker)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      benchmark === te.benchmarkTicker
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-gray-600 border-gray-200 hover:border-primary/50"
                    }`}
                  >
                    {te.benchmarkTicker}
                  </button>
                ))}
              </div>

              {/* Selected benchmark detail */}
              {benchmark && tePct && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-md p-4 border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tracking Error</p>
                    <p className="text-3xl font-bold text-primary">
                      {tePct}<span className="text-base font-normal text-muted-foreground">%</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">annualized · vs {benchmark}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-4 border sm:col-span-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Interpretation</p>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      {parseFloat(tePct) < 5
                        ? `Low tracking error vs ${benchmark} — the portfolio's daily returns move closely with the benchmark. Active bets are modest.`
                        : parseFloat(tePct) < 10
                        ? `Moderate tracking error vs ${benchmark} — the portfolio has meaningful active tilts but broadly follows the benchmark.`
                        : `High tracking error vs ${benchmark} — the portfolio diverges substantially from the benchmark. This reflects the model's active sector/factor positioning.`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Computed over {diag.lookbackDays} trading days using constant current weights.
                    </p>
                  </div>
                </div>
              )}

              {/* All benchmarks summary table */}
              {diag.trackingErrors.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">All Detected Benchmarks</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {diag.trackingErrors.map((te) => (
                      <button
                        key={te.benchmarkTicker}
                        onClick={() => setSelectedBenchmark(te.benchmarkTicker)}
                        className={`text-left p-3 rounded border text-xs transition-colors hover:border-primary/30 ${
                          benchmark === te.benchmarkTicker ? "border-primary/40 bg-primary/5" : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <p className="font-semibold text-gray-700">{te.benchmarkTicker}</p>
                        <p className="text-lg font-bold text-primary mt-0.5">{(te.trackingError * 100).toFixed(1)}%</p>
                        <p className="text-muted-foreground text-[10px]">ann. TE</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer context */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-4">
        <Activity className="h-3.5 w-3.5 shrink-0" />
        <span>
          Diagnostics computed from {diag.activeTickers.length} active ETF positions using a {diag.lookbackDays}-day daily return window.
          Cash (zero-volatility) is excluded from the covariance matrix.
          All values are annualized.
        </span>
      </div>
    </div>
  );
}
