import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import {
  getGetAllocationModeComparisonQueryKey,
  getListAllocationModeComparisonsQueryKey,
  useCreateAllocationModeComparison,
  useGetAllocationModeComparison,
  useListAllocationModeComparisons,
  useListAllocations,
  useReplayAllocationModeComparison,
} from "@workspace/api-client-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Row = Record<string, unknown>;
type Mode = "CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY";
const modes: Mode[] = ["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"];
const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const display = (value: unknown) => value === undefined || value === null ? "Not returned" : typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(value);
const formatted = (value: unknown) => value === undefined || value === null ? "Not returned" : JSON.stringify(value, null, 2);
const errorText = (value: unknown) => {
  const data = asRow(asRow(value).data);
  return String(data.error ?? asRow(value).message ?? "Comparison request failed. Check that frozen data, dates, alpha universe, estimator, risk model and execution assumptions match.");
};
const modeLabel = (mode: Mode) => mode === "SIGNED_OVERLAY" ? "Signed alpha overlay" : "Capital long-only";

export function AllocationModeComparisonPanel({ validationRuns }: { validationRuns: Row[] }) {
  const queryClient = useQueryClient();
  const allocationsQuery = useListAllocations();
  const listQuery = useListAllocationModeComparisons();
  const create = useCreateAllocationModeComparison();
  const replay = useReplayAllocationModeComparison();
  const [allocationIds, setAllocationIds] = useState<Record<Mode, number | null>>({ CAPITAL_LONG_ONLY: null, SIGNED_OVERLAY: null });
  const [validationRunIds, setValidationRunIds] = useState<Record<Mode, number | null>>({ CAPITAL_LONG_ONLY: null, SIGNED_OVERLAY: null });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<Row | null>(null);
  const detailQuery = useGetAllocationModeComparison(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetAllocationModeComparisonQueryKey(selectedId ?? 0) },
  });
  const allocations = allocationsQuery.data ?? [];
  const options = useMemo(() => Object.fromEntries(modes.map(mode => [
    mode, allocations.filter(item => item.status === "SOLVED" && item.request.representation === "alpha_streams" &&
      (item.request.allocationMode ?? "CAPITAL_LONG_ONLY") === mode),
  ])) as Record<Mode, typeof allocations>, [allocations]);
  const saved = listQuery.data?.comparisons ?? [];
  const detail = detailQuery.data;
  const result = asRow(detail?.result);
  const semantics = asRow(result.semanticDifferences);
  const outcomes = asRow(result.modes);

  useEffect(() => {
    setValidationRunIds(previous => ({
      CAPITAL_LONG_ONLY: validationRuns.some(item => Number(item.validationRunId) === previous.CAPITAL_LONG_ONLY && Number(item.allocationId) === allocationIds.CAPITAL_LONG_ONLY) ? previous.CAPITAL_LONG_ONLY : null,
      SIGNED_OVERLAY: validationRuns.some(item => Number(item.validationRunId) === previous.SIGNED_OVERLAY && Number(item.allocationId) === allocationIds.SIGNED_OVERLAY) ? previous.SIGNED_OVERLAY : null,
    }));
  }, [allocationIds.CAPITAL_LONG_ONLY, allocationIds.SIGNED_OVERLAY, validationRuns]);

  async function save() {
    if (!allocationIds.CAPITAL_LONG_ONLY || !allocationIds.SIGNED_OVERLAY ||
      !validationRunIds.CAPITAL_LONG_ONLY || !validationRunIds.SIGNED_OVERLAY) {
      setError("Choose a saved B2 policy and its matching B3 validation run for each allocation mode.");
      return;
    }
    setError(null);
    setReplayResult(null);
    try {
      const created = await create.mutateAsync({
        data: {
          allocationIds: { CAPITAL_LONG_ONLY: allocationIds.CAPITAL_LONG_ONLY, SIGNED_OVERLAY: allocationIds.SIGNED_OVERLAY },
          validationRunIds: { CAPITAL_LONG_ONLY: validationRunIds.CAPITAL_LONG_ONLY, SIGNED_OVERLAY: validationRunIds.SIGNED_OVERLAY },
        },
      });
      queryClient.setQueryData(getGetAllocationModeComparisonQueryKey(created.id), created);
      setSelectedId(created.id);
      await queryClient.invalidateQueries({ queryKey: getListAllocationModeComparisonsQueryKey() });
    } catch (cause) { setError(errorText(cause)); }
  }

  async function replaySaved() {
    if (selectedId === null) return;
    setError(null);
    setReplayResult(null);
    try { setReplayResult(asRow(await replay.mutateAsync({ comparisonId: selectedId }))); }
    catch (cause) { setError(errorText(cause)); }
  }

  return <Card data-testid="panel-b3-mode-comparison">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-2"><div>
      <CardTitle className="text-sm">Saved allocation-mode comparison</CardTitle>
      <CardDescription className="mt-1">Pair two frozen B2 policies with their own B3 validation runs. Matching provenance is checked by the server before saving.</CardDescription>
    </div><Badge variant="outline">Non-controlled · no winner</Badge></div></CardHeader>
    <CardContent className="space-y-4">
      <p className="rounded border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Capital fractions and signed active exposures have different meanings, feasible sets and return conventions. Results are descriptive, not a controlled performance contest.</p>
      {(error || allocationsQuery.isError || listQuery.isError || detailQuery.isError) && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error ?? (detailQuery.isError ? errorText(detailQuery.error) : listQuery.isError ? errorText(listQuery.error) : errorText(allocationsQuery.error))}</AlertDescription></Alert>}
      <div className="grid gap-3 md:grid-cols-2">{modes.map(mode => <fieldset key={mode} className="space-y-3 rounded border bg-muted/20 p-3"><legend className="px-1 text-xs font-semibold">{modeLabel(mode)}</legend>
        <div className="space-y-1"><Label htmlFor={`mode-policy-${mode}`}>Saved B2 allocation</Label><select id={`mode-policy-${mode}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid={`select-b3-mode-allocation-${mode}`} value={allocationIds[mode] ?? ""} onChange={event => setAllocationIds(current => ({ ...current, [mode]: event.target.value ? Number(event.target.value) : null }))}><option value="">Select solved alpha policy</option>{options[mode].map(item => <option key={item.id} value={item.id}>#{item.id} · {item.request.candidateIds.length} alphas · {item.createdAt}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor={`mode-run-${mode}`}>Saved B3 validation</Label><select id={`mode-run-${mode}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid={`select-b3-mode-validation-${mode}`} disabled={!allocationIds[mode]} value={validationRunIds[mode] ?? ""} onChange={event => setValidationRunIds(current => ({ ...current, [mode]: event.target.value ? Number(event.target.value) : null }))}><option value="">Select matching run</option>{validationRuns.filter(item => Number(item.allocationId) === allocationIds[mode] && item.status === "success").map(item => <option key={String(item.validationRunId)} value={Number(item.validationRunId)}>#{display(item.validationRunId)} · {display(item.status)} · {display(item.validatedAt)}</option>)}</select></div>
      </fieldset>)}</div>
      {allocationsQuery.isLoading && <div className="h-14 animate-pulse rounded border bg-muted/50" aria-label="Loading saved allocations" />}
      {!allocationsQuery.isLoading && modes.some(mode => !options[mode].length) && <p className="text-xs text-muted-foreground">A solved, saved alpha-stream B2 allocation is required in each mode. Validate both in B3 before comparing.</p>}
      <div className="flex flex-wrap gap-2"><Button size="sm" type="button" data-testid="button-b3-save-mode-comparison" disabled={create.isPending || !modes.every(mode => allocationIds[mode] && validationRunIds[mode])} onClick={() => void save()}>{create.isPending ? "Saving comparison…" : "Save comparison"}</Button>
        <Button size="sm" type="button" variant="outline" data-testid="button-b3-refresh-mode-comparisons" disabled={listQuery.isFetching || allocationsQuery.isFetching} onClick={() => { setError(null); void Promise.all([listQuery.refetch(), allocationsQuery.refetch()]); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button></div>
      <div className="flex flex-wrap items-end gap-2 border-t pt-3"><div className="min-w-56 flex-1 space-y-1"><Label htmlFor="saved-mode-comparison">Retrieve saved comparison</Label><select id="saved-mode-comparison" className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="select-b3-saved-mode-comparison" value={selectedId ?? ""} onChange={event => { setSelectedId(event.target.value ? Number(event.target.value) : null); setReplayResult(null); setError(null); }}><option value="">Select saved comparison</option>{saved.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.createdAt}</option>)}</select></div>
        {!listQuery.isLoading && !saved.length && <span className="pb-2 text-xs text-muted-foreground">No saved mode comparisons yet.</span>}
      </div>
      {detailQuery.isLoading && <div className="h-24 animate-pulse rounded border bg-muted/50" aria-label="Loading frozen comparison" />}
      {detail && <div className="space-y-3 border-t pt-3" data-testid="result-b3-mode-comparison">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-semibold">Comparison #{detail.id} · {display(result.comparisonClassification)}</h4><p className="text-xs text-muted-foreground">Saved {detail.createdAt} · manifest {detail.manifestHash.slice(0, 12)} · result {detail.resultHash.slice(0, 12)}</p></div><Button size="sm" variant="outline" type="button" data-testid="button-b3-replay-mode-comparison" disabled={replay.isPending} onClick={() => void replaySaved()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{replay.isPending ? "Replaying…" : "Replay frozen comparison"}</Button></div>
        <div className="grid gap-2 text-xs md:grid-cols-2"><div className="rounded border p-3"><strong>Capital long-only</strong><ModeSnapshot data={asRow(outcomes.CAPITAL_LONG_ONLY)} /></div><div className="rounded border p-3"><strong>Signed alpha overlay</strong><ModeSnapshot data={asRow(outcomes.SIGNED_OVERLAY)} /></div></div>
        <div className="rounded border bg-muted/20 p-3 text-xs"><strong>Semantic differences</strong><dl className="mt-2 grid gap-2 md:grid-cols-2"><div><dt className="font-medium">Capital structure</dt><dd className="text-muted-foreground">{display(semantics.allocationStructure)}</dd></div><div><dt className="font-medium">Return convention</dt><dd className="text-muted-foreground">{display(semantics.returnConvention)}</dd></div></dl><p className="mt-2">{display(semantics.interpretation)}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Inspect frozen objective and constraint semantics</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-2">{formatted(semantics.objectiveAndConstraints)}</pre></details></div>
        <p className="text-xs text-muted-foreground">{display(result.methodology)}</p>
        {replayResult && <div className="rounded border p-3 text-xs" data-testid="status-b3-mode-comparison-replay"><strong>Replay {display(replayResult.status)}</strong> · {Array.isArray(replayResult.differences) ? replayResult.differences.length : "—"} differing fields · maximum numeric difference {display(replayResult.maximumNumericDifference)}{Array.isArray(replayResult.differences) && replayResult.differences.length > 0 && <pre className="mt-2 whitespace-pre-wrap">{formatted(replayResult.differences)}</pre>}</div>}
      </div>}
    </CardContent>
  </Card>;
}

function ModeSnapshot({ data }: { data: Row }) {
  const exposure = asRow(data.exposures);
  return <div className="mt-2 space-y-1 font-mono text-[11px] tabular-nums">
    <p>B2 #{display(data.allocationId)} · B3 #{display(data.validationRunId)} · {display(data.b3Status)}</p>
    <p className="font-sans text-muted-foreground">{display(data.coefficientMeaning)}</p>
    <p>Estimated daily return {display(data.estimatedReturn)} · volatility {display(data.expectedDailyVolatility)}</p>
    <p>Alpha gross {display(exposure.alphaGrossExposure)} · asset gross {display(exposure.grossAssetExposure)}</p>
    <p>Long {display(exposure.longAssetExposure)} · short {display(exposure.shortAssetExposure)} · net {display(exposure.netAssetExposure)} · cash {display(data.totalCash)}</p>
    <p>Realized turnover notional {display(data.realizedTurnover)}</p>
    <details><summary className="cursor-pointer font-sans font-medium">Inspect coefficients, targets, and realized metrics</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{formatted({ coefficientsOrCapitalFractions: data.coefficientsOrCapitalFractions, underlyingAssetWeights: data.underlyingAssetWeights, realizedMetrics: data.realizedMetrics, objectiveAndConstraints: data.objectiveAndConstraints })}</pre></details>
  </div>;
}