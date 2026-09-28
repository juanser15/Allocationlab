import { useEffect, useRef, useState } from "react";
import type { B2PreparedSelection } from "./PreparedInputsPanel";
import type { D1RiskModelRequest } from "./D1RiskModelPanel";
import type { ForecastModelConfig } from "@workspace/api-client-react";
import { ForecastModelPanel, ForecastResults, validateForecast } from "./ForecastModelPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getAllocation, getGetAllocationQueryKey, getListAllocationsQueryKey, useCreateAllocation, useGetAllocation, useListAllocations, useReplayAllocation } from "@workspace/api-client-react";
import { SignedOverlayControls, SignedOverlayResult, initialSignedSettings } from "./SignedOverlaySection";
import type { SignedSettings } from "./SignedOverlaySection";
import { RobustnessPanel } from "./RobustnessPanel";
import { CostAwareAllocationResult, CostAwareControls, initialCostAwareForm, parseCostAware } from "./CostAwarePanel";
import type { CostAwareForm, CostAwareRequest } from "./CostAwarePanel";

type Representation = "asset_returns" | "alpha_streams" | "signals";
type AllocationRequest = {
  allocationMode?: "CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY";
  signedConstraints?: {
    alphaBounds?: Record<string, { min?: number; max?: number }>;
    grossAlphaMax?: number;
    groupGrossCaps?: { group: string; candidateIds: string[]; max: number }[];
    assetBounds?: Record<string, { min?: number; max?: number }>;
    grossAssetMax?: number;
    netAssetExposure?: { min?: number; max?: number };
    cash?: { min?: number; max?: number };
  };
  targetExcessReturn?: number;
  preparedInputId: number;
  candidateIds: string[];
  informationCutoff: string;
  decisionTimestamp: string;
  estimationWindow: number;
  minObservations: number;
  representation: Representation;
  returnConvention: "daily_decimal";
  expectedReturnShrinkage: number;
  covarianceDiagonalShrinkage: number;
  dailyCashYield: number;
  objective: { type: "minimum_variance" | "regularized_mean_variance"; gamma: number; eta: number };
  riskModel?: D1RiskModelRequest;
  forecastModel: ForecastModelConfig;
  robustness?: { method: "NOMINAL" | "ROBUST_MEAN_UNCERTAINTY"; kappa: number };
  costAware?: CostAwareRequest;
  constraints: {
    candidateBounds?: Record<string, { min?: number; max?: number }>;
    totalCash?: { min?: number; max?: number };
    assetBounds?: Record<string, { min?: number; max?: number }>;
    groupCaps?: Array<{ name: string; candidateIds: string[]; max: number }>;
    unsupported?: string[];
  };
};
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "Unavailable";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function assertBounds(value: unknown, label: string): void {
  for (const [key, rawBound] of Object.entries(asRecord(value))) {
    const bound = asRecord(rawBound);
    if (Object.keys(bound).some(field => field !== "min" && field !== "max")) {
      throw new Error(`${label} "${key}" may only contain min and max.`);
    }
    for (const field of ["min", "max"] as const) {
      const boundValue = bound[field];
      if (boundValue !== undefined && (typeof boundValue !== "number" || !Number.isFinite(boundValue))) {
        throw new Error(`${label} "${key}" ${field} must be a finite number.`);
      }
    }
    if (typeof bound.min === "number" && typeof bound.max === "number" && bound.min > bound.max) {
      throw new Error(`${label} "${key}" has min greater than max.`);
    }
  }
}

