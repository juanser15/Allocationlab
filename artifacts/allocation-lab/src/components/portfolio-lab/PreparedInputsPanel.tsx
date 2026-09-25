import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGetPreparedInputQueryKey,
  getListPreparedInputsQueryKey,
  useGetFactorLibrary,
  useGetPreparedInput,
  useGetPricesStatus,
  useListPreparedInputs,
  usePrepareInputs,
  type PreparedInput,
  type PreparedInputRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Plus, RefreshCw, Save, X } from "lucide-react";

type Representation = "asset_returns" | "signals" | "alpha_streams";
type Mapping = "single_asset_long_cash" | "cross_sectional_long_only";
type SignalUnits = "raw" | "oriented" | "normalized";
type AlphaDefinition = {
  name: string;
  factorId: string;
  assetTickers: string[];
  mapping: Mapping;
  signalUnits: SignalUnits;
  threshold: number;
  grossFraction: number;
  rebalanceFrequency: "monthly" | "quarterly";
  executionTiming: "next_close" | "same_close";
  transactionCostBps: number;
  slippageBps: number;
  cashYieldAnnual: number;
};

type ApiItem = Record<string, any>;

const REPRESENTATIONS: { value: Representation; label: string }[] = [
  { value: "asset_returns", label: "Asset Returns" },
  { value: "signals", label: "Signals" },
  { value: "alpha_streams", label: "Alpha Streams" },
];

const makeAlpha = (): AlphaDefinition => ({
  name: "Candidate alpha",
  factorId: "",
  assetTickers: [],
  mapping: "single_asset_long_cash",
  signalUnits: "oriented",
  threshold: 0,
  grossFraction: 1,
  rebalanceFrequency: "monthly",
  executionTiming: "next_close",
  transactionCostBps: 10,
  slippageBps: 5,
  cashYieldAnnual: 0,
});

