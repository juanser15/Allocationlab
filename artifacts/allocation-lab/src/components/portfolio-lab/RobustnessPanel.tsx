import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Row = Record<string, unknown>;
type View = "Nominal vs Robust" | "Sensitivity" | "Stability" | "Methodology";
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const fmt = (value: unknown, digits = 5) => finite(value) === null ? "Unavailable" : finite(value)!.toLocaleString(undefined, { maximumFractionDigits: digits });
const bp = (value: unknown) => finite(value) === null ? "Unavailable" : `${fmt(finite(value)! * 10000, 3)} bp/day`;
const weights = (value: unknown): Row => object(value);
const distance = (left: unknown, right: unknown): number | null => {
  const a = weights(left), b = weights(right);
  if (!Object.keys(a).length || !Object.keys(b).length) return null;
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  if ([...ids].some(id => (a[id] !== undefined && finite(a[id]) === null) || (b[id] !== undefined && finite(b[id]) === null))) return null;
  return [...ids].reduce((sum, id) => sum + Math.abs((finite(a[id]) ?? 0) - (finite(b[id]) ?? 0)), 0) / 2;
};
const entries = (value: unknown) => Object.entries(object(value)).filter((entry): entry is [string, number] => finite(entry[1]) !== null);
const first = (row: Row, ...keys: string[]) => keys.map(key => row[key]).find(value => value !== undefined && value !== null);
const label = (value: unknown) => value === undefined || value === null ? "Unavailable" : String(value);
function derivedCandidate(weightRecord: unknown, modelValue: unknown, forecastValue: unknown, requestValue: unknown): Row {
  const weights = object(weightRecord), model = object(modelValue), forecast = object(forecastValue), request = object(requestValue);
  const ids = Array.isArray(model.candidateIds) ? model.candidateIds.filter((id): id is string => typeof id === "string") : [];
  const assets = Array.isArray(model.assetTickers) ? model.assetTickers.filter((id): id is string => typeof id === "string") : [];
  const w = ids.map(id => finite(weights[id]));
  if (!ids.length || w.some(x => x === null)) return { candidateWeights: weights };
  const vector = w as number[];
  const matrix = Array.isArray(model.H) ? model.H as unknown[][] : [];
  const assetWeights = matrix.length === assets.length && matrix.every(row => Array.isArray(row) && row.length === ids.length)
    ? Object.fromEntries(assets.map((id, i) => [id, (matrix[i] as unknown[]).reduce<number>((sum, value, j) => sum + (finite(value) ?? 0) * vector[j], 0)])) : undefined;
  const dot = (values: unknown) => Array.isArray(values) && values.length === ids.length && values.every(x => finite(x) !== null)
    ? values.reduce<number>((sum, x, i) => sum + (x as number) * vector[i], 0) : null;
  const quad = (value: unknown) => Array.isArray(value) && value.length === ids.length && value.every(row => Array.isArray(row) && row.length === ids.length && row.every(x => finite(x) !== null))
    ? (value as number[][]).reduce((sum, row, i) => sum + vector[i] * row.reduce((inner, x, j) => inner + x * vector[j], 0), 0) : null;
  const masterCash = 1 - vector.reduce((sum, x) => sum + x, 0);
  const distributionCash = dot(model.d);
  const mu = dot(model.mu);
  const variance = quad(model.sigma);
  const uncertainty = quad(forecast.V_mu);
  const cashYield = finite(request.dailyCashYield);
  return {
    candidateWeights: weights, assetWeights,
    ...(distributionCash !== null ? { totalCash: masterCash + distributionCash } : {}),
    ...(mu !== null && cashYield !== null ? { estimatedGrossReturn: mu + cashYield * masterCash } : {}),
    ...(variance !== null ? { estimatedVolatility: Math.sqrt(Math.max(0, variance)) } : {}),
    ...(uncertainty !== null ? { forecastSE: Math.sqrt(Math.max(0, uncertainty)) } : {}),
  };
}

function Measure({ title, value, caption }: { title: string; value: string; caption?: string }) {
  return <div className="min-w-0 border-l-2 border-primary/40 pl-3" data-testid={`metric-robustness-${title.toLowerCase().replace(/\W+/g, "-")}`}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{title}</div>
    <div className="mt-1 break-words font-mono text-sm font-semibold tabular-nums">{value}</div>
    {caption && <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>}
  </div>;
}

