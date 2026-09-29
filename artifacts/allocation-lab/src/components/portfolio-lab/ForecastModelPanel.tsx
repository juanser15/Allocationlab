import { useState } from "react";
import type { ForecastModelConfig, ForecastView } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ForecastComparisonPanel } from "./ForecastComparisonPanel";

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const arr = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const scalar = (v: unknown): number => number(v) ?? NaN;
const shown = (v: unknown) => v == null ? "—" : typeof v === "number" ? Number(v).toPrecision(5) : String(v);
const daily = (v: unknown) => number(v) === null ? "—" : `${(number(v)! * 10000).toFixed(2)} bp`;
const vectorValue = (v: unknown, id: string, index: number): unknown => Array.isArray(v) ? v[index] : obj(v)[id];
const field = (v: Row, ...names: string[]) => names.map(n => v[n]).find(x => x !== undefined && x !== null);
const inputClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
export type RidgeForecastConfig = ForecastModelConfig & {
  factorIds?: string[];
  trainingWindowDates?: number;
  minTrainingDates?: number;
  lambdaSignal?: number;
  hacBandwidth?: number;
  executionTiming?: "same_close" | "next_close";
};
export type RidgeFactorOption = { id: string; name: string; aliases?: string[] };
export const ridgeMinimum = (count: number) => Math.max(60, 5 * (count + 1));

export function validateForecast(config: ForecastModelConfig, ids: string[], cutoff: string, decision: string): void {
  if (!Number.isFinite(config.displayZ) || (config.displayZ ?? 0) <= 0) throw new Error("Display z must be positive and finite.");
  if (config.type === "SIGNAL_RIDGE" as ForecastModelConfig["type"]) {
    const ridge = config as RidgeForecastConfig;
    const factors = ridge.factorIds ?? [];
    if (!factors.length || new Set(factors).size !== factors.length) throw new Error("Select at least one distinct supported frozen factor.");
    if (!Number.isSafeInteger(ridge.trainingWindowDates ?? NaN) || (ridge.trainingWindowDates ?? 0) < 2) throw new Error("Training window must be an integer of at least two dates.");
    if (!Number.isSafeInteger(ridge.minTrainingDates ?? NaN) || (ridge.minTrainingDates ?? 0) < ridgeMinimum(factors.length)) throw new Error(`Minimum training dates must be at least ${ridgeMinimum(factors.length)} for ${factors.length} factors.`);
    if ((ridge.minTrainingDates ?? 0) > (ridge.trainingWindowDates ?? 0)) throw new Error("Minimum training dates cannot exceed the training window.");
    if (!Number.isFinite(ridge.lambdaSignal ?? NaN) || (ridge.lambdaSignal ?? 0) <= 0) throw new Error("Signal ridge λ must be finite and positive.");
    if (!Number.isSafeInteger(ridge.hacBandwidth ?? NaN) || (ridge.hacBandwidth ?? -1) < 0) throw new Error("HAC bandwidth must be a nonnegative integer.");
    if (ridge.executionTiming !== "same_close" && ridge.executionTiming !== "next_close") throw new Error("Choose an execution timing.");
    return;
  }
  if (config.type === "SAMPLE_MEAN") return;
  const s = config.shrinkage ?? 0;
  if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error("Forecast shrinkage s must be between 0 and 1.");
  const checkVector = (values: Record<string, number> | undefined, label: string) => {
    if (!values || Object.keys(values).length !== ids.length || ids.some(id => !Object.hasOwn(values, id) || !Number.isFinite(values[id])))
      throw new Error(`${label} must contain one finite daily decimal value for every selected candidate, and no other keys.`);
  };
  if (config.shrinkagePrior?.source === "USER_DEFINED") checkVector(config.shrinkagePrior.values, "Shrinkage prior");
  if (config.type !== "BAYESIAN_VIEWS") return;
  if (!config.views?.length) throw new Error("Bayesian Views requires at least one dated view available by the B2 cutoff. B3 may return unavailable for earlier historical decisions with no eligible views.");
  if (config.priorMean?.source === "USER_DEFINED_PRIOR") checkVector(config.priorMean.values, "Bayesian prior mean");
  const uncertainty = config.priorUncertainty;
  if (!uncertainty) throw new Error("Choose explicit Bayesian prior uncertainty.");
  if (uncertainty.type === "TAU_SIGMA" && (uncertainty.tau !== undefined && (!Number.isFinite(uncertainty.tau) || uncertainty.tau <= 0))) throw new Error("Tau must be positive and finite.");
  if (uncertainty.type === "USER_DEFINED") {
    const m = uncertainty.matrix;
    if (!m || m.length !== ids.length || m.some(row => row.length !== ids.length || row.some(x => !Number.isFinite(x))) ||
      JSON.stringify(uncertainty.candidateIds) !== JSON.stringify(ids)) throw new Error("Prior covariance must be a finite N × N matrix in the displayed candidate order.");
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++)
      if (Math.abs(m[i][j] - m[j][i]) > 1e-10) throw new Error("Prior covariance must be symmetric.");
    // Semidefinite LDLᵀ check; zero pivots require a zero residual row.
    const a = m.map(row => [...row]);
    for (let k = 0; k < ids.length; k++) {
      if (a[k][k] < -1e-10) throw new Error("Prior covariance must be positive semidefinite.");
      if (a[k][k] <= 1e-10) {
        if (a[k].some((x, j) => j > k && Math.abs(x) > 1e-9)) throw new Error("Prior covariance must be positive semidefinite.");
        continue;
      }
      for (let i = k + 1; i < ids.length; i++) for (let j = k + 1; j < ids.length; j++) a[i][j] -= a[i][k] * a[k][j] / a[k][k];
    }
  }
  for (const [index, view] of (config.views ?? []).entries()) {
    if (!ids.includes(view.candidateId) || (view.type === "RELATIVE" && (!view.relativeCandidateId || view.relativeCandidateId === view.candidateId || !ids.includes(view.relativeCandidateId))))
      throw new Error(`View ${index + 1} must reference distinct selected candidates.`);
    if (!Number.isFinite(view.q) || !Number.isFinite(view.variance) || view.variance <= 0) throw new Error(`View ${index + 1} requires finite q and positive variance.`);
    if (!view.effectiveTimestamp || !view.availabilityTimestamp || Number.isNaN(Date.parse(view.effectiveTimestamp)) || Number.isNaN(Date.parse(view.availabilityTimestamp)))
      throw new Error(`View ${index + 1} requires explicit effective and availability dates.`);
    if (view.effectiveTimestamp.slice(0, 10) > cutoff || view.availabilityTimestamp.slice(0, 10) > cutoff ||
      Date.parse(view.effectiveTimestamp) > Date.parse(decision) || Date.parse(view.availabilityTimestamp) > Date.parse(decision))
      throw new Error(`View ${index + 1} is not available at this B2 cutoff and decision timestamp. Historical B3 decisions will independently check availability.`);
  }
}

