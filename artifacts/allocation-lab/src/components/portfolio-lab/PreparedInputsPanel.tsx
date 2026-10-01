import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getGetPreparedInputQueryKey,
  getListPreparedInputSummariesQueryKey,
  useGetFactorLibrary,
  useGetPreparedInput,
  useGetPricesStatus,
  useGetUniverse,
  useListPreparedInputSummaries,
  usePrepareInputs,
  type PreparedInput,
  type PreparedInputRequest,
  type PreparedInputSummary,
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
import {
  filterSelectionOptions,
  groupSelectionOptions,
  PREPARED_REPRESENTATIONS,
  representationFields,
  updateBulkSelection,
  type SelectionFilter,
  type SelectionOption,
} from "./prepared-input-selection";

type Representation = typeof PREPARED_REPRESENTATIONS[number]["value"];
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
export type B2PreparedSelection = {
  preparedInputId: number;
  representation: Representation;
  candidateIds: string[];
  candidateNames: Record<string, string>;
  returnDatesByCandidate: Record<string, string[]>;
  informationCutoff: string;
  draftReady?: boolean;
  draftRepresentation?: Representation;
};

type PreparedInputsPanelProps = {
  b2Mode?: boolean;
  onB2ModeChange?: (enabled: boolean) => void;
  onPreparedSelectionChange?: (selection: B2PreparedSelection | null) => void;
};

type SelectionPickerProps = {
  options: SelectionOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  noun: string;
  testId: string;
  groupBySector?: boolean;
};

