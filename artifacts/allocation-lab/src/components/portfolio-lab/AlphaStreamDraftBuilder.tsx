import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_ALPHA_PARAMETERS,
  previewAlphaDraft,
  type AlphaDefinition,
  type AlphaMapping,
  type AlphaParameters,
} from "./alpha-stream-draft";

export const SUPPORTED_ALPHA_CALCULATIONS = new Set([
  "momentum", "trend_quality", "volatility", "drawdown", "mean_reversion",
  "relative_strength", "diversification_benefit", "return_over_volatility",
  "ma_distance", "downside_beta", "drawdown_recovery",
]);

export type BuilderFactor = {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  calculationType: string;
};

export type AlphaBuilderInput = {
  assetTickers: string[];
  factorIds: string[];
  mapping: AlphaMapping;
  parameters: AlphaParameters;
};

export function factorIneligibility(factor: BuilderFactor | undefined, id: string): string | null {
  if (!factor) return `${id}: not found in the factor library`;
  if (!factor.enabled) return `${factor.name}: disabled`;
  if (factor.status !== "active") return `${factor.name}: status is ${factor.status}, not active`;
  if (!SUPPORTED_ALPHA_CALCULATIONS.has(factor.calculationType)) return `${factor.name}: calculation type ${factor.calculationType} is unsupported`;
  return null;
}

type Props = {
  assetTickers: string[];
  factorIds: string[];
  factors: BuilderFactor[];
  existing: AlphaDefinition[];
  onCreate: (input: AlphaBuilderInput) => void;
};

function parseNum(raw: string, min: number, max: number, label: string): { value?: number; error?: string } {
  if (raw.trim() === "") return { error: `${label} is required` };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: `${label} must be a finite number` };
  if (value < min || value > max) return { error: `${label} must be between ${min} and ${max}` };
  return { value };
}

