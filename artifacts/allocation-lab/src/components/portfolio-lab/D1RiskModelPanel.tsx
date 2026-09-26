import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAllocationQueryKey,
  getListValidationRunsQueryKey,
  getListAllocationsQueryKey,
  getGetRiskModelComparisonQueryKey,
  getListRiskModelComparisonsQueryKey,
  useCreateRiskModelComparison,
  useGetAllocation,
  useGetRiskModelComparison,
  useListAllocations,
  useListRiskModelComparisons,
  useListValidationRuns,
  useReplayRiskModelComparison,
} from "@workspace/api-client-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type D1RiskModelType = "SAMPLE" | "DIAGONAL_SHRINKAGE" | "STATISTICAL_FACTOR";
export type D1RiskModelRequest = {
  type: D1RiskModelType;
  factorCount?: number;
  specificRiskFloorFraction?: number;
};

type Row = Record<string, unknown>;

const row = (value: unknown): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const display = (value: unknown) => value === undefined || value === null ? "Not returned" :
  typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) :
    typeof value === "string" || typeof value === "boolean" ? String(value) : JSON.stringify(value, null, 2);
const identifier = (value: unknown) => {
  const id = row(value).allocationId ?? row(value).id;
  return Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
};
const validationIdentifier = (value: unknown) => {
  const id = row(value).validationRunId;
  return Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
};
const RISK_SLOTS = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"] as const;
type RiskSlot = typeof RISK_SLOTS[number];
type SelectionByRiskSlot = Record<RiskSlot, string>;
const emptyRiskSelection = (): SelectionByRiskSlot => ({
  SAMPLE: "", DIAGONAL_SHRINKAGE: "", STATISTICAL_FACTOR: "",
});
function allocationRiskType(allocation: Row): RiskSlot | null {
  const request = row(allocation.request);
  const type = row(request.riskModel).type;
  if (RISK_SLOTS.includes(type as RiskSlot)) return type as RiskSlot;
  if (request.covarianceDiagonalShrinkage === 0) return "SAMPLE";
  if (finite(request.covarianceDiagonalShrinkage) && request.covarianceDiagonalShrinkage > 0)
    return "DIAGONAL_SHRINKAGE";
  return null;
}
function runStatus(run: Row): string {
  return String(run.status ?? row(run.result).status ?? "saved");
}
function savedRiskModel(allocation: Row): Row {
  const payload = row(allocation.data ?? allocation.allocation ?? allocation);
  const result = row(payload.result ?? payload);
  const model = row(result.model);
  return row(result.riskModel ?? model.riskModel ?? payload.riskModel);
}

function firstDefined(source: Row, keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
}

