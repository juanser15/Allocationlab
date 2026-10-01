import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { AlertCircle, FlaskConical, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAllocation, getGetAllocationQueryKey, getGetPreparedInputQueryKey, getListPreparedInputSummariesQueryKey,
  getValidationJob, getValidationRun,
  useGetAllocation, useGetPreparedInput, useListPreparedInputSummaries, type PreparedInputSummary, type ValidationJob,
} from "@workspace/api-client-react";
import { AllocationModeComparisonPanel } from "./AllocationModeComparisonPanel";
import { useValidationJob } from "./use-validation-job";
import { ValidationJobStatus } from "./ValidationJobStatus";
import { RobustnessPanel } from "./RobustnessPanel";
import { CostAwareValidationResult } from "./CostAwarePanel";
import { RebalanceValidationResult } from "./RebalanceRegularizationPanel";
import { PortfolioResultOverview } from "./PortfolioResultOverview";
import { loadedPolicyMatches, needsHistoricalJobPolling, pmPercent, pmValue, portfolioStateLabel, viewedValidationRunId } from "./portfolio-result-summary";
import { B3_WORKING_DRAFT_KEY, readWorkingDraftValue, writeWorkingDraftValue } from "./portfolio-working-draft";
import { registerRunAction, type RunAction } from "./portfolio-run-action";

type Row = Record<string, unknown>;
type Step = "configure" | "results" | "diagnostics";
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const idOf = (value: unknown, name: string) => {
  const id = record(value)[name] ?? record(value).id;
  return Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
};
const preparedInputIdOf = (value: unknown) => {
  const item = record(value);
  const id = item.preparedInputId ?? item.id ?? record(item.snapshot).preparedInputId;
  return Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
};
const preparedRepresentation = (value: unknown) => {
  const item = record(value);
  const snapshot = record(item.snapshot);
  const request = record(item.request ?? snapshot.request);
  return item.representation ?? request.representation ?? snapshot.representation;
};
const text = (value: unknown) => value === null || value === undefined || value === "" ? "Unavailable" : String(value);
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const money = (value: unknown) => num(value) === null ? "Undefined" : num(value)!.toLocaleString(undefined, { maximumFractionDigits: 2 });
const percent = (value: unknown) => pmPercent(value);
const metric = (value: unknown) => num(value) === null ? "Undefined" : num(value)!.toFixed(3);
const json = (value: unknown) => value === undefined || value === null ? "Unavailable" : JSON.stringify(value, null, 2);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item) ?? "undefined";
const halfL1 = (left: unknown, right: unknown): number | null => {
  const a = record(left), b = record(right);
  if (!Object.keys(a).length && !Object.keys(b).length) return null;
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  if ([...ids].some(id => (a[id] !== undefined && num(a[id]) === null) || (b[id] !== undefined && num(b[id]) === null))) return null;
  return 0.5 * [...ids].reduce((sum, id) => sum + Math.abs((num(a[id]) ?? 0) - (num(b[id]) ?? 0)), 0);
};
const meanDecisionDistance = (left: Row[], right: Row[], key: "candidateWeights" | "targetAssetWeights") => {
  const byDate = new Map(right.map(item => [text(item.decisionDate), item]));
  const distances = left.flatMap(item => {
    const other = byDate.get(text(item.decisionDate));
    const distance = other ? halfL1(item[key], other[key]) : null;
    return distance === null ? [] : [distance];
  });
  return distances.length ? distances.reduce((sum, distance) => sum + distance, 0) / distances.length : null;
};
const list = (value: unknown, key: string): Row[] => Array.isArray(value) ? rows(value) : rows(record(value)[key]);
const getResult = (run: Row) => record(run.result ?? run.results);
const getAssumptions = (run: Row) => record(run.assumptions);
const getRepresentation = (run: Row) => text(run.representation ?? record(run.policy).representation ?? record(run.policySnapshot).representation ?? getResult(run).representation);
const validString = (value: unknown): value is string => typeof value === "string";
const validNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function useWorkingDraftField<T>(field: string, fallback: T, isValid: (value: unknown) => value is T, onStorageError: (message: string) => void) {
  const [value, setValue] = useState(() => {
    try {
      return readWorkingDraftValue(
        typeof window === "undefined" ? null : window.localStorage.getItem(B3_WORKING_DRAFT_KEY),
        field,
        fallback,
        isValid,
      );
    } catch { return fallback; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(B3_WORKING_DRAFT_KEY);
      window.localStorage.setItem(B3_WORKING_DRAFT_KEY, writeWorkingDraftValue(raw, field, value));
    } catch {
      onStorageError("The working B3 validation draft could not be saved locally; keep this tab open to retain the current form.");
    }
  }, [field, onStorageError, value]);
  return [value, setValue] as const;
}

