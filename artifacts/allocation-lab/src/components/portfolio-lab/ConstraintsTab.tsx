import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Info } from "lucide-react";
import type { RunResult, Constraints } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  constraints: Constraints | undefined;
  hasRun: boolean;
  hasData: boolean;
}

function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

interface ConstraintCheck {
  label: string;
  pass: boolean;
  required: string;
  actual: string;
  slack?: string;
  binding: boolean;
  detail?: string;
}

export function ConstraintsTab({ result, constraints, hasRun, hasData }: Props) {
  if (!hasData) return <EmptyState icon={ShieldCheck} title="Valid price history is required." description="Upload price data to audit portfolio constraints." />;
  if (!hasRun || !result || !constraints) {
    return <EmptyState icon={ShieldCheck} title="Run Optimizer to generate model allocations." description="Final Allocation is unavailable until constraints are audited." />;
  }

  const allocs = result.allocations;

  // Build constraint checks
  const checks: ConstraintCheck[] = [
    {
      label: "Cash Minimum",
      pass: result.cashWeight >= constraints.cashMin - 0.0001,
      required: `≥ ${pct(constraints.cashMin)}`,
      actual: pct(result.cashWeight),
      slack: `${pct(result.cashWeight - constraints.cashMin)} slack`,
      binding: result.cashWeight - constraints.cashMin < 0.01,
      detail: "Cash must be at least this percentage of portfolio value to ensure liquidity buffer.",
    },
    {
      label: "Cash Maximum",
      pass: result.cashWeight <= constraints.cashMax + 0.0001,
      required: `≤ ${pct(constraints.cashMax)}`,
      actual: pct(result.cashWeight),
      slack: `${pct(constraints.cashMax - result.cashWeight)} slack`,
      binding: constraints.cashMax - result.cashWeight < 0.01,
      detail: "Cash ceiling prevents excessive defensiveness even in Risk-Off regimes.",
    },
    {
      label: "Max ETF Weight",
      pass: allocs.every((a) => a.weight <= constraints.maxEtfWeight + 0.0001),
      required: `≤ ${pct(constraints.maxEtfWeight)} per ETF`,
      actual: `max ${pct(Math.max(...allocs.map((a) => a.weight)))}`,
      slack: `${pct(constraints.maxEtfWeight - Math.max(...allocs.map((a) => a.weight)))} slack`,
      binding: Math.max(...allocs.map((a) => a.weight)) >= constraints.maxEtfWeight - 0.005,
      detail: "Maximum weight per individual ETF to prevent concentration in any single position.",
    },
    {
      label: "Min Active ETFs",
      pass: result.activeEtfCount >= 8,
      required: "≥ 8 active ETFs",
      actual: `${result.activeEtfCount} active`,
      slack: `${result.activeEtfCount - 8} above floor`,
      binding: result.activeEtfCount === 8,
      detail: "Minimum breadth requirement. At least 8 non-zero positions required for institutional diversification.",
    },
    {
      label: "Target Active ETFs",
      pass: result.activeEtfCount >= constraints.targetActiveEtfs,
      required: `≥ ${constraints.targetActiveEtfs} active`,
      actual: `${result.activeEtfCount} active`,
      slack: `${result.activeEtfCount - constraints.targetActiveEtfs} above target`,
      binding: result.activeEtfCount === constraints.targetActiveEtfs,
      detail: "Target number of actively allocated positions. Model attempts to reach this count while respecting all other constraints.",
    },
    {
      label: "Min Inclusion Threshold",
      pass: allocs.filter((a) => a.active).every((a) => a.weight >= constraints.minInclusionThreshold - 0.0001),
      required: `≥ ${pct(constraints.minInclusionThreshold)} if included`,
      actual: `min ${pct(Math.min(...allocs.filter((a) => a.active).map((a) => a.weight)))}`,
      binding: false,
      detail: "Positions must be either 0% (excluded) or at least this percentage. Eliminates economically insignificant allocations.",
    },
  ];

  const allPass = checks.every((c) => c.pass);
  const bindingCount = checks.filter((c) => c.binding && c.pass).length;

  // Excluded assets
  const excluded = allocs.filter((a) => !a.active);
  const included = allocs.filter((a) => a.active);

  // Unconstrained vs constrained comparison (approximate)
  const unconstrainedTopByScore = allocs
    .slice()
    .sort((a, b) => b.factorScores.composite - a.factorScores.composite)
    .slice(0, constraints.targetActiveEtfs);

  const unconstrainedMissing = unconstrainedTopByScore
    .filter((a) => !a.active)
    .map((a) => a.ticker);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className={`flex items-center gap-3 rounded-lg border px-5 py-4 ${allPass ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        {allPass ? (
          <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
        ) : (
          <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
        )}
        <div>
          <p className={`text-sm font-semibold ${allPass ? "text-green-800" : "text-red-800"}`}>
            {allPass ? "All constraints satisfied — allocation is feasible." : "One or more constraints violated — allocation may not be compliant."}
          </p>
          <p className={`text-xs ${allPass ? "text-green-600" : "text-red-600"}`}>
            {bindingCount} constraint{bindingCount !== 1 ? "s" : ""} binding · {checks.filter((c) => !c.pass).length} violation{checks.filter((c) => !c.pass).length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Constraint audit table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Constraint Audit</CardTitle>
          <CardDescription>Feasibility status, binding constraints, and slack for each institutional constraint. Configure in Settings → Constraints.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="text-xs">Constraint</TableHead>
                <TableHead className="text-xs">Required</TableHead>
                <TableHead className="text-xs">Actual</TableHead>
                <TableHead className="text-xs">Slack</TableHead>
                <TableHead className="text-xs text-center">Binding</TableHead>
                <TableHead className="text-xs text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow key={c.label} className={!c.pass ? "bg-red-50/40" : c.binding ? "bg-amber-50/30" : ""}>
                  <TableCell className="text-xs font-medium">
                    <div>{c.label}</div>
                    {c.detail && <div className="text-[10px] text-muted-foreground mt-0.5 max-w-48 leading-relaxed">{c.detail}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-gray-700">{c.required}</TableCell>
                  <TableCell className={`text-xs font-semibold ${c.pass ? "text-gray-800" : "text-red-700"}`}>{c.actual}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.slack ?? "—"}</TableCell>
                  <TableCell className="text-xs text-center">
                    {c.binding ? (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Binding</Badge>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {c.pass ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 inline" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Included vs excluded */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Included Positions ({included.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {included.slice().sort((a, b) => b.weight - a.weight).map((a) => (
                <div key={a.ticker} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-800">{a.ticker}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-[10px]">score {a.factorScores.composite.toFixed(0)}</span>
                    <span className="font-semibold text-primary tabular-nums">{pct(a.weight)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <XCircle className="h-4 w-4 text-gray-400" /> Excluded by Constraints ({excluded.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {excluded.length === 0 ? (
              <p className="text-xs text-muted-foreground">All universe ETFs are included in the active allocation.</p>
            ) : (
              <div className="space-y-1.5">
                {excluded.slice().sort((a, b) => b.factorScores.composite - a.factorScores.composite).map((a) => (
                  <div key={a.ticker} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-500">{a.ticker}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-[10px]">score {a.factorScores.composite.toFixed(0)}</span>
                      <Badge variant="outline" className="text-[10px] text-gray-400">
                        {a.factorScores.composite < 40 ? "Low score" : "Threshold / Cap"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unconstrained vs constrained */}
      {unconstrainedMissing.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-amber-800">Constraint Impact</CardTitle>
            <CardDescription className="text-amber-700">
              The following ETFs rank in the top {constraints.targetActiveEtfs} by factor score but are excluded by constraints (threshold, cap, or diversification limits):
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {unconstrainedMissing.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] bg-white text-amber-700 border-amber-200">{t}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Constraints are not silently altered. The unconstrained solution includes these positions; the constrained solution excludes them. This difference is tracked in the governance audit log.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Default constraint reference */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p><strong>Default Institutional Constraints:</strong></p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Cash between 50% and 60%</li>
                <li>Max ETF weight 10%</li>
                <li>Position is either 0% or at least min-inclusion-threshold (0% / ≥5%)</li>
                <li>Target 8 active ETFs</li>
              </ul>
              <p className="mt-2">Constraints are configurable and versioned in Settings → Constraints. Changes are logged in the governance audit trail.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
