import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Compass, CheckCircle2 } from "lucide-react";
import { useUxPreferences } from "@/context/ux-preferences-context";
import { localSettings } from "@/lib/local-settings";
import { useState } from "react";

const UX_CHECKLIST_ITEMS: { id: string; label: string }[] = [
  { id: "status-bar", label: "Top status bar shows session, as-of date, freshness, and health at all times" },
  { id: "rail", label: "Workflow rail reflects real pipeline state (no fake progress)" },
  { id: "empty-states", label: "Every module has a clear empty/blocked state with no dead-end hyperlinks on the Dashboard" },
  { id: "tooltips", label: "Every non-obvious metric has a hover tooltip in plain English" },
  { id: "drilldowns", label: "Tables, cards, and chart segments open a drill-down drawer with detail" },
  { id: "feedback", label: "Long-running actions show a loading skeleton or spinner; completions show a toast" },
  { id: "sticky-actions", label: "Primary actions (run, submit, approve) are pinned in a sticky bar while scrolling" },
  { id: "visual-consistency", label: "Navy/gray institutional palette used consistently; no stray colors or emoji" },
];

export function OnboardingSection() {
  const { demoMode, setDemoMode, openTour } = useUxPreferences();
  const [checklist, setChecklist] = useState(() => localSettings.getUxChecklist());

  const toggleItem = (id: string) => {
    setChecklist((prev) => {
      const next = { items: { ...prev.items, [id]: !prev.items[id] } };
      localSettings.setUxChecklist(next);
      return next;
    });
  };

  const completedCount = UX_CHECKLIST_ITEMS.filter((i) => checklist.items[i.id]).length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-gray-900">Onboarding & Demo</h3>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          Replay the guided tour or switch on demo mode when presenting the app to someone new.
        </p>
      </div>

      <div className="flex items-center justify-between rounded border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <Compass className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <Label>Guided Tour</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              Walks through the status bar, workflow rail, the four modules, and Settings.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={openTour} type="button">
          Restart Tour
        </Button>
      </div>

      <div className="flex items-center justify-between rounded border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-amber-500 mt-0.5" />
          <div>
            <Label>Demo Mode</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              Shows a banner reminding viewers this is a walkthrough. Does not alter or fabricate any data — the
              app always reads real uploaded prices and real pipeline results.
            </p>
          </div>
        </div>
        <Switch checked={demoMode} onCheckedChange={setDemoMode} />
      </div>

      <div className="rounded border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <Label>UX Quality Checklist</Label>
          </div>
          <span className="text-xs text-muted-foreground">{completedCount}/{UX_CHECKLIST_ITEMS.length} verified</span>
        </div>
        <p className="text-sm text-muted-foreground -mt-1">
          Internal checklist for reviewing interactivity and clarity before shipping a UI change.
        </p>
        <div className="space-y-2.5 pt-1">
          {UX_CHECKLIST_ITEMS.map((item) => (
            <label key={item.id} className="flex items-start gap-2.5 text-sm cursor-pointer">
              <Checkbox
                checked={!!checklist.items[item.id]}
                onCheckedChange={() => toggleItem(item.id)}
                className="mt-0.5"
              />
              <span className={checklist.items[item.id] ? "text-gray-500 line-through" : "text-gray-700"}>
                {item.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