function idOf(item: unknown): number | null {
  const record = asRecord(item);
  const id = record.allocationId ?? record.id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

function localDateTime(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function alignedObservationCount(prepared: B2PreparedSelection, candidateIds: string[], cutoff: string): number | null {
  if (!candidateIds.length || !cutoff) return null;
  const candidateDateSets = candidateIds.map(id => prepared.returnDatesByCandidate[id]);
  if (candidateDateSets.some(dates => !Array.isArray(dates))) return null;
  const first = candidateDateSets[0].filter(date => date <= cutoff);
  const remaining = candidateDateSets.slice(1).map(dates => new Set(dates.filter(date => date <= cutoff)));
  return first.filter(date => remaining.every(dates => dates.has(date))).length;
}

function displayName(representation?: string): string {
  if (representation === "asset_returns") return "Asset Returns";
  if (representation === "alpha_streams") return "Alpha Streams";
  if (representation === "signals") return "Signals (unsupported for return optimization)";
  return representation ?? "Unavailable";
}

function activeForecastModel(form: ForecastModelConfig): ForecastModelConfig {
  const displayZ = form.displayZ ?? 1.96;
  if (form.type === "SAMPLE_MEAN") return { type: "SAMPLE_MEAN", displayZ };
  const shrinkagePrior = form.shrinkagePrior?.source === "USER_DEFINED"
    ? { source: "USER_DEFINED" as const, values: form.shrinkagePrior.values }
    : { source: "DEFAULT" as const };
  const shrinkage = form.shrinkage ?? 0;
  if (form.type === "SHRUNK_MEAN") return { type: "SHRUNK_MEAN", shrinkage, shrinkagePrior, displayZ };
  const priorMean = form.priorMean?.source === "USER_DEFINED_PRIOR"
    ? { source: "USER_DEFINED_PRIOR" as const, values: form.priorMean.values }
    : { source: form.priorMean?.source === "SHRUNK_PRIOR" ? "SHRUNK_PRIOR" as const : "SAMPLE_PRIOR" as const };
  const priorUncertainty = form.priorUncertainty?.type === "USER_DEFINED"
    ? { type: "USER_DEFINED" as const, candidateIds: form.priorUncertainty.candidateIds, matrix: form.priorUncertainty.matrix }
    : { type: "TAU_SIGMA" as const, ...(form.priorUncertainty?.tau !== undefined ? { tau: form.priorUncertainty.tau } : {}) };
  return {
    type: "BAYESIAN_VIEWS", displayZ, priorMean, priorUncertainty,
    ...(priorMean.source === "SHRUNK_PRIOR" ? { shrinkage, shrinkagePrior } : {}),
    views: (form.views ?? []).map(view => ({
      type: view.type, candidateId: view.candidateId,
      ...(view.type === "RELATIVE" ? { relativeCandidateId: view.relativeCandidateId } : {}),
      q: view.q, variance: view.variance,
      effectiveTimestamp: view.effectiveTimestamp, availabilityTimestamp: view.availabilityTimestamp,
    })),
  };
}

export function B2AllocationPanel({
  prepared,
  runToken,
  onRunningChange,
  onAllocationSelectionChange,
  riskModel,
  onCandidateCountChange,
  onEstimationWindowChange,
  onAlignedObservationCountChange,
}: {
  prepared: B2PreparedSelection | null;
  runToken: number;
  onRunningChange?: (running: boolean) => void;
  onAllocationSelectionChange?: (id: number | null) => void;
  riskModel: D1RiskModelRequest;
  onCandidateCountChange?: (count: number) => void;
  onEstimationWindowChange?: (days: number) => void;
  onAlignedObservationCountChange?: (count: number | null) => void;
}) {
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [informationCutoff, setInformationCutoff] = useState("");
  const [decisionTimestamp, setDecisionTimestamp] = useState(localDateTime);
  const [estimationWindow, setEstimationWindow] = useState(252);
  const [minObservations, setMinObservations] = useState(60);
  const [forecastModel, setForecastModel] = useState<ForecastModelConfig>({ type: "SAMPLE_MEAN", displayZ: 1.96, shrinkage: 0, shrinkagePrior: { source: "DEFAULT" }, priorMean: { source: "SAMPLE_PRIOR" }, priorUncertainty: { type: "TAU_SIGMA" }, views: [] });
  const [robustMethod, setRobustMethod] = useState<"NOMINAL" | "ROBUST_MEAN_UNCERTAINTY">("NOMINAL");
  const [kappaText, setKappaText] = useState("1");
  const [covarianceDiagonalShrinkage, setCovarianceDiagonalShrinkage] = useState(0);
  const [dailyCashYield, setDailyCashYield] = useState(0);
  const [objectiveType, setObjectiveType] = useState<AllocationRequest["objective"]["type"]>("minimum_variance");
  const [gamma, setGamma] = useState(1);
  const [eta, setEta] = useState(0);
  const [cashBoundsText, setCashBoundsText] = useState("{}");
  const [candidateBoundsText, setCandidateBoundsText] = useState("{}");
  const [assetBoundsText, setAssetBoundsText] = useState("{}");
  const [groupCapsText, setGroupCapsText] = useState("[]");
  const [unsupportedText, setUnsupportedText] = useState("");
  const [allocationMode, setAllocationMode] = useState<"CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY">("CAPITAL_LONG_ONLY");
  const [signedSettings, setSignedSettings] = useState<SignedSettings>(initialSignedSettings);
  const [targetExcessReturn, setTargetExcessReturn] = useState("");
  const [costAwareForm, setCostAwareForm] = useState<CostAwareForm>(initialCostAwareForm);
  const [result, setResult] = useState<JsonRecord | null>(null);
  const [selectedAllocationId, setSelectedAllocationId] = useState<number | null>(null);
  const [replayStatus, setReplayStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const savedQuery = useListAllocations();
  const detailQuery = useGetAllocation(selectedAllocationId ?? 0, { query: { enabled: selectedAllocationId !== null, queryKey: getGetAllocationQueryKey(selectedAllocationId ?? 0) } });
  const createMutation = useCreateAllocation();
  const replayMutation = useReplayAllocation();
  const saved = savedQuery.data ?? [];
  const loadingSaved = savedQuery.isLoading || savedQuery.isFetching;
  const busy = createMutation.isPending || replayMutation.isPending;
  const lastRunToken = useRef(0);
  const selectedCandidateSet = new Set(candidateIds);

  useEffect(() => {
    onCandidateCountChange?.(candidateIds.length);
  }, [candidateIds, onCandidateCountChange]);

  useEffect(() => {
    onAlignedObservationCountChange?.(prepared
      ? alignedObservationCount(prepared, candidateIds, informationCutoff)
      : null);
  }, [prepared, candidateIds, informationCutoff, onAlignedObservationCountChange]);

  useEffect(() => {
    if (!prepared) {
      setCandidateIds([]);
      setInformationCutoff("");
      return;
    }
    setCandidateIds(prepared.candidateIds);
    setInformationCutoff(prepared.informationCutoff);
    setResult(null);
    setSelectedAllocationId(null);
    onAllocationSelectionChange?.(null);
    setReplayStatus(null);
  }, [prepared, onAllocationSelectionChange]);

  async function refreshSaved() {
    try {
      await savedQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved allocations could not be loaded.");
    }
  }

  async function loadAllocation(id: number) {
    setError(null);
    try {
      const payload = await queryClient.fetchQuery({ queryKey: getGetAllocationQueryKey(id), queryFn: () => getAllocation(id) });
      setSelectedAllocationId(id);
      onAllocationSelectionChange?.(id);
      setResult(asRecord(payload));
      setReplayStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved allocation could not be loaded.");
    }
  }

  async function runAllocation() {
    setError(null);
    if (!prepared) {
      setError("Select or prepare an immutable B1 input version before optimizing.");
      return;
    }
    if (!candidateIds.length) {
      setError("Select at least one canonical candidate from the prepared version.");
      return;
    }
    if (allocationMode === "SIGNED_OVERLAY" && prepared.representation !== "alpha_streams") {
      setError("Signed alpha overlay requires a prepared alpha-stream representation.");
      return;
    }
    const kappa = Number(kappaText);
    if (!kappaText.trim() || !Number.isFinite(kappa) || kappa < 0) {
      setError("Robustness κ must be a finite nonnegative number.");
      return;
    }
    if (robustMethod === "ROBUST_MEAN_UNCERTAINTY" && objectiveType === "minimum_variance") {
      setError("Robust forecast uncertainty is unavailable for minimum variance until its objective is defined.");
      return;
    }
    const knownObservations = prepared ? alignedObservationCount(prepared, candidateIds, informationCutoff) : null;
    const effectiveObservations = knownObservations === null ? estimationWindow : Math.min(estimationWindow, knownObservations);
    const selectedFactorCount = riskModel.factorCount ?? Math.min(5, Math.max(0, candidateIds.length - 1), effectiveObservations - 1);
    if (prepared.representation === "alpha_streams" && riskModel.type === "STATISTICAL_FACTOR" &&
      (!Number.isSafeInteger(selectedFactorCount) || selectedFactorCount < 1 ||
       selectedFactorCount >= candidateIds.length || selectedFactorCount >= effectiveObservations)) {
      setError(`INSUFFICIENT_HISTORY_OR_DIMENSION: fixed F=${selectedFactorCount} requires 1 ≤ F < N (${candidateIds.length}) and F < T (${effectiveObservations}).`);
      return;
    }
    if (prepared.representation === "alpha_streams" && riskModel.type === "STATISTICAL_FACTOR" &&
      (!Number.isFinite(riskModel.specificRiskFloorFraction) || (riskModel.specificRiskFloorFraction ?? -1) < 0)) {
      setError("Specific-risk floor fraction must be finite and nonnegative.");
      return;
    }
    if (!informationCutoff || !Number.isInteger(estimationWindow) || estimationWindow < 2
      || !Number.isInteger(minObservations) || minObservations < 2
      || covarianceDiagonalShrinkage < 0 || covarianceDiagonalShrinkage > 1
       || !Number.isFinite(dailyCashYield)
      || !Number.isFinite(covarianceDiagonalShrinkage) || !Number.isFinite(gamma) || gamma <= 0
      || !Number.isFinite(eta) || eta < 0 || !Number.isFinite(estimationWindow) || !Number.isFinite(minObservations)
      || Number.isNaN(new Date(decisionTimestamp).getTime())) {
      setError("Provide an information cutoff, positive integer windows/observation count, shrinkage values in [0,1], γ > 0 and η ≥ 0.");
      return;
    }
    let constraints: AllocationRequest["constraints"];
    try {
      const submittedForecast = activeForecastModel(forecastModel);
      validateForecast(submittedForecast, candidateIds, informationCutoff, decisionTimestamp);
      const costAware = parseCostAware(costAwareForm, informationCutoff, allocationMode === "SIGNED_OVERLAY");
      if (costAware && objectiveType !== "regularized_mean_variance")
        throw new Error("Cost-aware optimization requires the regularized mean-variance objective.");
      let signedConstraints: AllocationRequest["signedConstraints"];
      if (allocationMode === "SIGNED_OVERLAY") {
        const { alphaBounds, netAssetExposure, cash, groupGrossCaps } = signedSettings;
        let assetBounds: Record<string, { min?: number; max?: number }>;
        try {
          assetBounds = JSON.parse(signedSettings.assetBoundsText);
        } catch {
          throw new Error("Signed asset bounds must be valid JSON.");
        }
        if (!assetBounds || typeof assetBounds !== "object" || Array.isArray(assetBounds)) throw new Error("Signed asset bounds must be a ticker-to-bounds JSON object.");
        assertBounds(alphaBounds, "Signed alpha bounds");
        assertBounds(assetBounds, "Signed asset bounds");
        assertBounds({ netAssetExposure, cash }, "Signed exposure bounds");
        for (const id of Object.keys(alphaBounds)) if (!candidateIds.includes(id)) throw new Error(`Alpha bound "${id}" is not in the selected candidate set.`);
        if (Object.entries(assetBounds).some(([id, bounds]) => !id.trim() || !bounds || typeof bounds !== "object" || Array.isArray(bounds))) throw new Error("Asset bounds require a ticker and finite min/max.");
        if (groupGrossCaps.some(cap => !cap.group.trim() || !cap.candidateIds.length || cap.candidateIds.some(id => !candidateIds.includes(id)) || !Number.isFinite(cap.max) || cap.max < 0)) throw new Error("Group caps require a name, selected alpha IDs and nonnegative maximum.");
        const grossAlphaMax = Number(signedSettings.grossAlphaMax), grossAssetMax = Number(signedSettings.grossAssetMax);
        if (!signedSettings.grossAlphaMax || !signedSettings.grossAssetMax || !Number.isFinite(grossAlphaMax) || !Number.isFinite(grossAssetMax) || grossAlphaMax < 0 || grossAssetMax < 0) throw new Error("Gross caps must be finite and nonnegative.");
        if (objectiveType === "minimum_variance" && (!targetExcessReturn || !Number.isFinite(Number(targetExcessReturn)) || Number(targetExcessReturn) <= 0)) throw new Error("Signed minimum variance requires a positive target excess return.");
        if (targetExcessReturn && (!Number.isFinite(Number(targetExcessReturn)) || Number(targetExcessReturn) <= 0)) throw new Error("Target excess return must be positive.");
        signedConstraints = {
          alphaBounds: Object.fromEntries(Object.entries(alphaBounds).filter(([, bound]) => bound.min !== undefined || bound.max !== undefined)),
          assetBounds, netAssetExposure, cash, groupGrossCaps, grossAlphaMax, grossAssetMax,
        };
      }
      const candidateBounds = JSON.parse(allocationMode === "SIGNED_OVERLAY" ? "{}" : candidateBoundsText);
      const totalCash = JSON.parse(allocationMode === "SIGNED_OVERLAY" ? "{}" : cashBoundsText);
      const assetBounds = JSON.parse(allocationMode === "SIGNED_OVERLAY" ? "{}" : assetBoundsText);
      const groupCaps = JSON.parse(allocationMode === "SIGNED_OVERLAY" ? "[]" : groupCapsText);
      if (!candidateBounds || typeof candidateBounds !== "object" || Array.isArray(candidateBounds)
        || !totalCash || typeof totalCash !== "object" || Array.isArray(totalCash)
        || !assetBounds || typeof assetBounds !== "object" || Array.isArray(assetBounds)
        || !Array.isArray(groupCaps)) throw new Error("Constraint JSON must be objects for bounds and an array for group caps.");
      assertBounds(candidateBounds, "Candidate bounds");
      assertBounds(totalCash, "Total-cash bounds");
      assertBounds(assetBounds, "Asset bounds");
      for (const [index, group] of groupCaps.entries()) {
        const cap = asRecord(group);
        if (typeof cap.name !== "string" || !cap.name.trim() || !Array.isArray(cap.candidateIds)
          || cap.candidateIds.some(id => typeof id !== "string" || !id)
          || typeof cap.max !== "number" || !Number.isFinite(cap.max)) {
          throw new Error(`Group cap ${index + 1} requires a name, candidateIds string array, and finite max.`);
        }
      }
      constraints = {
        candidateBounds,
        totalCash,
        assetBounds,
        groupCaps,
        unsupported: allocationMode === "SIGNED_OVERLAY" ? [] : unsupportedText.split(",").map(value => value.trim()).filter(Boolean),
      };
      const request: AllocationRequest = {
        ...(costAware ? { costAware } : {}),
        ...(allocationMode === "SIGNED_OVERLAY" ? { allocationMode, signedConstraints, ...(targetExcessReturn ? { targetExcessReturn: Number(targetExcessReturn) } : {}) } : {}),
        preparedInputId: prepared.preparedInputId,
        candidateIds,
        informationCutoff,
        decisionTimestamp: new Date(decisionTimestamp).toISOString(),
        estimationWindow,
        minObservations,
        representation: prepared.representation,
        returnConvention: "daily_decimal",
         expectedReturnShrinkage: 0,
         forecastModel: submittedForecast,
         robustness: { method: robustMethod, kappa },
        covarianceDiagonalShrinkage: prepared.representation === "alpha_streams"
          ? riskModel.type === "SAMPLE" ? 0 : covarianceDiagonalShrinkage
          : covarianceDiagonalShrinkage,
        dailyCashYield,
        objective: { type: objectiveType, gamma, eta },
        constraints,
        ...(prepared.representation === "alpha_streams" ? {
          riskModel: {
            type: riskModel.type,
            ...(riskModel.type === "STATISTICAL_FACTOR" ? {
              factorCount: selectedFactorCount,
              specificRiskFloorFraction: riskModel.specificRiskFloorFraction ?? 1e-6,
            } : {}),
          },
        } : {}),
      };
      onRunningChange?.(true);
       // Generated request types may lag the frozen robustness contract.
       const payload = await createMutation.mutateAsync({ data: request as Parameters<typeof createMutation.mutateAsync>[0]["data"] });
      setResult(asRecord(payload));
      setSelectedAllocationId(idOf(payload));
      onAllocationSelectionChange?.(idOf(payload));
      setReplayStatus(null);
      await queryClient.invalidateQueries({ queryKey: getListAllocationsQueryKey() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Allocation request failed.");
    } finally {
      onRunningChange?.(false);
    }
  }

  useEffect(() => {
    if (runToken === lastRunToken.current) return;
    lastRunToken.current = runToken;
    void runAllocation();
  }, [runToken]);

  async function replayAllocation(id: number) {
    setError(null);
    setReplayStatus(null);
    onRunningChange?.(true);
    try {
      const payload = await replayMutation.mutateAsync({ allocationId: id });
      const replay = asRecord(payload);
      const detail = asRecord(await queryClient.fetchQuery({ queryKey: getGetAllocationQueryKey(id), queryFn: () => getAllocation(id) }));
      setResult({ ...detail, replay });
      setSelectedAllocationId(id);
      onAllocationSelectionChange?.(id);
       setReplayStatus(`Replay ${String(replay.status ?? "completed").toUpperCase()}${Array.isArray(replay.differences) ? ` · ${replay.differences.length} differing fields${replay.differences.length ? `: ${replay.differences.join("; ")}` : ""}` : ""}${typeof replay.maximumNumericDifference === "number" ? ` · maximum numeric difference ${replay.maximumNumericDifference}` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Allocation replay failed.");
    } finally {
      onRunningChange?.(false);
    }
  }

  const response = result ?? asRecord(detailQuery.data);
  const allocation = asRecord(response.result ?? response.allocation ?? response);
  const model = asRecord(allocation.model);
  const status = typeof allocation.status === "string" ? allocation.status : "Unavailable";
  const allocationId = idOf(response) ?? selectedAllocationId;
  const candidateWeights = asRecord(allocation.candidateWeights);
  const assetWeights = asRecord(allocation.assetWeights);
  const frozenObjective = asRecord(asRecord(response.request).objective ?? allocation.objective);
  const frozenRequest = asRecord(response.request);
  const frozenForecast = allocation.forecast ?? asRecord(response.result).forecast;
  const signedResult = frozenRequest.allocationMode === "SIGNED_OVERLAY" || asRecord(allocation.signedOverlay).allocationMode === "SIGNED_OVERLAY";
  const frozenRiskModel = asRecord(asRecord(response.request).riskModel ?? allocation.riskModel ?? model.riskModel);
  const objectiveFormula = frozenObjective.type === "minimum_variance"
    ? signedResult ? "minimize ½ aᵀΣa subject to positive target excess return" : "minimize ½ bᵀΣb"
    : frozenObjective.type === "regularized_mean_variance"
      ? signedResult ? "minimize (γ/2)aᵀΣa + (η/2)Σⱼaⱼ² − μ_excessᵀa" : "minimize (γ/2)bᵀΣb + (η/2)Σⱼbⱼ² − μᵀb − r_cash·c"
      : "Unavailable";

  return (
    <section className="space-y-4" aria-label="B2 allocation">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">B2 As-of Allocation</CardTitle>
          <CardDescription>Optimizes frozen asset-return or tradable alpha-stream inputs at one decision timestamp. Signal scores are not tradable returns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive" data-testid="status-b2-allocation-error"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">Preparation ID {prepared?.preparedInputId ?? "Unavailable"}</Badge>
            <Badge variant="outline">{displayName(prepared?.representation)}</Badge>
            <span className="text-muted-foreground">Selected canonical candidates: {candidateIds.length}</span>
          </div>
          <fieldset className="space-y-2 rounded border bg-muted/20 p-3"><legend className="px-1 text-xs font-semibold uppercase tracking-wide">Allocation mode</legend><div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2"><input type="radio" name="b2-allocation-mode" value="CAPITAL_LONG_ONLY" checked={allocationMode === "CAPITAL_LONG_ONLY"} onChange={() => setAllocationMode("CAPITAL_LONG_ONLY")} data-testid="input-b2-mode-long-only" />Capital long-only</label>
            <label className={`flex items-center gap-2 ${prepared?.representation !== "alpha_streams" ? "opacity-50" : ""}`}><input type="radio" name="b2-allocation-mode" value="SIGNED_OVERLAY" checked={allocationMode === "SIGNED_OVERLAY"} disabled={prepared?.representation !== "alpha_streams"} onChange={() => setAllocationMode("SIGNED_OVERLAY")} data-testid="input-b2-mode-signed" />Signed alpha overlay</label>
          </div>{prepared?.representation !== "alpha_streams" && <p className="text-xs text-muted-foreground">Signed overlays require an alpha-stream preparation.</p>}</fieldset>
          {!prepared && <p className="text-xs text-amber-700">Select or prepare a saved version in Optimization Inputs to use B2.</p>}
          {!!prepared?.candidateIds.length && <div className="space-y-1">
            <Label>Canonical candidates</Label>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded border p-2">
              {prepared.candidateIds.map(id => <label key={id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
                <input type="checkbox" checked={selectedCandidateSet.has(id)} onChange={() => setCandidateIds(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id])} data-testid={`input-b2-candidate-${id}`} />
                {prepared.candidateNames[id] ?? id}
              </label>)}
            </div>
          </div>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1"><Label>Information cutoff</Label><Input type="date" value={informationCutoff} onChange={event => setInformationCutoff(event.target.value)} data-testid="input-b2-cutoff" /></div>
            <div className="space-y-1"><Label>Decision timestamp</Label><Input type="datetime-local" value={decisionTimestamp} onChange={event => setDecisionTimestamp(event.target.value)} data-testid="input-b2-decision-timestamp" /></div>
            <div className="space-y-1"><Label>Estimation window (days)</Label><Input type="number" min="2" value={estimationWindow} onChange={event => { const days = Number(event.target.value); setEstimationWindow(days); onEstimationWindowChange?.(days); }} data-testid="input-b2-estimation-window" /></div>
            <div className="space-y-1"><Label>Minimum observations</Label><Input type="number" min="2" value={minObservations} onChange={event => setMinObservations(Number(event.target.value))} data-testid="input-b2-min-observations" /></div>
            {(prepared?.representation !== "alpha_streams" || riskModel.type === "DIAGONAL_SHRINKAGE") && <div className="space-y-1"><Label>Diagonal covariance shrinkage δ [0,1]</Label><Input type="number" min="0" max="1" step="any" value={covarianceDiagonalShrinkage} onChange={event => setCovarianceDiagonalShrinkage(Number(event.target.value))} data-testid="input-b2-covariance-shrinkage" /></div>}
            <div className="space-y-1"><Label>Deterministic daily cash yield</Label><Input type="number" step="any" value={dailyCashYield} onChange={event => setDailyCashYield(Number(event.target.value))} data-testid="input-b2-daily-cash-yield" /></div>
             <div className="space-y-1"><Label>Objective</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={objectiveType} onChange={event => { const next = event.target.value as AllocationRequest["objective"]["type"]; setObjectiveType(next); if (next === "minimum_variance") setRobustMethod("NOMINAL"); }} data-testid="select-b2-objective"><option value="minimum_variance">Minimum variance</option><option value="regularized_mean_variance">Regularized mean-variance</option></select></div>
            <div className="space-y-1"><Label>γ (must be positive)</Label><Input type="number" min="0.0000001" step="any" value={gamma} onChange={event => setGamma(Number(event.target.value))} data-testid="input-b2-gamma" /></div>
            <div className="space-y-1"><Label>η (nonnegative)</Label><Input type="number" min="0" step="any" value={eta} onChange={event => setEta(Number(event.target.value))} data-testid="input-b2-eta" /></div>
          </div>
           <ForecastModelPanel value={forecastModel} onChange={setForecastModel} candidateIds={candidateIds} cutoff={informationCutoff} observationCount={prepared ? alignedObservationCount(prepared, candidateIds, informationCutoff) : null} />
           <fieldset className="rounded-lg border border-primary/20 bg-primary/[0.025] p-3" data-testid="fieldset-b2-robustness">
             <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-primary">Portfolio robustness</legend>
             <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
               <div className="flex gap-1 rounded-md border bg-background p-1" role="radiogroup" aria-label="Portfolio robustness method">
                 {([["NOMINAL", "Nominal"], ["ROBUST_MEAN_UNCERTAINTY", "Robust to Forecast Uncertainty"]] as const).map(([method, title]) =>
                   <label key={method} className={`cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors ${robustMethod === method ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"} ${method !== "NOMINAL" && objectiveType === "minimum_variance" ? "cursor-not-allowed opacity-50" : ""}`}>
                     <input className="sr-only" type="radio" name="b2-robust-method" checked={robustMethod === method} disabled={method !== "NOMINAL" && objectiveType === "minimum_variance"} onChange={() => setRobustMethod(method)} data-testid={`input-b2-robustness-${method.toLowerCase()}`} />{title}
                   </label>)}
               </div>
               <div className="flex items-center gap-2"><Label htmlFor="b2-robust-kappa" className="whitespace-nowrap text-xs">κ</Label><Input id="b2-robust-kappa" className="h-8 w-24 font-mono text-xs" type="number" min="0" step="any" value={kappaText} onChange={event => setKappaText(event.target.value)} data-testid="input-b2-robustness-kappa" /></div>
               <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">κ ≥ 0 · forecast uncertainty Vμ is separate from return risk Σ. No historical cost optimization.</p>
             </div>
             {objectiveType === "minimum_variance" && <p className="mt-2 text-xs text-amber-700">Robust mode is unavailable for minimum variance until its formula is defined. Select regularized mean-variance to enable it.</p>}
           </fieldset>
           {allocationMode === "SIGNED_OVERLAY" && <SignedOverlayControls candidates={candidateIds} names={prepared?.candidateNames ?? {}} settings={signedSettings} onChange={setSignedSettings} objective={objectiveType} gamma={gamma} eta={eta} target={targetExcessReturn} onTargetChange={setTargetExcessReturn} />}
           {allocationMode === "CAPITAL_LONG_ONLY" && <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label>Total cash bounds JSON</Label><Input value={cashBoundsText} onChange={event => setCashBoundsText(event.target.value)} placeholder='{"min":0,"max":1}' data-testid="input-b2-cash-bounds" /></div>
            <div className="space-y-1"><Label>Candidate bounds JSON (candidate ID → min/max)</Label><Input value={candidateBoundsText} onChange={event => setCandidateBoundsText(event.target.value)} placeholder="{}" data-testid="input-b2-candidate-bounds" /></div>
            <div className="space-y-1"><Label>Underlying asset bounds JSON (ticker → min/max)</Label><Input value={assetBoundsText} onChange={event => setAssetBoundsText(event.target.value)} placeholder="{}" data-testid="input-b2-asset-bounds" /></div>
            <div className="space-y-1"><Label>Candidate group caps JSON</Label><Input value={groupCapsText} onChange={event => setGroupCapsText(event.target.value)} placeholder="[]" data-testid="input-b2-group-caps" /></div>
            <div className="space-y-1 md:col-span-2"><Label>Unsupported constraint requests (comma-separated, sent for explicit rejection)</Label><Input value={unsupportedText} onChange={event => setUnsupportedText(event.target.value)} placeholder="cardinality, signed alpha, leverage" data-testid="input-b2-unsupported-constraints" /></div>
           </div>}
            <CostAwareControls value={costAwareForm} onChange={setCostAwareForm} cutoff={informationCutoff} />
            <p className="text-xs text-muted-foreground">{allocationMode === "SIGNED_OVERLAY" ? "Signed overlays optimize alpha coefficients against daily excess returns, then aggregate underlying risky exposures before computing net and cash. Minimum variance requires a positive daily target excess return. D3 forecasts excess returns; D1 independently estimates risk." : "Base objective: minimum variance minimizes ½ bᵀΣb; regularized mean-variance minimizes (γ/2)bᵀΣb + (η/2)Σⱼbⱼ² − μᵀb − r_cash·c. D3 supplies μ in daily decimal gross returns; D1/B2 independently supplies risk covariance. Optional cost-aware mode estimates underlying trade friction; historical fills require B3 validation."}</p>
          <Button type="button" onClick={() => void runAllocation()} disabled={busy || !prepared} data-testid="button-run-b2-allocation">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Optimizing…</> : "Optimize B2 allocation"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div><CardTitle className="text-sm">Saved B2 allocations</CardTitle><CardDescription>Reload an immutable saved optimization by ID.</CardDescription></div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshSaved()} disabled={loadingSaved} data-testid="button-refresh-b2-allocations"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingSaved ? "animate-spin" : ""}`} />Refresh</Button>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Label htmlFor="select-saved-b2">Saved optimization</Label>
          <select id="select-saved-b2" className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm" value={selectedAllocationId ?? ""} onChange={event => { const id = Number(event.target.value); if (Number.isSafeInteger(id) && id > 0) void loadAllocation(id); }} data-testid="select-saved-b2-allocation">
            <option value="">Select saved allocation</option>
             {saved.map((item, index) => { const id = idOf(item); return id ? <option key={id} value={id}>Allocation {id} · {asRecord(asRecord(item).request).allocationMode === "SIGNED_OVERLAY" ? "Signed overlay" : "Capital long-only"} · {String(asRecord(item).status ?? "saved")}</option> : <option key={`unknown-${index}`} value="" disabled>Saved allocation ID unavailable</option>; })}
          </select>
          {loadingSaved && <span className="text-xs text-muted-foreground">Loading saved optimizations…</span>}
          {savedQuery.isError && <Button type="button" variant="outline" size="sm" onClick={() => void refreshSaved()}>Could not load saved allocations · Retry</Button>}
          {!loadingSaved && !saved.length && <span className="text-xs text-muted-foreground">No saved B2 allocations returned.</span>}
        </CardContent>
      </Card>

      {(result || detailQuery.data) && <RobustnessPanel result={allocation} request={frozenRequest} replay={response.replay} />}
      {(result || detailQuery.data) && <CostAwareAllocationResult request={frozenRequest} result={allocation} />}
      {(result || detailQuery.data) && <Card data-testid="card-b2-allocation-result">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
             <div><CardTitle className="text-sm">Allocation result · ID {allocationId ?? "Unavailable"}</CardTitle><CardDescription>{signedResult ? "Signed alpha overlay" : "Capital long-only"} · Preparation ID {formatValue(asRecord(response.request).preparedInputId ?? prepared?.preparedInputId)} · {displayName(String(asRecord(response.request).representation ?? prepared?.representation ?? ""))}</CardDescription></div>
            <Badge variant="outline" data-testid="status-b2-solver">{status}</Badge>
          </div>
          {status === "SOLVED" && <p className="text-xs font-medium text-amber-700">Allocation computed — historical validation pending.</p>}
          {typeof allocation.reason === "string" && <p className="text-xs text-destructive">{allocation.reason}</p>}
          {replayStatus && <p className="text-xs" data-testid="status-b2-replay">{replayStatus}</p>}
        </CardHeader>
        <CardContent className="space-y-3">
           <ForecastResults forecast={frozenForecast} frozenConfig={frozenRequest.forecastModel} candidateIds={Array.isArray(frozenRequest.candidateIds) ? frozenRequest.candidateIds as string[] : []} allocation={allocation} legacy={!frozenRequest.forecastModel} />
           {signedResult && <SignedOverlayResult allocation={allocation} request={frozenRequest} names={prepared?.candidateNames ?? {}} />}
           {!signedResult && <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border p-3"><p className="text-xs font-medium">Total cash</p><p className="text-sm tabular-nums">{formatValue(allocation.totalCash)}</p></div>
            <div className="rounded border p-3"><p className="text-xs font-medium">Master cash</p><p className="text-sm tabular-nums">{formatValue(allocation.masterCash)}</p></div>
            <div className="rounded border p-3"><p className="text-xs font-medium">Estimated gross daily return</p><p className="text-sm tabular-nums">{formatValue(allocation.estimatedGrossReturn)}</p></div>
            <div className="rounded border p-3"><p className="text-xs font-medium">Estimated historical candidate-return volatility</p><p className="text-sm tabular-nums">{formatValue(allocation.estimatedVolatility)}</p></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border p-3"><h4 className="mb-2 text-xs font-semibold">Candidate capital weights</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(candidateWeights)}</pre></div>
            <div className="rounded border p-3"><h4 className="mb-2 text-xs font-semibold">Underlying asset target weights</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(assetWeights)}</pre></div>
            <div className="rounded border p-3"><h4 className="mb-2 text-xs font-semibold">Objective contributions</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(allocation.objectiveContributions)}</pre></div>
            <div className="rounded border p-3"><h4 className="mb-2 text-xs font-semibold">Constraint slack and solver diagnostics</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(allocation.constraintSlacks)}{"\n\n"}{formatValue(allocation.solver ?? allocation.solverDiagnostics)}</pre></div>
          </div>
           </>}
           {signedResult && <div className="rounded border p-3 text-xs"><strong>Frozen signed constraints</strong><pre className="mt-1 whitespace-pre-wrap break-words">{formatValue(frozenRequest.signedConstraints)}</pre><strong className="mt-2 block">Solver diagnostics & constraint slack</strong><pre className="whitespace-pre-wrap break-words">{formatValue(allocation.constraintSlacks)}{"\n"}{formatValue(allocation.solver ?? allocation.solverDiagnostics)}</pre></div>}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border p-3 text-xs">
              <h4 className="mb-1 font-semibold">Frozen objective and constraints</h4>
              <p><span className="font-medium">Objective:</span> {formatValue(frozenObjective)} · {objectiveFormula}</p>
              <p className="mt-1"><span className="font-medium">Constraints:</span> {formatValue(asRecord(response.request).constraints ?? allocation.constraints)}</p>
            </div>
            <div className="rounded border p-3 text-xs">
              <h4 className="mb-1 font-semibold">Frozen estimation inputs</h4>
              <p>{frozenRiskModel.type === "STATISTICAL_FACTOR" ? "Daily decimal risk · Gamma = Xi + Omega Phi Omega′." : frozenRiskModel.type === "SAMPLE" ? "Daily decimal risk · sample covariance S." : frozenRiskModel.type === "DIAGONAL_SHRINKAGE" ? "Daily decimal risk · Sigma=(1−δ)S+δ·diag(S)." : "Risk estimator details are not returned by this saved record."}</p>
              <p>{frozenRequest.forecastModel ? `D3 ${formatValue(asRecord(frozenRequest.forecastModel).type)} · legacy shrinkage disabled` : `Legacy shrinkage s=${formatValue(frozenRequest.expectedReturnShrinkage)}`} · δ={formatValue(frozenRequest.covarianceDiagonalShrinkage)}, r_cash={formatValue(frozenRequest.dailyCashYield)}.</p>
              {frozenRiskModel.type === "STATISTICAL_FACTOR" && <p>The frozen δ value is retained for comparison/display; the selected statistical-factor covariance estimator does not use it.</p>}
              <p className="mt-1">Risk model: {formatValue(frozenRiskModel)}</p>
              <p className="mt-1">Observations / dates: {formatValue(model.observationCount)} / {formatValue(model.dates)}</p>
              <p>Candidate vector order: {formatValue(model.candidateIds)}</p>
            </div>
            <div className="rounded border p-3"><h4 className="mb-1 text-xs font-semibold">Sample mean returns</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(model.sampleMeans)}</pre></div>
            <div className="rounded border p-3"><h4 className="mb-1 text-xs font-semibold">Shrunk expected returns μ</h4><pre className="whitespace-pre-wrap break-words text-xs">{formatValue(model.mu)}</pre></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {allocationId !== null && <Button type="button" variant="outline" size="sm" onClick={() => void replayAllocation(allocationId)} disabled={busy} data-testid="button-replay-b2-allocation">Replay frozen allocation</Button>}
          </div>
        </CardContent>
      </Card>}
    </section>
  );
}