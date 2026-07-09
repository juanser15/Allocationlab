import { useState, useEffect, useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { localSettings, DEFAULT_GOVERNANCE_SETTINGS, type GovernanceSettings } from "@/lib/local-settings";

const MODEL_VERSION = "1.0.0";
const DATA_VERSION = "yahoo-finance-v1";

export function GovernanceSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const [draft, setDraft] = useState<GovernanceSettings>(() => localSettings.getGovernanceSettings());
  const [saved, setSaved] = useState<GovernanceSettings>(draft);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      localSettings.setGovernanceSettings(DEFAULT_GOVERNANCE_SETTINGS);
      setDraft(DEFAULT_GOVERNANCE_SETTINGS);
      setSaved(DEFAULT_GOVERNANCE_SETTINGS);
    }
  }, [restoreDefaultsSignal]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  useEffect(() => {
    reportSectionStatus("governance", { dirty, errorCount: 0 });
  }, [dirty, reportSectionStatus]);

  const handleSave = () => {
    localSettings.setGovernanceSettings(draft);
    setSaved(draft);
    toast({ title: "Governance settings saved" });
  };
  const handleCancel = () => setDraft(saved);
  const handleResetSection = () => setDraft(DEFAULT_GOVERNANCE_SETTINGS);

  const handleResetLocalSettings = () => {
    localSettings.resetAllLocalSettings();
    toast({ title: "Local settings reset", description: "Execution assumptions, benchmarks, reporting defaults, and governance settings were restored to their institutional defaults." });
    setDraft(DEFAULT_GOVERNANCE_SETTINGS);
    setSaved(DEFAULT_GOVERNANCE_SETTINGS);
  };

  return (
    <SectionShell
      title="Governance & Advanced"
      description="Version tracking, archive behavior, and audit trail references for this configuration."
      dirty={dirty}
      errors={[]}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saveLabel="Save Governance Settings"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div className="rounded border border-gray-200 p-3">
          <div className="text-xs text-muted-foreground">Model Version</div>
          <div className="font-medium text-gray-900 mt-0.5">{MODEL_VERSION}</div>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="text-xs text-muted-foreground">Parameter Version</div>
          <div className="font-medium text-gray-900 mt-0.5">{draft.parameterVersion}</div>
        </div>
        <div className="rounded border border-gray-200 p-3">
          <div className="text-xs text-muted-foreground">Data Source Version</div>
          <div className="font-medium text-gray-900 mt-0.5">{DATA_VERSION}</div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <div className="space-y-0.5">
          <Label>Archive Rebalances Automatically</Label>
          <p className="text-sm text-muted-foreground">Every completed committee run is written to the Historical Archive for audit.</p>
        </div>
        <Switch checked={draft.archiveAutomatically} onCheckedChange={(c) => setDraft((d) => ({ ...d, archiveAutomatically: c }))} />
      </div>

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
        <span>
          Full approval audit trail lives in the{" "}
          <Link href="/investment-committee" className="underline font-medium text-primary">Investment Committee</Link>{" "}
          decision log — every status transition (Draft → Under Review → Approved) is timestamped and attributed.
        </span>
      </div>

      <div className="rounded border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-destructive font-medium text-sm">
          <ShieldAlert className="h-4 w-4" />
          Reset Application State
        </div>
        <p className="text-sm text-gray-700">
          Clears locally-stored settings (Execution Assumptions, Benchmarks, Reporting Defaults, Governance) back to
          institutional defaults. Universe, constraints, and uploaded price data are not affected — use Restore
          Institutional Defaults at the top of this drawer for those.
        </p>
        <Button variant="destructive" size="sm" onClick={handleResetLocalSettings} type="button">
          Reset Local Settings
        </Button>
      </div>
    </SectionShell>
  );
}
