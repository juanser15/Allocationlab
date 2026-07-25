import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/shared/EmptyState";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import {
  Compass, DollarSign, Activity, Gauge, ShieldCheck, ShieldAlert,
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Info,
} from "lucide-react";
import type { RunResult, BacktestResult, EtfAllocation, RiskContributionEntry } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  loading: boolean;
  hasData: boolean;
  validationRan: boolean;
  bt: BacktestResult | undefined;
  onNavigate: (tab: string) => void;
}

function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
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

const COLORS = ["#1B2F5B", "#3B5284", "#6B84B5", "#9BB5E0", "#C1D2EE", "#E2E8F4", "#B0C4E0", "#8AA3C8"];

function MetricCard({
  label, value, sub, tip, onClick, badge,
}: {
  label: string; value: string | React.ReactNode; sub?: string;
  tip?: string; onClick?: () => void; badge?: React.ReactNode;
}) {
  return (
    <div
      className={`border rounded-md p-3 bg-white ${onClick ? "cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all" : ""}`}
      onClick={onClick}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {tip ? <MetricTooltip label={label} explanation={tip} /> : label}
      </p>
      <div className="text-lg font-bold text-gray-900 mt-1">{value}</div>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      {badge && <div className="mt-1">{badge}</div>}
    </div>
  );
}

