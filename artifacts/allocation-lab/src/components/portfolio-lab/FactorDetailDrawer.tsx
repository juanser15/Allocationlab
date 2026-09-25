import React, { useState, useEffect } from "react";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, FileText, BarChart3, Info } from "lucide-react";
import type { FactorDefinitionInput, RunResult, FactorContribution } from "@workspace/api-client-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factor: FactorDefinitionInput | null;
  result: RunResult | undefined;
  onSave: (factor: FactorDefinitionInput) => void;
  onDelete?: (id: string) => void;
}

export function FactorDetailDrawer({ open, onOpenChange, factor, result, onSave, onDelete }: Props) {
  const [activeTab, setActiveTab] = useState("config");
  const [draft, setDraft] = useState<FactorDefinitionInput | null>(null);

  useEffect(() => {
    if (factor) setDraft({ ...factor });
  }, [factor]);

  if (!draft) return null;

  const normalizationDescription = draft.normalization === "percentile_rank"
    ? "Midrank percentile across valid ETFs, scaled 0–100 (ties share their average rank)."
    : draft.normalization === "z_score"
      ? "50 + 15 × sample z-score, clipped to 0–100."
      : "50 + 15 × robust z-score (1.4826 × MAD scale), clipped to 0–100.";

  const handleSave = () => {
    if (draft) {
      onSave(draft);
      onOpenChange(false);
    }
  };

  // Run evidence extraction
  let evidenceInfo = null;
  if (result && factor) {
    const allContribs: { ticker: string; weight: number; contrib: FactorContribution }[] = [];
    result.allocations.forEach(a => {
      const c = a.factorContributions.find(c => c.factorId === factor.id);
      if (c) allContribs.push({ ticker: a.ticker, weight: a.weight, contrib: c });
    });

    if (allContribs.length > 0) {
      // All contributions for the factor are identical in configuration fields for a given run
      const sample = allContribs[0].contrib;
      const validCount = allContribs.filter(c => c.contrib.available).length;
      const coverage = allContribs.length > 0 ? validCount / allContribs.length : 0;
      
      const isUnavailable = !sample.available && sample.unavailableReason;
      
      const sortedByScore = [...allContribs].sort((a, b) => 
        (b.contrib.normalizedValue ?? -999) - (a.contrib.normalizedValue ?? -999)
      );
      
      evidenceInfo = {
        sample,
        coverage,
        isUnavailable,
        sortedByScore
      };
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={draft.name || "Factor Details"}
      footer={
        <div className="flex justify-between items-center w-full">
          {onDelete ? (
            <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" onClick={() => {
              onDelete(draft.id);
              onOpenChange(false);
            }}>Remove Factor</Button>
          ) : <div />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <TabsList className="grid grid-cols-2 mb-4 bg-gray-100 p-1 rounded-md shrink-0">
          <TabsTrigger value="config" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <FileText className="h-3.5 w-3.5 mr-2" /> Configuration
          </TabsTrigger>
          <TabsTrigger value="evidence" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <BarChart3 className="h-3.5 w-3.5 mr-2" /> Run Evidence
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto min-h-0 pr-2 pb-6 space-y-6">
          <TabsContent value="config" className="m-0 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status</Label>
                <Select value={draft.status} onValueChange={(v: any) => setDraft({ ...draft, status: v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="candidate">Candidate</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex flex-col justify-end">
                <div className="flex items-center space-x-2 h-8">
                  <Checkbox 
                    id="enabled" 
                    checked={draft.enabled} 
                    onCheckedChange={(c) => setDraft({ ...draft, enabled: !!c })}
                  />
                  <Label htmlFor="enabled" className="text-sm cursor-pointer">Enabled (Compute Signal)</Label>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">Identity & Description</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Name</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Family / Group</Label>
                  <Input value={draft.family} onChange={(e) => setDraft({ ...draft, family: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="text-sm min-h-[80px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Formula</Label>
                <Input value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} className="h-8 text-sm font-mono" />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">Signal Computation</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Calculation Type</Label>
                  <Select value={draft.calculationType} onValueChange={(v: any) => setDraft({ ...draft, calculationType: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="momentum">Momentum</SelectItem>
                      <SelectItem value="trend_quality">Trend Quality</SelectItem>
                      <SelectItem value="volatility">Volatility</SelectItem>
                      <SelectItem value="drawdown">Drawdown</SelectItem>
                      <SelectItem value="mean_reversion">Mean Reversion</SelectItem>
                      <SelectItem value="relative_strength">Relative Strength</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Direction</Label>
                  <Select value={draft.direction} onValueChange={(v: any) => setDraft({ ...draft, direction: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="higher_is_better">Higher is Better</SelectItem>
                      <SelectItem value="lower_is_better">Lower is Better</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Lookback (Days)</Label>
                  <Input type="number" value={draft.lookback} onChange={(e) => setDraft({ ...draft, lookback: Number(e.target.value) })} className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Lag (Days)</Label>
                  <Input type="number" value={draft.lag} onChange={(e) => setDraft({ ...draft, lag: Number(e.target.value) })} className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Input Series</Label>
                  <Input value={draft.inputSeries} onChange={(e) => setDraft({ ...draft, inputSeries: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Normalization</Label>
                  <Select value={draft.normalization} onValueChange={(v: any) => setDraft({ ...draft, normalization: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentile_rank">Percentile Rank</SelectItem>
                      <SelectItem value="z_score">Z-Score</SelectItem>
                      <SelectItem value="robust_z_score">Robust Z-Score</SelectItem>
                    </SelectContent>
                  </Select>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">{normalizationDescription}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Winsorization Lower Quantile</Label>
                  <Input type="number" min={0} max={0.49} step={0.01} value={draft.winsorizationLower}
                    onChange={(e) => setDraft({ ...draft, winsorizationLower: Number(e.target.value) })}
                    className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Winsorization Upper Quantile</Label>
                  <Input type="number" min={0.51} max={1} step={0.01} value={draft.winsorizationUpper}
                    onChange={(e) => setDraft({ ...draft, winsorizationUpper: Number(e.target.value) })}
                    className="h-8 text-sm" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Direction is applied first; type-7 interpolated cross-sectional quantiles clip values before normalization.
              </p>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">Regime & Weights</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Base Weight</Label>
                  <Input type="number" value={draft.baseWeight} onChange={(e) => setDraft({ ...draft, baseWeight: Number(e.target.value) })} className="h-8 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Missing Data</Label>
                  <Select value={draft.missingDataTreatment} onValueChange={(v: any) => setDraft({ ...draft, missingDataTreatment: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">Exclude</SelectItem>
                      <SelectItem value="cross_sectional_median">CS Median</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="bg-gray-50 p-3 rounded-md border border-gray-100">
                <Label className="text-xs font-semibold mb-3 block">Regime-Specific Weights</Label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase">Risk-On</Label>
                    <Input type="number" value={draft.regimeWeights.riskOn ?? 0} onChange={(e) => setDraft({ ...draft, regimeWeights: { ...draft.regimeWeights, riskOn: Number(e.target.value) } })} className="h-8 text-sm border-green-200 focus-visible:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase">Neutral</Label>
                    <Input type="number" value={draft.regimeWeights.neutral ?? 0} onChange={(e) => setDraft({ ...draft, regimeWeights: { ...draft.regimeWeights, neutral: Number(e.target.value) } })} className="h-8 text-sm border-amber-200 focus-visible:ring-amber-500" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground uppercase">Risk-Off</Label>
                    <Input type="number" value={draft.regimeWeights.riskOff ?? 0} onChange={(e) => setDraft({ ...draft, regimeWeights: { ...draft.regimeWeights, riskOff: Number(e.target.value) } })} className="h-8 text-sm border-red-200 focus-visible:ring-red-500" />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="evidence" className="m-0 space-y-6">
            {!result ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                No run results available. Run the optimizer to generate evidence.
              </div>
            ) : !evidenceInfo ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                Factor not present in the latest run. Make sure it is Enabled and Active.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 border p-3 rounded-md flex flex-col justify-center">
                    <Label className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Effective Regime Weight</Label>
                    <div className="text-2xl font-bold text-primary">{(evidenceInfo.sample.effectiveWeight * 100).toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Configured: {(evidenceInfo.sample.configuredWeight * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-gray-50 border p-3 rounded-md flex flex-col justify-center">
                    <Label className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Data Coverage</Label>
                    <div className={`text-2xl font-bold ${evidenceInfo.coverage < 1 ? "text-amber-600" : "text-green-600"}`}>
                      {(evidenceInfo.coverage * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {evidenceInfo.sortedByScore.filter(c => c.contrib.available).length} of {evidenceInfo.sortedByScore.length} ETFs
                    </div>
                  </div>
                </div>

                {evidenceInfo.isUnavailable && (
                  <div className="border border-red-200 bg-red-50 text-red-800 p-3 rounded text-sm flex items-start gap-2 font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{evidenceInfo.sample.unavailableReason ?? "Factor unavailable: required input data is missing."}</span>
                  </div>
                )}
                
                {!evidenceInfo.isUnavailable && evidenceInfo.sample.unavailableReason && (
                  <div className="border border-amber-200 bg-amber-50 text-amber-800 p-3 rounded text-sm flex items-start gap-2">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Partial coverage note: {evidenceInfo.sample.unavailableReason}</span>
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">Per-ETF Decomposition</h4>
                  <p className="text-[10px] text-muted-foreground">
                    Values are shown in order: raw → direction-transformed → winsorized → normalized. Effective weights renormalize over scored factors for each ETF.
                  </p>
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="p-2 font-medium">Ticker</th>
                          <th className="p-2 font-medium text-right">Raw</th>
                          <th className="p-2 font-medium text-right">Transformed</th>
                          <th className="p-2 font-medium text-right">Winsorized</th>
                          <th className="p-2 font-medium text-right">Normalized</th>
                          <th className="p-2 font-medium text-right">Configured Wt.</th>
                          <th className="p-2 font-medium text-right">Effective Wt.</th>
                          <th className="p-2 font-medium text-right">W. Contrib</th>
                          <th className="p-2 font-medium text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {evidenceInfo.sortedByScore.slice(0, 15).map(({ ticker, contrib }) => (
                          <tr key={ticker} className="hover:bg-gray-50/50">
                            <td className="p-2 font-semibold text-primary">{ticker}</td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">
                              {contrib.rawValue !== null ? contrib.rawValue.toFixed(4) : "—"}
                            </td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">
                              {contrib.transformedValue != null ? contrib.transformedValue.toFixed(4) : "—"}
                            </td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">
                              {contrib.winsorizedValue != null ? contrib.winsorizedValue.toFixed(4) : "—"}
                            </td>
                            <td className="p-2 text-right font-medium tabular-nums">
                              {contrib.normalizedValue !== null ? contrib.normalizedValue.toFixed(1) : "—"}
                            </td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">
                              {(contrib.configuredWeight * 100).toFixed(1)}%
                            </td>
                            <td className="p-2 text-right text-muted-foreground tabular-nums">
                              {(contrib.effectiveWeight * 100).toFixed(1)}%
                            </td>
                            <td className="p-2 text-right tabular-nums text-muted-foreground">
                              {contrib.weightedContribution !== null ? contrib.weightedContribution.toFixed(2) : "—"}
                            </td>
                            <td className="p-2 text-center">
                              {contrib.calculationStatus === "imputed" ? (
                                <Badge title={contrib.unavailableReason ?? undefined} variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 h-4">IMPUTED</Badge>
                              ) : contrib.available ? (
                                <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-200 h-4">OK</Badge>
                              ) : (
                                <Badge title={contrib.unavailableReason ?? undefined} variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200 h-4">N/A</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {evidenceInfo.sortedByScore.length > 15 && (
                    <p className="text-[10px] text-muted-foreground text-center">Showing top 15 highest scoring ETFs.</p>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </DetailDrawer>
  );
}
