import { type ReactElement, useState } from "react";
import {
  useGetLatestResults,
  useGetOrCreateDecisionLog,
  useGetRiskModel,
  useUpdateDecisionLogStatus,
  useGetCommittee,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertCircle,
  Loader2,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Eye,
  ListChecks,
  ClipboardList,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  X,
  Plus,
  Download,
  AlertTriangle,
  Info,
  Scale,
  Layers,
  Gavel,
} from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import Reports from "@/pages/reports";
import HistoricalArchive from "@/pages/historical-archive";

const ACTION_STYLES: Record<string, { icon: ReactElement; className: string }> = {
  ADD: { icon: <Plus className="h-3 w-3" />, className: "bg-green-50 text-green-700 border-green-200" },
  INCREASE: { icon: <ArrowUpRight className="h-3 w-3" />, className: "bg-green-50 text-green-700 border-green-200" },
  DECREASE: { icon: <ArrowDownRight className="h-3 w-3" />, className: "bg-amber-50 text-amber-700 border-amber-200" },
  TRIM: { icon: <ArrowDownRight className="h-3 w-3" />, className: "bg-amber-50 text-amber-700 border-amber-200" },
  REMOVE: { icon: <X className="h-3 w-3" />, className: "bg-red-50 text-red-700 border-red-200" },
  HOLD: { icon: <Minus className="h-3 w-3" />, className: "bg-gray-50 text-gray-600 border-gray-200" },
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-300",
  under_review: "bg-amber-50 text-amber-700 border-amber-300",
  approved: "bg-green-50 text-green-700 border-green-300",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  under_review: "Under Review",
  approved: "Approved",
};

const STANCE_CLASS: Record<string, string> = {
  support: "bg-green-100 text-green-800 border-green-300",
  modify: "bg-amber-100 text-amber-800 border-amber-300",
  reject: "bg-red-100 text-red-800 border-red-300",
};

const STANCE_LABEL: Record<string, string> = {
  support: "Supports",
  modify: "Modifies",
  reject: "Rejects",
};