export function OverviewTab({ result, loading, hasData, validationRan, bt, onNavigate }: Props) {
  const pieData = useMemo(() => {
    if (!result) return [];
    return result.allocations
      .filter((a) => a.weight > 0.001)
      .sort((a, b) => b.weight - a.weight)
      .map((a) => ({ name: a.ticker, value: a.weight, fullName: a.name }));
  }, [result]);

  const topIncreases = useMemo(() => {
    if (!result) return [];
    return result.allocations.filter((a) => a.change > 0.001).sort((a, b) => b.change - a.change).slice(0, 4);
  }, [result]);

  const topReductions = useMemo(() => {
    if (!result) return [];
    return result.allocations.filter((a) => a.change < -0.001).sort((a, b) => a.change - b.change).slice(0, 4);
  }, [result]);

  const topRisks = useMemo(() => {
    if (!result) return [];
    return result.diagnostics.riskContributions.slice().sort((a, b) => b.riskContributionPct - a.riskContributionPct).slice(0, 4);
  }, [result]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!hasData) {
    return <EmptyState icon={ShieldAlert} title="Valid price history is required." description="Upload price data in Settings to begin." />;
  }

  if (!result) {
    return <EmptyState icon={Compass} title="Run Optimizer to generate model allocations." description='No allocation has been computed yet. Click "Run Optimizer" above to generate the recommended portfolio.' />;
  }

  const diag = result.diagnostics;
  const regime = result.regime;

  return (
    <div className="space-y-6">
      {/* Primary PM metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Market Regime"
          value={
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getRegimeBadgeStyle(regime.label)}`}>
              {regime.label}
            </div>
          }
          sub={`Composite ${regime.composite.toFixed(1)} / 100`}
          onClick={() => onNavigate("regimes")}
          tip="Current systematic market regime: Risk-On, Neutral, or Risk-Off. Drives factor weight allocation."
        />
        <MetricCard
          label="Regime Confidence"
          value={`${regime.composite.toFixed(0)}%`}
          sub={`Trend ${regime.trend.toFixed(0)} · Vol ${regime.volatility.toFixed(0)}`}
          onClick={() => onNavigate("regimes")}
          tip="Composite regime confidence score (0-100) derived from trend, breadth, volatility, and liquidity signals."
        />
        <MetricCard
          label="Cash Allocation"
          value={pct(result.cashWeight)}
          sub={`${result.cashChange >= 0 ? "+" : ""}${pct(result.cashChange)} vs prior`}
          badge={
            <Badge variant="outline" className={result.cashChange > 0 ? "bg-green-50 text-green-700 border-green-200 text-[10px]" : "bg-red-50 text-red-700 border-red-200 text-[10px]"}>
              {result.cashChange >= 0 ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
              {result.cashChange >= 0 ? "Defensive" : "Risk-On Tilt"}
            </Badge>
          }
          tip="Current cash reserve weight. Dynamically adjusted by regime composite score."
        />
        <MetricCard
          label="Active ETFs"
          value={`${result.activeEtfCount}`}
          sub={`of ${result.allocations.length} in universe`}
          onClick={() => onNavigate("allocation")}
          tip="Number of ETFs with non-zero target weight. Minimum of 8 required by institutional constraints."
        />
        <MetricCard
          label="Expected Ann. Volatility"
          value={diag ? pct(diag.expectedVolatility) : "—"}
          onClick={() => onNavigate("models")}
          tip="Annualized portfolio volatility estimated from the sample covariance of the current allocation."
        />
        <MetricCard
          label="Diversification Score"
          value={diag ? diag.diversificationScore.toFixed(0) : "—"}
          sub="0–100 scale"
          onClick={() => onNavigate("models")}
          tip="Measures how well risk is distributed. Higher = more diversified. Computed as effective risk bets / total positions."
        />
        <MetricCard
          label="Backtest Integrity"
          value={
            validationRan && bt
              ? <Badge variant="outline" className={bt.integrity.grade === "research_grade" ? "bg-green-50 text-green-700 border-green-200 text-xs" : "bg-amber-50 text-amber-700 border-amber-200 text-xs"}>
                  {bt.integrity.grade === "research_grade" ? "Research Grade" : bt.integrity.grade === "developmental" ? "Developmental" : "Not Reliable"}
                </Badge>
              : <span className="text-muted-foreground text-sm font-normal">Run Validation</span>
          }
          onClick={() => onNavigate("backtest")}
          tip="Bias audit grade. Research Grade = no look-ahead bias detected. Requires Run Validation to compute."
        />
        <MetricCard
          label="Constraint Status"
          value={
            <div className="flex items-center gap-1">
              {result.allocations.every((a) => a.weight <= 0.1 + 0.0001) ? (
                <><ShieldCheck className="h-4 w-4 text-green-600" /><span className="text-green-700 text-sm font-medium">Feasible</span></>
              ) : (
                <><ShieldAlert className="h-4 w-4 text-red-600" /><span className="text-red-700 text-sm font-medium">Violated</span></>
              )}
            </div>
          }
          onClick={() => onNavigate("constraints")}
          tip="Whether all portfolio constraints are satisfied by the current allocation."
        />
      </div>

      {/* Ensemble model info */}
      <div className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50/50 px-4 py-3 text-xs text-blue-800">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
        <span>
          <strong>Ensemble Consensus:</strong> Current allocation generated by Momentum/Trend model with regime-adaptive factor weights.
          Multi-model ensemble (Momentum/Trend + MinVar + Risk Parity) and full model-weighted alpha is available in the <button onClick={() => onNavigate("models")} className="underline font-medium">Models</button> and <button onClick={() => onNavigate("allocation")} className="underline font-medium">Final Allocation</button> tabs.
        </span>
      </div>

      {/* Donut + Summary grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Recommended Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <ResponsiveContainer width={220} height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={2}>
                    {pieData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(val: number, _: string, props: { payload?: { name: string; fullName: string } }) => [
                      pct(val), props.payload?.fullName ?? props.payload?.name ?? ""
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 w-full">
                {pieData.slice(0, 8).map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-xs font-medium text-gray-700 w-12">{item.name}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct(item.value), backgroundColor: COLORS[idx % COLORS.length] }} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-600 w-10 text-right">{pct(item.value)}</span>
                  </div>
                ))}
                {result.cashWeight > 0.001 && (
                  <div className="flex items-center gap-2 border-t pt-1.5 mt-1.5">
                    <div className="h-2 w-2 rounded-full shrink-0 bg-gray-300" />
                    <span className="text-xs font-medium text-gray-500 w-12">CASH</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gray-400" style={{ width: pct(result.cashWeight) }} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-500 w-10 text-right">{pct(result.cashWeight)}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Top increases */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ArrowUpRight className="h-3.5 w-3.5 text-green-600" /> Top Increases
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topIncreases.length === 0 ? (
                <p className="text-xs text-muted-foreground">No changes vs prior</p>
              ) : topIncreases.map((e) => (
                <div key={e.ticker} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-800">{e.ticker}</span>
                  <span className="text-green-600 font-semibold">+{pct(e.change)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Top reductions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ArrowDownRight className="h-3.5 w-3.5 text-red-500" /> Top Reductions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topReductions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reductions vs prior</p>
              ) : topReductions.map((e) => (
                <div key={e.ticker} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-800">{e.ticker}</span>
                  <span className="text-red-600 font-semibold">{pct(e.change)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Top risks */}
      {topRisks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> Top Risk Contributors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {topRisks.map((r) => (
                <div key={r.ticker} className="border rounded-md p-3">
                  <p className="text-xs font-semibold text-muted-foreground">{r.ticker}</p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">{pct(r.riskContributionPct)}</p>
                  <p className="text-[11px] text-muted-foreground">of portfolio risk</p>
                  <p className="text-[11px] text-muted-foreground">{pct(r.weight)} weight</p>
                </div>
              ))}
            </div>
            {diag.insufficientDataReasons.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{diag.insufficientDataReasons.join("; ")}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data timestamp */}
      <div className="text-[11px] text-muted-foreground">
        Optimizer Pro · Institutional portfolio optimizer
      </div>
    </div>
  );
}


