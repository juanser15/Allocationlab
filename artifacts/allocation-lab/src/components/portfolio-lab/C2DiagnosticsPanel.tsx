import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getGetAllocationQueryKey, getGetAlphaContributionExperimentQueryKey, getGetAlphaDiagnosticExperimentQueryKey,
  useCreateAlphaDiagnosticDependencyPlan, useCreateAlphaDiagnosticExperiment, useGetAllocation, useGetAlphaContributionExperiment, useGetAlphaDiagnosticExperiment,
  useListAllocations, useListPreparedInputs, useListAlphaContributionExperiments,
  useListAlphaDiagnosticExperiments, useReplayAlphaDiagnosticExperiment,
  type B3ValidationAssumptions, type C2DependencyPlan, type C2ExperimentInput,
} from "@workspace/api-client-react";
import { Activity, AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const text = (v: unknown) => v === null || v === undefined || v === "" ? "Unavailable" : String(v);
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const meanOf = (items: Row[], key: string): number | null => {
  const valid = items.map(item => number(item[key])).filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const fmt = (v: unknown, unit: "percent" | "ratio" | "native" | "count" = "ratio") => {
  const n = number(v);
  return n === null ? "Undefined" : unit === "percent" ? `${(n * 100).toFixed(2)}%`
    : unit === "count" ? String(n) : unit === "native" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : n.toFixed(3);
};
const failure = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const colors = ["#344e78", "#bc7654", "#638a81", "#a0809b", "#aa9154"];
const names: Record<string, string> = {
  netReturn: "Compounded net return", annualizedVolatility: "Annualized volatility", sharpe: "Annualized Sharpe",
  hitRate: "Hit rate", tradedNotional: "Mean daily traded notional", averageRiskyExposure: "Risky exposure",
  drawdownFromAlphaStreamNav: "Alpha-stream NAV drawdown", grossReturn: "Compounded gross return",
  mean: "Mean daily return", volatility: "Annualized volatility", meanDailyExcessReturn: "Mean daily excess return",
  averageTurnoverOrTradedNotional: "Mean turnover / traded notional", averageDailyCost: "Mean daily cost",
  netReturnDelta: "Net return delta", sharpeDelta: "Sharpe delta", volatilityDelta: "Volatility delta",
  drawdownDelta: "Drawdown delta", costDelta: "Cost delta",
};
const unitFor = (key: string): "percent" | "ratio" | "native" => /sharpe|correlation|similarity/i.test(key) ? "ratio"
  : /cost|notional|turnover/i.test(key) ? "native" : "percent";
const field = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const canonicalName = (source: unknown, id: string) => {
  const candidate = rows(source).find(item => item.candidateId === id || item.canonicalFingerprint === id);
  const name = candidate?.name ?? row(row(candidate?.lineage).definition).name;
  return typeof name === "string" && name.trim() ? name : null;
};
const validIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function Value({ value, unit = "ratio", reason }: { value: unknown; unit?: "percent" | "ratio" | "native" | "count"; reason?: unknown }) {
  return <span className="tabular-nums" title={typeof reason === "string" ? reason : undefined}>
    {fmt(value, unit)}{number(value) === null && reason ? <span className="ml-1 text-amber-800">· {text(reason)}</span> : null}
  </span>;
}
function Empty({ children }: { children: string }) {
  return <p className="rounded-md border border-dashed bg-muted/20 px-4 py-5 text-xs text-muted-foreground">{children}</p>;
}
function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return <section className="space-y-4 border-t pt-6"><div><h4 className="text-sm font-semibold">{title}</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p></div>{children}</section>;
}
function MetricTable({ data, fields, label }: { data: Row[]; fields: string[]; label: string }) {
  if (!data.length) return <Empty>No observations were saved for this comparison.</Empty>;
  return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[640px] text-left text-xs">
    <thead className="bg-muted/50"><tr><th scope="col" className="px-3 py-2">{label}</th>{fields.map(key => <th scope="col" key={key} className="px-3 py-2">{names[key] ?? key}</th>)}</tr></thead>
    <tbody>{data.map((item, i) => <tr key={i} className="border-t align-top"><th scope="row" className="max-w-52 break-all px-3 py-2 font-medium">{text(item.label ?? item.alphaId ?? item.regime ?? `${text(item.startDate)} → ${text(item.endDate)}`)}</th>
      {fields.map(key => <td key={key} className="px-3 py-2"><Value value={row(item.metrics)[key] ?? item[key]} unit={unitFor(key)} reason={item.reason ?? item.sharpeReason ?? (item.status !== "AVAILABLE" ? item.status : null)} /></td>)}</tr>)}</tbody>
  </table></div>;
}
function SeriesChart({ title, data, keys, unit, note }: { title: string; data: Row[]; keys: { key: string; label: string }[]; unit: string; note: string }) {
  const active = keys.filter(item => data.some(point => number(point[item.key]) !== null));
  return <div className="rounded-md border bg-muted/10 p-3 sm:p-4">
    <h5 className="text-xs font-semibold">{title}</h5><p className="mt-1 text-[11px] text-muted-foreground">{note} · {unit} · {data.length} saved windows{data.length ? ` · ${text(data[0].startDate ?? data[0].date)} → ${text(data[data.length - 1].endDate ?? data[data.length - 1].date)}` : ""}</p>
    {active.length ? <div className="mt-3 h-56 w-full" role="img" aria-label={`${title}: ${active.map(k => k.label).join(", ")} over ${data.length} windows`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 5, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#d8dcd8" /><XAxis dataKey="endDate" tick={{ fontSize: 10 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 10 }} width={44} domain={["auto", "auto"]} /><Tooltip formatter={(v, name) => [typeof v === "number" ? v.toFixed(4) : text(v), text(name)]} /><Legend wrapperStyle={{ fontSize: 11 }} />
        {active.map((k, i) => <Line key={k.key} type="monotone" dataKey={k.key} name={k.label} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} connectNulls={false} />)}
      </LineChart></ResponsiveContainer>
    </div> : <p className="mt-4 text-xs text-amber-800">No defined values in the saved windows. Inspect status and observation counts below.</p>}
  </div>;
}

/** C2 is local to Backtest; reading a saved experiment never executes diagnostics. */
export function C2DiagnosticsPanel() {
  const [allocationId, setAllocationId] = useState<number | null>(null);
  const [preparedId, setPreparedId] = useState("");
  const [c1Id, setC1Id] = useState("");
  const [alphaIds, setAlphaIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [settings, setSettings] = useState({ rollingWindow: 63, rollingStep: 21, contributionWindow: 252, contributionStep: 63, minRollingPaired: 40, minRegimePaired: 30, minSharpeObservations: 30, highCorrelationThreshold: 0.8, materialCorrelationGap: 0.3 });
  const [mapping, setMapping] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState("Stability");
  const [message, setMessage] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ key: string; data?: C2DependencyPlan; error?: string } | null>(null);
  const [checkingRun, setCheckingRun] = useState(false);
  const [replayResult, setReplayResult] = useState<Awaited<ReturnType<ReturnType<typeof useReplayAlphaDiagnosticExperiment>["mutateAsync"]>> | null>(null);

  const allocations = useListAllocations();
  const allocation = useGetAllocation(allocationId ?? 0, { query: { enabled: !!allocationId, queryKey: getGetAllocationQueryKey(allocationId ?? 0) } });
  const prepared = useListPreparedInputs();
  const c1 = useListAlphaContributionExperiments();
  const selectedC1 = useGetAlphaContributionExperiment(Number(c1Id) || 0, {
    query: { enabled: !!c1Id, queryKey: getGetAlphaContributionExperimentQueryKey(Number(c1Id) || 0) },
  });
  const saved = useListAlphaDiagnosticExperiments();
  const detail = useGetAlphaDiagnosticExperiment(selectedId ?? 0, { query: { enabled: !!selectedId, queryKey: getGetAlphaDiagnosticExperimentQueryKey(selectedId ?? 0) } });
  const create = useCreateAlphaDiagnosticExperiment();
  const preflight = useCreateAlphaDiagnosticDependencyPlan();
  const planRequest = useRef(preflight.mutateAsync);
  planRequest.current = preflight.mutateAsync;
  const replay = useReplayAlphaDiagnosticExperiment();
  const eligible = (allocations.data ?? []).filter(a => a.representation === "alpha_streams" && a.status === "SOLVED");
  const eligiblePrepared = (prepared.data ?? []).filter(p => p.representation === "alpha_streams" && p.status === "READY");
  const matchingC1 = (c1.data ?? []).filter(x => x.allocationId === allocationId && x.validationPreparedInputId === Number(preparedId) && x.status === "completed");
  const candidates = allocation.data?.request.candidateIds ?? [];
  const policyB1 = (prepared.data ?? []).find(p => p.preparedInputId === allocation.data?.preparedInputId);
  const policyCandidates = row(policyB1?.snapshot).candidates ?? policyB1?.candidates;
  const frozenTemplate = row(selectedC1.data?.manifest);
  const templateAssumptions = row(frozenTemplate.assumptions);
  const templateReady = !c1Id || (selectedC1.data?.id === Number(c1Id) && selectedC1.data.status === "completed" &&
    selectedC1.data.allocationId === allocationId &&
    selectedC1.data.validationPreparedInputId === Number(preparedId) &&
    typeof templateAssumptions.decisionCalendar === "string" &&
    typeof templateAssumptions.executionTiming === "string" &&
    typeof templateAssumptions.initialNav === "number" &&
    typeof templateAssumptions.transactionCostBps === "number" &&
    typeof templateAssumptions.slippageBps === "number" &&
    typeof templateAssumptions.dailyCashYield === "number" &&
    typeof templateAssumptions.initialCash === "number" &&
    !!templateAssumptions.initialHoldings && typeof templateAssumptions.initialHoldings === "object");
  const declaredAssumptions: B3ValidationAssumptions | undefined = c1Id && templateReady
    ? { ...templateAssumptions, evaluationStartDate: startDate, evaluationEndDate: endDate } as B3ValidationAssumptions
    : undefined;
  const integerKeys = ["rollingWindow", "rollingStep", "contributionWindow", "contributionStep", "minRollingPaired", "minRegimePaired", "minSharpeObservations"] as const;
  let mappingValue: Record<string, string> | undefined;
  let mappingValid = true;
  if (mapping.trim()) {
    try {
      const parsed: unknown = JSON.parse(mapping);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          Object.entries(parsed).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim()))
        throw new Error("Invalid mapping");
      mappingValue = parsed as Record<string, string>;
    } catch { mappingValid = false; }
  }
  const settingsValid = !integerKeys.some(key => !Number.isSafeInteger(settings[key]) || settings[key] < (key.endsWith("Window") || key.startsWith("min") ? 2 : 1)) &&
    Number.isFinite(settings.highCorrelationThreshold) && settings.highCorrelationThreshold >= -1 && settings.highCorrelationThreshold <= 1 &&
    Number.isFinite(settings.materialCorrelationGap) && settings.materialCorrelationGap >= 0 && settings.materialCorrelationGap <= 2;
  const selectionValid = !!allocationId && allocation.data?.id === allocationId &&
    allocation.data.representation === "alpha_streams" && allocation.data.status === "SOLVED" &&
    eligiblePrepared.some(p => p.preparedInputId === Number(preparedId)) &&
    alphaIds.length > 0 && alphaIds.length <= 5 && alphaIds.every(id => candidates.includes(id)) &&
    validIsoDate(startDate) && validIsoDate(endDate) && startDate <= endDate &&
    (!c1Id || matchingC1.some(item => item.id === Number(c1Id))) && templateReady && settingsValid && mappingValid;
  const input: C2ExperimentInput & { assumptions?: B3ValidationAssumptions } | null = selectionValid ? {
    allocationId, validationPreparedInputId: Number(preparedId), c1ExperimentId: c1Id ? Number(c1Id) : null,
    alphaIds, startDate, endDate, regimeSource: "frozen_b1_prefix", ...settings,
    ...(mappingValue ? { regimeMapping: mappingValue } : {}),
    ...(declaredAssumptions ? { assumptions: declaredAssumptions } : {}),
  } : null;
  const inputKey = input ? JSON.stringify(input) : null;
  const latestInputKey = useRef(inputKey);
  latestInputKey.current = inputKey;
  useEffect(() => {
    if (!inputKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void planRequest.current({ data: JSON.parse(inputKey) as C2ExperimentInput })
        .then(data => { if (active) setPlanned({ key: inputKey, data }); })
        .catch(error => { if (active) setPlanned({ key: inputKey, error: failure(error) }); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inputKey]);
  const currentPlan = planned?.key === inputKey ? planned : null;
  const planReady = !!input && !!currentPlan?.data &&
    currentPlan.data.dependencies.length === alphaIds.length &&
    currentPlan.data.dependencies.every(dependency => alphaIds.includes(dependency.alphaId) &&
      (dependency.status === "REUSE" || dependency.status === "WILL_CREATE"));
  const result = row(detail.data?.result);
  const manifest = row(detail.data?.manifest);
  const savedInput = row(manifest.input);
  const savedTemplate = row(row(manifest.sourceIdentities).c1Template);
  const savedAssumptions = row(savedInput.assumptions);
  const savedSources = row(manifest.sources);
  const frozenDependencies = rows(savedSources.dependencyPlan);
  const savedPolicyCandidates = row(savedSources.policy).candidates;
  const config = row(result.configuration);
  const stability = row(result.stability), regimes = row(result.regimes), dependence = row(result.dependence), incremental = row(result.incrementalContribution);
  const stabilityAlphas = rows(stability.alphas), pairs = rows(dependence.pairs);
  const period = `${text(config.startDate)} → ${text(config.endDate)}`;
  const views = ["Stability", "Regime", "Dependence", "Incremental Contribution"];

  async function run() {
    setMessage(null);
    if (!planReady || !input || !inputKey) return setMessage("Review a current, available C1 dependency plan before running diagnostics.");
    setCheckingRun(true);
    try {
      // Recheck just before execution: planning is read-only, and another client may change the available dependencies.
      const checked = await planRequest.current({ data: input });
      if (latestInputKey.current !== inputKey) return;
      if (checked.dependencies.length !== alphaIds.length ||
          checked.dependencies.some(d => d.status === "UNAVAILABLE" || !alphaIds.includes(d.alphaId))) {
        setPlanned({ key: inputKey, data: checked });
        return setMessage("A C1 dependency is unavailable. Review the updated plan before running.");
      }
      const created = await create.mutateAsync({ data: input });
      await saved.refetch();
      setSelectedId(created.id); setReplayResult(null); setView("Stability");
    } catch (error) { setMessage(failure(error)); }
    finally { setCheckingRun(false); }
  }
  async function replaySaved() {
    if (!selectedId) return;
    setMessage(null); setReplayResult(null);
    try { setReplayResult(await replay.mutateAsync({ experimentId: selectedId })); }
    catch (error) { setMessage(failure(error)); }
  }
  const retry = () => { setMessage(null); setPlanned(null); void allocations.refetch(); if (allocationId) void allocation.refetch(); void prepared.refetch(); void c1.refetch(); void saved.refetch(); if (selectedId) void detail.refetch(); };

  return <Card className="border-primary/20" data-testid="card-c2-diagnostics">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Alpha Diagnostics</CardTitle>
      <CardDescription className="mt-1 max-w-2xl">Point-in-time evidence for frozen alpha streams. Inspect stability, conditional behavior and policy effects without automatic candidate selection.</CardDescription></div>
      <Badge variant="outline">C2 · Research evidence</Badge></div></CardHeader>
    <CardContent className="space-y-6">
      {(message || allocations.isError || allocation.isError || prepared.isError || c1.isError || selectedC1.isError || saved.isError || detail.isError) && <Alert variant="destructive" role="alert" data-testid="status-c2-error"><AlertCircle className="h-4 w-4" /><AlertDescription>{message ?? failure(allocations.error ?? allocation.error ?? prepared.error ?? c1.error ?? selectedC1.error ?? saved.error ?? detail.error)} <Button variant="outline" size="sm" className="ml-2" onClick={retry} data-testid="button-c2-retry">Retry loading</Button></AlertDescription></Alert>}
      <section className="space-y-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">01 / Declare frozen evidence</h3>
        {(allocations.isLoading || prepared.isLoading || c1.isLoading) && <div className="h-24 animate-pulse rounded-md bg-muted/60" aria-label="Loading frozen inputs" />}
        {!allocations.isLoading && !eligible.length && <Empty>No saved solved B2 alpha-stream allocation is available. Creation is blocked, but saved diagnostics remain accessible below.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="c2-allocation">Solved B2 alpha-stream allocation</Label><select id="c2-allocation" className={field} value={allocationId ?? ""} onChange={e => { setAllocationId(e.target.value ? Number(e.target.value) : null); setAlphaIds([]); setC1Id(""); }} data-testid="select-c2-allocation"><option value="">Select explicitly</option>{eligible.map(a => <option value={a.id} key={a.id}>#{a.id} · B1 #{a.preparedInputId} · {a.createdAt}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c2-prepared">Frozen B1 validation preparation</Label><select id="c2-prepared" className={field} value={preparedId} onChange={e => { setPreparedId(e.target.value); setC1Id(""); }} data-testid="select-c2-prepared"><option value="">Select explicitly</option>{eligiblePrepared.map(p => <option value={p.preparedInputId} key={p.preparedInputId}>#{p.preparedInputId} · {p.createdAt}</option>)}</select>{!prepared.isLoading && !eligiblePrepared.length && <p className="text-xs text-amber-800">No frozen alpha-stream B1 evaluation input is available.</p>}</div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="c2-c1">C1 assumption template (optional)</Label><select id="c2-c1" className={field} value={c1Id} onChange={e => setC1Id(e.target.value)} data-testid="select-c2-c1"><option value="">No explicit template · resolve matching frozen B3 assumptions or report unavailable</option>{matchingC1.map(x => <option value={x.id} key={x.id}>#{x.id} · {x.mode} · {x.createdAt}</option>)}</select><p className="text-xs text-muted-foreground">Selecting a C1 uses that record’s frozen B3 policy assumptions with the dates below. It does not require that record to contain every selected exclusion. Without a selection, no assumptions are sent by the UI.</p></div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="status-c2-source">B2 #{allocationId ?? "not selected"} · policy B1 #{text(allocation.data?.preparedInputId)} · {text(allocation.data?.status)} · {candidates.length} frozen policy candidates. Validation B1 must contain compatible canonical candidates; compatibility is verified at run time.</div>
        <fieldset className="rounded-md border p-3"><legend className="px-1 text-xs font-medium">Canonical alpha IDs · select 1–5</legend><div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{candidates.map((id, i) => <label key={id} className="flex min-w-0 items-start gap-2 text-xs"><input type="checkbox" checked={alphaIds.includes(id)} disabled={!alphaIds.includes(id) && alphaIds.length >= 5} onChange={e => setAlphaIds(old => e.target.checked ? [...old, id] : old.filter(x => x !== id))} data-testid={`checkbox-c2-alpha-${i}`} /><span className="break-all font-mono">{id}</span></label>)}</div>{!candidates.length && <p className="text-xs text-muted-foreground">Choose a B2 allocation to inspect its immutable candidate IDs.</p>}<p className="mt-2 text-xs text-muted-foreground">{alphaIds.length} of 5 selected · no ranking or automatic selection.</p></fieldset>
      </section>
      <section className="space-y-4 border-t pt-5"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">02 / Declare period &amp; method</h3>
        <p className="text-xs text-muted-foreground">Regimes use strictly prior frozen B1 observations. For fixture B2 #3 / B1 #5 / C1 #7, try 2009-03-01 through 2009-05-29 with rolling and contribution windows of 42, steps of 10.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-1"><Label htmlFor="c2-start">Start date</Label><Input id="c2-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-c2-start" /></div><div className="space-y-1"><Label htmlFor="c2-end">End date</Label><Input id="c2-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-c2-end" /></div>
          {(Object.keys(settings) as (keyof typeof settings)[]).map(key => <div className="space-y-1" key={key}><Label htmlFor={`c2-${key}`}>{({ rollingWindow: "Rolling window · observations", rollingStep: "Rolling step · observations", contributionWindow: "Contribution window · observations", contributionStep: "Contribution step · observations", minRollingPaired: "Min rolling paired", minRegimePaired: "Min regime paired", minSharpeObservations: "Min Sharpe observations", highCorrelationThreshold: "High correlation threshold", materialCorrelationGap: "Material correlation gap" })[key]}</Label><Input id={`c2-${key}`} type="number" min={key.includes("Threshold") ? -1 : key.includes("Gap") ? 0 : key.includes("Step") ? 1 : 2} max={key.includes("Threshold") ? 1 : key.includes("Gap") ? 2 : undefined} step={key.includes("Threshold") || key.includes("Gap") ? "0.01" : "1"} value={settings[key]} onChange={e => setSettings(old => ({ ...old, [key]: Number(e.target.value) }))} data-testid={`input-c2-${key}`} /></div>)}
        </div>
        <div className="max-w-xl space-y-1"><Label htmlFor="c2-mapping">Regime label mapping · optional JSON object</Label><Input id="c2-mapping" value={mapping} onChange={e => setMapping(e.target.value)} placeholder='{"Risk On":"Expansion"}' data-testid="input-c2-mapping" /><p className="text-xs text-muted-foreground">Omit to retain detailed frozen-prefix regime labels. Mapping changes labels, not underlying observations.</p></div>
        <div className="rounded-md border border-primary/20 bg-muted/20 p-3 sm:p-4" aria-live="polite" data-testid="status-c2-dependency-plan">
          <h4 className="text-xs font-semibold uppercase tracking-wider">C1 Dependencies</h4>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="status-c2-assumptions-provenance">
            {c1Id ? selectedC1.isLoading || selectedC1.isFetching
              ? `Loading frozen assumptions from explicitly selected C1 #${c1Id}…`
              : templateReady && declaredAssumptions
                ? `Explicit assumption template: C1 #${c1Id} · ${startDate || "start date"} → ${endDate || "end date"} · costs ${text(declaredAssumptions.transactionCostBps)} bps · slippage ${text(declaredAssumptions.slippageBps)} bps · ${text(declaredAssumptions.decisionCalendar)} / ${text(declaredAssumptions.executionTiming)}.`
                : `C1 #${c1Id} frozen assumptions unavailable or incompatible. Planning and Run are blocked.`
              : "No explicit assumption template: no B3 assumptions sent. The server must resolve matching frozen assumptions or report unavailable; it must not silently use a different C1 as the intended template."}
          </p>
          {!input ? <p className="mt-2 text-xs text-muted-foreground">Complete valid frozen sources, alpha selection, dates and method to preview required comparisons.</p>
            : !currentPlan ? <div className="mt-3 space-y-2" aria-label="Planning C1 dependencies"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /></div>
            : currentPlan.error ? <p className="mt-2 text-xs text-amber-800" role="alert">Plan unavailable: {currentPlan.error}. Check frozen inputs or change the assumption template.</p>
            : currentPlan.data && <><p className="mt-2 text-xs font-medium tabular-nums" data-testid="status-c2-dependency-totals">Reused: {currentPlan.data.reusedCount} · To create: {currentPlan.data.toCreateCount} · Unavailable: {currentPlan.data.unavailableCount}</p>
              <p className="mt-1 text-xs text-muted-foreground" data-testid="status-c2-dependency-policies">{currentPlan.data.newPolicyCount} new C1 policies · {currentPlan.data.estimatedTotalChildPolicies} estimated total child policies</p>
              <ul className="mt-3 divide-y border-t text-xs">{currentPlan.data.dependencies.map((dependency, index) => <li key={dependency.alphaId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2" data-testid={`status-c2-dependency-${index}`}>
                <span className="min-w-0"><strong>{canonicalName(policyCandidates, dependency.alphaId) ?? "Alpha"}</strong><span className="ml-2 break-all font-mono text-[11px] text-muted-foreground">{dependency.alphaId}</span></span>
                <span className={dependency.status === "UNAVAILABLE" ? "text-amber-800" : "text-foreground"}>{dependency.status === "REUSE" ? `REUSE C1 #${dependency.c1ExperimentId}` : dependency.status === "WILL_CREATE" ? "WILL CREATE" : "UNAVAILABLE"}{dependency.reason && <span className="block max-w-sm break-words text-muted-foreground">{dependency.reason}</span>}</span>
              </li>)}</ul>
              {currentPlan.data.unavailableCount > 0 && <p className="mt-2 text-xs text-amber-800">Resolve unavailable dependencies before running; no comparison is executed by this preview.</p>}
            </>}
        </div>
        <Button onClick={() => void run()} disabled={!planReady || checkingRun || create.isPending} data-testid="button-c2-run"><Activity className="mr-2 h-4 w-4" />{checkingRun ? "Checking dependencies…" : create.isPending ? "Running diagnostics…" : "Run Alpha Diagnostics"}</Button>
      </section>
      <section className="space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">03 / Saved experiments</h3><Button size="sm" variant="outline" onClick={() => void saved.refetch()} disabled={saved.isFetching} data-testid="button-c2-refresh"><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh saved</Button></div>
        {saved.isLoading && <div className="h-12 animate-pulse rounded bg-muted/60" aria-label="Loading saved diagnostics" />}
        <div className="max-w-xl space-y-1"><Label htmlFor="c2-saved">Inspect saved diagnostics</Label><select id="c2-saved" className={field} value={selectedId ?? ""} onChange={e => { setSelectedId(e.target.value ? Number(e.target.value) : null); setReplayResult(null); }} data-testid="select-c2-saved"><option value="">Select saved experiment</option>{(saved.data ?? []).map(x => <option key={x.id} value={x.id}>#{x.id} · B2 #{x.allocationId} · B1 #{x.validationPreparedInputId} · {x.createdAt}</option>)}</select></div>
        {!saved.isLoading && !saved.data?.length && <Empty>No saved C2 diagnostics yet. Selecting and reading a saved record never recomputes it.</Empty>}
      </section>
      {selectedId && (detail.isLoading ? <div className="h-64 animate-pulse rounded bg-muted/60" aria-label="Loading saved experiment" /> : detail.data ? <section className="space-y-5 border-t pt-6" data-testid="status-c2-detail">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Experiment #{detail.data.id} <Badge variant="outline" className="ml-1">{text(result.engineVersion)}</Badge></h3><p className="mt-1 text-xs text-muted-foreground">B2 #{detail.data.allocationId} · B1 #{detail.data.validationPreparedInputId} · C1 #{detail.data.c1ExperimentId ?? "none"} · {period}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Manifest {detail.data.manifestHash} · result {detail.data.resultHash}</p></div><Button size="sm" variant="outline" onClick={() => void replaySaved()} disabled={replay.isPending} data-testid="button-c2-replay"><RotateCcw className="mr-1 h-3.5 w-3.5" />{replay.isPending ? "Verifying…" : "Replay frozen experiment"}</Button></div>
         {frozenDependencies.length > 0 && <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="status-c2-frozen-dependencies">
           <h4 className="font-semibold">Frozen C1 dependency plan</h4>
           <p className="mt-1 text-muted-foreground">Saved with this experiment; working settings cannot change these references.</p>
           <p className="mt-1 text-muted-foreground" data-testid="status-c2-saved-assumptions-provenance">
             {savedInput.assumptions ? `Explicit policy assumptions frozen in this C2 manifest${savedInput.c1ExperimentId != null ? ` · PM-selected C1 #${text(savedInput.c1ExperimentId)}` : ""}${savedTemplate.id != null ? ` · resolved template C1 #${text(savedTemplate.id)}` : ""} · ${text(savedAssumptions.evaluationStartDate)} → ${text(savedAssumptions.evaluationEndDate)} · costs ${text(savedAssumptions.transactionCostBps)} bps · slippage ${text(savedAssumptions.slippageBps)} bps` : `No explicit B3 assumptions in this C2 input${savedTemplate.id != null ? ` · resolved template C1 #${text(savedTemplate.id)}` : ""}. Inspect frozen source identities and dependency references below.`}
           </p>
           <ul className="mt-2 divide-y">{frozenDependencies.map((dependency, i) => <li key={`${text(dependency.alphaId)}-${i}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2" data-testid={`status-c2-frozen-dependency-${i}`}>
             <span><strong>{canonicalName(savedPolicyCandidates, String(dependency.alphaId)) ?? "Alpha"}</strong><span className="ml-2 break-all font-mono text-[11px]">{text(dependency.alphaId)}</span></span>
             <span className={dependency.status === "UNAVAILABLE" ? "text-amber-800" : "text-muted-foreground"}>{dependency.status === "REUSED" ? `Existing comparison reused · C1 #${text(dependency.c1ExperimentId)}` : dependency.status === "CREATED" ? `New comparison generated for this diagnostic · C1 #${text(dependency.c1ExperimentId)}` : "UNAVAILABLE · C1 dependency failed"}
               {dependency.reason != null && <span className="block max-w-md break-words">{text(dependency.reason)}</span>}
             </span>
           </li>)}</ul>
         </div>}
        {replayResult && <div className={`rounded-md border p-3 text-xs ${replayResult.status === "pass" ? "border-emerald-300 bg-emerald-50/50" : "border-amber-300 bg-amber-50/50"}`} role="status" data-testid="status-c2-replay"><strong>Replay {replayResult.status.toUpperCase()}</strong> · maximum numeric difference <Value value={replayResult.maximumNumericDifference} /> · {replayResult.differences.length} differences{replayResult.differences.length > 0 && <ul className="mt-2 list-inside list-disc break-all">{replayResult.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>}</div>}
        <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist" aria-label="Alpha diagnostics views">{views.map(name => <button type="button" role="tab" aria-selected={view === name} key={name} onClick={() => setView(name)} className={`rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${view === name ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`tab-c2-${name.toLowerCase().replaceAll(" ", "-")}`}>{name}</button>)}</div>
        <div role="tabpanel" className="space-y-6">
          {view === "Stability" && <Section title="Rolling alpha-stream stability" note={`${text(stability.methodology)} · ${period} · ${text(config.rollingWindow)} observation windows / ${text(config.rollingStep)} step. Net and gross returns are compounded window decimals; volatility annualized; notional uses native B1 ledger units.`}>
            {!stabilityAlphas.length ? <Empty>No stability series was saved for this experiment.</Empty> : stabilityAlphas.map((alpha, i) => { const rolling = rows(alpha.rolling); const summary = row(alpha.summary); return <div key={i} className="space-y-3 rounded-md border p-3" data-testid={`status-c2-stability-${i}`}><div><h5 className="text-sm font-semibold">{text(alpha.name)}</h5><p className="break-all font-mono text-[11px] text-muted-foreground">{text(alpha.alphaId)} · {text(alpha.rollingStatus)} · daily cash yield <Value value={alpha.dailyCashYield} /></p></div>
              <SeriesChart title="Compounded return / annualized volatility" data={rolling} keys={[{ key: "netReturn", label: "Net return" }, { key: "annualizedVolatility", label: "Volatility" }, { key: "grossReturn", label: "Gross return" }]} unit="decimal" note={`${rolling.filter(w => w.status === "AVAILABLE").length}/${rolling.length} available · ${text(alpha.methodology)}`} />
              <MetricTable label="Window dates · observations below" data={rolling.map(w => ({ ...w, label: `${text(w.startDate)} → ${text(w.endDate)} · n=${text(w.observations)}/${text(w.requestedWindowObservations)}` }))} fields={["netReturn", "annualizedVolatility", "sharpe", "hitRate", "tradedNotional", "averageRiskyExposure", "drawdownFromAlphaStreamNav"]} />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(summary).map(([key, raw]) => { const s = row(raw); return <div key={key} className="rounded border bg-muted/20 p-2 text-xs"><strong>{names[key] ?? key}</strong><p>Median <Value value={s.median} unit={unitFor(key)} /> · IQR {Array.isArray(s.interquartileRange) ? s.interquartileRange.map(v => fmt(v, unitFor(key))).join(" – ") : "Unavailable"}</p><p className="text-muted-foreground">Min <Value value={s.minimum} unit={unitFor(key)} /> · Max <Value value={s.maximum} unit={unitFor(key)} /> · {text(s.validWindows)} valid windows</p></div>; })}</div>
            </div>; })}
          </Section>}
          {view === "Regime" && <Section title="Conditional regimes" note={`${text(regimes.source)} · ${text(regimes.version)} · ${period}. ${text(row(result.methodology).undefinedMetrics)} Daily returns are decimal, volatility annualized; episodes preserve contiguous dates.`}>
            {regimes.status !== "AVAILABLE" && <Empty>Regime analysis unavailable: frozen B1 prefix labels or sufficient prior history were not available.</Empty>}
            <p className="text-xs text-muted-foreground" data-testid="status-c2-regime-coverage">{rows(regimes.series).filter(r => r.status === "AVAILABLE").length} labeled of {rows(regimes.series).length} saved dates · {text(regimes.status)}</p>
            {rows(regimes.conditionalPerformance).map((alpha, i) => <div key={i} className="space-y-3 rounded-md border p-3" data-testid={`status-c2-regime-${i}`}><h5 className="break-all text-xs font-semibold">Alpha {text(alpha.alphaId)}</h5><p className="text-xs text-muted-foreground">{text(alpha.methodology)}</p>
              <MetricTable label="Regime · observations" data={Object.entries(row(alpha.regimes)).map(([name, raw]) => ({ ...row(raw), label: `${name} · n=${text(row(raw).observations)}` }))} fields={["mean", "meanDailyExcessReturn", "volatility", "sharpe", "hitRate", "averageRiskyExposure", "averageTurnoverOrTradedNotional", "averageDailyCost"]} />
              <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[500px] text-left text-xs"><thead className="bg-muted/50"><tr><th className="px-3 py-2">Contiguous episode</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Observations</th><th className="px-3 py-2">Cumulative return</th></tr></thead><tbody>{Object.entries(row(alpha.episodes)).flatMap(([label, value]) => rows(value).map((episode, j) => <tr key={`${label}-${j}`} className="border-t"><th className="px-3 py-2">{label}</th><td className="px-3 py-2">{text(episode.startDate)} → {text(episode.endDate)}</td><td className="px-3 py-2">{text(episode.observations)}</td><td className="px-3 py-2"><Value value={episode.cumulativeReturn} unit="percent" /></td></tr>))}</tbody></table></div>
            </div>)}
            <h5 className="text-xs font-semibold">C1 conditional full minus exclusion</h5>{rows(incremental.conditional).length ? <MetricTable label="Candidate / regime / shared dates" data={rows(incremental.conditional).map(r => ({ ...row(r.deltas), label: `${text(r.alphaId)} / ${text(r.regime)} · n=${text(r.observations)}`, status: r.status }))} fields={["meanReturn", "volatility", "sharpe", "cost"]} /> : <Empty>No matching saved C1 exclusions. Conditional policy contributions are unavailable; B1 regime analysis remains inspectable.</Empty>}
            {rows(incremental.conditional).map((r, i) => <div key={i} className="rounded border bg-muted/20 p-3 text-xs" data-testid={`status-c2-conditional-${i}`}><strong>{text(r.alphaId)} · {text(r.regime)} · {text(r.status)}</strong><p>Shared B3 ledger dates: {text(r.observations)} · full mean <Value value={row(r.full).mean} unit="percent" /> · without mean <Value value={row(r.without).mean} unit="percent" /></p><p>Mean alpha-capital / final-asset distance across {rows(r.allocationDistances).length} matched decisions: <Value value={meanOf(rows(r.allocationDistances), "alphaCapitalDistance")} /> / <Value value={meanOf(rows(r.allocationDistances), "underlyingAssetDistance")} /> · half-L1 weights</p></div>)}
          </Section>}
          {view === "Dependence" && <Section title="Pairwise dependence" note={`${text(dependence.method)} · ${period}. Correlations are Pearson on aligned B1 daily returns (dimensionless); distance uses half-L1 normalized underlying exposure, not a selection signal.`}>
            {pairs.length ? <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-muted/50"><tr><th className="px-3 py-2">Full-sample matrix</th>{stabilityAlphas.map((a, i) => <th key={i} className="max-w-32 break-all px-3 py-2 font-mono">{text(a.alphaId)}</th>)}</tr></thead><tbody>{stabilityAlphas.map((a, i) => <tr key={i} className="border-t"><th className="max-w-32 break-all px-3 py-2 font-mono">{text(a.alphaId)}</th>{stabilityAlphas.map((b, j) => { const pair = pairs.find(p => (p.alphaA === a.alphaId && p.alphaB === b.alphaId) || (p.alphaB === a.alphaId && p.alphaA === b.alphaId)); const sample = row(pair?.fullSample); return <td className="px-3 py-2" key={j} title={i === j ? "Identity" : `n=${text(sample.pairedObservations)} · ${text(sample.startDate)} → ${text(sample.endDate)}`}>{i === j ? "1.000" : <><Value value={sample.correlation} reason="Insufficient paired observations or undefined variance" /><span className="block text-[10px] text-muted-foreground">n={text(sample.pairedObservations)}</span></>}</td>; })}</tr>)}</tbody></table></div> : <Empty>Choose at least two alphas in a new experiment to produce pairwise dependence. This saved record has no pairs.</Empty>}
            {pairs.map((p, i) => { const rolling = row(p.rollingCorrelation); const series = rows(rolling.series); const exposure = rows(p.exposureDistance); return <div key={i} className="space-y-3 rounded-md border p-3" data-testid={`status-c2-pair-${i}`}><div className="flex flex-wrap items-center justify-between gap-2"><h5 className="break-all text-xs font-semibold">{text(p.alphaA)} / {text(p.alphaB)}</h5><Badge variant="outline">{text(p.flag)}</Badge></div><p className="text-xs text-muted-foreground">{text(p.flagNote)} · {text(p.flagVersion)} · paired n={text(row(p.fullSample).pairedObservations)} · {text(row(p.fullSample).startDate)} → {text(row(p.fullSample).endDate)}</p>
              <SeriesChart title="Rolling pair correlation" data={series} keys={[{ key: "value", label: "Pearson r" }]} unit="dimensionless" note={`${text(rolling.pairedObservations)} total paired observations · ${text(config.rollingWindow)} observation window / ${text(config.rollingStep)} step`} />
              <MetricTable label="Window · paired n" data={series.map(s => ({ ...s, label: `${text(s.startDate)} → ${text(s.endDate)} · n=${text(s.observations)}` }))} fields={["value"]} />
              <div className="grid gap-3 lg:grid-cols-2"><div><h6 className="mb-2 text-xs font-medium">Correlation by regime · minimum {text(config.minRegimePaired)} paired</h6><MetricTable label="Regime / n" data={rows(p.regimeCorrelation).map(r => ({ ...r, label: `${text(r.regime)} · n=${text(r.pairedObservations)}`, reason: r.status }))} fields={["correlation", "meanReturnA", "meanReturnB", "volatilityA", "volatilityB"]} /></div><div><h6 className="mb-2 text-xs font-medium">Underlying exposure similarity by regime · weight similarity</h6><MetricTable label="Regime / n" data={rows(p.exposureSimilarityByRegime).map(r => ({ ...r, label: `${text(r.regime)} · n=${text(r.observations)}`, reason: r.status }))} fields={["meanSimilarity"]} /></div></div>
              <p className="text-xs text-muted-foreground">{exposure.length} matched exposure dates · mean half-L1 distance <Value value={meanOf(exposure, "distance")} /> · {rows(p.optimizedCapitalWeights).length} C1 optimized-weight decision dates</p>
            </div>; })}
          </Section>}
          {view === "Incremental Contribution" && <Section title="Rolling full minus exclusion" note={`${text(incremental.methodology)} · ${period}. ${text(row(incremental.rollingConfiguration).windowObservations)} observation windows / ${text(row(incremental.rollingConfiguration).stepObservations)} step. Return/volatility/drawdown deltas are decimal; Sharpe ratio; costs B3 native currency. No causal attribution.`}>
             {frozenDependencies.length > 0 && <p className="text-xs text-muted-foreground">Exact C1 IDs, reuse or creation source, and any dated failures are recorded in the frozen dependency plan above.</p>}
            <p className="text-xs text-muted-foreground">{text(incremental.rollingStatus)} · {rows(row(incremental.rollingConfiguration).predeclaredWindows).length} predeclared windows · {rows(incremental.rolling).length} saved candidate-windows. Missing C1 exclusions remain unavailable, never filled with estimated results.</p>
             {rows(incremental.rolling).length ? [...new Set(rows(incremental.rolling).map(r => String(r.alphaId)))].map((id, i) => { const series = rows(incremental.rolling).filter(r => r.alphaId === id); const dependency = frozenDependencies.find(d => d.alphaId === id); return <div key={id} className="space-y-3 rounded-md border p-3" data-testid={`status-c2-incremental-${i}`}><h5 className="break-all font-mono text-xs font-semibold">{id}</h5>
               {dependency && <p className={`text-xs ${dependency.status === "UNAVAILABLE" ? "text-amber-800" : "text-muted-foreground"}`} data-testid={`status-c2-incremental-source-${i}`}>{dependency.status === "REUSED" ? `Existing comparison reused · C1 #${text(dependency.c1ExperimentId)}` : dependency.status === "CREATED" ? `New comparison generated for this diagnostic · C1 #${text(dependency.c1ExperimentId)}` : `C1 dependency unavailable${dependency.c1ExperimentId != null ? ` · C1 #${text(dependency.c1ExperimentId)}` : ""}`}{dependency.reason != null && <span className="block break-words">{text(dependency.reason)}</span>}</p>}
              <SeriesChart title="Rolling C1 policy deltas" data={series.map(s => ({ ...row(s.metrics), startDate: s.startDate, endDate: s.endDate }))} keys={[{ key: "netReturnDelta", label: "Net return Δ" }, { key: "volatilityDelta", label: "Volatility Δ" }, { key: "drawdownDelta", label: "Drawdown Δ" }]} unit="decimal full − exclusion" note={`${series.filter(s => s.status === "AVAILABLE").length}/${series.length} available · independent full/exclusion B3 reruns`} />
              <MetricTable label="Window / matched decisions" data={series.map(s => ({ ...row(s.metrics), label: `${text(s.startDate)} → ${text(s.endDate)} · ${rows(s.allocationDistances).length} decisions`, status: s.status, reason: s.reason }))} fields={["netReturnDelta", "sharpeDelta", "volatilityDelta", "drawdownDelta", "costDelta"]} />
              <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[500px] text-left text-xs"><thead className="bg-muted/50"><tr><th className="px-3 py-2">Window / decision date</th><th className="px-3 py-2">Alpha capital + master cash · half-L1</th><th className="px-3 py-2">Final assets + total cash · half-L1</th></tr></thead><tbody>{series.flatMap((s, j) => rows(s.allocationDistances).map((d, k) => <tr key={`${j}-${k}`} className="border-t"><td className="px-3 py-2">{text(s.startDate)} → {text(s.endDate)} / {text(d.date)}</td><td className="px-3 py-2"><Value value={d.alphaCapitalDistance} /></td><td className="px-3 py-2"><Value value={d.underlyingAssetDistance} /></td></tr>))}</tbody></table>{!series.some(s => rows(s.allocationDistances).length) && <p className="p-3 text-xs text-amber-800">No matched decision weights; distances are unavailable.</p>}</div>
             </div>; }) : <Empty>No rolling C1 deltas were saved. Inspect the frozen dependency plan for unavailable comparisons and exact failure reasons.</Empty>}
          </Section>}
        </div>
        <details className="text-xs"><summary className="cursor-pointer font-medium" data-testid="button-c2-methodology">Audit methodology, source identity &amp; frozen manifest</summary><div className="mt-2 space-y-2 rounded border bg-muted/20 p-3"><p>{text(row(result.methodology).selection)}</p><p>Undefined metrics: {text(row(result.methodology).undefinedMetrics)}</p><p>Numeric tolerance: {text(row(result.methodology).numericTolerance)}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ source: result.source, thresholds: result.thresholds, configuration: result.configuration, manifest: detail.data.manifest }, null, 2)}</pre></div></details>
      </section> : !detail.isError && <Empty>Saved experiment detail is unavailable. Retry loading to inspect the record.</Empty>)}
    </CardContent>
  </Card>;
}