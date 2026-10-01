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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play, SearchCheck, AlertCircle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { useWorkflowStage } from "@/lib/workflow";
import { OverviewTab } from "@/components/portfolio-lab/OverviewTab";
import { FactorsRegimesTab } from "@/components/portfolio-lab/FactorsRegimesTab";
import { ModelsTab } from "@/components/portfolio-lab/ModelsTab";
import { BacktestTab } from "@/components/portfolio-lab/BacktestTab";
import { ConstraintsTab } from "@/components/portfolio-lab/ConstraintsTab";
import { PM_SECTIONS, PM_SECTION_TARGETS, resolveTopAction, sameAction, type PmAction } from "@/components/portfolio-lab/pm-shell-ui";
import { AllocationTab } from "@/components/portfolio-lab/AllocationTab";
import { PreparedInputsPanel } from "@/components/portfolio-lab/PreparedInputsPanel";
import { B2AllocationPanel } from "@/components/portfolio-lab/B2AllocationPanel";
import { B3ValidationPanel } from "@/components/portfolio-lab/B3ValidationPanel";
import { C1ContributionPanel } from "@/components/portfolio-lab/C1ContributionPanel";
import { C2DiagnosticsPanel } from "@/components/portfolio-lab/C2DiagnosticsPanel";
import { C3SelectionPoliciesPanel } from "@/components/portfolio-lab/C3SelectionPoliciesPanel";
import { HistoryReplayInspector } from "@/components/portfolio-lab/HistoryReplayInspector";
import { StartingPortfolioPanel } from "@/components/portfolio-lab/StartingPortfolioPanel";
import type { StartingPortfolioContext, StartingPortfolioSelection } from "@/components/portfolio-lab/starting-portfolio";
import { readStartingSelection, writeStartingSelection } from "@/components/portfolio-lab/starting-selection-store";
import { PmSavedHistory } from "@/components/portfolio-lab/PmSavedHistory";
import { PmWorkflowSummary } from "@/components/portfolio-lab/PmWorkflowSummary";
import {
  HISTORY_SELECTION_KEY, findSelected, parseSelection, planInspection,
  hasPendingJobs, effectiveInspectedRunId, repinLegacyRun, resolveInspectedAllocationId, jobIsPending, type HistorySelection, type InspectionPlan, type PortfolioHistoryEntry,
} from "@/components/portfolio-lab/portfolio-history-state";
import { useValidationJob } from "@/components/portfolio-lab/use-validation-job";
import type { B2PreparedSelection } from "@/components/portfolio-lab/PreparedInputsPanel";
import type { D1RiskModelRequest } from "@/components/portfolio-lab/D1RiskModelPanel";

