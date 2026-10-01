import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Database, ListTree, ShieldCheck, History, Timer, Sigma, LineChart, FileText, Landmark,
  AlertTriangle, CheckCircle2, RotateCcw, Compass,
} from "lucide-react";
import { useSettingsDrawer, type SettingsSectionId } from "@/context/settings-drawer-context";
import { DataSourcesSection } from "./sections/DataSourcesSection";
import { UniverseSection } from "./sections/UniverseSection";
import { ConstraintsSection } from "./sections/ConstraintsSection";
import { PreviousWeightsSection } from "./sections/PreviousWeightsSection";
import { ExecutionAssumptionsSection } from "./sections/ExecutionAssumptionsSection";
import { ModelFactorsSection } from "./sections/ModelFactorsSection";
import { BenchmarksSection } from "./sections/BenchmarksSection";
import { ReportingDefaultsSection } from "./sections/ReportingDefaultsSection";
import { GovernanceSection } from "./sections/GovernanceSection";
import { OnboardingSection } from "./sections/OnboardingSection";

const SECTIONS: { id: SettingsSectionId; label: string; icon: any }[] = [
  { id: "data-sources", label: "Data Sources", icon: Database },
  { id: "universe", label: "Universe", icon: ListTree },
  { id: "constraints", label: "Portfolio Constraints", icon: ShieldCheck },
  { id: "previous-weights", label: "Starting Portfolio", icon: History },
  { id: "execution", label: "Execution Assumptions", icon: Timer },
  { id: "model-factors", label: "Model & Factors", icon: Sigma },
  { id: "benchmarks", label: "Benchmarks", icon: LineChart },
  { id: "reporting", label: "Reporting Defaults", icon: FileText },
  { id: "governance", label: "Governance & Advanced", icon: Landmark },
  { id: "onboarding", label: "Onboarding & Demo", icon: Compass },
];

function SectionContent({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case "data-sources": return <DataSourcesSection />;
    case "universe": return <UniverseSection />;
    case "constraints": return <ConstraintsSection />;
    case "previous-weights": return <PreviousWeightsSection />;
    case "execution": return <ExecutionAssumptionsSection />;
    case "model-factors": return <ModelFactorsSection />;
    case "benchmarks": return <BenchmarksSection />;
    case "reporting": return <ReportingDefaultsSection />;
    case "governance": return <GovernanceSection />;
    case "onboarding": return <OnboardingSection />;
  }
}

export function SettingsDrawer() {
  const {
    isOpen, activeSection, openSettings, requestClose, showCloseConfirm,
    confirmDiscardAndClose, cancelCloseRequest, sectionStatuses, hasUnsavedChanges,
    totalErrors, triggerRestoreDefaults,
  } = useSettingsDrawer();

  const dirtyCount = Object.values(sectionStatuses).filter((s) => s.dirty).length;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
        <SheetContent side="right" className="p-0 w-full sm:max-w-3xl flex flex-col gap-0">
          <SheetTitle className="sr-only">Settings</SheetTitle>

          <div className="border-b px-5 py-3 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-primary">Configuration Console</h2>
                <p className="text-xs text-muted-foreground">Global settings applied to every run. Sits outside the main workflow.</p>
              </div>
              <Button variant="outline" size="sm" onClick={triggerRestoreDefaults}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restore Institutional Defaults
              </Button>
            </div>
            <div className={cn(
              "mt-3 flex items-center gap-2 rounded px-3 py-2 text-sm",
              totalErrors > 0
                ? "bg-destructive/5 border border-destructive/30 text-destructive"
                : hasUnsavedChanges
                ? "bg-amber-50 border border-amber-200 text-amber-800"
                : "bg-green-50 border border-green-200 text-green-800"
            )}>
              {totalErrors > 0 ? (
                <><AlertTriangle className="h-4 w-4" /><span>{totalErrors} validation error(s) — fix before saving.</span></>
              ) : hasUnsavedChanges ? (
                <><AlertTriangle className="h-4 w-4" /><span>{dirtyCount} section(s) with unsaved changes.</span></>
              ) : (
                <><CheckCircle2 className="h-4 w-4" /><span>All settings saved.</span></>
              )}
            </div>
          </div>

          <div className="flex flex-1 min-h-0">
            <nav className="w-56 border-r shrink-0 py-2">
              <ScrollArea className="h-full">
                {SECTIONS.map((s) => {
                  const status = sectionStatuses[s.id];
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => openSettings(s.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors",
                        activeSection === s.id
                          ? "bg-primary/5 text-primary font-medium border-r-2 border-primary"
                          : "text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{s.label}</span>
                      {status?.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />}
                      {!!status?.errorCount && <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />}
                    </button>
                  );
                })}
              </ScrollArea>
            </nav>

            <ScrollArea className="flex-1">
              <div className="p-6">
                <SectionContent id={activeSection} />
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showCloseConfirm} onOpenChange={(open) => { if (!open) cancelCloseRequest(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in one or more sections. Closing now will discard them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelCloseRequest}>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscardAndClose}>Discard & Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