function SelectionPicker({ options, selectedIds, onChange, noun, testId, groupBySector = false }: SelectionPickerProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SelectionFilter>("all");
  const [groupBy, setGroupBy] = useState(groupBySector);
  const visibleOptions = useMemo(
    () => filterSelectionOptions(options, search, filter, selectedIds),
    [options, search, filter, selectedIds],
  );
  const groups = useMemo(
    () => groupSelectionOptions(visibleOptions, groupBy),
    [visibleOptions, groupBy],
  );
  const visibleIds = visibleOptions.map(option => option.id);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const update = (ids: string[], mode: "select" | "clear") => onChange(updateBulkSelection(selectedIds, ids, mode));

  return (
    <div className="space-y-2" data-testid={`${testId}-picker`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          type="search"
          aria-label={`Search ${noun.toLowerCase()}`}
          placeholder={`Search ${noun.toLowerCase()}…`}
          value={search}
          onChange={event => setSearch(event.target.value)}
          data-testid={`${testId}-search`}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-xs"
          aria-label={`Filter ${noun.toLowerCase()} selection`}
          value={filter}
          onChange={event => setFilter(event.target.value as SelectionFilter)}
          data-testid={`${testId}-filter`}
        >
          <option value="all">All</option>
          <option value="selected">Selected</option>
          <option value="unselected">Not selected</option>
        </select>
      </div>
      {groupBySector && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={groupBy}
              onChange={event => setGroupBy(event.target.checked)}
              data-testid={`${testId}-group-by-sector`}
            />
            Group by Universe sector
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={() => update(visibleIds, "select")} data-testid={`${testId}-select-visible`}>
          Select visible ({visibleIds.length})
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => update(visibleIds, "clear")} data-testid={`${testId}-clear-visible`}>
          Clear visible ({visibleIds.length})
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(updateBulkSelection([], options.map(option => option.id), "select"))} data-testid={`${testId}-select-all`}>
          Select all {noun.toLowerCase()} ({options.length})
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])} data-testid={`${testId}-clear-all`}>
          Clear all {noun.toLowerCase()}
        </Button>
      </div>
      <div className="max-h-40 space-y-2 overflow-y-auto rounded border p-2">
        {!visibleOptions.length ? (
          <p className="text-xs text-muted-foreground">{options.length ? "No options match this search and filter." : `No ${noun.toLowerCase()} are available.`}</p>
        ) : groups.map(group => (
          <div key={group.label || "ungrouped"} className="space-y-1">
            {group.label && (
              <div className="sticky top-0 flex flex-wrap items-center justify-between gap-1 bg-background px-1 py-0.5">
                <span className="text-[11px] font-semibold text-muted-foreground">{group.label}</span>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => update(group.options.map(option => option.id), "select")} aria-label={`Select visible ${noun.toLowerCase()} in ${group.label}`}>
                    Select group ({group.options.length})
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => update(group.options.map(option => option.id), "clear")} aria-label={`Clear visible ${noun.toLowerCase()} in ${group.label}`}>
                    Clear group
                  </Button>
                </div>
              </div>
            )}
            <div className={groupBy ? "space-y-1" : "flex flex-wrap gap-2"}>
              {group.options.map(option => (
                <label key={option.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.has(option.id)}
                    onChange={() => onChange(updateBulkSelection(selectedIds, [option.id], selected.has(option.id) ? "clear" : "select"))}
                    data-testid={`${testId}-option-${option.id}`}
                  />
                  <span className="font-medium">{option.label}</span>
                  {option.label !== option.id && <span className="text-muted-foreground">{option.id}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground" aria-live="polite">{selectedIds.length} selected · {visibleOptions.length} visible. Search and filters do not change selection.</p>
    </div>
  );
}

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

function preparedDraftSignature(
  representation: Representation,
  assetTickers: string[],
  factorIds: string[],
  alphaDefinitions: AlphaDefinition[],
  cutoffDate: string,
): string {
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
  return JSON.stringify(payload);
}

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

export function PreparedInputsPanel({ b2Mode = false, onB2ModeChange, onPreparedSelectionChange }: PreparedInputsPanelProps) {
  const queryClient = useQueryClient();
  const { data: pricesStatus } = useGetPricesStatus();
  const { data: factorLibrary } = useGetFactorLibrary();
  const { data: universe } = useGetUniverse();
  const preparedInputsQuery = useListPreparedInputSummaries({
    query: { queryKey: getListPreparedInputSummariesQueryKey(), refetchOnMount: "always" },
  });
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersionIdRef = useRef<number | null>(null);
  const selectedVersionQuery = useGetPreparedInput(selectedVersionId ?? 0, {
    query: {
      enabled: selectedVersionId !== null,
      queryKey: getGetPreparedInputQueryKey(selectedVersionId ?? 0),
      refetchOnMount: "always",
    },
  });
  const [inspectionVersionId, setInspectionVersionId] = useState<number | null>(null);
  const inspectionVersionQuery = useGetPreparedInput(inspectionVersionId ?? 0, {
    query: {
      enabled: inspectionVersionId !== null,
      queryKey: getGetPreparedInputQueryKey(inspectionVersionId ?? 0),
      refetchOnMount: "always",
    },
  });
  const prepareInputs = usePrepareInputs();
  const assets = pricesStatus?.tickers ?? [];
  const factors = factorLibrary?.factors ?? [];
  const universeSectors = useMemo(() => {
    const sectorsByTicker = new Map<string, string>();
    for (const etf of universe?.etfs ?? []) {
      if (typeof etf.ticker === "string" && typeof etf.sector === "string" && etf.sector.trim()) {
        sectorsByTicker.set(etf.ticker, etf.sector.trim());
      }
    }
    return sectorsByTicker;
  }, [universe?.etfs]);
  const assetOptions = useMemo<SelectionOption[]>(
    () => assets.map(ticker => ({ id: ticker, label: ticker, group: universeSectors.get(ticker) })),
    [assets, universeSectors],
  );
  const factorOptions = useMemo<SelectionOption[]>(
    () => factors.map(factor => ({ id: factor.id, label: factor.name })),
    [factors],
  );
  const [representation, setRepresentation] = useState<Representation>("asset_returns");
  const [assetTickers, setAssetTickers] = useState<string[]>([]);
  const [factorIds, setFactorIds] = useState<string[]>([]);
  const [alphaDefinitions, setAlphaDefinitions] = useState<AlphaDefinition[]>([]);
  const [cutoffDate, setCutoffDate] = useState("");
  const [activeItem, setActiveItem] = useState<ApiItem | null>(null);
  const [detailItem, setDetailItem] = useState<ApiItem | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedDraftSignature, setAcceptedDraftSignature] = useState<string | null>(null);
  const currentDraftSignature = preparedDraftSignature(representation, assetTickers, factorIds, alphaDefinitions, cutoffDate);
  const activeItemId = activeItem ? Number(responseId(activeItem)) : null;
  const selectedVersionMatchesActive = selectedVersionId === null || activeItemId === selectedVersionId;
  const selectedVersionData = selectedVersionQuery.data as unknown as ApiItem | undefined;
  const selectedVersionResponseValid = selectedVersionId !== null && selectedVersionData !== undefined &&
    Number(responseId(selectedVersionData)) === selectedVersionId &&
    !!selectedVersionData.snapshot && Array.isArray(selectedVersionData.candidates);
  const selectedVersionInvalidResponse = selectedVersionId !== null && !selectedVersionQuery.isFetching &&
    !selectedVersionQuery.isError && selectedVersionData !== undefined && !selectedVersionResponseValid;
  const selectedVersionLoading = selectedVersionId !== null &&
    !selectedVersionQuery.isError && !selectedVersionInvalidResponse &&
    (selectedVersionQuery.isFetching || !selectedVersionMatchesActive);
  const selectedVersionFailed = selectedVersionId !== null &&
    !selectedVersionMatchesActive && (selectedVersionQuery.isError || selectedVersionInvalidResponse);
  const draftReady = acceptedDraftSignature !== null && acceptedDraftSignature === currentDraftSignature &&
    selectedVersionMatchesActive && !(selectedVersionId !== null && selectedVersionQuery.isFetching);
  const draftChanged = acceptedDraftSignature !== null && acceptedDraftSignature !== currentDraftSignature;
  const inspectionData = inspectionVersionQuery.data as unknown as ApiItem | undefined;
  const inspectedSavedItem = inspectionVersionId !== null && !inspectionVersionQuery.isFetching &&
    !inspectionVersionQuery.isError && Number(responseId(inspectionData ?? {})) === inspectionVersionId
    && !!inspectionData?.snapshot && Array.isArray(inspectionData.candidates)
    ? inspectionData
    : null;
  const inspectionInvalidResponse = inspectionVersionId !== null && !inspectionVersionQuery.isFetching &&
    !inspectionVersionQuery.isError && inspectionData !== undefined && inspectedSavedItem === null;
  const savedItems = (preparedInputsQuery.data ?? []) as PreparedInputSummary[];
  const loadingList = preparedInputsQuery.isLoading || preparedInputsQuery.isFetching;

  const activeRepresentationFields = representationFields(representation);

  const loadSaved = useCallback(() => {
    void preparedInputsQuery.refetch();
  }, [preparedInputsQuery.refetch]);

  useEffect(() => {
    const selected = selectedVersionQuery.data as unknown as ApiItem | undefined;
    if (!selected || selectedVersionQuery.isFetching || selectedVersionQuery.isError ||
        selectedVersionId === null || selectedVersionIdRef.current !== selectedVersionId ||
        Number(responseId(selected)) !== selectedVersionId ||
        !selected.snapshot || !Array.isArray(selected.candidates)) return;
    setActiveItem(selected);
  }, [selectedVersionQuery.data, selectedVersionQuery.isFetching, selectedVersionQuery.isError, selectedVersionId]);

  useEffect(() => {
    if (!onPreparedSelectionChange) return;
    const output = activeItem;
    const id = output && responseId(output);
    const snapshot = output?.snapshot;
    const candidates = Array.isArray(output?.candidates) ? output.candidates : null;
    const sourceRepresentation = output?.representation ?? snapshot?.representation;
    if (!id || !snapshot || !candidates || !Number.isSafeInteger(Number(id)) ||
        !["asset_returns", "alpha_streams", "signals"].includes(sourceRepresentation)) {
      onPreparedSelectionChange(null);
      return;
    }
    const candidateNames: Record<string, string> = {};
    const returnDatesByCandidate: Record<string, string[]> = {};
    const candidateIds = candidates.map(candidate => {
      const candidateId = candidate.candidateId;
      if (typeof candidateId === "string") {
        candidateNames[candidateId] = candidate.name ?? candidateId;
        const returns: string[] = Array.isArray(candidate.returnSeries)
          ? candidate.returnSeries.filter((point: ApiItem) => typeof point.date === "string" &&
              typeof point.value === "number" && Number.isFinite(point.value)).map((point: ApiItem) => point.date as string)
          : [];
        returnDatesByCandidate[candidateId] = Array.from(new Set<string>(returns)).sort();
      }
      return candidateId;
    }).filter((candidateId): candidateId is string => typeof candidateId === "string");
    onPreparedSelectionChange({
      preparedInputId: Number(id),
      representation: sourceRepresentation,
      candidateIds: Array.from(new Set(candidateIds)),
      candidateNames,
      returnDatesByCandidate,
      informationCutoff: snapshot?.request?.cutoffDate ?? "",
      draftReady,
      draftRepresentation: representation,
    });
  }, [activeItem, acceptedDraftSignature, currentDraftSignature, draftReady, onPreparedSelectionChange, representation]);

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
    const submittedDraftSignature = JSON.stringify(payload);
    try {
      const created: PreparedInput = await prepareInputs.mutateAsync({ data: payload });
      setAcceptedDraftSignature(submittedDraftSignature);
      selectedVersionIdRef.current = null;
      setSelectedVersionId(null);
      setInspectionVersionId(null);
      setActiveItem(created as unknown as ApiItem);
      await queryClient.invalidateQueries({ queryKey: getListPreparedInputSummariesQueryKey() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Input preparation failed.");
    } finally {
      setPreparing(false);
    }
  };

  const handleReload = (item: Pick<PreparedInputSummary, "preparedInputId">) => {
    const id = responseId(item);
    const numericId = Number(id);
    if (id === undefined || !Number.isSafeInteger(numericId) || numericId < 1) {
      setError("This saved version did not include an identifier and cannot be reloaded.");
      return;
    }
    setError(null);
    setAcceptedDraftSignature(currentDraftSignature);
    selectedVersionIdRef.current = numericId;
    setInspectionVersionId(null);
    setDetailItem(null);
    setSelectedVersionId(numericId);
    void queryClient.invalidateQueries({ queryKey: getGetPreparedInputQueryKey(numericId) });
  };

  const handleInspectSaved = (item: Pick<PreparedInputSummary, "preparedInputId">) => {
    const id = responseId(item);
    const numericId = Number(id);
    if (id === undefined || !Number.isSafeInteger(numericId) || numericId < 1) {
      setError("This saved version did not include an identifier and cannot be inspected.");
      return;
    }
    setError(null);
    setDetailItem(null);
    setInspectionVersionId(numericId);
    void queryClient.invalidateQueries({ queryKey: getGetPreparedInputQueryKey(numericId) });
  };

  const selectedOutput = inspectedSavedItem ?? activeItem ?? detailItem;
  const returnedAlphas = selectedOutput ? findArray(selectedOutput, ["alphaStreams", "streams", "alphaResults"]) : [];
  const returnedCandidates = selectedOutput ? findArray(selectedOutput, ["candidates"]) : [];
  const snapshot = selectedOutput?.snapshot;
  const diagnostics = selectedOutput?.dependenceDiagnostics ?? selectedOutput?.dependence ?? selectedOutput?.diagnostics
    ?? snapshot?.dependenceDiagnostics ?? snapshot?.dependence ?? snapshot?.diagnostics;
  const coverage = selectedOutput?.coverage ?? selectedOutput?.coverageStatus ?? snapshot?.coverage ?? snapshot?.coverageStatus;
  const status = selectedOutput ? technicalState(selectedOutput) : "DRAFT · PREPARE REQUIRED";
  const activeSourceId = activeItem ? responseId(activeItem) : undefined;
  const activeSourceRepresentation = activeItem?.representation ?? activeItem?.snapshot?.representation;
  const queryError = selectedVersionQuery.error ?? inspectionVersionQuery.error ?? preparedInputsQuery.error;

  return (
    <section className="space-y-4" aria-label="Portfolio input preparation">
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">B1 · Prepare &amp; freeze Inputs</CardTitle>
              <CardDescription className="mt-1">Choose one input representation and explicitly save an auditable preparation version. Draft edits never preview, recompute, or run a downstream optimizer.</CardDescription>
            </div>
            <Badge variant="outline" data-testid="status-inputs-prepared">
              {selectedVersionLoading
                ? `LOADING SAVED SOURCE #${selectedVersionId}`
                : selectedVersionFailed
                  ? `SAVED SOURCE #${selectedVersionId} NOT LOADED`
                  : !activeItem
                ? "DRAFT · PREPARE REQUIRED"
                : draftReady
                  ? `FROZEN SOURCE #${activeSourceId} · NOT OPTIMIZED / VALIDATED`
                  : "DRAFT CHANGED · PREPARE & FREEZE REQUIRED"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label="Input representation">
            {PREPARED_REPRESENTATIONS.map(option => (
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
          {(error || preparedInputsQuery.isError || selectedVersionQuery.isError || selectedVersionFailed) && (
            <Alert variant="destructive" data-testid="status-prepared-input-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error ?? (selectedVersionFailed
                ? `The detail response for saved version #${selectedVersionId} did not match a full saved record; it was not activated.`
                : `Prepared-input API unavailable: ${queryError instanceof Error ? queryError.message : "API request failed."}`)}</AlertDescription>
            </Alert>
          )}
          {activeItem && draftChanged && !selectedVersionLoading && !selectedVersionFailed && (
            <Alert data-testid="status-prepared-draft-changed">
              <AlertDescription>
                Draft changed since frozen source #{activeSourceId} ({activeSourceRepresentation ?? "representation unavailable"}) was accepted.
                These edits have not changed the selected source. Prepare &amp; freeze to apply them, or explicitly choose a saved source.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Selected {representation === "asset_returns" ? "assets" : "input universe"}</h3>
                <p className="text-xs text-muted-foreground">
                  {representation === "alpha_streams"
                    ? "Choose the request asset universe; each alpha definition below separately specifies its applicable assets."
                    : "Available tickers and definitions come from current uploaded price and factor-library data."}
                </p>
              </div>
              {activeRepresentationFields.assets && <div className="space-y-2">
                <Label>{representation === "alpha_streams" ? "Asset universe" : "Assets"}</Label>
                {!assets.length && <p className="text-xs text-amber-700">Asset coverage unavailable: no tickers are currently reported by the price-data API.</p>}
                <SelectionPicker
                  options={assetOptions}
                  selectedIds={assetTickers}
                  onChange={setAssetTickers}
                  noun="assets"
                  testId="prepared-assets"
                  groupBySector
                />
              </div>}
              {activeRepresentationFields.factors && (
                <div className="space-y-2">
                  <Label>{representation === "signals" ? "Signal definitions" : "Included factor definitions"}</Label>
                  {!factors.length && <p className="text-xs text-amber-700">Signal definitions unavailable: factor-library data has not loaded.</p>}
                  <SelectionPicker
                    options={factorOptions}
                    selectedIds={factorIds}
                    onChange={setFactorIds}
                    noun="factors"
                    testId="prepared-factors"
                  />
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
                <h3 className="text-sm font-semibold">{activeRepresentationFields.alphaDefinitions ? "Alpha stream definitions" : "Representation notes"}</h3>
                <p className="text-xs text-muted-foreground">
                  {activeRepresentationFields.alphaDefinitions
                    ? "Alpha streams require an explicit factor, asset universe, mapping, capital fraction, schedule, and execution assumptions."
                    : "This representation is prepared as selected; no exposure mapping is inferred."}
                </p>
              </div>
              {!activeRepresentationFields.alphaDefinitions ? (
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
                          <SelectionPicker
                            options={assetOptions}
                            selectedIds={alpha.assetTickers}
                            onChange={assetTickers => updateAlpha(index, { assetTickers })}
                            noun="applicable assets"
                            testId={`alpha-${index}-applicable-assets`}
                            groupBySector
                          />
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
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-xs font-medium">Advanced · downstream optimizer</summary>
            <p className="mt-2 text-xs text-muted-foreground">This is a separate downstream mode setting. Preparing inputs remains an explicit action and does not run either optimizer.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Optimization mode">
              <span className="text-xs font-medium text-muted-foreground">Optimize with</span>
              <Button type="button" size="sm" variant={!b2Mode ? "default" : "outline"} disabled={!onB2ModeChange} onClick={() => onB2ModeChange?.(false)} data-testid="select-optimization-mode-legacy">Legacy optimizer</Button>
              <Button type="button" size="sm" variant={b2Mode ? "default" : "outline"} disabled={!onB2ModeChange} onClick={() => onB2ModeChange?.(true)} data-testid="select-optimization-mode-b2">B2 allocation</Button>
            </div>
          </details>
        </CardContent>
      </Card>

      {selectedVersionId !== null && selectedVersionLoading && (
        <p className="text-xs text-muted-foreground" role="status">Loading full saved version #{selectedVersionId}…</p>
      )}
      {inspectionVersionId !== null && inspectionVersionQuery.isFetching && (
        <p className="text-xs text-muted-foreground" role="status" data-testid={`status-inspect-prepared-${inspectionVersionId}`}>
          Fetching full saved version #{inspectionVersionId} for inspection…
        </p>
      )}
      {inspectionVersionId !== null && inspectionVersionQuery.isError && (
        <Alert variant="destructive" data-testid={`status-inspect-prepared-error-${inspectionVersionId}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Could not fetch the full saved version #{inspectionVersionId} for inspection.
            {inspectionVersionQuery.error instanceof Error ? ` ${inspectionVersionQuery.error.message}` : " The detail request failed."}
          </AlertDescription>
        </Alert>
      )}
      {inspectionInvalidResponse && (
        <Alert variant="destructive" data-testid={`status-inspect-prepared-error-${inspectionVersionId}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The detail response for saved version #{inspectionVersionId} did not match a full saved record. The source was not activated.
          </AlertDescription>
        </Alert>
      )}

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
              {returnedCandidates.length ? <div className="space-y-1">{returnedCandidates.map((candidate, index) => <button key={candidate.id ?? candidate.factorId ?? index} type="button" className="flex w-full items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => setDetailItem({ ...selectedOutput, selectedCandidate: candidate })} data-testid={`button-open-candidate-${index}`}><span>{candidate.name ?? candidate.ticker ?? candidate.factorId ?? `Candidate ${index + 1}`}</span><Badge variant="outline">{technicalState(candidate)}</Badge></button>)}</div> : Array.isArray(selectedOutput?.candidates) ? <p className="text-xs text-muted-foreground">No candidate outputs were recorded in this full saved version.</p> : <p className="text-xs text-muted-foreground">Candidate-level results were not returned in the detail response.</p>}
              {returnedAlphas.length > 0 && <div className="mt-3 space-y-1">{returnedAlphas.map((stream, index) => <button key={stream.id ?? stream.name ?? index} type="button" className="flex w-full items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => setDetailItem({ ...selectedOutput, selectedStream: stream })} data-testid={`button-open-alpha-stream-${index}`}><span>{stream.name ?? `Alpha stream ${index + 1}`}</span><Badge variant="outline">{technicalState(stream)}</Badge></button>)}</div>}
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
            <div className="space-y-2">{savedItems.map(item => {
              const id = item.preparedInputId;
              const coverageStart = item.coverageStartDate ?? "Unavailable";
              const coverageEnd = item.coverageEndDate ?? "Unavailable";
              const observations = item.observationCount === null ? "Unavailable" : `${item.observationCount} rows`;
              const candidateCount = item.candidateCount === null ? "Candidate count unavailable" : `${item.candidateCount} candidates`;
              const dataset = item.datasetId === null ? "Dataset ID unavailable" : `Dataset ${item.datasetId}`;
              const datasetHash = item.datasetHash ? ` · source ${item.datasetHash.slice(0, 12)}…` : "";
              const cutoff = item.cutoffDate ?? "latest available";
              return <div key={id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2" data-testid={`row-prepared-version-${id}`}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">Prepared inputs #{id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.representation} · {item.technicalStatus ?? "Technical status unavailable"} · {candidateCount} · {item.createdAt} · ID {id}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Coverage {coverageStart} – {coverageEnd} · {observations} · {item.coverageStatus ?? "Coverage status unavailable"} · {dataset}{datasetHash} · cutoff {cutoff}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => handleInspectSaved(item)} data-testid={`button-inspect-prepared-${id}`}>
                    {inspectionVersionId === id && inspectionVersionQuery.isFetching ? "Inspecting…" : "Inspect"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => handleReload(item)} data-testid={`button-reload-prepared-${id}`}>Load full record</Button>
                </div>
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