export function AlphaStreamDraftBuilder({ assetTickers, factorIds, factors, existing, onCreate }: Props) {
  const [mapping, setMapping] = useState<AlphaMapping>("single_asset_long_cash");
  const [threshold, setThreshold] = useState(String(DEFAULT_ALPHA_PARAMETERS.threshold));
  const [gross, setGross] = useState(String(DEFAULT_ALPHA_PARAMETERS.grossFraction));
  const [units, setUnits] = useState(DEFAULT_ALPHA_PARAMETERS.signalUnits);
  const [freq, setFreq] = useState(DEFAULT_ALPHA_PARAMETERS.rebalanceFrequency);
  const [cost, setCost] = useState(String(DEFAULT_ALPHA_PARAMETERS.transactionCostBps));
  const [slip, setSlip] = useState(String(DEFAULT_ALPHA_PARAMETERS.slippageBps));
  const [timing, setTiming] = useState<AlphaParameters["executionTiming"]>(DEFAULT_ALPHA_PARAMETERS.executionTiming);
  const [yld, setYld] = useState(String(DEFAULT_ALPHA_PARAMETERS.cashYieldAnnual));

  const factorLabels = useMemo(() => new Map(factors.map(f => [f.id, f.name])), [factors]);
  const factorProblems = useMemo(() => {
    const byId = new Map(factors.map(f => [f.id, f]));
    return factorIds.map(id => factorIneligibility(byId.get(id), id)).filter((x): x is string => !!x);
  }, [factors, factorIds]);

  const parsed = [
    parseNum(threshold, -Infinity, Infinity, "Threshold"),
    parseNum(gross, 0, 1, "Gross fraction"),
    parseNum(cost, 0, 500, "Transaction cost"),
    parseNum(slip, 0, 500, "Slippage"),
    parseNum(yld, 0, 0.2, "Cash yield"),
  ];
  const paramErrors = parsed.map(p => p.error).filter((x): x is string => !!x);
  const parameters: AlphaParameters | null = paramErrors.length ? null : {
    ...DEFAULT_ALPHA_PARAMETERS,
    signalUnits: units,
    threshold: parsed[0].value!,
    grossFraction: parsed[1].value!,
    rebalanceFrequency: freq,
    executionTiming: timing,
    transactionCostBps: parsed[2].value!,
    slippageBps: parsed[3].value!,
    cashYieldAnnual: parsed[4].value!,
  };

  const blockers: string[] = [];
  if (!assetTickers.length) blockers.push("Select assets in the asset universe picker.");
  if (!factorIds.length) blockers.push("Select one or more factors in the factor picker.");
  if (mapping === "cross_sectional_long_only" && assetTickers.length < 2) blockers.push("Cross-sectional mapping needs at least 2 selected assets.");
  blockers.push(...factorProblems.map(p => `Ineligible factor — ${p}`));
  blockers.push(...paramErrors);

  const preview = useMemo(() => {
    if (blockers.length || !parameters) return null;
    return previewAlphaDraft({ assetTickers, factorIds, mapping, parameters }, existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetTickers, factorIds, mapping, existing, threshold, gross, units, freq, timing, cost, slip, yld, factorProblems.length]);

  const canCreate = !!preview && !preview.error && preview.additions.length > 0;
  const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-3 rounded border p-3" data-testid="alpha-stream-draft-builder">
      <div>
        <h4 className="text-sm font-semibold">Bulk alpha-stream builder</h4>
        <p className="text-xs text-muted-foreground">
          Uses the asset universe and factors selected on the left. Single-asset creates factors × selected assets; cross-sectional creates one stream per factor over the whole selection.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Position mapping</Label>
          <select className={selectCls} value={mapping} onChange={e => setMapping(e.target.value as AlphaMapping)} data-testid="select-alpha-builder-mapping">
            <option value="single_asset_long_cash">Single asset long / cash</option>
            <option value="cross_sectional_long_only">Cross-sectional long-only</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Threshold</Label>
          <Input type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} data-testid="input-alpha-builder-threshold" />
        </div>
        <div className="space-y-1">
          <Label>Gross fraction (0–1)</Label>
          <Input type="number" step="any" min="0" max="1" value={gross} onChange={e => setGross(e.target.value)} data-testid="input-alpha-builder-gross" />
        </div>
      </div>
      <details data-testid="details-alpha-builder-advanced" className="rounded border p-2">
        <summary className="cursor-pointer text-xs font-medium">Advanced parameters (units, schedule, timing, costs, yield)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="space-y-1"><Label>Signal units</Label>
            <select className={selectCls} value={units} onChange={e => setUnits(e.target.value as typeof units)} data-testid="select-alpha-builder-units">
              <option value="raw">raw</option><option value="oriented">oriented</option><option value="normalized">normalized</option>
            </select></div>
          <div className="space-y-1"><Label>Rebalance</Label>
            <select className={selectCls} value={freq} onChange={e => setFreq(e.target.value as typeof freq)} data-testid="select-alpha-builder-frequency">
              <option value="monthly">monthly</option><option value="quarterly">quarterly</option>
            </select></div>
          <div className="space-y-1"><Label>Execution timing</Label>
            <select className={selectCls} value={timing} onChange={e => setTiming(e.target.value as typeof timing)} data-testid="select-alpha-builder-timing">
              <option value="next_close">next_close</option>
              <option value="same_close">same_close</option>
            </select></div>
          <div className="space-y-1"><Label>Cost (bps)</Label><Input type="number" step="any" value={cost} onChange={e => setCost(e.target.value)} data-testid="input-alpha-builder-cost" /></div>
          <div className="space-y-1"><Label>Slippage (bps)</Label><Input type="number" step="any" value={slip} onChange={e => setSlip(e.target.value)} data-testid="input-alpha-builder-slippage" /></div>
          <div className="space-y-1"><Label>Cash yield (≤0.20)</Label><Input type="number" step="any" value={yld} onChange={e => setYld(e.target.value)} data-testid="input-alpha-builder-yield" /></div>
        </div>
      </details>

      <div className="space-y-2 rounded bg-muted/40 p-2 text-xs" data-testid="alpha-builder-preview" aria-live="polite">
        {blockers.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-amber-700" data-testid="alpha-builder-blockers">
            {blockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        )}
        {preview?.error && <p className="text-destructive" data-testid="alpha-builder-error">{preview.error}</p>}
        {preview && !preview.error && (
          <>
            <p data-testid="text-alpha-builder-counts">
              {preview.additions.length} new · {preview.duplicateCount} existing duplicate{preview.duplicateCount === 1 ? "" : "s"} skipped · {preview.totalCount} total after create
            </p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {preview.definitions.map(d => (
                <li key={`${d.name}-${d.factorId}-${d.assetTickers.join(",")}`} className="font-mono text-[11px]">
                  {factorLabels.get(d.factorId) ?? d.factorId} [{d.factorId}] · {d.assetTickers.join(", ")} · {d.mapping} · thr {d.threshold} · gross {d.grossFraction}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-muted-foreground">
          Definitions only: no history or returns are computed. Canonical IDs are assigned by B1 Prepare &amp; freeze together with the dataset and factor versions.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={!canCreate} data-testid="button-create-alpha-draft"
          onClick={() => parameters && onCreate({ assetTickers, factorIds, mapping, parameters })}>
          Create alpha-stream draft
        </Button>
        <span className="text-xs" data-testid="text-alpha-draft-count-hint">{existing.length} draft definition{existing.length === 1 ? "" : "s"} currently</span>
      </div>
    </div>
  );
}
