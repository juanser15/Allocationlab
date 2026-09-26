import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getGetSelectionPolicyExperimentQueryKey, useGetSelectionPolicySources,
  useCreateSelectionPolicyPlan, useCreateSelectionPolicyExperiment,
  useListSelectionPolicyExperiments, useGetSelectionPolicyExperiment, useReplaySelectionPolicyExperiment,
  type C3SelectionPolicyPlanInput, type C3SelectionPolicyThresholds, type B3ValidationAssumptions,
} from "@workspace/api-client-react";
import { AlertCircle, Activity, RotateCcw, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): Obj[] => Array.isArray(v) ? v.map(obj) : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const label = (v: unknown) => v === undefined || v === null || v === "" ? "Unavailable" : String(v);
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const format = (v: unknown) => numeric(v) === null ? "Undefined" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
const errorText = (e: unknown) => e instanceof Error ? e.message : "Request failed. Check the frozen inputs and retry.";
const dateValid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const field = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const metricLabels: Record<string, string> = {
  cumulativeReturn: "Cumulative net return", annualizedReturn: "Annualized return", annualizedVolatility: "Annualized volatility",
  dailyExcessReturnSharpe: "Daily excess Sharpe", maximumDrawdown: "Maximum drawdown", externalTradedNotional: "External traded notional",
  transactionCosts: "Transaction costs", slippage: "Slippage", averageCash: "Average cash", averageRiskyExposure: "Average risky exposure",
  activeAlphaStreams: "Active alpha streams", finalUnderlyingAssets: "Final underlying assets",
  alphaCapitalConcentration: "Alpha capital concentration", underlyingExposureConcentration: "Underlying exposure concentration",
};
const policies = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"] as const;
const defaults: C3SelectionPolicyThresholds = {
  returnCorrelation: 0.8, rollingMedianCorrelation: 0.7, exposureSimilarity: 0.7,
  regimeCorrelation: 0.7, minPairedObservations: 40, minRollingWindows: 2, minRegimeObservations: 30, epsilon: 0.05,
};
const thresholdLabels: Record<keyof C3SelectionPolicyThresholds, string> = {
  returnCorrelation: "Full-sample correlation", rollingMedianCorrelation: "Rolling median correlation",
  exposureSimilarity: "Exposure similarity", regimeCorrelation: "Regime correlation",
  minPairedObservations: "Minimum paired observations", minRollingWindows: "Minimum rolling windows",
  minRegimeObservations: "Minimum regime observations", epsilon: "Sensitivity epsilon",
};
const numberKeys = ["initialNav", "initialCash", "transactionCostBps", "slippageBps", "dailyCashYield"] as const;
const numberLabels: Record<(typeof numberKeys)[number], string> = {
  initialNav: "Initial NAV", initialCash: "Initial cash", transactionCostBps: "Transaction cost · bps",
  slippageBps: "Slippage · bps", dailyCashYield: "Daily cash yield",
};
const Field = ({ title, children }: { title: string; children: React.ReactNode }) =>
  <div className="space-y-1"><h4 className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">{title}</h4>{children}</div>;
function Evidence({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Not available</span>;
  if (typeof value === "number") return <span className="tabular-nums">{format(value)}</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value)) return <div className="space-y-1">{value.length ? value.map((item, i) => <div key={i} className="border-l pl-2"><Evidence value={item} /></div>) : "None recorded"}</div>;
  return <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(120px,auto)_1fr]">{Object.entries(obj(value)).map(([key, val]) =>
    <div key={key} className="contents"><dt className="break-all text-muted-foreground">{key}</dt><dd className="min-w-0 break-all"><Evidence value={val} /></dd></div>)}</dl>;
}
function MetricTable({ items }: { items: { name: string; metrics: Obj }[] }) {
  return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-left text-xs">
    <thead className="bg-muted/40"><tr><th className="px-3 py-2" scope="col">Measure</th>{items.map(i => <th className="px-3 py-2" scope="col" key={i.name}>{i.name}</th>)}</tr></thead>
    <tbody>{Object.keys(metricLabels).map(key => <tr className="border-t" key={key}><th scope="row" className="px-3 py-2 font-medium">{metricLabels[key]}</th>{items.map(i => <td key={i.name} className="px-3 py-2 tabular-nums">{format(i.metrics[key])}</td>)}</tr>)}</tbody>
  </table></div>;
}

