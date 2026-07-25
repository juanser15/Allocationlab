import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { FlaskConical, Info } from "lucide-react";
import type { RunResult, EtfAllocation } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

type FactorKey = "composite" | "mom20" | "mom60" | "mom120" | "mom252" | "trendQuality" | "realizedVol60" | "drawdown" | "meanReversion";

const FACTOR_GROUPS: {
  group: string;
  factors: { key: FactorKey; label: string; formula: string; window: string; normalization: string; description: string }[];
}[] = [
  {
    group: "A — Momentum",
    factors: [
      {
        key: "mom20",
        label: "Momentum 20D",
        formula: "Momentum_i(20) = P_i,t / P_i,t−20 − 1",
        window: "20 trading days",
        normalization: "Cross-sectional percentile rank within universe",
        description: "Short-term price momentum. Captures recent trends over approximately one calendar month.",
      },
      {
        key: "mom60",
        label: "Momentum 60D",
        formula: "Momentum_i(60) = P_i,t / P_i,t−60 − 1",
        window: "60 trading days",
        normalization: "Cross-sectional percentile rank within universe",
        description: "Medium-term momentum. Three-month horizon, balances signal persistence with responsiveness.",
      },
      {
        key: "mom120",
        label: "Momentum 120D",
        formula: "Momentum_i(120) = P_i,t / P_i,t−120 − 1",
        window: "120 trading days",
        normalization: "Cross-sectional percentile rank within universe",
        description: "Six-month momentum. Primary institutional momentum horizon with strong academic backing.",
      },
      {
        key: "mom252",
        label: "Momentum 252D",
        formula: "Momentum_i(252) = P_i,t / P_i,t−252 − 1",
        window: "252 trading days (1 year)",
        normalization: "Cross-sectional percentile rank within universe",
        description: "Annual momentum. Skips most recent month by default to avoid short-term reversal bias.",
      },
    ],
  },
  {
    group: "B — Trend Quality",
    factors: [
      {
        key: "trendQuality",
        label: "Trend Quality",
        formula: "TrendQ = f(log-price slope R², persistence, MA distance)",
        window: "20D & 60D rolling",
        normalization: "Cross-sectional percentile rank; composite of sub-factors",
        description: "Composite quality of the price trend. Combines R² of log-price regression, trend persistence score, and distance from 50D/200D moving averages.",
      },
    ],
  },
  {
    group: "C — Volatility",
    factors: [
      {
        key: "realizedVol60",
        label: "Realized Volatility 60D",
        formula: "σ_i(60) = annualized std(daily_returns_i, 60D) × √252",
        window: "60 trading days",
        normalization: "Inverse cross-sectional rank (lower vol = higher score)",
        description: "Annualized realized volatility over 60 trading days. Lower volatility ETFs receive higher scores in this factor.",
      },
    ],
  },
  {
    group: "D — Drawdown / Risk Fit",
    factors: [
      {
        key: "drawdown",
        label: "Drawdown Risk Fit",
        formula: "DD_i = (P_i,t − max(P_i, t−252:t)) / max(P_i, t−252:t)",
        window: "252 trading days",
        normalization: "Inverse cross-sectional rank (smaller drawdown = higher score)",
        description: "Current drawdown from 252-day high. Penalizes ETFs that have fallen significantly from recent peaks. Combined with recovery speed and downside deviation.",
      },
    ],
  },
  {
    group: "E — Mean Reversion",
    factors: [
      {
        key: "meanReversion",
        label: "Mean Reversion",
        formula: "Z_i(5D) = (R_i,5D − μ_cross) / σ_cross",
        window: "5 trading days",
        normalization: "Cross-sectional z-score; low z-score (recent underperformer) = higher reversion score",
        description: "Short-term reversal signal. ETFs with recent underperformance relative to peers receive a higher mean-reversion score. Complements momentum at shorter horizons.",
      },
    ],
  },
];

