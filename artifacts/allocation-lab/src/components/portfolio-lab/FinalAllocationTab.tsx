import { useState } from "react";
import { useLocation } from "wouter";
import { useGetOrCreateDecisionLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import {
  ShieldCheck, ArrowRight, ArrowUpRight, ArrowDownRight, Minus,
  ClipboardList, Info, Send, CheckCircle2, XCircle, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import type { RunResult } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

function pct(n: number, d = 1) {
  return `${(n * 100).toFixed(d)}%`;
}

function getCellColor(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function EtfLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/etf/${ticker}`} className="inline-flex items-center gap-0.5 hover:text-primary hover:underline transition-colors group">
      {ticker}
      <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

export function FinalAllocationTab({ result, hasData, hasRun }: Props) {
  const [, setLocation] = useLocation();
  const [etfDrawer, setEtfDrawer] = useState<typeof result extends undefined ? null : NonNullable<typeof result>["allocations"][0] | null>(null);

  const sessionId = result?.sessionId;
  const { data: decisionLog } = useGetOrCreateDecisionLog(sessionId ?? 0, {
    query: { enabled: !!sessionId },
  } as any);
  const tradeList = decisionLog?.content?.tradeList ?? [];
  const activeTrades = tradeList.filter((t: { action: string }) => t.action !== "HOLD");

  if (!hasData) return <EmptyState icon={ShieldCheck} title="Valid price history is required." description="Upload price data to view the final allocation." />;
  if (!hasRun || !result) {
    return <EmptyState icon={ShieldCheck} title="Final Allocation is unavailable until constraints are feasible." description='Run Optimizer to generate the ensemble allocation, trade list, and supporting evidence.' />;
  }

  const allocs = result.allocations.slice().sort((a, b) => b.weight - a.weight);
  const activeAllocs = allocs.filter((a) => a.active);
  const diag = result.diagnostics;

  return (
    <div className="space-y-6">
      {/* ETF drilldown drawer */}
      <DetailDrawer
        open={!!etfDrawer}
        onOpenChange={(o) => !o && setEtfDrawer(null)}
        title={etfDrawer ? `${etfDrawer.ticker} — Allocation Detail` : ""}
      >
        {etfDrawer && (
          <div className="space-y-5 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Position</h4>
              <p className="text-gray-700">{etfDrawer.name} · {etfDrawer.sector}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground">Target Weight</p>
                <p className="text-2xl font-bold text-primary">{pct(etfDrawer.weight)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground">Change vs Prior</p>
                <p className={`text-2xl font-bold ${etfDrawer.change > 0 ? "text-green-600" : etfDrawer.change < 0 ? "text-red-600" : "text-gray-400"}`}>
                  {etfDrawer.change >= 0 ? "+" : ""}{pct(etfDrawer.change)}
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Factor Scores (current)</h4>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Composite", val: etfDrawer.factorScores.composite },
                  { label: "Mom 20D", val: etfDrawer.factorScores.mom20 },
                  { label: "Mom 60D", val: etfDrawer.factorScores.mom60 },
                  { label: "Mom 120D", val: etfDrawer.factorScores.mom120 },
                  { label: "Mom 252D", val: etfDrawer.factorScores.mom252 },
                  { label: "Trend Q", val: etfDrawer.factorScores.trendQuality },
                  { label: "Vol 60D", val: etfDrawer.factorScores.realizedVol60 },
                  { label: "Drawdown", val: etfDrawer.factorScores.drawdown },
                  { label: "MeanRev", val: etfDrawer.factorScores.meanReversion },
                ].map(({ label, val }) => (
                  <div key={label} className={`text-center text-xs font-medium rounded px-2 py-1.5 ${getCellColor(val)}`}>
                    <p className="text-[10px] opacity-70">{label}</p>
                    <p className="font-bold">{val.toFixed(0)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Model Support</h4>
              <div className="border rounded p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span>Model A (Momentum/Trend)</span>
                  <Badge variant="outline" className={etfDrawer.active ? "text-[10px] bg-green-50 text-green-700" : "text-[10px] bg-gray-50 text-gray-400"}>
                    {etfDrawer.active ? "Selected" : "Excluded"}
                  </Badge>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Model B (Min Variance)</span>
                  <span className="text-[10px] italic">Extension required</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Model C (Risk Parity)</span>
                  <span className="text-[10px] italic">Extension required</span>
                </div>
              </div>
            </div>

            {diag.riskContributions.find((r) => r.ticker === etfDrawer.ticker) && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Expected Risk Contribution</h4>
                <div className="border rounded p-3">
                  <p className="text-2xl font-bold text-gray-900">
                    {pct(diag.riskContributions.find((r) => r.ticker === etfDrawer.ticker)!.riskContributionPct)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">of total portfolio risk</p>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {etfDrawer.active ? "Inclusion Rationale" : "Exclusion Rationale"}
              </h4>
              <div className={`border rounded p-3 text-xs ${etfDrawer.active ? "bg-green-50 border-green-200 text-green-800" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
                {etfDrawer.active
                  ? `Composite factor score ${etfDrawer.factorScores.composite.toFixed(0)}/100 ranks this ETF within the top selection. All inclusion constraints satisfied.`
                  : `Composite score ${etfDrawer.factorScores.composite.toFixed(0)}/100 below the active selection threshold, or excluded by the minimum-inclusion or target-active-ETF constraints.`
                }
              </div>
            </div>

            <Button variant="outline" size="sm" asChild>
              <Link href={`/etf/${etfDrawer.ticker}`}>
                Open ETF Explorer <ExternalLink className="ml-1.5 h-3 w-3" />
              </Link>
            </Button>
          </div>
        )}
      </DetailDrawer>

      {/* Ensemble formula */}
      <Card className="border-blue-100 bg-blue-50/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
            <div className="text-xs space-y-2">
              <p className="font-semibold text-blue-800">Ensemble Portfolio Formula</p>
              <pre className="font-mono text-[10px] bg-white border border-blue-100 rounded px-3 py-2 text-blue-900 whitespace-pre">
{`w_final = α_momentum × w_momentum
         + α_minvar   × w_minvar
         + α_riskparity × w_riskparity

Model weights depend on: regime fit, OoS quality, robustness,
covariance stability, and model agreement.

Current: α_momentum = 1.00 (sole computed model)
         α_minvar = 0.00  (extension required)
         α_riskparity = 0.00  (extension required)`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full allocation table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Final Allocation — Full Universe</CardTitle>
          <CardDescription>
            Click any row to inspect factor scores, model support, risk contribution, and trade rationale. Sorted by target weight.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead className="text-[10px]">Ticker</TableHead>
                <TableHead className="text-[10px]">Name</TableHead>
                <TableHead className="text-[10px] text-center">Score</TableHead>
                <TableHead className="text-[10px] text-right">Prior</TableHead>
                <TableHead className="text-[10px] text-right">Target</TableHead>
                <TableHead className="text-[10px] text-right">Δ</TableHead>
                <TableHead className="text-[10px] text-center">Model A</TableHead>
                <TableHead className="text-[10px] text-center">Risk Contrib.</TableHead>
                <TableHead className="text-[10px] text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Cash row */}
              <TableRow className="bg-primary/5 font-medium border-b-2 border-primary/20">
                <TableCell className="text-xs font-bold">CASH</TableCell>
                <TableCell className="text-xs text-muted-foreground">Cash Reserve</TableCell>
                <TableCell className="text-xs text-center">—</TableCell>
                <TableCell className="text-xs text-right">{pct(result.cashPriorWeight)}</TableCell>
                <TableCell className="text-xs text-right font-bold text-primary">{pct(result.cashWeight)}</TableCell>
                <TableCell className={`text-xs text-right ${result.cashChange > 0 ? "text-green-600" : result.cashChange < 0 ? "text-red-600" : "text-gray-400"}`}>
                  {result.cashChange > 0 ? "+" : ""}{pct(result.cashChange)}
                </TableCell>
                <TableCell className="text-xs text-center"><Badge variant="outline" className="text-[10px]">BASE</Badge></TableCell>
                <TableCell className="text-xs text-center">—</TableCell>
                <TableCell className="text-xs text-center"><Badge variant="outline" className="text-[10px] bg-gray-50">RESERVE</Badge></TableCell>
              </TableRow>
              {/* ETF rows */}
              {allocs.map((etf) => {
                const rc = diag.riskContributions.find((r) => r.ticker === etf.ticker);
                return (
                  <TableRow
                    key={etf.ticker}
                    className={`cursor-pointer hover:bg-gray-50/80 border-b border-gray-100 ${!etf.active ? "opacity-55" : ""}`}
                    onClick={() => setEtfDrawer(etf as any)}
                  >
                    <TableCell className="text-xs font-semibold text-primary">
                      <EtfLink ticker={etf.ticker} />
                    </TableCell>
                    <TableCell className="text-xs text-gray-600 max-w-28 truncate">{etf.name}</TableCell>
                    <TableCell className={`text-xs text-center font-bold ${getCellColor(etf.factorScores.composite)}`}>
                      {etf.factorScores.composite.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{pct(etf.priorWeight)}</TableCell>
                    <TableCell className={`text-xs text-right font-semibold ${etf.active ? "text-gray-900" : "text-gray-400"}`}>
                      {pct(etf.weight)}
                    </TableCell>
                    <TableCell className={`text-xs text-right ${Math.abs(etf.change) > 0.001 ? etf.change > 0 ? "text-green-600" : "text-red-600" : "text-gray-400"}`}>
                      {Math.abs(etf.change) > 0.001 ? (etf.change > 0 ? "+" : "") + pct(etf.change) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {etf.active
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" />
                        : <XCircle className="h-3.5 w-3.5 text-gray-300 inline" />
                      }
                    </TableCell>
                    <TableCell className="text-xs text-center text-muted-foreground">
                      {rc ? pct(rc.riskContributionPct) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      <Badge variant="outline" className={etf.active ? "text-[10px] bg-green-50 text-green-700 border-green-200" : "text-[10px] text-gray-400 border-gray-200"}>
                        {etf.active ? "ACTIVE" : "OUT"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Trade list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" /> Trade List
          </CardTitle>
          <CardDescription>Full execution list implied by this rebalance. Committee approval happens in Investment Committee.</CardDescription>
        </CardHeader>
        <CardContent>
          {activeTrades.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No active trades — run a rebalance to generate the trade list.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Ticker</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs text-right">From</TableHead>
                  <TableHead className="text-xs text-right">To</TableHead>
                  <TableHead className="text-xs text-right">Δ Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTrades.map((t: any) => {
                  const delta = (t.toWeight ?? 0) - (t.fromWeight ?? 0);
                  return (
                    <TableRow key={t.ticker}>
                      <TableCell className="text-xs font-medium">{t.ticker}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className={
                          t.action === "BUY" || t.action === "ADD" || t.action === "INCREASE"
                            ? "text-[10px] bg-green-50 text-green-700 border-green-200"
                            : t.action === "SELL" || t.action === "REMOVE" || t.action === "DECREASE"
                            ? "text-[10px] bg-red-50 text-red-700 border-red-200"
                            : "text-[10px]"
                        }>
                          {t.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{t.fromWeight !== undefined ? pct(t.fromWeight) : "—"}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{t.toWeight !== undefined ? pct(t.toWeight) : "—"}</TableCell>
                      <TableCell className={`text-xs text-right font-semibold ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : "text-gray-400"}`}>
                        {Math.abs(delta) > 0.0001 ? (delta > 0 ? "+" : "") + pct(delta) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Send to Committee CTA */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Send className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-900">Ready to route this allocation to the Investment Committee?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Final evidence package — backtest integrity, robustness, risk, and decision log — awaits committee review.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setLocation("/investment-committee")}>
            Open Investment Committee <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