/** A working draft is independent of the immutable record selected in the archive. */
export function C3SelectionPoliciesPanel() {
  const [allocationId, setAllocationId] = useState<number | null>(null);
  const [evaluationB1, setEvaluationB1] = useState("");
  const [c2Id, setC2Id] = useState("");
  const [alphaIds, setAlphaIds] = useState<string[]>([]);
  const [dates, setDates] = useState({ developmentStartDate: "", developmentEndDate: "", evaluationStartDate: "", evaluationEndDate: "" });
  const [thresholds, setThresholds] = useState(defaults);
  const [groupCaps, setGroupCaps] = useState<Record<string, number>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [assumptions, setAssumptions] = useState<Omit<B3ValidationAssumptions, "evaluationStartDate" | "evaluationEndDate">>({
    decisionCalendar: "monthly", executionTiming: "next_close", initialNav: 1000000, initialHoldings: {},
    initialCash: 1000000, transactionCostBps: 10, slippageBps: 5, dailyCashYield: 0,
  });
  const [holdingsText, setHoldingsText] = useState("{}");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ key: string; data?: Awaited<ReturnType<ReturnType<typeof useCreateSelectionPolicyPlan>["mutateAsync"]>>; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [replayResult, setReplayResult] = useState<Awaited<ReturnType<ReturnType<typeof useReplaySelectionPolicyExperiment>["mutateAsync"]>> | null>(null);
  const sources = useGetSelectionPolicySources();
  const saved = useListSelectionPolicyExperiments();
  const detail = useGetSelectionPolicyExperiment(selectedId ?? 0, {
    query: { enabled: !!selectedId, queryKey: getGetSelectionPolicyExperimentQueryKey(selectedId ?? 0) },
  });
  const plan = useCreateSelectionPolicyPlan();
  const planRef = useRef(plan.mutateAsync);
  planRef.current = plan.mutateAsync;
  const create = useCreateSelectionPolicyExperiment();
  const replay = useReplaySelectionPolicyExperiment();

  const eligible = (sources.data?.allocations ?? []).filter(a => a.representation === "alpha_streams" && a.status === "SOLVED");
  const readyB1 = (sources.data?.preparedInputs ?? []).filter(p => p.representation === "alpha_streams" && p.status === "READY");
  const selectedAllocation = eligible.find(a => a.id === allocationId);
  const candidateIds = selectedAllocation?.candidateIds ?? [];
  const compatibleC2 = (sources.data?.c2Experiments ?? []).filter(x => x.allocationId === allocationId);
  const selectedC2 = compatibleC2.find(x => x.id === Number(c2Id));
  const splitValid = Object.values(dates).every(dateValid) &&
    dates.developmentStartDate <= dates.developmentEndDate &&
    dates.developmentEndDate < dates.evaluationStartDate &&
    dates.evaluationStartDate <= dates.evaluationEndDate;
  let holdings: Record<string, number> | null = null;
  try {
    const parsed: unknown = JSON.parse(holdingsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.entries(parsed).every(([key, value]) => !!key && typeof value === "number" && Number.isFinite(value) && value >= 0))
      holdings = parsed as Record<string, number>;
  } catch { /* The validation message below remains visible. */ }
  const assumptionsValid = !!holdings && assumptions.initialNav > 0 && assumptions.initialCash >= 0 &&
    assumptions.transactionCostBps >= 0 && assumptions.slippageBps >= 0 &&
    numberKeys.every(key => Number.isFinite(assumptions[key]));
  const thresholdsValid = (Object.keys(thresholds) as (keyof C3SelectionPolicyThresholds)[]).every(key => {
    const n = thresholds[key];
    return Number.isFinite(n) && (key.startsWith("min")
      ? Number.isSafeInteger(n) && n >= 2
      : key === "epsilon" ? n > 0 && n <= 1
        : key === "exposureSimilarity" ? n >= 0 && n <= 1 : n >= -1 && n <= 1);
  });
  const sourceValid = !!allocationId && !!selectedAllocation &&
    readyB1.some(p => p.preparedInputId === Number(evaluationB1)) &&
    !!c2Id && !!selectedC2 &&
    alphaIds.length >= 2 && alphaIds.length === candidateIds.length && alphaIds.every(id => candidateIds.includes(id)) &&
    alphaIds.length === selectedC2.alphaIds.length &&
    alphaIds.every(id => selectedC2.alphaIds.includes(id)) &&
    selectedC2.startDate.slice(0, 10) === dates.developmentStartDate &&
    selectedC2.endDate.slice(0, 10) === dates.developmentEndDate;
  const input: C3SelectionPolicyPlanInput | null = sourceValid && splitValid && thresholdsValid && assumptionsValid ? {
    allocationId, validationPreparedInputId: Number(evaluationB1), c2ExperimentId: Number(c2Id),
    alphaIds, ...dates, thresholds, groupCaps, manualOverrides,
    assumptions: { ...assumptions, initialHoldings: holdings ?? {}, evaluationStartDate: dates.evaluationStartDate, evaluationEndDate: dates.evaluationEndDate },
  } : null;
  const inputKey = input ? JSON.stringify(input) : null;
  const latestKey = useRef(inputKey);
  latestKey.current = inputKey;
  useEffect(() => {
    if (!inputKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void planRef.current({ data: JSON.parse(inputKey) as C3SelectionPolicyPlanInput })
        .then(data => { if (active) setPlanned({ key: inputKey, data }); })
        .catch(error => { if (active) setPlanned({ key: inputKey, error: errorText(error) }); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inputKey]);
  const preview = planned?.key === inputKey ? planned : null;
  const groups = array(preview?.data?.groups);
  const preserved = array(preview?.data?.preservedPairs);
  const policiesPreview = obj(preview?.data?.policies);
  const capsValid = !!preview?.data && groups.every(g => {
    const n = groupCaps[String(g.id)];
    return Number.isFinite(n) && n > 0 && n <= 1;
  }) && Object.keys(groupCaps).every(id => groups.some(g => g.id === id));
  const overridesValid = Object.entries(manualOverrides).every(([id, representative]) => {
    const group = groups.find(g => g.id === id);
    return !!group && strings(group.memberIds).includes(representative);
  });
  const ready = !!input && !!preview?.data && capsValid && overridesValid &&
    policies.every(key => numeric(obj(policiesPreview[key]).alphaCount) !== null);
  const savedManifest = obj(detail.data?.manifest);
  const savedResult = obj(detail.data?.result);
  const savedSelection = obj(savedManifest.selection);
  const savedPolicies = obj(savedResult.policies);

  async function run() {
    if (!ready || !input || !inputKey) return;
    setNotice(null); setChecking(true);
    try {
      const checked = await planRef.current({ data: input });
      if (latestKey.current !== inputKey) return;
      const checkedGroups = array(checked.groups);
      if (checkedGroups.length !== groups.length || checkedGroups.some((g, i) =>
        g.id !== groups[i].id || g.representativeId !== groups[i].representativeId)) {
        setPlanned({ key: inputKey, data: checked });
        setNotice("The frozen plan changed. Review groups, representatives, and caps again.");
        return;
      }
      const created = await create.mutateAsync({ data: {
        ...input, groupCaps: { ...groupCaps },
        assumptions: input.assumptions as B3ValidationAssumptions,
      } });
      await saved.refetch();
      setSelectedId(created.id);
      setReplayResult(null);
    } catch (error) { setNotice(errorText(error)); }
    finally { setChecking(false); }
  }
  async function replaySaved() {
    if (!selectedId) return;
    setReplayResult(null); setNotice(null);
    try { setReplayResult(await replay.mutateAsync({ experimentId: selectedId })); }
    catch (error) { setNotice(errorText(error)); }
  }
  const retry = () => {
    setNotice(null); setPlanned(null);
    void sources.refetch();
    void saved.refetch(); if (selectedId) void detail.refetch();
  };
  return <Card className="border-primary/20" data-testid="card-c3-selection-policies">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Selection Policies</CardTitle>
      <CardDescription className="mt-1 max-w-2xl">Freeze development evidence before the holdout. Compare three redundancy treatments under one evaluation contract; no policy is declared a winner.</CardDescription></div>
      <Badge variant="outline">C3 · Policy research</Badge></div></CardHeader>
    <CardContent className="space-y-7">
      {(notice || sources.isError || saved.isError || detail.isError) && <Alert variant="destructive" role="alert"><AlertCircle className="h-4 w-4" /><AlertDescription>{notice ?? errorText(sources.error ?? saved.error ?? detail.error)} <Button size="sm" variant="outline" className="ml-2" onClick={retry} data-testid="button-c3-retry">Retry loading</Button></AlertDescription></Alert>}
      <section className="space-y-4" aria-labelledby="c3-development"><div><h3 id="c3-development" className="text-sm font-semibold">01 / Development Evidence</h3><p className="mt-1 text-xs text-muted-foreground">C2 must cover the exact selected alpha universe and development dates. Evaluation B1 is separately frozen.</p></div>
        {sources.isLoading && <div className="space-y-2" role="status" aria-label="Loading frozen research inputs"><p className="text-xs text-muted-foreground">Loading compact frozen source metadata…</p><div className="h-20 animate-pulse rounded-md bg-muted/60" /></div>}
        {!sources.isLoading && !sources.isError && !eligible.length && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No solved frozen B2 alpha-stream policy is available.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="c3-b2">Frozen solved B2 policy</Label><select id="c3-b2" className={field} value={allocationId ?? ""} onChange={e => { setAllocationId(e.target.value ? Number(e.target.value) : null); setC2Id(""); setAlphaIds([]); setGroupCaps({}); setManualOverrides({}); }} data-testid="select-c3-b2"><option value="">Select B2</option>{eligible.map(a => <option key={a.id} value={a.id}>B2 #{a.id} · policy B1 #{a.preparedInputId}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c3-b1">Frozen evaluation B1</Label><select id="c3-b1" className={field} value={evaluationB1} onChange={e => setEvaluationB1(e.target.value)} data-testid="select-c3-b1"><option value="">Select evaluation data</option>{readyB1.map(p => <option key={p.preparedInputId} value={p.preparedInputId}>B1 #{p.preparedInputId}</option>)}</select></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="c3-c2">Frozen C2 development evidence</Label><select id="c3-c2" className={field} value={c2Id} onChange={e => {
            const chosen = compatibleC2.find(x => x.id === Number(e.target.value));
            setC2Id(e.target.value); setAlphaIds(chosen ? [...chosen.alphaIds] : []); setGroupCaps({}); setManualOverrides({});
            setDates(old => ({ ...old, developmentStartDate: chosen?.startDate.slice(0, 10) ?? "", developmentEndDate: chosen?.endDate.slice(0, 10) ?? "" }));
          }} data-testid="select-c3-c2"><option value="">Select C2</option>{compatibleC2.map(x => <option key={x.id} value={x.id}>C2 #{x.id} · B1 #{x.validationPreparedInputId} · {x.createdAt}</option>)}</select></div>
        </div>
        {c2Id && selectedC2 && <div className="rounded-md border bg-muted/20 p-3 text-xs" data-testid="status-c3-evidence"><span className="font-medium">C2 #{c2Id}</span> · development B1 #{selectedC2.validationPreparedInputId} · exact window {selectedC2.startDate} → {selectedC2.endDate} · {selectedC2.alphaIds.length} frozen alphas.</div>}
        <fieldset className="rounded-md border p-3"><legend className="px-1 text-xs font-medium">Canonical candidate alphas · select the complete C2 universe</legend><div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">{candidateIds.map((id, i) => <label key={id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={alphaIds.includes(id)} onChange={e => { setAlphaIds(old => e.target.checked ? [...old, id] : old.filter(x => x !== id)); setGroupCaps({}); setManualOverrides({}); }} data-testid={`checkbox-c3-alpha-${i}`} /><span className="break-all font-mono">{id}</span></label>)}</div><p className="mt-2 text-xs text-muted-foreground">{alphaIds.length} selected. C3 requires the exact frozen B2 and C2 universe; no alpha subset is permitted.</p></fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(dates) as (keyof typeof dates)[]).map(key => <div key={key} className="space-y-1"><Label htmlFor={`c3-${key}`}>{key.replace(/([A-Z])/g, " $1")}</Label><Input id={`c3-${key}`} type="date" value={dates[key]} onChange={e => setDates(old => ({ ...old, [key]: e.target.value }))} data-testid={`input-c3-${key}`} /></div>)}</div>
        {!splitValid && <p className="text-xs text-amber-800" role="status">Enter valid dates. Development must end strictly before evaluation begins.</p>}
        {selectedC2 && !sourceValid && <p className="text-xs text-amber-800" role="status">Select an evaluation B1 and the exact frozen B2/C2 alpha universe; development dates must match C2. The server verifies the full frozen sources on preview and run.</p>}
      </section>
      <section className="space-y-4 border-t pt-6" aria-labelledby="c3-groups"><div><h3 id="c3-groups" className="text-sm font-semibold">02 / Redundancy Groups</h3><p className="mt-1 text-xs text-muted-foreground">Conservative complete-linkage, conditional evidence gates, and explicit regime-divergence protection. Preview does not run B3.</p></div>
        <div className="rounded-md border bg-muted/20 p-3"><p className="mb-3 text-xs font-medium">Grouping rule · C3 engine {label(preview?.data?.engineVersion)} · thresholds v1</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(defaults) as (keyof C3SelectionPolicyThresholds)[]).map(key => <div key={key} className="space-y-1"><Label htmlFor={`c3-threshold-${key}`}>{thresholdLabels[key]}</Label><Input id={`c3-threshold-${key}`} type="number" step={key.startsWith("min") ? 1 : 0.01} min={key.startsWith("min") ? 2 : key === "epsilon" ? 0.000001 : key === "exposureSimilarity" ? 0 : -1} max={key.startsWith("min") ? undefined : 1} value={thresholds[key]} onChange={e => { setThresholds(old => ({ ...old, [key]: Number(e.target.value) })); setGroupCaps({}); setManualOverrides({}); }} data-testid={`input-c3-threshold-${key}`} /></div>)}</div></div>
        {!input ? <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">Complete frozen sources, dates, thresholds, and B3 assumptions to preview the development-only plan.</p>
          : !preview ? <div className="space-y-2" aria-label="Loading development plan"><div className="h-5 w-2/3 animate-pulse rounded bg-muted" /><div className="h-5 w-1/2 animate-pulse rounded bg-muted" /></div>
            : preview.error ? <p className="text-xs text-amber-800" role="alert">Plan unavailable: {preview.error}</p>
              : <div className="space-y-4" data-testid="status-c3-plan">
                <p className="text-xs tabular-nums">{groups.length} redundancy groups · {array(preview.data?.standaloneIds).length || strings(preview.data?.standaloneIds).length} standalone alphas · {preserved.length} regime-preserved pairs.</p>
                {groups.length ? groups.map((g, i) => <div key={String(g.id)} className="rounded-md border p-3 text-xs" data-testid={`status-c3-group-${i}`}><p className="font-semibold">Group {i + 1} <span className="ml-2 font-mono text-[10px] text-muted-foreground">{label(g.id)}</span></p><p className="mt-1 break-all">{strings(g.memberIds).join(" · ")}</p><p className="mt-2">Representative: <strong className="font-mono">{label(g.representativeId)}</strong> · {label(g.selectionReason)}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Pairwise evidence</summary><div className="mt-2"><Evidence value={g.evidence} /></div></details></div>) : <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No genuine redundancy group qualifies under these thresholds. All alphas remain standalone.</p>}
                <div className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-3 text-xs dark:bg-amber-950/10"><h4 className="font-semibold uppercase tracking-wider">Preserved due to regime complementarity</h4>{preserved.length ? preserved.map((pair, i) => <div key={i} className="mt-3 border-t pt-2" data-testid={`status-c3-preserved-${i}`}><p className="break-all font-medium">{label(pair.alphaA)} / {label(pair.alphaB)}</p><p className="mt-1">{label(pair.reason)}</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Field title="Full correlation"><Evidence value={pair.fullSampleCorrelation} /></Field><Field title="Conditional correlations"><Evidence value={pair.regimeCorrelations} /></Field><Field title="Conditional performance"><Evidence value={pair.conditionalPerformanceByRegime} /></Field><Field title="Conditional C1 contribution"><Evidence value={pair.conditionalContributionByRegime} /></Field><Field title="Exposure similarity"><Evidence value={pair.exposureSimilarityByRegime} /></Field></div></div>) : <p className="mt-2 text-muted-foreground">No C2 regime-divergent pair in this selection.</p>}</div>
                <div className="rounded-md border p-3 text-xs"><h4 className="font-semibold">Development threshold sensitivity · −epsilon / base / +epsilon</h4><div className="mt-2 space-y-2">{array(obj(preview.data?.sensitivity).cases).map((item, i) => <div key={i} className="border-t pt-2"><strong>{Number(item.offset) < 0 ? "−ε" : Number(item.offset) > 0 ? "+ε" : "Base"}</strong> · {label(item.groupCount)} groups · {array(item.membershipChanges).length || strings(item.membershipChanges).length} membership changes · {array(item.representativeChanges).length || strings(item.representativeChanges).length} representative changes · {format(item.assignmentChangePercent)}% assignment changes<details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Assignments and thresholds</summary><Evidence value={{ groups: item.groups, membershipChanges: item.membershipChanges, representativeChanges: item.representativeChanges, thresholds: item.thresholds }} /></details></div>)}</div></div>
              </div>}
      </section>
      <section className="space-y-4 border-t pt-6" aria-labelledby="c3-policies"><div><h3 id="c3-policies" className="text-sm font-semibold">03 / Policy Definitions</h3><p className="mt-1 text-xs text-muted-foreground">The representative rule favors lower development external turnover, then coverage, then canonical ID. Override before evaluation. Every group cap must be declared by you.</p></div>
        {groups.map((g, i) => <div key={String(g.id)} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`c3-cap-${i}`}>Group {i + 1} · aggregate B2 allocation cap (0–1)</Label><Input id={`c3-cap-${i}`} type="number" min="0.000001" max="1" step="0.01" value={groupCaps[String(g.id)] ?? ""} onChange={e => setGroupCaps(old => {
          const next = { ...old }; if (!e.target.value) delete next[String(g.id)]; else next[String(g.id)] = Number(e.target.value); return next;
        })} placeholder="Required for run" data-testid={`input-c3-cap-${i}`} /></div><div className="space-y-1"><Label htmlFor={`c3-override-${i}`}>Manual representative override</Label><select id={`c3-override-${i}`} className={field} value={manualOverrides[String(g.id)] ?? ""} onChange={e => setManualOverrides(old => {
          const next = { ...old }; if (!e.target.value) delete next[String(g.id)]; else next[String(g.id)] = e.target.value; return next;
        })} data-testid={`select-c3-override-${i}`}><option value="">Automatic · {label(g.representativeId)}</option>{strings(g.memberIds).map(id => <option key={id} value={id}>{id}</option>)}</select></div></div>)}
        <div className="rounded-md border bg-muted/20 p-3 text-xs"><h4 className="font-semibold">Shared B3 evaluation assumptions</h4><p className="mt-1 text-muted-foreground">The same NAV, holdings, execution, costs and evaluation dates apply to all three policies.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="space-y-1"><Label htmlFor="c3-calendar">Decision calendar</Label><select id="c3-calendar" className={field} value={assumptions.decisionCalendar} onChange={e => setAssumptions(old => ({ ...old, decisionCalendar: e.target.value as B3ValidationAssumptions["decisionCalendar"] }))} data-testid="select-c3-calendar"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div><div className="space-y-1"><Label htmlFor="c3-execution">Execution timing</Label><select id="c3-execution" className={field} value={assumptions.executionTiming} onChange={e => setAssumptions(old => ({ ...old, executionTiming: e.target.value as B3ValidationAssumptions["executionTiming"] }))} data-testid="select-c3-execution"><option value="next_close">Next close</option><option value="same_close">Same close</option></select></div>
          {numberKeys.map(key => <div key={key} className="space-y-1"><Label htmlFor={`c3-${key}`}>{numberLabels[key]}</Label><Input id={`c3-${key}`} type="number" step="any" min={key === "dailyCashYield" ? undefined : key === "initialNav" ? "0.000001" : 0} value={assumptions[key]} onChange={e => setAssumptions(old => ({ ...old, [key]: Number(e.target.value) }))} data-testid={`input-c3-${key}`} /></div>)}<div className="space-y-1"><Label htmlFor="c3-benchmark">Benchmark ticker · optional</Label><Input id="c3-benchmark" value={assumptions.benchmarkTicker ?? ""} onChange={e => setAssumptions(old => ({ ...old, benchmarkTicker: e.target.value || undefined }))} data-testid="input-c3-benchmark" /></div><div className="space-y-1 sm:col-span-2"><Label htmlFor="c3-holdings">Initial holdings · asset-to-units JSON</Label><Input id="c3-holdings" value={holdingsText} onChange={e => setHoldingsText(e.target.value)} placeholder='{"SPY": 12}' data-testid="input-c3-holdings" />{!holdings && <p className="text-amber-800" role="alert">Enter a JSON object with nonnegative finite unit counts.</p>}</div></div></div>
        {preview?.data && <div className="grid gap-2 sm:grid-cols-3" data-testid="status-c3-policy-preview">{policies.map(key => {
          const summary = obj(policiesPreview[key]); return <div key={key} className="rounded-md border bg-muted/20 p-3 text-xs"><h4 className="font-semibold tracking-wide">{key}</h4><p className="mt-2 tabular-nums">{label(summary.alphaCount)} alphas · {label(summary.groupCount)} groups</p><p className="mt-1 text-muted-foreground">{key === "GROUP_CAP" ? capsValid ? "User-defined caps ready" : "Enter a cap for each group" : key === "REPRESENTATIVE" ? `${strings(summary.removedAlphaIds).length} removed as redundant` : "Complete frozen universe"}</p>{key === "REPRESENTATIVE" && strings(summary.removedAlphaIds).length > 0 && <p className="mt-2 break-all font-mono" data-testid="status-c3-removed">Removed: {strings(summary.removedAlphaIds).join(" · ")}</p>}</div>;
        })}</div>}
        <p className="text-xs text-muted-foreground" data-testid="status-c3-readiness">{preserved.length} pairs preserved due to regime complementarity · {ready ? "Plan and group caps validated. Ready to run." : "Run blocked until the current plan, assumptions and every group cap are valid."}</p>
        <Button onClick={() => void run()} disabled={!ready || checking || create.isPending} data-testid="button-c3-run"><Activity className="mr-2 h-4 w-4" />{checking ? "Rechecking frozen plan…" : create.isPending ? "Running comparison…" : "RUN POLICY COMPARISON"}</Button>
      </section>
      <section className="space-y-4 border-t pt-6" aria-labelledby="c3-comparison"><div><h3 id="c3-comparison" className="text-sm font-semibold">04 / Evaluation Comparison</h3><p className="mt-1 text-xs text-muted-foreground">Immutable saved comparisons remain independent of your working draft. Reading does not recompute a run.</p></div>
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-1"><Label htmlFor="c3-saved">Saved comparisons</Label><select id="c3-saved" className={field} value={selectedId ?? ""} onChange={e => { setSelectedId(e.target.value ? Number(e.target.value) : null); setReplayResult(null); }} data-testid="select-c3-saved"><option value="">Select saved experiment</option>{(saved.data ?? []).map(x => <option key={x.id} value={x.id}>#{x.id} · B2 #{x.allocationId} · evaluation B1 #{x.validationPreparedInputId} · {x.createdAt}</option>)}</select></div><Button size="sm" variant="outline" onClick={() => void saved.refetch()} disabled={saved.isFetching} data-testid="button-c3-refresh"><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh saved</Button></div>
        {saved.isLoading && <div className="h-12 animate-pulse rounded bg-muted" aria-label="Loading saved comparisons" />}
        {!saved.isLoading && !saved.data?.length && <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">No saved comparisons yet. A run freezes all three policies and their B3 evaluation records.</p>}
        {selectedId && (detail.isLoading ? <div className="h-28 animate-pulse rounded bg-muted" aria-label="Loading frozen comparison" /> : detail.data && <div className="space-y-5" data-testid="status-c3-detail">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/20 p-4"><div className="text-xs"><h4 className="text-sm font-semibold">Comparison #{detail.data.id} <Badge variant="outline" className="ml-2">{label(savedResult.engineVersion)}</Badge></h4><p className="mt-2">B2 #{detail.data.allocationId} · evaluation B1 #{detail.data.validationPreparedInputId} · C2 #{detail.data.c2ExperimentId}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Manifest {detail.data.manifestHash} · result {detail.data.resultHash}</p><p className="mt-1">B3 runs: {policies.map(key => `${key} #${label(obj(savedPolicies[key]).validationRunId)}`).join(" · ")}</p></div><Button size="sm" variant="outline" disabled={replay.isPending} onClick={() => void replaySaved()} data-testid="button-c3-replay"><RotateCcw className="mr-2 h-3.5 w-3.5" />{replay.isPending ? "Verifying…" : "Replay frozen experiment"}</Button></div>
          {replayResult && <div role="status" aria-live="polite" className={`rounded-md border p-3 text-xs ${replayResult.status === "pass" && replayResult.differences.length === 0 && replayResult.maximumNumericDifference <= 1e-8 ? "border-emerald-600/30 bg-emerald-50/30" : "border-amber-600/40 bg-amber-50/30"}`} data-testid="status-c3-replay"><strong>Replay {replayResult.status.toUpperCase()}</strong> · {replayResult.differences.length} differing fields · maximum numeric difference {format(replayResult.maximumNumericDifference)} · tolerance ≤ 1e-8{replayResult.differences.length > 0 && <ul className="mt-2 list-inside list-disc">{replayResult.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>}</div>}
          <div className="rounded-md border p-3 text-xs"><h4 className="font-semibold">Frozen development decisions</h4><p className="mt-1">Development {label(obj(savedManifest.input).developmentStartDate)} → {label(obj(savedManifest.input).developmentEndDate)} · evaluation {label(obj(savedManifest.input).evaluationStartDate)} → {label(obj(savedManifest.input).evaluationEndDate)}</p><p className="mt-1">Thresholds · {label(savedManifest.engineVersion)} · representative rule: lower development turnover, higher coverage, canonical ID</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field title="Frozen thresholds & caps"><Evidence value={{ thresholds: obj(savedManifest.input).thresholds, groupCaps: obj(savedManifest.input).groupCaps, manualOverrides: obj(savedManifest.input).manualOverrides }} /></Field><Field title="Groups & representatives"><Evidence value={savedSelection.groups} /></Field></div><h5 className="mt-3 font-semibold uppercase tracking-wider">Preserved due to regime complementarity</h5><Evidence value={savedSelection.preservedPairs} /></div>
          <div className="space-y-2"><h4 className="text-xs font-semibold">B3 policy metrics</h4><MetricTable items={policies.map(key => ({ name: key, metrics: obj(obj(savedPolicies[key]).metrics) }))} /></div>
          <div className="space-y-2"><h4 className="text-xs font-semibold">Pairwise differences · left minus right</h4><MetricTable items={array(savedResult.pairwiseDifferences).map(pair => ({ name: `${label(pair.left)} − ${label(pair.right)}`, metrics: obj(pair.metrics) }))} /></div>
          <div className="space-y-3"><h4 className="text-xs font-semibold">Allocation distance · ½ Σ |weight A − weight B|</h4><p className="text-xs text-muted-foreground">Alpha capital and final underlying assets at matched evaluation decisions. These distances are not realized turnover.</p>{Object.entries(obj(savedResult.allocationDistances)).map(([key, value]) => {
            const series = array(value);
            const stats = (metric: string) => {
              const values = series.map(point => numeric(point[metric])).filter((n): n is number => n !== null);
              return values.length ? `mean ${format(values.reduce((a, b) => a + b, 0) / values.length)} · max ${format(Math.max(...values))}` : "Undefined";
            };
            return <div key={key} className="rounded-md border p-3 text-xs"><h5 className="font-semibold">{key.replace("_vs_", " vs ")}</h5><p className="mt-1 text-muted-foreground">Alpha capital: {stats("alphaCapitalDistance")} · underlying assets: {stats("underlyingAssetDistance")}</p>{series.some(p => numeric(p.alphaCapitalDistance) !== null || numeric(p.underlyingAssetDistance) !== null) ? <div className="mt-2 h-48" role="img" aria-label={`${key} alpha capital and underlying asset distance over ${series.length} decision dates`}><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><CartesianGrid strokeDasharray="3 3" stroke="#cbd5ce" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Line dataKey="alphaCapitalDistance" name="Alpha capital" stroke="#344e78" strokeWidth={2} dot={false} connectNulls={false} /><Line dataKey="underlyingAssetDistance" name="Underlying assets" stroke="#bc7654" strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div> : <p className="mt-2 text-muted-foreground">No matched, defined distances.</p>}<details className="mt-2"><summary className="cursor-pointer">Inspect saved distance series</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[360px] text-left"><thead><tr><th scope="col">Date</th><th scope="col">Alpha</th><th scope="col">Assets</th></tr></thead><tbody>{series.map((point, i) => <tr key={i} className="border-t"><td>{label(point.date)}</td><td>{format(point.alphaCapitalDistance)}</td><td>{format(point.underlyingAssetDistance)}</td></tr>)}</tbody></table></div></details></div>;
          })}</div>
        </div>)}
      </section>
    </CardContent>
  </Card>;
}