function getCellColor(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function NormalizationNote() {
  return (
    <div className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50/50 px-4 py-3 text-xs text-blue-800">
      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
      <div className="space-y-1">
        <p><strong>Normalization:</strong> All raw values are cross-sectionally ranked within the active universe at each computation date.</p>
        <p className="font-mono text-[11px] bg-blue-100/60 rounded px-2 py-1">
          Z_i = (x_i − μ_cross) / σ_cross<br />
          PercentileScore_i = percentile_rank(x_i, universe) × 100
        </p>
        <p>Scores of 0–100 where 100 = strongest signal within universe. ETFs excluded from universe have no score (N/A).</p>
      </div>
    </div>
  );
}

export function FactorsTab({ result, hasData, hasRun }: Props) {
  const [drawerFactor, setDrawerFactor] = useState<{
    label: string; formula: string; window: string; normalization: string; description: string;
  } | null>(null);

  if (!hasData) return <EmptyState icon={FlaskConical} title="Valid price history is required." description="Upload price data to compute factor scores." />;
  if (!hasRun) return <EmptyState icon={FlaskConical} title="Run Optimizer to generate factor scores." description="Factor heatmap, rankings, and contribution analysis are generated by the optimizer pipeline." />;
  if (!result) return null;

  const allocs = result.allocations.slice().sort((a, b) => b.factorScores.composite - a.factorScores.composite);

  return (
    <div className="space-y-6">
      <DetailDrawer
        open={!!drawerFactor}
        onOpenChange={(o) => !o && setDrawerFactor(null)}
        title={drawerFactor?.label ?? "Factor Detail"}
      >
        {drawerFactor && (
          <div className="space-y-5 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Definition</h4>
              <p className="text-gray-700 leading-relaxed">{drawerFactor.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Formula</h4>
              <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{drawerFactor.formula}</pre>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Data Window</h4>
              <p className="text-gray-700">{drawerFactor.window}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Normalization</h4>
              <p className="text-gray-700">{drawerFactor.normalization}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Contribution to Composite</h4>
              <p className="text-gray-700">Composite = regime-weighted average of all factor group scores. Weights are set by current market regime (Risk-On / Neutral / Risk-Off) and are editable in Settings → Model Factors.</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">ETF Ranking (current)</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Rank</TableHead>
                    <TableHead className="text-xs">Ticker</TableHead>
                    <TableHead className="text-xs text-right">Score</TableHead>
                    <TableHead className="text-xs text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocs.map((a, idx) => {
                    const score = a.factorScores[drawerFactor.label.includes("20D") ? "mom20" as FactorKey :
                      drawerFactor.label.includes("60D") && drawerFactor.label.includes("Vol") ? "realizedVol60" as FactorKey :
                      drawerFactor.label.includes("60D") ? "mom60" as FactorKey :
                      drawerFactor.label.includes("120D") ? "mom120" as FactorKey :
                      drawerFactor.label.includes("252D") ? "mom252" as FactorKey :
                      drawerFactor.label.includes("Trend") ? "trendQuality" as FactorKey :
                      drawerFactor.label.includes("Drawdown") ? "drawdown" as FactorKey :
                      "meanReversion" as FactorKey];
                    return (
                      <TableRow key={a.ticker}>
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="text-xs font-medium">{a.ticker}</TableCell>
                        <TableCell className={`text-xs text-right font-semibold ${getCellColor(score)}`}>{score.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant="outline" className={a.active ? "text-[10px] bg-green-50 text-green-700" : "text-[10px] bg-gray-50 text-gray-400"}>
                            {a.active ? "ACTIVE" : "OUT"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DetailDrawer>

      <NormalizationNote />

      {/* Factor groups */}
      <Accordion type="multiple" defaultValue={["A — Momentum", "B — Trend Quality", "C — Volatility", "D — Drawdown / Risk Fit", "E — Mean Reversion"]}>
        {FACTOR_GROUPS.map(({ group, factors }) => (
          <AccordionItem key={group} value={group}>
            <AccordionTrigger className="text-sm font-semibold text-primary hover:no-underline px-0">
              {group}
            </AccordionTrigger>
            <AccordionContent className="pt-2 pb-4">
              <div className="space-y-3">
                {factors.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setDrawerFactor(f)}
                    className="w-full text-left border rounded-md px-4 py-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">{f.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{f.description}</p>
                        <p className="font-mono text-[10px] text-gray-500 mt-1 truncate">{f.formula}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Window</p>
                        <p className="text-xs text-gray-700">{f.window}</p>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {allocs.slice(0, 8).map((a) => {
                        const score = a.factorScores[f.key];
                        return (
                          <div key={a.ticker} className={`text-center text-[10px] font-medium rounded px-1 py-0.5 ${getCellColor(score)}`}>
                            {a.ticker}: {score.toFixed(0)}
                          </div>
                        );
                      })}
                    </div>
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Main heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Factor Heatmap — Full Universe Ranking</CardTitle>
          <CardDescription>All ETFs ranked by composite score. Click any row to drill into factor details.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead className="text-[10px] text-center w-8">#</TableHead>
                <TableHead className="text-[10px]">Ticker</TableHead>
                <TableHead className="text-[10px] text-center bg-primary/5 border-r">Composite</TableHead>
                <TableHead className="text-[10px] text-center">Mom 20D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 60D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 120D</TableHead>
                <TableHead className="text-[10px] text-center">Mom 252D</TableHead>
                <TableHead className="text-[10px] text-center">Trend Q</TableHead>
                <TableHead className="text-[10px] text-center">Vol 60D</TableHead>
                <TableHead className="text-[10px] text-center">Drawdown</TableHead>
                <TableHead className="text-[10px] text-center">MeanRev</TableHead>
                <TableHead className="text-[10px] text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocs.map((etf, idx) => (
                <TableRow
                  key={etf.ticker}
                  className="hover:bg-gray-50/70 cursor-pointer border-b border-gray-100"
                  onClick={() => {
                    const f = FACTOR_GROUPS[0].factors[0];
                    setDrawerFactor(f);
                  }}
                >
                  <TableCell className="text-center text-[10px] text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-semibold text-xs text-primary border-r">{etf.ticker}</TableCell>
                  <TableCell className={`text-center text-xs font-bold border-r ${getCellColor(etf.factorScores.composite)}`}>{etf.factorScores.composite.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom20)}`}>{etf.factorScores.mom20.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom60)}`}>{etf.factorScores.mom60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom120)}`}>{etf.factorScores.mom120.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.mom252)}`}>{etf.factorScores.mom252.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.trendQuality)}`}>{etf.factorScores.trendQuality.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.realizedVol60)}`}>{etf.factorScores.realizedVol60.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.drawdown)}`}>{etf.factorScores.drawdown.toFixed(0)}</TableCell>
                  <TableCell className={`text-center text-xs ${getCellColor(etf.factorScores.meanReversion)}`}>{etf.factorScores.meanReversion.toFixed(0)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={etf.active ? "text-[10px] bg-green-50 text-green-700 border-green-200" : "text-[10px] text-gray-400"}>
                      {etf.active ? "ACTIVE" : "OUT"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Factor correlation matrix note */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>Factor Correlation Matrix:</strong> Full cross-factor correlation analysis (to identify redundant signals) is available in Research Lab → ETF & Factor Explorer. This requires sufficient historical price data to compute stable cross-factor correlations.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
