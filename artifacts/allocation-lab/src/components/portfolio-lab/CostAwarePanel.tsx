import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const show = (value: unknown) => value === undefined || value === null ? "Not returned" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "Not returned";
const assetEstimates = (summary: Row) => {
  const rates = object(summary.ratesBps);
  return array(summary.assets).map(asset => ({
    ticker: asset.ticker,
    currentWeight: asset.currentWeight,
    targetWeight: asset.targetWeight,
    tradeFraction: asset.tradeFraction,
    estimatedFeeFractionOfNav: typeof asset.absoluteTradeFraction === "number" && typeof rates.transactionCost === "number"
      ? asset.absoluteTradeFraction * rates.transactionCost / 10000 : null,
    estimatedSlippageFractionOfNav: typeof asset.absoluteTradeFraction === "number" && typeof rates.slippage === "number"
      ? asset.absoluteTradeFraction * rates.slippage / 10000 : null,
  }));
};

export type CostAwareRequest = {
  costAmortizationDays: number;
  turnoverPreferenceBps: number;
  transactionCostBps: number;
  slippageBps: number;
  holdings: { asOf: string; quantities: Record<string, number>; cash: number; nav: number };
};

export type CostAwareForm = {
  enabled: boolean;
  costAmortizationDays: string;
  turnoverPreferenceBps: string;
  transactionCostBps: string;
  slippageBps: string;
  asOf: string;
  quantities: string;
  cash: string;
  nav: string;
};

export const initialCostAwareForm: CostAwareForm = {
  enabled: false, costAmortizationDays: "", turnoverPreferenceBps: "0",
  transactionCostBps: "", slippageBps: "", asOf: "", quantities: "{}",
  cash: "", nav: "",
};

export function parseCostAware(form: CostAwareForm, cutoff: string, signed: boolean): CostAwareRequest | undefined {
  if (!form.enabled) return undefined;
  const required = ["costAmortizationDays", "transactionCostBps", "slippageBps", "cash", "nav"] as const;
  if (required.some(key => !form[key].trim()) || !form.asOf || !form.turnoverPreferenceBps.trim())
    throw new Error("Cost-aware mode requires explicit h, fee, slippage, preference, dated actual holdings, cash and NAV.");
  const h = Number(form.costAmortizationDays), fee = Number(form.transactionCostBps);
  const slippage = Number(form.slippageBps), preference = Number(form.turnoverPreferenceBps);
  const cash = Number(form.cash), nav = Number(form.nav);
  if (![h, fee, slippage, preference, cash, nav].every(Number.isFinite) || h <= 0 || fee < 0 || slippage < 0 || preference < 0 || nav <= 0 || (!signed && cash < 0))
    throw new Error("Cost-aware h and NAV must be positive; fee, slippage and preference must be nonnegative. Cash must be nonnegative for long-only portfolios.");
  if (!cutoff || form.asOf !== cutoff) throw new Error("Actual holdings as-of date must match the information cutoff exactly.");
  let quantities: unknown;
  try { quantities = JSON.parse(form.quantities); } catch { throw new Error("Actual holdings quantities must be valid ticker-to-quantity JSON."); }
  if (!quantities || typeof quantities !== "object" || Array.isArray(quantities) ||
    Object.entries(quantities).some(([ticker, value]) => !ticker.trim() || typeof value !== "number" || !Number.isFinite(value) || (!signed && value < 0)))
    throw new Error(`Actual holdings must be a ticker-to-${signed ? "signed " : "nonnegative "}finite quantity JSON object.`);
  return { costAmortizationDays: h, turnoverPreferenceBps: preference, transactionCostBps: fee, slippageBps: slippage,
    holdings: { asOf: form.asOf, quantities: quantities as Record<string, number>, cash, nav } };
}

