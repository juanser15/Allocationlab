import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Activity, Compass, ClipboardList, Gavel } from "lucide-react";
import { useUxPreferences } from "@/context/ux-preferences-context";

interface TourStep {
  icon: typeof Activity;
  title: string;
  description: string;
}

const STEPS: TourStep[] = [
  {
    icon: Activity,
    title: "Top status bar",
    description:
      "The bar under the header always shows the active session, as-of date, data freshness, and a quick health snapshot — so you always know what you're looking at.",
  },
  {
    icon: Compass,
    title: "Guided workflow rail",
    description:
      "The rail tracks the six stages of a monthly cycle: Data Ready, Rebalance, Validate, Committee, Report, Archive. Click a step to jump there; locked steps mean a prior stage isn't done yet.",
  },
  {
    icon: ClipboardList,
    title: "Four modules",
    description:
      "Dashboard for a read-only overview, Portfolio Lab to run rebalances and inspect allocations, Research Lab for factor/backtest analysis, and Investment Committee for review and sign-off.",
  },
  {
    icon: Gavel,
    title: "Settings, anytime",
    description:
      "Use the gear icon in the top-right to edit the ETF universe, constraints, execution assumptions, and reporting defaults. Changes there apply to every future run.",
  },
];

export function OnboardingTour() {
  const { tourOpen, closeTour, completeOnboarding } = useUxPreferences();
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const Icon = step.icon;

  const handleClose = (open: boolean) => {
    if (!open) {
      closeTour();
      setStepIndex(0);
    }
  };

  const handleNext = () => {
    if (isLast) {
      completeOnboarding();
      setStepIndex(0);
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  return (
    <Dialog open={tourOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>{step.title}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm leading-relaxed">
            {step.description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-1.5 py-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? "w-6 bg-primary" : "w-1.5 bg-gray-200"
              }`}
            />
          ))}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
            Skip tour
          </Button>
          <Button size="sm" onClick={handleNext}>
            {isLast ? "Get started" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
