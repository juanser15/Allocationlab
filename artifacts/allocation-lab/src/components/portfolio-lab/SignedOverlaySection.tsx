import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Bounds = { min?: number; max?: number };
export type SignedSettings = {
  alphaBounds: Record<string, Bounds>;
  grossAlphaMax: string;
  grossAssetMax: string;
  assetBounds: Record<string, Bounds>;
  assetBoundsText: string;
  netAssetExposure: Bounds;
  cash: Bounds;
  groupGrossCaps: { group: string; candidateIds: string[]; max: number }[];
};
export const initialSignedSettings: SignedSettings = {
  alphaBounds: {}, grossAlphaMax: "1.5", grossAssetMax: "1.5",
  assetBounds: {}, assetBoundsText: "{}", netAssetExposure: {}, cash: {}, groupGrossCaps: [],
};

const numberText = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  ? value.toLocaleString(undefined, { maximumFractionDigits: 6, signDisplay: "always" }) : "—";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field = (source: Record<string, unknown>, ...names: string[]) =>
  names.map(name => source[name]).find(value => typeof value === "number" && Number.isFinite(value));

export function SignedOverlayControls({ candidates, names, settings, onChange, objective, gamma, eta, target, onTargetChange }: {
  candidates: string[]; names: Record<string, string>; settings: SignedSettings;
  onChange: (value: SignedSettings) => void;
  objective: string; gamma: number; eta: number; target: string; onTargetChange: (value: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [group, setGroup] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [groupMax, setGroupMax] = useState("");
  const set = (part: Partial<SignedSettings>) => onChange({ ...settings, ...part });
  const boundInput = (label: string, bounds: Bounds, update: (next: Bounds) => void, prefix: string) =>
    <fieldset className="space-y-1"><legend className="text-xs font-medium">{label}</legend>
      <div className="flex gap-2">{(["min", "max"] as const).map(key =>
        <Input key={key} aria-label={`${label} ${key}`} data-testid={`input-signed-${prefix}-${key}`} type="number" step="any" placeholder={key === "min" ? "Min" : "Max"} value={bounds[key] ?? ""}
          onChange={event => update({ ...bounds, [key]: event.target.value === "" ? undefined : Number(event.target.value) })} />)}</div>
    </fieldset>;
  return <div className="space-y-3 rounded-md border border-primary/20 bg-muted/20 p-3" data-testid="panel-signed-controls">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Signed overlay specification</h3><span className="text-xs text-muted-foreground">Coefficients and exposure limits are NAV fractions. Negative means short.</span></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1"><Label htmlFor="signed-objective-readout">Objective</Label><div id="signed-objective-readout" className="rounded border bg-background px-2 py-2 text-xs">{objective === "minimum_variance" ? "Minimum variance" : "Regularized mean-variance"} · γ {gamma} · η {eta}</div></div>
      {objective === "minimum_variance" && <div className="space-y-1"><Label htmlFor="signed-target">Target excess return (daily decimal, required)</Label><Input id="signed-target" data-testid="input-signed-target-excess" type="number" step="any" min="0" placeholder="e.g. 0.0003" value={target} onChange={event => onTargetChange(event.target.value)} /></div>}
      <div className="space-y-1"><Label htmlFor="signed-alpha-gross">Alpha gross cap</Label><Input id="signed-alpha-gross" data-testid="input-signed-gross-alpha" type="number" min="0" step="any" value={settings.grossAlphaMax} onChange={event => set({ grossAlphaMax: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="signed-asset-gross">Underlying asset gross cap</Label><Input id="signed-asset-gross" data-testid="input-signed-gross-asset" type="number" min="0" step="any" value={settings.grossAssetMax} onChange={event => set({ grossAssetMax: event.target.value })} /></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {boundInput("Net asset exposure", settings.netAssetExposure, value => set({ netAssetExposure: value }), "net")}
      {boundInput("Cash", settings.cash, value => set({ cash: value }), "cash")}
    </div>
    <div className="overflow-x-auto rounded border bg-background"><table className="w-full min-w-[430px] text-xs"><caption className="px-3 py-2 text-left font-semibold">Signed per-alpha bounds</caption><thead className="border-y bg-muted/50 text-muted-foreground"><tr><th scope="col" className="px-3 py-1 text-left">Alpha</th><th scope="col" className="px-3 py-1 text-left">Minimum</th><th scope="col" className="px-3 py-1 text-left">Maximum</th></tr></thead>
      <tbody>{candidates.map(id => <tr key={id} className="border-t"><th scope="row" className="px-3 py-1 text-left font-medium">{names[id] ?? id}<span className="ml-1 text-muted-foreground">({id})</span></th>{(["min", "max"] as const).map(key =>
        <td key={key} className="px-3 py-1"><Input className="h-8" aria-label={`${names[id] ?? id} ${key} coefficient`} data-testid={`input-signed-alpha-${key}-${id}`} type="number" step="any" placeholder={key === "min" ? "Unbounded" : "Unbounded"} value={settings.alphaBounds[id]?.[key] ?? ""} onChange={event => set({ alphaBounds: { ...settings.alphaBounds, [id]: { ...settings.alphaBounds[id], [key]: event.target.value === "" ? undefined : Number(event.target.value) } } })} /></td>)}</tr>)}</tbody></table></div>
    <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} className="rounded border bg-background p-3 text-xs"><summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-ring">Advanced limits · asset bounds & group gross caps</summary>
      <div className="mt-3 space-y-3"><div><Label htmlFor="signed-asset-bounds">Underlying asset bounds (ticker to min/max JSON)</Label><Input id="signed-asset-bounds" data-testid="input-signed-asset-bounds" value={settings.assetBoundsText} onChange={event => set({ assetBoundsText: event.target.value })} /><p className="text-muted-foreground">Example: {'{"AAPL":{"min":-0.4,"max":0.6}}'}</p></div>
        <fieldset className="space-y-2"><legend className="font-semibold">Optional group gross cap</legend><div className="flex flex-wrap gap-2"><Input className="w-40" aria-label="Group name" data-testid="input-signed-group-name" placeholder="Group name" value={group} onChange={event => setGroup(event.target.value)} /><Input className="w-28" aria-label="Group gross maximum" data-testid="input-signed-group-max" type="number" min="0" step="any" placeholder="Maximum" value={groupMax} onChange={event => setGroupMax(event.target.value)} /></div>
          <div className="flex flex-wrap gap-2">{candidates.map(id => <label key={id} className="flex items-center gap-1 rounded border px-2 py-1"><input data-testid={`input-signed-group-member-${id}`} type="checkbox" checked={members.includes(id)} onChange={() => setMembers(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} />{names[id] ?? id}</label>)}</div>
          <button type="button" className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-50" data-testid="button-signed-add-group" disabled={!group.trim() || !members.length || groupMax === "" || !Number.isFinite(Number(groupMax)) || Number(groupMax) < 0} onClick={() => { set({ groupGrossCaps: [...settings.groupGrossCaps, { group: group.trim(), candidateIds: members, max: Number(groupMax) }] }); setGroup(""); setGroupMax(""); setMembers([]); }}>Add group cap</button>
          {settings.groupGrossCaps.map((cap, index) => <div key={`${cap.group}-${index}`} className="flex items-center justify-between rounded border px-2 py-1"><span>{cap.group}: Σ |a| ≤ {cap.max} · {cap.candidateIds.join(", ")}</span><button type="button" className="underline" data-testid={`button-signed-remove-group-${index}`} onClick={() => set({ groupGrossCaps: settings.groupGrossCaps.filter((_, i) => i !== index) })}>Remove</button></div>)}
        </fieldset></div>
    </details>
    <p className="text-xs leading-relaxed text-muted-foreground">Short borrow, financing costs, locate availability, margin, liquidity and execution frictions are not optimized here. Gross limits cap exposure; they do not require leverage. Validate any frozen policy separately in B3.</p>
  </div>;
}

export function SignedOverlayResult({ allocation, request, names }: {
  allocation: Record<string, unknown>; request: Record<string, unknown>; names: Record<string, string>;
}) {
  const metrics = object(allocation.signedOverlay ?? allocation.exposureSummary);
  const coefficients = object(allocation.candidateWeights ?? allocation.alphaCoefficients);
  const assets = object(allocation.assetWeights ?? allocation.underlyingAssetWeights);
  const expected = object(allocation.expectedExcessContributions ?? allocation.alphaExpectedExcessContributions);
  const model = object(allocation.model);
  const mu = object(model.muExcess ?? model.mu);
  const summaries = [
    ["Alpha gross", field(metrics, "alphaGrossExposure", "grossAlphaExposure")],
    ["Asset gross", field(metrics, "grossAssetExposure", "assetGrossExposure")],
    ["Long", field(metrics, "longAssetExposure", "longExposure")],
    ["Short", field(metrics, "shortAssetExposure", "shortExposure")],
    ["Net", field(metrics, "netAssetExposure", "netExposure")],
    ["Cash", field(metrics, "cashTarget", "cash") ?? allocation.totalCash],
  ];
  const ids = Array.isArray(request.candidateIds) ? request.candidateIds.filter((id): id is string => typeof id === "string") : Object.keys(coefficients);
  const modelIds = Array.isArray(model.candidateIds) ? model.candidateIds : ids;
  const validWeights = modelIds.length > 0 && modelIds.every(id => typeof id === "string" && typeof coefficients[id] === "number" && Number.isFinite(coefficients[id]));
  const weights = modelIds.map(id => typeof id === "string" && typeof coefficients[id] === "number" ? coefficients[id] as number : 0);
  const covariance = Array.isArray(model.sigma) ? model.sigma : [];
  const validCovariance = validWeights && covariance.length === weights.length && covariance.every(row => Array.isArray(row) && row.length === weights.length && row.every(value => typeof value === "number" && Number.isFinite(value)));
  const marginal = validCovariance ? covariance.map(row => (row as number[]).reduce((sum, value, index) => sum + value * weights[index], 0)) : [];
  const variance = validCovariance ? marginal.reduce((sum, value, index) => sum + value * weights[index], 0) : NaN;
  const volatility = variance > 0 ? Math.sqrt(variance) : null;
  const alphaCrc = volatility !== null ? weights.map((weight, index) => weight * marginal[index] / volatility) : null;
  const assetTickers = Array.isArray(model.assetTickers) ? model.assetTickers : [];
  const exposureMatrix = Array.isArray(model.H) ? model.H : [];
  const validExposureMatrix = assetTickers.length > 0 && exposureMatrix.length === assetTickers.length &&
    assetTickers.every((ticker, index) => typeof ticker === "string" && Object.hasOwn(assets, ticker) &&
      Array.isArray(exposureMatrix[index]) && (exposureMatrix[index] as unknown[]).length === weights.length &&
      (exposureMatrix[index] as unknown[]).every(value => typeof value === "number" && Number.isFinite(value)));
  const attributedRisk: Record<string, number> = {};
  const unidentifiableAlphas: string[] = [];
  if (alphaCrc && validExposureMatrix) {
    assetTickers.forEach(ticker => { attributedRisk[String(ticker)] = 0; });
    alphaCrc.forEach((crc, j) => {
      const riskyExposure = exposureMatrix.reduce((sum, row) => sum + (row as number[])[j], 0);
      if (Math.abs(riskyExposure) <= 1e-12) {
        if (Math.abs(crc) > 1e-12) unidentifiableAlphas.push(String(modelIds[j]));
        return;
      }
      assetTickers.forEach((ticker, i) => {
        attributedRisk[String(ticker)] += crc * (exposureMatrix[i] as number[])[j] / riskyExposure;
      });
    });
  }
  const attributionAvailable = alphaCrc !== null && validExposureMatrix && unidentifiableAlphas.length === 0;
  const attributedTotal = attributionAvailable ? Object.values(attributedRisk).reduce((sum, value) => sum + value, 0) : null;
  const reconciliationDifference = attributedTotal !== null && volatility !== null ? attributedTotal - volatility : null;
  const reconciles = reconciliationDifference !== null && Math.abs(reconciliationDifference) <= 1e-9 * Math.max(1, volatility ?? 0);
  const muFor = (id: string) => {
    const index = modelIds.indexOf(id);
    if (Array.isArray(model.mu) && typeof model.mu[index] === "number") return model.mu[index] as number;
    return mu[id];
  };
  const riskFor = (id: string) => {
    const index = modelIds.indexOf(id);
    return alphaCrc && index >= 0 ? alphaCrc[index] : undefined;
  };
  return <div className="space-y-4" data-testid="panel-signed-result">
    <div><h4 className="text-xs font-semibold uppercase tracking-wide">Exposure summary</h4><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{summaries.map(([label, value]) => <div key={String(label)} className="rounded border bg-muted/20 px-3 py-2"><p className="text-[11px] text-muted-foreground">{String(label)}</p><p className="font-mono text-sm tabular-nums">{numberText(value)}</p></div>)}</div>
      <p className="mt-2 text-xs text-muted-foreground">Estimated excess return: <span className="font-mono text-foreground">{numberText(field(metrics, "expectedExcessReturn", "estimatedExcessReturn"))}</span> daily decimal · Target: {numberText(request.targetExcessReturn)}.</p></div>
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 overflow-x-auto rounded border"><table className="w-full min-w-[540px] text-left text-xs"><caption className="px-3 py-2 text-left font-semibold">Alpha overlays · risk in daily volatility units</caption><thead className="border-y bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2">Alpha</th><th className="px-3 py-2">Coefficient</th><th className="px-3 py-2">Long / short</th><th className="px-3 py-2">Expected excess contribution</th><th className="px-3 py-2">Risk contribution</th></tr></thead><tbody>{ids.map(id => { const weight = coefficients[id]; const mean = muFor(id); const contribution = expected[id] ?? (typeof weight === "number" && typeof mean === "number" ? weight * mean : undefined); return <tr key={id} className="border-t" data-testid={`row-signed-alpha-${id}`}><th scope="row" className="px-3 py-2 font-medium">{names[id] ?? id}</th><td className="px-3 py-2 font-mono">{numberText(weight)}</td><td className="px-3 py-2">{typeof weight === "number" ? weight < 0 ? "Short" : weight > 0 ? "Long" : "Flat" : "—"}</td><td className="px-3 py-2 font-mono">{numberText(contribution)}</td><td className="px-3 py-2 font-mono">{numberText(riskFor(id))}</td></tr>; })}</tbody></table></div>
      <div className="min-w-0 overflow-x-auto rounded border"><table className="w-full min-w-[540px] text-left text-xs"><caption className="px-3 py-2 text-left font-semibold">Underlying portfolio · attributed alpha risk</caption><thead className="border-y bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Long / short</th><th className="px-3 py-2">Target weight</th><th className="px-3 py-2">Actual after execution (B3)</th><th className="px-3 py-2">Attributed alpha CRC</th></tr></thead><tbody>{Object.entries(assets).map(([id, value]) => <tr key={id} className="border-t" data-testid={`row-signed-asset-${id}`}><th scope="row" className="px-3 py-2 font-medium">{id}</th><td className="px-3 py-2">{typeof value === "number" ? value < 0 ? "Short" : value > 0 ? "Long" : "Flat" : "—"}</td><td className="px-3 py-2 font-mono">{numberText(value)}</td><td className="px-3 py-2 text-muted-foreground">See dated B3 execution</td><td className="px-3 py-2 font-mono">{attributionAvailable && reconciles ? numberText(attributedRisk[id]) : "Not identifiable"}</td></tr>)}</tbody></table>{!Object.keys(assets).length && <p className="p-3 text-xs text-muted-foreground">Underlying targets not returned for this result.</p>}</div>
    </div>
    <div className="rounded border bg-muted/20 p-3 text-xs" data-testid="status-signed-risk-attribution">
      <p className="font-medium">Underlying risk attribution · {attributionAvailable && reconciles ? "reconciled" : "not identifiable"}</p>
      <p className="mt-1 text-muted-foreground">Frozen alpha CRCⱼ = aⱼ(Σa)ⱼ / σₚ; asset-attributed CRCᵢ = Σⱼ CRCⱼ × Hᵢⱼ / ΣₖHₖⱼ. This allocates alpha risk by each alpha’s B1 risky exposure share. It is not an independently estimated asset covariance or asset marginal risk contribution.</p>
      {attributionAvailable && reconciles ? <p className="mt-1 font-mono tabular-nums">Σ asset-attributed CRC = {attributedTotal?.toFixed(10)} · portfolio daily volatility = {volatility?.toFixed(10)} · difference = {reconciliationDifference?.toExponential(2)}</p> :
        <p className="mt-1 text-amber-700 dark:text-amber-300">{unidentifiableAlphas.length ? `No risky H exposure but nonzero CRC for alpha ${unidentifiableAlphas.join(", ")}; asset attribution cannot be identified.` : !validExposureMatrix ? "Frozen asset tickers or H exposure matrix are absent or inconsistent with solved targets." : !alphaCrc ? "Frozen covariance, coefficients, or positive portfolio volatility are unavailable." : "Asset attribution did not reconcile to portfolio volatility; no asset risk values are displayed."}</p>}
    </div>
    <p className="text-xs text-muted-foreground">Actual execution weights are date-specific B3 records, not B2 targets; inspect B3 historical decisions for executed weights. Negative attributed CRC can reflect hedging. Short borrow and financing frictions are not included in this optimization.</p>
  </div>;
}