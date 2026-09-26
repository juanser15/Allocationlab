import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getGetAllocationQueryKey, getGetAlphaDiagnosticExperimentQueryKey,
  useCreateAlphaDiagnosticExperiment, useGetAllocation, useGetAlphaDiagnosticExperiment,
  useListAllocations, useListPreparedInputs, useListAlphaContributionExperiments,
  useListAlphaDiagnosticExperiments, useReplayAlphaDiagnosticExperiment,
  type C2ExperimentInput,
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
  const [replayResult, setReplayResult] = useState<Awaited<ReturnType<ReturnType<typeof useReplayAlphaDiagnosticExperiment>["mutateAsync"]>> | null>(null);

  const allocations = useListAllocations();
  const allocation = useGetAllocation(allocationId ?? 0, { query: { enabled: !!allocationId, queryKey: getGetAllocationQueryKey(allocationId ?? 0) } });
  const prepared = useListPreparedInputs();
  const c1 = useListAlphaContributionExperiments();
  const saved = useListAlphaDiagnosticExperiments();
  const detail = useGetAlphaDiagnosticExperiment(selectedId ?? 0, { query: { enabled: !!selectedId, queryKey: getGetAlphaDiagnosticExperimentQueryKey(selectedId ?? 0) } });
  const create = useCreateAlphaDiagnosticExperiment();
  const replay = useReplayAlphaDiagnosticExperiment();
  const eligible = (allocations.data ?? []).filter(a => a.representation === "alpha_streams" && a.status === "SOLVED");
  const eligiblePrepared = (prepared.data ?? []).filter(p => p.representation === "alpha_streams" && p.status === "READY");
  const matchingC1 = (c1.data ?? []).filter(x => x.allocationId === allocationId && x.validationPreparedInputId === Number(preparedId) && x.status === "completed");
  const candidates = allocation.data?.request.candidateIds ?? [];
  const result = row(detail.data?.result);
  const config = row(result.configuration);
  const stability = row(result.stability), regimes = row(result.regimes), dependence = row(result.dependence), incremental = row(result.incrementalContribution);
  const stabilityAlphas = rows(stability.alphas), pairs = rows(dependence.pairs);
  const period = `${text(config.startDate)} → ${text(config.endDate)}`;
  const views = ["Stability", "Regime", "Dependence", "Incremental Contribution"];

  async function run() {
    setMessage(null);
    if (!allocationId || allocation.data?.representation !== "alpha_streams" || allocation.data.status !== "SOLVED") return setMessage("Select a saved solved alpha-stream B2 allocation.");
    if (!preparedId || !eligiblePrepared.some(p => p.preparedInputId === Number(preparedId))) return setMessage("Select a frozen alpha-stream B1 validation preparation.");
    if (!alphaIds.length || alphaIds.length > 5 || alphaIds.some(id => !candidates.includes(id))) return setMessage("Choose one to five canonical candidates from the selected B2 allocation.");
    if (!startDate || !endDate || startDate > endDate) return setMessage("Enter a valid inclusive start and end date.");
    if (c1Id && !matchingC1.some(item => item.id === Number(c1Id))) return setMessage("Choose a C1 comparison matching the selected B2 and validation B1 inputs.");
    const integerKeys = ["rollingWindow", "rollingStep", "contributionWindow", "contributionStep", "minRollingPaired", "minRegimePaired", "minSharpeObservations"] as const;
    if (integerKeys.some(key => !Number.isInteger(settings[key]) || settings[key] < (key.endsWith("Window") || key.startsWith("min") ? 2 : 1)) ||
      settings.highCorrelationThreshold < -1 || settings.highCorrelationThreshold > 1 || settings.materialCorrelationGap < 0 || settings.materialCorrelationGap > 2 ||
      !Number.isFinite(settings.highCorrelationThreshold) || !Number.isFinite(settings.materialCorrelationGap))
      return setMessage("Window and minimum counts must be positive integers (windows and minimums at least 2); correlation threshold must be −1 to 1 and gap 0 to 2.");
    let regimeMapping: Record<string, string> | undefined;
    if (mapping.trim()) {
      try {
        const parsed: unknown = JSON.parse(mapping);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some(v => typeof v !== "string")) throw new Error();
        regimeMapping = parsed as Record<string, string>;
      } catch { return setMessage("Regime mapping must be a JSON object of detailed labels to display labels."); }
    }
    const input: C2ExperimentInput = { allocationId, validationPreparedInputId: Number(preparedId), c1ExperimentId: c1Id ? Number(c1Id) : null,
      alphaIds, startDate, endDate, regimeSource: "frozen_b1_prefix", ...settings, ...(regimeMapping ? { regimeMapping } : {}) };
    try {
      const created = await create.mutateAsync({ data: input });
      await saved.refetch();
      setSelectedId(created.id); setReplayResult(null); setView("Stability");
    } catch (error) { setMessage(failure(error)); }
  }
  async function replaySaved() {
    if (!selectedId) return;
    setMessage(null); setReplayResult(null);
    try { setReplayResult(await replay.mutateAsync({ experimentId: selectedId })); }
    catch (error) { setMessage(failure(error)); }
  }
  const retry = () => { setMessage(null); void allocations.refetch(); if (allocationId) void allocation.refetch(); void prepared.refetch(); void c1.refetch(); void saved.refetch(); if (selectedId) void detail.refetch(); };

  return <Card className="border-primary/20" data-testid="card-c2-diagnostics">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Alpha Diagnostics</CardTitle>
      <CardDescription className="mt-1 max-w-2xl">Point-in-time evidence for frozen alpha streams. Inspect stability, conditional behavior and policy effects without automatic candidate selection.</CardDescription></div>
      <Badge variant="outline">C2 · Research evidence</Badge></div></CardHeader>
    <CardContent className="space-y-6">
      {(message || allocations.isError || allocation.isError || prepared.isError || c1.isError || saved.isError || detail.isError) && <Alert variant="destructive" role="alert" data-testid="status-c2-error"><AlertCircle className="h-4 w-4" /><AlertDescription>{message ?? failure(allocations.error ?? allocation.error ?? prepared.error ?? c1.error ?? saved.error ?? detail.error)} <Button variant="outline" size="sm" className="ml-2" onClick={retry} data-testid="button-c2-retry">Retry loading</Button></AlertDescription></Alert>}
      <section className="space-y-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">01 / Declare frozen evidence</h3>
        {(allocations.isLoading || prepared.isLoading || c1.isLoading) && <div className="h-24 animate-pulse rounded-md bg-muted/60" aria-label="Loading frozen inputs" />}
        {!allocations.isLoading && !eligible.length && <Empty>No saved solved B2 alpha-stream allocation is available. Creation is blocked, but saved diagnostics remain accessible below.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="c2-allocation">Solved B2 alpha-stream allocation</Label><select id="c2-allocation" className={field} value={allocationId ?? ""} onChange={e => { setAllocationId(e.target.value ? Number(e.target.value) : null); setAlphaIds([]); setC1Id(""); }} data-testid="select-c2-allocation"><option value="">Select explicitly</option>{eligible.map(a => <option value={a.id} key={a.id}>#{a.id} · B1 #{a.preparedInputId} · {a.createdAt}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c2-prepared">Frozen B1 validation preparation</Label><select id="c2-prepared" className={field} value={preparedId} onChange={e => { setPreparedId(e.target.value); setC1Id(""); }} data-testid="select-c2-prepared"><option value="">Select explicitly</option>{eligiblePrepared.map(p => <option value={p.preparedInputId} key={p.preparedInputId}>#{p.preparedInputId} · {p.createdAt}</option>)}</select>{!prepared.isLoading && !eligiblePrepared.length && <p className="text-xs text-amber-800">No frozen alpha-stream B1 evaluation input is available.</p>}</div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="c2-c1">C1 full-versus-exclusion comparison (optional)</Label><select id="c2-c1" className={field} value={c1Id} onChange={e => setC1Id(e.target.value)} data-testid="select-c2-c1"><option value="">No C1 · contribution comparisons may be unavailable</option>{matchingC1.map(x => <option value={x.id} key={x.id}>#{x.id} · {x.mode} · {x.createdAt}</option>)}</select><p className="text-xs text-muted-foreground">Only completed C1 experiments on this exact B2/B1 pair are shown. Selected candidates must each have a successful original exclusion child for C1-linked analysis.</p></div>
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
        <Button onClick={() => void run()} disabled={create.isPending || !eligible.length || !allocationId || !preparedId || !alphaIds.length} data-testid="button-c2-run"><Activity className="mr-2 h-4 w-4" />{create.isPending ? "Running diagnostics…" : "Run Alpha Diagnostics"}</Button>
      </section>
      <section className="space-y-3 border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">03 / Saved experiments</h3><Button size="sm" variant="outline" onClick={() => void saved.refetch()} disabled={saved.isFetching} data-testid="button-c2-refresh"><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh saved</Button></div>
        {saved.isLoading && <div className="h-12 animate-pulse rounded bg-muted/60" aria-label="Loading saved diagnostics" />}
        <div className="max-w-xl space-y-1"><Label htmlFor="c2-saved">Inspect saved diagnostics</Label><select id="c2-saved" className={field} value={selectedId ?? ""} onChange={e => { setSelectedId(e.target.value ? Number(e.target.value) : null); setReplayResult(null); }} data-testid="select-c2-saved"><option value="">Select saved experiment</option>{(saved.data ?? []).map(x => <option key={x.id} value={x.id}>#{x.id} · B2 #{x.allocationId} · B1 #{x.validationPreparedInputId} · {x.createdAt}</option>)}</select></div>
        {!saved.isLoading && !saved.data?.length && <Empty>No saved C2 diagnostics yet. Selecting and reading a saved record never recomputes it.</Empty>}
      </section>
      {selectedId && (detail.isLoading ? <div className="h-64 animate-pulse rounded bg-muted/60" aria-label="Loading saved experiment" /> : detail.data ? <section className="space-y-5 border-t pt-6" data-testid="status-c2-detail">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Experiment #{detail.data.id} <Badge variant="outline" className="ml-1">{text(result.engineVersion)}</Badge></h3><p className="mt-1 text-xs text-muted-foreground">B2 #{detail.data.allocationId} · B1 #{detail.data.validationPreparedInputId} · C1 #{detail.data.c1ExperimentId ?? "none"} · {period}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Manifest {detail.data.manifestHash} · result {detail.data.resultHash}</p></div><Button size="sm" variant="outline" onClick={() => void replaySaved()} disabled={replay.isPending} data-testid="button-c2-replay"><RotateCcw className="mr-1 h-3.5 w-3.5" />{replay.isPending ? "Verifying…" : "Replay frozen experiment"}</Button></div>
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
            <p className="text-xs text-muted-foreground">{text(incremental.rollingStatus)} · {rows(row(incremental.rollingConfiguration).predeclaredWindows).length} predeclared windows · {rows(incremental.rolling).length} saved candidate-windows. Missing C1 exclusions remain unavailable, never filled with estimated results.</p>
            {rows(incremental.rolling).length ? [...new Set(rows(incremental.rolling).map(r => String(r.alphaId)))].map((id, i) => { const series = rows(incremental.rolling).filter(r => r.alphaId === id); return <div key={id} className="space-y-3 rounded-md border p-3" data-testid={`status-c2-incremental-${i}`}><h5 className="break-all font-mono text-xs font-semibold">{id}</h5>
              <SeriesChart title="Rolling C1 policy deltas" data={series.map(s => ({ ...row(s.metrics), startDate: s.startDate, endDate: s.endDate }))} keys={[{ key: "netReturnDelta", label: "Net return Δ" }, { key: "volatilityDelta", label: "Volatility Δ" }, { key: "drawdownDelta", label: "Drawdown Δ" }]} unit="decimal full − exclusion" note={`${series.filter(s => s.status === "AVAILABLE").length}/${series.length} available · independent full/exclusion B3 reruns`} />
              <MetricTable label="Window / matched decisions" data={series.map(s => ({ ...row(s.metrics), label: `${text(s.startDate)} → ${text(s.endDate)} · ${rows(s.allocationDistances).length} decisions`, status: s.status, reason: s.reason }))} fields={["netReturnDelta", "sharpeDelta", "volatilityDelta", "drawdownDelta", "costDelta"]} />
              <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[500px] text-left text-xs"><thead className="bg-muted/50"><tr><th className="px-3 py-2">Window / decision date</th><th className="px-3 py-2">Alpha capital + master cash · half-L1</th><th className="px-3 py-2">Final assets + total cash · half-L1</th></tr></thead><tbody>{series.flatMap((s, j) => rows(s.allocationDistances).map((d, k) => <tr key={`${j}-${k}`} className="border-t"><td className="px-3 py-2">{text(s.startDate)} → {text(s.endDate)} / {text(d.date)}</td><td className="px-3 py-2"><Value value={d.alphaCapitalDistance} /></td><td className="px-3 py-2"><Value value={d.underlyingAssetDistance} /></td></tr>))}</tbody></table>{!series.some(s => rows(s.allocationDistances).length) && <p className="p-3 text-xs text-amber-800">No matched decision weights; distances are unavailable.</p>}</div>
            </div>; }) : <Empty>No rolling C1 deltas were saved. An optional matching C1 experiment with original successful exclusion children is required for comparable windows.</Empty>}
          </Section>}
        </div>
        <details className="text-xs"><summary className="cursor-pointer font-medium" data-testid="button-c2-methodology">Audit methodology, source identity &amp; frozen manifest</summary><div className="mt-2 space-y-2 rounded border bg-muted/20 p-3"><p>{text(row(result.methodology).selection)}</p><p>Undefined metrics: {text(row(result.methodology).undefinedMetrics)}</p><p>Numeric tolerance: {text(row(result.methodology).numericTolerance)}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ source: result.source, thresholds: result.thresholds, configuration: result.configuration, manifest: detail.data.manifest }, null, 2)}</pre></div></details>
      </section> : !detail.isError && <Empty>Saved experiment detail is unavailable. Retry loading to inspect the record.</Empty>)}
    </CardContent>
  </Card>;
}