export default function PortfolioLab() {
  const { openSettings } = useSettingsDrawer();
  const [workingB2Mode, setB2Mode] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem("allocation-lab-optimization-mode") === "b2");
  const [b2Prepared, setB2Prepared] = useState<B2PreparedSelection | null>(null);
  const [b2CandidateCount, setB2CandidateCount] = useState(0);
  const [b2EstimationWindow, setB2EstimationWindow] = useState(252);
  const [b2AlignedObservationCount, setB2AlignedObservationCount] = useState<number | null>(null);
  const [d1RiskModel, setD1RiskModel] = useState<D1RiskModelRequest>({
    type: "SAMPLE",
    specificRiskFloorFraction: 1e-6,
  });
  const [optAction, setOptAction] = useState<PmAction | null>(null);
  const [valAction, setValAction] = useState<PmAction | null>(null);
  const registerOpt = useCallback((a: PmAction | null) => setOptAction((p) => (sameAction(p, a) ? p : a)), []);
  const registerVal = useCallback((a: PmAction | null) => setValAction((p) => (sameAction(p, a) ? p : a)), []);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [riskExecutionToken, setRiskExecutionToken] = useState(0);
  const [startingSelection, setStartingSelection] = useState<StartingPortfolioSelection | undefined>(() =>
    readStartingSelection(typeof window === "undefined" ? null : window.localStorage));
  const [startingContext, setStartingContext] = useState<StartingPortfolioContext | undefined>(undefined);
  const handleStartingChange = useCallback((sel: StartingPortfolioSelection) => {
    setStartingSelection(sel);
    writeStartingSelection(typeof window === "undefined" ? null : window.localStorage, sel);
  }, []);
  const handleStartingContext = useCallback((ctx: StartingPortfolioContext) => setStartingContext(ctx), []);
  const b2RunToken = 0;
  const [b2Running, setB2Running] = useState(false);
  const [selectedB2AllocationId, setSelectedB2AllocationId] = useState<number | null>(null);
  // Navigation never changes these: panels' own explicit buttons are the only actors.
  const b3RunToken = 0;
  const [historySelection, setHistorySelection] = useState<HistorySelection | null>(() =>
    typeof window === "undefined" ? null : parseSelection(window.localStorage.getItem(HISTORY_SELECTION_KEY)));
  const [inspection, setInspection] = useState<InspectionPlan | null>(null);
  // Working engine is the draft preference; inspection only changes the derived view mode.
  const b2Mode = inspection ? inspection.b2Mode : workingB2Mode;
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
    window.localStorage.setItem("allocation-lab-optimization-mode", workingB2Mode ? "b2" : "legacy");
  }, [workingB2Mode]);

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
  const b3Unresolved = !!inspection?.b2Mode && inspection.inspectedAllocationId === null;
  const b3JobId = b3Unresolved && inspection!.inspectRunId === null ? inspection!.inspectedJobId : null;
  const { data: b3Job } = useGetValidationJob(b3JobId ?? "", {
    query: { enabled: !!b3JobId, queryKey: getGetValidationJobQueryKey(b3JobId ?? ""),
      refetchInterval: (q: any) => jobIsPending(q.state?.data?.status) ? 3000 : false } as any,
  });
  const b3RunId = b3Unresolved ? (inspection!.inspectRunId ?? b3Job?.validationRunId ?? null) : null;
  const { data: b3RunData } = useGetValidationRun(b3RunId ?? 0, { query: { enabled: !!b3RunId } as any });
  const b3RunAllocationId = b3RunData && "allocationId" in b3RunData ? b3RunData.allocationId : null;
  const inspectedAllocationId = resolveInspectedAllocationId(inspection, b3RunAllocationId, b3Job?.request);
  const viewedSessionId = inspection?.legacySessionSummaryId ?? null;
  const { data: viewedSession, isLoading: loadingViewedSession } = useGetSession(viewedSessionId ?? 0, {
    query: { enabled: !!viewedSessionId, queryKey: getGetSessionQueryKey(viewedSessionId ?? 0) } as any,
  });
  const viewResult = viewedSessionId ? viewedSession?.result : result;

  const applyInspection = useCallback((entry: PortfolioHistoryEntry) => {
    const plan = planInspection(entry);
    setInspection(plan);
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
          setRiskExecutionToken((t) => t + 1);
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

  const navigateAnchor = (tab: string) => {
    const id = tab === "models" ? "pm-forecast-risk"
      : tab === "allocation" || tab === "constraints" ? (tab === "constraints" ? "pm-constraints" : "pm-results")
      : tab === "backtest" ? "pm-validation"
      : tab === "factors" || tab === "regimes" || tab === "factors-regimes" ? "pm-saved-runs" : null;
    if (!id) return;
    if (id === "pm-saved-runs")
      setAdvancedOpen(true);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const viewAllocationId = inspection ? inspectedAllocationId : selectedB2AllocationId;
  const unrecordedSource = !!inspection?.b2Mode && inspectedAllocationId === null;
  const inspecting = !!inspection;
  const topOpt = resolveTopAction({ registered: optAction, fallback: handleRunOptimizer, fallbackDisabled: !hasData, fallbackBusy: runPipeline.isPending, inspecting, b2Mode });
  const topVal = resolveTopAction({ registered: valAction, fallback: handleRunValidation, fallbackDisabled: !result?.sessionId, fallbackBusy: legacyJob.active, inspecting, b2Mode });
  const safeStartingSelection: StartingPortfolioSelection | undefined =
    startingSelection?.holdings && startingContext?.informationCutoff
      && startingSelection.holdings.asOf !== startingContext.informationCutoff
      ? { ...startingSelection, holdings: undefined } : startingSelection;
  const draftRepresentation = b2Prepared?.draftRepresentation ?? b2Prepared?.representation;
  const signalsBlocked = b2Mode && (draftRepresentation === "signals" || b2Prepared?.representation === "signals");
  const draftNotReady = b2Mode && b2Prepared?.draftReady === false;
  const secHead = (n: number, label: string) => (
    <div className="flex items-baseline gap-3 border-b pb-2">
      <span className="text-xs font-mono text-muted-foreground">{n}</span>
      <h2 className="text-lg font-semibold">{label}</h2>
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        section="2 · Portfolio Lab"
        title="Allocation Lab"
        description="Results are immutable and every run is deliberate. Work top to bottom; nothing executes until you press a button."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={topOpt.run} disabled={topOpt.disabled || signalsBlocked || draftNotReady} data-testid="button-run-new-optimization">
              {topOpt.busy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Optimizing…</> : <><Play className="mr-2 h-3.5 w-3.5" /> Optimize</>}
            </Button>
            <Button size="sm" onClick={topVal.run} disabled={topVal.disabled} data-testid="button-inspect-validation">
              {topVal.busy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Validating…</> : <><SearchCheck className="mr-2 h-3.5 w-3.5" /> Validate</>}
            </Button>
            {inspecting && (
              <Button size="sm" variant="ghost" onClick={clearInspection} data-testid="button-return-to-draft">Return to draft</Button>
            )}
          </div>
        }
      />

      <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="nav-pm-sections">
        {PM_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" data-testid={`link-anchor-${s.id}`}>
            {s.n} · {s.label}
          </a>
        ))}
      </nav>

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

      {hasData && !b2Mode && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pipeline:</span>
          {[
            { label: "Data", done: hasData },
            { label: "Optimize", done: hasRun },
            { label: "Validation", done: hasBacktest && validationRequested },
          ].map(({ label, done }) => (
            <Badge key={label} variant="outline" className="text-[10px] font-medium">{done ? "Done" : "Pending"} · {label}</Badge>
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

      <section id="pm-setup" className="space-y-4 scroll-mt-4" data-testid="section-setup">
        {secHead(1, "Portfolio Setup")}
        <div id={PM_SECTION_TARGETS.setup} />
        <PreparedInputsPanel b2Mode={workingB2Mode} onB2ModeChange={inspection ? undefined : setB2Mode} onPreparedSelectionChange={handleB2PreparedSelection} />
        {signalsBlocked && (
          <Alert data-testid="alert-signals-not-tradable">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">Signals are not tradable returns, so B2 Optimize is disabled. Choose asset returns or alpha streams.</AlertDescription>
          </Alert>
        )}
        {draftNotReady && (
          <Alert data-testid="alert-draft-not-ready">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">The prepared-input draft has changed since it was last frozen. Prepare and freeze it before Optimize. The last frozen policy and result are kept, and Validate still targets that frozen policy.</AlertDescription>
          </Alert>
        )}
        {!b2Mode && (
          <Alert data-testid="alert-legacy-universe">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">Advanced workflow choice: the legacy optimizer uses the global universe from Settings. Assets chosen in Prepared inputs do not apply to it.</AlertDescription>
          </Alert>
        )}
        <StartingPortfolioPanel
          engine={b2Mode ? "b2" : "legacy"}
          context={startingContext}
          selection={startingSelection}
          onChange={handleStartingChange}
          onOpenSettings={() => openSettings("previous-weights")}
        />
        {b2Mode && (
          <B2AllocationPanel
            prepared={b2Prepared}
            runToken={b2RunToken}
            onRunningChange={setB2Running}
            onAllocationSelectionChange={setSelectedB2AllocationId}
            workingAllocationId={selectedB2AllocationId}
            riskModel={d1RiskModel}
            onCandidateCountChange={setB2CandidateCount}
            onEstimationWindowChange={setB2EstimationWindow}
            onAlignedObservationCountChange={setB2AlignedObservationCount}
            inspectedAllocationId={inspectedAllocationId}
            onExitInspection={clearInspection}
            inspectionActive={!!inspection}
            sectionTargets={PM_SECTION_TARGETS}
            onOptimizeActionChange={registerOpt}
            onStartingPortfolioContextChange={handleStartingContext}
            startingPortfolioRequest={safeStartingSelection}
          />
        )}
      </section>

      <section id="pm-forecast-risk" className="space-y-4 scroll-mt-4" data-testid="section-forecast-risk">
        {secHead(2, "Forecast & Risk")}
        <div id={PM_SECTION_TARGETS.forecastRisk} />
        <ModelsTab
          result={viewResult}
          hasData={hasData}
          hasRun={hasRun}
          allocationId={viewAllocationId}
          representation={b2Prepared?.representation ?? null}
          candidateCount={b2CandidateCount || b2Prepared?.candidateIds.length || 0}
          observationWindow={b2EstimationWindow}
          alignedObservationCount={b2AlignedObservationCount}
          d1RiskModel={d1RiskModel}
          onD1RiskModelChange={setD1RiskModel}
          riskExecutionToken={inspection ? 0 : riskExecutionToken}
          inspectionActive={!!inspection}
        />
      </section>

      <section id="pm-constraints" className="space-y-4 scroll-mt-4" data-testid="section-constraints">
        {secHead(3, "Constraints")}
        <div id={PM_SECTION_TARGETS.constraints} />
        {!inspection ? (
          <ConstraintsTab result={viewResult} constraints={constraints} hasData={hasData} hasRun={hasRun} />
        ) : (
          <p className="text-sm text-muted-foreground rounded-md border bg-white p-4" data-testid="text-constraints-audit-unrecorded">
            Constraint audit is not recorded on this saved record, and it is not recomputed against current settings. Return to draft to audit current constraints.
          </p>
        )}
      </section>

      <section id="pm-results" className="space-y-4 scroll-mt-4" data-testid="section-results">
        {secHead(4, "Results")}
        <div id={PM_SECTION_TARGETS.results} />
        {unrecordedSource && (
          <Alert data-testid="alert-frozen-allocation-unrecorded">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">Loading the frozen allocation, or no frozen policy is recorded for this saved validation. No working output is shown as its result.</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">Replay of a saved result is available from <a href="#pm-saved-runs" className="underline" data-testid="link-results-replay">Saved Runs / Replay</a>.</p>
        {!b2Mode && (
          <>
            <OverviewTab
              result={viewResult}
              loading={viewedSessionId ? loadingViewedSession : loadingResult}
              hasData={hasData}
              validationRan={!viewedSessionId && validationRequested && !!bt}
              bt={viewedSessionId ? undefined : bt}
              onNavigate={navigateAnchor}
            />
            <AllocationTab result={viewResult} constraints={constraints} hasData={hasData} hasRun={hasRun} />
          </>
        )}
      </section>

      <section id="pm-validation" className="space-y-4 scroll-mt-4" data-testid="section-validation">
        {secHead(5, "Validation")}
        {b2Mode
          ? <B3ValidationPanel allocationId={selectedB2AllocationId} runToken={b3RunToken} onRunningChange={setB3Running} {...{ inspectRunId: inspection?.inspectRunId ?? null, inspectedJobId: inspection?.inspectedJobId ?? null }} onValidateActionChange={registerVal} />
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
              onValidateActionChange={registerVal}
              benchmark={btBenchmark} setBenchmark={setBtBenchmark}
              frequency={btFrequency} setFrequency={setBtFrequency}
              timing={btTiming} setTiming={setBtTiming}
              txnCostBps={btTxnCostBps} setTxnCostBps={setBtTxnCostBps}
              slippageBps={btSlippageBps} setSlippageBps={setBtSlippageBps}
              cashYield={btCashYield} setCashYield={setBtCashYield}
              startDate={btStartDate} setStartDate={setBtStartDate}
              endDate={btEndDate} setEndDate={setBtEndDate}
            />}
      </section>

      <section id="pm-saved-runs" className="space-y-4 scroll-mt-4" data-testid="section-saved-runs">
        {secHead(6, "Saved Runs / Replay")}
        <PmSavedHistory
          entries={historyEntries}
          loading={history.isLoading}
          error={history.isError}
          refreshing={history.isFetching}
          selection={historySelection}
          onRefresh={() => { void history.refetch(); }}
          onInspect={handleInspect}
        />
        <HistoryReplayInspector entry={inspectedEntry} />
        <details className="rounded-md border bg-white p-4" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="details-advanced-research">
          <summary className="cursor-pointer text-sm font-medium">Advanced research on saved runs</summary>
          {advancedOpen && (
          <div className="space-y-6 pt-4" data-testid="advanced-research-body">
            {!b2Mode && <FactorsRegimesTab result={viewResult} hasData={hasData} hasRun={hasRun} />}
            <C1ContributionPanel />
            <C2DiagnosticsPanel />
            <C3SelectionPoliciesPanel />
          </div>
          )}
        </details>
      </section>
    </div>
  );
}