function DataTable({ title, description, data, columns, limit = 80 }: {
  title: string; description?: string; data: Row[]; columns: { key: string; label: string; render?: (row: Row) => string }[]; limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-sm">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
    <CardContent>
      {!data.length ? <p className="text-xs text-muted-foreground">No {title.toLowerCase()} returned for this run.</p> :
        <><div className="max-h-96 overflow-auto rounded border"><table className="w-full min-w-[580px] text-left text-xs">
          <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>{columns.map(col => <th key={col.key} className="whitespace-nowrap px-3 py-2 font-semibold">{col.label}</th>)}</tr></thead>
          <tbody>{(expanded ? data : data.slice(0, limit)).map((row, index) => <tr key={index} className="border-t align-top" data-testid={`row-b3-${title.toLowerCase().replace(/\W+/g, "-")}-${index}`}>
            {columns.map(col => <td key={col.key} className="max-w-64 whitespace-pre-wrap break-words px-3 py-2 font-mono tabular-nums">{col.render ? col.render(row) : text(row[col.key])}</td>)}
          </tr>)}</tbody></table></div>{data.length > limit && <Button className="mt-2" variant="outline" size="sm" onClick={() => setExpanded(!expanded)} data-testid={`button-b3-expand-${title.toLowerCase().replace(/\W+/g, "-")}`}>{expanded ? "Show fewer" : `Show all ${data.length} rows`}</Button>}</>}
    </CardContent>
  </Card>;
}

export function B3ValidationPanel({ allocationId, runToken, onRunningChange, inspectRunId, inspectedJobId, onValidateActionChange }: {
  allocationId: number | null;
  /** Retained for source compatibility. Validation only starts from its explicit button. */
  runToken: number;
  inspectRunId?: number | null;
  inspectedJobId?: string | null;
  onRunningChange?: (value: boolean) => void;
  onValidateActionChange?: (action: RunAction | null) => void;
}) {
  const [saved, setSaved] = useState<Row[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const value = Number(window.localStorage.getItem("allocation-lab:validation-job:b3:selected-run"));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  });
  const [inspectedJob, setInspectedJob] = useState<ValidationJob | null>(null);
  const [comparisonId, setComparisonId] = useState<number | null>(null);
  const [run, setRun] = useState<Row | null>(null);
  const [comparison, setComparison] = useState<Row | null>(null);
  const [policy, setPolicy] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportDraftError = setError;
  const [preparedId, setPreparedId] = useWorkingDraftField("preparedId", "", validString, reportDraftError);
  const [start, setStart] = useWorkingDraftField("start", "", validString, reportDraftError);
  const [end, setEnd] = useWorkingDraftField("end", "", validString, reportDraftError);
  const [calendar, setCalendar] = useWorkingDraftField("calendar", "monthly" as const, (value): value is "monthly" | "quarterly" => value === "monthly" || value === "quarterly", reportDraftError);
  const [timing, setTiming] = useWorkingDraftField("timing", "next_close" as const, (value): value is "same_close" | "next_close" | "next_open" => value === "same_close" || value === "next_close" || value === "next_open", reportDraftError);
  const [initialNav, setInitialNav] = useWorkingDraftField("initialNav", 100000, validNumber, reportDraftError);
  const [holdingsText, setHoldingsText] = useWorkingDraftField("holdingsText", "{}", validString, reportDraftError);
  const [initialCash, setInitialCash] = useWorkingDraftField("initialCash", 100000, validNumber, reportDraftError);
  const [cost, setCost] = useWorkingDraftField("cost", 10, validNumber, reportDraftError);
  const [slippage, setSlippage] = useWorkingDraftField("slippage", 5, validNumber, reportDraftError);
  const [yieldDaily, setYieldDaily] = useWorkingDraftField("yieldDaily", 0, validNumber, reportDraftError);
  const [benchmark, setBenchmark] = useWorkingDraftField("benchmark", "", validString, reportDraftError);
  const preparedInputsQuery = useListPreparedInputSummaries({
    query: { queryKey: getListPreparedInputSummariesQueryKey(), refetchOnMount: "always" },
  });
  const selectedPreparedId = /^[1-9]\d*$/.test(preparedId) && Number.isSafeInteger(Number(preparedId))
    ? Number(preparedId)
    : null;
  const selectedPreparedQuery = useGetPreparedInput(selectedPreparedId ?? 0, {
    query: {
      enabled: selectedPreparedId !== null,
      queryKey: getGetPreparedInputQueryKey(selectedPreparedId ?? 0),
      refetchOnMount: "always",
    },
  });
  const selectedPreparedData = selectedPreparedQuery.data as unknown as Row | undefined;
  const selectedPreparedFull = selectedPreparedId !== null && !selectedPreparedQuery.isFetching &&
    !selectedPreparedQuery.isError && preparedInputIdOf(selectedPreparedData) === selectedPreparedId &&
    !!selectedPreparedData?.snapshot && Array.isArray(selectedPreparedData.candidates)
    ? selectedPreparedData
    : null;
  const selectedPreparedInvalidResponse = selectedPreparedId !== null && !selectedPreparedQuery.isFetching &&
    !selectedPreparedQuery.isError && selectedPreparedData !== undefined && selectedPreparedFull === null;
  const selectedPreparedLoading = selectedPreparedId !== null && !selectedPreparedQuery.isError &&
    !selectedPreparedInvalidResponse && (selectedPreparedQuery.isFetching || selectedPreparedFull === null);
  const selectedPreparedFailed = selectedPreparedId !== null &&
    (selectedPreparedQuery.isError || selectedPreparedInvalidResponse);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("configure");
  const [cachedPolicyAllocationId] = useState<number | null>(() => {
    try {
      return readWorkingDraftValue(
        typeof window === "undefined" ? null : window.localStorage.getItem(B3_WORKING_DRAFT_KEY),
        "policyAllocationId",
        null,
        (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
      );
    } catch { return null; }
  });
  const initialPolicySync = useRef(true);
  const historyInspectionActive = inspectRunId !== null && inspectRunId !== undefined ||
    inspectedJobId !== null && inspectedJobId !== undefined;
  const viewedRunId = viewedValidationRunId({ inspectRunId, inspectedJobId, inspectedJob, selectedRunId });
  const currentViewedRunIdRef = useRef(viewedRunId);
  const selectionGenerationRef = useRef(0);
  const historyInspectionActiveRef = useRef(historyInspectionActive);
  useLayoutEffect(() => {
    historyInspectionActiveRef.current = historyInspectionActive;
    if (currentViewedRunIdRef.current !== viewedRunId) {
      currentViewedRunIdRef.current = viewedRunId;
    }
  }, [historyInspectionActive, viewedRunId]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const runsResponse = await fetch("/api/validation-runs?source=b3&summary=1");
      if (!runsResponse.ok) throw new Error(`Saved B3 summaries could not be loaded (${runsResponse.status}).`);
      const runs: unknown = await runsResponse.json();
      setSaved(list(runs, "validationRuns"));
    } catch (err) { setError(err instanceof Error ? err.message : "Saved B3 records could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (selectedRunId === null) window.localStorage.removeItem("allocation-lab:validation-job:b3:selected-run");
    else window.localStorage.setItem("allocation-lab:validation-job:b3:selected-run", String(selectedRunId));
  }, [selectedRunId]);
  useEffect(() => {
    if (inspectRunId !== null && inspectRunId !== undefined || inspectedJobId !== null && inspectedJobId !== undefined)
      setStep("results");
  }, [inspectRunId, inspectedJobId]);
  useEffect(() => {
    if (!inspectedJobId) {
      setInspectedJob(null);
      return;
    }
    let active = true;
    let fetching = false;
    let retryAfterFetch = false;
    let timer: number | null = null;
    setInspectedJob(null);
    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const inspect = async () => {
      if (!active) return;
      if (fetching) { retryAfterFetch = true; return; }
      fetching = true;
      try {
        // History inspection is GET-only and deliberately independent of the
        // active validation-job hook and its persisted job key.
        const job = await getValidationJob(inspectedJobId);
        if (active) {
          setInspectedJob(job);
          setError(null);
          if (needsHistoricalJobPolling(job.status))
            timer = window.setTimeout(() => void inspect(), 3000);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Saved validation job could not be retrieved.");
          if (navigator.onLine) timer = window.setTimeout(() => void inspect(), 5000);
        }
      } finally {
        fetching = false;
        if (active && retryAfterFetch) {
          retryAfterFetch = false;
          clearTimer();
          void inspect();
        }
      }
    };
    const recover = () => {
      clearTimer();
      if (fetching) retryAfterFetch = true;
      else void inspect();
    };
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    void inspect();
    return () => {
      active = false;
      clearTimer();
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
    };
  }, [inspectedJobId]);
  useEffect(() => {
    setPolicy(null);
    if (!allocationId) return;
    let active = true;
    const preserveRestoredWorkingRates = initialPolicySync.current && cachedPolicyAllocationId === allocationId;
    initialPolicySync.current = false;
    void getAllocation(allocationId).then(data => { if (active) {
      const frozen = record(data), frozenCost = record(record(frozen.request).costAware);
      setPolicy(frozen);
      if (!preserveRestoredWorkingRates) {
        if (typeof frozenCost.transactionCostBps === "number") setCost(frozenCost.transactionCostBps);
        if (typeof frozenCost.slippageBps === "number") setSlippage(frozenCost.slippageBps);
      }
    } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Policy could not be loaded."); });
    return () => { active = false; };
  }, [allocationId, cachedPolicyAllocationId]);
  useEffect(() => {
    if (typeof window === "undefined" || !allocationId || idOf(policy ?? {}, "allocationId") !== allocationId) return;
    try {
      const raw = window.localStorage.getItem(B3_WORKING_DRAFT_KEY);
      window.localStorage.setItem(B3_WORKING_DRAFT_KEY, writeWorkingDraftValue(raw, "policyAllocationId", allocationId));
    } catch {
      setError("The working B3 policy scope could not be saved locally.");
    }
  }, [allocationId, policy]);
  useEffect(() => {
    if (viewedRunId === null) { setRun(null); return; }
    let active = true;
    let fetching = false;
    let retryWhenSettled = false;
    setRun(null);
    setError(null);
    const loadSelectedRun = async () => {
      if (!active) return;
      if (fetching) { retryWhenSettled = true; return; }
      fetching = true;
      try {
        const data = await getValidationRun(viewedRunId);
        if (active) { setRun(record(data)); setError(null); setStep("results"); }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Saved run could not be retrieved.");
      } finally {
        fetching = false;
        if (active && retryWhenSettled) {
          retryWhenSettled = false;
          void loadSelectedRun();
        }
      }
    };
    const reconnect = () => { void loadSelectedRun(); };
    void loadSelectedRun();
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    return () => {
      active = false;
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
    };
  }, [viewedRunId]);
  useEffect(() => {
    if (comparisonId === null) { setComparison(null); return; }
    let active = true;
    void getValidationRun(comparisonId).then(data => { if (active) setComparison(record(data)); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Comparison could not be retrieved."); });
    return () => { active = false; };
  }, [comparisonId]);
  const onValidationJobCompleted = useCallback((job: ValidationJob) => {
    if (!job.validationRunId) return;
    const selectionGeneration = selectionGenerationRef.current;
    void refresh().finally(() => {
      if (historyInspectionActiveRef.current || selectionGeneration !== selectionGenerationRef.current) return;
      setSelectedRunId(job.validationRunId!);
      if (!historyInspectionActiveRef.current) {
        setRun(null);
      }
      if (!historyInspectionActiveRef.current) setStep("results");
    });
  }, [refresh]);
  const validationJob = useValidationJob("allocation-lab:validation-job:b3", onValidationJobCompleted);
  const viewedJob = historyInspectionActive
    ? inspectedJob?.jobId === inspectedJobId ? inspectedJob : null
    : validationJob.job;
  useEffect(() => {
    onRunningChange?.(validationJob.active);
    return () => onRunningChange?.(false);
  }, [onRunningChange, validationJob.active]);
  const policyRecord = record(policy?.allocation ?? policy);
  const policyReady = loadedPolicyMatches(allocationId, idOf(policyRecord, "allocationId"));
  const policyRequest = record(policyRecord.request);
  const policyResult = record(policyRecord.result ?? policyRecord);
  const selectedForecastRequest = record(policyRequest.forecastModel);
  const selectedPolicyIdentity = record(policyRecord.policyIdentity ?? policyResult.policyIdentity);
  const selectedForecast = Object.keys(selectedForecastRequest).length
    ? selectedForecastRequest : record(selectedPolicyIdentity.forecastModel);
  const policyRepresentation = policyRequest.representation ?? policyResult.representation ?? policyRecord.representation;
  const policyRepresentationLabel = text(policyRepresentation);
  const sourceId = idOf(policyRequest.preparedInputId ? { id: policyRequest.preparedInputId } : {}, "id");
  const preparedItems = (preparedInputsQuery.data ?? []) as PreparedInputSummary[];
  const compatibleInputs = preparedItems.filter(item => preparedRepresentation(item) === policyRepresentation);
  const selectedPreparedRepresentation = selectedPreparedFull ? preparedRepresentation(selectedPreparedFull) : null;
  const selectedPreparedStatus = selectedPreparedFull?.status;
  const selectedPreparedCandidates = selectedPreparedFull ? rows(selectedPreparedFull.candidates) : [];
  const selectedPreparedSourceReady = selectedPreparedFull !== null &&
    selectedPreparedRepresentation === policyRepresentation && selectedPreparedStatus === "READY";

  const latestValidateRef = useRef<() => void>(() => undefined);
  latestValidateRef.current = () => { void validate(); };
  const stableValidateRun = useCallback(() => latestValidateRef.current(), []);
  const validateBusy = validationJob.active || validationJob.submitting;
  const validateAction = useMemo<RunAction>(() => ({
    run: stableValidateRun,
    disabled: historyInspectionActive || !allocationId || !policyReady || !selectedPreparedSourceReady || validateBusy,
    busy: validateBusy,
  }), [stableValidateRun, historyInspectionActive, allocationId, policyReady, selectedPreparedSourceReady, validateBusy]);
  const validateCallbackRef = useRef(onValidateActionChange);
  validateCallbackRef.current = onValidateActionChange;
  useEffect(() => {
    return registerRunAction(() => validateCallbackRef.current, validateAction);
  }, [validateAction]);

  async function validate() {
    setError(null);
    if (historyInspectionActive) return;
    if (!allocationId) { setError("Select a saved B2 allocation in the Allocation tab first."); setStep("configure"); return; }
    if (!policyReady) { setError("Wait until the selected frozen B2 policy has been retrieved before validating."); setStep("configure"); return; }
    if (policyResult.status && policyResult.status !== "SOLVED") { setError("Only a solved B2 allocation policy can be validated."); setStep("configure"); return; }
    if (!preparedId) { setError("Choose an explicit frozen B1 validation preparation. No latest dataset is substituted."); setStep("configure"); return; }
    if (selectedPreparedId === null) { setError("Choose a valid saved B1 preparation ID."); setStep("configure"); return; }
    if (selectedPreparedLoading) { setError("Wait until the full saved B1 record has loaded before validating."); setStep("configure"); return; }
    if (!selectedPreparedFull) {
      setError(selectedPreparedQuery.error instanceof Error
        ? `The selected full B1 record could not be loaded: ${selectedPreparedQuery.error.message}`
        : `The response for saved B1 preparation #${selectedPreparedId} did not match a full saved record.`);
      setStep("configure"); return;
    }
    if (selectedPreparedRepresentation !== policyRepresentation) {
      setError("The selected full B1 preparation does not match the frozen B2 policy representation.");
      setStep("configure"); return;
    }
    if (selectedPreparedStatus !== "READY") {
      setError(`The selected full B1 preparation has technical status ${text(selectedPreparedStatus)}; only READY inputs can be validated.`);
      setStep("configure"); return;
    }
    if (!start || !end || start > end) { setError("Specify a valid evaluation start and end date."); setStep("configure"); return; }
    const isSigned = policyRequest.allocationMode === "SIGNED_OVERLAY";
    if (![initialNav, initialCash, cost, slippage, yieldDaily].every(Number.isFinite) ||
      initialNav <= 0 || (!isSigned && initialCash < 0) || cost < 0 || slippage < 0) {
      setError(`Provide a positive initial NAV, finite cash and nonnegative costs${isSigned ? "" : " (cash cannot be negative in capital long-only mode)"}.`); setStep("configure"); return;
    }
    const frozenCost = record(policyRequest.costAware);
    if (policyRequest.costAware && (cost !== frozenCost.transactionCostBps || slippage !== frozenCost.slippageBps)) {
      setError("Cost-aware validation requires execution fee and slippage bps to match the frozen B2 policy rates."); setStep("configure"); return;
    }
    let holdings: Record<string, number>;
    try {
      const parsed = JSON.parse(holdingsText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some(v => typeof v !== "number" || !Number.isFinite(v) || (!isSigned && v < 0))) throw new Error();
      holdings = parsed as Record<string, number>;
    } catch { setError(`Initial holdings must be a JSON object of tickers to finite ${isSigned ? "signed" : "nonnegative"} quantities.`); setStep("configure"); return; }
    if (validationJob.active) return;
    selectionGenerationRef.current += 1;
    setSelectedRunId(null);
    validationJob.start({
      allocationId,
      validationPreparedInputId: Number(preparedId),
      assumptions: {
        evaluationStartDate: start, evaluationEndDate: end, decisionCalendar: calendar, executionTiming: timing,
        initialNav, initialHoldings: holdings, initialCash, transactionCostBps: cost, slippageBps: slippage,
        dailyCashYield: yieldDaily, ...(benchmark.trim() ? { benchmarkTicker: benchmark.trim().toUpperCase() } : {}),
      },
    });
  }
  const output = getResult(run ?? {});
  const summary = record(output.summary ?? output.metrics);
  const outputMetrics = record(output.metrics);
  const externalTradedNotional = outputMetrics.externalTradedNotional ?? summary.externalTradedNotional;
  const ledger = rows(output.dailyLedger ?? output.ledger);
  const decisions = rows(output.decisions ?? output.decisionRecords);
  const runAllocationId = idOf(run ?? {}, "allocationId");
  const runPolicyQuery = useGetAllocation(runAllocationId ?? 0, {
    query: {
      enabled: runAllocationId !== null,
      queryKey: getGetAllocationQueryKey(runAllocationId ?? 0),
    },
  });
  const runPolicy = record(runPolicyQuery.data);
  const runPolicyRequest = record(runPolicy.request);
  const runForecastRequest = record(runPolicyRequest.forecastModel);
  const runPolicyIdentity = record(output.policyIdentity);
  const runForecast = Object.keys(runForecastRequest).length
    ? runForecastRequest : record(runPolicyIdentity.forecastModel);
  const comparisonAllocationId = idOf(comparison ?? {}, "allocationId");
  const comparisonPolicyQuery = useGetAllocation(comparisonAllocationId ?? 0, {
    query: {
      enabled: comparisonAllocationId !== null,
      queryKey: getGetAllocationQueryKey(comparisonAllocationId ?? 0),
    },
  });
  const comparisonPolicyRequest = record(record(comparisonPolicyQuery.data).request);
  const comparisonOutput = getResult(comparison ?? {});
  const comparisonForecastRequest = record(comparisonPolicyRequest.forecastModel);
  const comparisonForecast = Object.keys(comparisonForecastRequest).length
    ? comparisonForecastRequest : record(record(comparisonOutput.policyIdentity).forecastModel);
  const comparisonPolicyRiskModel = record(comparisonPolicyRequest.riskModel);
  const selectedRiskModel = record(policyRequest.riskModel);
  const runRiskModel = record(runPolicyRequest.riskModel);
  const selectedRiskModelLabel = pmValue(selectedRiskModel.type);
  const runRiskModelLabel = pmValue(runRiskModel.type);
  const datedRiskRows = decisions.map(decision => ({
    decision,
    risk: record(record(decision.optimizer).riskModel),
  })).filter(item => Object.keys(item.risk).length > 0);
  const datedForecastRows = decisions.map(decision => ({
    decision,
    forecast: record(record(decision.optimizer).forecast ?? decision.forecast),
  }));
  const frozenRidge = runForecast.type === "SIGNAL_RIDGE";
  const ridgeValidation = record(output.ridgeEvaluation);
  const ridgeMatured = record(ridgeValidation.metrics);
  const monthly = rows(summary.monthlyReturns);
  const navSeries = rows(output.equityCurve ?? output.dailyNav);
  const chart = useMemo(() => {
    let peak = num((run?.assumptions as Row | undefined)?.initialNav) ?? 0;
    return (navSeries.length ? navSeries : ledger).map(day => {
      const nav = num(day.nav ?? day.endingNav ?? day.netNav ?? day.portfolioNav);
      if (nav !== null) peak = Math.max(peak, nav);
      return { date: text(day.date), nav, drawdown: num(day.drawdown ?? day.drawdownPct) ?? (nav !== null && peak > 0 ? nav / peak - 1 : null) };
    }).filter(point => point.nav !== null);
  }, [navSeries, ledger, run?.assumptions]);
  const a = getAssumptions(run ?? {});
  const activeRunAllocationId = idOf(run ?? {}, "allocationId");
  const b = getAssumptions(comparison ?? {});
  const comparisonMetadata = record(run?.comparisonMetadata);
  const otherComparisonMetadata = record(comparison?.comparisonMetadata);
  const comparableKeys = ["evaluationStartDate", "evaluationEndDate", "initialNav", "initialCash", "decisionCalendar", "executionTiming", "transactionCostBps", "slippageBps", "dailyCashYield"];
  const policyComparisonKeys = ["preparedInputId", "informationCutoff", "decisionTimestamp", "estimationWindow", "minObservations", "representation", "returnConvention", "expectedReturnShrinkage", "forecastModel", "dailyCashYield", "objective", "constraints", "allocationMode", "signedConstraints", "targetExcessReturn", "robustness", "costAware", "rebalanceRegularization"];
  const comparedForecastTypes = [pmValue(runForecast.type), pmValue(comparisonForecast.type)];
  const ridgeMeanComparison = comparedForecastTypes.includes("SIGNAL_RIDGE") &&
    comparedForecastTypes.includes("SHRUNK_MEAN");
  const signedPolicy = policyRequest.allocationMode === "SIGNED_OVERLAY";
  const lastDecision = decisions.at(-1);
  const lastLedgerEntry = ledger.at(-1);
  const runRisk = record(runPolicyRequest.riskModel);
  const storedTurnover = num(summary.turnover) ?? num(summary.averageTurnover);
  const runRobustness = record(runPolicyRequest.robustness);
  const runRebalance = record(runPolicyRequest.rebalanceRegularization);
  const runCostAware = record(runPolicyRequest.costAware);
  const runSignedPolicy = runPolicyRequest.allocationMode === "SIGNED_OVERLAY";
  const comparisonSignedPolicy = comparisonPolicyRequest.allocationMode === "SIGNED_OVERLAY";
  const differentCapitalStructures = Boolean(comparison) && runSignedPolicy !== comparisonSignedPolicy;
  const policyMismatches = comparison && !comparisonPolicyQuery.isLoading
    ? !Object.keys(comparisonPolicyRequest).length || !Object.keys(runPolicyRequest).length
      ? ["frozen B2 policy request unavailable"]
      : policyComparisonKeys.filter(key => !(ridgeMeanComparison && key === "forecastModel") &&
          canonical(runPolicyRequest[key]) !== canonical(comparisonPolicyRequest[key]))
        .concat(canonical([...(Array.isArray(runPolicyRequest.candidateIds) ? runPolicyRequest.candidateIds : [])].sort()) ===
          canonical([...(Array.isArray(comparisonPolicyRequest.candidateIds) ? comparisonPolicyRequest.candidateIds : [])].sort())
          ? [] : ["B2 candidate set"])
    : [];
  const mismatches = comparison ? comparableKeys.filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key])).concat(
    canonical(a.initialHoldings) === canonical(b.initialHoldings) ? [] : ["initialHoldings"],
    text(run?.datasetHash) === text(comparison.datasetHash) && run?.datasetHash ? [] : ["market data identity"],
    getRepresentation(run ?? {}) !== getRepresentation(comparison) ? ["representation"] : [],
    policyMismatches,
    comparisonMetadata.finalAssetConstraints !== undefined && otherComparisonMetadata.finalAssetConstraints !== undefined
      ? canonical(comparisonMetadata.finalAssetConstraints) === canonical(otherComparisonMetadata.finalAssetConstraints) ? [] : ["final-asset constraints"]
      : ["final-asset constraints unavailable"],
    comparisonMetadata.capitalBudget !== undefined && otherComparisonMetadata.capitalBudget !== undefined
      ? canonical(comparisonMetadata.capitalBudget) === canonical(otherComparisonMetadata.capitalBudget) ? [] : ["capital budget"]
      : ["capital budget unavailable"],
  ).flat() : [];
  const status = text(run?.status ?? output.status);
  const isSuccessful = status === "success" && output.status === "completed" && run?.reconciliationStatus === "pass";
  const runOutcome = output.status === "failed" || run?.status === "failed" || run?.reconciliationStatus === "fail"
    ? "failed" : run?.status ?? output.status;
  const summaryItems: { label: string; value: string; note: string }[] = [
    { label: "Cumulative return", value: percent(summary.cumulativeReturn), note: "Net, compounded" },
    { label: "Annualized return", value: percent(summary.annualizedReturn ?? summary.cagr), note: "252 trading days; undefined for short samples" },
    { label: "Annualized volatility", value: percent(summary.annualizedVolatility), note: "Daily net returns × √252" },
    { label: "Sharpe", value: metric(summary.sharpeRatio ?? summary.sharpe), note: "√252 × mean(daily return − daily cash yield) / sample stdev" },
    { label: "Maximum drawdown", value: percent(summary.maximumDrawdown), note: "Peak to trough" },
    { label: "External traded notional", value: num(externalTradedNotional) === null ? "Not recorded" : money(externalTradedNotional), note: "Consolidated asset book" },
    { label: "Turnover", value: storedTurnover === null ? "Not recorded" : percent(storedTurnover), note: text(summary.turnoverConvention ?? "Not separately returned") },
  ];

  return <section className="space-y-5" aria-label="B3 historical validation">
    <Card className="border-primary/20"><CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">B3 · Historical policy validation</CardTitle>
        <CardDescription className="mt-1">Fixed policy, rolling point-in-time estimates, one executed underlying asset book. Today's B2 weights are not used for historical execution.</CardDescription></div>
         <Badge variant="outline">{historyInspectionActive ? run ? `Inspecting Validation #${viewedRunId} · B2 allocation #${activeRunAllocationId ?? "unavailable"} · ${getRepresentation(run)}` : inspectRunId !== null && inspectRunId !== undefined ? `Retrieving saved Validation #${inspectRunId}` : `Inspected job ${inspectedJobId}` : step === "configure" ? `Working B2 allocation #${allocationId ?? "not selected"} · ${policyRepresentationLabel}` : run ? `Validation #${run.validationRunId ?? viewedRunId} · B2 allocation #${activeRunAllocationId ?? "unavailable"} · ${getRepresentation(run)}` : `B2 allocation #${allocationId ?? "not selected"}`}</Badge></div>
      <div className="flex items-center gap-1 border-t pt-3 text-xs">{(["configure", "results", "diagnostics"] as const).map((s, i) =>
        <Button key={s} size="sm" variant={step === s ? "default" : "ghost"} onClick={() => setStep(s)} data-testid={`button-b3-step-${s}`}>{i + 1} · {s === "configure" ? "Configure → Validate" : s === "results" ? "Results" : "Diagnostics"}</Button>)}</div>
    </CardHeader></Card>
     {(error || preparedInputsQuery.isError || selectedPreparedFailed) && <Alert variant="destructive" data-testid="status-b3-error">
       <AlertCircle className="h-4 w-4" />
       <AlertDescription>{error ?? (selectedPreparedFailed
         ? selectedPreparedQuery.error instanceof Error
           ? `Full saved B1 preparation #${selectedPreparedId} could not be loaded: ${selectedPreparedQuery.error.message}`
           : `The detail response for saved B1 preparation #${selectedPreparedId} did not match a full saved record.`
         : `Saved B1 metadata could not be loaded: ${preparedInputsQuery.error instanceof Error ? preparedInputsQuery.error.message : "API request failed."}`)}</AlertDescription>
     </Alert>}
    {historyInspectionActive ? inspectedJobId && !viewedJob
      ? <p role="status" className="rounded border bg-muted/20 p-3 text-xs">Retrieving selected saved validation job…</p>
      : <ValidationJobStatus job={viewedJob} active={false} submitting={false} reconnecting={false} seconds={0} submissionError={null} />
      : <ValidationJobStatus job={validationJob.job} active={validationJob.active} submitting={validationJob.submitting} reconnecting={validationJob.reconnecting} seconds={validationJob.seconds} submissionError={validationJob.submissionError} />}
    {historyInspectionActive && viewedJob && !viewedJob.validationRunId && <p className="rounded border bg-muted/20 p-3 text-xs">The selected historical job has no linked Validation Run yet. Its status is shown above; no other completed run is substituted.</p>}
     {(loading || preparedInputsQuery.isLoading) && <div className="h-24 animate-pulse rounded border bg-muted/50" aria-label="Loading saved validation records" />}
    {run && <PortfolioResultOverview
      title="Portfolio validation"
      runId={viewedRunId}
      status={runOutcome}
      representation={getRepresentation(run)}
      executionMode={a.executionTiming}
      timestamp={run.validatedAt ?? run.createdAt}
      fields={[
        { label: "Validation", value: isSuccessful ? "Completed · reconciliation passed" : `${portfolioStateLabel(runOutcome)} · ${text(run.reconciliationStatus)}` },
        { label: "Net return", value: summaryItems[0].value, detail: summaryItems[0].note },
        { label: "Annualized return", value: summaryItems[1].value, detail: summaryItems[1].note },
        { label: "Risk", value: summaryItems[2].value, detail: `Frozen risk model ${pmValue(runRisk.type)}` },
        { label: "Sharpe", value: summaryItems[3].value, detail: summaryItems[3].note },
        { label: "Cash", value: lastLedgerEntry?.endingCash == null ? "Not recorded" : money(lastLedgerEntry.endingCash), detail: lastLedgerEntry ? `Ending cash · ${text(lastLedgerEntry.date)}` : "No ledger cash record returned" },
        { label: "Last target allocation", value: json(lastDecision?.targetAssetWeights), detail: lastDecision ? `B2 target weights at the ${text(lastDecision.decisionDate)} decision · not executed ending holdings` : "No target-weight record returned" },
        { label: "Robustness", value: `${pmValue(runRobustness.method)} · κ ${pmValue(runRobustness.kappa)}` },
        { label: "Turnover", value: summaryItems[6].value, detail: summaryItems[6].note },
        { label: "Frozen turnover settings", value: `λR ${pmValue(runRebalance.lambdaR)}`, detail: `Notional preference ${pmValue(runCostAware.turnoverPreferenceBps)} bps` },
        { label: "Ledger reconciliation", value: text(run.reconciliationStatus), detail: text(record(output.diagnostics).status ?? output.accountingStatus ?? "See ledger diagnostics") },
        { label: "Frozen forecast", value: pmValue(runForecast.type), detail: `B2 allocation #${activeRunAllocationId ?? "unavailable"}` },
      ]}
    />}
    {step === "configure" && <Card><CardHeader><CardTitle className="text-sm">Frozen inputs & execution assumptions</CardTitle>
      <CardDescription>Choose a saved B1 preparation with evaluation and warmup coverage. The working or latest price dataset is never substituted.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border bg-muted/30 p-3 text-xs">Selected B2 policy #{allocationId ?? "none"} · {signedPolicy ? "Signed alpha overlay" : "Capital long-only"} · {policyRepresentationLabel} · original preparation #{sourceId ?? "unavailable"} · candidates {json(policyRequest.candidateIds)}. A new validation creates a separate immutable run.
          {signedPolicy && <p className="mt-2 border-t pt-2">Frozen signed limits: {json(policyRequest.signedConstraints)} · target excess: {text(policyRequest.targetExcessReturn)}. Validation must execute the frozen signed policy, not the current B2 form. Short borrow and financing frictions are not modeled unless explicitly supplied by the execution engine.</p>}
          <p className="mt-2 border-t pt-2" data-testid="b3-frozen-risk-model">Frozen B2 risk model: <strong>{selectedRiskModelLabel}</strong>
            {selectedRiskModel.type === "STATISTICAL_FACTOR" ? ` · F=${text(selectedRiskModel.factorCount)} · specific-risk floor=${text(selectedRiskModel.specificRiskFloorFraction)}` : ""}.
            {selectedRiskModel.type === "STATISTICAL_FACTOR" ? " B3 must recompute Gamma and loadings independently at each point-in-time decision." : ""}
          </p>
          <p className="mt-2 border-t pt-2" data-testid="b3-frozen-forecast-model">Frozen B2 forecast model: <strong>{pmValue(selectedForecast.type)}</strong>. B3 re-estimates the frozen specification independently at each historical cutoff; views enter only when both their effective and availability dates permit them. Current B2 form edits cannot change a retrieved run.{selectedForecast.type === "SIGNAL_RIDGE" && ` Selected frozen factors: ${json(selectedForecast.factorIds)} · training window ${pmValue(selectedForecast.trainingWindowDates)} dates · minimum ${pmValue(selectedForecast.minTrainingDates)} · λ ${pmValue(selectedForecast.lambdaSignal)} · HAC ${pmValue(selectedForecast.hacBandwidth)} · signal timing ${pmValue(selectedForecast.executionTiming)}.`}</p>
           <p className="mt-2 border-t pt-2" data-testid="b3-frozen-robustness">Frozen B2 robustness: <strong>{pmValue(record(policyRequest.robustness).method)}</strong> · κ {pmValue(record(policyRequest.robustness).kappa)}. Validation uses the frozen policy specification, not the current B2 controls.</p>
            <p className="mt-2 border-t pt-2" data-testid="b3-frozen-cost-policy">Frozen B2 method: <strong>{policyRequest.costAware ? "Legacy cost-aware absolute-cost optimization" : record(policyRequest.rebalanceRegularization).lambdaR !== undefined ? Number(record(policyRequest.rebalanceRegularization).lambdaR) > 0 ? "Rebalance regularization" : "No B2 trading preference" : "Turnover settings not recorded"}</strong>{policyRequest.costAware ? ` · fee ${text(record(policyRequest.costAware).transactionCostBps)} bps · slippage ${text(record(policyRequest.costAware).slippageBps)} bps · h ${text(record(policyRequest.costAware).costAmortizationDays)} days · preference ${text(record(policyRequest.costAware).turnoverPreferenceBps ?? "Not recorded")} bps (not charged)` : Number(record(policyRequest.rebalanceRegularization).lambdaR) > 0 ? ` · λR ${text(record(policyRequest.rebalanceRegularization).lambdaR)} daily objective units · no estimated execution fees` : ""}. Frozen B2 snapshot: {json(record(policyRequest.costAware ?? policyRequest.rebalanceRegularization).holdings)}. B3 starts from its own explicit historical holdings, not B2 targets.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="b3-prepared">Frozen validation B1 preparation</Label><select id="b3-prepared" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={preparedId} onChange={e => setPreparedId(e.target.value)} data-testid="select-b3-prepared"><option value="">Select explicitly</option>{compatibleInputs.map(item => { const id = preparedInputIdOf(item); const candidateCount = item.candidateCount === null ? "candidate count unavailable" : `${item.candidateCount} candidates`; return id ? <option key={id} value={id}>#{id} · {text(preparedRepresentation(item))} · {candidateCount} · {item.technicalStatus ?? "status unavailable"} · {text(item.createdAt)}</option> : null; })}</select>
            {selectedPreparedLoading && <p className="text-xs text-muted-foreground" role="status" data-testid="status-b3-prepared-loading">Fetching full B1 preparation #{selectedPreparedId}…</p>}
            {selectedPreparedFull && (
              <div className="rounded border bg-muted/20 p-2 text-xs" data-testid="status-b3-prepared-full">
                <p>Full B1 #{selectedPreparedId} · {text(selectedPreparedRepresentation)} · technical status {text(selectedPreparedStatus)} · {selectedPreparedCandidates.length} candidates · cutoff {text(record(record(selectedPreparedFull.snapshot).request).cutoffDate)}</p>
                {selectedPreparedCandidates.length > 0
                  ? <details className="mt-1"><summary className="cursor-pointer">Inspect full-record candidate definitions and IDs</summary><ul className="mt-1 space-y-1">{selectedPreparedCandidates.map((candidate, index) => <li key={`${text(candidate.candidateId)}-${index}`}>
                    {text(candidate.name)} · ID {text(candidate.candidateId)} · {text(candidate.status)}
                    {candidate.factorId !== undefined ? ` · factor ${text(candidate.factorId)}` : ""}
                    {candidate.mapping !== undefined ? ` · mapping ${text(candidate.mapping)}` : ""}
                  </li>)}</ul></details>
                  : <p className="mt-1 text-muted-foreground">The full saved record contains no candidate outputs.</p>}
              </div>
            )}
          </div>
          <div className="space-y-1"><Label htmlFor="b3-start">Evaluation start</Label><Input id="b3-start" type="date" value={start} onChange={e => setStart(e.target.value)} data-testid="input-b3-start" /></div>
          <div className="space-y-1"><Label htmlFor="b3-end">Evaluation end</Label><Input id="b3-end" type="date" value={end} onChange={e => setEnd(e.target.value)} data-testid="input-b3-end" /></div>
          <div className="space-y-1"><Label htmlFor="b3-calendar">Decision calendar</Label><select id="b3-calendar" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={calendar} onChange={e => setCalendar(e.target.value as typeof calendar)} data-testid="select-b3-calendar"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
          <div className="space-y-1"><Label htmlFor="b3-timing">Execution</Label><select id="b3-timing" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={timing} onChange={e => setTiming(e.target.value as typeof timing)} data-testid="select-b3-timing"><option value="next_close">Next close</option><option value="next_open">Next open (adjusted)</option><option value="same_close">Same close</option></select></div>
          <div className="space-y-1"><Label htmlFor="b3-benchmark">Benchmark ticker (optional)</Label><Input id="b3-benchmark" value={benchmark} onChange={e => setBenchmark(e.target.value)} placeholder="Ticker" data-testid="input-b3-benchmark" /></div>
          <div className="space-y-1"><Label htmlFor="b3-nav">Initial NAV</Label><Input id="b3-nav" type="number" min="0.01" step="any" value={initialNav} onChange={e => setInitialNav(Number(e.target.value))} data-testid="input-b3-nav" /></div>
          <div className="space-y-1"><Label htmlFor="b3-cash">Initial cash</Label><Input id="b3-cash" type="number" min={signedPolicy ? undefined : "0"} step="any" value={initialCash} onChange={e => setInitialCash(Number(e.target.value))} data-testid="input-b3-cash" /></div>
          <details className="rounded border p-3 sm:col-span-2"><summary className="cursor-pointer text-xs font-semibold">Advanced · historical initial holdings JSON</summary>
            <div className="mt-3 space-y-1"><Label htmlFor="b3-holdings">B3 historical execution holdings (ticker → quantity JSON)</Label><Input id="b3-holdings" value={holdingsText} onChange={e => setHoldingsText(e.target.value)} data-testid="input-b3-holdings" />
              <p className="text-[11px] text-muted-foreground">This is the historical execution book only; B2 starting-portfolio/reference choices are never injected here.</p>
            </div>
          </details>
          <div className="space-y-1"><Label htmlFor="b3-cost">Transaction cost (bps)</Label><Input id="b3-cost" type="number" min="0" step="any" value={cost} onChange={e => setCost(Number(e.target.value))} data-testid="input-b3-cost" /></div>
          <div className="space-y-1"><Label htmlFor="b3-slippage">Slippage (bps)</Label><Input id="b3-slippage" type="number" min="0" step="any" value={slippage} onChange={e => setSlippage(Number(e.target.value))} data-testid="input-b3-slippage" /></div>
          <div className="space-y-1"><Label htmlFor="b3-yield">Daily cash yield (decimal)</Label><Input id="b3-yield" type="number" step="any" value={yieldDaily} onChange={e => setYieldDaily(Number(e.target.value))} data-testid="input-b3-yield" /></div>
        </div>
         {!compatibleInputs.length && !loading && !preparedInputsQuery.isLoading && !preparedInputsQuery.isFetching && <p className="text-xs text-amber-700">No saved preparation of this representation is available. Prepare and save one in Optimization Inputs, then refresh this list.</p>}
        <p className="text-xs text-muted-foreground">Validation uses the working selected B2 policy and explicitly frozen B1 preparation above. Inspecting a saved Validation Run does not replace either working input.</p>
        {historyInspectionActive && <p role="status" className="text-xs text-muted-foreground">Validation is disabled while a saved record is pinned. Return to the working draft before starting a new Validation Run.</p>}
        <div className="flex flex-wrap gap-2 border-t pt-4">{!onValidateActionChange && <Button size="sm" onClick={stableValidateRun} disabled={validateAction.disabled} data-testid="button-run-b3-validation" title="Submits a new immutable Validation Run job"><FlaskConical className="mr-2 h-4 w-4" />{validationJob.active ? "Validation job running…" : validationJob.submitting ? "Submitting validation…" : !policyReady && allocationId ? "Retrieving frozen policy…" : selectedPreparedLoading ? "Retrieving full B1 preparation…" : "Validate"}</Button>}<Button size="sm" variant="outline" onClick={() => { void refresh(); void preparedInputsQuery.refetch(); }} disabled={loading || preparedInputsQuery.isFetching || validateBusy} data-testid="button-refresh-b3"><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh saved inputs & runs</Button></div>
      </CardContent></Card>}
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Saved B3 validation runs</CardTitle><CardDescription>Persistent results can be retrieved by ID after reload, independent of the current working data.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1"><Label htmlFor="b3-saved">Inspect saved run</Label><select id="b3-saved" disabled={historyInspectionActive || validateBusy} className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm" value={viewedRunId ?? ""} onChange={e => {
          if (historyInspectionActive) return;
          const nextId = e.target.value ? Number(e.target.value) : null;
          selectionGenerationRef.current += 1;
          currentViewedRunIdRef.current = nextId;
          setSelectedRunId(nextId);
        }} data-testid="select-b3-saved"><option value="">Select run</option>{saved.map(item => { const id = idOf(item, "validationRunId"); return id ? <option key={id} value={id}>#{id} · allocation #{text(item.allocationId)} · {text(item.reconciliationStatus ?? item.status)} · {text(item.validatedAt ?? item.createdAt)}</option> : null; })}</select>
          {historyInspectionActive && <p className="text-xs text-muted-foreground">This run is pinned by saved-history inspection. Return to the working draft to inspect another saved run.</p>}
        </div>
        <div className="space-y-1"><Label htmlFor="b3-compare">Compare with saved run</Label><select id="b3-compare" className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm" value={comparisonId ?? ""} onChange={e => setComparisonId(e.target.value ? Number(e.target.value) : null)} data-testid="select-b3-comparison"><option value="">No comparison</option>{saved.filter(item => idOf(item, "validationRunId") !== viewedRunId).map(item => { const id = idOf(item, "validationRunId"); return id ? <option key={id} value={id}>#{id} · {text(item.representation)}</option> : null; })}</select></div>
        {!loading && !saved.length && <span className="text-xs text-muted-foreground">No saved B3 runs yet.</span>}
      </CardContent></Card>
      <AllocationModeComparisonPanel validationRuns={saved} />
      {run && <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-primary/20 bg-primary/5 px-4 py-3 text-xs" data-testid="status-b3-run">
        <div><strong>Validation #{text(run.validationRunId ?? viewedRunId)}</strong> · {status} · {text(a.evaluationStartDate)} → {text(a.evaluationEndDate)} · {getRepresentation(run)}
          <p className="mt-1 text-muted-foreground">{isSuccessful ? "Historical simulation completed; accounting checks passed. This does not prove alpha efficacy or independent out-of-sample profitability." : `Run is not marked complete${output.failureDate ? `; failure at ${text(output.failureDate)}` : ""}. ${text(output.reason ?? output.diagnostic ?? "A partial diagnostic ledger is not a successful full-period backtest.")}`}</p></div>
      </div>
      <details className="rounded border p-3" data-testid="details-b3-frozen-diagnostics">
        <summary className="cursor-pointer text-sm font-semibold">Inspect historical forecast, risk, robustness, turnover and ledger diagnostics</summary>
        <div className="mt-4 space-y-5">
      <CostAwareValidationResult policyRequest={runPolicyRequest} run={run} />
      <RebalanceValidationResult policyRequest={runPolicyRequest} run={run} />
      <RobustnessPanel result={record(runPolicy.result ?? runPolicy)} request={runPolicyRequest} compact />
      <Card data-testid="card-b3-robustness-path"><CardHeader className="pb-3"><CardTitle className="text-sm">Historical robustness path</CardTitle><CardDescription>Frozen method {pmValue(runRobustness.method)} · κ {pmValue(runRobustness.kappa)}. Each date uses only its own available forecast and risk estimate; target distance is not turnover.</CardDescription></CardHeader><CardContent>{!decisions.length ? <p className="text-xs text-muted-foreground">No historical decisions have been saved for this run.</p> : <div className="max-h-64 overflow-auto rounded border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2">Decision</th><th className="p-2">Solver</th><th className="p-2">Method · κ</th><th className="p-2">Asset half-L1</th><th className="p-2">Haircut</th></tr></thead><tbody>{decisions.map((decision, index) => { const optimizer = record(decision.optimizer), robust = record(optimizer.robustness), comparison = record(record(robust.diagnostics).comparison); return <tr key={`${text(decision.decisionDate)}-${index}`} className="border-t" data-testid={`row-b3-robustness-${index}`}><td className="p-2">{text(decision.decisionDate)}</td><td className="p-2">{text(optimizer.status ?? decision.solverStatus)}</td><td className="p-2">{pmValue(robust.method ?? runRobustness.method)} · κ {pmValue(robust.kappa ?? runRobustness.kappa)}</td><td className="p-2 font-mono">{metric(comparison.assetWeightHalfL1)}</td><td className="p-2 font-mono">{metric(robust.robustHaircut)}</td></tr>; })}</tbody></table></div>}</CardContent></Card>
      <Card data-testid="b3-d3-forecast-path"><CardHeader className="pb-3"><CardTitle className="text-sm">Frozen D3 forecast path · {pmValue(runForecast.type)}</CardTitle><CardDescription>Each decision shows its own saved forecast, uncertainty and dated-view status. Later edits and terminal-sample views are never substituted.</CardDescription></CardHeader><CardContent className="space-y-3">{!datedForecastRows.length ? <p className="text-xs text-muted-foreground">No historical decisions returned for this saved validation run.</p> : <div className="overflow-auto rounded border"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Decision / cutoff</th><th className="p-2">Estimator</th><th className="p-2">Observations</th><th className="p-2">View availability</th><th className="p-2">Frozen state</th></tr></thead><tbody>{datedForecastRows.map(({ decision, forecast }, i) => <tr className="border-t align-top" key={`${text(decision.decisionDate)}-${i}`} data-testid={`row-b3-forecast-${i}`}><td className="p-2">{text(decision.decisionDate)}<br /><span className="text-muted-foreground">{text(decision.informationCutoff)}</span></td><td className="p-2">{pmValue(forecast.estimator ?? runForecast.type)}</td><td className="p-2">{text(forecast.observationCount ?? forecast.T)}</td><td className="p-2">{Array.isArray(forecast.views) ? forecast.views.map((view, j) => { const v = record(view); return <p key={j}>{text(v.type)} · {text(v.availabilityTimestamp)} · {text(v.status ?? "frozen")}</p>; }) : text(forecast.viewStatus ?? (Object.keys(forecast).length ? "No views used" : "Unavailable in saved record"))}</td><td className="p-2"><details><summary className="cursor-pointer">Inspect μ, Vμ, prior and views</summary><pre className="mt-2 max-h-72 max-w-[480px] overflow-auto whitespace-pre-wrap break-words">{json(Object.keys(forecast).length ? forecast : { status: "Forecast snapshot unavailable in this saved decision" })}</pre></details></td></tr>)}</tbody></table></div>}</CardContent></Card>
      {frozenRidge && <Card data-testid="card-b3-ridge-validation"><CardHeader className="pb-3"><CardTitle className="text-sm">Signal Combination — Ridge · validation</CardTitle><CardDescription>Each saved decision uses its own historical training window, fit and available feature vector. Errors below include only forecasts whose forward returns have matured; they are not trade P&amp;L.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs">
        <div className="grid gap-2 sm:grid-cols-3">{[["Matured RMSE", ridgeMatured.rmse], ["Matured MAE", ridgeMatured.mae], ["IC eligible dates", rows(ridgeMatured.informationCoefficients).filter(item => item.status === "AVAILABLE").length]].map(([label, value]) => <div key={String(label)} className="rounded border bg-muted/20 p-3"><span className="text-muted-foreground">{String(label)}</span><p className="mt-1 font-mono font-semibold" data-testid={`metric-b3-ridge-${String(label).toLowerCase().replace(/\W+/g, "-")}`}>{num(value) === null ? "Not supplied / undefined" : metric(value)}</p></div>)}</div>
        <p className="text-muted-foreground">Matured observations: {text(ridgeMatured.maturedCount)} · pending: {text(ridgeMatured.pendingCount)} · unavailable: {text(ridgeMatured.unavailableCount)}. Date IC requires at least three assets with nonconstant values. No future feature or forward return may enter a decision fit.</p>
        <details><summary className="cursor-pointer">Decision-date Pearson/rank IC and matured labels</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{json({ informationCoefficients: ridgeMatured.informationCoefficients, outcomes: ridgeValidation.outcomes })}</pre></details>
        {!datedForecastRows.length ? <p className="rounded border border-dashed p-3">No per-decision forecasts were saved for this run.</p> : <div className="overflow-auto rounded border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Decision / cutoff</th><th className="p-2">Signal / execution / label</th><th className="p-2">Training dates / rows</th><th className="p-2">Intercept / coefficients</th><th className="p-2">Forecast / uncertainty</th></tr></thead><tbody>{datedForecastRows.map(({ decision, forecast }, i) => { const ridge = record(forecast.ridge); const predictions = rows(ridge.predictions); const firstPrediction = predictions[0] ?? {}; return <tr key={`${text(decision.decisionDate)}-${i}`} className="border-t align-top" data-testid={`row-b3-ridge-${i}`}><td className="p-2">{text(decision.decisionDate)}<br />{text(decision.informationCutoff)}</td><td className="p-2">{text(firstPrediction.signalDate)} / {text(firstPrediction.executionDate)}<br />{text(firstPrediction.labelStart)} → {text(firstPrediction.labelEnd)}</td><td className="p-2">{text(ridge.trainingDateCount)} / {text(ridge.trainingRowCount)}<br />{text(ridge.peerUniverse)}</td><td className="p-2 font-mono">{text(ridge.intercept)}<details><summary className="cursor-pointer">Coefficients &amp; scaler</summary><pre className="mt-2 max-w-64 overflow-auto whitespace-pre-wrap">{json({ requestedFactorIds: ridge.requestedFactorIds, factorIds: ridge.factorIds, factorAliases: ridge.factorAliases, slopes: ridge.slopes, scaler: ridge.scaler, lambdaSignal: ridge.lambdaSignal, hacBandwidth: ridge.hacBandwidth })}</pre></details></td><td className="p-2"><details><summary className="cursor-pointer">Contributions, excess / gross μ, Vμ / SE</summary><pre className="mt-2 max-h-60 max-w-80 overflow-auto whitespace-pre-wrap">{json({ predictions: ridge.predictions, V_mu: ridge.V_mu, coefficientCovariance: ridge.coefficientCovariance, dateScores: ridge.dateScores })}</pre></details></td></tr>; })}</tbody></table></div>}
        <p className="text-muted-foreground">HAC Vμ is approximate conditional sampling uncertainty for a penalized fit, not realized-return volatility. These matured metrics do not correct for factor selection, penalty tuning, frozen-universe selection, or execution frictions.</p>
      </CardContent></Card>}
      <Card data-testid="b3-d1-risk-model-result"><CardHeader className="pb-3">
        <CardTitle className="text-sm">Frozen B3 risk-model path · {runRiskModelLabel}</CardTitle>
        <CardDescription>Per-decision risk models are read from the saved B3 optimizer results; earlier decisions are not summarized using terminal-sample loadings.</CardDescription>
      </CardHeader><CardContent className="space-y-3">
        {runRiskModel.type === "STATISTICAL_FACTOR" && <p className="text-xs">Frozen fixed F={text(runRiskModel.factorCount)} · specific-risk floor={text(runRiskModel.specificRiskFloorFraction)}.</p>}
        {!datedRiskRows.length && <p className="text-xs text-muted-foreground" data-testid="b3-d1-risk-model-unavailable">No per-decision riskModel diagnostics were returned for this saved B3 run.</p>}
        {!!datedRiskRows.length && <div className="overflow-auto rounded border"><table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-muted"><tr><th className="p-2">Decision</th><th className="p-2">Information cutoff</th><th className="p-2">Model</th><th className="p-2">T / N / F</th><th className="p-2">Data identity</th><th className="p-2">Risk decomposition</th></tr></thead>
          <tbody>{datedRiskRows.map(({ decision, risk }) => {
            const provenance = record(risk.provenance);
            const factorModel = record(risk.factorModel);
            const diagnostics = record(factorModel.diagnostics);
            return <tr key={text(decision.decisionDate)} className="border-t align-top">
              <td className="p-2">{text(decision.decisionDate)}</td>
              <td className="p-2">{text(provenance.informationCutoff ?? decision.informationCutoff)}</td>
              <td className="p-2">{text(risk.type)}</td>
              <td className="p-2">{text(provenance.observationCount)} / {text(provenance.alphaCount)} / {text(risk.factorCount)}</td>
              <td className="max-w-48 truncate p-2" title={text(provenance.datasetHash)}>{text(provenance.datasetHash)}</td>
              <td className="p-2"><details><summary className="cursor-pointer">Inspect saved contributions</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">{json({
                factorBasisUnstable: diagnostics.factorBasisUnstable,
                commonFactorVarianceShare: diagnostics.commonFactorVarianceShare,
                specificRiskVarianceShare: diagnostics.specificRiskVarianceShare,
                decomposition: risk.decomposition,
              })}</pre></details></td>
            </tr>;
          })}</tbody></table></div>}
      </CardContent></Card>
      {comparison && <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Saved-run comparison · #{text(run.validationRunId)} vs #{text(comparison.validationRunId)}</CardTitle><CardDescription>Asset and alpha policies are compared without retroactive rescaling or a declared winner.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs">
        <Badge variant="outline" className={mismatches.length || comparisonPolicyQuery.isLoading ? "border-amber-300 bg-amber-50 text-amber-800" : "border-green-300 bg-green-50 text-green-800"}>{comparisonPolicyQuery.isLoading ? "Checking frozen B2 settings…" : mismatches.length ? `Unmatched configuration · ${mismatches.join(", ")}` : "Matched non-risk settings · frozen risk model may differ · no winner inferred"}</Badge>
        {differentCapitalStructures && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">Capital long-only and signed overlays use different capital structures and objective/constraint semantics. This is not a controlled comparison; no winner is inferred. Compare only with matched alpha universe, data, dates, estimator, applicable risk model and execution/cost assumptions.</p>}
        {(runSignedPolicy || comparisonSignedPolicy) && <div className="grid gap-2 rounded border bg-muted/20 p-3 sm:grid-cols-2"><div><strong>Policy #{text(runAllocationId)}</strong><p>{runSignedPolicy ? "Signed alpha overlay" : "Capital long-only"} · {text(runPolicyRequest.objective && record(runPolicyRequest.objective).type)}</p><pre className="whitespace-pre-wrap break-words">{json(runPolicyRequest.signedConstraints)}</pre></div><div><strong>Policy #{text(comparisonAllocationId)}</strong><p>{comparisonSignedPolicy ? "Signed alpha overlay" : "Capital long-only"} · {text(record(comparisonPolicyRequest.objective).type)}</p><pre className="whitespace-pre-wrap break-words">{json(comparisonPolicyRequest.signedConstraints)}</pre></div></div>}
        {ridgeMeanComparison && <p className="rounded border border-primary/20 bg-primary/5 p-2">Changed forecast specification: {comparedForecastTypes.join(" versus ")}. All other policy and evaluation settings must still match. This fixed-policy comparison does not establish superiority.</p>}
        <p className="text-muted-foreground">Comparison uses frozen run metadata, not current working settings. Different realized turnover and risk remain legitimate outcomes; matching configuration does not establish equivalent policies or alpha efficacy.</p>
        {!comparisonPolicyQuery.isLoading && !mismatches.length && <div className="grid gap-2 rounded border bg-muted/20 p-3 sm:grid-cols-2">
          <p>Risk model: {runRiskModelLabel} (F={text(runRiskModel.factorCount)}, floor={text(runRiskModel.specificRiskFloorFraction)})</p>
          <p>Comparison model: {text(comparisonPolicyRiskModel.type)} (F={text(comparisonPolicyRiskModel.factorCount)}, floor={text(comparisonPolicyRiskModel.specificRiskFloorFraction)})</p>
          <p>Mean decision alpha-weight half-L1 distance: {metric(meanDecisionDistance(decisions, rows(getResult(comparison).decisions), "candidateWeights"))}</p>
          <p>Mean decision asset-weight half-L1 distance: {metric(meanDecisionDistance(decisions, rows(getResult(comparison).decisions), "targetAssetWeights"))}</p>
        </div>}
        <div className="overflow-auto"><table className="w-full min-w-[460px] text-xs"><thead><tr className="border-b text-left"><th className="py-2">Metric</th><th>#{text(run.validationRunId)} · {getRepresentation(run)}</th><th>#{text(comparison.validationRunId)} · {getRepresentation(comparison)}</th></tr></thead><tbody>{summaryItems.map(item => {
          const otherOutput = getResult(comparison);
          const otherSummary = record(otherOutput.summary ?? otherOutput.metrics);
          const otherMetrics = record(otherOutput.metrics);
          const key = item.label === "Cumulative return" ? "cumulativeReturn" : item.label === "Annualized return" ? "annualizedReturn" : item.label === "Annualized volatility" ? "annualizedVolatility" : item.label === "Sharpe" ? "sharpe" : item.label === "Maximum drawdown" ? "maximumDrawdown" : item.label === "Turnover" ? "turnover" : "externalTradedNotional";
          const comparisonTurnover = num(otherSummary.turnover) ?? num(otherSummary.averageTurnover);
          const comparisonNotional = otherMetrics.externalTradedNotional ?? otherSummary.externalTradedNotional;
          const comparisonValue = item.label === "Sharpe" ? metric(otherSummary[key])
            : item.label === "Turnover" ? comparisonTurnover === null ? "Not recorded" : percent(comparisonTurnover)
            : item.label === "External traded notional" ? num(comparisonNotional) === null ? "Not recorded" : money(comparisonNotional)
            : percent(otherSummary[key]);
          return <tr key={item.label} className="border-b"><td className="py-2">{item.label}</td><td>{item.value}</td><td>{comparisonValue}</td></tr>;
        })}</tbody></table></div>
        {!comparisonPolicyQuery.isLoading && !mismatches.length && <details className="rounded border bg-muted/20 p-3"><summary className="cursor-pointer font-semibold">Inspect point-in-time alpha and asset weights</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{json(decisions.map(item => ({ decisionDate: item.decisionDate, candidateWeights: item.candidateWeights, targetAssetWeights: item.targetAssetWeights })))}</pre>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{json(rows(getResult(comparison).decisions).map(item => ({ decisionDate: item.decisionDate, candidateWeights: item.candidateWeights, targetAssetWeights: item.targetAssetWeights })))}</pre>
          </div>
        </details>}
        <details><summary className="cursor-pointer">Frozen estimation & objective settings for both policies</summary><pre className="mt-2 overflow-auto rounded border bg-muted/30 p-2">{json({ first: getResult(run).policyIdentity, second: getResult(comparison).policyIdentity })}</pre></details>
      </CardContent></Card>}
        </div>
      </details>
      {step === "results" && <>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net results</CardTitle><CardDescription>Undefined metrics are not treated as zero. Daily excess Sharpe uses the declared daily cash yield and sample standard deviation.</CardDescription></CardHeader>
          <CardContent><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{summaryItems.map(item => <div key={item.label} className="rounded border bg-muted/20 p-3" data-testid={`metric-b3-${item.label.toLowerCase().replace(/\W+/g, "-")}`}><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.note}</p></div>)}</div>
          {summary.sharpe == null && <p className="mt-3 text-xs text-amber-700">Sharpe undefined: {text(summary.sharpeReason ?? "insufficient daily excess observations or zero sample volatility")}.</p>}{summary.annualizedVolatility == null && <p className="mt-2 text-xs text-amber-700">Volatility undefined: {text(summary.volatilityReason)}</p>}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Net equity & drawdown</CardTitle><CardDescription>Executed holdings and actual cash drive NAV; target weights do not earn returns before execution.</CardDescription></CardHeader><CardContent>{chart.length ? <ResponsiveContainer width="100%" height={280}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8e0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={25} /><YAxis yAxisId="nav" tick={{ fontSize: 10 }} domain={["auto", "auto"]} /><YAxis yAxisId="dd" orientation="right" tick={{ fontSize: 10 }} tickFormatter={value => `${(value * 100).toFixed(0)}%`} /><Tooltip /><Legend /><Line yAxisId="nav" type="linear" dataKey="nav" stroke="#1B2F5B" dot={false} strokeWidth={2} name="Net NAV" /><Line yAxisId="dd" type="linear" dataKey="drawdown" stroke="#d97706" dot={false} name="Drawdown" /></LineChart></ResponsiveContainer> : <p className="text-xs text-muted-foreground">No daily NAV series returned.</p>}</CardContent></Card>
        <DataTable title="Monthly returns" description="Partial calendar months must be identified in saved month records; incomplete periods are not full-month evidence." data={monthly} columns={[{ key: "month", label: "Month" }, { key: "return", label: "Net return", render: r => percent(r.portfolioReturn ?? r.netReturn ?? r.return) }, { key: "partial", label: "Partial period", render: r => r.partial === true || r.isPartial === true ? "Partial" : r.partial === false || r.isPartial === false ? "Full" : "Not specified" }]} />
        <DataTable title="Daily holdings & exposure" description="Actual quantities drift between executions. Cash and asset P&L are from one consolidated book." data={ledger} columns={[{ key: "date", label: "Date" }, { key: "endingNav", label: "Net NAV", render: r => money(r.endingNav ?? r.nav) }, { key: "holdings", label: "Actual holdings", render: r => json(r.endingPositions) }, { key: "cash", label: "Actual cash", render: r => money(r.endingCash) }, { key: "exposures", label: "Actual exposures", render: r => json(rows(r.endingPositions).map(p => ({ ticker: p.ticker, weight: p.weight }))) }]} />
      </>}
      {step === "diagnostics" && <>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Frozen identity & accounting</CardTitle><CardDescription>B1 signals → contemporaneous H and internal cash → B2 decision weights → A1 netted asset execution. Costs are charged once on external asset trades.</CardDescription></CardHeader><CardContent className="grid gap-3 text-xs md:grid-cols-2">
          <div className="rounded border p-3"><strong>Policy, data, engine</strong><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{json({ policy: output.policyIdentity, datasetHash: run.datasetHash, engineVersion: run.engineVersion, validationInputHash: run.validationInputHash })}</pre></div>
          <div className="rounded border p-3"><strong>Frozen validation assumptions</strong><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{json(run.assumptions)}</pre></div>
          <div className="rounded border p-3"><strong>Reconciliation</strong><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{json(output.diagnostics ?? output.reconciliation ?? output.accountingChecks)}</pre></div>
          <div className="rounded border p-3"><strong>Warnings / failure</strong><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{json(output.diagnostic ?? output.warnings ?? run.failure ?? output.failure ?? output.reason)}</pre></div>
        </CardContent></Card>
        <DataTable title="Historical decisions" description={runSignedPolicy ? "Each cutoff freezes signed alpha coefficients, aggregated underlying targets, execution weights, cash and exposure checks." : "At each cutoff: completed estimation intervals, μ, Σ, contemporaneous H and d, candidate weights b, targets, constraint checks and solver status."} data={decisions} columns={[{ key: "decisionDate", label: "Decision date" }, { key: "informationCutoff", label: "Cutoff" }, { key: "executionDate", label: "Executed" }, { key: "solverStatus", label: "Solver", render: r => text(record(r.optimizer).status) }, { key: "candidateWeights", label: runSignedPolicy ? "Signed alpha a" : "Alpha capital b", render: r => json(r.candidateWeights) }, { key: "targetAssetWeights", label: "Asset targets", render: r => json(r.targetAssetWeights) }, { key: "totalCash", label: "Target cash" }, { key: "executedAssetWeights", label: "Executed weights", render: r => json(r.executedAssetWeights) }, ...(runSignedPolicy ? [{ key: "signedOverlay", label: "Gross / net exposure", render: (r: Row) => json(record(r.optimizer).signedOverlay ?? r.signedOverlay) }] : [])]} />
        <details className="rounded border bg-muted/20 p-4 text-xs"><summary className="cursor-pointer font-semibold">Inspect complete decision inputs, estimates, mapping and checks</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap">{json(decisions)}</pre></details>
        <DataTable title="Execution ledger" description="Monetary asset/cash P&L, fees, slippage and external traded notional; sum of cost percentages is not compounded performance drag." data={ledger} columns={[{ key: "date", label: "Date" }, { key: "assetPnl", label: "Asset P&L", render: r => money(r.assetPnl) }, { key: "cashPnl", label: "Cash P&L", render: r => money(r.cashPnl) }, { key: "transactionCosts", label: "Fees", render: r => money(r.transactionCosts) }, { key: "slippage", label: "Slippage", render: r => money(r.slippage) }, { key: "externalTradedNotional", label: "External traded", render: r => money(r.externalTradedNotional) }, { key: "dailyNetReturn", label: "Daily net", render: r => percent(r.dailyNetReturn) }, { key: "reconciliationDifference", label: "Reconcile", render: r => money(r.reconciliationDifference) }]} />
      </>}
      <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">Rolling fixed-specification evaluation is not independent model-selection validation or proof of bias-free performance. The candidate universe is frozen and may reflect selection made with later knowledge. Adjusted-close prices do not model intraday execution, liquidity or corporate-action cash flows beyond the saved data conventions. Target constraints are checked at decisions, not guaranteed continuously as realized weights drift.</p>
    </div>}
  </section>;
}