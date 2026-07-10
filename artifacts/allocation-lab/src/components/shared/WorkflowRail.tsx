import { CheckCircle2, Circle, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type RailStepStatus = "complete" | "current" | "pending" | "blocked" | "failed";

export interface RailStep {
  key: string;
  label: string;
  status: RailStepStatus;
  detail?: string;
}

const STATUS_STYLES: Record<RailStepStatus, { dot: string; text: string; icon: typeof CheckCircle2 | null }> = {
  complete: { dot: "bg-primary text-primary-foreground", text: "text-gray-900", icon: CheckCircle2 },
  current: { dot: "bg-accent text-accent-foreground ring-4 ring-accent/20", text: "text-gray-900 font-semibold", icon: null },
  pending: { dot: "bg-gray-100 text-gray-400 border border-gray-300", text: "text-gray-400", icon: null },
  blocked: { dot: "bg-gray-100 text-gray-400 border border-dashed border-gray-300", text: "text-gray-400", icon: Lock },
  failed: { dot: "bg-destructive/10 text-destructive border border-destructive/40", text: "text-destructive", icon: XCircle },
};

interface WorkflowRailProps {
  steps: RailStep[];
  onStepClick?: (step: RailStep) => void;
  activeKey?: string | null;
}

/**
 * Guided workflow rail: Data Ready -> Rebalance -> Validate -> Committee ->
 * Report -> Archive. Each step shows complete/current/pending/blocked/failed.
 * Clicking a step (when onStepClick is provided) lets the page filter to
 * that status/section.
 */
export function WorkflowRail({ steps, onStepClick, activeKey }: WorkflowRailProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center min-w-max">
        {steps.map((step, i) => {
          const style = STATUS_STYLES[step.status];
          const Icon = style.icon;
          const clickable = !!onStepClick;
          return (
            <div key={step.key} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick?.(step)}
                title={step.detail ?? step.label}
                className={cn(
                  "flex flex-col items-center gap-1.5 px-3 py-1 rounded-md transition-colors",
                  clickable && "hover:bg-gray-50 cursor-pointer",
                  !clickable && "cursor-default",
                  activeKey === step.key && "bg-gray-100"
                )}
              >
                <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", style.dot)}>
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : <Circle className="h-2 w-2 fill-current" />}
                </span>
                <span className={cn("text-[11px] whitespace-nowrap", style.text)}>{step.label}</span>
              </button>
              {i < steps.length - 1 && <div className="w-6 sm:w-10 h-px bg-gray-200 mb-4 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
