import { ReactNode, useState } from "react";
import { Activity, Menu, Settings } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { TopStatusBar } from "@/components/shared/TopStatusBar";
import { WorkflowRail } from "@/components/shared/WorkflowRail";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { useWorkflowStage, toGuidedRailSteps } from "@/lib/workflow";
import { useLocation } from "wouter";
import { DemoModeBanner } from "@/components/onboarding/DemoModeBanner";

interface AppLayoutProps {
  children: ReactNode;
}

const RAIL_STEP_ROUTES: Record<string, string> = {
  data: "__settings__",
  rebalance: "/portfolio-lab",
  validate: "/research-lab",
  committee: "/investment-committee",
  report: "/investment-committee",
  archive: "/reports",
};

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { openSettings } = useSettingsDrawer();
  const [, setLocation] = useLocation();
  const stageInfo = useWorkflowStage();
  const railSteps = toGuidedRailSteps(stageInfo);

  const handleStepClick = (step: { key: string; status: string }) => {
    if (step.status === "blocked") return;
    const target = RAIL_STEP_ROUTES[step.key];
    if (target === "__settings__") {
      openSettings("data-sources");
    } else if (target) {
      setLocation(target);
    }
  };

  const SettingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-sidebar-primary-foreground hover:bg-white/10 hover:text-sidebar-primary-foreground"
      aria-label="Settings"
      onClick={() => openSettings()}
    >
      <Settings className="h-5 w-5" />
    </Button>
  );

  return (
    <div className="flex h-screen bg-background">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {isMobile ? (
          <div className="flex h-14 items-center gap-3 px-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
            <Sheet open={open} onOpenChange={setOpen}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-sidebar-primary-foreground hover:bg-white/10 hover:text-sidebar-primary-foreground"
                onClick={() => setOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Sidebar onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <Activity className="h-5 w-5 text-accent" />
            <span className="text-base font-bold tracking-tight flex-1">Allocation Lab</span>
            {SettingsButton}
          </div>
        ) : (
          <div className="flex h-12 items-center justify-end px-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
            {SettingsButton}
          </div>
        )}
        <DemoModeBanner />
        <TopStatusBar />
        <div className="px-4 py-2 border-b bg-white shrink-0">
          <WorkflowRail steps={railSteps} onStepClick={handleStepClick} />
        </div>
        <main className="flex-1 overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
