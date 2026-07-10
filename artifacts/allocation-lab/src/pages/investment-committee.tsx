import { type ReactElement, useState, useMemo } from "react";
import {
  useGetLatestResults,
  useGetOrCreateDecisionLog,
  useGetRiskModel,
  useGetScenarioStressMeta,
  useUpdateDecisionLogStatus,
  useGetCommittee,
  useGetTradeImplementationMeta,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
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
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Clock,
  History,
  Lock,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import Reports from "@/pages/reports";
import HistoricalArchive from "@/pages/historical-archive";
import { GovernanceDashboard } from "@/components/committee/GovernanceDashboard";
import { useToast } from "@/hooks/use-toast";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { toast } = useToast();
  const { data: latestResult, isLoading: loadingLatest } = useGetLatestResults();

  const sessionId = latestResult?.sessionId;
  const {
    data: decisionLog,
    isLoading: loadingDecisionLog,
    refetch: refetchDecisionLog,
  } = useGetOrCreateDecisionLog(sessionId ?? 0, {
    query: { enabled: !!sessionId }
  } as any);
  
  const updateStatus = useUpdateDecisionLogStatus();
  const { data: riskModel } = useGetRiskModel();
  const { data: scenarioMeta } = useGetScenarioStressMeta();
  const { data: tradeImplMeta } = useGetTradeImplementationMeta();

  const [committeeRequested, setCommitteeRequested] = useState(false);
  const {
    data: committee,
    isLoading: loadingCommittee,
    error: committeeError,
    refetch: refetchCommittee,
  } = useGetCommittee({
    query: { enabled: !!sessionId && committeeRequested },
  } as any);

  const [drawerContent, setDrawerContent] = useState<"risk" | "scenario" | "trade" | null>(null);

  const handleGenerateCommitteePack = () => {
    setCommitteeRequested(true);
    refetchCommittee().then(() => {
      toast({
        title: "Committee Pack Generated",
        description: "Persona recommendations and CIO synthesis are now available.",
      });
    });
  };

  const handleStatusChange = (status: "draft" | "under_review" | "approved") => {
    if (!decisionLog) return;
    updateStatus.mutate(
      { id: decisionLog.id, data: { status, approvedBy: status === "approved" ? "Investment Committee" : undefined } },
      { 
        onSuccess: () => {
          refetchDecisionLog();
          toast({
            title: `Status changed to ${STATUS_LABELS[status]}`,
            description: `The decision log has been updated.`,
          });
        } 
      }
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
    toast({
      title: "Memo Downloaded",
      description: "Committee memo downloaded successfully.",
    });
  };

  const isApproved = decisionLog?.status === "approved";
  const isGenerating = loadingCommittee || (committeeRequested && !committee && !committeeError);

  const renderSkeleton = () => (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3"></div>
      <div className="h-32 bg-gray-200 rounded w-full"></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-48 bg-gray-200 rounded"></div>
        <div className="h-48 bg-gray-200 rounded"></div>
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto space-y-8 pb-32 relative">
      <PageHeader
        section="5 · Investment Committee"
        title="Decision Room"
        description="Review systematic recommendations, simulate committee debates, and finalize the portfolio allocation."
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

      <Tabs defaultValue="decision-room" className="space-y-8">
        <TabsList className="bg-gray-100/50 p-1">
          <TabsTrigger value="decision-room" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Decision Room</TabsTrigger>
          <TabsTrigger value="ai-committee" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">AI Committee Analysis</TabsTrigger>
          <TabsTrigger value="report" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Report</TabsTrigger>
          <TabsTrigger value="archive" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Archive</TabsTrigger>
          <TabsTrigger value="governance" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Governance</TabsTrigger>
        </TabsList>

        {/* ── Decision Room Tab ── */}
        <TabsContent value="decision-room" className="m-0 space-y-10">
          {sessionId && loadingDecisionLog && renderSkeleton()}

          {sessionId && !loadingDecisionLog && content && (
            <div className="space-y-12">
              
              {/* SECTION: Evidence Summary */}
              <section className="space-y-6">
                <div className="border-b pb-4">
                  <h2 className="text-xl font-semibold text-primary tracking-tight">I. Evidence Summary</h2>
                  <p className="text-muted-foreground text-sm mt-1">Quantitative backing and market context for the proposed allocation.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="border-gray-200 shadow-sm">
                    <CardHeader className="pb-3 bg-gray-50/50">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                        <TrendingUp className="h-4 w-4" /> Market View
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <p className="text-sm text-gray-700 leading-relaxed">{content.marketView}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-gray-200 shadow-sm">
                    <CardHeader className="pb-3 bg-gray-50/50">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                        <ShieldAlert className="h-4 w-4" /> Key Risks
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <ul className="space-y-2.5">
                        {content.keyRisks.map((risk, i) => (
                          <li key={i} className="text-sm text-gray-700 flex items-start gap-2.5">
                            <span className="text-amber-600 font-bold mt-0.5">&bull;</span>
                            <span className="leading-snug">{risk}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Risk Model */}
                  <Card className="border-gray-200 shadow-sm hover:border-gray-300 transition-colors cursor-pointer" onClick={() => setDrawerContent('risk')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between text-primary">
                        <span className="flex items-center gap-2"><Scale className="h-4 w-4" /> Risk Profile</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!riskModel?.hasSufficientData ? (
                        <p className="text-sm text-muted-foreground">{riskModel?.insufficientReason ?? "Unavailable."}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Ann. Vol</span>} explanation="Annualized Volatility of the target portfolio based on the covariance model." />
                            <p className="font-semibold text-gray-900 text-lg">{(riskModel.annualizedVolatility! * 100).toFixed(1)}%</p>
                          </div>
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Diversification</span>} explanation="Diversification score out of 100, measuring how well risk is distributed." />
                            <p className="font-semibold text-gray-900 text-lg">{riskModel.diversificationScore!.toFixed(0)}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Scenario Stress */}
                  <Card className="border-gray-200 shadow-sm hover:border-gray-300 transition-colors cursor-pointer" onClick={() => setDrawerContent('scenario')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between text-primary">
                        <span className="flex items-center gap-2"><History className="h-4 w-4" /> Stress Testing</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!scenarioMeta?.hasAllocation ? (
                        <p className="text-sm text-muted-foreground">Unavailable.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Macros</span>} explanation="Macro proxies available for shocks." />
                            <p className="font-semibold text-gray-900 text-lg">{scenarioMeta.proxies.filter((p) => p.available).length}</p>
                          </div>
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Scenarios</span>} explanation="Historical scenarios ready to replay." />
                            <p className="font-semibold text-gray-900 text-lg">{scenarioMeta.scenarios.filter((s) => s.available).length}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Trade Implementation */}
                  <Card className="border-gray-200 shadow-sm hover:border-gray-300 transition-colors cursor-pointer" onClick={() => setDrawerContent('trade')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between text-primary">
                        <span className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Implementation</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!tradeImplMeta?.ready ? (
                        <p className="text-sm text-muted-foreground">{tradeImplMeta?.reason ?? "Unavailable."}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Active ETFs</span>} explanation="Number of ETFs requiring trades." />
                            <p className="font-semibold text-gray-900 text-lg">{tradeImplMeta.activeEtfCount}</p>
                          </div>
                          <div>
                            <MetricTooltip label={<span className="text-xs text-muted-foreground">Prior Weights</span>} explanation="Are previous weights configured to allow delta calculation?" />
                            <p className="font-semibold text-gray-900 text-lg">{tradeImplMeta.hasPreviousWeights ? "Yes" : "No"}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Portfolio Actions */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader className="pb-3 bg-gray-50/50">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <ListChecks className="h-4 w-4" /> Recommended Portfolio Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-3">
                    {activeTrades.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No allocation changes recommended this cycle.</p>
                    ) : (
                      activeTrades.map((trade) => {
                        const style = ACTION_STYLES[trade.action] ?? ACTION_STYLES.HOLD;
                        return (
                          <div key={trade.ticker} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-md bg-white">
                            <div className="space-y-1 max-w-xl">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={`${style.className} flex items-center gap-1 font-semibold px-2 py-0.5`}>
                                  {style.icon} {trade.action}
                                </Badge>
                                <span className="font-bold text-gray-900">{trade.ticker}</span>
                                <span className="text-sm text-muted-foreground">{trade.name}</span>
                              </div>
                              <p className="text-sm text-gray-600 leading-relaxed">{trade.rationale}</p>
                            </div>
                            <div className="text-right shrink-0 bg-gray-50 px-4 py-2 rounded-md border border-gray-100">
                              <div className="text-sm text-muted-foreground mb-0.5">Weight Change</div>
                              <div className="text-base font-medium text-gray-900 flex items-center justify-end gap-1.5">
                                <span className="text-gray-500">{pct(trade.fromWeight)}</span>
                                <ArrowRight className="h-3 w-3 text-gray-400" />
                                <span>{pct(trade.toWeight)}</span>
                              </div>
                              <div className={`text-xs font-semibold mt-1 ${trade.deltaWeight >= 0 ? "text-green-700" : "text-red-700"}`}>
                                {trade.deltaWeight >= 0 ? "+" : ""}{(trade.deltaWeight * 100).toFixed(1)}pp
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </section>

              {/* SECTION: Committee Synthesis */}
              <section className="space-y-6">
                <div className="border-b pb-4 flex justify-between items-end">
                  <div>
                    <h2 className="text-xl font-semibold text-primary tracking-tight">II. Committee Debate & Synthesis</h2>
                    <p className="text-muted-foreground text-sm mt-1">Simulated perspectives assessing the recommendation.</p>
                  </div>
                  {!committeeRequested && !committee && (
                    <Button onClick={handleGenerateCommitteePack} disabled={!sessionId} className="gap-2">
                      <Gavel className="h-4 w-4" /> Generate Pack
                    </Button>
                  )}
                </div>

                {!committeeRequested && !committee && (
                  <div className="py-16 text-center border-2 border-dashed rounded-lg border-gray-200 bg-gray-50">
                    <Gavel className="h-10 w-10 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">Synthesize Perspectives</h3>
                    <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
                      Generate the AI committee pack to review persona stances, debates, and the CIO's final summary.
                    </p>
                    <Button onClick={handleGenerateCommitteePack} disabled={!sessionId} className="gap-2">
                      <Gavel className="h-4 w-4" /> Generate Committee Pack
                    </Button>
                  </div>
                )}

                {isGenerating && (
                  <div className="space-y-6">
                    <Skeleton className="h-32 w-full" />
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-48 w-full" />
                      <Skeleton className="h-48 w-full" />
                    </div>
                  </div>
                )}

                {committeeError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Generation Failed</AlertTitle>
                    <AlertDescription>
                      Failed to synthesize committee perspectives. Ensure the allocation run is complete and data is available.
                    </AlertDescription>
                  </Alert>
                )}

                {!isGenerating && !committeeError && committee && (
                  <div className="space-y-8">
                    {/* CIO Synthesis */}
                    <Card className="border-l-4 border-l-primary shadow-md overflow-hidden">
                      <div className="bg-primary/5 px-6 py-4 border-b border-primary/10 flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary text-primary-foreground p-2 rounded-md">
                            <Gavel className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-primary">CIO Final Recommendation</h3>
                            <p className="text-xs text-primary/70">Consensus View</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-md border shadow-sm">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground font-medium mb-0.5">Stance</div>
                            <StanceBadge stance={committee.cio.stance} />
                          </div>
                          <Separator orientation="vertical" className="h-8" />
                          <div>
                            <div className="text-xs text-muted-foreground font-medium mb-1">Confidence</div>
                            <ConfidenceBar value={committee.cio.confidence} />
                          </div>
                        </div>
                      </div>
                      <CardContent className="p-6 space-y-6">
                        <div>
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Synthesis</h4>
                          <p className="text-base text-gray-800 leading-relaxed font-medium">{committee.cio.summary}</p>
                        </div>
                        
                        {committee.cio.dissent.length > 0 && (
                          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4">
                            <h4 className="text-sm font-semibold uppercase tracking-wider text-amber-800 mb-2 flex items-center gap-1.5">
                              <ShieldAlert className="h-4 w-4" /> Key Dissenting Views
                            </h4>
                            <ul className="space-y-2">
                              {committee.cio.dissent.map((d, i) => (
                                <li key={i} className="text-sm text-amber-900/90 flex items-start gap-2">
                                  <span className="text-amber-500 mt-0.5">&bull;</span>
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Committee Personas */}
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Persona Debates</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        {committee.recommendations.map((r) => {
                          const Icon = PERSONA_ICON[r.personaId] ?? Layers;
                          return (
                            <Card key={r.personaId} className="shadow-sm">
                              <CardHeader className="pb-3 border-b bg-gray-50/30">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                                    <Icon className="h-4 w-4 text-primary/60" />
                                    {r.personaLabel}
                                  </CardTitle>
                                  <StanceBadge stance={r.stance} />
                                </div>
                                <div className="mt-2 pt-2 border-t border-dashed">
                                  <ConfidenceBar value={r.confidence} />
                                </div>
                              </CardHeader>
                              <CardContent className="pt-4 space-y-4">
                                <p className="text-sm text-gray-700 leading-relaxed">{r.summary}</p>
                                
                                <div className="bg-gray-50 rounded p-3 border border-gray-100">
                                  <p className="text-xs font-semibold text-gray-900 mb-1.5">Evidence & Concerns</p>
                                  <ul className="space-y-1.5">
                                    {r.evidence.slice(0, 2).map((e, i) => (
                                      <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                                        <span className="text-gray-400 mt-0.5">&bull;</span>
                                        <span>{e}</span>
                                      </li>
                                    ))}
                                    <li className="text-xs text-amber-700 flex gap-1.5 mt-2 font-medium">
                                      <span className="text-amber-500 mt-0.5">&bull;</span>
                                      <span>{r.keyConcern}</span>
                                    </li>
                                  </ul>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Sticky Action Bar */}
              <div className="fixed bottom-0 left-0 right-0 border-t bg-white/95 backdrop-blur-md shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.05)] z-40 p-4">
                <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Decision Status</p>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Badge variant="outline" className={STATUS_STYLES[decisionLog.status]}>
                          {STATUS_LABELS[decisionLog.status]}
                        </Badge>
                        {decisionLog.approvedBy && <span>by {decisionLog.approvedBy}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {decisionLog.status === "draft" && (
                      <>
                        <Button 
                          variant="default"
                          className="bg-primary hover:bg-primary/90 min-w-[140px]" 
                          onClick={() => handleStatusChange("under_review")} 
                          disabled={updateStatus.isPending || !committee}
                        >
                          {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
                          Submit for Review
                        </Button>
                      </>
                    )}
                    
                    {decisionLog.status === "under_review" && (
                      <>
                        <Button 
                          variant="outline"
                          className="border-amber-200 text-amber-700 hover:bg-amber-50"
                          onClick={() => handleStatusChange("draft")} 
                          disabled={updateStatus.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-2" /> Request Changes
                        </Button>
                        <Button 
                          className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
                          onClick={() => handleStatusChange("approved")} 
                          disabled={updateStatus.isPending}
                        >
                          {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          Approve Allocation
                        </Button>
                      </>
                    )}

                    {decisionLog.status === "approved" && (
                      <>
                        <Button 
                          variant="outline" 
                          onClick={() => handleStatusChange("draft")} 
                          disabled={updateStatus.isPending}
                        >
                          <History className="h-4 w-4 mr-2" /> Reopen to Draft
                        </Button>
                        <Button 
                          disabled 
                          className="bg-green-50 text-green-700 border border-green-200 opacity-100 min-w-[140px]"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" /> Approved
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}
        </TabsContent>

        {/* ── AI Committee Analysis Tab ── */}
        <TabsContent value="ai-committee" className="m-0 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>Committee Generation Logs</CardTitle>
                  <CardDescription>Raw output and data quality notes from the simulation.</CardDescription>
                </div>
                {committee && (
                  <Button variant="outline" size="sm" onClick={downloadMemo} className="gap-2">
                    <Download className="h-4 w-4" /> Download Raw Memo
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!committee ? (
                <div className="py-12 text-center text-muted-foreground">
                  Generate the committee pack in the Decision Room first.
                </div>
              ) : (
                <div className="space-y-6">
                  {committee.dataQualityNotes.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Data Quality Constraints</h4>
                      {committee.dataQualityNotes.map((n, i) => (
                        <Alert key={i} className="bg-amber-50/50 border-amber-200">
                          <Info className="h-4 w-4 text-amber-600" />
                          <AlertDescription className="text-amber-800 text-sm ml-2">{n}</AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  )}
                  
                  <div>
                     <h4 className="text-sm font-semibold mb-2">Methodology Note</h4>
                     <p className="text-sm text-gray-600 p-4 bg-gray-50 rounded-md border border-gray-100">
                      Each persona's stance, confidence, and evidence are derived deterministically from the latest session's
                      regime scores, factor scores, portfolio diagnostics, watchlist, and backtest integrity audit.
                      Confidence is automatically downgraded — with a stated reason — whenever underlying data is
                      incomplete or the backtest integrity check has not passed.
                     </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Report Tab ── */}
        <TabsContent value="report" className="m-0">
          {!isApproved ? (
            <Card className="border-gray-200 bg-gray-50/50 border-dashed">
              <CardContent className="py-16 text-center">
                <Lock className="h-10 w-10 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Reports Locked</h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  The allocation must be approved in the Decision Room before official reports can be generated.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Reports />
          )}
        </TabsContent>

        {/* ── Archive Tab ── */}
        <TabsContent value="archive" className="m-0">
          {!isApproved ? (
            <Card className="border-gray-200 bg-gray-50/50 border-dashed">
              <CardContent className="py-16 text-center">
                <Lock className="h-10 w-10 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Archive Locked</h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  The allocation must be approved before it can be committed to the historical archive.
                </p>
              </CardContent>
            </Card>
          ) : (
            <HistoricalArchive />
          )}
        </TabsContent>

        {/* ── Governance Tab ── */}
        <TabsContent value="governance" className="m-0">
          <GovernanceDashboard />
        </TabsContent>
      </Tabs>

      {/* Detail Drawers */}
      <DetailDrawer 
        open={drawerContent !== null} 
        onOpenChange={(open) => !open && setDrawerContent(null)}
        title={
          drawerContent === 'risk' ? 'Risk Model Breakdown' : 
          drawerContent === 'scenario' ? 'Scenario & Stress Detail' : 
          'Trade Implementation Details'
        }
        description="Detailed quantitative evidence for this allocation cycle."
      >
        {drawerContent === 'risk' && riskModel && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-md">
               <div>
                 <p className="text-xs text-muted-foreground mb-1">Ann. Volatility</p>
                 <p className="font-medium">{(riskModel.annualizedVolatility! * 100).toFixed(1)}%</p>
               </div>
               <div>
                 <p className="text-xs text-muted-foreground mb-1">Downside Vol</p>
                 <p className="font-medium">{(riskModel.downsideVolatility! * 100).toFixed(1)}%</p>
               </div>
            </div>
            {riskModel.warnings.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-sm font-semibold">Model Warnings</h4>
                <ul className="space-y-2">
                  {riskModel.warnings.map(w => (
                    <li key={w.id} className="text-sm text-amber-800 bg-amber-50 p-2 rounded flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4 italic">
              Full breakdown (MCR/CCR by ETF, beta, sector decomposition) is available in Portfolio Lab &rarr; Risk Model Pro.
            </p>
          </div>
        )}

        {drawerContent === 'scenario' && scenarioMeta && (
          <div className="space-y-4">
             <h4 className="text-sm font-semibold border-b pb-2">Available Macro Proxies</h4>
             <ul className="space-y-2">
               {scenarioMeta.proxies.map(p => (
                 <li key={p.key} className="flex justify-between text-sm">
                   <span>{p.label}</span>
                   <Badge variant={p.available ? "outline" : "secondary"}>{p.available ? "Ready" : "Missing Data"}</Badge>
                 </li>
               ))}
             </ul>
             <p className="text-sm text-muted-foreground mt-4 italic">
               Run user-defined shocks or historical stress replays in Research Lab &rarr; Scenario &amp; Stress Lab.
             </p>
          </div>
        )}

        {drawerContent === 'trade' && tradeImplMeta && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-md">
               <div>
                 <p className="text-xs text-muted-foreground mb-1">Active ETFs</p>
                 <p className="font-medium">{tradeImplMeta.activeEtfCount}</p>
               </div>
               <div>
                 <p className="text-xs text-muted-foreground mb-1">Previous Weights</p>
                 <p className="font-medium">{tradeImplMeta.hasPreviousWeights ? "Configured" : "Missing"}</p>
               </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4 italic">
               Full trade list, turnover, cost estimate, and CSV blotter export available in Portfolio Lab &rarr; Trade Implementation.
             </p>
          </div>
        )}
      </DetailDrawer>

    </div>
  );
}
