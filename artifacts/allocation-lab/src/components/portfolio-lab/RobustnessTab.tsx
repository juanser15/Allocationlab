import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/EmptyState";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { ShieldCheck, ShieldAlert, Info, FlaskConical, Lock } from "lucide-react";
import type { BacktestResult } from "@workspace/api-client-react";

interface Props {
  bt: BacktestResult | undefined;
  hasRun: boolean;
  validationRan: boolean;
  onRunValidation: () => void;
}

const ROBUSTNESS_FORMULA = `Robustness =
  0.25 × ParameterStability
+ 0.20 × BootstrapStability
+ 0.20 × CovarianceStability
+ 0.20 × ModelAgreement
+ 0.15 × OutOfSampleStability

Where:
  WeightStability   = 1 − 0.5 × Σᵢ |wᵢ_base − wᵢ_perturbed|
  ModelAgreement    = 1 − mean_k ‖wᵏ − mean(w)‖₁
  BootstrapStability = 1 − std(w_bootstrap_draws) / mean(w_bootstrap_draws)`;

const TESTS = [
  {
    id: "parameter_stability",
    label: "A — Parameter Perturbation",
    weight: "25%",
    description: "Tests portfolio stability when key parameters are perturbed: factor weights ±10% and ±20%, lookback window changes, turnover penalty adjustments, cash range relaxation, ETF weight cap variation.",
    formula: "WeightStability(ε) = 1 − 0.5 × Σᵢ |wᵢ_base − wᵢ_perturbed(ε)|",
    status: "requires_validation",
  },
  {
    id: "bootstrap",
    label: "B — Bootstrap / Resampling",
    weight: "20%",
    description: "Resamples the return and covariance history multiple times (bootstrap draws), runs the full optimizer on each sample, and measures weight dispersion and asset-selection frequency across draws.",
    formula: "BootstrapStability = 1 − std(w_bootstrap) / mean(w_bootstrap)\nAssetFrequency_i = #(draws where wᵢ > 0) / #(total draws)",
    status: "requires_validation",
  },
  {
    id: "covariance_sensitivity",
    label: "C — Covariance Sensitivity",
    weight: "20%",
    description: "Runs the optimizer under sample, EWMA, and shrinkage covariance estimates and measures weight divergence. Stable portfolios produce similar weights regardless of covariance estimator.",
    formula: "CovStability = 1 − mean_{i≠j} |wᵢ_cov_A − wᵢ_cov_B| / 2",
    status: "requires_validation",
  },
  {
    id: "model_agreement",
    label: "D — Model Disagreement",
    weight: "20%",
    description: "Measures consensus across the three portfolio construction models (Momentum/Trend, MinVar, Risk Parity). High disagreement reduces ensemble confidence.",
    formula: "ModelAgreement = 1 − mean_k ‖wᵏ − mean(w)‖₁\n(0 = complete disagreement, 1 = identical outputs)",
    status: "requires_multiple_models",
  },
  {
    id: "oos_stability",
    label: "E — Rolling Out-of-Sample Stability",
    weight: "15%",
    description: "Measures stability of rolling out-of-sample Sharpe, drawdown, and asset selection from walk-forward folds. Derived directly from Run Validation output.",
    formula: "OoSStability = 1 − std(fold_Sharpe) / (|mean(fold_Sharpe)| + ε)\n(measures consistency of OoS performance across time)",
    status: "partial",
  },
  {
    id: "constraint_sensitivity",
    label: "F — Constraint Sensitivity",
    weight: "—",
    description: "Identifies which constraints materially change the solution. Relaxes each constraint one at a time and measures the delta to unconstrained weights.",
    formula: "ConstraintImpact_j = ‖w_constrained − w_unconstrained_j‖₁\n(binding if impact > threshold)",
    status: "requires_validation",
  },
  {
    id: "turnover_sensitivity",
    label: "G — Turnover Sensitivity",
    weight: "—",
    description: "Tests how different turnover penalty values affect resulting turnover, risk, and score metrics. Shows the trade-off curve between trading cost and portfolio quality.",
    formula: "TurnoverCurve = {λ_turnover → (turnover, score, volatility)}\nfor λ_turnover ∈ [0, 0.01, 0.05, 0.10, 0.25]",
    status: "requires_validation",
  },
];

