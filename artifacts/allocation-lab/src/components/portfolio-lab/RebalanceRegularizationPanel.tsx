import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AllocationRebalanceRegularizationConfig } from "@workspace/api-client-react";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const fmt = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 9 }) : "Not returned";
const json = (value: unknown) => value === undefined || value === null ? "Not returned" : JSON.stringify(value, null, 2);

export type RebalanceForm = { lambdaR: string; asOf: string; quantities: string; cash: string; nav: string };
export const initialRebalanceForm: RebalanceForm = { lambdaR: "0", asOf: "", quantities: "", cash: "", nav: "" };

export function parseRebalance(form: RebalanceForm, cutoff: string, signed: boolean): AllocationRebalanceRegularizationConfig | undefined {
  if (!form.lambdaR.trim()) throw new Error("Rebalance λR must be a finite nonnegative daily-objective coefficient.");
  const lambdaR = Number(form.lambdaR);
  if (!Number.isFinite(lambdaR) || lambdaR < 0) throw new Error("Rebalance λR must be finite and nonnegative.");
  if (lambdaR === 0) return undefined;
  if (!cutoff || form.asOf !== cutoff) throw new Error("Rebalance holdings as-of must exactly equal the information cutoff.");
  if (!form.cash.trim() || !form.nav.trim() || !form.quantities.trim()) throw new Error("Positive λR requires explicit quantities, cash and NAV.");
  const cash = Number(form.cash), nav = Number(form.nav);
  if (!Number.isFinite(cash) || (!signed && cash < 0) || !Number.isFinite(nav) || nav <= 0)
    throw new Error(`Rebalance NAV must be positive and cash finite${signed ? " (signed cash is allowed)" : " and nonnegative"}.`);
  let quantities: unknown;
  try { quantities = JSON.parse(form.quantities); } catch { throw new Error("Rebalance quantities must be valid ticker-to-quantity JSON."); }
  if (!quantities || typeof quantities !== "object" || Array.isArray(quantities) ||
    Object.entries(quantities).some(([ticker, quantity]) => !ticker.trim() || typeof quantity !== "number" || !Number.isFinite(quantity) || (!signed && quantity < 0)))
    throw new Error(`Rebalance quantities must map tickers to finite ${signed ? "signed" : "nonnegative"} numbers.`);
  return { lambdaR, holdings: { asOf: form.asOf, quantities: quantities as Record<string, number>, cash, nav } };
}

export function RebalanceRegularizationControls({ value, onChange, cutoff, objective, referenceDisabled = false }: {
  value: RebalanceForm; onChange: (next: RebalanceForm) => void; cutoff: string; objective: string; referenceDisabled?: boolean;
}) {
  const update = (key: keyof RebalanceForm, next: string) => onChange({ ...value, [key]: next });
  const active = Number(value.lambdaR) > 0;
  return <fieldset className="rounded-lg border border-primary/25 bg-primary/[0.035] p-4" data-testid="fieldset-b2-rebalance">
    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-primary">Rebalance regularization</legend>
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor="b2-rebalance-lambda" className="text-xs">λR · daily objective units</Label>
      <Input id="b2-rebalance-lambda" type="number" min="0" step="any" className="h-8 w-32 font-mono text-xs" value={value.lambdaR} onChange={e => update("lambdaR", e.target.value)} data-testid="input-b2-rebalance-lambda" />
      <Badge variant="outline" data-testid="status-b2-rebalance">{referenceDisabled ? "Ignored · configured λR retained" : active ? "On · actual book required" : "Off · no holdings sent"}</Badge>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">½ × λR × Σ(target risky underlying asset weight − current risky underlying asset weight)². This is a quadratic objective preference, not a fee, slippage estimate or realized turnover. Use explicit pre-decision holdings at the cutoff; no prior target is substituted.</p>
    {active && !referenceDisabled && objective !== "regularized_mean_variance" && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="status-b2-rebalance-unsupported">Unsupported combination: positive λR requires regularized mean-variance. Change the objective before optimizing.</p>}
    {active && referenceDisabled && <p className="mt-2 rounded border bg-muted/30 p-2 text-xs text-muted-foreground">Starting portfolio is set to Ignore for the next run. Configured λR remains unchanged; reference-book fields are disabled.</p>}
    {active && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1"><Label htmlFor="b2-rebalance-asof">Holdings as of · equals cutoff</Label><Input id="b2-rebalance-asof" type="date" value={value.asOf} disabled={referenceDisabled} onChange={e => update("asOf", e.target.value)} data-testid="input-b2-rebalance-asof" /><p className="text-[11px] text-muted-foreground">Cutoff: {cutoff || "Not selected"}</p></div>
      <div className="space-y-1"><Label htmlFor="b2-rebalance-nav">Actual NAV</Label><Input id="b2-rebalance-nav" type="number" min="0.000001" step="any" value={value.nav} disabled={referenceDisabled} onChange={e => update("nav", e.target.value)} data-testid="input-b2-rebalance-nav" /></div>
      <div className="space-y-1"><Label htmlFor="b2-rebalance-cash">Actual cash</Label><Input id="b2-rebalance-cash" type="number" step="any" value={value.cash} disabled={referenceDisabled} onChange={e => update("cash", e.target.value)} data-testid="input-b2-rebalance-cash" /></div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label htmlFor="b2-rebalance-quantities">Actual quantities · ticker → quantity JSON</Label><Input id="b2-rebalance-quantities" className="font-mono" value={value.quantities} disabled={referenceDisabled} onChange={e => update("quantities", e.target.value)} placeholder='{"SPY":12.5,"TLT":4}' data-testid="input-b2-rebalance-quantities" /></div>
    </div>}
  </fieldset>;
}