function Candidate({ title, candidate, fallback, forecast }: { title: string; candidate: Row; fallback?: Row; forecast: Row }) {
  const source = Object.keys(candidate).length ? candidate : object(fallback);
  const candidateWeights = first(source, "candidateWeights", "weights");
  const assetWeights = first(source, "assetWeights", "underlyingAssetWeights");
  const slacks = array(first(source, "constraintSlacks", "bindingConstraints"));
  const binding = slacks.filter(item => Array.isArray(item.sides) || item.binding === true || Math.abs(finite(item.minSlack) ?? Infinity) < 1e-6 || Math.abs(finite(item.maxSlack) ?? Infinity) < 1e-6);
  const exposure = object(source.signedOverlay);
  const expected = first(source, "estimatedGrossReturn", "expectedReturn", "estimatedReturn", "expectedExcessReturn");
  return <div className="min-w-0 rounded-lg border border-border/80 bg-background/80 p-3.5">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
      <h4 className="text-xs font-semibold">{title}</h4>
      <Badge variant="outline" className="font-mono text-[10px]">{label(first(source, "status", "solverStatus", "state"))}</Badge>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
      <Measure title="Expected return" value={bp(expected)} />
      <Measure title="Risk / volatility" value={fmt(first(source, "estimatedVolatility", "risk", "volatility"))} />
      <Measure title="Forecast SE" value={bp(first(source, "forecastSE", "expectedReturnSE", "standardError", "portfolioForecastSE") ?? object(forecast.portfolio).standardError)} caption="Uncertainty in expected return" />
      <Measure title="Cash target" value={fmt(first(source, "totalCash", "cashTarget") ?? exposure.cashTarget)} />
      <Measure title="Gross asset" value={fmt(first(source, "grossAssetExposure", "gross") ?? exposure.grossAssetExposure ?? entries(assetWeights).reduce((sum, [, x]) => sum + Math.abs(x), 0))} />
      <Measure title="Net asset" value={fmt(first(source, "netAssetExposure", "net") ?? exposure.netAssetExposure ?? entries(assetWeights).reduce((sum, [, x]) => sum + x, 0))} />
    </div>
    <details className="mt-3 border-t border-border/70 pt-2 text-xs"><summary className="cursor-pointer font-medium" data-testid={`details-robustness-${title.toLowerCase().replace(/\W+/g, "-")}`}>Weights & binding constraints</summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div><p className="mb-1 text-muted-foreground">Candidate weights</p>{entries(candidateWeights).length ? entries(candidateWeights).map(([id, value]) => <div key={id} className="flex justify-between gap-3 border-b border-border/50 py-1 font-mono"><span className="truncate">{id}</span><span>{fmt(value)}</span></div>) : "Unavailable"}</div>
        <div><p className="mb-1 text-muted-foreground">Underlying asset weights</p>{entries(assetWeights).length ? entries(assetWeights).map(([id, value]) => <div key={id} className="flex justify-between gap-3 border-b border-border/50 py-1 font-mono"><span className="truncate">{id}</span><span>{fmt(value)}</span></div>) : "Unavailable"}</div>
      </div>
      <p className="mt-3 text-muted-foreground">Binding constraints: {binding.length ? binding.map(item => label(item.name)).join(", ") : slacks.length ? "None at reported tolerance" : "Unavailable"}</p>
    </details>
  </div>;
}

