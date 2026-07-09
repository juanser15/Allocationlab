import { Link } from "wouter";
import { useGetAttributionMeta } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { localSettings } from "@/lib/local-settings";

export function AttributionSummaryCard() {
  const benchmarkTicker = localSettings.getBenchmarksSettings().defaultBenchmark;
  const { data: meta } = useGetAttributionMeta({ benchmarkTicker });

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <BarChart3 className="h-3.5 w-3.5" /> Attribution
        </p>
        {meta?.ready ? (
          <p className="text-sm font-medium text-gray-900 mt-1">
            Ready · {meta.versions.length} version{meta.versions.length === 1 ? "" : "s"} available
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            {meta?.reason ?? "Loading…"}
          </p>
        )}
        <Link href="/archive" className="text-xs text-primary underline mt-1 inline-block">View attribution</Link>
      </CardContent>
    </Card>
  );
}
