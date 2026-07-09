import { useState, useEffect, useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { localSettings, DEFAULT_REPORTING_DEFAULTS, type ReportingDefaults } from "@/lib/local-settings";

export function ReportingDefaultsSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const [draft, setDraft] = useState<ReportingDefaults>(() => localSettings.getReportingDefaults());
  const [saved, setSaved] = useState<ReportingDefaults>(draft);
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      localSettings.setReportingDefaults(DEFAULT_REPORTING_DEFAULTS);
      setDraft(DEFAULT_REPORTING_DEFAULTS);
      setSaved(DEFAULT_REPORTING_DEFAULTS);
    }
  }, [restoreDefaultsSignal]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!draft.reportTitle.trim()) errs.push("Report title cannot be empty.");
    if (!draft.portfolioName.trim()) errs.push("Portfolio name cannot be empty.");
    return errs;
  }, [draft]);

  useEffect(() => {
    reportSectionStatus("reporting", { dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const handleSave = () => {
    if (errors.length > 0) return;
    localSettings.setReportingDefaults(draft);
    setSaved(draft);
    toast({ title: "Reporting defaults saved", description: "These prefill new committee reports." });
  };
  const handleCancel = () => setDraft(saved);
  const handleResetSection = () => setDraft(DEFAULT_REPORTING_DEFAULTS);

  return (
    <SectionShell
      title="Reporting Defaults"
      description="Default text and export settings used when a new committee report is created. Each report can still be edited individually in Investment Committee."
      dirty={dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saveLabel="Save Reporting Defaults"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Report Title</Label>
          <Input value={draft.reportTitle} onChange={(e) => setDraft((d) => ({ ...d, reportTitle: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Report Subtitle</Label>
          <Input value={draft.reportSubtitle} onChange={(e) => setDraft((d) => ({ ...d, reportSubtitle: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Portfolio Name</Label>
          <Input value={draft.portfolioName} onChange={(e) => setDraft((d) => ({ ...d, portfolioName: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Date Format</Label>
          <Select value={draft.dateFormat} onValueChange={(v) => setDraft((d) => ({ ...d, dateFormat: v as ReportingDefaults["dateFormat"] }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Default Export Format</Label>
          <Select value={draft.exportFormat} onValueChange={(v) => setDraft((d) => ({ ...d, exportFormat: v as ReportingDefaults["exportFormat"] }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="png">PNG</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Disclaimer Text</Label>
        <Textarea rows={3} value={draft.disclaimerText} onChange={(e) => setDraft((d) => ({ ...d, disclaimerText: e.target.value }))} />
      </div>
    </SectionShell>
  );
}