export function CostAwareControls({ value, onChange, cutoff }: {
  value: CostAwareForm; onChange: (next: CostAwareForm) => void; cutoff: string;
}) {
  const update = (key: keyof CostAwareForm, next: string) => onChange({ ...value, [key]: next });
  return <fieldset className="rounded-lg border border-primary/25 bg-primary/[0.035] p-4" data-testid="fieldset-b2-cost-aware">
    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-primary">Underlying asset trade costs</legend>
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} data-testid="input-b2-cost-aware" />
      Cost-aware optimization
    </label>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Optional. Costs apply to trades in the netted underlying asset book, not candidate weight changes. Supply the actual pre-decision position snapshot; prior targets are never substituted. h converts one-time estimated trade costs to a daily objective term. Turnover preference is a separate optimization penalty, never an execution charge.</p>
    {value.enabled && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {([
        ["costAmortizationDays", "Cost amortization h (days)", "0.01"],
        ["transactionCostBps", "Transaction fee (bps)", "0"],
        ["slippageBps", "Estimated slippage (bps)", "0"],
        ["turnoverPreferenceBps", "Turnover preference (bps; not charged)", "0"],
        ["nav", "Actual NAV", "0.01"],
        ["cash", "Actual cash", undefined],
      ] as const).map(([key, label, min]) => <div key={key} className="space-y-1">
        <Label htmlFor={`b2-cost-${key}`}>{label}</Label>
        <Input id={`b2-cost-${key}`} type="number" step="any" min={min} value={value[key]} onChange={e => update(key, e.target.value)} data-testid={`input-b2-cost-${key}`} />
      </div>)}
      <div className="space-y-1"><Label htmlFor="b2-cost-asof">Actual holdings as of (must equal cutoff)</Label><Input id="b2-cost-asof" type="date" value={value.asOf} onChange={e => update("asOf", e.target.value)} data-testid="input-b2-cost-asof" /><p className="text-[11px] text-muted-foreground">Information cutoff: {cutoff || "Select above"}</p></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="b2-cost-quantities">Actual holdings quantities (ticker → quantity JSON)</Label><Input id="b2-cost-quantities" value={value.quantities} onChange={e => update("quantities", e.target.value)} placeholder='{"SPY":12.5,"TLT":4}' className="font-mono" data-testid="input-b2-cost-quantities" /></div>
    </div>}
  </fieldset>;
}

