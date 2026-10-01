import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portfolioStateLabel, pmValue } from "./portfolio-result-summary";
export { replayAvailability } from "./portfolio-result-summary";

export type PMResultField = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

export function PortfolioResultOverview({
  title,
  runId,
  status,
  representation,
  executionMode,
  timestamp,
  fields,
  children,
}: {
  title: string;
  runId?: string | number | null;
  status: unknown;
  representation?: unknown;
  executionMode?: unknown;
  timestamp?: unknown;
  fields: PMResultField[];
  children?: ReactNode;
}) {
  return (
    <Card data-testid="pm-result-overview">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{title}{runId !== undefined && runId !== null ? ` #${runId}` : ""}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {representation !== undefined ? `Representation: ${pmValue(representation)}` : null}
              {executionMode !== undefined ? ` · Execution: ${pmValue(executionMode)}` : null}
              {timestamp !== undefined ? ` · Saved: ${pmValue(timestamp)}` : null}
            </p>
          </div>
          <Badge variant="outline" data-testid="pm-state-label">{portfolioStateLabel(status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {fields.map(field => (
            <div key={field.label} className="min-w-0 rounded border bg-muted/20 p-3" data-testid={`pm-field-${field.label.toLowerCase().replace(/\W+/g, "-")}`}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</dt>
              <dd className="mt-1 break-words text-sm font-medium tabular-nums">{field.value ?? "Not recorded"}</dd>
              {field.detail !== undefined && <dd className="mt-1 break-words text-xs text-muted-foreground">{field.detail}</dd>}
            </div>
          ))}
        </dl>
        {children}
      </CardContent>
    </Card>
  );
}