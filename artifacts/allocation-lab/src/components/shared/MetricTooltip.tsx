import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricTooltipProps {
  label: ReactNode;
  explanation: string;
  className?: string;
  iconOnly?: boolean;
}

/**
 * Wraps a metric label with a hover tooltip giving a short, plain-English
 * explanation. Use everywhere a professional/technical metric is shown so
 * non-technical users can understand it without leaving the page.
 */
export function MetricTooltip({ label, explanation, className, iconOnly }: MetricTooltipProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 ${className ?? ""}`}>
          {!iconOnly && label}
          <Info className="h-3 w-3 text-muted-foreground/70 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}