export function RebalanceAllocationResult({ request, result }: { request: unknown; result: unknown }) {
  const config = object(object(request).rebalanceRegularization);
  if (!(typeof config.lambdaR === "number" && config.lambdaR > 0)) return null;
  const output = object(result), detail = object(output.rebalanceRegularization);
  const reference = object(detail.referenceAssetWeights), target = object(detail.targetAssetWeights);
  const assets = Array.isArray(detail.assets) ? detail.assets.filter((x): x is string => typeof x === "string") : [...new Set([...Object.keys(reference), ...Object.keys(target)])];
  const squared = assets.length && assets.every(t => typeof reference[t] === "number" && typeof target[t] === "number")
    ? assets.reduce((sum, t) => sum + ((target[t] as number) - (reference[t] as number)) ** 2, 0) : null;
  return <Card className="border-primary/25 bg-primary/[0.025]" data-testid="card-b2-rebalance-result">
    <CardHeader className="pb-3"><CardTitle className="text-sm">Rebalance regularization · frozen reference</CardTitle><CardDescription>Current and target net underlying exposures at the cutoff. Quadratic objective penalty is not an execution charge.</CardDescription></CardHeader>
    <CardContent className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-4 rounded border bg-background p-3 font-mono"><span>λR {fmt(config.lambdaR)}</span><span>Σ risky underlying displacement² {fmt(squared)}</span><span>½ × λR × Σ objective penalty / day {fmt(detail.penalty ?? object(output.objectiveContributions).rebalanceRegularization)}</span></div>
      <div className="overflow-auto rounded border bg-background"><table className="w-full min-w-[420px] text-left"><thead className="bg-muted"><tr><th className="p-2">Underlying asset</th><th className="p-2">Current net weight</th><th className="p-2">Target net weight</th><th className="p-2">Squared displacement</th></tr></thead><tbody>{assets.map(t => <tr key={t} className="border-t font-mono"><td className="p-2">{t}</td><td className="p-2">{fmt(reference[t])}</td><td className="p-2">{fmt(target[t])}</td><td className="p-2">{typeof reference[t] === "number" && typeof target[t] === "number" ? fmt(((target[t] as number) - (reference[t] as number)) ** 2) : "Not returned"}</td></tr>)}</tbody></table></div>
      {!assets.length && <p className="text-muted-foreground">No asset-level reference returned for this saved result.</p>}
      <details><summary className="cursor-pointer">Frozen holdings and solver evidence</summary><pre className="mt-2 overflow-auto rounded border bg-background p-3">{json({ holdings: config.holdings, solverEvidence: detail.solverEvidence })}</pre></details>
    </CardContent>
  </Card>;
}

