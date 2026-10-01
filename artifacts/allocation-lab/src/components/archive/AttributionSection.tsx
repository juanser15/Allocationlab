import { useState } from "react";
import { useGetAttributionMeta, useGetAttribution } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BarChart3, TrendingUp, TrendingDown, Minus, Scale } from "lucide-react";
import { localSettings } from "@/lib/local-settings";

function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function signedPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(digits);
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    NEW: "bg-blue-50 text-blue-700 border-blue-200",
    REMOVED: "bg-red-50 text-red-700 border-red-200",
    INCREASED: "bg-green-50 text-green-700 border-green-200",
    REDUCED: "bg-amber-50 text-amber-700 border-amber-200",
    HELD: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return <Badge variant="outline" className={map[action] ?? ""}>{action}</Badge>;
}

function HelpedIcon({ helped }: { helped: boolean | null }) {
  if (helped === null) return <Minus className="h-3.5 w-3.5 text-gray-300" />;
  if (helped) return <TrendingUp className="h-3.5 w-3.5 text-green-600" />;
  return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
}

export function AttributionSection() {
  const benchmarkTicker = localSettings.getBenchmarksSettings().defaultBenchmark;
  const execution = localSettings.getExecutionAssumptions();
  const { data: meta, isLoading: loadingMeta } = useGetAttributionMeta({ benchmarkTicker });
  const [versionId, setVersionId] = useState<number | undefined>(undefined);

  const enabled = !!meta?.ready;
  const { data: attribution, isLoading: loadingData } = useGetAttribution(
    {
      versionId,
      benchmarkTicker,
      transactionCostBps: execution.transactionCostBps,
      slippageBps: execution.slippageBps,
      cashYieldAnnualPct: execution.cashYieldAnnualPct,
    },
    { query: { enabled } as any }
  );

  if (loadingMeta) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!meta?.ready) {
    return (
      <Card>
        <CardContent className="py-14 flex flex-col items-center text-center">
          <BarChart3 className="h-12 w-12 text-gray-300 mb-3" />
          <h3 className="text-lg font-bold text-gray-900 mb-1">Attribution not yet available</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            {meta?.reason ?? "Run the pipeline and save at least one rebalance with starting weights and realized price history to unlock attribution."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const versions = meta.versions;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Attribution</h3>
          <p className="text-xs text-muted-foreground">Realized performance decomposition for a saved rebalance version.</p>
        </div>
        <Select
          value={versionId ? String(versionId) : String(meta.selectedSessionId ?? "")}
          onValueChange={(v) => setVersionId(Number(v))}
        >
          <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadingData && (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      )}

      {attribution && !loadingData && !attribution.hasSufficientData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {attribution.insufficientReason ?? "This version does not have enough data for attribution."}
          </CardContent>
        </Card>
      )}

      {attribution && !loadingData && attribution.hasSufficientData && (
        <div className="space-y-5">
          {/* Benchmark comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5" /> Portfolio vs. Benchmark
              </CardTitle>
              <CardDescription>{attribution.versionLabel} · as of {attribution.asOfDate ?? "—"}</CardDescription>
            </CardHeader>
            <CardContent>
              {attribution.benchmarkComparison?.available ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Portfolio Return</p>
                    <p className="text-sm font-bold">{signedPct(attribution.benchmarkComparison.portfolioReturn)}</p>
                  </div>
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">{attribution.benchmarkComparison.benchmarkTicker} Return</p>
                    <p className="text-sm font-bold">{signedPct(attribution.benchmarkComparison.benchmarkReturn)}</p>
                  </div>
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Excess Return</p>
                    <p className={`text-sm font-bold ${(attribution.benchmarkComparison.excessReturn ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {signedPct(attribution.benchmarkComparison.excessReturn)}
                    </p>
                  </div>
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Tracking Error</p>
                    <p className="text-sm font-bold">{pct(attribution.benchmarkComparison.trackingError)}</p>
                  </div>
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Hit Ratio</p>
                    <p className="text-sm font-bold">{pct(attribution.benchmarkComparison.hitRatio, 0)}</p>
                  </div>
                  <div className="border rounded p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Information Ratio</p>
                    <p className="text-sm font-bold">{num(attribution.benchmarkComparison.informationRatio)}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{attribution.benchmarkComparison?.reason ?? "Benchmark comparison unavailable."}</p>
              )}
            </CardContent>
          </Card>

          {/* ETF contribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">ETF Contribution</CardTitle>
              <CardDescription>
                Portfolio return {signedPct(attribution.etfContribution?.totalPortfolioReturn)} · ETF sleeve {signedPct(attribution.etfContribution?.etfSleeveReturn)} · Cash drag {signedPct(attribution.etfContribution?.cashDrag)}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-1.5 pr-3">Ticker</th>
                    <th className="text-right py-1.5 pr-3">Weight</th>
                    <th className="text-right py-1.5 pr-3">Starting weight</th>
                    <th className="text-right py-1.5 pr-3">Realized Return</th>
                    <th className="text-right py-1.5 pr-3">Contribution</th>
                    <th className="text-right py-1.5 pr-3">Active Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.etfContribution?.entries.map((e) => (
                    <tr key={e.ticker} className="border-b border-gray-50">
                      <td className="py-1 pr-3 font-medium">{e.ticker}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{pct(e.weight)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{pct(e.priorWeight)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {e.priceDataAvailable ? signedPct(e.realizedReturn) : <span className="text-gray-400">No price data</span>}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{signedPct(e.contribution)}</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${(e.activeContribution ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {signedPct(e.activeContribution)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-gray-50 bg-gray-50/60">
                    <td className="py-1 pr-3 font-medium">Cash</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{pct(attribution.etfContribution?.cashWeight)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{pct(attribution.etfContribution?.cashPriorWeight)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">{attribution.etfContribution?.cashDragNote}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{signedPct(attribution.etfContribution?.cashReturnContribution)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">—</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Decision attribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Decision Attribution</CardTitle>
              {attribution.decisionAttribution?.available && (
                <CardDescription>{attribution.decisionAttribution.helpedCount} decisions helped · {attribution.decisionAttribution.hurtCount} hurt</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {attribution.decisionAttribution?.available ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-1.5 pr-3">Ticker</th>
                        <th className="text-left py-1.5 pr-3">Action</th>
                        <th className="text-right py-1.5 pr-3">Weight Change</th>
                        <th className="text-right py-1.5 pr-3">Realized Return</th>
                        <th className="text-center py-1.5 pr-3">Helped?</th>
                        <th className="text-left py-1.5 pr-3">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.decisionAttribution.entries.map((d) => (
                        <tr key={d.ticker} className="border-b border-gray-50">
                          <td className="py-1 pr-3 font-medium">{d.ticker}</td>
                          <td className="py-1 pr-3"><ActionBadge action={d.action} /></td>
                          <td className="py-1 pr-3 text-right tabular-nums">{signedPct(d.weight - d.priorWeight)}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{signedPct(d.realizedReturn)}</td>
                          <td className="py-1 pr-3 text-center"><HelpedIcon helped={d.helped} /></td>
                          <td className="py-1 pr-3 text-muted-foreground">{d.note}</td>
                        </tr>
                      ))}
                      {attribution.decisionAttribution.cashDecision && (
                        <tr className="border-b border-gray-50 bg-gray-50/60">
                          <td className="py-1 pr-3 font-medium">Cash</td>
                          <td className="py-1 pr-3">
                            <Badge variant="outline">{signedPct(attribution.decisionAttribution.cashDecision.cashChange)}</Badge>
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">—</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{signedPct(attribution.decisionAttribution.cashDecision.avgActiveReturn)}</td>
                          <td className="py-1 pr-3 text-center"><HelpedIcon helped={attribution.decisionAttribution.cashDecision.helped} /></td>
                          <td className="py-1 pr-3 text-muted-foreground">{attribution.decisionAttribution.cashDecision.note}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{attribution.decisionAttribution?.reason ?? "Decision attribution unavailable."}</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Factor attribution */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Factor Attribution</CardTitle>
              </CardHeader>
              <CardContent>
                {attribution.factorAttribution?.available ? (
                  <div className="space-y-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="text-left py-1.5 pr-3">Factor</th>
                          <th className="text-right py-1.5 pr-3">Wtd Avg Score</th>
                          <th className="text-right py-1.5 pr-3">Corr. w/ Return</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attribution.factorAttribution.buckets.map((b) => (
                          <tr key={b.key} className="border-b border-gray-50">
                            <td className="py-1 pr-3 font-medium">{b.label}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{b.weightedAvgScore.toFixed(0)}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{num(b.correlationWithReturn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {attribution.factorAttribution.macroRegime && (
                      <p className="text-xs text-muted-foreground pt-1">{attribution.factorAttribution.macroRegime.note}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{attribution.factorAttribution?.reason ?? "Factor attribution unavailable."}</p>
                )}
              </CardContent>
            </Card>

            {/* Regime attribution */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Regime Attribution</CardTitle>
              </CardHeader>
              <CardContent>
                {attribution.regimeAttribution?.available ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-1.5 pr-3">Regime</th>
                        <th className="text-right py-1.5 pr-3">Periods</th>
                        <th className="text-right py-1.5 pr-3">Avg Realized Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.regimeAttribution.buckets.map((b) => (
                        <tr key={b.regimeLabel} className="border-b border-gray-50">
                          <td className="py-1 pr-3 font-medium">{b.regimeLabel}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{b.periodCount}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{signedPct(b.avgRealizedReturn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">{attribution.regimeAttribution?.reason ?? "Regime attribution requires at least two saved rebalance versions."}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cost attribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Trading Cost Attribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                <div className="border rounded p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Gross Return</p>
                  <p className="text-sm font-bold">{signedPct(attribution.costAttribution?.grossReturn)}</p>
                </div>
                <div className="border rounded p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Turnover</p>
                  <p className="text-sm font-bold">{pct((attribution.costAttribution?.turnoverPct ?? 0) / 100, 1)}</p>
                </div>
                <div className="border rounded p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Cost Impact</p>
                  <p className="text-sm font-bold text-red-700">{signedPct(attribution.costAttribution?.costImpact)}</p>
                </div>
                <div className="border rounded p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Net Return</p>
                  <p className="text-sm font-bold">{signedPct(attribution.costAttribution?.netReturn)}</p>
                </div>
                <div className="border rounded p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Txn Cost / Slippage</p>
                  <p className="text-sm font-bold">{attribution.costAttribution?.transactionCostBps}bps / {attribution.costAttribution?.slippageBps}bps</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Report summary */}
          {attribution.reportSummary && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Committee Report Summary</CardTitle>
                <CardDescription>Included automatically in the exported committee report for this version.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p><span className="font-semibold">Best contributors:</span> {attribution.reportSummary.bestContributors.map((e) => e.ticker).join(", ") || "—"}</p>
                <p><span className="font-semibold">Worst contributors:</span> {attribution.reportSummary.worstContributors.map((e) => e.ticker).join(", ") || "—"}</p>
                <p><span className="font-semibold">Benchmark:</span> {attribution.reportSummary.benchmarkComparisonNote}</p>
                <p><span className="font-semibold">Cash:</span> {attribution.reportSummary.cashDragNote}</p>
                {attribution.reportSummary.lessonsLearned.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    {attribution.reportSummary.lessonsLearned.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