const PERSONA_ICON: Record<string, typeof TrendingUp> = {
  macro_strategist: Layers,
  momentum_analyst: TrendingUp,
  risk_manager: Scale,
  portfolio_construction_analyst: TrendingDown,
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StanceBadge({ stance }: { stance: string }) {
  return (
    <Badge variant="outline" className={STANCE_CLASS[stance] ?? ""}>
      {STANCE_LABEL[stance] ?? stance}
    </Badge>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 60 ? "bg-green-600" : value >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-600 tabular-nums">{value}%</span>
    </div>
  );
}

export default function InvestmentCommittee() {
  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();

  const sessionId = latestResult?.sessionId;
  const {
    data: decisionLog,
    isLoading: loadingDecisionLog,
    refetch: refetchDecisionLog,
  } = useGetOrCreateDecisionLog(sessionId ?? 0);
  const updateStatus = useUpdateDecisionLogStatus();
  const { data: riskModel } = useGetRiskModel();

  const [committeeRequested, setCommitteeRequested] = useState(false);
  const {
    data: committee,
    isLoading: loadingCommittee,
    error: committeeError,
    refetch: refetchCommittee,
  } = useGetCommittee({
    query: { enabled: !!sessionId && committeeRequested },
  } as any);

  const handleGenerateCommitteePack = () => {
    setCommitteeRequested(true);
    refetchCommittee();
  };

  const handleStatusChange = (status: "draft" | "under_review" | "approved") => {
    if (!decisionLog) return;
    updateStatus.mutate(
      { id: decisionLog.id, data: { status, approvedBy: status === "approved" ? "Investment Committee" : undefined } },
      { onSuccess: () => refetchDecisionLog() }
    );
  };

  const content = decisionLog?.content;
  const tradeList = content?.tradeList ?? [];
  const activeTrades = tradeList.filter((t) => t.action !== "HOLD");

  const downloadMemo = () => {
    if (!committee) return;
    const blob = new Blob([committee.memo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `committee-memo-session-${committee.sessionId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        section="5 · Investment Committee"
        title="Investment Committee"
        description="Monthly rebalance decision room, structured recommendations, approval workflow, and the AI committee's deterministic analysis."
      />

      {!sessionId && !loadingLatest && (
        <Alert className="bg-gray-50 border-gray-200">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          <AlertDescription className="ml-2 flex items-center justify-between w-full flex-wrap gap-2">
            <span>No allocation run to review yet. Run a rebalance in Portfolio Lab first.</span>
            <Link href="/portfolio-lab" className="text-sm font-medium underline flex items-center">
              Go to Portfolio Lab <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="decision-room">
        <TabsList>
          <TabsTrigger value="decision-room">Decision Room</TabsTrigger>
          <TabsTrigger value="ai-committee">AI Committee Analysis</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="archive">Archive</TabsTrigger>
        </TabsList>

        {/* ── Decision Room Tab ── */}
        <TabsContent value="decision-room" className="space-y-6 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-primary">PM Decision Room</h2>
            {decisionLog && (
              <Badge variant="outline" className={STATUS_STYLES[decisionLog.status]}>
                {STATUS_LABELS[decisionLog.status]}
              </Badge>
            )}
          </div>

          {sessionId && loadingDecisionLog && (
            <div className="space-y-2">
              <div className="h-24 bg-gray-100 rounded animate-pulse" />
            </div>
          )}

          {sessionId && content && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" /> Market View
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-700 leading-relaxed">{content.marketView}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-amber-600" /> Key Risks
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {content.keyRisks.map((risk, i) => (
                        <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                          <span className="text-amber-600 mt-1">&bull;</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-primary" /> Risk Model Evidence
                  </CardTitle>
                  <CardDescription>Quantitative risk backing for the committee's view, computed from the current allocation and price history.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!riskModel?.hasSufficientData ? (
                    <p className="text-sm text-muted-foreground">
                      {riskModel?.insufficientReason ?? "Risk model data unavailable."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Ann. Volatility</p>
                          <p className="font-semibold text-gray-900">{(riskModel.annualizedVolatility! * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Downside Vol</p>
                          <p className="font-semibold text-gray-900">{(riskModel.downsideVolatility! * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Risk Concentration</p>
                          <p className="font-semibold text-gray-900">{riskModel.concentrationRisk!.toFixed(2)} HHI</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Diversification</p>
                          <p className="font-semibold text-gray-900">{riskModel.diversificationScore!.toFixed(0)}/100</p>
                        </div>
                      </div>
                      {riskModel.warnings.length > 0 && (
                        <ul className="space-y-1 pt-1">
                          {riskModel.warnings.map((w) => (
                            <li key={w.id} className="text-xs text-amber-800 flex items-start gap-1.5">
                              <span className="mt-0.5">&bull;</span>
                              <span>{w.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-muted-foreground pt-1">
                        Full breakdown (MCR/CCR by ETF, beta, sector decomposition) available in Portfolio Lab &rarr; Risk Model Pro.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-primary" /> Portfolio Actions
                  </CardTitle>
                  <CardDescription>Recommended allocation changes with rationale tied to model factors.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {activeTrades.length === 0 && (
                    <p className="text-sm text-muted-foreground">No allocation changes recommended this cycle.</p>
                  )}
                  {activeTrades.map((trade) => {
                    const style = ACTION_STYLES[trade.action] ?? ACTION_STYLES.HOLD;
                    return (
                      <div key={trade.ticker} className="border rounded-md p-3 bg-gray-50/50">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`${style.className} flex items-center gap-1`}>
                              {style.icon} {trade.action}
                            </Badge>
                            <span className="font-semibold text-gray-900 text-sm">{trade.ticker}</span>
                            <span className="text-xs text-muted-foreground">{trade.name}</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {pct(trade.fromWeight)} &rarr; {pct(trade.toWeight)}
                            <span className={trade.deltaWeight >= 0 ? "text-green-700 ml-1.5" : "text-red-700 ml-1.5"}>
                              ({trade.deltaWeight >= 0 ? "+" : ""}
                              {(trade.deltaWeight * 100).toFixed(1)}pp)
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 mt-2 leading-relaxed">{trade.rationale}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" /> Watchlist
                  </CardTitle>
                  <CardDescription>Names close to inclusion, blocked this cycle. Full detail available in Results &amp; Diagnostics.</CardDescription>
                </CardHeader>
                <CardContent>
                  {content.watchlist.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No names on the watchlist.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {content.watchlist.map((w) => (
                        <div key={w.ticker} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900">{w.ticker}</span>
                            <span className="text-xs text-muted-foreground">score {w.compositeScore.toFixed(0)}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">{w.improvement}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <ClipboardList className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                <span>
                  The full trade list and target allocation table live in{" "}
                  <Link href="/portfolio-lab" className="underline font-medium text-primary">Portfolio Lab</Link>.
                </span>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-sm">Decision Log</CardTitle>
                      <CardDescription>Auditable record of committee review and approval.</CardDescription>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLES[decisionLog!.status]}>
                      {STATUS_LABELS[decisionLog!.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Portfolio Version</p>
                      <p className="font-medium text-gray-900">{decisionLog!.portfolioVersion}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Regime</p>
                      <p className="font-medium text-gray-900">
                        {decisionLog!.regimeLabel} ({decisionLog!.regimeComposite})
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Created</p>
                      <p className="font-medium text-gray-900">{new Date(decisionLog!.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Approved By</p>
                      <p className="font-medium text-gray-900">{decisionLog!.approvedBy ?? "—"}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-2 flex-wrap">
                    {decisionLog!.status === "draft" && (
                      <Button size="sm" onClick={() => handleStatusChange("under_review")} disabled={updateStatus.isPending}>
                        Submit for Review
                      </Button>
                    )}
                    {decisionLog!.status === "under_review" && (
                      <>
                        <Button size="sm" onClick={() => handleStatusChange("approved")} disabled={updateStatus.isPending}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleStatusChange("draft")} disabled={updateStatus.isPending}>
                          Send Back to Draft
                        </Button>
                      </>
                    )}
                    {decisionLog!.status === "approved" && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange("draft")} disabled={updateStatus.isPending}>
                        Reopen as Draft
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── AI Committee Analysis Tab ── */}
        <TabsContent value="ai-committee" className="space-y-6 pt-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground max-w-2xl">
              A deterministic, rule-based synthesis of the current session's regime, factor, diagnostics, watchlist, and
              backtest integrity data — every statement traces back to a computed number, nothing is generated or fabricated.
            </p>
            <div className="flex items-center gap-2">
              {committee && (
                <Button variant="outline" size="sm" onClick={downloadMemo} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> Export Committee Memo
                </Button>
              )}
              <Button size="sm" onClick={handleGenerateCommitteePack} disabled={!sessionId || loadingCommittee} className="gap-1.5">
                {loadingCommittee ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}
                {committee ? "Regenerate Committee Pack" : "Generate Committee Pack"}
              </Button>
            </div>
          </div>

          {!sessionId && (
            <Card className="border-gray-200 bg-gray-50">
              <CardContent className="py-10 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700 mb-1">No allocation run to build a committee pack from.</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Run a rebalance in Portfolio Lab first, then return here to generate the committee pack.
                </p>
                <div className="flex items-center justify-center gap-1 mt-4 text-xs">
                  <Link href="/portfolio-lab" className="text-primary underline inline-flex items-center gap-1">
                    Go to Portfolio Lab <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {sessionId && !committeeRequested && (
            <Card className="border-gray-200 bg-gray-50">
              <CardContent className="py-10 text-center">
                <Gavel className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700 mb-1">Committee pack not yet generated for this session.</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Click Generate Committee Pack above to synthesize persona recommendations and the CIO's final view.
                </p>
              </CardContent>
            </Card>
          )}

          {loadingCommittee && (
            <div className="flex items-center gap-3 text-muted-foreground text-sm py-12 justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Convening committee...
            </div>
          )}

          {committeeError && !loadingCommittee && committeeRequested && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-10 text-center">
                <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-amber-800 mb-1">No committee data available yet.</p>
                <p className="text-xs text-amber-700 max-w-md mx-auto">
                  Run a rebalance first to generate the regime, diagnostics, and allocation data the committee needs.
                </p>
                <div className="flex items-center justify-center gap-1 mt-4 text-xs">
                  <Link href="/portfolio-lab" className="text-primary underline inline-flex items-center gap-1">
                    Go to Portfolio Lab <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {!loadingCommittee && !committeeError && committee && (
            <>
              <Card className="border-l-4 border-l-primary">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Gavel className="h-4 w-4 text-primary" />
                      CIO Final Recommendation
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <StanceBadge stance={committee.cio.stance} />
                      <ConfidenceBar value={committee.cio.confidence} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-gray-800 leading-relaxed">{committee.cio.summary}</p>
                  {committee.cio.dissent.length > 0 && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2 flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" /> Dissenting Views
                      </p>
                      <ul className="space-y-1.5 text-xs text-amber-800">
                        {committee.cio.dissent.map((d, i) => (
                          <li key={i}>&bull; {d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              {committee.dataQualityNotes.length > 0 && (
                <div className="space-y-2">
                  {committee.dataQualityNotes.map((n, i) => (
                    <div key={i} className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-700">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                      {n}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Committee Debate</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {committee.recommendations.map((r) => {
                    const Icon = PERSONA_ICON[r.personaId] ?? Layers;
                    return (
                      <Card key={r.personaId}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Icon className="h-4 w-4 text-primary/70" />
                              {r.personaLabel}
                            </CardTitle>
                            <StanceBadge stance={r.stance} />
                          </div>
                          <CardDescription className="pt-1">
                            <ConfidenceBar value={r.confidence} />
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-gray-800 leading-relaxed">{r.summary}</p>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Evidence</p>
                            <ul className="space-y-1 text-xs text-gray-600">
                              {r.evidence.map((e, i) => (
                                <li key={i} className="flex gap-1.5">
                                  <span className="text-gray-300">&bull;</span>
                                  <span>{e}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Key Concern</p>
                            <p className="text-xs text-gray-700 leading-snug">{r.keyConcern}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                <span>
                  <Badge variant="outline" className="mr-2 text-[10px] align-middle">Methodology</Badge>
                  Each persona's stance, confidence, and evidence are derived deterministically from the latest session's
                  regime scores, factor scores, portfolio diagnostics, watchlist, and backtest integrity audit (when
                  available). Confidence is automatically downgraded — with a stated reason — whenever underlying data is
                  incomplete or the backtest integrity check has not passed.
                </span>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Report Tab ── */}
        <TabsContent value="report" className="pt-4">
          <div className="-mx-4 sm:-mx-8 -mt-4">
            <Reports />
          </div>
        </TabsContent>

        {/* ── Archive Tab ── */}
        <TabsContent value="archive" className="pt-4">
          <div className="-mx-4 sm:-mx-8 -mt-4">
            <HistoricalArchive />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
