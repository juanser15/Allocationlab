import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetLatestResults, useGetPricesStatus, useGetConstraints,
  useRunPipeline, useGetRiskModel, useCreateGovernanceSnapshot,
  useGetValidationRun, useListValidationRuns, useGetValidationJob, useGetSession,
  getGetValidationJobQueryKey, getGetSessionQueryKey,
  type ValidationJob, type ValidationRun, type ValidationRunSummary,
} from "@workspace/api-client-react";
import { localSettings } from "@/lib/local-settings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play, Settings2, SearchCheck, AlertCircle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { useWorkflowStage } from "@/lib/workflow";
import { OverviewTab } from "@/components/portfolio-lab/OverviewTab";
import { FactorsRegimesTab } from "@/components/portfolio-lab/FactorsRegimesTab";
import { ModelsTab } from "@/components/portfolio-lab/ModelsTab";
import { BacktestTab } from "@/components/portfolio-lab/BacktestTab";
import { AllocationTab } from "@/components/portfolio-lab/AllocationTab";
import { PreparedInputsPanel } from "@/components/portfolio-lab/PreparedInputsPanel";
import { B2AllocationPanel } from "@/components/portfolio-lab/B2AllocationPanel";
import { B3ValidationPanel } from "@/components/portfolio-lab/B3ValidationPanel";
import { C1ContributionPanel } from "@/components/portfolio-lab/C1ContributionPanel";
import { C2DiagnosticsPanel } from "@/components/portfolio-lab/C2DiagnosticsPanel";
import { C3SelectionPoliciesPanel } from "@/components/portfolio-lab/C3SelectionPoliciesPanel";
import { PmSavedHistory } from "@/components/portfolio-lab/PmSavedHistory";
import { PmWorkflowSummary } from "@/components/portfolio-lab/PmWorkflowSummary";
import {
  HISTORY_SELECTION_KEY, findSelected, parseSelection, planInspection,
  hasPendingJobs, effectiveInspectedRunId, repinLegacyRun, jobIsPending, type HistorySelection, type InspectionPlan, type PortfolioHistoryEntry,
} from "@/components/portfolio-lab/portfolio-history-state";
import { useValidationJob } from "@/components/portfolio-lab/use-validation-job";
import type { B2PreparedSelection } from "@/components/portfolio-lab/PreparedInputsPanel";
import type { D1RiskModelRequest } from "@/components/portfolio-lab/D1RiskModelPanel";