export function ForecastModelPanel({ value, onChange, candidateIds, cutoff, observationCount, factors = [], representation, allocationMode }: {
  value: ForecastModelConfig; onChange: (value: ForecastModelConfig) => void; candidateIds: string[]; cutoff: string; observationCount: number | null;
  factors?: RidgeFactorOption[]; representation?: string; allocationMode?: string;
}) {
  const [matrixText, setMatrixText] = useState("");
  const [matrixError, setMatrixError] = useState("");
  const [viewUnits, setViewUnits] = useState<Record<number, "SE" | "VAR">>({});
  const update = (patch: Partial<ForecastModelConfig>) => onChange({ ...value, ...patch });
  const vectorEditor = (values: Record<string, number> | undefined, change: (next: Record<string, number>) => void, prefix: string) =>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{candidateIds.map(id =>
      <div key={id} className="space-y-1"><Label htmlFor={`${prefix}-${id}`}>{id} · daily decimal</Label><Input id={`${prefix}-${id}`} type="number" step="any" value={values?.[id] ?? ""} onChange={e => change({ ...values, [id]: e.target.value === "" ? NaN : Number(e.target.value) })} data-testid={`input-forecast-${prefix}-${id}`} /></div>)}</div>;
  const views = value.views ?? [];
  const ridge = value as RidgeForecastConfig;
  const isRidge = value.type === "SIGNAL_RIDGE" as ForecastModelConfig["type"];
  const ridgeSupported = representation === "asset_returns" && allocationMode === "CAPITAL_LONG_ONLY";
  const selectedFactors = ridge.factorIds ?? [];
  const updateRidge = (patch: Partial<RidgeForecastConfig>) => onChange({ ...ridge, ...patch } as ForecastModelConfig);
  const editView = (i: number, patch: Partial<ForecastView>) => update({ views: views.map((v, j) => j === i ? { ...v, ...patch } : v) });
  return <Card className="border-primary/20" data-testid="card-forecast-model-setup">
    <CardHeader className="pb-3"><div className="flex items-center gap-2"><Badge variant="outline">D3</Badge><CardTitle className="text-sm">Forecast model</CardTitle></div><CardDescription>Expected returns are estimated separately from the risk covariance. All optimizer inputs are daily decimal returns; annualization below is display only.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
         <div className="space-y-1"><Label htmlFor="forecast-type">Estimator</Label><select id="forecast-type" className={inputClass} value={value.type} onChange={e => update({ type: e.target.value as ForecastModelConfig["type"], ...(e.target.value === "SIGNAL_RIDGE" ? { factorIds: [], trainingWindowDates: 252, minTrainingDates: ridgeMinimum(0), lambdaSignal: 1, hacBandwidth: 5, executionTiming: "same_close" } : {}) } as Partial<ForecastModelConfig>)} data-testid="select-forecast-model"><option value="SAMPLE_MEAN">Sample Mean</option><option value="SHRUNK_MEAN">Shrunk Mean</option><option value="BAYESIAN_VIEWS">Bayesian Views</option><option value="SIGNAL_RIDGE">Signal Combination — Ridge</option></select></div>
        <div className="space-y-1"><Label htmlFor="forecast-z">Display interval z</Label><Input id="forecast-z" type="number" min="0.01" step="any" value={value.displayZ ?? 1.96} onChange={e => update({ displayZ: Number(e.target.value) })} data-testid="input-forecast-z" /><p className="text-[11px] text-muted-foreground">Display only. Does not alter weights.</p></div>
        <div className="rounded border bg-muted/30 px-3 py-2 text-xs"><strong>Estimation basis</strong><p className="mt-1">{candidateIds.length} candidates · {observationCount ?? "unknown"} aligned dates through {cutoff || "unset"}.</p></div>
      </div>
       {isRidge && <div className="space-y-4 rounded border border-primary/20 bg-primary/5 p-3" data-testid="section-ridge-definition">
         <div><h4 className="text-xs font-semibold uppercase tracking-wide">Definition · pooled signal ridge</h4><p className="mt-1 text-xs text-muted-foreground">Fit one shared intercept and factor slopes to daily excess returns. Factor values and training dates are read from the frozen B1 preparation, not a live factor library. This does not change the risk covariance model.</p></div>
         {!ridgeSupported ? <p role="alert" className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs" data-testid="status-ridge-unsupported">Unsupported: Signal Combination — Ridge requires asset_returns in CAPITAL_LONG_ONLY mode. Alpha streams and SIGNED_OVERLAY are not supported.</p> : <>
           <fieldset className="space-y-2"><legend className="text-xs font-medium">Supported factors · explicit selection</legend>
             {!factors.length ? <p className="rounded border border-dashed p-2 text-xs text-muted-foreground">No active supported factors in this frozen factor set. Select another prepared input before optimizing.</p> :
               <div className="grid gap-2 sm:grid-cols-2">{factors.map(factor => <label key={factor.id} className="flex items-start gap-2 rounded border bg-background p-2 text-xs"><input type="checkbox" className="mt-0.5" checked={selectedFactors.includes(factor.id)} onChange={e => { const next = e.target.checked ? [...selectedFactors, factor.id] : selectedFactors.filter(id => id !== factor.id); updateRidge({ factorIds: next, minTrainingDates: ridge.minTrainingDates === ridgeMinimum(selectedFactors.length) || ridge.minTrainingDates === undefined ? ridgeMinimum(next.length) : ridge.minTrainingDates }); }} data-testid={`input-ridge-factor-${factor.id}`} /><span><strong>{factor.name}</strong> <span className="font-mono text-muted-foreground">{factor.id}</span>{!!factor.aliases?.length && <span className="block text-muted-foreground">Aliases: {factor.aliases.join(", ")} · same factor, not additional features</span>}</span></label>)}</div>}
           </fieldset>
           <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
             <div className="space-y-1"><Label htmlFor="ridge-window">Training window · dates</Label><Input id="ridge-window" type="number" min="2" step="1" value={ridge.trainingWindowDates ?? 252} onChange={e => updateRidge({ trainingWindowDates: Number(e.target.value) })} data-testid="input-ridge-training-window" /></div>
             <div className="space-y-1"><Label htmlFor="ridge-min">Minimum training dates · at least {ridgeMinimum(selectedFactors.length)}</Label><Input id="ridge-min" type="number" min={ridgeMinimum(selectedFactors.length)} step="1" value={ridge.minTrainingDates ?? ridgeMinimum(selectedFactors.length)} onChange={e => updateRidge({ minTrainingDates: Number(e.target.value) })} data-testid="input-ridge-min-training" /></div>
             <div className="space-y-1"><Label htmlFor="ridge-lambda">Signal penalty λ · positive</Label><Input id="ridge-lambda" type="number" min="0.00000001" step="any" value={ridge.lambdaSignal ?? 1} onChange={e => updateRidge({ lambdaSignal: Number(e.target.value) })} data-testid="input-ridge-lambda" /></div>
             <div className="space-y-1"><Label htmlFor="ridge-hac">HAC bandwidth · dates</Label><Input id="ridge-hac" type="number" min="0" step="1" value={ridge.hacBandwidth ?? 5} onChange={e => updateRidge({ hacBandwidth: Number(e.target.value) })} data-testid="input-ridge-hac" /></div>
             <div className="space-y-1"><Label htmlFor="ridge-timing">Signal / execution timing</Label><select id="ridge-timing" className={inputClass} value={ridge.executionTiming ?? "next_close"} onChange={e => updateRidge({ executionTiming: e.target.value as "same_close" | "next_close" })} data-testid="select-ridge-execution-timing"><option value="next_close">Next close</option><option value="same_close">Same close</option></select></div>
           </div><p className="text-xs text-muted-foreground">HAC estimates approximate sampling uncertainty of the penalized fitted mean; it does not account for selection, tuning, or realized-return risk. The execution choice governs feature availability and target alignment.</p>
         </>}
       </div>}
       {value.type !== "SAMPLE_MEAN" && !isRidge && <div className="space-y-3 rounded border bg-muted/20 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide">Linear shrinkage · fixed prior</h4>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="forecast-s">Strength s [0, 1]</Label><Input id="forecast-s" type="number" min="0" max="1" step="any" value={value.shrinkage ?? 0} onChange={e => update({ shrinkage: Number(e.target.value) })} data-testid="input-forecast-shrinkage" /></div>
          <div className="space-y-1"><Label htmlFor="forecast-shrink-source">Shrinkage prior</Label><select id="forecast-shrink-source" className={inputClass} value={value.shrinkagePrior?.source ?? "DEFAULT"} onChange={e => update({ shrinkagePrior: { source: e.target.value as "DEFAULT" | "USER_DEFINED", ...(e.target.value === "USER_DEFINED" ? { values: value.shrinkagePrior?.values ?? {} } : {}) } })} data-testid="select-forecast-shrink-prior"><option value="DEFAULT">Default · cash yield / zero excess</option><option value="USER_DEFINED">User-defined vector</option></select></div></div>
        {value.shrinkagePrior?.source === "USER_DEFINED" && vectorEditor(value.shrinkagePrior.values, values => update({ shrinkagePrior: { source: "USER_DEFINED", values } }), "shrink-prior")}
        <p className="text-xs text-muted-foreground">The fixed prior is treated as deterministic. Sampling uncertainty is (1−s)²Σ/T; it excludes uncertainty in the prior. At s=1 the forecast is entirely determined by the fixed prior, not statistically certain.</p>
      </div>}
      {value.type === "BAYESIAN_VIEWS" && <>
        <div className="space-y-3 rounded border bg-muted/20 p-3"><h4 className="text-xs font-semibold uppercase tracking-wide">Gaussian prior</h4>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="forecast-prior-source">Prior mean source</Label><select id="forecast-prior-source" className={inputClass} value={value.priorMean?.source ?? "SAMPLE_PRIOR"} onChange={e => update({ priorMean: { source: e.target.value as "SAMPLE_PRIOR" | "SHRUNK_PRIOR" | "USER_DEFINED_PRIOR", ...(e.target.value === "USER_DEFINED_PRIOR" ? { values: value.priorMean?.values ?? {} } : {}) } })} data-testid="select-forecast-prior-source"><option value="SAMPLE_PRIOR">Sample prior</option><option value="SHRUNK_PRIOR">Shrunk prior</option><option value="USER_DEFINED_PRIOR">User-defined prior</option></select></div><div className="space-y-1"><Label htmlFor="forecast-prior-uncertainty">Prior uncertainty</Label><select id="forecast-prior-uncertainty" className={inputClass} value={value.priorUncertainty?.type ?? "TAU_SIGMA"} onChange={e => update({ priorUncertainty: e.target.value === "TAU_SIGMA" ? { type: "TAU_SIGMA", tau: value.priorUncertainty?.tau } : { type: "USER_DEFINED", candidateIds, matrix: value.priorUncertainty?.matrix ?? [] } })} data-testid="select-forecast-prior-uncertainty"><option value="TAU_SIGMA">τ × selected risk covariance</option><option value="USER_DEFINED">User-defined PSD covariance matrix</option></select></div></div>
          {value.priorMean?.source === "USER_DEFINED_PRIOR" && vectorEditor(value.priorMean.values, values => update({ priorMean: { source: "USER_DEFINED_PRIOR", values } }), "bayesian-prior")}
          {value.priorUncertainty?.type !== "USER_DEFINED" ? <div className="max-w-xs space-y-1"><Label htmlFor="forecast-tau">τ (positive; blank = 1/T)</Label><Input id="forecast-tau" type="number" min="0.00000001" step="any" value={value.priorUncertainty?.tau ?? ""} onChange={e => update({ priorUncertainty: { type: "TAU_SIGMA", ...(e.target.value ? { tau: Number(e.target.value) } : {}) } })} data-testid="input-forecast-tau" /></div> :
            <div className="space-y-1"><Label htmlFor="forecast-matrix">Covariance matrix JSON · row and column order: {candidateIds.join(", ")}</Label><textarea id="forecast-matrix" rows={4} className="w-full rounded-md border bg-background p-2 font-mono text-xs" value={matrixText} placeholder={JSON.stringify(candidateIds.map((_, i) => candidateIds.map((__, j) => i === j ? 0.000001 : 0)))} onChange={e => { const text = e.target.value; setMatrixText(text); try { const matrix: unknown = JSON.parse(text); if (!Array.isArray(matrix)) throw new Error("Expected a two-dimensional JSON array."); update({ priorUncertainty: { type: "USER_DEFINED", candidateIds, matrix: matrix as number[][] } }); setMatrixError(""); } catch (err) { setMatrixError(err instanceof Error ? err.message : "Invalid matrix."); } }} data-testid="input-forecast-matrix" />{matrixError && <p role="alert" className="text-xs text-destructive">{matrixError}</p>}</div>}
        </div>
        <div className="space-y-3 rounded border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><div><h4 className="text-xs font-semibold uppercase tracking-wide">Dated views</h4><p className="text-xs text-muted-foreground">Both dates are required. At least one view must be eligible by B2 cutoff. B3 decisions before any view becomes effective and available return an explicit unavailable status; views are never applied retroactively.</p></div><Button type="button" variant="outline" size="sm" onClick={() => update({ views: [...views, { type: "ABSOLUTE", candidateId: candidateIds[0] ?? "", q: 0, variance: 0.000001, effectiveTimestamp: "", availabilityTimestamp: "" }] })} disabled={!candidateIds.length} data-testid="button-add-forecast-view">Add view</Button></div>
          {!views.length && <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">Add at least one dated view before optimizing with the Bayesian estimator.</p>}
          {views.map((v, i) => <div key={i} className="space-y-2 rounded border bg-background p-3"><div className="flex items-center justify-between"><strong className="text-xs">View {i + 1}</strong><Button type="button" size="sm" variant="ghost" onClick={() => update({ views: views.filter((_, j) => j !== i) })} data-testid={`button-remove-forecast-view-${i}`}>Remove</Button></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-1"><Label htmlFor={`view-type-${i}`}>Equation</Label><select id={`view-type-${i}`} className={inputClass} value={v.type} onChange={e => { const type = e.target.value as ForecastView["type"]; update({ views: views.map((entry, j) => j !== i ? entry : type === "ABSOLUTE" ? { type, candidateId: entry.candidateId, q: entry.q, variance: entry.variance, effectiveTimestamp: entry.effectiveTimestamp, availabilityTimestamp: entry.availabilityTimestamp } : { ...entry, type, relativeCandidateId: entry.relativeCandidateId ?? "" }) }); }} data-testid={`select-forecast-view-type-${i}`}><option value="ABSOLUTE">Absolute μA = q</option><option value="RELATIVE">Relative μA − μB = q</option></select></div><div className="space-y-1"><Label htmlFor={`view-a-${i}`}>Candidate A</Label><select id={`view-a-${i}`} className={inputClass} value={v.candidateId} onChange={e => editView(i, { candidateId: e.target.value })} data-testid={`select-forecast-view-a-${i}`}>{candidateIds.map(id => <option key={id} value={id}>{id}</option>)}</select></div>{v.type === "RELATIVE" && <div className="space-y-1"><Label htmlFor={`view-b-${i}`}>Candidate B</Label><select id={`view-b-${i}`} className={inputClass} value={v.relativeCandidateId ?? ""} onChange={e => editView(i, { relativeCandidateId: e.target.value })} data-testid={`select-forecast-view-b-${i}`}><option value="">Select B</option>{candidateIds.filter(id => id !== v.candidateId).map(id => <option key={id} value={id}>{id}</option>)}</select></div>}
              <div className="space-y-1"><Label htmlFor={`view-q-${i}`}>q · daily decimal</Label><Input id={`view-q-${i}`} type="number" step="any" value={v.q} onChange={e => editView(i, { q: Number(e.target.value) })} data-testid={`input-forecast-view-q-${i}`} /></div>
              <div className="space-y-1"><Label htmlFor={`view-unit-${i}`}>Uncertainty input</Label><select id={`view-unit-${i}`} className={inputClass} value={viewUnits[i] ?? "SE"} onChange={e => setViewUnits(u => ({ ...u, [i]: e.target.value as "SE" | "VAR" }))} data-testid={`select-forecast-view-unit-${i}`}><option value="SE">Standard error (daily decimal)</option><option value="VAR">Variance (daily decimal²)</option></select></div>
              <div className="space-y-1"><Label htmlFor={`view-uncertainty-${i}`}>{viewUnits[i] === "VAR" ? "Variance" : "Standard error"}</Label><Input id={`view-uncertainty-${i}`} type="number" min="0" step="any" value={viewUnits[i] === "VAR" ? v.variance : Math.sqrt(v.variance)} onChange={e => { const x = Number(e.target.value); editView(i, { variance: viewUnits[i] === "VAR" ? x : x * x }); }} data-testid={`input-forecast-view-uncertainty-${i}`} /></div>
              <div className="space-y-1"><Label htmlFor={`view-effective-${i}`}>Effective date</Label><Input id={`view-effective-${i}`} type="date" value={v.effectiveTimestamp.slice(0, 10)} onChange={e => editView(i, { effectiveTimestamp: e.target.value })} data-testid={`input-forecast-view-effective-${i}`} /></div><div className="space-y-1"><Label htmlFor={`view-available-${i}`}>Available date</Label><Input id={`view-available-${i}`} type="date" value={v.availabilityTimestamp.slice(0, 10)} onChange={e => editView(i, { availabilityTimestamp: e.target.value })} data-testid={`input-forecast-view-available-${i}`} /></div></div>
            <p className="text-[11px] text-muted-foreground">Ω view variance sent to engine: {shown(v.variance)} daily decimal².</p>
          </div>)}
        </div>
      </>}
    </CardContent>
  </Card>;
}

export function ForecastResults({ forecast, frozenConfig, candidateIds, allocation, legacy = false }: {
  forecast: unknown; frozenConfig: unknown; candidateIds: string[]; allocation: unknown; legacy?: boolean;
}) {
  const [tab, setTab] = useState<"Forecasts" | "Uncertainty" | "Views" | "Stability" | "Model Comparison">("Forecasts");
  const f = obj(forecast), cfg = obj(frozenConfig), a = obj(allocation);
  const ids = (Array.isArray(f.candidateIds) ? f.candidateIds : candidateIds).filter((x): x is string => typeof x === "string");
  const mu = field(f, "muHat", "mu", "finalForecast", "expectedReturns");
  const sample = field(f, "sampleMeans", "muSample");
  const se = field(f, "standardErrors", "forecastSE", "standardError");
  const t = field(f, "observationCount", "T");
  const series = ids.map((id, index) => ({ id, m: scalar(vectorValue(mu, id, index)), s: scalar(vectorValue(sample, id, index)), se: scalar(vectorValue(se, id, index)) }));
  const validMu = series.map(x => x.m).filter(Number.isFinite);
  const validSe = series.map(x => x.se).filter(Number.isFinite).sort((x, y) => x - y);
  const medianSe = validSe.length ? (validSe[(validSe.length - 1) >> 1] + validSe[validSe.length >> 1]) / 2 : null;
  const z = number(cfg.displayZ) ?? number(f.displayZ) ?? 1.96;
  const views = arr(field(f, "views", "viewDiagnostics"));
  const stability = obj(field(f, "stability", "stabilityDiagnostics"));
  const ridge = obj(f.ridge);
  const isRidge = cfg.type === "SIGNAL_RIDGE" || f.estimator === "SIGNAL_RIDGE" || Object.keys(ridge).length > 0;
  const ridgeRows = arr(ridge.predictions);
  const ridgeFactors = Array.isArray(ridge.factorIds) ? ridge.factorIds : Array.isArray(cfg.factorIds) ? cfg.factorIds : [];
  const ridgeScaler = arr(ridge.scaler);
  const ridgeV = ridge.V_mu;
  return <Card className="border-primary/20" data-testid="card-forecast-results"><CardHeader className="pb-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">D3</Badge><CardTitle className="text-sm">Forecast summary</CardTitle>{f.status != null && <Badge variant="outline">{shown(f.status)}</Badge>}{legacy && <Badge variant="secondary">Legacy embedded estimator</Badge>}</div><CardDescription>Frozen estimation state from this allocation. Editing the setup above does not change these results.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {isRidge && <div className="space-y-3" data-testid="section-ridge-frozen-fit">
        <div className="rounded border border-primary/20 bg-primary/5 p-3 text-xs">
          <h4 className="font-semibold uppercase tracking-wide">Definition · saved ridge fit</h4>
          <p className="mt-1">Requested factors: {shown(ridge.requestedFactorIds ?? cfg.factorIds)} · fitted factors: {ridgeFactors.length ? ridgeFactors.map(shown).join(", ") : "Unavailable"} · aliases: {shown(ridge.factorAliases)} · peer universe: {shown(ridge.peerUniverse)}.</p>
          <p className="mt-1">Window {shown(cfg.trainingWindowDates)} dates · minimum {shown(cfg.minTrainingDates)} dates · λ {shown(ridge.lambdaSignal ?? cfg.lambdaSignal)} · HAC {shown(ridge.hacBandwidth ?? cfg.hacBandwidth)} · {shown(cfg.executionTiming)}. Training: {shown(ridge.trainingDateCount)} dates / {shown(ridge.trainingRowCount)} asset-date rows. Signal and label dates appear with each forecast below.</p>
        </div>
        <div className="rounded border p-3 text-xs">
          <h4 className="font-semibold uppercase tracking-wide">Coefficients &amp; forecasts</h4>
          <p className="mt-1">Shared intercept: <strong className="font-mono">{daily(ridge.intercept)}</strong> daily excess return. Slopes operate on training-window standardized features; scaler means and standard deviations are frozen with the fit.</p>
          <div className="mt-2 overflow-auto"><table className="w-full min-w-[500px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Factor</th><th className="p-2">Slope</th><th className="p-2">Scaler mean</th><th className="p-2">Scaler σ</th></tr></thead><tbody>{ridgeFactors.map((factor, i) => { const scaler = ridgeScaler.find(row => row.factorId === factor) ?? {}; return <tr key={String(factor)} className="border-t font-mono"><th className="p-2">{shown(factor)}</th><td className="p-2">{shown(vectorValue(ridge.slopes, String(factor), i))}</td><td className="p-2">{shown(scaler.mean)}</td><td className="p-2">{shown(scaler.standardDeviation)}</td></tr>; })}</tbody></table></div>
          {!!ridgeRows.length && <div className="mt-3 overflow-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Asset / signal</th><th className="p-2">Cutoff / execution / label</th><th className="p-2">Contributions</th><th className="p-2">Excess μ</th><th className="p-2">Gross μ</th><th className="p-2">SE</th></tr></thead><tbody>{ridgeRows.map((row, i) => <tr key={`${shown(row.candidateId)}-${i}`} className="border-t align-top"><th className="p-2">{shown(row.candidateId ?? row.asset)} · {shown(row.signalDate)}</th><td className="p-2">{shown(row.informationCutoff)} / {shown(row.executionDate)} / {shown(row.labelStart)} → {shown(row.labelEnd)}</td><td className="p-2">{arr(row.contributions).map(c => `${shown(c.factorId)}: ${daily(c.contribution)}`).join(" · ") || "—"}</td><td className="p-2">{daily(row.excessPrediction)}</td><td className="p-2">{daily(row.grossPrediction)}</td><td className="p-2">{daily(row.forecastStandardError)}</td></tr>)}</tbody></table></div>}
          <details className="mt-2"><summary className="cursor-pointer">Inspect frozen scaler, feature contributions, Vμ and date scores</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ scaler: ridge.scaler, predictions: ridgeRows, V_mu: ridgeV, coefficientCovariance: ridge.coefficientCovariance, dateScores: ridge.dateScores }, null, 2)}</pre></details>
        </div>
        <p className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground"><strong>Validation · uncertainty is conditional.</strong> Vμ / SE approximates sampling uncertainty of the penalized fitted mean under the HAC assumptions. It is not return volatility, a realized-return interval, a causal effect, or evidence of profitability. Factor choice, λ tuning, universe selection and future execution uncertainty are not included. Inspect B3 for independent point-in-time refits and matured errors.</p>
      </div>}
      {Object.keys(f).length ? <><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[
        ["Estimator", shown(f.estimator ?? f.type ?? cfg.type)], ["Window / observations", `${shown(field(f, "estimationWindow", "window") ?? obj(obj(f.stability).observationCounts).base)} / ${shown(t)}`],
        ["Candidates / dates", `${ids.length} · ${shown(Array.isArray(f.dates) ? f.dates[0] : field(f, "startDate", "windowStart"))} → ${shown(Array.isArray(f.dates) ? f.dates[f.dates.length - 1] : field(f, "endDate", "windowEnd"))}`],
        ["Expected-return range", validMu.length ? `${daily(Math.min(...validMu))} to ${daily(Math.max(...validMu))}` : "—"],
        ["Median forecast SE", daily(medianSe)], ["Prior source", shown(obj(cfg.priorMean).source ?? obj(cfg.shrinkagePrior).source ?? "None")],
        ["Shrinkage / views", `${shown(f.shrinkage ?? cfg.shrinkage ?? "none")} / ${views.length}`],
      ].map(([label, value]) => <div key={label} className="rounded border bg-muted/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-xs font-medium tabular-nums">{value}</p></div>)}</div>
        <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist" aria-label="Forecast result views">{(["Forecasts", "Uncertainty", "Views", "Stability", "Model Comparison"] as const).map(name => <Button key={name} type="button" size="sm" variant={tab === name ? "default" : "ghost"} role="tab" aria-selected={tab === name} onClick={() => setTab(name)} data-testid={`button-forecast-tab-${name.toLowerCase().replace(" ", "-")}`}>{name}</Button>)}</div>
        {tab === "Forecasts" && <div className="overflow-auto rounded border"><table className="w-full min-w-[580px] text-left text-xs"><thead className="bg-muted"><tr>{["Candidate", "Sample mean", "Final forecast", "Difference", "Annualized display (×252)"].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{series.map(x => <tr className="border-t tabular-nums" key={x.id}><th className="p-2 font-medium">{x.id}</th><td className="p-2">{daily(x.s)}</td><td className="p-2 font-semibold">{daily(x.m)}</td><td className="p-2">{daily(x.m - x.s)}</td><td className="p-2">{Number.isFinite(x.m) ? `${(x.m * 252 * 100).toFixed(2)}%` : "—"}</td></tr>)}</tbody></table></div>}
        {tab === "Uncertainty" && <div className="space-y-3"><p className="text-xs text-muted-foreground">Gaussian forecast-uncertainty interval under model assumptions (μ ± {z} × SE). These are not guaranteed realized-return intervals. Forecast / SE is estimation signal-to-noise, not a significance test or automatic filter.</p><div className="overflow-auto rounded border"><table className="w-full min-w-[580px] text-left text-xs"><thead className="bg-muted"><tr>{["Candidate", "Forecast", "Forecast SE", "Forecast / SE", "Model-based interval"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{series.map(x => <tr key={x.id} className="border-t tabular-nums"><th className="p-2">{x.id}</th><td className="p-2">{daily(x.m)}</td><td className="p-2">{daily(x.se)}</td><td className="p-2">{Number.isFinite(x.se) && x.se > 0 ? shown(x.m / x.se) : "Undefined"}</td><td className="p-2">{Number.isFinite(x.se) ? `${daily(x.m - z * x.se)} to ${daily(x.m + z * x.se)}` : "—"}</td></tr>)}</tbody></table></div>
          <div className="grid gap-2 sm:grid-cols-2"><div className="rounded border border-primary/20 bg-primary/5 p-3 text-xs"><strong>Expected-return uncertainty</strong><p className="mt-1">Portfolio expected return: {daily(obj(f.portfolio).expectedReturn)} · forecast SE: {daily(obj(f.portfolio).standardError)} · variance of expected return: {shown(obj(f.portfolio).varianceOfExpectedReturn)}.</p></div><div className="rounded border p-3 text-xs"><strong>Portfolio risk</strong><p className="mt-1">Return covariance risk / estimated volatility: {shown(a.estimatedVolatility ?? obj(a.signedOverlay).estimatedVolatility)}. This is distinct from uncertainty in μ.</p></div></div>
          {f.uncertaintyAssumption != null && <p className="rounded border bg-muted/20 p-2 text-xs">Model assumption: {shown(f.uncertaintyAssumption)}</p>}
          <details className="rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">Inspect frozen Vμ, prior and covariance assumptions</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ V_mu: f.V_mu, priorMean: f.priorMean, priorUncertainty: f.priorUncertainty, tau: f.tau, shrinkageDelta: f.shrinkageDelta }, null, 2)}</pre></details>
          {Number(f.shrinkage ?? cfg.shrinkage) === 1 && <p className="text-xs text-amber-700">Forecast entirely determined by fixed prior. Zero conditional sampling uncertainty does not mean the true expected return is known.</p>}</div>}
        {tab === "Views" && <div className="space-y-2">{(cfg.type === "BAYESIAN_VIEWS" || f.estimator === "BAYESIAN_VIEWS") ? (views.length ? views.map((v, i) => <div key={i} className="rounded border bg-muted/20 p-3 text-xs"><strong>{shown(v.equation ?? `${shown(v.candidateId)}${v.type === "RELATIVE" ? ` − ${shown(v.relativeCandidateId)}` : ""} = ${shown(v.q)}`)}</strong><p>q {daily(v.q)} · variance {shown(v.variance)} · effective {shown(v.effectiveTimestamp)} · available {shown(v.availabilityTimestamp)} · status {shown(v.status ?? "Frozen")}</p></div>) : <p className="text-xs text-muted-foreground">No dated views in the frozen forecast. The Gaussian prior remains the forecast.</p>) : <p className="text-xs text-muted-foreground">Views apply only to the Bayesian estimator.</p>}</div>}
        {tab === "Stability" && <div className="space-y-2"><p className="text-xs text-muted-foreground">Short / base / long windows are diagnostics only (default 0.75 / 1 / 1.25). They do not select parameters or change the optimizer.</p>{Object.keys(stability).length ? <><div className="overflow-auto rounded border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Candidate</th>{(["short", "base", "long", "dispersion"] as const).map(k => <th key={k} className="p-2 capitalize">{k} {k !== "dispersion" ? `(${shown(obj(stability.observationCounts)[k])} obs)` : ""}</th>)}</tr></thead><tbody>{ids.map((id, i) => <tr key={id} className="border-t tabular-nums"><th className="p-2">{id}</th>{(["short", "base", "long", "dispersion"] as const).map(k => <td key={k} className="p-2">{daily(vectorValue(stability[k], id, i))}</td>)}</tr>)}</tbody></table></div><details className="text-xs"><summary className="cursor-pointer">Complete frozen stability diagnostic</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(stability, null, 2)}</pre></details></> : <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">No stability diagnostic was returned for this frozen record.</p>}</div>}
        {tab === "Model Comparison" && <ForecastComparisonPanel />}
      </> : <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">This saved allocation predates D3 and has no frozen forecast snapshot. Legacy expected-return fields remain available in the allocation details below.</p>}
    </CardContent>
  </Card>;
}