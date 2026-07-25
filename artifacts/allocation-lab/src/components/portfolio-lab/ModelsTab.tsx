import { useState } from "react";
import { useGetRiskModel } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { MetricTooltip } from "@/components/shared/MetricTooltip";
import { Layers, Info, ShieldAlert, Lock } from "lucide-react";
import type { RunResult, RiskModelResult } from "@workspace/api-client-react";

interface Props {
  result: RunResult | undefined;
  hasData: boolean;
  hasRun: boolean;
}

function pct(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
function num(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(d);
}

const MODEL_DEFS = [
  {
    id: "momentum_trend",
    label: "A — Momentum / Trend",
    status: "computed",
    objective: `maximize:\n  score′ · w\n  − λ_risk · w′ Σ w\n  − λ_turnover · ‖w − w_prev‖₁\n  − λ_concentration · Σᵢ wᵢ²`,
    description: "Score-weighted allocation with risk, turnover, and concentration penalties. Factor scores are regime-weighted composite ranks. This is the primary official model.",
    covariance: "Sample covariance (switchable to EWMA or Shrinkage in Models tab)",
    inputs: "Composite factor scores (regime-weighted), prior weights, covariance matrix, constraint bounds",
    confidence: 85,
  },
  {
    id: "min_variance",
    label: "B — Minimum Variance",
    status: "requires_extension",
    objective: `minimize:\n  w′ Σ w\n\nSubject to:\n  Σᵢ wᵢ = 1,  wᵢ ≥ 0`,
    description: "Pure risk minimization ignoring expected returns. Optimal when return predictability is low and covariance estimation is reliable. Requires extended backend run.",
    covariance: "Shrinkage covariance (Ledoit-Wolf, constant-correlation target) — institutional default",
    inputs: "Covariance matrix, constraint bounds",
    confidence: null,
  },
  {
    id: "risk_parity",
    label: "C — Risk Parity",
    status: "requires_extension",
    objective: `minimize:\n  Σᵢ (RC_i − σ_p / N)²\n\nWhere:\n  RC_i = wᵢ · (Σw)ᵢ / σ_p\n  σ_p  = √(w′ Σ w)`,
    description: "Equal risk contribution model. Each asset contributes equally to total portfolio volatility. Naturally diversified by construction. Requires extended backend run.",
    covariance: "EWMA covariance (RiskMetrics λ=0.94) — recency-weighted",
    inputs: "Covariance matrix, risk budget targets, constraint bounds",
    confidence: null,
  },
];

const COVARIANCE_MODELS = {
  sample: "Sample Covariance",
  ewma: "EWMA (RiskMetrics λ=0.94)",
  shrinkage: "Shrinkage (Ledoit-Wolf)",
};

function ModelDrawer({
  model, result, riskModel,
}: {
  model: typeof MODEL_DEFS[0];
  result: RunResult | undefined;
  riskModel: RiskModelResult | undefined;
}) {
  if (model.status === "requires_extension") {
    return (
      <div className="space-y-5 text-sm">
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <Lock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>This model requires an extended optimizer run with multi-model backend support. Currently only the Momentum/Trend model (Model A) is computed by the pipeline. MinVar and Risk Parity model outputs will be available in a future engine update.</span>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Objective Function</h4>
          <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre">{model.objective}</pre>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Covariance Methodology</h4>
          <p className="text-gray-700">{model.covariance}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Model Description</h4>
          <p className="text-gray-700">{model.description}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Objective Function</h4>
        <pre className="font-mono text-xs bg-gray-50 border rounded p-3 whitespace-pre">{model.objective}</pre>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h4>
        <p className="text-gray-700 leading-relaxed">{model.description}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Inputs</h4>
        <p className="text-gray-700">{model.inputs}</p>
      </div>
      {result && (
        <>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Allocation Output</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Ticker</TableHead>
                  <TableHead className="text-xs text-right">Target Weight</TableHead>
                  <TableHead className="text-xs text-right">Change</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.allocations.filter((a) => a.active).slice().sort((a, b) => b.weight - a.weight).map((a) => (
                  <TableRow key={a.ticker}>
                    <TableCell className="text-xs font-medium">{a.ticker}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{pct(a.weight)}</TableCell>
                    <TableCell className={`text-xs text-right ${a.change > 0 ? "text-green-600" : a.change < 0 ? "text-red-600" : "text-gray-400"}`}>
                      {a.change >= 0 ? "+" : ""}{pct(a.change)}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">ACTIVE</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 bg-primary/5">
                  <TableCell className="text-xs font-semibold">CASH</TableCell>
                  <TableCell className="text-xs text-right font-semibold text-primary">{pct(result.cashWeight)}</TableCell>
                  <TableCell className={`text-xs text-right ${result.cashChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {result.cashChange >= 0 ? "+" : ""}{pct(result.cashChange)}
                  </TableCell>
                  <TableCell className="text-xs text-center"><Badge variant="outline" className="text-[10px]">BASE</Badge></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {riskModel?.hasSufficientData && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Risk Profile</h4>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Ann. Volatility", value: pct(riskModel.annualizedVolatility) },
                  { label: "Concentration HHI", value: num(riskModel.concentrationRisk, 3) },
                  { label: "Effective Risk Bets", value: num(riskModel.effectiveRiskBets, 1) },
                ].map(({ label, value }) => (
                  <div key={label} className="border rounded p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ModelsTab({ result, hasData, hasRun }: Props) {
  const [covModel, setCovModel] = useState<"sample" | "ewma" | "shrinkage">("sample");
  const [openModel, setOpenModel] = useState<string | null>(null);
  const { data: riskModel } = useGetRiskModel({ covarianceModel: covModel });

  if (!hasData) return <EmptyState icon={Layers} title="Valid price history is required." description="Upload price data to run portfolio construction models." />;
  if (!hasRun || !result) return <EmptyState icon={Layers} title='Run Optimizer to generate model allocations.' description='The three portfolio construction engines are computed by the optimizer pipeline. Click "Run Optimizer" to begin.' />;

  const diag = result.diagnostics;

  return (
    <div className="space-y-6">
      <DetailDrawer
        open={!!openModel}
        onOpenChange={(o) => !o && setOpenModel(null)}
        title={MODEL_DEFS.find((m) => m.id === openModel)?.label ?? "Model Detail"}
      >
        {openModel && (
          <ModelDrawer
            model={MODEL_DEFS.find((m) => m.id === openModel)!}
            result={result}
            riskModel={riskModel}
          />
        )}
      </DetailDrawer>

      {/* Covariance selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Covariance Model:</span>
        <Select value={covModel} onValueChange={(v) => setCovModel(v as typeof covModel)}>
          <SelectTrigger className="h-8 text-xs w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(COVARIANCE_MODELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">Shrinkage is the institutional default for production runs.</span>
      </div>

      {/* Three model cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {MODEL_DEFS.map((model) => (
          <button
            key={model.id}
            onClick={() => setOpenModel(model.id)}
            className="text-left border rounded-lg p-4 hover:border-primary/40 hover:shadow-sm transition-all bg-white"
          >
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-semibold text-primary leading-tight">{model.label}</p>
              <Badge
                variant="outline"
                className={model.status === "computed"
                  ? "text-[10px] bg-green-50 text-green-700 border-green-200"
                  : "text-[10px] bg-gray-50 text-gray-400 border-gray-200"
                }
              >
                {model.status === "computed" ? "Computed" : "Requires Extension"}
              </Badge>
            </div>
            <pre className="font-mono text-[10px] bg-gray-50 border rounded px-3 py-2 whitespace-pre overflow-x-auto leading-relaxed text-gray-700">
              {model.objective}
            </pre>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed line-clamp-3">{model.description}</p>
            {model.status === "computed" && model.confidence && (
              <div className="mt-3 border-t pt-3">
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">Model Confidence</span>
                  <span className="font-semibold text-gray-700">{model.confidence}%</span>
                </div>
                <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${model.confidence}%` }} />
                </div>
              </div>
            )}
            {model.status === "requires_extension" && (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-600">
                <Lock className="h-3 w-3" /> Extended backend run required
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Portfolio diagnostics from computed model */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Model A — Output Diagnostics</CardTitle>
          <CardDescription>Computed metrics for the Momentum/Trend allocation under the selected covariance model.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="border rounded-md p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MetricTooltip label="Ann. Volatility" explanation="Annualized portfolio volatility using selected covariance model." />
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1">{riskModel?.hasSufficientData ? pct(riskModel.annualizedVolatility) : "—"}</p>
            </div>
            <div className="border rounded-md p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MetricTooltip label="HHI (weight)" explanation="Herfindahl-Hirschman Index of portfolio weights. Higher = more concentrated." />
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1">{diag ? num(diag.hhi, 3) : "—"}</p>
            </div>
            <div className="border rounded-md p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MetricTooltip label="Eff. Bets" explanation="Effective Number of Bets = 1/HHI of risk contributions. Higher = more diversified risk." />
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1">{diag ? diag.effectiveNumberOfBets.toFixed(1) : "—"}</p>
            </div>
            <div className="border rounded-md p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MetricTooltip label="Diversification" explanation="Cross-sectional diversification score 0–100. Higher = better risk distribution across holdings." />
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1">{diag ? diag.diversificationScore.toFixed(0) : "—"}</p>
            </div>
          </div>

          {/* Risk contributions table */}
          {diag && diag.riskContributions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Risk Contribution by Position</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ticker</TableHead>
                    <TableHead className="text-xs text-right">Weight</TableHead>
                    <TableHead className="text-xs text-right">Risk Contribution</TableHead>
                    <TableHead className="text-xs">Bar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diag.riskContributions.slice().sort((a, b) => b.riskContributionPct - a.riskContributionPct).map((r) => (
                    <TableRow key={r.ticker}>
                      <TableCell className="text-xs font-medium">{r.ticker}</TableCell>
                      <TableCell className="text-xs text-right">{pct(r.weight)}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{pct(r.riskContributionPct)}</TableCell>
                      <TableCell>
                        <div className="h-1.5 w-24 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, r.riskContributionPct * 100)}%` }} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model disagreement */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" /> Model Disagreement Analysis
          </CardTitle>
          <CardDescription>Pairwise comparison of weight distance, asset overlap, risk and turnover disagreement across models.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs text-amber-800">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Multi-model disagreement analysis requires all three models (A, B, C) to produce computed outputs. Currently only Model A (Momentum/Trend) is active.
              Once extended model runs are available, this section will display pairwise weight distance, selected-asset overlap, cash disagreement, risk disagreement, and turnover disagreement metrics with formulas:
            </span>
          </div>
          <Accordion type="single" collapsible className="mt-3">
            <AccordionItem value="formulas" className="border rounded">
              <AccordionTrigger className="text-xs font-medium text-muted-foreground px-4 hover:no-underline">
                Model Disagreement Formulas
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3">
                <pre className="font-mono text-[10px] bg-gray-50 border rounded p-3 whitespace-pre leading-relaxed text-gray-700">
{`WeightDistance(A,B) = 0.5 × Σᵢ |wᵢᴬ − wᵢᴮ|
                                            (0 = identical, 1 = fully different)

AssetOverlap(A,B) = |{i: wᵢᴬ>0} ∩ {i: wᵢᴮ>0}| / |{i: wᵢᴬ>0} ∪ {i: wᵢᴮ>0}|

RiskDisagreement = |σₚᴬ − σₚᴮ| / max(σₚᴬ, σₚᴮ)

ModelAgreement = 1 − mean_k(‖wᵏ − mean(w)‖₁)`}
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
