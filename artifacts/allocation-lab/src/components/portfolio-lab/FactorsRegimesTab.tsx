import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFactorLibrary, getGetFactorLibraryQueryKey,
  useUpdateFactorLibrary, useRestoreFactorLibrary,
  type RunResult, type FactorDefinitionInput, type FactorLibrary
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import {
  FlaskConical, Activity, TrendingUp, TrendingDown, History, Plus, Save, RotateCcw,
} from "lucide-react";
import { FactorDetailDrawer } from "./FactorDetailDrawer";
import { FactorCorrelationMatrix } from "./FactorCorrelationMatrix";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

// ─── Regime definitions ──────────────────────────────────────────────────────

function getRegimeBadgeStyle(label: string) {
  switch (label) {
    case "Risk-On":      return "bg-green-100 text-green-800 border-green-200";
    case "Constructive": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "Neutral":      return "bg-amber-50 text-amber-800 border-amber-200";
    case "Cautious":     return "bg-orange-50 text-orange-800 border-orange-200";
    case "Risk-Off":     return "bg-red-100 text-red-800 border-red-200";
    default:             return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getBarColor(score: number) {
  if (score >= 65) return "bg-green-500";
  if (score >= 45) return "bg-amber-400";
  return "bg-red-500";
}

function getCellColor(val: number | null | undefined) {
  if (val === null || val === undefined) return "bg-gray-50 text-gray-400";
  if (val >= 80) return "bg-green-100 text-green-800 font-semibold";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800 font-semibold";
}

const REGIME_COMPONENTS = [
  { key: "trend",      label: "Trend",      description: "Measures the overall price trend of the universe. High scores indicate broad upward trending.",   methodology: "Composite of 20D, 60D, and 252D momentum scores aggregated cross-sectionally. A score above 60 signals a bullish trend environment." },
  { key: "breadth",    label: "Breadth",    description: "Market breadth indicator. Measures the percentage of universe ETFs above key moving averages.",   methodology: "Proportion of ETFs above their 50D and 200D moving averages, averaged and scaled 0–100. Values above 60 indicate broad participation." },
  { key: "volatility", label: "Volatility", description: "Realized volatility regime. High scores indicate a low-volatility environment (Risk-On).",         methodology: "Inverse of cross-sectional realized volatility aggregate. EWMA-weighted. Scored 0–100 where 100 = minimal volatility stress." },
  { key: "liquidity",  label: "Liquidity",  description: "Proxy for market liquidity conditions. Derived from bid-ask spreads and trading volume patterns.", methodology: "Proxied from volatility regime and trend breadth. Direct liquidity data requires external feed integration." },
] as const;

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      <div className="border-b border-gray-200 mt-3" />
    </div>
  );
}

const createDefaultFactor = (): FactorDefinitionInput => ({
  id: crypto.randomUUID(),
  name: "New Factor",
  description: "",
  family: "Custom",
  enabled: true,
  status: "candidate",
  inputSeries: "",
  calculationType: "momentum",
  formula: "",
  direction: "higher_is_better",
  lookback: 20,
  lag: 0,
  normalization: "percentile_rank",
  winsorizationLower: 0.05,
  winsorizationUpper: 0.95,
  missingDataTreatment: "exclude",
  baseWeight: 10,
  regimeWeights: { riskOn: 10, neutral: 10, riskOff: 10 },
  activeRegimes: ["risk_on", "neutral", "risk_off"],
  dataSource: "Internal",
  benchmarkTicker: null,
});