function responseId(item: ApiItem): string | number | undefined {
  return item.id ?? item.preparedInputId ?? item.versionId ?? item.version;
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function findArray(item: ApiItem, keys: string[]): any[] {
  for (const key of keys) {
    if (Array.isArray(item?.[key])) return item[key];
  }
  return [];
}

function technicalState(item: ApiItem): string {
  const status = item?.technicalStatus ?? item?.status ?? item?.admissibility?.status;
  return typeof status === "string" ? status.toUpperCase() : "UNAVAILABLE";
}

export function PreparedInputsPanel() {
  const queryClient = useQueryClient();
  const { data: pricesStatus } = useGetPricesStatus();
  const { data: factorLibrary } = useGetFactorLibrary();
  const preparedInputsQuery = useListPreparedInputs({
    query: { queryKey: getListPreparedInputsQueryKey(), refetchOnMount: "always" },
  });
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersionQuery = useGetPreparedInput(selectedVersionId ?? 0, {
    query: {
      enabled: selectedVersionId !== null,
      queryKey: getGetPreparedInputQueryKey(selectedVersionId ?? 0),
    },
  });
  const prepareInputs = usePrepareInputs();
  const assets = pricesStatus?.tickers ?? [];
  const factors = factorLibrary?.factors ?? [];
  const [representation, setRepresentation] = useState<Representation>("asset_returns");
  const [assetTickers, setAssetTickers] = useState<string[]>([]);
  const [factorIds, setFactorIds] = useState<string[]>([]);
  const [alphaDefinitions, setAlphaDefinitions] = useState<AlphaDefinition[]>([]);
  const [cutoffDate, setCutoffDate] = useState("");
  const [activeItem, setActiveItem] = useState<ApiItem | null>(null);
  const [detailItem, setDetailItem] = useState<ApiItem | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedItems = (preparedInputsQuery.data ?? []) as unknown as ApiItem[];
  const loadingList = preparedInputsQuery.isLoading || preparedInputsQuery.isFetching;

  const selectedAssets = useMemo(() => new Set(assetTickers), [assetTickers]);
  const selectedFactors = useMemo(() => new Set(factorIds), [factorIds]);

  const loadSaved = useCallback(() => {
    void preparedInputsQuery.refetch();
  }, [preparedInputsQuery.refetch]);

  useEffect(() => {
    if (selectedVersionQuery.data) setActiveItem(selectedVersionQuery.data as unknown as ApiItem);
  }, [selectedVersionQuery.data]);

  const toggle = (values: string[], setValues: (value: string[]) => void, value: string) => {
    setValues(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  };

  const updateAlpha = (index: number, patch: Partial<AlphaDefinition>) => {
    setAlphaDefinitions(items => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  };

  const handlePrepare = async () => {
    setPreparing(true);
    setError(null);
    const payload: PreparedInputRequest = {
      representation,
      assetTickers,
      factorIds: representation === "asset_returns" ? [] : Array.from(new Set([
        ...factorIds,
        ...(representation === "alpha_streams" ? alphaDefinitions.map(alpha => alpha.factorId).filter(Boolean) : []),
      ])),
      alphaDefinitions: representation === "alpha_streams" ? alphaDefinitions : [],
      ...(cutoffDate ? { cutoffDate } : {}),
    };
    try {
      const created: PreparedInput = await prepareInputs.mutateAsync({ data: payload });
      setSelectedVersionId(null);
      setActiveItem(created as unknown as ApiItem);
      await queryClient.invalidateQueries({ queryKey: getListPreparedInputsQueryKey() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Input preparation failed.");
    } finally {
      setPreparing(false);
    }
  };

  const handleReload = (item: ApiItem) => {
    const id = responseId(item);
    if (id === undefined || !Number.isFinite(Number(id))) {
      setError("This saved version did not include an identifier and cannot be reloaded.");
      return;
    }
    setError(null);
    setActiveItem(null);
    setSelectedVersionId(Number(id));
  };

  const selectedOutput = activeItem ?? detailItem;
  const returnedAlphas = selectedOutput ? findArray(selectedOutput, ["alphaStreams", "streams", "alphaResults"]) : [];
  const returnedCandidates = selectedOutput ? findArray(selectedOutput, ["candidates"]) : [];
  const snapshot = selectedOutput?.snapshot;
  const diagnostics = selectedOutput?.dependenceDiagnostics ?? selectedOutput?.dependence ?? selectedOutput?.diagnostics
    ?? snapshot?.dependenceDiagnostics ?? snapshot?.dependence ?? snapshot?.diagnostics;
  const coverage = selectedOutput?.coverage ?? selectedOutput?.coverageStatus ?? snapshot?.coverage ?? snapshot?.coverageStatus;
  const status = selectedOutput ? technicalState(selectedOutput) : "INPUTS PREPARED";
  const queryError = selectedVersionQuery.error ?? preparedInputsQuery.error;

  return (
    <section className="space-y-4" aria-label="Portfolio input preparation">
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Optimization Inputs</CardTitle>
              <CardDescription className="mt-1">Select input representations and save an auditable preparation version. This does not run an optimizer.</CardDescription>
            </div>
            <Badge variant="outline" data-testid="status-inputs-prepared">INPUTS PREPARED · NOT OPTIMIZED / VALIDATED</Badge>
          </div>
          <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label="Input representation">
            {REPRESENTATIONS.map(option => (
              <Button
                key={option.value}
                type="button"
                variant={representation === option.value ? "default" : "outline"}
                size="sm"
                data-testid={`select-representation-${option.value}`}
                onClick={() => setRepresentation(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {(error || preparedInputsQuery.isError || selectedVersionQuery.isError) && (
            <Alert variant="destructive" data-testid="status-prepared-input-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error ?? `Prepared-input API unavailable: ${queryError instanceof Error ? queryError.message : "API request failed."}`}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Selected inputs</h3>
                <p className="text-xs text-muted-foreground">Available tickers and definitions come from current uploaded price and factor-library data.</p>
              </div>
              <div className="space-y-2">
                <Label>Assets</Label>
                {!assets.length ? <p className="text-xs text-amber-700">Asset coverage unavailable: no tickers are currently reported by the price-data API.</p> : (
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                    {assets.map(ticker => (
                      <label key={ticker} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                        <input type="checkbox" checked={selectedAssets.has(ticker)} onChange={() => toggle(assetTickers, setAssetTickers, ticker)} data-testid={`input-asset-${ticker}`} />
                        {ticker}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {representation !== "asset_returns" && (
                <div className="space-y-2">
                  <Label>Factor / signal definitions</Label>
                  {!factors.length ? <p className="text-xs text-amber-700">Signal definitions unavailable: factor-library data has not loaded.</p> : (
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {factors.map(factor => (
                        <label key={factor.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                          <input type="checkbox" checked={selectedFactors.has(factor.id)} onChange={() => toggle(factorIds, setFactorIds, factor.id)} data-testid={`input-factor-${factor.id}`} />
                          <span className="font-medium">{factor.name}</span><span className="text-muted-foreground">{factor.id}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="prepared-cutoff">Information cutoff (optional)</Label>
                  <Input id="prepared-cutoff" type="date" value={cutoffDate} onChange={event => setCutoffDate(event.target.value)} data-testid="input-prepared-cutoff" />
                </div>
                <div className="self-end text-xs text-muted-foreground">
                  Current price-data coverage: {pricesStatus?.hasData ? `${pricesStatus.startDate ?? "Unavailable"} – ${pricesStatus.endDate ?? "Unavailable"} · ${pricesStatus.rowCount} rows` : "Unavailable"}
                </div>
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Definition and position mapping</h3>
                <p className="text-xs text-muted-foreground">Alpha streams require an explicit factor, asset universe, mapping, capital fraction, schedule, and execution assumptions.</p>
              </div>
              {representation !== "alpha_streams" ? (
                <div className="rounded bg-muted/40 p-3 text-xs text-muted-foreground">
                  {representation === "asset_returns"
                    ? "Asset Returns retains dated price/return input identity and coverage. No exposure mapping or deployable allocation is implied."
                    : "Signals remain predictive factor observations; they are not treated as expected returns or tradable returns without an explicit stream definition."}
                </div>
              ) : (
                <div className="space-y-3">
                  {alphaDefinitions.map((alpha, index) => (
                    <div key={index} className="space-y-3 rounded border p-3" data-testid={`card-alpha-definition-${index}`}>
                      <div className="flex items-center justify-between gap-2">
                        <Input aria-label="Alpha definition name" value={alpha.name} onChange={event => updateAlpha(index, { name: event.target.value })} data-testid={`input-alpha-name-${index}`} />
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove alpha candidate" onClick={() => setAlphaDefinitions(items => items.filter((_, i) => i !== index))} data-testid={`button-remove-alpha-${index}`}><X className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Factor</Label>
                          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={alpha.factorId} onChange={event => updateAlpha(index, { factorId: event.target.value })} data-testid={`select-alpha-factor-${index}`}>
                            <option value="">Select defined factor</option>
                            {factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name} · {factor.id}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label>Position mapping</Label>
                          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={alpha.mapping} onChange={event => updateAlpha(index, { mapping: event.target.value as Mapping })} data-testid={`select-alpha-mapping-${index}`}>
                            <option value="single_asset_long_cash">Single-asset long / cash</option>
                            <option value="cross_sectional_long_only">Cross-sectional long-only</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label>Signal units</Label>
                          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={alpha.signalUnits} onChange={event => updateAlpha(index, { signalUnits: event.target.value as SignalUnits })} data-testid={`select-alpha-units-${index}`}>
                            <option value="raw">Raw</option><option value="oriented">Oriented</option><option value="normalized">Normalized</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label>Applicable assets</Label>
                          <select multiple className="h-20 w-full rounded-md border bg-background px-2 py-1 text-xs" value={alpha.assetTickers} onChange={event => updateAlpha(index, { assetTickers: Array.from(event.target.selectedOptions, option => option.value) })} data-testid={`select-alpha-assets-${index}`}>
                            {assets.map(ticker => <option key={ticker} value={ticker}>{ticker}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1"><Label>Threshold q</Label><Input type="number" step="any" value={alpha.threshold} onChange={event => updateAlpha(index, { threshold: Number(event.target.value) })} data-testid={`input-alpha-threshold-${index}`} /></div>
                        <div className="space-y-1"><Label>Gross fraction g (0–1)</Label><Input type="number" min="0" max="1" step="any" value={alpha.grossFraction} onChange={event => updateAlpha(index, { grossFraction: Number(event.target.value) })} data-testid={`input-alpha-gross-${index}`} /></div>
                        <div className="space-y-1"><Label>Rebalance</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={alpha.rebalanceFrequency} onChange={event => updateAlpha(index, { rebalanceFrequency: event.target.value as AlphaDefinition["rebalanceFrequency"] })} data-testid={`select-alpha-frequency-${index}`}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
                        <div className="space-y-1"><Label>Execution timing</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={alpha.executionTiming} onChange={event => updateAlpha(index, { executionTiming: event.target.value as AlphaDefinition["executionTiming"] })} data-testid={`select-alpha-timing-${index}`}><option value="next_close">Next close</option><option value="same_close">Same close</option></select></div>
                        <div className="space-y-1"><Label>Transaction cost (bps)</Label><Input type="number" min="0" step="any" value={alpha.transactionCostBps} onChange={event => updateAlpha(index, { transactionCostBps: Number(event.target.value) })} data-testid={`input-alpha-cost-${index}`} /></div>
                        <div className="space-y-1"><Label>Slippage (bps)</Label><Input type="number" min="0" step="any" value={alpha.slippageBps} onChange={event => updateAlpha(index, { slippageBps: Number(event.target.value) })} data-testid={`input-alpha-slippage-${index}`} /></div>
                        <div className="space-y-1"><Label>Annual cash yield (decimal, ≤0.20)</Label><Input type="number" min="0" max="0.2" step="any" value={alpha.cashYieldAnnual} onChange={event => updateAlpha(index, { cashYieldAnnual: Number(event.target.value) })} data-testid={`input-alpha-cash-yield-${index}`} /></div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Reference capital is the stream’s own capital; unused fraction remains cash. Candidate removal only changes this working draft; saved versions remain archived.</p>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setAlphaDefinitions(items => [...items, { ...makeAlpha(), factorId: factorIds[0] ?? "", assetTickers }])} data-testid="button-add-alpha">
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add candidate
                  </Button>
                  {!alphaDefinitions.length && <p className="text-xs text-muted-foreground">No candidate definitions selected. Add a definition to prepare alpha streams.</p>}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handlePrepare} disabled={preparing || !assetTickers.length || (representation === "signals" && !factorIds.length) || (representation === "alpha_streams" && (!alphaDefinitions.length || alphaDefinitions.some(alpha => !alpha.name.trim() || !alpha.factorId || !alpha.assetTickers.length || (alpha.mapping === "single_asset_long_cash" && alpha.assetTickers.length !== 1) || (alpha.mapping === "cross_sectional_long_only" && alpha.assetTickers.length < 2) || alpha.grossFraction < 0 || alpha.grossFraction > 1 || alpha.transactionCostBps < 0 || alpha.transactionCostBps > 500 || alpha.slippageBps < 0 || alpha.slippageBps > 500 || alpha.cashYieldAnnual < 0 || alpha.cashYieldAnnual > 0.2)))} data-testid="button-prepare-inputs">
              {preparing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing…</> : <><Save className="mr-2 h-4 w-4" />Prepare Inputs</>}
            </Button>
            <span className="text-xs text-muted-foreground">Preparation is explicit; edits do not trigger historical recomputation.</span>
          </div>
        </CardContent>
      </Card>

      {selectedOutput && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><CardTitle className="text-sm">Prepared version details</CardTitle><CardDescription>Technical admissibility describes usability only—not profitability, optimization, or validation.</CardDescription></div>
              <Badge variant="outline" data-testid="status-prepared-technical">{status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded border p-3"><h4 className="mb-1 text-xs font-semibold">Coverage and technical status</h4><pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{display(coverage ?? selectedOutput?.technicalStatus ?? selectedOutput?.admissibility ?? selectedOutput?.status)}</pre></div>
            <div className="rounded border p-3"><h4 className="mb-1 text-xs font-semibold">Dependence diagnostics</h4><pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{display(diagnostics)}</pre></div>
            <div className="md:col-span-2 rounded border p-3">
              <h4 className="mb-2 text-xs font-semibold">Selected inputs and candidate status</h4>
              {returnedCandidates.length ? <div className="space-y-1">{returnedCandidates.map((candidate, index) => <button key={candidate.id ?? candidate.factorId ?? index} type="button" className="flex w-full items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => setDetailItem({ ...selectedOutput, selectedCandidate: candidate })} data-testid={`button-open-candidate-${index}`}><span>{candidate.name ?? candidate.ticker ?? candidate.factorId ?? `Candidate ${index + 1}`}</span><Badge variant="outline">{technicalState(candidate)}</Badge></button>)}</div> : <p className="text-xs text-muted-foreground">Candidate-level preparation results unavailable in the API response.</p>}
              {returnedAlphas.length > 0 && <div className="mt-3 space-y-1">{returnedAlphas.map((stream, index) => <button key={stream.id ?? stream.name ?? index} type="button" className="flex w-full items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => setDetailItem({ ...selectedOutput, selectedStream: stream })} data-testid={`button-open-alpha-stream-${index}`}><span>{stream.name ?? `Alpha stream ${index + 1}`}</span><Badge variant="outline">{technicalState(stream)}</Badge></button>)}</div>}
              {!returnedCandidates.length && !returnedAlphas.length && <p className="mt-2 text-xs text-muted-foreground">No candidate or stream output is available to display.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div><CardTitle className="text-sm">Saved prepared-input versions</CardTitle><CardDescription>Reload a saved immutable preparation. Removing working candidates never deletes these versions.</CardDescription></div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadSaved()} disabled={loadingList} data-testid="button-refresh-prepared-inputs"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`} />Refresh</Button>
        </CardHeader>
        <CardContent>
          {loadingList ? <p className="text-xs text-muted-foreground">Loading saved versions…</p> : savedItems.length ? (
            <div className="space-y-2">{savedItems.map((item, index) => {
              const id = responseId(item);
              return <div key={id ?? index} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2" data-testid={`row-prepared-version-${id ?? index}`}>
                <div className="min-w-0"><p className="truncate text-xs font-medium">{item.name ?? item.label ?? `Prepared inputs ${id ?? index + 1}`}</p><p className="text-[11px] text-muted-foreground">{item.representation ?? item.inputs?.representation ?? "Representation unavailable"} · {item.createdAt ?? item.preparedAt ?? "Date unavailable"} · {id !== undefined ? `ID ${id}` : "Version ID unavailable"}</p></div>
                <Button type="button" size="sm" variant="outline" disabled={id === undefined} onClick={() => handleReload(item)} data-testid={`button-reload-prepared-${id ?? index}`}>Reload</Button>
              </div>;
            })}</div>
          ) : <p className="text-xs text-muted-foreground">No saved versions are available. If this list is unexpectedly empty, check the API response or connection.</p>}
        </CardContent>
      </Card>

      <DetailDrawer
        open={!!detailItem}
        onOpenChange={open => !open && setDetailItem(null)}
        title="Signal → target → executed position → P&L"
        description="Values shown only when returned by the prepared-input service. Missing fields are explicitly unavailable."
      >
        {detailItem && (() => {
          const record = detailItem.selectedCandidate ?? detailItem.selectedStream ?? detailItem;
          const signals = findArray(record, ["signalSeries"]);
          const targets = findArray(record, ["targetHistory"]);
          const ledger = findArray(record, ["ledger"]);
          const numberOrDash = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—";
          return <div className="space-y-3">
            <div className="rounded border p-3">
              <h4 className="mb-2 text-xs font-semibold">Definition / formula and mapping</h4>
              <p className="text-xs"><span className="font-medium">Candidate:</span> {display(record.name)} · <span className="font-medium">Status:</span> {technicalState(record)}</p>
              <p className="mt-1 text-xs"><span className="font-medium">Factor:</span> {display(record.factorId)} · <span className="font-medium">Mapping:</span> {display(record.mapping)} · <span className="font-medium">Signal units:</span> {display(record.signalUnits)}</p>
              <p className="mt-1 text-xs"><span className="font-medium">Target asset exposures:</span> {display(record.targetAssetExposures)} · <span className="font-medium">Latest actual exposures:</span> {display(record.actualAssetExposures)} · <span className="font-medium">Residual cash:</span> {display(record.residualCash)}</p>
              {Array.isArray(record.reasons) && record.reasons.length > 0 && <p className="mt-2 text-xs text-amber-700">Technical reasons: {record.reasons.join(" ")}</p>}
              {record.lineage?.formula && <p className="mt-2 text-xs"><span className="font-medium">Executable factor formula:</span> {record.lineage.formula}</p>}
            </div>
            <div className="rounded border p-3">
              <h4 className="mb-2 text-xs font-semibold">Signal observations → target history</h4>
              {!signals.length && !targets.length ? <p className="text-xs text-muted-foreground">This candidate has no signal or target history (for example, asset-return-only inputs or an incomplete stream).</p> : (
                <div className="max-h-64 overflow-auto">
                  <table className="w-full border-collapse text-[10px]">
                    <thead className="sticky top-0 bg-muted"><tr><th className="p-1 text-left">Signal date</th><th className="p-1 text-left">Info cutoff</th><th className="p-1 text-right">Signal</th><th className="p-1 text-left">Execution date</th><th className="p-1 text-left">Target positions</th></tr></thead>
                    <tbody>{(signals.length ? signals : targets).map((signal: any, index) => {
                      const target = targets.find((item: any) => item.signalDate === signal.date);
                      const positionMap = target?.targetPositions;
                      return <tr key={`${signal.date ?? signal.signalDate ?? "row"}-${index}`} className="border-t">
                        <td className="p-1">{signal.date ?? signal.signalDate ?? "—"}</td>
                        <td className="p-1">{signal.informationCutoff ?? target?.informationCutoff ?? "—"}</td>
                        <td className="p-1 text-right tabular-nums">{numberOrDash(signal.value)}</td>
                        <td className="p-1">{target?.executionDate ?? "—"}</td>
                        <td className="p-1">{positionMap && Object.keys(positionMap).length ? Object.entries(positionMap).map(([ticker, weight]) => `${ticker} ${numberOrDash(weight)}`).join(", ") : "No target available"}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded border p-3">
              <h4 className="mb-2 text-xs font-semibold">Actual executed / held positions (A1 ledger)</h4>
              {!ledger.length ? <p className="text-xs text-muted-foreground">No execution ledger was returned for this candidate; actual holdings are not inferred from target exposure.</p> : (
                <div className="max-h-56 overflow-auto">
                  <table className="w-full border-collapse text-[10px]">
                    <thead className="sticky top-0 bg-muted"><tr><th className="p-1 text-left">Date</th><th className="p-1 text-left">Ticker</th><th className="p-1 text-right">Quantity</th><th className="p-1 text-right">Price</th><th className="p-1 text-right">Market value</th><th className="p-1 text-right">Weight</th></tr></thead>
                    <tbody>{ledger.flatMap((entry: any, entryIndex) => Array.isArray(entry.endingPositions) && entry.endingPositions.length
                      ? entry.endingPositions.map((position: any, positionIndex: number) => <tr key={`${entry.date}-${position.ticker}-${entryIndex}-${positionIndex}`} className="border-t">
                        <td className="p-1">{entry.date}</td><td className="p-1">{position.ticker}</td><td className="p-1 text-right tabular-nums">{numberOrDash(position.quantity)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(position.price)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(position.marketValue)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(position.weight)}</td>
                      </tr>)
                      : [<tr key={`${entry.date ?? entryIndex}-cash`} className="border-t"><td className="p-1">{entry.date ?? "—"}</td><td className="p-1">Cash / no holdings</td><td colSpan={4} className="p-1 text-right">Cash {numberOrDash(entry.endingCash)}</td></tr>])}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded border p-3">
              <h4 className="mb-2 text-xs font-semibold">Ledger P&amp;L: asset · cash · costs · net return</h4>
              {!ledger.length ? <p className="text-xs text-muted-foreground">No realized ledger P&amp;L is available for this candidate.</p> : (
                <div className="max-h-56 overflow-auto">
                  <table className="w-full border-collapse text-[10px]">
                    <thead className="sticky top-0 bg-muted"><tr><th className="p-1 text-left">Date</th><th className="p-1 text-right">Asset P&amp;L</th><th className="p-1 text-right">Cash P&amp;L</th><th className="p-1 text-right">Transaction costs</th><th className="p-1 text-right">Slippage</th><th className="p-1 text-right">Net P&amp;L</th><th className="p-1 text-right">Net return</th></tr></thead>
                    <tbody>{ledger.map((entry: any, index) => <tr key={`${entry.date ?? "ledger"}-${index}`} className="border-t">
                      <td className="p-1">{entry.date ?? "—"}</td><td className="p-1 text-right tabular-nums">{numberOrDash(entry.etfPnl)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(entry.cashPnl)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(entry.transactionCosts)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(entry.slippage)}</td><td className="p-1 text-right tabular-nums">{numberOrDash(entry.netPnl)}</td><td className="p-1 text-right tabular-nums">{entry.beginningNav > 0 && typeof entry.netPnl === "number" ? numberOrDash(entry.netPnl / entry.beginningNav) : "—"}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>;
        })()}
      </DetailDrawer>
    </section>
  );
}