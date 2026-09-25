import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getGetAllocationQueryKey, getGetAlphaContributionExperimentQueryKey,
  useCreateAlphaContributionExperiment, useGetAllocation, useGetAlphaContributionExperiment,
  useListAlphaContributionExperiments, useListPreparedInputs, useReplayAlphaContributionExperiment,
  type B3ValidationAssumptions, type C1Experiment, type C1ExperimentInputMode,
} from "@workspace/api-client-react";
import { AlertCircle, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Row = Record<string, unknown>;
type Metric = { value?: number | null; reason?: string | null };
type Distance = { dateSeries?: { date: string; distance: number }[]; mean?: number | null; maximum?: number | null; reason?: string | null };
type Outcome = { label?: string; status?: string; reason?: string | null; failureDate?: string | null; metrics?: Record<string, Metric>; deltaFullMinusVariant?: Record<string, Metric>; comparisonAvailable?: boolean; comparisonReason?: string | null; alphaCapitalDistance?: Distance; finalAssetAndCashDistance?: Distance; turnoverConvention?: string | null };
const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const asRows = (value: unknown): Row[] => Array.isArray(value) ? value.map(asRow) : [];
const readable = (value: unknown) => value == null || value === "" ? "Unavailable" : String(value);
const errorText = (value: unknown) => value instanceof Error ? value.message : "Request could not be completed.";
const metricDefinitions = [
  ["cumulativeReturn", "Net cumulative return", "percent"],
  ["annualizedReturn", "Annualized return", "percent"],
  ["annualizedVolatility", "Annualized volatility", "percent"],
  ["sharpe", "Daily-excess-return Sharpe", "decimal"],
  ["maximumDrawdown", "Maximum drawdown", "percent"],
  ["externalTradedNotional", "External traded notional", "money"],
  ["totalTransactionCosts", "Transaction costs", "money"],
  ["averageCashExposure", "Average cash exposure", "percent"],
  ["averageRiskyExposure", "Average risky exposure", "percent"],
] as const;
function format(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return "Undefined";
  return unit === "percent" ? `${(value * 100).toFixed(2)}%`
    : unit === "money" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value.toFixed(3);
}
function MetricCell({ metric: item, unit }: { metric?: Metric; unit: string }) {
  return <span className="block tabular-nums" title={item?.reason ?? undefined}>{format(item?.value, unit)}
    {item?.value == null && <span className="block max-w-52 whitespace-normal text-[11px] text-muted-foreground">{item?.reason ?? "Not reported"}</span>}
  </span>;
}
function DistanceView({ title, data }: { title: string; data?: Distance }) {
  return <div className="rounded-md border border-border/80 bg-muted/20 p-3">
    <h4 className="text-xs font-semibold">{title}</h4>
    <p className="mt-1 text-xs text-muted-foreground">½ × Σ |full weight − excluded weight| · matched decisions; not realized turnover</p>
    <div className="mt-3 flex gap-6 text-sm tabular-nums"><span>Mean <strong>{format(data?.mean, "decimal")}</strong></span><span>Maximum <strong>{format(data?.maximum, "decimal")}</strong></span></div>
    {data?.reason && <p className="mt-2 text-xs text-amber-800">{data.reason}</p>}
    {data?.dateSeries?.length ? <div className="mt-3 max-h-44 overflow-auto rounded border">
      <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="px-2 py-1">Decision date</th><th className="px-2 py-1">Distance</th></tr></thead><tbody>{data.dateSeries.map((point, index) =>
        <tr className="border-t" key={`${point.date}-${index}`}><td className="px-2 py-1">{point.date}</td><td className="px-2 py-1 font-mono">{format(point.distance, "decimal")}</td></tr>)}</tbody></table>
    </div> : <p className="mt-2 text-xs text-muted-foreground">No matched decision dates available.</p>}
  </div>;
}

/** Deliberately lives within B3's comparison area, not in the portfolio navigation. */
export function C1ContributionPanel({ allocationId }: { allocationId: number | null }) {
  const [preparedId, setPreparedId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [holdout, setHoldout] = useState("");
  const [mode, setMode] = useState<C1ExperimentInputMode>("single");
  const [draft, setDraft] = useState<string[]>([]);
  const [sets, setSets] = useState<string[][]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<unknown>(null);
  const [calendar, setCalendar] = useState<"monthly" | "quarterly">("monthly");
  const [timing, setTiming] = useState<"same_close" | "next_close">("next_close");
  const [nav, setNav] = useState(100000);
  const [cash, setCash] = useState(100000);
  const [holdings, setHoldings] = useState("{}");
  const [cost, setCost] = useState(10);
  const [slippage, setSlippage] = useState(5);
  const [yieldDaily, setYieldDaily] = useState(0);
  const [benchmark, setBenchmark] = useState("");

  const allocation = useGetAllocation(allocationId ?? 0, { query: { enabled: !!allocationId, queryKey: getGetAllocationQueryKey(allocationId ?? 0) } });
  const prepared = useListPreparedInputs();
  const saved = useListAlphaContributionExperiments();
  const detail = useGetAlphaContributionExperiment(selectedId ?? 0, { query: { enabled: !!selectedId, queryKey: getGetAlphaContributionExperimentQueryKey(selectedId ?? 0) } });
  const create = useCreateAlphaContributionExperiment();
  const replay = useReplayAlphaContributionExperiment();
  const candidates = allocation.data?.request.candidateIds ?? [];
  const isAlpha = allocation.data?.representation === "alpha_streams" && allocation.data.status === "SOLVED";
  const uniqueSets = useMemo(() => [...new Map(sets.map(set => [[...set].sort().join("\u0000"), [...set].sort()] as const)).values()], [sets]);
  const policyCount = 1 + (mode === "pair" ? (uniqueSets.length ? 3 : 0) : uniqueSets.length);
  const selected = detail.data as C1Experiment | undefined;
  const summary = asRow(selected?.summary) as Outcome & { baseline?: Outcome; variants?: Outcome[]; deltaConvention?: string; label?: string };
  const outcomes = [summary.baseline, ...(Array.isArray(summary.variants) ? summary.variants : [])];
  const currentInputs = (prepared.data ?? []).filter(item => item.representation === "alpha_streams");

  function changeMode(next: C1ExperimentInputMode) { setMode(next); setDraft([]); setSets([]); setFormError(null); }
  function addSet() {
    const chosen = [...new Set(draft)].sort();
    if ((mode === "single" && chosen.length !== 1) || (mode !== "single" && chosen.length !== 2 && mode === "pair") ||
      (mode === "group" && chosen.length < 2)) {
      setFormError(mode === "single" ? "Choose exactly one candidate." : mode === "pair" ? "Choose exactly two candidates." : "Choose at least two candidates for a group."); return;
    }
    if (chosen.length >= candidates.length) { setFormError("An exclusion cannot remove every candidate."); return; }
    if (sets.some(set => [...set].sort().join("\u0000") === chosen.join("\u0000"))) { setFormError("This exclusion set is already added."); return; }
    setSets(mode === "pair" ? [chosen] : [...sets, chosen]); setDraft([]); setFormError(null);
  }
  async function runComparison() {
    setFormError(null);
    if (!allocationId || !isAlpha) { setFormError("Select a solved, frozen B2 alpha-stream allocation first."); return; }
    if (!preparedId) { setFormError("Choose a frozen B1 evaluation preparation explicitly."); return; }
    if (!start || !end || start > end) { setFormError("Choose a valid development start and end date."); return; }
    if (holdout && end >= holdout) { setFormError("Development must end before the reserved holdout start date."); return; }
    if (!uniqueSets.length) { setFormError("Add at least one explicit exclusion set."); return; }
    if (policyCount > 6) { setFormError(`Refused: ${policyCount} distinct policies requested; maximum is six including the full baseline.`); return; }
    if (mode === "pair" && uniqueSets.length !== 1) { setFormError("Pair mode requires exactly one pair."); return; }
    if (![nav, cash, cost, slippage, yieldDaily].every(Number.isFinite) || nav <= 0 || cash < 0 || cost < 0 || slippage < 0) {
      setFormError("Initial NAV must be positive and cash and costs must be finite and nonnegative."); return;
    }
    let initialHoldings: Record<string, number>;
    try {
      const parsed: unknown = JSON.parse(holdings);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error();
      initialHoldings = parsed as Record<string, number>;
    } catch { setFormError("Initial holdings must be a JSON object of tickers to nonnegative finite quantities."); return; }
    const assumptions: B3ValidationAssumptions = {
      evaluationStartDate: start, evaluationEndDate: end, decisionCalendar: calendar, executionTiming: timing,
      initialNav: nav, initialCash: cash, initialHoldings, transactionCostBps: cost, slippageBps: slippage,
      dailyCashYield: yieldDaily, ...(benchmark.trim() ? { benchmarkTicker: benchmark.trim().toUpperCase() } : {}),
    };
    try {
      const result = await create.mutateAsync({ data: {
        allocationId, validationPreparedInputId: Number(preparedId), assumptions, mode, exclusionSets: uniqueSets,
        ...(holdout ? { holdoutStartDate: holdout } : {}),
      } });
      await saved.refetch();
      setSelectedId(result.id);
      setReplayResult(null);
    } catch (error) { setFormError(errorText(error)); }
  }
  async function replaySaved() {
    if (!selectedId) return;
    setFormError(null);
    try { setReplayResult(await replay.mutateAsync({ experimentId: selectedId })); }
    catch (error) { setFormError(errorText(error)); }
  }
  const curve = useMemo(() => {
    if (!selected) return [];
    const byDate = new Map<string, Record<string, string | number>>();
    selected.children.forEach((child, index) => {
      if (asRow(child.result).status !== "completed") return;
      asRows(asRow(child.result).dailyLedger).forEach(day => {
        const date = String(day.date ?? "");
        if (!date || typeof day.endingNav !== "number") return;
        byDate.set(date, { ...(byDate.get(date) ?? { date }), [`policy${index}`]: day.endingNav });
      });
    });
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [selected]);
  const colors = ["#243d66", "#b06c43", "#68857e", "#927c9e", "#aa9455", "#7d6378"];
  const field = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return <Card className="border-primary/20" data-testid="card-c1-contribution">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Alpha Contribution</CardTitle>
      <CardDescription className="mt-1 max-w-2xl">Development comparison — no automatic selection. Exclusions reoptimize the complete frozen policy at each historical decision; they do not subtract a candidate's P&amp;L.</CardDescription></div>
      <Badge variant="outline">C1 · B3 comparison</Badge></div></CardHeader>
    <CardContent className="space-y-6">
      {(formError || allocation.isError || prepared.isError || saved.isError || detail.isError) && <Alert variant="destructive" role="alert" data-testid="status-c1-error"><AlertCircle className="h-4 w-4" /><AlertDescription>{formError ?? errorText(allocation.error ?? prepared.error ?? saved.error ?? detail.error)}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => { setFormError(null); void allocation.refetch(); void prepared.refetch(); void saved.refetch(); if (selectedId) void detail.refetch(); }} data-testid="button-c1-retry">Retry loading</Button>
      </AlertDescription></Alert>}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">01 / Frozen baseline &amp; development window</h3>
        {allocation.isLoading || prepared.isLoading ? <div className="h-24 animate-pulse rounded-md bg-muted/60" aria-label="Loading frozen inputs" /> :
          <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="status-c1-baseline">Selected B2 allocation #{allocationId ?? "none"} · {readable(allocation.data?.representation)} · {readable(allocation.data?.status)} · source B1 #{readable(allocation.data?.preparedInputId)}.
            <p className="mt-1 text-muted-foreground">Only a solved alpha-stream policy can be compared. Candidate IDs below come from this immutable allocation, not the current workspace.</p>
          </div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="c1-prepared">Frozen evaluation B1 preparation</Label><select id="c1-prepared" className={field} value={preparedId} onChange={e => setPreparedId(e.target.value)} data-testid="select-c1-prepared"><option value="">Select explicitly</option>{currentInputs.map(item => <option key={item.preparedInputId} value={item.preparedInputId}>#{item.preparedInputId} · {item.status} · {readable(item.createdAt)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c1-start">Development start</Label><Input id="c1-start" type="date" value={start} onChange={e => setStart(e.target.value)} data-testid="input-c1-start" /></div>
          <div className="space-y-1"><Label htmlFor="c1-end">Development end</Label><Input id="c1-end" type="date" value={end} onChange={e => setEnd(e.target.value)} data-testid="input-c1-end" /></div>
          <div className="space-y-1"><Label htmlFor="c1-holdout">Reserved holdout start (optional)</Label><Input id="c1-holdout" type="date" value={holdout} onChange={e => setHoldout(e.target.value)} data-testid="input-c1-holdout" /></div>
        </div>
        {!currentInputs.length && !prepared.isLoading && <p className="text-xs text-amber-800">No saved alpha-stream B1 evaluation preparation is available.</p>}
      </div>
      <div className="space-y-3 border-t pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">02 / Explicit exclusion variants</h3>
        <div className="max-w-xs space-y-1"><Label htmlFor="c1-mode">Experiment mode</Label><select id="c1-mode" className={field} value={mode} onChange={e => changeMode(e.target.value as C1ExperimentInputMode)} data-testid="select-c1-mode"><option value="single">Single exclusion</option><option value="group">Group exclusion</option><option value="pair">Selected pair (four outcomes)</option></select></div>
        <fieldset className="rounded-md border p-3"><legend className="px-1 text-xs font-medium">Choose {mode === "single" ? "one canonical candidate" : mode === "pair" ? "exactly two canonical candidates" : "at least two canonical candidates"}</legend>
          <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">{candidates.map((id, index) => <label key={id} className="flex min-w-0 items-center gap-2 text-xs"><input type="checkbox" checked={draft.includes(id)} onChange={e => setDraft(previous => e.target.checked ? [...previous, id] : previous.filter(value => value !== id))} data-testid={`checkbox-c1-candidate-${index}`} /><span className="break-all font-mono">{id}</span></label>)}</div>
          {!candidates.length && <p className="text-xs text-muted-foreground">Select a solved alpha-stream B2 allocation to see its candidate IDs.</p>}
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={addSet} disabled={!draft.length || !isAlpha} data-testid="button-c1-add-exclusion"><Plus className="mr-1 h-3.5 w-3.5" />{mode === "pair" ? "Set selected pair" : "Add exclusion set"}</Button>
        </fieldset>
        <div className="flex flex-wrap gap-2">{uniqueSets.map((set, index) => <div key={set.join("\u0000")} className="flex max-w-full items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs"><span className="break-all">Exclude {set.join(" + ")}</span><button type="button" aria-label={`Remove exclusion ${index + 1}`} onClick={() => setSets(previous => previous.filter(item => [...item].sort().join("\u0000") !== set.join("\u0000")))} data-testid={`button-c1-remove-exclusion-${index}`}><X className="h-3.5 w-3.5" /></button></div>)}
          {!sets.length && <p className="text-xs text-muted-foreground">No variants added. Only your explicit selections will be evaluated.</p>}</div>
        <p className={`text-xs font-semibold ${policyCount > 6 ? "text-destructive" : "text-foreground"}`} data-testid="status-c1-policy-count">{policyCount} distinct {policyCount === 1 ? "policy" : "policies"} planned (full baseline included) · maximum 6.{policyCount > 6 ? " Refused: remove exclusion sets before running." : ""} {mode === "pair" && uniqueSets.length ? "Pair expands to full, without A, without B, and without both." : ""}</p>
      </div>
      <div className="space-y-3 border-t pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">03 / Review frozen B3 assumptions</h3>
        <p className="text-xs text-muted-foreground">These inputs apply identically to every independently reoptimized policy. Changing them creates a new saved experiment; reserved holdout results are never generated here.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="c1-calendar">Decision calendar</Label><select id="c1-calendar" className={field} value={calendar} onChange={e => setCalendar(e.target.value as typeof calendar)} data-testid="select-c1-calendar"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
          <div className="space-y-1"><Label htmlFor="c1-timing">Execution timing</Label><select id="c1-timing" className={field} value={timing} onChange={e => setTiming(e.target.value as typeof timing)} data-testid="select-c1-timing"><option value="next_close">Next close</option><option value="same_close">Same close</option></select></div>
          <div className="space-y-1"><Label htmlFor="c1-nav">Initial NAV</Label><Input id="c1-nav" type="number" step="any" value={nav} onChange={e => setNav(Number(e.target.value))} data-testid="input-c1-nav" /></div>
          <div className="space-y-1"><Label htmlFor="c1-cash">Initial cash</Label><Input id="c1-cash" type="number" step="any" value={cash} onChange={e => setCash(Number(e.target.value))} data-testid="input-c1-cash" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="c1-holdings">Initial holdings (ticker → quantity JSON)</Label><Input id="c1-holdings" value={holdings} onChange={e => setHoldings(e.target.value)} data-testid="input-c1-holdings" /></div>
          <div className="space-y-1"><Label htmlFor="c1-cost">Transaction cost (bps)</Label><Input id="c1-cost" type="number" step="any" value={cost} onChange={e => setCost(Number(e.target.value))} data-testid="input-c1-cost" /></div>
          <div className="space-y-1"><Label htmlFor="c1-slippage">Slippage (bps)</Label><Input id="c1-slippage" type="number" step="any" value={slippage} onChange={e => setSlippage(Number(e.target.value))} data-testid="input-c1-slippage" /></div>
          <div className="space-y-1"><Label htmlFor="c1-yield">Daily cash yield (decimal)</Label><Input id="c1-yield" type="number" step="any" value={yieldDaily} onChange={e => setYieldDaily(Number(e.target.value))} data-testid="input-c1-yield" /></div>
          <div className="space-y-1"><Label htmlFor="c1-benchmark">Benchmark ticker (optional)</Label><Input id="c1-benchmark" value={benchmark} onChange={e => setBenchmark(e.target.value)} data-testid="input-c1-benchmark" /></div>
        </div>
        <details className="text-xs"><summary className="cursor-pointer font-medium">Frozen B2 objective, estimation and constraints</summary><pre className="mt-2 max-h-44 overflow-auto rounded border bg-muted/20 p-3">{JSON.stringify(allocation.data?.request ?? {}, null, 2)}</pre></details>
        <Button onClick={() => void runComparison()} disabled={create.isPending || !isAlpha || !preparedId || !uniqueSets.length || policyCount > 6} data-testid="button-c1-run">{create.isPending ? "Running comparison…" : "Run Comparison"}</Button>
      </div>
      <div className="space-y-3 border-t pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">04 / Saved comparisons</h3><Button size="sm" variant="outline" onClick={() => void saved.refetch()} disabled={saved.isFetching} data-testid="button-c1-refresh"><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh saved</Button></div>
        {saved.isLoading && <div className="h-12 animate-pulse rounded bg-muted/60" aria-label="Loading saved comparisons" />}
        <div className="max-w-lg space-y-1"><Label htmlFor="c1-saved">Inspect experiment by ID</Label><select id="c1-saved" className={field} value={selectedId ?? ""} onChange={e => { setSelectedId(e.target.value ? Number(e.target.value) : null); setReplayResult(null); }} data-testid="select-c1-saved"><option value="">Select saved experiment</option>{(saved.data ?? []).map(item => <option key={item.id} value={item.id}>#{item.id} · B2 #{item.allocationId} · {item.mode} · {item.status} · {readable(item.createdAt)}</option>)}</select></div>
        {!saved.isLoading && !saved.data?.length && <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">No saved comparisons yet. A run persists its manifest and child Validation Run IDs; opening this panel never starts one.</p>}
      </div>
      {selectedId && (detail.isLoading ? <div className="h-52 animate-pulse rounded bg-muted/60" aria-label="Loading experiment detail" /> : selected && <div className="space-y-5 border-t pt-5" data-testid="status-c1-detail">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Experiment #{selected.id} <Badge variant="outline">{selected.status}</Badge></h3>
          <p className="mt-1 text-xs text-muted-foreground">B2 #{selected.allocationId} · B1 evaluation #{selected.validationPreparedInputId} · {selected.actualPolicyCount}/{selected.plannedPolicyCount} policies evaluated · manifest {selected.manifestHash}</p></div>
          <Button size="sm" variant="outline" onClick={() => void replaySaved()} disabled={replay.isPending} data-testid="button-c1-replay"><RotateCcw className="mr-1 h-3.5 w-3.5" />{replay.isPending ? "Checking replay…" : "Replay frozen experiment"}</Button></div>
        {replayResult != null && <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="status-c1-replay"><strong>Replay verification</strong><pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap">{JSON.stringify(replayResult, null, 2)}</pre></div>}
        <p className="text-xs font-medium">{summary.label ?? "Development comparison — no automatic selection."} <span className="font-normal text-muted-foreground">Delta = {summary.deltaConvention ?? "Full set minus exclusion variant."} A negative risk or cost delta means the full policy produced less; no universal favorable sign is implied.</span></p>
        <div className="grid gap-2 sm:grid-cols-2">{selected.children.map((child, index) => {
          const ledger = asRows(asRow(child.result).dailyLedger);
          const outcome = outcomes[index];
          const result = asRow(child.result);
          return <div key={index} className="rounded-md border bg-muted/20 p-3 text-xs" data-testid={`status-c1-child-${index}`}><strong>{child.label}</strong><p className="mt-1 break-all">Excluded: {child.excludedCandidateIds.length ? child.excludedCandidateIds.join(", ") : "none · full set"}</p>
            <p className="mt-1">Validation Run #{child.validationRunId ?? "not created"} · {readable(result.status ?? outcome?.status)} · coverage: {ledger.length ? `${readable(ledger[0].date)} → ${readable(ledger[ledger.length - 1].date)} (${ledger.length} ledger dates)` : "no complete ledger"}</p>
            {Boolean(outcome?.failureDate || result.failureDate) && <p className="mt-1 text-amber-800">Failure date: {readable(outcome?.failureDate ?? result.failureDate)}</p>}
            {Boolean(outcome?.reason || result.reason || result.diagnostic) && <p className="mt-1 text-amber-800">Reason: {readable(outcome?.reason ?? result.reason ?? result.diagnostic)}</p>}
          </div>;
        })}</div>
        <details className="text-xs"><summary className="cursor-pointer font-medium">Inspect persisted manifest, exact plans and assumptions</summary><pre className="mt-2 max-h-72 overflow-auto rounded border bg-muted/20 p-3">{JSON.stringify(selected.manifest, null, 2)}</pre></details>
        {curve.length ? <div><h4 className="text-sm font-semibold">Net NAV · full set versus exclusions</h4><p className="mb-2 text-xs text-muted-foreground">Each line comes from its own child B3 daily ledger. Failed policies do not receive substitute curves.</p>
          <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid strokeDasharray="3 3" stroke="#d7dedb" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} /><Tooltip /><Legend />{selected.children.map((child, index) => asRow(child.result).status === "completed" && <Line key={index} dataKey={`policy${index}`} name={child.label} stroke={colors[index % colors.length]} strokeWidth={index === 0 ? 2.5 : 1.7} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></div>
        </div> : <p className="rounded border border-dashed p-4 text-xs text-muted-foreground">No completed child ledger is available for a net curve.</p>}
        {summary.baseline ? <div className="space-y-3"><div><h4 className="text-sm font-semibold">Full-set and exclusion metrics</h4><p className="text-xs text-muted-foreground">Net results from each complete ledger. Undefined values and failure reasons are not treated as zero. Turnover convention: {readable(summary.baseline.turnoverConvention)}; external traded notional is shown below.</p></div>
          <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[740px] text-left text-xs"><thead className="bg-muted/50"><tr><th className="sticky left-0 bg-muted px-3 py-2">Metric</th><th className="px-3 py-2">Full set</th>{(summary.variants ?? []).map((variant, index) => <th key={index} className="px-3 py-2">{variant.label ?? selected.children[index + 1]?.label}<span className="block font-normal text-muted-foreground">Variant / Δ full − variant</span></th>)}</tr></thead>
            <tbody>{metricDefinitions.map(([key, label, unit]) => <tr key={key} className="border-t align-top"><th className="sticky left-0 bg-background px-3 py-2 font-medium">{label}</th><td className="px-3 py-2"><MetricCell metric={summary.baseline?.metrics?.[key]} unit={unit} /></td>{(summary.variants ?? []).map((variant, index) => <td key={index} className="px-3 py-2"><MetricCell metric={variant.metrics?.[key]} unit={unit} /><div className="mt-1 border-t pt-1 text-muted-foreground">Δ <MetricCell metric={variant.comparisonAvailable ? variant.deltaFullMinusVariant?.[key] : { value: null, reason: variant.comparisonReason ?? "Comparison unavailable for a failed policy." }} unit={unit} /></div></td>)}</tr>)}</tbody>
          </table></div>
        </div> : <p className="text-xs text-amber-800">Comparison summary unavailable; inspect child failures and the saved manifest.</p>}
        {(summary.variants ?? []).map((variant, index) => <div key={index} className="space-y-3 rounded-md border p-3" data-testid={`status-c1-distance-${index}`}><h4 className="text-sm font-semibold">{variant.label ?? selected.children[index + 1]?.label} · allocation change</h4>
          {!variant.comparisonAvailable && <p className="text-xs text-amber-800">Comparison unavailable: {variant.comparisonReason ?? variant.reason ?? "Incomplete policy."}</p>}
          <div className="grid gap-3 md:grid-cols-2"><DistanceView title="Alpha capital + master cash" data={variant.alphaCapitalDistance} /><DistanceView title="Final assets + total cash" data={variant.finalAssetAndCashDistance} /></div>
          <p className="text-xs text-muted-foreground">Excluded candidates align at zero weight. These target differences are not realized exposure, turnover, probabilities or a robustness score.</p>
        </div>)}
        <p className="text-xs text-muted-foreground">This is the effect of changing the available alpha set under the complete policy, not standalone performance, causal attribution, or evidence of independent out-of-sample profitability. Pair effects need not add.</p>
      </div>)}
    </CardContent>
  </Card>;
}