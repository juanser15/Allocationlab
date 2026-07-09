import { useState, useEffect, useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { localSettings, DEFAULT_BENCHMARKS_SETTINGS, type BenchmarksSettings } from "@/lib/local-settings";

const KNOWN_BENCHMARKS = ["SPY", "QQQ", "IWM", "VTI", "AGG", "EFA", "GLD"];

export function BenchmarksSection() {
  const { toast } = useToast();
  const { reportSectionStatus, restoreDefaultsSignal } = useSettingsDrawer();
  const [draft, setDraft] = useState<BenchmarksSettings>(() => localSettings.getBenchmarksSettings());
  const [saved, setSaved] = useState<BenchmarksSettings>(draft);
  const [newTicker, setNewTicker] = useState("");
  const lastRestoreSignal = useRef(restoreDefaultsSignal);

  useEffect(() => {
    if (restoreDefaultsSignal !== lastRestoreSignal.current) {
      lastRestoreSignal.current = restoreDefaultsSignal;
      localSettings.setBenchmarksSettings(DEFAULT_BENCHMARKS_SETTINGS);
      setDraft(DEFAULT_BENCHMARKS_SETTINGS);
      setSaved(DEFAULT_BENCHMARKS_SETTINGS);
    }
  }, [restoreDefaultsSignal]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const errors = useMemo(() => (draft.defaultBenchmark ? [] : ["A default benchmark must be selected."]), [draft]);

  useEffect(() => {
    reportSectionStatus("benchmarks", { dirty, errorCount: errors.length });
  }, [dirty, errors, reportSectionStatus]);

  const allBenchmarks = useMemo(() => [...new Set([...KNOWN_BENCHMARKS, ...draft.customBenchmarks])], [draft.customBenchmarks]);

  const handleSave = () => {
    if (errors.length > 0) return;
    localSettings.setBenchmarksSettings(draft);
    setSaved(draft);
    toast({ title: "Benchmark settings saved", description: "New backtests in Research Lab will default to this benchmark." });
  };
  const handleCancel = () => setDraft(saved);
  const handleResetSection = () => setDraft(DEFAULT_BENCHMARKS_SETTINGS);

  const addCustom = () => {
    const t = newTicker.trim().toUpperCase();
    if (!t || draft.customBenchmarks.includes(t)) return;
    setDraft((d) => ({ ...d, customBenchmarks: [...d.customBenchmarks, t] }));
    setNewTicker("");
  };
  const removeCustom = (t: string) => {
    setDraft((d) => ({
      ...d,
      customBenchmarks: d.customBenchmarks.filter((x) => x !== t),
      defaultBenchmark: d.defaultBenchmark === t ? "SPY" : d.defaultBenchmark,
    }));
  };

  return (
    <SectionShell
      title="Benchmarks"
      description="The default benchmark used to seed backtest and tracking-error comparisons. Benchmarks are auto-detected from ticker columns present in your uploaded price data."
      dirty={dirty}
      errors={errors}
      onSave={handleSave}
      onCancel={handleCancel}
      onResetSection={handleResetSection}
      saveLabel="Save Benchmark Settings"
    >
      <div className="space-y-2">
        <Label>Default Benchmark</Label>
        <Select value={draft.defaultBenchmark} onValueChange={(v) => setDraft((d) => ({ ...d, defaultBenchmark: v }))}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {allBenchmarks.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Custom Benchmark Tickers</Label>
        <div className="flex flex-wrap gap-2">
          {draft.customBenchmarks.length === 0 && <span className="text-sm text-muted-foreground">None added.</span>}
          {draft.customBenchmarks.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
              {t}
              <button onClick={() => removeCustom(t)} className="hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="e.g. ACWI" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} className="h-8 text-sm w-40" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
          <Button size="sm" variant="outline" onClick={addCustom} disabled={!newTicker.trim()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Add
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
        <span>Add the ticker to your CSV or Yahoo Finance fetch in Data Sources to unlock tracking error for it in Research Lab.</span>
      </div>
    </SectionShell>
  );
}
