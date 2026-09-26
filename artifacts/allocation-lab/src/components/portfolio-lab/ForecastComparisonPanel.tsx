import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetForecastComparisonQueryKey, getListForecastComparisonsQueryKey, useCreateForecastComparison, useGetForecastComparison, useListForecastComparisons, useReplayForecastComparison } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const types = ["SAMPLE_MEAN", "SHRUNK_MEAN", "BAYESIAN_VIEWS"] as const;
type IDs = Record<typeof types[number], string>;
const blank: IDs = { SAMPLE_MEAN: "", SHRUNK_MEAN: "", BAYESIAN_VIEWS: "" };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function ForecastComparisonPanel() {
  const [allocations, setAllocations] = useState<IDs>(blank);
  const [validations, setValidations] = useState<IDs>(blank);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [replayStatus, setReplayStatus] = useState("");
  const client = useQueryClient();
  const list = useListForecastComparisons();
  const detail = useGetForecastComparison(selected ?? 0, { query: { enabled: selected !== null, queryKey: getGetForecastComparisonQueryKey(selected ?? 0) } });
  const create = useCreateForecastComparison();
  const replay = useReplayForecastComparison();
  const busy = create.isPending || replay.isPending;
  const parse = (values: IDs, label: string) => {
    const parsed = Object.fromEntries(types.map(type => [type, Number(values[type])])) as Record<typeof types[number], number>;
    if (types.some(type => !Number.isSafeInteger(parsed[type]) || parsed[type] < 1) || new Set(Object.values(parsed)).size !== 3)
      throw new Error(`${label} requires three distinct positive saved IDs, one per estimator.`);
    return parsed;
  };
  async function save() {
    setError(""); setReplayStatus("");
    try {
      const allocationIds = parse(allocations, "B2 allocations");
      const anyValidation = types.some(type => validations[type].trim());
      const validationRunIds = anyValidation ? parse(validations, "B3 validation runs") : undefined;
      const created = await create.mutateAsync({ data: { allocationIds, ...(validationRunIds ? { validationRunIds } : {}) } });
      setSelected(created.id);
      await client.invalidateQueries({ queryKey: getListForecastComparisonsQueryKey() });
    } catch (err) { setError(err instanceof Error ? err.message : "Comparison could not be saved."); }
  }
  async function replaySaved() {
    if (!selected) return;
    setError("");
    try {
      const result = await replay.mutateAsync({ comparisonId: selected });
      setReplayStatus(`Replay ${result.status.toUpperCase()} · ${result.differences.length} differing fields · maximum numeric difference ${result.maximumNumericDifference}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Comparison replay failed."); }
  }
  const record = detail.data;
  return <div className="space-y-4" data-testid="panel-forecast-comparison">
    <Card className="shadow-none"><CardHeader className="pb-3"><CardTitle className="text-sm">Controlled estimator comparison</CardTitle><CardDescription>Supply three saved B2 allocations, one for each estimator. Dataset, candidates, cutoff, risk model, objective, constraints and cash assumptions must match. B3 runs are optional, but if supplied all three must share execution and cost assumptions. The server rejects mismatches; no winner is declared.</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="overflow-auto rounded border"><table className="w-full min-w-[460px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Estimator</th><th className="p-2">Saved B2 ID</th><th className="p-2">Saved B3 ID · optional matched triple</th></tr></thead><tbody>{types.map(type => <tr key={type} className="border-t"><th className="p-2 font-medium">{type.replaceAll("_", " ")}</th><td className="p-2"><Label className="sr-only" htmlFor={`compare-b2-${type}`}>{type} B2 ID</Label><Input id={`compare-b2-${type}`} type="number" min="1" step="1" value={allocations[type]} onChange={e => setAllocations(v => ({ ...v, [type]: e.target.value }))} data-testid={`input-forecast-comparison-b2-${type}`} /></td><td className="p-2"><Label className="sr-only" htmlFor={`compare-b3-${type}`}>{type} B3 ID</Label><Input id={`compare-b3-${type}`} type="number" min="1" step="1" value={validations[type]} onChange={e => setValidations(v => ({ ...v, [type]: e.target.value }))} data-testid={`input-forecast-comparison-b3-${type}`} /></td></tr>)}</tbody></table></div>
      <Button size="sm" type="button" disabled={busy} onClick={() => void save()} data-testid="button-save-forecast-comparison">Save matched comparison</Button>
      {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" data-testid="status-forecast-comparison-error">{error}</p>}
    </CardContent></Card>
    <div className="flex flex-wrap items-end gap-2"><div className="space-y-1"><Label htmlFor="select-forecast-comparison">Saved comparison</Label><select id="select-forecast-comparison" className="h-9 min-w-52 rounded-md border bg-background px-2 text-sm" value={selected ?? ""} onChange={e => { setSelected(e.target.value ? Number(e.target.value) : null); setReplayStatus(""); }} data-testid="select-forecast-comparison"><option value="">Select a comparison</option>{list.data?.comparisons.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.createdAt}</option>)}</select></div><Button variant="outline" size="sm" onClick={() => void list.refetch()} disabled={list.isFetching} data-testid="button-refresh-forecast-comparisons">Refresh saved</Button>{selected && <Button variant="outline" size="sm" onClick={() => void replaySaved()} disabled={busy} data-testid="button-replay-forecast-comparison">Replay saved comparison</Button>}</div>
    {list.isLoading || detail.isLoading && selected ? <div className="h-20 animate-pulse rounded border bg-muted/40" aria-label="Loading forecast comparisons" /> : null}
    {(list.isError || detail.isError) && <p role="alert" className="text-xs text-destructive">Could not load comparisons. Use Refresh saved to retry.</p>}
    {!list.isLoading && !list.data?.comparisons.length && <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">No saved controlled comparisons yet.</p>}
    {replayStatus && <p className="rounded border bg-muted/30 p-3 text-xs" data-testid="status-forecast-comparison-replay">{replayStatus}</p>}
    {record && <div className="space-y-3 rounded border bg-muted/20 p-3 text-xs" data-testid="result-forecast-comparison"><div className="flex flex-wrap justify-between gap-2"><strong>Comparison #{record.id} · frozen manifest</strong><span>Result hash {record.resultHash}</span></div><p>No performance winner is inferred. Differences in forecasts, forecast uncertainty, weights, exposures and realized B3 metrics are shown without ranking.</p><details><summary className="cursor-pointer font-medium">Matching manifest</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(record.manifest, null, 2)}</pre></details>{Object.entries(obj(record.result)).map(([key, value]) => <details key={key} open={key === "models" || key === "allocations"} className="rounded border bg-background p-2"><summary className="cursor-pointer font-semibold">{key.replace(/([A-Z])/g, " $1")}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre></details>)}</div>}
  </div>;
}