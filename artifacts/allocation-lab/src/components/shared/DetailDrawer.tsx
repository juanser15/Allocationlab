import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Generic right-side drawer used for row/cell/card drill-downs across the
 * app (ETF details, factor explanations, trade rationale, risk decomposition,
 * backtest methodology, etc). Keep primary pages uncluttered by pushing
 * secondary detail into this drawer instead of inline expansion.
 */
export function DetailDrawer({ open, onOpenChange, title, description, children, footer }: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">{children}</div>
        {footer && <div className="mt-6 pt-4 border-t">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