function RiskSummary({ diagnostics }: { diagnostics: Row }) {
  const factorModel = row(diagnostics.factorModel);
  const factorDiagnostics = row(factorModel.diagnostics);
  const provenance = row(diagnostics.provenance);
  const decomposition = row(diagnostics.decomposition);
  const covarianceEigenvalues = array(factorDiagnostics.factorCovarianceEigenvalues).filter(finite);
  const summary = { ...factorDiagnostics, ...provenance, ...factorModel, ...diagnostics };
  const values: Array<[string, unknown]> = [
    ["Risk model", firstDefined(diagnostics, ["type", "modelType", "riskModelType"])],
    ["Alphas (N)", firstDefined(summary, ["alphaCount", "candidateCount", "N"])],
    ["Observations (T)", firstDefined(summary, ["observationCount", "observations", "T"])],
    ["Factors (F)", firstDefined(summary, ["factorCount", "F"])],
    ["Specific-risk floor fraction", firstDefined(diagnostics, ["specificRiskFloorFraction"])],
    ["Information cutoff", firstDefined(provenance, ["informationCutoff"])],
    ["B1 preparation", firstDefined(provenance, ["preparedInputId"])],
    ["Dataset hash", firstDefined(provenance, ["datasetHash"])],
    ["Expected volatility", firstDefined(decomposition, ["portfolioVolatility"]) ?? firstDefined(diagnostics, ["expectedVolatility", "portfolioVolatility", "estimatedVolatility"])],
    ["Common-factor risk share", firstDefined(summary, ["commonFactorVarianceShare", "commonFactorRiskShare", "factorRiskShare"])],
    ["Specific-risk share", firstDefined(summary, ["specificRiskVarianceShare", "specificRiskShare"])],
    ["Effective rank", firstDefined(summary, ["factorCovarianceEffectiveRank", "effectiveRank"])],
    ["Covariance condition number", firstDefined(summary, ["factorCovarianceConditionNumber", "conditionNumber", "covarianceConditionNumber"])],
    ["Minimum eigenvalue", firstDefined(factorDiagnostics, ["minimumEigenvalue", "minEigenvalue"]) ?? (covarianceEigenvalues.length ? Math.min(...covarianceEigenvalues) : undefined)],
    ["Maximum eigenvalue", firstDefined(factorDiagnostics, ["maximumEigenvalue", "maxEigenvalue"]) ?? (covarianceEigenvalues.length ? Math.max(...covarianceEigenvalues) : undefined)],
    ["Numerical rank", firstDefined(summary, ["factorCovarianceRank", "numericalRank", "rank"])],
    ["Sample covariance rank", firstDefined(summary, ["sampleCovarianceRank"])],
    ["Floor-bound alphas", firstDefined(summary, ["floorBoundAlphaIds", "floorBoundAlphas"])],
    ["Factor-basis status", firstDefined(summary, ["factorBasisUnstable", "basisStatus", "status", "warnings"])],
    ["Risk-floor diagonal adjustment", firstDefined(summary, ["floorAdjustedDiagonalAlphaIds", "riskFloorChangesDiagonal", "diagonalChangedByRiskFloor"])],
  ];
  const fallback = summary;
  const availableValues = values.filter(([, value]) => value !== undefined);
  return <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
    {availableValues.map(([label, value]) => <div key={label} className="rounded border bg-muted/20 p-3" data-testid={`d1-risk-summary-${label.toLowerCase().replace(/\W+/g, "-")}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm tabular-nums">{display(value)}</dd>
    </div>)}
    {!availableValues.length && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{display(fallback)}</pre>}
  </dl>;
}

function Spectrum({ diagnostics }: { diagnostics: Row }) {
  const factorModel = row(diagnostics.factorModel);
  const factorDiagnostics = row(factorModel.diagnostics);
  const eigenvalues = array(firstDefined(factorModel, ["eigenvalues", "sampleEigenvalues"]) ?? firstDefined(diagnostics, ["eigenvalues", "eigenvalueSpectrum"])).filter(finite);
  const cumulative = array(firstDefined(factorDiagnostics, ["cumulativeVarianceExplained"]) ?? firstDefined(diagnostics, ["cumulativeVarianceExplained", "cumulativeExplainedVariance"]));
  const max = Math.max(0, ...eigenvalues);
  if (!eigenvalues.length) return <p className="text-xs text-muted-foreground" data-testid="d1-spectrum-unavailable">The saved risk-model response did not include an eigenvalue spectrum.</p>;
  return <div className="space-y-2">
    {eigenvalues.map((value, index) => <div key={index} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-xs">
      <span>Statistical Factor {index + 1}</span>
      <div className="h-2 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${max > 0 ? Math.min(100, value / max * 100) : 0}%` }} /></div>
      <span className="text-right tabular-nums">{value.toPrecision(5)}</span>
      <span className="col-span-3 -mt-1 text-muted-foreground">Cumulative variance explained: {display(cumulative[index])}</span>
    </div>)}
  </div>;
}

