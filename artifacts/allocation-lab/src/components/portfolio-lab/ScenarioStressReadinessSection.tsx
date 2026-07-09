import { Link } from "wouter";
import { useGetScenarioStressMeta } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dices, ArrowRight } from "lucide-react";

export function ScenarioStressReadinessSection() {
  const { data: meta } = useGetScenarioStressMeta();

  const availableProxies = meta?.proxies.filter((p) => p.available).length ?? 0;
  const totalProxies = meta?.proxies.length ?? 0;
  const availableScenarios = meta?.scenarios.filter((s) => s.available).length ?? 0;
  const totalHistoricalScenarios = meta?.scenarios.filter((s) => s.id !== "custom-window").length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Dices className="h-4 w-4 text-primary" /> Scenario &amp; Stress Readiness
        </CardTitle>
        <CardDescription>
          Data coverage for macro shock scenarios and historical stress replays, computed from uploaded price data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!meta || !meta.hasAllocation ? (
          <p className="text-sm text-muted-foreground">
            Run the pipeline to enable scenario analysis and stress testing.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Macro proxies available</p>
                <p className="font-semibold text-gray-900">{availableProxies} / {totalProxies}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Historical scenarios available</p>
                <p className="font-semibold text-gray-900">{availableScenarios} / {totalHistoricalScenarios}</p>
              </div>
            </div>
            <Link href="/research-lab" className="text-xs text-primary font-medium inline-flex items-center gap-1 hover:underline">
              Run scenario analysis &amp; stress tests in Research Lab <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
