import { useState, useEffect, useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { localSettings, DEFAULT_EXECUTION_ASSUMPTIONS, type ExecutionAssumptions } from "@/lib/local-settings";

export function ExecutionAssumptionsSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const [draft, setDraft] = useState<ExecutionAssumptions>(() => localSettings.getExecutionAssumptions());
  const [saved, setSaved] = useState<ExecutionAssumptions>(draft);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      localSettings.setExecutionAssumptions(DEFAULT_EXECUTION_ASSUMPTIONS);
      setDraft(DEFAULT_EXECUTION_ASSUMPTIONS);
      setSaved(DEFAULT_EXECUTION_ASSUMPTIONS);
    }
  }, [restoreDefaultsSignal]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (draft.transactionCostBps < 0 || draft.transactionCostBps > 500) errs.push("Transaction cost must be between 0 and 500 bps.");
    if (draft.slippageBps < 0 || draft.slippageBps > 500) errs.push("Slippage must be between 0 and 500 bps.");
    if (draft.cashYieldAnnualPct < 0 || draft.cashYieldAnnualPct > 20) errs.push("Cash yield must be between 0% and 20%.");
    if (draft.minTradeSizeUsd < 0 || draft.minTradeSizeUsd > 10_000_000) errs.push("Minimum trade size must be between $0 and $10,000,000.");
    return errs;
  }, [draft]);

  useEffect(() => {
    reportSectionStatus("execution", { dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const handleSave = () => {
    if (errors.length > 0) return;
    localSettings.setExecutionAssumptions(draft);
    setSaved(draft);
    toast({ title: "Execution assumptions saved", description: "New backtests in Research Lab will default to these values." });
  };

  const handleCancel = () => setDraft(saved);
  const handleResetSection = () => {
    setDraft(DEFAULT_EXECUTION_ASSUMPTIONS);
  };

  return (
    <SectionShell
      title="Execution Assumptions"
      description="Default execution timing and cost assumptions. These seed the Backtesting configuration in Research Lab — each backtest run can still override them for that run only."
      dirty={dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saveLabel="Save Execution Assumptions"
    >
      <div className="space-y-3">
        <Label>Execution Timing</Label>
        <RadioGroup
          value={draft.executionTiming}
          onValueChange={(v) => setDraft((d) => ({ ...d, executionTiming: v as ExecutionAssumptions["executionTiming"] }))}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="next_close" id="ea-next-close" />
            <Label htmlFor="ea-next-close" className="text-sm font-normal">Next close (fills at the close following the decision)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="next_open" id="ea-next-open" />
            <Label htmlFor="ea-next-open" className="text-sm font-normal">Next open (fills at the following day's open)</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Transaction Cost (bps)</Label>
          <Input type="number" value={draft.transactionCostBps} onChange={(e) => setDraft((d) => ({ ...d, transactionCostBps: parseFloat(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-2">
          <Label>Slippage (bps)</Label>
          <Input type="number" value={draft.slippageBps} onChange={(e) => setDraft((d) => ({ ...d, slippageBps: parseFloat(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-2">
          <Label>Cash Yield (annual %)</Label>
          <Input type="number" step="0.1" value={draft.cashYieldAnnualPct} onChange={(e) => setDraft((d) => ({ ...d, cashYieldAnnualPct: parseFloat(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-2">
          <Label>Rebalance Frequency</Label>
          <RadioGroup
            value={draft.rebalanceFrequency}
            onValueChange={(v) => setDraft((d) => ({ ...d, rebalanceFrequency: v as ExecutionAssumptions["rebalanceFrequency"] }))}
            className="flex gap-4 pt-1"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="monthly" id="ea-monthly" />
              <Label htmlFor="ea-monthly" className="text-sm font-normal">Monthly</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="quarterly" id="ea-quarterly" />
              <Label htmlFor="ea-quarterly" className="text-sm font-normal">Quarterly</Label>
            </div>
          </RadioGroup>
        </div>
        <div className="space-y-2">
          <Label>Minimum Trade Size ($)</Label>
          <Input type="number" step="50" value={draft.minTradeSizeUsd} onChange={(e) => setDraft((d) => ({ ...d, minTradeSizeUsd: parseFloat(e.target.value) || 0 }))} />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
        <span>Cash drag is modeled by applying the cash yield above to cash balances between rebalances during backtests. Minimum trade size filters out sub-threshold orders in Trade Implementation.</span>
      </div>
    </SectionShell>
  );
}