function Loadings({ diagnostics }: { diagnostics: Row }) {
  const factorModel = row(diagnostics.factorModel);
  const loadings = firstDefined(factorModel, ["omega", "loadings", "factorLoadings", "canonicalizedLoadings", "Omega"]) ??
    firstDefined(diagnostics, ["loadings", "factorLoadings", "canonicalizedLoadings", "Omega", "omega"]);
  const rows = array(loadings);
  if (!rows.length) return <p className="text-xs text-muted-foreground" data-testid="d1-loadings-unavailable">The saved risk-model response did not include canonicalized factor loadings.</p>;
  const provenance = row(diagnostics.provenance);
  const candidateIds = array(provenance.candidateIds);
  if (rows.every(value => Array.isArray(value) && value.every(finite))) {
    const numericRows = rows as number[][];
    return <div className="max-h-96 overflow-auto rounded border"><table className="w-full min-w-[440px] text-xs">
      <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Alpha</th>{numericRows[0]?.map((_, factorIndex) => <th key={factorIndex} className="p-2 text-right">Statistical Factor {factorIndex + 1}</th>)}</tr></thead>
      <tbody>{numericRows.map((values, index) => <tr key={String(candidateIds[index] ?? index)} className="border-t"><th className="max-w-48 truncate p-2 text-left font-medium">{String(candidateIds[index] ?? `Alpha ${index + 1}`)}</th>{values.map((value, factorIndex) => {
        const magnitude = Math.min(1, Math.abs(value));
        return <td key={factorIndex} className="p-1 text-right tabular-nums"><span className="inline-block min-w-16 rounded px-1 py-1" style={{ backgroundColor: `hsl(${value >= 0 ? 215 : 8} 70% 90% / ${0.25 + magnitude * 0.65})` }}>{value.toPrecision(5)}</span></td>;
      })}</tr>)}</tbody>
    </table></div>;
  }
  const objects = rows.map(row);
  const headers = objects.reduce<string[]>((all, item) => {
    for (const key of Object.keys(item)) if (!["alphaId", "candidateId", "name", "ticker"].includes(key) && !all.includes(key)) all.push(key);
    return all;
  }, []);
  if (!headers.length) return <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{display(loadings)}</pre>;
  return <div className="max-h-96 overflow-auto rounded border">
    <table className="w-full min-w-[440px] text-xs">
      <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Alpha</th>{headers.map((key, index) => <th key={key} className="p-2 text-right">Statistical Factor {index + 1}</th>)}</tr></thead>
      <tbody>{objects.map((item, index) => {
        const id = item.alphaId ?? item.candidateId ?? item.name ?? `Alpha ${index + 1}`;
        return <tr key={String(id)} className="border-t"><th className="max-w-48 truncate p-2 text-left font-medium">{String(id)}</th>
          {headers.map((key) => {
            const value = item[key];
            const magnitude = finite(value) ? Math.min(1, Math.abs(value)) : 0;
            return <td key={key} className="p-1 text-right tabular-nums">
              <span className="inline-block min-w-16 rounded px-1 py-1" style={{ backgroundColor: finite(value) ? `hsl(${value >= 0 ? 215 : 8} 70% 90% / ${0.25 + magnitude * 0.65})` : undefined }}>{display(value)}</span>
            </td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function Decomposition({ diagnostics }: { diagnostics: Row }) {
  const decomposition = firstDefined(diagnostics, ["portfolioDecomposition", "riskDecomposition", "decomposition"]);
  if (decomposition === undefined) return <p className="text-xs text-muted-foreground" data-testid="d1-decomposition-unavailable">The saved risk-model response did not include factor, specific, and alpha component-risk contributions.</p>;
  return <pre className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-3 text-xs">{display(decomposition)}</pre>;
}

export function D1RiskModelPanel({
  allocationId,
  representation,
  candidateCount,
  observationWindow,
  alignedObservationCount,
  config,
  onConfigChange,
}: {
  allocationId: number | null;
  representation: string | null;
  candidateCount: number;
  observationWindow: number;
  alignedObservationCount: number | null;
  config: D1RiskModelRequest;
  onConfigChange: (config: D1RiskModelRequest) => void;
}) {
  const isAlpha = representation === "alpha_streams";
  const currentAllocationQuery = useGetAllocation(allocationId ?? 0, {
    query: {
      enabled: allocationId !== null && Number.isSafeInteger(allocationId) && allocationId > 0,
      queryKey: getGetAllocationQueryKey(allocationId ?? 0),
      refetchOnMount: "always",
    },
  });
  const current = row(currentAllocationQuery.data);
  const currentPayload = row(current.data ?? current.allocation ?? current);
  const currentResult = row(currentPayload.result ?? currentPayload);
  const savedModel = savedRiskModel(current);
  const currentDiagnostics = {
    ...row(currentResult.model),
    ...savedModel,
    ...(currentResult.estimatedVolatility === undefined ? {} : { expectedVolatility: currentResult.estimatedVolatility }),
  };
  const { data: allocationList = [] } = useListAllocations({
    query: { queryKey: getListAllocationsQueryKey(), refetchOnMount: "always" },
  });
  const saved = (Array.isArray(allocationList) ? allocationList : []).map(row);
  const { data: validationRuns = [] } = useListValidationRuns({ source: "b3" }, {
    query: { queryKey: getListValidationRunsQueryKey({ source: "b3" }), refetchOnMount: "always" },
  });
  const { data: comparisonList = [] } = useListRiskModelComparisons({
    query: { queryKey: getListRiskModelComparisonsQueryKey(), refetchOnMount: "always" },
  });
  const queryClient = useQueryClient();
  const effectiveObservationCount = alignedObservationCount === null
    ? observationWindow
    : Math.min(alignedObservationCount, observationWindow);
  const defaultFactorCount = Math.min(5, Math.max(0, candidateCount - 1), Math.max(0, effectiveObservationCount - 1));
  const factorCount = config.factorCount ?? defaultFactorCount;
  const factorCountValid = Number.isSafeInteger(factorCount) && factorCount >= 1 &&
    factorCount < candidateCount && factorCount < effectiveObservationCount;
  const [allocationSelections, setAllocationSelections] = useState<SelectionByRiskSlot>(emptyRiskSelection);
  const [validationSelections, setValidationSelections] = useState<SelectionByRiskSlot>(emptyRiskSelection);
  const [savedComparisonId, setSavedComparisonId] = useState<number | null>(null);
  const [comparisonListInitialized, setComparisonListInitialized] = useState(false);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<Row | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const createRiskComparison = useCreateRiskModelComparison();
  const replayRiskComparison = useReplayRiskModelComparison();
  const savedComparisonQuery = useGetRiskModelComparison(savedComparisonId ?? 0, {
    query: {
      enabled: savedComparisonId !== null,
      queryKey: getGetRiskModelComparisonQueryKey(savedComparisonId ?? 0),
    },
  });
  const savedComparison = row(savedComparisonQuery.data);
  const savedComparisonResult = row(savedComparison.result);
  const savedComparisonModels = row(savedComparisonResult.models);
  const savedPairwiseDistances = array(savedComparisonResult.pairwiseDistances).map(row);
  const riskComparisonList = array(row(comparisonList).comparisons).map(row);
  const b3Runs = (Array.isArray(validationRuns) ? validationRuns : []).map(row);
  const selectableAllocations = saved.filter(item => item.representation === "alpha_streams" &&
    row(item.result).status === "SOLVED" && allocationRiskType(item) !== null);
  const allocationOptionsFor = (slot: RiskSlot) => selectableAllocations.filter(item => allocationRiskType(item) === slot);
  const validationOptionsFor = (slot: RiskSlot) => {
    const selectedAllocationId = Number(allocationSelections[slot]) || null;
    return b3Runs.filter(item => item.representation === "alpha_streams" &&
      Number(item.allocationId) === selectedAllocationId && runStatus(item) === "success");
  };

  useEffect(() => {
    if (!comparisonListInitialized && riskComparisonList.length > 0) {
      const latestId = identifier(riskComparisonList[0]);
      if (latestId !== null) setSavedComparisonId(latestId);
      setComparisonListInitialized(true);
    }
  }, [comparisonListInitialized, riskComparisonList]);

  useEffect(() => {
    setReplayResult(null);
    setReplayError(null);
  }, [savedComparisonId]);

  const commonRiskModelValues = useMemo(() => {
    const common = row(firstDefined(currentDiagnostics, ["modelComparison", "estimatorComparison", "covarianceComparison"]));
    return common;
  }, [currentDiagnostics]);
  const riskModelValues = Object.keys(commonRiskModelValues).length ? commonRiskModelValues : row(currentResult.riskModelComparison);
  const sameWindowModels = row(savedModel.sameWindowModels);
  const sameWindowEntries: Array<Row & { type: RiskSlot }> = RISK_SLOTS.map(type => ({ type, ...row(sameWindowModels[type]) }));

  async function createControlledComparison() {
    setComparisonActionError(null);
    setReplayResult(null);
    const allocationIds = {
      SAMPLE: Number(allocationSelections.SAMPLE),
      DIAGONAL_SHRINKAGE: Number(allocationSelections.DIAGONAL_SHRINKAGE),
      STATISTICAL_FACTOR: Number(allocationSelections.STATISTICAL_FACTOR),
    };
    const validationRunIds = {
      SAMPLE: Number(validationSelections.SAMPLE),
      DIAGONAL_SHRINKAGE: Number(validationSelections.DIAGONAL_SHRINKAGE),
      STATISTICAL_FACTOR: Number(validationSelections.STATISTICAL_FACTOR),
    };
    try {
      const created = await createRiskComparison.mutateAsync({ data: { allocationIds, validationRunIds } });
      const id = identifier(created);
      if (id === null) throw new Error("The comparison was created but its saved ID was not returned.");
      setSavedComparisonId(id);
      await queryClient.invalidateQueries({ queryKey: getListRiskModelComparisonsQueryKey() });
    } catch (error) {
      setComparisonActionError(error instanceof Error ? error.message : "Unable to create the controlled comparison.");
    }
  }

  async function replayControlledComparison() {
    if (savedComparisonId === null) return;
    setReplayError(null);
    setReplayResult(null);
    try {
      const result = await replayRiskComparison.mutateAsync({ comparisonId: savedComparisonId });
      setReplayResult(row(result));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Unable to replay the saved comparison.");
    }
  }

  return <Card data-testid="card-d1-risk-model">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">D1 · Alpha-stream risk model</CardTitle>
      <CardDescription>Choose the covariance estimator for the existing B2 optimization. Expected returns, objective, constraints, and the Optimize command remain unchanged. Statistical factors are covariance directions, not alpha-selection signals.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {!isAlpha && <Alert><AlertDescription>Statistical factor covariance is available only for Alpha Streams. The existing asset-return estimator remains unchanged.</AlertDescription></Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="d1-risk-model-type">Risk model</Label>
          <select id="d1-risk-model-type" className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={config.type} onChange={event => onConfigChange({ ...config, type: event.target.value as D1RiskModelType })}
            disabled={!isAlpha} data-testid="select-d1-risk-model">
            <option value="SAMPLE">Sample</option>
            <option value="DIAGONAL_SHRINKAGE">Diagonal Shrinkage</option>
            <option value="STATISTICAL_FACTOR" disabled={!isAlpha}>Statistical Factor</option>
          </select>
        </div>
        {config.type === "STATISTICAL_FACTOR" && <div className="space-y-1">
          <Label htmlFor="d1-factor-count">Fixed factor count F</Label>
          <Input id="d1-factor-count" type="number" min="1" step="1" value={factorCount}
            onChange={event => onConfigChange({ ...config, factorCount: Number(event.target.value) })}
            data-testid="input-d1-factor-count" aria-invalid={!factorCountValid} />
        </div>}
        {config.type === "STATISTICAL_FACTOR" && <div className="space-y-1">
          <Label htmlFor="d1-specific-risk-floor">Specific-risk floor fraction</Label>
          <Input id="d1-specific-risk-floor" type="number" min="0" step="any" value={config.specificRiskFloorFraction ?? 1e-6}
            onChange={event => onConfigChange({ ...config, specificRiskFloorFraction: Number(event.target.value) })}
            data-testid="input-d1-specific-risk-floor" />
        </div>}
        <div className="rounded border bg-muted/20 p-2 text-xs" data-testid="d1-observation-window">
          <span className="font-medium">Observation window</span><br />{observationWindow} requested days · aligned T estimate {display(alignedObservationCount)} · saved T {display(firstDefined(currentDiagnostics, ["observationCount", "observations", "T"]))}
        </div>
      </div>
      {config.type === "STATISTICAL_FACTOR" && <p className={`text-xs ${factorCountValid ? "text-muted-foreground" : "text-destructive"}`} data-testid="d1-factor-count-status">
        {factorCountValid ? `F=${factorCount} is fixed for this request; the default is min(5, N−1, T−1) = ${defaultFactorCount}.` :
          `INSUFFICIENT_HISTORY_OR_DIMENSION: fixed F=${factorCount} requires 1 ≤ F < N (${candidateCount}) and F < T (${effectiveObservationCount}). F will not be lowered automatically.`}
      </p>}

      <Tabs defaultValue="summary" className="space-y-3">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="summary" data-testid="tab-d1-summary">Summary</TabsTrigger>
          <TabsTrigger value="spectrum" data-testid="tab-d1-spectrum">Spectrum</TabsTrigger>
          <TabsTrigger value="loadings" data-testid="tab-d1-loadings">Factor Loadings</TabsTrigger>
          <TabsTrigger value="decomposition" data-testid="tab-d1-decomposition">Risk Decomposition</TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-d1-comparison">Model Comparison</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="space-y-3">
          {!allocationId ? <p className="text-xs text-muted-foreground">Optimize a B2 allocation to view its frozen risk-model result.</p> :
            currentAllocationQuery.isLoading ? <p className="text-xs text-muted-foreground" data-testid="d1-risk-diagnostics-loading">Loading the selected saved allocation’s risk-model diagnostics…</p> :
            currentAllocationQuery.isError ? <p className="text-xs text-destructive" data-testid="d1-risk-diagnostics-error">The selected saved allocation could not be loaded: {currentAllocationQuery.error instanceof Error ? currentAllocationQuery.error.message : "Request failed."}</p> :
            !Object.keys(currentDiagnostics).length ? <p className="text-xs text-amber-700" data-testid="d1-risk-diagnostics-unavailable">The saved allocation does not include a result.riskModel diagnostic payload. The risk-model request can be configured, but the backend response contract is not available to this view yet.</p> :
              <RiskSummary diagnostics={currentDiagnostics} />}
        </TabsContent>
        <TabsContent value="spectrum"><Spectrum diagnostics={currentDiagnostics} /></TabsContent>
        <TabsContent value="loadings"><Loadings diagnostics={currentDiagnostics} /></TabsContent>
        <TabsContent value="decomposition"><Decomposition diagnostics={currentDiagnostics} /></TabsContent>
        <TabsContent value="comparison" className="space-y-3">
          {Object.keys(sameWindowModels).length > 0 && <div className="space-y-2" data-testid="d1-same-window-models">
            <div><h4 className="mb-1 text-xs font-semibold">Same-window model estimates returned with this saved allocation</h4>
              <p className="text-xs text-muted-foreground">All three covariance estimates use the exact frozen estimation dates shown above; expected daily volatility is evaluated using the saved allocation's common alpha weights.</p></div>
            <div className="overflow-auto rounded border"><table className="w-full min-w-[500px] text-left text-xs">
              <thead className="bg-muted"><tr><th className="p-2">Estimator</th><th className="p-2">Expected daily volatility</th><th className="p-2">Covariance matrix</th></tr></thead>
              <tbody>{sameWindowEntries.map(item => <tr key={item.type} className="border-t">
                <th className="p-2 font-medium">{item.type}</th>
                <td className="p-2 tabular-nums">{display(item.expectedDailyVolatility)}</td>
                <td className="p-2"><details><summary className="cursor-pointer">View saved covariance</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap">{display(item.covariance)}</pre></details></td>
              </tr>)}</tbody>
            </table></div>
          </div>}
          {!Object.keys(sameWindowModels).length && Object.keys(riskModelValues).length > 0 && <div><h4 className="mb-1 text-xs font-semibold">Saved estimator comparison</h4><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">{display(riskModelValues)}</pre></div>}
          {!Object.keys(sameWindowModels).length && !Object.keys(riskModelValues).length && <p className="text-xs text-muted-foreground">No same-window estimator comparison was included in this saved allocation response.</p>}
        </TabsContent>
      </Tabs>
      <Card className="border-primary/20" data-testid="card-d1-controlled-comparison">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Controlled three-model B2/B3 comparison</CardTitle>
          <CardDescription>Select one saved alpha-stream B2 allocation and its successful B3 validation for each risk estimator. Create stores an immutable comparison; on reload, saved comparisons remain selectable and the newest one opens automatically. No winner is selected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-3">
            {RISK_SLOTS.map(slot => <div key={slot} className="space-y-2 rounded border p-3">
              <h4 className="text-xs font-semibold">{slot.replaceAll("_", " ")}</h4>
              <div className="space-y-1">
                <Label htmlFor={`d1-controlled-allocation-${slot}`}>Saved B2 allocation</Label>
                <select id={`d1-controlled-allocation-${slot}`} className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                  value={allocationSelections[slot]}
                  onChange={event => {
                    const value = event.target.value;
                    setAllocationSelections(current => ({ ...current, [slot]: value }));
                    setValidationSelections(current => ({ ...current, [slot]: "" }));
                  }} data-testid={`select-d1-controlled-allocation-${slot.toLowerCase()}`}>
                  <option value="">Select solved B2 allocation</option>
                  {allocationOptionsFor(slot).map(item => {
                    const id = identifier(item);
                    const request = row(item.request);
                    const risk = row(request.riskModel);
                    const deltaLabel = slot === "STATISTICAL_FACTOR" ? ` δ=${display(request.covarianceDiagonalShrinkage)}` : "";
                    return id === null ? null : <option key={id} value={id}>
                      #{id} · {slot}{slot === "STATISTICAL_FACTOR" ? ` F=${display(risk.factorCount)}` : ""}{deltaLabel} · {String(item.createdAt ?? "")}
                    </option>;
                  })}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`d1-controlled-validation-${slot}`}>Successful B3 validation</Label>
                <select id={`d1-controlled-validation-${slot}`} className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                  value={validationSelections[slot]}
                  onChange={event => setValidationSelections(current => ({ ...current, [slot]: event.target.value }))}
                  data-testid={`select-d1-controlled-validation-${slot.toLowerCase()}`}
                  disabled={!allocationSelections[slot]}>
                  <option value="">Select B3 child run</option>
                  {validationOptionsFor(slot).map(item => {
                    const id = validationIdentifier(item);
                    return id === null ? null : <option key={id} value={id}>
                      #{id} · {runStatus(item)} · {String(item.validatedAt ?? "")}
                    </option>;
                  })}
                </select>
              </div>
            </div>)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={() => void createControlledComparison()}
              disabled={createRiskComparison.isPending || RISK_SLOTS.some(slot => !allocationSelections[slot] || !validationSelections[slot]) ||
                new Set(RISK_SLOTS.map(slot => allocationSelections[slot])).size !== 3 ||
                new Set(RISK_SLOTS.map(slot => validationSelections[slot])).size !== 3}
              data-testid="button-create-d1-controlled-comparison">
              {createRiskComparison.isPending ? "Creating comparison…" : "Create controlled comparison"}
            </Button>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="d1-saved-controlled-comparison">Retrieve saved comparison</Label>
              <select id="d1-saved-controlled-comparison" className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={savedComparisonId ?? ""}
                onChange={event => setSavedComparisonId(event.target.value ? Number(event.target.value) : null)}
                data-testid="select-d1-saved-controlled-comparison">
                <option value="">Select saved comparison</option>
                {riskComparisonList.map(item => {
                  const id = identifier(item);
                  return id === null ? null : <option key={id} value={id}>Comparison #{id} · {String(item.createdAt ?? "")} · {String(item.manifestHash ?? "").slice(0, 12)}</option>;
                })}
              </select>
            </div>
            {savedComparisonId !== null && <Button type="button" size="sm" variant="outline"
              onClick={() => void replayControlledComparison()} disabled={replayRiskComparison.isPending}
              data-testid="button-replay-d1-controlled-comparison">
              {replayRiskComparison.isPending ? "Replaying…" : "Replay saved comparison"}
            </Button>}
          </div>
          {comparisonActionError && <Alert variant="destructive"><AlertDescription data-testid="error-d1-controlled-comparison">{comparisonActionError}</AlertDescription></Alert>}
          {savedComparisonQuery.isLoading && savedComparisonId !== null && <p className="text-xs text-muted-foreground">Retrieving saved comparison…</p>}
          {savedComparisonId !== null && !savedComparisonQuery.isLoading && savedComparisonQuery.error &&
            <Alert variant="destructive"><AlertDescription>Saved comparison could not be retrieved: {savedComparisonQuery.error.message}</AlertDescription></Alert>}
          {savedComparisonId !== null && !savedComparisonQuery.isLoading && Object.keys(savedComparisonModels).length > 0 && <div className="space-y-3" data-testid="d1-controlled-comparison-result">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Saved comparison #{savedComparisonId}</Badge>
              <span className="text-xs text-muted-foreground">No winner declared. Differences are descriptive under matched frozen B2/B3 settings.</span>
              <span className="text-xs text-muted-foreground">Manifest {String(savedComparison.manifestHash ?? "unavailable")} · result {String(savedComparison.resultHash ?? "unavailable")}</span>
            </div>
            <div className="overflow-auto rounded border"><table className="w-full min-w-[940px] text-left text-xs">
              <thead className="bg-muted"><tr><th className="p-2">Risk estimator</th><th className="p-2">B2 / B3 IDs</th><th className="p-2">Expected daily risk</th><th className="p-2">Realized B3 turnover</th><th className="p-2">B3 metrics</th></tr></thead>
              <tbody>{RISK_SLOTS.map(slot => {
                const model = row(savedComparisonModels[slot]);
                return <tr key={slot} className="border-t align-top">
                  <th className="p-2 font-medium">{slot}<p className="mt-1 font-normal text-muted-foreground">{display(model.riskModel)}</p></th>
                  <td className="p-2">B2 #{display(model.allocationId)}<br />B3 #{display(model.validationRunId)}<br />{display(model.b3Status)}</td>
                  <td className="p-2 tabular-nums">{display(model.expectedDailyVolatility)}</td>
                  <td className="p-2 tabular-nums">{display(model.realizedTurnover)}</td>
                  <td className="p-2"><pre className="max-h-48 min-w-64 overflow-auto whitespace-pre-wrap">{display(model.realizedMetrics)}</pre></td>
                </tr>;
              })}</tbody>
            </table></div>
            <div className="grid gap-3 md:grid-cols-3">
              {RISK_SLOTS.map(slot => {
                const model = row(savedComparisonModels[slot]);
                return <div key={slot} className="rounded border bg-muted/20 p-3 text-xs">
                  <h4 className="mb-1 font-semibold">{slot} · saved weights</h4>
                  <p className="font-medium">Alpha capital weights</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{display(model.alphaWeights)}</pre>
                  <p className="mt-2 font-medium">Underlying asset weights</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{display(model.underlyingAssetWeights)}</pre>
                </div>;
              })}
            </div>
            <div className="overflow-auto rounded border"><table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-muted"><tr><th className="p-2">Pair</th><th className="p-2">Alpha-weight half-L1</th><th className="p-2">Underlying-asset half-L1</th><th className="p-2">Expected daily risk difference</th></tr></thead>
              <tbody>{savedPairwiseDistances.map((distance, index) => <tr key={`${distance.left}-${distance.right}-${index}`} className="border-t">
                <th className="p-2">{display(distance.left)} vs {display(distance.right)}</th>
                <td className="p-2 tabular-nums">{display(distance.alphaWeightDistance)}</td>
                <td className="p-2 tabular-nums">{display(distance.underlyingAssetWeightDistance)}</td>
                <td className="p-2 tabular-nums">{display(distance.expectedDailyVolatilityDifference)}</td>
              </tr>)}</tbody>
            </table></div>
            <details className="rounded border bg-muted/20 p-3 text-xs"><summary className="cursor-pointer font-medium">Inspect frozen comparison manifest</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{display(savedComparison.manifest)}</pre>
            </details>
          </div>}
          {replayError && <Alert variant="destructive"><AlertDescription data-testid="error-d1-controlled-replay">{replayError}</AlertDescription></Alert>}
          {replayResult && <div className="rounded border p-3 text-xs" data-testid="d1-controlled-replay-result">
            <strong>Replay result · comparison #{display(replayResult.comparisonId)} · {display(replayResult.status)}</strong>
            <p className="mt-1">Maximum numeric difference: {display(replayResult.maximumNumericDifference)}</p>
            <p>Differences: {display(replayResult.differences)}</p>
            {replayResult.result !== undefined && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{display(replayResult.result)}</pre>}
          </div>}
        </CardContent>
      </Card>
      <p className="text-[11px] text-muted-foreground">All result views read immutable saved B2 diagnostics. Unsupported or absent backend fields are shown as unavailable; no risk data is synthesized.</p>
    </CardContent>
  </Card>;
}