export function RobustnessPanel({ result, request, replay, compact = false }: { result: unknown; request?: unknown; replay?: unknown; compact?: boolean }) {
  const [view, setView] = useState<View>("Nominal vs Robust");
  const output = object(result), config = object(object(request).robustness);
  const robust = object(output.robustness);
  const diagnostic = object(robust.diagnostics ?? output.robustnessDiagnostics ?? object(output.diagnostics).robustness ?? (output.diagnostics && object(output.diagnostics).comparison ? output.diagnostics : undefined));
  const comparison = object(diagnostic.comparison);
  const comparisonReturn = object(comparison.return), comparisonRisk = object(comparison.risk);
  const comparisonSE = object(comparison.forecastStandardError);
  const comparisonExposure = object(comparison.exposure);
  const comparisonBindings = object(comparison.bindingConstraints);
  const nominal = object(first(robust, "nominal", "nominalCandidate", "nominalAllocation"));
  const robustCandidate = object(first(robust, "robust", "robustCandidate", "robustAllocation"));
  const current = object(output);
  const forecast = object(output.forecast);
  const nominalDerived = derivedCandidate(robust.nominalWeights, output.model, forecast, request);
  const robustDerived = derivedCandidate(robust.robustWeights, output.model, forecast, request);
  const nominalDisplay = { ...(Object.keys(nominalDerived).length ? nominalDerived : object(object(request).robustness).method === "NOMINAL" ? current : {}), ...nominal,
    ...(finite(comparisonReturn.nominal) !== null ? { estimatedGrossReturn: comparisonReturn.nominal } : {}),
    ...(finite(comparisonRisk.nominal) !== null ? { estimatedVolatility: comparisonRisk.nominal } : {}),
    ...(finite(comparisonSE.nominal) !== null ? { forecastSE: comparisonSE.nominal } : {}),
    ...(finite(object(comparisonExposure.cash).nominal) !== null ? { totalCash: object(comparisonExposure.cash).nominal } : {}),
    ...(finite(object(comparisonExposure.gross).nominal) !== null ? { grossAssetExposure: object(comparisonExposure.gross).nominal } : {}),
    ...(finite(object(comparisonExposure.net).nominal) !== null ? { netAssetExposure: object(comparisonExposure.net).nominal } : {}),
    ...(Array.isArray(comparisonBindings.nominal) ? { bindingConstraints: comparisonBindings.nominal } : {}),
    ...(comparison.nominalStatus ? { status: comparison.nominalStatus } : {}),
  };
  const robustDisplay = { ...(Object.keys(robustDerived).length ? robustDerived : object(object(request).robustness).method === "ROBUST_MEAN_UNCERTAINTY" ? current : {}), ...robustCandidate,
    ...(finite(comparisonReturn.robust) !== null ? { estimatedGrossReturn: comparisonReturn.robust } : {}),
    ...(finite(comparisonRisk.robust) !== null ? { estimatedVolatility: comparisonRisk.robust } : {}),
    ...(finite(comparisonSE.robust) !== null ? { forecastSE: comparisonSE.robust } : {}),
    ...(finite(object(comparisonExposure.cash).robust) !== null ? { totalCash: object(comparisonExposure.cash).robust } : {}),
    ...(finite(object(comparisonExposure.gross).robust) !== null ? { grossAssetExposure: object(comparisonExposure.gross).robust } : {}),
    ...(finite(object(comparisonExposure.net).robust) !== null ? { netAssetExposure: object(comparisonExposure.net).robust } : {}),
    ...(Array.isArray(comparisonBindings.robust) ? { bindingConstraints: comparisonBindings.robust } : {}),
    ...(comparison.baselineStatus ? { status: comparison.baselineStatus } : {}),
  };
  const nominalAssets = first(nominalDisplay, "assetWeights", "underlyingAssetWeights") ?? robust.nominalAssetWeights;
  const robustAssets = first(robustDisplay, "assetWeights", "underlyingAssetWeights") ?? robust.robustAssetWeights;
  const nominalCandidateWeights = first(nominalDisplay, "candidateWeights", "weights") ?? robust.nominalWeights;
  const robustCandidateWeights = first(robustDisplay, "candidateWeights", "weights") ?? robust.robustWeights;
  const method = config.method ?? robust.method;
  const kappa = config.kappa ?? robust.kappa;
  const methodLabel = method === "ROBUST_MEAN_UNCERTAINTY"
    ? "Robust to forecast uncertainty"
    : method === "NOMINAL" ? "Nominal" : "Not recorded";
  const sensitivities = array(first(diagnostic, "sensitivity", "sensitivityCases") ?? first(robust, "sensitivity", "sensitivityCases", "sensitivities") ?? object(robust.sensitivity).cases);
  const covariance = object(diagnostic.covarianceUncertainty ?? robust.covarianceUncertainty);
  const perturbations = array(first(robust, "covariancePerturbations", "covarianceSensitivity") ?? object(robust.stability).covariancePerturbations);
  const covarianceCases: Row[] = perturbations.length ? perturbations : [
    ...array(covariance.offDiagonalDependence).map(row => ({ ...row, name: `Off-diagonal ${fmt((finite(row.dependenceChange) ?? 0) * 100, 0)}%`, risk: row.volatility })),
    ...array(covariance.alternateEstimators).map(row => ({ ...row, name: `Same-window ${label(row.type)}`, risk: row.volatility })),
  ];
  const replayRecord = object(replay);
  const hasResults = Object.keys(robust).length > 0;
  return <Card className="overflow-hidden border-primary/20 bg-primary/[0.025]" data-testid="card-portfolio-robustness">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" /><CardTitle className="text-sm uppercase tracking-[0.12em]">Portfolio robustness</CardTitle><Badge variant="outline" className="ml-auto font-mono text-[10px]">{methodLabel} · κ {kappa === null || kappa === undefined ? "Not recorded" : fmt(kappa, 3)}</Badge></div>
      <CardDescription>Frozen point-in-time diagnostic. Compare sensitivity, not winners or historical trading costs.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist" aria-label="Portfolio robustness views">{(["Nominal vs Robust", "Sensitivity", "Stability", "Methodology"] as const).map(name =>
        <button key={name} type="button" role="tab" aria-selected={view === name} onClick={() => setView(name)} data-testid={`button-robustness-${name.toLowerCase().replace(/\W+/g, "-")}`} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === name ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{name}</button>)}</div>
      {view === "Nominal vs Robust" && <div className="space-y-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground"><span>Forecast <strong className="text-foreground">{label(forecast.estimator ?? forecast.type ?? object(object(request).forecastModel).type)}</strong></span><span>Cutoff <strong className="text-foreground">{label(object(request).informationCutoff ?? object(output.model).informationCutoff)}</strong></span><span>Solver <strong className="text-foreground">{label(object(current.solver).status ?? current.status)}</strong></span></div>
        {hasResults ? <>
          <div className="grid gap-3 md:grid-cols-2">
            <Candidate title="Nominal candidate" candidate={nominalDisplay} fallback={method === "NOMINAL" ? current : undefined} forecast={forecast} />
            <Candidate title="Robust candidate" candidate={robustDisplay} fallback={method === "ROBUST_MEAN_UNCERTAINTY" ? current : undefined} forecast={forecast} />
          </div>
          <div className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:grid-cols-3">
            <Measure title="Asset-space half-L1" value={fmt(first(comparison, "assetWeightHalfL1") ?? first(robust, "assetHalfL1Distance", "assetSpaceHalfL1", "assetDistance") ?? distance(nominalAssets, robustAssets))} caption="½ Σ |underlying target difference|; not turnover" />
            <Measure title="Candidate-space half-L1" value={fmt(first(comparison, "candidateWeightHalfL1") ?? first(robust, "candidateHalfL1Distance", "candidateDistance") ?? distance(nominalCandidateWeights, robustCandidateWeights))} caption="Diagnostic only; not asset turnover" />
            <Measure title="Robust haircut" value={bp(first(robust, "robustHaircut", "haircut"))} caption="κ × √(wᵀVμw), daily decimal" />
          </div>
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Inspect frozen Vμ and forecast uncertainty</summary><pre className="mt-2 max-h-56 overflow-auto rounded border bg-background p-3 font-mono text-[11px]">{JSON.stringify({ V_mu: forecast.V_mu ?? robust.V_mu, standardErrors: forecast.standardErrors, portfolio: forecast.portfolio }, null, 2)}</pre></details>
        </> : <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">{compact ? "No frozen robustness diagnostics in this saved record." : "Optimize to freeze a nominal or robust candidate and its diagnostics."}</p>}
        {Object.keys(replayRecord).length > 0 && <p className="text-xs" data-testid="status-robustness-replay">Frozen replay: {label(replayRecord.status)} · maximum numeric difference {fmt(replayRecord.maximumNumericDifference, 10)}</p>}
      </div>}
      {view === "Sensitivity" && <div className="space-y-3 text-xs"><p className="text-muted-foreground">One input changed at a time against the same frozen estimation state. These backend diagnostics are not a grid search and do not select a parameter.</p>
        {sensitivities.length ? <div className="overflow-x-auto rounded border"><table className="w-full min-w-[550px] text-left"><thead className="bg-muted/70 text-muted-foreground"><tr>{["Perturbation", "Setting", "Status", "Asset-space half-L1", "Expected return", "Risk / SE"].map(x => <th key={x} className="p-2 font-medium">{x}</th>)}</tr></thead><tbody>{sensitivities.map((item, index) => { const metrics = object(item.metrics), changes = object(item.requestChanges); return <tr key={index} className="border-t" data-testid={`row-robustness-sensitivity-${index}`}><td className="p-2">{label(first(item, "parameter", "name", "label", "dimension"))}</td><td className="p-2 font-mono">{Object.keys(changes).length ? Object.entries(changes).map(([key, value]) => `${key}: ${label(value)}`).join(" · ") : label(first(item, "value", "setting", "kappa", "delta"))}</td><td className="p-2">{label(item.status ?? object(item.result).status)}{item.reason ? <p className="text-muted-foreground">{label(item.reason)}</p> : null}</td><td className="p-2 font-mono">{fmt(first(item, "assetHalfL1Distance", "assetSpaceHalfL1", "assetDistance") ?? distance(metrics.assetWeights, current.assetWeights))}</td><td className="p-2 font-mono">{bp(first(item, "expectedReturn", "estimatedGrossReturn") ?? metrics.estimatedGrossReturn)}</td><td className="p-2 font-mono">{fmt(first(item, "risk", "estimatedVolatility") ?? metrics.estimatedVolatility)} / {bp(metrics.forecastStandardError)}</td></tr>; })}</tbody></table></div> : <p className="rounded border border-dashed p-3 text-muted-foreground">No one-at-a-time sensitivity cases returned for this frozen allocation.</p>}
      </div>}
      {view === "Stability" && <div className="space-y-3 text-xs"><p className="text-muted-foreground">Covariance perturbations are diagnostic only: the same frozen weights are evaluated under changed covariance. They never change the submitted solution or pick a winner.</p>{covarianceCases.length ? <div className="overflow-x-auto rounded border"><table className="w-full min-w-[480px] text-left"><thead className="bg-muted/70"><tr>{["Perturbation", "Status", "Asset-space half-L1", "Risk"].map(x => <th key={x} className="p-2 font-medium">{x}</th>)}</tr></thead><tbody>{covarianceCases.map((item, index) => <tr key={index} className="border-t" data-testid={`row-robustness-stability-${index}`}><td className="p-2">{label(first(item, "name", "label", "parameter", "perturbation"))}</td><td className="p-2">{label(item.status)}</td><td className="p-2 font-mono">{fmt(first(item, "assetHalfL1Distance", "assetSpaceHalfL1", "assetDistance") ?? 0)}</td><td className="p-2 font-mono">{fmt(first(item, "risk", "estimatedVolatility"))}</td></tr>)}</tbody></table></div> : <p className="rounded border border-dashed p-3 text-muted-foreground">No covariance perturbation cases returned for this frozen allocation.</p>}</div>}
      {view === "Methodology" && <div className="grid gap-3 text-xs leading-relaxed sm:grid-cols-2">
        <div className="rounded border bg-background p-3"><strong>Forecast uncertainty</strong><p className="mt-1 text-muted-foreground">Vμ describes uncertainty in estimated expected returns, separate from the return-risk covariance Σ. A robust mean-variance objective subtracts κ√(wᵀVμw) from the forecast return. κ ≥ 0; κ = 0 reduces to nominal.</p></div>
        <div className="rounded border bg-background p-3"><strong>What the distance means</strong><p className="mt-1 text-muted-foreground">½Σ|target asset weights A − target asset weights B| compares two simultaneous target portfolios. It is not realized turnover, a cost estimate, or a backtest. Signed exposures are aggregated to the underlying asset book first.</p></div>
        <div className="rounded border bg-background p-3"><strong>Scope</strong><p className="mt-1 text-muted-foreground">Minimum variance has no robust forecast-uncertainty formula here. Covariance changes and one-at-a-time sensitivity are diagnostics only; neither automatically selects a winner.</p></div>
        <div className="rounded border bg-background p-3"><strong>Frozen identity</strong><p className="mt-1 text-muted-foreground">Method {methodLabel} · κ {kappa === null || kappa === undefined ? "Not recorded" : fmt(kappa, 4)} · forecast {label(forecast.estimator ?? object(object(request).forecastModel).type)} · cutoff {label(object(request).informationCutoff)}. Replay checks the saved inputs and outputs independently.</p></div>
      </div>}
    </CardContent>
  </Card>;
}