export default function PortfolioLab() {
  const { openSettings } = useSettingsDrawer();
  const [activeTab, setActiveTab] = useState("overview");
  const [b2Mode, setB2Mode] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem("allocation-lab-optimization-mode") === "b2");
  const [b2Prepared, setB2Prepared] = useState<B2PreparedSelection | null>(null);
  const [b2CandidateCount, setB2CandidateCount] = useState(0);
  const [b2EstimationWindow, setB2EstimationWindow] = useState(252);
  const [b2AlignedObservationCount, setB2AlignedObservationCount] = useState<number | null>(null);
  const [d1RiskModel, setD1RiskModel] = useState<D1RiskModelRequest>({
    type: "SAMPLE",
    specificRiskFloorFraction: 1e-6,
  });
  const b2RunToken = 0;
  const [b2Running, setB2Running] = useState(false);
  const [selectedB2AllocationId, setSelectedB2AllocationId] = useState<number | null>(null);
  // Navigation never changes these: panels' own explicit buttons are the only actors.
  const b3RunToken = 0;
  const [historySelection, setHistorySelection] = useState<HistorySelection | null>(() =>
    typeof window === "undefined" ? null : parseSelection(window.localStorage.getItem(HISTORY_SELECTION_KEY)));
  const [inspection, setInspection] = useState<InspectionPlan | null>(null);
  const restoredRef = useRef(false);
  const history = useQuery<PortfolioHistoryEntry[]>({
    queryKey: ["/api/portfolio-history"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio-history", { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error(`History request failed (${res.status})`);
      return res.json();
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (q) => hasPendingJobs(q.state.data) ? 5000 : false,
  });
  const historyEntries = history.data ?? [];
  const inspectedEntry = findSelected(historyEntries, historySelection);
  const [b3Running, setB3Running] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("allocation-lab-optimization-mode", b2Mode ? "b2" : "legacy");
  }, [b2Mode]);

  const { data: pricesStatus, isLoading: loadingPrices } = useGetPricesStatus();
  const { data: result, isLoading: loadingResult, refetch: refetchResult } = useGetLatestResults();
  const { data: constraints } = useGetConstraints();
  const { stage, hasData, hasRun, hasBacktest } = useWorkflowStage();

  const runPipeline = useRunPipeline();
  const createGovernanceSnapshot = useCreateGovernanceSnapshot();

  // Backtest config state (shared with BacktestTab)
  const [btBenchmark, setBtBenchmark] = useState<string>("none");
  const [btFrequency, setBtFrequency] = useState<"monthly" | "quarterly">("monthly");
  const [btTiming, setBtTiming] = useState<"same_close" | "next_close" | "next_open">("next_close");
  const [btTxnCostBps, setBtTxnCostBps] = useState(10);
  const [btSlippageBps, setBtSlippageBps] = useState(5);
  const [btCashYield, setBtCashYield] = useState(4);
  const [btStartDate, setBtStartDate] = useState("");
  const [btEndDate, setBtEndDate] = useState("");
  const [selectedValidationRunId, setSelectedValidationRunId] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const refetchValidationRunsRef = useRef<() => void>(() => undefined);
  const validationListSessionRef = useRef<number | null>(null);
  const onLegacyJobCompleted = useCallback((job: ValidationJob) => {
    if (!job.validationRunId || !("sessionId" in job.request)) return;
    setSelectedValidationRunId(job.validationRunId);
    if (validationListSessionRef.current === job.request.sessionId)
      refetchValidationRunsRef.current();
  }, []);
  const legacyJob = useValidationJob("allocation-lab:validation-job:legacy", onLegacyJobCompleted);
  const capturedLegacySessionId = legacyJob.request && "sessionId" in legacyJob.request
    ? legacyJob.request.sessionId : null;
  const legacySessionId = inspection?.pinnedSessionId ?? capturedLegacySessionId ?? result?.sessionId ?? null;
  const { data: validationRuns, refetch: refetchValidationRuns } = useListValidationRuns(
    { sessionId: legacySessionId ?? 0 },
    { query: { enabled: !!legacySessionId } as any },
  );
  validationListSessionRef.current = legacySessionId;
  refetchValidationRunsRef.current = () => { void refetchValidationRuns(); };
  const legacyRuns = (validationRuns ?? []).filter((run): run is ValidationRunSummary => "strategySnapshotId" in run);
  const visibleValidationRunId = selectedValidationRunId ?? legacyRuns[0]?.validationRunId ?? null;
  const { data: savedValidation, isLoading: loadingBt } = useGetValidationRun(
    visibleValidationRunId ?? 0,
    { query: { enabled: !!visibleValidationRunId } as any },
  );
  const legacyValidation: ValidationRun | undefined = savedValidation && "strategySnapshotId" in savedValidation && savedValidation.strategySnapshotId === legacySessionId
    ? savedValidation : undefined;
  const bt = legacyValidation?.result;
  const validationRequested = !!visibleValidationRunId || !!legacyJob.job || !!legacyJob.submissionError;

  // Legacy inspected view: read-only, driven by history identity only.
  const legacyInspecting = !!inspection && !inspection.b2Mode &&
    (inspection.pinnedLegacyRunId !== null || inspection.inspectedJobId !== null);
  const inspJobId = legacyInspecting ? inspection!.inspectedJobId : null;
  const { data: inspJob } = useGetValidationJob(inspJobId ?? "", {
    query: {
      enabled: !!inspJobId, queryKey: getGetValidationJobQueryKey(inspJobId ?? ""),
      refetchInterval: (q: any) => jobIsPending(q.state?.data?.status) ? 2000 : false,
    } as any,
  });
  const inspRunId = legacyInspecting ? effectiveInspectedRunId(inspection, inspJob?.validationRunId) : null;
  const { data: inspRunData } = useGetValidationRun(inspRunId ?? 0, { query: { enabled: !!inspRunId } as any });
  const inspRun: ValidationRun | null = inspRunData && "strategySnapshotId" in inspRunData ? inspRunData : null;
  const viewedSessionId = inspection?.legacySessionSummaryId ?? null;
  const { data: viewedSession, isLoading: loadingViewedSession } = useGetSession(viewedSessionId ?? 0, {
    query: { enabled: !!viewedSessionId, queryKey: getGetSessionQueryKey(viewedSessionId ?? 0) } as any,
  });
  const viewResult = viewedSessionId ? viewedSession?.result : result;

  const applyInspection = useCallback((entry: PortfolioHistoryEntry) => {
    const plan = planInspection(entry);
    setInspection(plan);
    setB2Mode(plan.b2Mode);
    setActiveTab(plan.tab);
  }, []);
  const handleInspect = (entry: PortfolioHistoryEntry) => {
    const sel = { kind: entry.kind, id: entry.id };
    setHistorySelection(sel);
    window.localStorage.setItem(HISTORY_SELECTION_KEY, JSON.stringify(sel));
    applyInspection(entry);
  };
  const clearHistorySelection = () => {
    setHistorySelection(null);
    setInspection(null);
    window.localStorage.removeItem(HISTORY_SELECTION_KEY);
  };
  const clearInspection = clearHistorySelection;
  useEffect(() => {
    if (restoredRef.current || !history.data) return;
    restoredRef.current = true;
    const entry = findSelected(history.data, historySelection);
    if (entry) applyInspection(entry);
  }, [history.data, historySelection, applyInspection]);

  // Legacy explicit action (BacktestTab button). Header never calls this.
  const handleRunValidation = () => {
    if (b2Mode) return;
    if (!result?.sessionId) return;
    setValidationError(null);
    clearHistorySelection();
    setActiveTab("backtest");
    setSelectedValidationRunId(null);
    legacyJob.start({
        sessionId: result.sessionId, benchmark: btBenchmark,
        rebalanceFrequency: btFrequency, executionTiming: btTiming,
        transactionCostBps: btTxnCostBps, slippageBps: btSlippageBps,
        cashYieldAnnual: btCashYield / 100,
        ...(btStartDate ? { startDate: btStartDate } : {}),
        ...(btEndDate ? { endDate: btEndDate } : {}),
    });
  };

  const isRunning = b2Mode ? b2Running : runPipeline.isPending;
  const isValidating = b2Mode ? b3Running : legacyJob.active;
  const handleB2PreparedSelection = useCallback((selection: B2PreparedSelection | null) => {
    setB2Prepared(selection);
  }, []);
  const handleRunOptimizer = () => {
    if (b2Mode) return;
    clearHistorySelection();
    setSelectedValidationRunId(null);
    runPipeline.mutate(
      { data: { benchmarkTicker: localSettings.getBenchmarksSettings().defaultBenchmark } },
      {
        onSuccess: (data) => {
          refetchResult();
          const governance = localSettings.getGovernanceSettings();
          const execution = localSettings.getExecutionAssumptions();
          const benchmarks = localSettings.getBenchmarksSettings();
          if (data.sessionId) {
            createGovernanceSnapshot.mutate({
              sessionId: data.sessionId,
              data: {
                priceSource: "Uploaded/synced price dataset",
                benchmarkTicker: benchmarks.defaultBenchmark,
                modelVersion: governance.modelVersionLabel,
                parameterVersion: governance.parameterVersion,
                executionAssumptions: execution,
              },
            });
          }
        },
      }
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="2 · Portfolio Lab"
        title="Portfolio Lab"
        description={b2Mode
          ? "B2 computes an as-of allocation. B3 validates the frozen policy through historical decisions and executed holdings; today's weights are not backtest inputs."
          : "Systematic multi-factor portfolio optimizer. 1 · Optimize generates the allocation. 2 · Validate runs the historical backtest, walk-forward, and robustness checks."}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {b2Mode ? (
              <Button size="sm" variant="outline" onClick={() => setActiveTab("allocation")} data-testid="button-configure-optimization">
                <Settings2 className="mr-2 h-3.5 w-3.5" /> Configure allocation
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={handleRunOptimizer}
                disabled={!hasData || isRunning} data-testid="button-run-new-optimization">
                {isRunning
                  ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                  : <><Play className="mr-2 h-3.5 w-3.5" /> Optimize</>}
              </Button>
            )}
            {!b2Mode && <span className="text-[11px] text-muted-foreground">Creates a new frozen session</span>}
            <Button size="sm" onClick={() => setActiveTab("backtest")} data-testid="button-inspect-validation">
              {isValidating
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Validation in progress</>
                : <><SearchCheck className="mr-2 h-3.5 w-3.5" /> Configure validation</>}
            </Button>
          </div>
        }
      />

      {/* Workflow gate banners */}
       {!b2Mode && !loadingPrices && !hasData && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2 flex items-center justify-between w-full flex-wrap gap-2">
            <span>Valid price history is required. Upload price data before running the optimizer.</span>
            <button onClick={() => openSettings("data-sources")} className="text-sm font-medium underline flex items-center">
              Open Settings <ArrowRight className="ml-1 h-3 w-3" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Stage badge */}
       {hasData && !b2Mode && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pipeline:</span>
          {[
            { label: "Data", done: hasData },
            { label: "Factors", done: hasRun },
            { label: "Regime", done: hasRun },
            { label: "Models", done: hasRun },
            { label: "Validation", done: hasBacktest && validationRequested },
            { label: "Robustness", done: hasBacktest && validationRequested },
            { label: "Constraints", done: hasRun },
            { label: "Allocation", done: hasRun },
          ].map(({ label, done }) => (
            <Badge
              key={label}
              variant="outline"
              className={done
                ? "bg-green-50 text-green-700 border-green-200 text-[10px] font-medium"
                : "bg-gray-50 text-gray-400 border-gray-200 text-[10px] font-medium"
              }
            >
              {done ? "✓" : "○"} {label}
            </Badge>
          ))}
        </div>
      )}

      <PmWorkflowSummary
        inspected={inspectedEntry}
        hasDraft={b2Mode ? !!b2Prepared : hasData}
        draftLabel={b2Mode ? `${b2Prepared?.candidateIds.length ?? 0} prepared candidates` : "current legacy optimizer settings"}
        legacySessionSummaryId={inspection?.legacySessionSummaryId ?? null}
        onClearInspection={clearInspection}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-0.5 bg-gray-100/70 p-1">
          <TabsTrigger value="overview"        className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">1 · Overview</TabsTrigger>
          <TabsTrigger value="models"          className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">2 · Draft &amp; inputs</TabsTrigger>
          <TabsTrigger value="allocation"      className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">3 · Allocation</TabsTrigger>
          <TabsTrigger value="backtest"        className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">4 · Validation</TabsTrigger>
          <TabsTrigger value="history"         className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm" data-testid="tab-saved-history">5 · Saved runs &amp; jobs</TabsTrigger>
          <TabsTrigger value="factors-regimes" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">6 · Research diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <OverviewTab
            result={viewResult}
            loading={viewedSessionId ? loadingViewedSession : loadingResult}
            hasData={hasData}
            validationRan={!viewedSessionId && validationRequested && !!bt}
            bt={viewedSessionId ? undefined : bt}
            onNavigate={(tab) => {
              if (tab === "regimes" || tab === "factors") setActiveTab("factors-regimes");
              else if (tab === "constraints") setActiveTab("allocation");
              else setActiveTab(tab);
            }}
          />
        </TabsContent>

        <TabsContent value="factors-regimes" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
          <FactorsRegimesTab result={viewResult} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="models" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
          <PreparedInputsPanel b2Mode={b2Mode} onB2ModeChange={setB2Mode} onPreparedSelectionChange={handleB2PreparedSelection} />
          <ModelsTab
            result={result}
            hasData={hasData}
            hasRun={hasRun}
            allocationId={selectedB2AllocationId}
            representation={b2Prepared?.representation ?? null}
            candidateCount={b2CandidateCount || b2Prepared?.candidateIds.length || 0}
            observationWindow={b2EstimationWindow}
            alignedObservationCount={b2AlignedObservationCount}
            d1RiskModel={d1RiskModel}
            onD1RiskModelChange={setD1RiskModel}
          />
        </TabsContent>

        <TabsContent value="backtest" className="space-y-6 pt-4">
          {b2Mode
             ? <B3ValidationPanel allocationId={selectedB2AllocationId} runToken={b3RunToken} onRunningChange={setB3Running} {...{ inspectRunId: inspection?.inspectRunId ?? null, inspectedJobId: inspection?.inspectedJobId ?? null }} />
            : <BacktestTab
              bt={bt}
              loading={loadingBt || isValidating}
              hasData={hasData}
              hasRun={hasRun}
              validationRequested={validationRequested}
               validationRun={legacyValidation}
               validationRuns={legacyRuns}
              selectedValidationRunId={visibleValidationRunId}
              onSelectValidationRun={(id) => {
                if (legacyInspecting && inspection) setInspection(repinLegacyRun(inspection, id));
                else setSelectedValidationRunId(id);
              }}
              {...(legacyInspecting ? {
                inspectedRunId: inspRunId,
                inspectedRun: inspRun,
                 inspectedJobId: inspection!.inspectedJobId,
                inspectedJob: inspJob ?? null,
              } : {})}
               validationError={validationError ?? legacyJob.submissionError ?? legacyJob.job?.error?.message ?? null}
               validationJob={legacyJob.job}
               validationJobActive={legacyJob.active}
               validationJobSubmitting={legacyJob.submitting}
               validationJobReconnecting={legacyJob.reconnecting}
               validationJobSeconds={legacyJob.seconds}
               validationJobSubmissionError={legacyJob.submissionError}
              onRunValidation={handleRunValidation}
              benchmark={btBenchmark} setBenchmark={setBtBenchmark}
              frequency={btFrequency} setFrequency={setBtFrequency}
              timing={btTiming} setTiming={setBtTiming}
              txnCostBps={btTxnCostBps} setTxnCostBps={setBtTxnCostBps}
              slippageBps={btSlippageBps} setSlippageBps={setBtSlippageBps}
              cashYield={btCashYield} setCashYield={setBtCashYield}
              startDate={btStartDate} setStartDate={setBtStartDate}
              endDate={btEndDate} setEndDate={setBtEndDate}
            />}
          <details className="rounded-md border bg-white p-4" data-testid="details-advanced-research">
            <summary className="cursor-pointer text-sm font-medium">Advanced research diagnostics</summary>
            <div className="space-y-6 pt-4">
              <C1ContributionPanel />
              <C2DiagnosticsPanel />
              <C3SelectionPoliciesPanel />
            </div>
          </details>
        </TabsContent>

        <TabsContent value="allocation" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
          {b2Mode
             ? <B2AllocationPanel
                  prepared={b2Prepared}
                  runToken={b2RunToken}
                  onRunningChange={setB2Running}
                  onAllocationSelectionChange={setSelectedB2AllocationId}
                  riskModel={d1RiskModel}
                  onCandidateCountChange={setB2CandidateCount}
                  onEstimationWindowChange={setB2EstimationWindow}
                  onAlignedObservationCountChange={setB2AlignedObservationCount}
                  inspectedAllocationId={inspection?.inspectedAllocationId ?? null}
                  onExitInspection={clearInspection}
                />
            : <AllocationTab result={viewResult} constraints={constraints} hasData={hasData} hasRun={hasRun} />}
        </TabsContent>

        <TabsContent value="history" className="space-y-6 pt-4">
          <PmSavedHistory
            entries={historyEntries}
            loading={history.isLoading}
            error={history.isError}
            refreshing={history.isFetching}
            selection={historySelection}
            onRefresh={() => { void history.refetch(); }}
            onInspect={handleInspect}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
