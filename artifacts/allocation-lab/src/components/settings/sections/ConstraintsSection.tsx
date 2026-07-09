import { useState, useRef, useEffect, useMemo } from "react";
import { useGetConstraints, useUpdateConstraints } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";

export function ConstraintsSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const { data: constraints, isLoading, refetch } = useGetConstraints();
  const updateConstraints = useUpdateConstraints();

  const [draft, setDraft] = useState<any>(null);
  const [saved, setSaved] = useState<any>(null);
  const initialized = useRef(false);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (constraints && !initialized.current) {
      setDraft({ ...constraints });
      setSaved({ ...constraints });
      initialized.current = true;
    }
  }, [constraints]);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      initialized.current = false;
      refetch();
    }
  }, [restoreDefaultsSignal, refetch]);

  const dirty = useMemo(() => draft && saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const errors = useMemo(() => {
    if (!draft) return [];
    const errs: string[] = [];
    if (draft.cashMin < 0 || draft.cashMin > 1) errs.push("Cash minimum must be between 0% and 100%.");
    if (draft.cashMax < 0 || draft.cashMax > 1) errs.push("Cash maximum must be between 0% and 100%.");
    if (draft.cashMin > draft.cashMax) errs.push("Cash minimum cannot exceed cash maximum.");
    if (draft.maxEtfWeight <= 0 || draft.maxEtfWeight > 1) errs.push("Max ETF weight must be between 0% and 100%.");
    if (draft.targetActiveEtfs < 1) errs.push("Target active ETFs must be at least 1.");
    if (draft.targetActiveEtfs < 8) errs.push("Target active ETFs must be at least 8 per firm policy.");
    return errs;
  }, [draft]);

  useEffect(() => {
    reportSectionStatus("constraints", { dirty: !!dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const handleChange = (field: string, value: any) => setDraft((prev: any) => ({ ...prev, [field]: value }));

  const handleSave = () => {
    if (!draft || errors.length > 0) return;
    updateConstraints.mutate(
      { data: draft },
      {
        onSuccess: () => { setSaved({ ...draft }); toast({ title: "Constraints saved" }); },
        onError: () => toast({ title: "Error saving constraints", variant: "destructive" }),
      }
    );
  };

  const handleCancel = () => setDraft({ ...saved });
  const handleResetSection = () => { initialized.current = false; refetch(); };

  if (isLoading || !draft) {
    return <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <SectionShell
      title="Portfolio Constraints"
      description="Rules enforced during portfolio construction. Changes apply to every subsequent run."
      dirty={!!dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saving={updateConstraints.isPending}
      saveLabel="Save Constraints"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Cash Range (%)</Label>
          <span className="text-sm font-medium">{(draft.cashMin * 100).toFixed(1)}% - {(draft.cashMax * 100).toFixed(1)}%</span>
        </div>
        <div className="flex items-center space-x-4">
          <Input type="number" className="w-24" value={(draft.cashMin * 100).toFixed(1)} onChange={(e) => handleChange("cashMin", parseFloat(e.target.value) / 100)} />
          <span className="text-muted-foreground">to</span>
          <Input type="number" className="w-24" value={(draft.cashMax * 100).toFixed(1)} onChange={(e) => handleChange("cashMax", parseFloat(e.target.value) / 100)} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Max Single ETF Weight (%)</Label>
          <span className="text-sm font-medium">{(draft.maxEtfWeight * 100).toFixed(1)}%</span>
        </div>
        <Slider value={[draft.maxEtfWeight * 100]} min={1} max={30} step={1} onValueChange={(v) => handleChange("maxEtfWeight", v[0] / 100)} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Min Inclusion Threshold (Score)</Label>
          <span className="text-sm font-medium">{draft.minInclusionThreshold} pts</span>
        </div>
        <Slider value={[draft.minInclusionThreshold]} min={0} max={50} step={1} onValueChange={(v) => handleChange("minInclusionThreshold", v[0])} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Target Active ETFs</Label>
          <span className="text-sm font-medium">{draft.targetActiveEtfs}</span>
        </div>
        <Slider value={[draft.targetActiveEtfs]} min={1} max={20} step={1} onValueChange={(v) => handleChange("targetActiveEtfs", v[0])} />
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="space-y-0.5">
          <Label>Sector Diversification</Label>
          <p className="text-sm text-muted-foreground">Prevent over-concentration in a single sector</p>
        </div>
        <Switch checked={draft.diversificationEnabled} onCheckedChange={(c) => handleChange("diversificationEnabled", c)} />
      </div>

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
        <span>
          Turnover is not directly capped in construction; use the Execution Assumptions section to review the
          turnover impact of rebalance frequency in backtests.
        </span>
      </div>
    </SectionShell>
  );
}
