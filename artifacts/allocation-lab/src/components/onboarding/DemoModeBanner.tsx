import { Sparkles, X } from "lucide-react";
import { useUxPreferences } from "@/context/ux-preferences-context";

export function DemoModeBanner() {
  const { demoMode, setDemoMode } = useUxPreferences();

  if (!demoMode) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 text-amber-950 text-xs font-semibold px-4 py-1.5 shrink-0">
      <Sparkles className="h-3.5 w-3.5" />
      <span>Demo mode — walkthrough only, no reports or approvals leave this session.</span>
      <button
        onClick={() => setDemoMode(false)}
        className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-amber-500/40 transition-colors"
        aria-label="Exit demo mode"
      >
        <X className="h-3 w-3" /> Exit
      </button>
    </div>
  );
}