export function FactorsRegimesTab({ result, hasData, hasRun }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: library, isLoading: loadingLib } = useGetFactorLibrary();
  const updateLibrary = useUpdateFactorLibrary();
  const restoreLibrary = useRestoreFactorLibrary();

  const [localFactors, setLocalFactors] = useState<FactorDefinitionInput[]>([]);
  const initializedVersion = useRef<string | null>(null);

  const [drawerFactor, setDrawerFactor] = useState<FactorDefinitionInput | null>(null);
  const [componentDetail, setComponentDetail] = useState<typeof REGIME_COMPONENTS[number] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sync with server data
  useEffect(() => {
    if (library && library.version !== initializedVersion.current) {
      setLocalFactors(library.factors.map(f => ({ ...f })));
      initializedVersion.current = library.version;
    }
  }, [library]);

  if (!hasData) return <EmptyState icon={FlaskConical} title="Valid price history is required." description="Upload price data to compute factor and regime scores." />;

  const isSaving = updateLibrary.isPending || restoreLibrary.isPending;
  const hasChanges = JSON.stringify(localFactors) !== JSON.stringify(library?.factors.map(f => {
    const { version, currentCoverage, availabilityReason, ...rest } = f as any;
    return rest;
  }));

  const handleSaveFactor = (updated: FactorDefinitionInput) => {
    setLocalFactors(prev => {
      const exists = prev.some(p => p.id === updated.id);
      if (exists) {
        return prev.map(p => p.id === updated.id ? updated : p);
      }
      return [...prev, updated];
    });
  };

  const handleDeleteFactor = (id: string) => {
    setLocalFactors(prev => prev.filter(p => p.id !== id));
  };

  const handleAddFactor = () => {
    const newFactor = createDefaultFactor();
    setDrawerFactor(newFactor);
  };

  const handleSaveLibrary = () => {
    updateLibrary.mutate({ data: { factors: localFactors } }, {
      onSuccess: () => {
        toast({ title: "Factor library saved", description: "The updated configuration has been committed." });
        queryClient.invalidateQueries({ queryKey: getGetFactorLibraryQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "Failed to save library", description: err?.response?.data?.error || err?.message || "An error occurred", variant: "destructive" });
      }
    });
  };

  const handleRestore = (version: string) => {
    restoreLibrary.mutate({ version }, {
      onSuccess: () => {
        toast({ title: "Library restored", description: `Restored to version ${version}` });
        setHistoryOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetFactorLibraryQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "Failed to restore", description: err?.response?.data?.error || err?.message || "An error occurred", variant: "destructive" });
      }
    });
  };

  const allocs = result?.allocations.slice().sort((a, b) => b.factorScores.composite - a.factorScores.composite) || [];
  const regime = result?.regime;

  // Render variables for workspace
  const activeFactors = localFactors.filter(f => f.status === "active");
  const candidateFactors = localFactors.filter(f => f.status === "candidate");
  const disabledFactors = localFactors.filter(f => f.status === "disabled");

  // Historic run columns for heatmap
  const historicFactors = result?.allocations[0]?.factorContributions.map(c => ({
    id: c.factorId,
    name: c.factorName
  })) || [];

  return (
    <div className="space-y-8">
      {/* ── Factor drawer ── */}
      <FactorDetailDrawer
        open={!!drawerFactor}
        onOpenChange={(open) => !open && setDrawerFactor(null)}
        factor={drawerFactor}
        result={result}
        onSave={handleSaveFactor}
        onDelete={handleDeleteFactor}
      />

      {/* ── Regime drawer ── */}
      <DetailDrawer
        open={!!componentDetail}
        onOpenChange={(o) => !o && setComponentDetail(null)}
        title={componentDetail ? `Regime Component: ${componentDetail.label}` : ""}
      >
        {componentDetail && regime && (
          <div className="space-y-5 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
              <p className="text-gray-700 leading-relaxed">{componentDetail.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Methodology</h4>
              <p className="text-gray-700 leading-relaxed">{componentDetail.methodology}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Current Score</h4>
              <div className="text-3xl font-bold text-primary">{regime[componentDetail.key as keyof typeof regime]?.toString()}</div>
              <div className="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${getBarColor(Number(regime[componentDetail.key as keyof typeof regime]))}`} style={{ width: `${Number(regime[componentDetail.key as keyof typeof regime])}%` }} />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* ── Version History Dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Factor Library History</DialogTitle>
            <DialogDescription>Restore an older version of the factor configurations.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader className="bg-gray-50 sticky top-0">
                <TableRow>
                  <TableHead className="text-xs">Version</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-center">Active</TableHead>
                  <TableHead className="text-xs text-center">Total</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {library?.history.map(h => (
                  <TableRow key={h.version}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{h.version}</TableCell>
                    <TableCell className="text-xs">{new Date(h.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-center">{h.activeFactorCount}</TableCell>
                    <TableCell className="text-xs text-center">{h.factorCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => handleRestore(h.version)} disabled={isSaving}>
                        <RotateCcw className="h-3 w-3 mr-1" /> Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {library?.history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">No history available.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          SECTION 1 — FACTOR WORKSPACE
      ════════════════════════════════════════ */}
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Factor Workspace</h2>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
              Persistent factor configurations. 
              {library && <Badge variant="secondary" className="text-[10px] h-5 font-mono">{library.version}</Badge>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="h-3.5 w-3.5 mr-1.5" /> History
            </Button>
            <Button variant="outline" size="sm" onClick={handleAddFactor}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New Factor
            </Button>
            <Button size="sm" disabled={!hasChanges || isSaving} onClick={handleSaveLibrary}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save Library
            </Button>
          </div>
        </div>

        <Tabs defaultValue="active" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="active" className="text-xs">Active ({activeFactors.length})</TabsTrigger>
            <TabsTrigger value="candidate" className="text-xs">Candidate ({candidateFactors.length})</TabsTrigger>
            <TabsTrigger value="disabled" className="text-xs">Disabled ({disabledFactors.length})</TabsTrigger>
          </TabsList>

          {["active", "candidate", "disabled"].map(status => {
            const list = status === "active" ? activeFactors : status === "candidate" ? candidateFactors : disabledFactors;
            return (
              <TabsContent key={status} value={status} className="m-0 space-y-4">
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-gray-50">
                        <TableRow>
                          <TableHead className="text-xs font-semibold text-gray-700">Name / Family</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-700 text-center">Type</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-700 text-center">Lookback</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-700 text-center">Base Wt</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-700 text-center">Coverage</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-700 text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map(f => {
                          const orig = library?.factors.find(orig => orig.id === f.id);
                          const isNew = !orig;
                          const isEdited = !isNew && JSON.stringify(f) !== JSON.stringify({
                            ...orig, version: undefined, currentCoverage: undefined, availabilityReason: undefined
                          });
                          return (
                            <TableRow key={f.id} className={`hover:bg-gray-50/70 ${isEdited ? "bg-amber-50/20" : ""}`}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div>
                                    <div className="font-semibold text-xs text-primary">{f.name}</div>
                                    <div className="text-[10px] text-muted-foreground">{f.family}</div>
                                  </div>
                                  {isEdited && <div className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
                                  {isNew && <Badge className="h-4 px-1 text-[8px] bg-green-500">NEW</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground">{f.calculationType.replace(/_/g, " ")}</TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground tabular-nums">{f.lookback}d</TableCell>
                              <TableCell className="text-center text-xs font-medium tabular-nums">{f.baseWeight}</TableCell>
                              <TableCell className="text-center text-xs tabular-nums">
                                {orig ? `${(orig.currentCoverage * 100).toFixed(0)}%` : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] hover:bg-gray-100" onClick={() => setDrawerFactor(f)}>
                                  Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {list.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                              No {status} factors.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>

        {/* Evidence Blocks */}
        {hasRun && result && (
          <div className="mt-6 space-y-6">
            <FactorCorrelationMatrix result={result} factorIds={historicFactors.map(f => f.id)} />

            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-semibold text-primary">Factor Heatmap — Full Universe</CardTitle>
                <CardDescription>All ETFs ranked by composite score from the latest run. Displays effective historic factors.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0 max-h-[500px]">
                <Table>
                  <TableHeader className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="text-[10px] text-center w-8">#</TableHead>
                      <TableHead className="text-[10px]">Ticker</TableHead>
                      <TableHead className="text-[10px] text-center bg-primary/5 border-r border-l">Composite</TableHead>
                      {historicFactors.map(f => (
                        <TableHead key={f.id} className="text-[10px] text-center whitespace-nowrap px-2" title={f.name}>
                          {f.name.length > 10 ? f.name.substring(0, 8) + '…' : f.name}
                        </TableHead>
                      ))}
                      <TableHead className="text-[10px] text-center border-l">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocs.map((etf, idx) => (
                      <TableRow key={etf.ticker} className="hover:bg-gray-50/70 border-b border-gray-100">
                        <TableCell className="text-center text-[10px] text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-semibold text-xs text-primary">{etf.ticker}</TableCell>
                        <TableCell className={`text-center text-xs font-bold border-r border-l ${getCellColor(etf.factorScores.composite)}`}>
                          {etf.factorScores.composite.toFixed(0)}
                        </TableCell>
                        {historicFactors.map(f => {
                          const c = etf.factorContributions.find(c => c.factorId === f.id);
                          return (
                            <TableCell key={f.id} className={`text-center text-[11px] tabular-nums ${getCellColor(c?.normalizedValue)}`}>
                              {c?.normalizedValue !== null && c?.normalizedValue !== undefined ? c.normalizedValue.toFixed(0) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center border-l">
                          <Badge variant="outline" className={etf.active ? "text-[9px] bg-green-50 text-green-700 border-green-200 h-4" : "text-[9px] text-gray-400 h-4"}>
                            {etf.active ? "ACTIVE" : "OUT"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════
          SECTION 2 — MARKET REGIME
      ════════════════════════════════════════ */}
      {hasRun && regime && (
        <>
          <SectionHeader title="Market Regime Analysis" description="Systematic regime detection from trend, breadth, volatility, and liquidity signals." />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 border-l-4 border-l-primary">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Current Market Regime
                </CardTitle>
                <CardDescription>Determined from composite of trend, breadth, volatility, and liquidity signals.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className={`inline-flex items-center px-4 py-2 rounded-full text-base font-semibold border ${getRegimeBadgeStyle(regime.label)}`}>
                    {regime.label === "Risk-On" ? <TrendingUp className="h-4 w-4 mr-2" /> : regime.label === "Risk-Off" ? <TrendingDown className="h-4 w-4 mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
                    {regime.label}
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold text-primary">{regime.composite.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Composite / 100</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {REGIME_COMPONENTS.map((comp) => {
                    const score = Number(regime[comp.key as keyof typeof regime] || 0);
                    return (
                      <button
                        key={comp.key}
                        onClick={() => setComponentDetail(comp)}
                        className="w-full text-left border rounded-md px-4 py-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-semibold text-gray-700">{comp.label}</span>
                          <span className="text-sm font-bold text-gray-900 tabular-nums">{score.toFixed(0)}</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${getBarColor(score)}`} style={{ width: `${score}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-1">{comp.description}</p>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Regime Map</CardTitle>
                <CardDescription>Three portfolio regime states.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Risk-On",  range: "≥ 60", desc: "Strong trend + breadth. Momentum and trend factors dominant.",        active: regime.composite >= 60 },
                  { label: "Neutral",  range: "40–60", desc: "Mixed signals. Balanced factor weights. Elevated cash buffer.",       active: regime.composite >= 40 && regime.composite < 60 },
                  { label: "Risk-Off", range: "< 40",  desc: "Weak/declining trend. Volatility and drawdown factors dominant.",    active: regime.composite < 40 },
                ].map(({ label, range, desc, active }) => (
                  <div key={label} className={`border rounded-md px-3 py-3 ${active ? "border-primary bg-primary/5 shadow-sm" : "border-gray-200"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className={`text-[10px] ${getRegimeBadgeStyle(label)}`}>{label}</Badge>
                      {active && <Badge className="text-[10px] bg-primary text-white">CURRENT</Badge>}
                      <span className="text-[10px] text-muted-foreground">{range}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