export function RebalanceValidationResult({ policyRequest, run }: { policyRequest: unknown; run: unknown }) {
  const config = object(object(policyRequest).rebalanceRegularization), saved = object(run), result = object(saved.result ?? saved.results);
  if (!(typeof config.lambdaR === "number" && config.lambdaR > 0)) return null;
  const decisions = array(result.decisions ?? result.decisionRecords), comparison = object(result.rebalanceComparison), zero = object(comparison.zero);
  const zeroLedger = array(zero.dailyLedger), actualLedger = array(result.dailyLedger ?? result.ledger);
  const zeroByDate = new Map(zeroLedger.map(day => [String(day.date), day]));
  const assumptions = object(saved.assumptions), zeroAssumptions = object(zero.assumptions);
  const parity = zeroLedger.length > 0 && assumptions.transactionCostBps === zeroAssumptions.transactionCostBps && assumptions.slippageBps === zeroAssumptions.slippageBps;
  return <Card className="border-primary/25 bg-primary/[0.025]" data-testid="card-b3-rebalance-result"><CardHeader className="pb-3"><CardTitle className="text-sm">Rebalance regularization · historical audit</CardTitle><CardDescription>Each decision uses its own carried pre-trade book, not the B2 snapshot. A1 charges actual fills; the squared-displacement penalty is never charged.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs">
    <p className="rounded border bg-background p-3">Frozen λR {fmt(config.lambdaR)} · B3 initial book {json({ quantities: assumptions.initialHoldings, cash: assumptions.initialCash, nav: assumptions.initialNav })}</p>
    {decisions.length ? <div className="max-h-96 overflow-auto rounded border bg-background" data-testid="table-b3-rebalance-decisions"><table className="w-full min-w-[900px] text-left"><thead className="sticky top-0 bg-muted"><tr>{["Decision / cutoff", "Actual pre-trade reference", "Candidate / underlying targets", "Quadratic objective", "A1 actual charges"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{decisions.map((decision, i) => { const context = object(decision.rebalanceRegularization), optimizer = object(decision.optimizer), detail = object(optimizer.rebalanceRegularization), d5 = object(decision.d5); const references = object(context.referenceExposures), targets = object(decision.targetAssetWeights); const tickers = new Set([...Object.keys(references), ...Object.keys(targets)]); const squared = tickers.size && [...tickers].every(t => typeof references[t] === "number" && typeof targets[t] === "number") ? [...tickers].reduce((sum, t) => sum + ((targets[t] as number) - (references[t] as number)) ** 2, 0) : null; const day = actualLedger.find(row => row.date === decision.executionDate); return <tr key={i} className="border-t align-top" data-testid={`row-b3-rebalance-decision-${i}`}><td className="p-2">{json(decision.decisionDate)}<br />cutoff {json(decision.informationCutoff)}<br />fill {json(decision.executionDate)}</td><td className="whitespace-pre-wrap p-2 font-mono">{json(context.actualHoldings)}<br />Net reference: {json(context.referenceExposures)}</td><td className="whitespace-pre-wrap p-2 font-mono">Candidates: {json(decision.candidateWeights)}<br />Assets: {json(targets)}</td><td className="whitespace-pre-wrap p-2 font-mono">Σ risky underlying displacement² {fmt(squared)}<br />½ × λR × Σ objective penalty {fmt(detail.penalty ?? object(optimizer.objectiveContributions).rebalanceRegularization ?? context.penalty)}</td><td className="whitespace-pre-wrap p-2 font-mono">Fees {fmt(day?.transactionCosts ?? d5.actualTransactionCosts)}<br />Slippage {fmt(day?.slippage ?? d5.actualSlippage)}</td></tr>; })}</tbody></table></div> : <p className="rounded border border-dashed p-3 text-muted-foreground">No dated decisions returned for this saved run.</p>}
    <div className="rounded border bg-background p-3"><strong>Paired λR = 0 comparison · no winner selected</strong><p className="mt-1 text-muted-foreground">{json(comparison.convention)}</p><p className="mt-1" data-testid="status-b3-rebalance-comparison">{!zeroLedger.length ? "Saved zero-regularization comparison unavailable. No unmatched comparison inferred." : parity ? "Identical fee and slippage rates in both saved paths; each path pays its own actual A1 fill charges." : "Execution charge assumptions could not be confirmed identical; ledger comparison withheld."}</p></div>
    {parity && <div className="max-h-72 overflow-auto rounded border bg-background"><table className="w-full min-w-[660px] text-left"><thead className="sticky top-0 bg-muted"><tr>{["Date", "λR net NAV", "λR A1 fees / slippage", "Zero net NAV", "Zero A1 fees / slippage"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{actualLedger.map((day, i) => { const other = zeroByDate.get(String(day.date)); return <tr key={i} className="border-t font-mono"><td className="p-2">{json(day.date)}</td><td className="p-2">{fmt(day.endingNav ?? day.nav)}</td><td className="p-2">{fmt(day.transactionCosts)} / {fmt(day.slippage)}</td><td className="p-2">{fmt(other?.endingNav ?? other?.nav)}</td><td className="p-2">{fmt(other?.transactionCosts)} / {fmt(other?.slippage)}</td></tr>; })}</tbody></table></div>}
    <p className="text-muted-foreground">Saved run #{json(saved.validationRunId)} · reproducibility {json(saved.reproducibilityStatus)}. Reload retrieves this frozen comparison; replay checks the run independently.</p>
  </CardContent></Card>;
}