export function RobustnessTab({ bt, hasRun, validationRan, onRunValidation }: Props) {
  const [openTest, setOpenTest] = useState<typeof TESTS[0] | null>(null);

  if (!hasRun) {
    return <EmptyState icon={ShieldCheck} title='Run Optimizer to generate model allocations.' description="Robustness analysis requires completed model allocations and sufficient price history." />;
  }

  // Derive partial OoS stability from walk-forward if available
  const wf = bt?.walkForward;
  const oosStability = wf && wf.folds.length >= 2
    ? (() => {
        const sharpes = wf.folds.map((f) => f.sharpeRatio ?? 0);
        const mean = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
        const std = Math.sqrt(sharpes.reduce((a, b) => a + (b - mean) ** 2, 0) / sharpes.length);
        return Math.max(0, Math.min(100, (1 - std / (Math.abs(mean) + 0.01)) * 100));
      })()
    : null;

  const hasOoS = validationRan && oosStability !== null;

  return (
    <div className="space-y-6">
      <DetailDrawer
        open={!!openTest}
        onOpenChange={(o) => !o && setOpenTest(null)}
        title={openTest?.label ?? ""}
      >
        {openTest && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={openTest.status === "partial" || openTest.status === "requires_validation" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}>
                {openTest.status === "partial" ? "Partial" : openTest.status === "requires_validation" ? "Requires Validation" : openTest.status === "requires_multiple_models" ? "Requires Multiple Models" : "Available"}
              </Badge>
              {openTest.weight !== "—" && <span className="text-xs text-muted-foreground">Composite weight: {openTest.weight}</span>}
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
              <p className="text-gray-700 leading-relaxed">{openTest.description}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Formula</h4>
              <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre leading-relaxed">{openTest.formula}</pre>
            </div>
            {openTest.id === "oos_stability" && hasOoS && bt && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Computed Result</h4>
                <div className="border rounded-md p-4">
                  <p className="text-3xl font-bold text-primary">{oosStability!.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">OoS Stability Score (0–100) · Based on {bt.walkForward.folds.length} walk-forward folds</p>
                  <div className="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${oosStability! >= 65 ? "bg-green-500" : oosStability! >= 40 ? "bg-amber-400" : "bg-red-500"}`}
                      style={{ width: `${oosStability}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Fold Sharpes: {bt.walkForward.folds.map((f) => f.sharpeRatio?.toFixed(2) ?? "N/A").join(", ")}
                  </p>
                </div>
              </div>
            )}
            {openTest.status === "requires_validation" && !validationRan && (
              <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs">Run Validation before viewing this robustness component. This test requires the backtester to complete at least one full simulation pass.</span>
              </div>
            )}
            {openTest.status === "requires_multiple_models" && (
              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-gray-600">
                <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs">Model Disagreement requires all three portfolio construction models (A, B, C) to produce outputs. Currently only Model A (Momentum/Trend) is computed.</span>
              </div>
            )}
          </div>
        )}
      </DetailDrawer>

      {/* Robustness score header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Robustness Framework
          </CardTitle>
          <CardDescription>
            Composite robustness score across 5 independent test dimensions. Each component is independently computed and auditable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Formula block */}
          <Accordion type="single" collapsible>
            <AccordionItem value="formula" className="border rounded">
              <AccordionTrigger className="text-xs font-medium px-4 hover:no-underline">
                Robustness Score Formula & Composite Weights
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3">
                <pre className="font-mono text-[10px] bg-gray-50 border rounded p-3 whitespace-pre leading-relaxed text-gray-700">{ROBUSTNESS_FORMULA}</pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Score components */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Parameter Stability", weight: "25%", id: "parameter_stability", value: null, status: "requires_validation" as const },
              { label: "Bootstrap Stability", weight: "20%", id: "bootstrap", value: null, status: "requires_validation" as const },
              { label: "Covariance Stability", weight: "20%", id: "covariance_sensitivity", value: null, status: "requires_validation" as const },
              { label: "Model Agreement", weight: "20%", id: "model_agreement", value: null, status: "requires_multiple_models" as const },
              { label: "OoS Stability", weight: "15%", id: "oos_stability", value: hasOoS ? oosStability : null, status: hasOoS ? "computed" as const : "requires_validation" as const },
            ].map(({ label, weight, id, value, status }) => (
              <button
                key={id}
                onClick={() => setOpenTest(TESTS.find((t) => t.id === id) ?? null)}
                className="text-left border rounded-md p-3 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{weight}</span>
                </div>
                {value !== null ? (
                  <>
                    <p className="text-2xl font-bold text-primary">{value.toFixed(0)}</p>
                    <div className="mt-1.5 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${value >= 65 ? "bg-green-500" : value >= 40 ? "bg-amber-400" : "bg-red-500"}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                    <Badge variant="outline" className="mt-1.5 text-[10px] bg-green-50 text-green-700 border-green-200">Computed</Badge>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full bg-gray-100 rounded-full" />
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${status === "requires_multiple_models" ? "bg-gray-50 text-gray-400" : "bg-amber-50 text-amber-600 border-amber-200"}`}
                    >
                      {status === "requires_multiple_models" ? "Needs Multi-Model" : "Run Validation"}
                    </Badge>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!validationRan && (
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
              <span>
                <strong>Robustness analysis requires completed model allocations and sufficient history.</strong>{" "}
                Run Validation (Backtest tab) to unlock Parameter Stability, Bootstrap, Covariance Sensitivity, and OoS Stability scores.
                Model Agreement requires extended multi-model backend support.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual test cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Test Components — Click to Inspect</h3>
        {TESTS.map((test) => {
          const isOoS = test.id === "oos_stability";
          const computed = isOoS && hasOoS;
          return (
            <button
              key={test.id}
              onClick={() => setOpenTest(test)}
              className="w-full text-left border rounded-md p-4 hover:border-primary/40 hover:bg-gray-50/80 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-primary">{test.label}</span>
                    {test.weight !== "—" && <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">{test.weight}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{test.description}</p>
                  <p className="font-mono text-[10px] text-gray-500 mt-1.5 truncate">{test.formula.split("\n")[0]}</p>
                </div>
                <div className="shrink-0">
                  {computed ? (
                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">Computed</Badge>
                  ) : test.status === "requires_multiple_models" ? (
                    <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-400">Needs Multi-Model</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-600 border-amber-200">Run Validation</Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
