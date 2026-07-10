import { useState } from "react";
import { useGetRiskModel } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, XCircle, Radar } from "lucide-react";
import { Link } from "wouter";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import { DetailDrawer } from "@/components/shared/DetailDrawer";

function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(digits);
}

function EtfLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/etf/${ticker}`} className="hover:text-accent hover:underline transition-colors">
      {ticker}
    </Link>
  );
}

const COVARIANCE_LABELS: Record<string, string> = {
  sample: "Sample covariance",
  ewma: "EWMA (RiskMetrics λ=0.94)",
  shrinkage: "Shrinkage (constant-correlation target)",
};

export function RiskModelProSection() {
  const [covarianceModel, setCovarianceModel] = useState<"sample" | "ewma" | "shrinkage">("sample");
  const { data: riskModel, isLoading } = useGetRiskModel({ covarianceModel });

  const [drawerData, setDrawerData] = useState<{ title: string; content: React.ReactNode } | null>(null);

  const openMetricDrawer = (title: string, content: React.ReactNode) => {
    setDrawerData({ title, content });
  };

  return (
    <>
      <DetailDrawer
        open={!!drawerData}
        onOpenChange={(o) => !o && setDrawerData(null)}
        title={drawerData?.title}
      >
        {drawerData?.content}
      </DetailDrawer>

      <Card className="border-0 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap px-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" /> Risk Model Pro
            </CardTitle>
            <CardDescription>
              Covariance-based risk analytics for the current allocation — marginal/component risk contribution, beta, downside risk, and diversification quality.
            </CardDescription>
          </div>
          <div className="w-56">
            <Select value={covarianceModel} onValueChange={(v) => setCovarianceModel(v as typeof covarianceModel)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sample">Sample covariance</SelectItem>
                <SelectItem value="ewma">EWMA (recency-weighted)</SelectItem>
                <SelectItem value="shrinkage">Shrinkage (stabilized)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {isLoading ? (
            <div className="space-y-4 animate-pulse">
               <div className="h-20 bg-gray-100 rounded"></div>
            </div>
          ) : !riskModel ? (
            <p className="text-sm text-muted-foreground">Risk model unavailable — run a rebalance first.</p>
          ) : !riskModel.hasSufficientData ? (
            <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{riskModel.insufficientReason}</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Annualized Volatility", 
                    <div className="space-y-2">
                      <p>Computed using {COVARIANCE_LABELS[riskModel.covarianceModel]} over {riskModel.lookbackDays} trading days.</p>
                      <p>A higher number means larger expected price swings. This is the baseline expected variation of your current allocation.</p>
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MetricTooltip label="Ann. Volatility" explanation={`Annualized portfolio volatility using ${COVARIANCE_LABELS[riskModel.covarianceModel]} over ${riskModel.lookbackDays} trading days.`} />
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{pct(riskModel.annualizedVolatility)}</p>
                </div>
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Downside Volatility", 
                    <div className="space-y-2">
                      <p>Semi-deviation: annualized volatility computed only from negative daily returns.</p>
                      <p>This metric ignores positive volatility (which is good) and focuses purely on downside risk asymmetry.</p>
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MetricTooltip label="Downside Vol" explanation="Semi-deviation: annualized volatility computed only from negative daily returns — captures downside risk asymmetry that standard deviation misses." />
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{pct(riskModel.downsideVolatility)}</p>
                </div>
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Drawdown Risk", 
                    <div className="space-y-2">
                      <p>Maximum drawdown of the current (static) weights simulated over the lookback window.</p>
                      <p>Shows how far this exact allocation could have fallen from a recent peak.</p>
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MetricTooltip label="Drawdown Risk" explanation="Maximum drawdown of the current (static) weights simulated over the lookback window — how far this exact allocation could have fallen from a recent peak." />
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{pct(riskModel.drawdownRisk)}</p>
                </div>
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Risk Concentration", 
                    <div className="space-y-2">
                      <p>Herfindahl-Hirschman Index of component-contribution-to-risk shares.</p>
                      <p>A higher value means your risk is concentrated in just a few positions, even if capital seems well-distributed.</p>
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MetricTooltip label="Risk Concentration" explanation="Herfindahl-Hirschman Index of component-contribution-to-risk shares (not weight shares). Higher = risk is concentrated in a few positions even if capital looks diversified." />
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{num(riskModel.concentrationRisk, 3)}</p>
                  <p className="text-xs text-muted-foreground">{num(riskModel.effectiveRiskBets, 1)} effective risk bets</p>
                </div>
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Diversification Score", 
                    <div className="space-y-2">
                      <p>Measures the % reduction in volatility achieved by combining these specific positions.</p>
                      <p>Calculated versus holding them independently at the same weights.</p>
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MetricTooltip label="Diversification Score" explanation="% reduction in volatility achieved by combining positions vs. holding them independently at the same weights (diversification ratio − 1, rescaled to 0-100)." />
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{riskModel.diversificationScore?.toFixed(0) ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{num(riskModel.diversificationRatio, 2)}x ratio</p>
                </div>
              </div>

              {riskModel.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {riskModel.warnings.map((w) => (
                    <div
                      key={w.id}
                      className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${w.severity === "fail" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                    >
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Beta Detail", 
                    <div className="space-y-2">
                      {riskModel.betas.map((b) => (
                        <div key={b.benchmarkTicker} className="border-b pb-2 mb-2 last:border-0">
                          <p className="font-semibold">{b.benchmarkTicker}</p>
                          {b.available ? (
                            <p>Beta: {num(b.beta)} | R-Squared: {num(b.rSquared)}</p>
                          ) : (
                            <p className="text-muted-foreground text-sm">{b.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    <MetricTooltip label="Beta to Benchmark" explanation="Beta measures the portfolio's sensitivity to benchmark moves (1.0 = moves in lockstep). Only computed when the benchmark ticker is present in your uploaded price data." />
                  </p>
                  <div className="space-y-1.5">
                    {riskModel.betas.map((b) => (
                      <div key={b.benchmarkTicker} className="flex items-center justify-between text-sm">
                        <span className="font-medium">{b.benchmarkTicker}</span>
                        {b.available ? (
                          <span>
                            β = <span className="font-semibold">{num(b.beta)}</span>
                            <span className="text-xs text-muted-foreground ml-1">(R² {num(b.rSquared)})</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{b.reason}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div 
                  className="border rounded-md p-3 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openMetricDrawer("Sector Risk Decomposition", 
                    <div className="space-y-2">
                      <p className="text-muted-foreground mb-4">How much each sector bucket contributes to the overall portfolio risk.</p>
                      {riskModel.decompositionBySector.map((d) => (
                        <div key={d.key} className="flex items-center justify-between text-sm border-b pb-1 last:border-0">
                          <span>{d.label}</span>
                          <span>{pct(d.weight)} weight | {d.componentContributionPct.toFixed(1)}% risk</span>
                        </div>
                      ))}
                    </div>
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    <MetricTooltip label="Risk Decomposition" explanation="Share of total portfolio risk (component contribution to risk) attributed to each sector bucket and to cash. Cash carries zero risk contribution by construction." />
                  </p>
                  <div className="space-y-1.5">
                    {riskModel.decompositionBySector.slice(0, 5).map((d) => (
                      <div key={d.key} className="flex items-center justify-between text-sm">
                        <span>{d.label}</span>
                        <span className="text-xs">
                          <span className="text-muted-foreground">{pct(d.weight)} wt ·</span> <span className="font-semibold">{d.componentContributionPct.toFixed(1)}%</span> risk
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  <MetricTooltip label="MCR / CCR by ETF" explanation="Marginal Contribution to Risk (MCR) = derivative of portfolio volatility w.r.t. that position's weight. Component Contribution to Risk (CCR) = MCR × weight; CCR values sum to total portfolio volatility." />
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Ticker</TableHead>
                      <TableHead className="text-xs text-right">Weight</TableHead>
                      <TableHead className="text-xs text-right">MCR</TableHead>
                      <TableHead className="text-xs text-right">CCR</TableHead>
                      <TableHead className="text-xs text-right">% of Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {riskModel.riskContributions.slice(0, 8).map((r) => (
                      <TableRow 
                        key={r.ticker}
                        className="cursor-pointer hover:bg-primary/5"
                        onClick={() => openMetricDrawer(`Risk Contribution: ${r.ticker}`,
                          <div className="space-y-4">
                            <div>
                              <p className="font-semibold">Marginal Contribution to Risk (MCR)</p>
                              <p className="text-2xl font-bold">{num(r.marginalContributionToRisk, 4)}</p>
                              <p className="text-muted-foreground text-sm">How much overall volatility would change if you added slightly more of this asset.</p>
                            </div>
                            <div>
                              <p className="font-semibold">Component Contribution to Risk (CCR)</p>
                              <p className="text-2xl font-bold">{num(r.componentContributionToRisk, 4)}</p>
                              <p className="text-muted-foreground text-sm">The exact portion of the portfolio's total volatility attributed to this asset (MCR × Weight).</p>
                            </div>
                          </div>
                        )}
                      >
                        <TableCell className="text-xs font-medium"><EtfLink ticker={r.ticker} /></TableCell>
                        <TableCell className="text-xs text-right">{pct(r.weight)}</TableCell>
                        <TableCell className="text-xs text-right">{num(r.marginalContributionToRisk, 4)}</TableCell>
                        <TableCell className="text-xs text-right">{num(r.componentContributionToRisk, 4)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <Badge variant="secondary" className="text-xs">{r.componentContributionPct.toFixed(1)}%</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                Model: {COVARIANCE_LABELS[riskModel.covarianceModel]} · Lookback: {riskModel.lookbackDays} trading days · Active ETFs: {riskModel.activeTickers.length}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