export function CostAwareAllocationResult({ request, result }: { request: unknown; result: unknown }) {
  const cost = object(object(request).costAware), output = object(result);
  if (!Object.keys(cost).length) return null;
  const detail = object(output.costAware ?? output.costAwareDiagnostics);
  const holdings = object(cost.holdings);
  const trades = array(detail.assets);
  const rates = object(detail.ratesBps);
  return <Card className="border-primary/25 bg-primary/[0.025]" data-testid="card-b2-cost-aware-result">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-sm">Cost-aware allocation · frozen snapshot</CardTitle><Badge variant="outline">Enabled</Badge></div>
      <CardDescription>Estimated implementation from actual holdings at the cutoff. This is not a historical fill or a performance claim.</CardDescription></CardHeader>
    <CardContent className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border bg-background p-3"><strong>Fees / slippage</strong><p className="mt-1 font-mono">{show(cost.transactionCostBps)} / {show(cost.slippageBps)} bps</p></div>
        <div className="rounded border bg-background p-3"><strong>Amortization h</strong><p className="mt-1 font-mono">{show(cost.costAmortizationDays)} days</p></div>
        <div className="rounded border bg-background p-3"><strong>Preference, not charged</strong><p className="mt-1 font-mono">{show(cost.turnoverPreferenceBps)} bps</p></div>
        <div className="rounded border bg-background p-3"><strong>Actual snapshot</strong><p className="mt-1 font-mono">{show(holdings.asOf)} · NAV {number(holdings.nav)} · cash {number(holdings.cash)}</p></div>
      </div>
      <div className="grid gap-3 md:grid-cols-2"><div className="rounded border bg-background p-3"><strong>Actual quantities</strong><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono">{show(holdings.quantities)}</pre></div>
        <div className="rounded border bg-background p-3"><strong>Candidate / underlying targets</strong><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono">{show({ candidateWeights: output.candidateWeights, assetWeights: output.assetWeights })}</pre></div></div>
      {trades.length ? <div className="overflow-auto rounded border bg-background" data-testid="table-b2-cost-assets"><table className="w-full min-w-[680px] text-left"><thead className="bg-muted"><tr>{["Asset", "Current / target weight", "Signed trade fraction", "Estimated fee / NAV", "Estimated slippage / NAV"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{trades.map((trade, i) => <tr key={i} className="border-t" data-testid={`row-b2-cost-asset-${i}`}><td className="p-2">{show(trade.ticker)}</td><td className="p-2 font-mono">{number(trade.currentWeight)} / {number(trade.targetWeight)}</td><td className="p-2 font-mono">{number(trade.tradeFraction)}</td><td className="p-2 font-mono">{typeof trade.absoluteTradeFraction === "number" && typeof rates.transactionCost === "number" ? number(trade.absoluteTradeFraction * rates.transactionCost / 10000) : "Not returned"}</td><td className="p-2 font-mono">{typeof trade.absoluteTradeFraction === "number" && typeof rates.slippage === "number" ? number(trade.absoluteTradeFraction * rates.slippage / 10000) : "Not returned"}</td></tr>)}</tbody></table></div> : <p className="rounded border border-dashed p-3 text-muted-foreground">Per-asset estimated trades were not returned in this saved allocation.</p>}
      <p className="font-mono">Estimated one-time fee / NAV {number(detail.oneTimeFeeFractionOfNav)} · slippage / NAV {number(detail.oneTimeSlippageFractionOfNav)} · traded fraction {number(detail.tradedFraction)}</p>
      <div className="rounded border bg-background p-3"><strong>Objective breakdown (daily equivalents; preference not charged)</strong><pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono">{show(output.objectiveContributions)}</pre></div>
    </CardContent>
  </Card>;
}

export function CostAwareValidationResult({ policyRequest, run }: { policyRequest: unknown; run: unknown }) {
  const saved = object(run), result = object(saved.result ?? saved.results);
  const cost = object(object(policyRequest).costAware ?? object(saved.policySnapshot).costAware);
  if (!Object.keys(cost).length) return null;
  const assumptions = object(saved.assumptions), holdings = object(cost.holdings);
  const decisions = array(result.decisions ?? result.decisionRecords);
  const paired = object(result.costBlindComparison);
  const blind = object(paired.costBlind);
  const blindLedger = array(blind.dailyLedger);
  const awareLedger = array(result.dailyLedger ?? result.ledger);
  const blindAssumptions = object(blind.assumptions);
  const comparableFees = blindAssumptions.transactionCostBps === undefined || blindAssumptions.slippageBps === undefined
    ? null
    : blindAssumptions.transactionCostBps === assumptions.transactionCostBps && blindAssumptions.slippageBps === assumptions.slippageBps;
  const byDate = new Map(blindLedger.map(row => [String(row.date), row]));
  return <Card className="border-primary/25 bg-primary/[0.025]" data-testid="card-b3-cost-aware-result"><CardHeader className="pb-3"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-sm">Cost-aware policy · execution audit</CardTitle><Badge variant="outline">Frozen</Badge></div>
    <CardDescription>Paired cost-blind and cost-aware paths must use identical execution fees. This comparison does not declare a winner.</CardDescription></CardHeader><CardContent className="space-y-4 text-xs">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border bg-background p-3"><strong>Frozen B2 mode and estimate</strong><p className="mt-2">h {show(cost.costAmortizationDays)} days · fees {show(cost.transactionCostBps)} bps · slippage {show(cost.slippageBps)} bps</p><p className="mt-1">Turnover preference {show(cost.turnoverPreferenceBps ?? 0)} bps — optimization only; never charged.</p><pre className="mt-2 overflow-auto whitespace-pre-wrap">Holdings as of {show(holdings.asOf)}: {show(holdings.quantities)}{"\n"}Cash {show(holdings.cash)} · NAV {show(holdings.nav)}</pre></div>
        <div className="rounded border bg-background p-3"><strong>Frozen B3 initial actual book & execution</strong><pre className="mt-2 overflow-auto whitespace-pre-wrap">{show({ asOf: assumptions.evaluationStartDate, quantities: assumptions.initialHoldings, cash: assumptions.initialCash, nav: assumptions.initialNav, transactionCostBps: assumptions.transactionCostBps, slippageBps: assumptions.slippageBps })}</pre><p className="mt-2 text-muted-foreground">The B2 snapshot is not silently reused as historical B3 holdings. Each decision must use its actual pre-trade book.</p></div>
      </div>
      {decisions.length ? <div className="max-h-96 overflow-auto rounded border bg-background" data-testid="table-b3-cost-decisions"><table className="w-full min-w-[960px] text-left"><thead className="sticky top-0 bg-muted"><tr>{["Decision", "Actual pre-trade holdings", "Candidate targets", "Underlying targets", "Asset trade fractions / estimated fees", "Predicted vs actual fill charges", "Objective breakdown"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{decisions.map((decision, i) => { const opt = object(decision.optimizer), d5 = object(decision.d5), costs = object(opt.costAware ?? d5.costObjective); return <tr key={i} className="border-t align-top" data-testid={`row-b3-cost-decision-${i}`}><td className="p-2">{show(decision.decisionDate)}</td><td className="p-2 font-mono whitespace-pre-wrap">{show(d5.actualHoldings)}</td><td className="p-2 font-mono whitespace-pre-wrap">{show(decision.candidateWeights)}</td><td className="p-2 font-mono whitespace-pre-wrap">{show(decision.targetAssetWeights)}</td><td className="p-2 font-mono whitespace-pre-wrap">{show(costs.assets === undefined ? undefined : assetEstimates(costs))}</td><td className="p-2 font-mono whitespace-pre-wrap">Predicted fee / slippage: {number(d5.predictedTransactionCosts)} / {number(d5.predictedSlippage)}{"\n"}Actual fee / slippage: {number(d5.actualTransactionCosts)} / {number(d5.actualSlippage)}{"\n"}Fill trades: {show(d5.actualTrades)}</td><td className="p-2 font-mono whitespace-pre-wrap">{show(opt.objectiveContributions)}</td></tr>; })}</tbody></table></div> : <p className="rounded border border-dashed p-3 text-muted-foreground">No saved historical decisions to audit.</p>}
      {blindLedger.length && comparableFees !== false ? <><p className="text-muted-foreground" data-testid="status-b3-cost-fee-parity">{comparableFees === true ? "Execution fee and slippage rates match in both saved paths." : "The paired ledger did not separately expose its rates; verify identical execution assumptions in the frozen run before drawing conclusions."}</p><div className="overflow-auto rounded border bg-background"><table className="w-full min-w-[700px] text-left"><thead className="bg-muted"><tr><th className="p-2">Date</th><th className="p-2">Cost-aware net NAV</th><th className="p-2">Cost-aware actual fees / slippage</th><th className="p-2">Cost-blind net NAV</th><th className="p-2">Cost-blind actual fees / slippage</th></tr></thead><tbody>{awareLedger.map((day, i) => { const other = byDate.get(String(day.date)); return <tr className="border-t" key={i} data-testid={`row-b3-cost-ledger-${i}`}><td className="p-2">{show(day.date)}</td><td className="p-2 font-mono">{number(day.endingNav ?? day.nav)}</td><td className="p-2 font-mono">{number(day.transactionCosts)} / {number(day.slippage)}</td><td className="p-2 font-mono">{number(other?.endingNav ?? other?.nav)}</td><td className="p-2 font-mono">{number(other?.transactionCosts)} / {number(other?.slippage)}</td></tr>; })}</tbody></table></div></> : <p className="rounded border border-dashed p-3 text-muted-foreground" data-testid="status-b3-cost-blind-unavailable">{comparableFees === false ? "Paired execution fees differ; side-by-side ledger withheld because the comparison is not controlled." : "A paired cost-blind ledger was not returned for this saved run. No comparison is inferred from unmatched runs."}</p>}
    </CardContent></Card>;
}