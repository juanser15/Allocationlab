import { useCallback, useEffect, useState } from "react";
import {
  useGetLatestResults, useGetPricesStatus, useGetConstraints,
  useRunPipeline, useGetRiskModel, useCreateGovernanceSnapshot,
  useCreateValidationRun, useGetValidationRun, useListValidationRuns,
} from "@workspace/api-client-react";
import { localSettings } from "@/lib/local-settings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play, FlaskConical, AlertCircle, ArrowRight } from "lucide-react";
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
import type { B2PreparedSelection } from "@/components/portfolio-lab/PreparedInputsPanel";

export default function PortfolioLab() {
  const { openSettings } = useSettingsDrawer();
  const [activeTab, setActiveTab] = useState("overview");
  const [b2Mode, setB2Mode] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem("allocation-lab-optimization-mode") === "b2");
  const [b2Prepared, setB2Prepared] = useState<B2PreparedSelection | null>(null);
  const [b2RunToken, setB2RunToken] = useState(0);
  const [b2Running, setB2Running] = useState(false);

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
  const createValidationRun = useCreateValidationRun();
  const { data: validationRuns, refetch: refetchValidationRuns } = useListValidationRuns(
    { sessionId: result?.sessionId ?? 0 },
    { query: { enabled: !!result?.sessionId } as any },
  );
  const visibleValidationRunId = selectedValidationRunId ?? validationRuns?.[0]?.validationRunId ?? null;
  const { data: savedValidation, isLoading: loadingBt } = useGetValidationRun(
    visibleValidationRunId ?? 0,
    { query: { enabled: !!visibleValidationRunId } as any },
  );
  const bt = savedValidation && savedValidation.strategySnapshotId === result?.sessionId
    ? savedValidation.result : undefined;
  const validationRequested = !!visibleValidationRunId || createValidationRun.isPending;

  useEffect(() => {
    if (!savedValidation || savedValidation.strategySnapshotId !== result?.sessionId) return;
    const a = savedValidation.assumptions;
    setBtBenchmark(a.benchmarkTicker ?? "none");
    setBtFrequency(a.rebalanceFrequency as "monthly" | "quarterly");
    setBtTiming(a.executionTiming as "same_close" | "next_close" | "next_open");
    setBtTxnCostBps(a.transactionCostBps);
    setBtSlippageBps(a.slippageBps);
    setBtCashYield(a.cashYieldAnnual * 100);
    setBtStartDate(a.startDate ?? "");
    setBtEndDate(a.endDate ?? "");
  }, [savedValidation?.validationRunId, savedValidation?.strategySnapshotId, result?.sessionId]);

  const handleRunValidation = () => {
    if (!result?.sessionId || b2Mode) return;
    setValidationError(null);
    setActiveTab("backtest");
    createValidationRun.mutate({
      data: {
        sessionId: result.sessionId, benchmark: btBenchmark,
        rebalanceFrequency: btFrequency, executionTiming: btTiming,
        transactionCostBps: btTxnCostBps, slippageBps: btSlippageBps,
        cashYieldAnnual: btCashYield / 100,
        ...(btStartDate ? { startDate: btStartDate } : {}),
        ...(btEndDate ? { endDate: btEndDate } : {}),
      },
    }, {
      onSuccess: (saved) => {
        setSelectedValidationRunId(saved.validationRunId);
        refetchValidationRuns();
      },
      onError: (error) => setValidationError(error instanceof Error ? error.message : "Validation could not be saved."),
    });
  };

  const isRunning = b2Mode ? b2Running : runPipeline.isPending;
  const isValidating = createValidationRun.isPending;
  const handleB2PreparedSelection = useCallback((selection: B2PreparedSelection | null) => {
    setB2Prepared(selection);
  }, []);
  const handleRunOptimizer = () => {
    if (b2Mode) {
      setActiveTab("allocation");
      setB2RunToken(token => token + 1);
      return;
    }
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
        title="Optimizer Pro"
        description={b2Mode
          ? "B2 computes an as-of allocation from the selected frozen preparation. Historical validation is explicitly unavailable for this allocation policy."
          : "Systematic multi-factor portfolio optimizer. 1 · Optimize generates the allocation. 2 · Validate runs the historical backtest, walk-forward, and robustness checks."}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunOptimizer}
              disabled={b2Mode ? (!b2Prepared || b2Running) : (!hasData || isRunning)}
            >
              {isRunning
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                : <><Play className="mr-2 h-3.5 w-3.5" /> 1 · Optimize</>
              }
            </Button>
            <Button
              size="sm"
              onClick={handleRunValidation}
              disabled={b2Mode || !hasRun || isValidating}
            >
              {isValidating
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Validating…</>
                : <><FlaskConical className="mr-2 h-3.5 w-3.5" /> 2 · Validate</>
              }
            </Button>
          </div>
        }
      />

      {/* Workflow gate banners */}
      {!loadingPrices && !hasData && (
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
      {hasData && (
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-0.5 bg-gray-100/70 p-1">
          <TabsTrigger value="overview"        className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">1 · Overview</TabsTrigger>
          <TabsTrigger value="factors-regimes" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">2 · Factors &amp; Regimes</TabsTrigger>
          <TabsTrigger value="models"          className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">3 · Models</TabsTrigger>
          <TabsTrigger value="backtest"        className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">4 · Backtest</TabsTrigger>
          <TabsTrigger value="allocation"      className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">5 · Allocation</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <OverviewTab
            result={result}
            loading={loadingResult}
            hasData={hasData}
            validationRan={validationRequested && !!bt}
            bt={bt}
            onNavigate={(tab) => {
              if (tab === "regimes" || tab === "factors") setActiveTab("factors-regimes");
              else if (tab === "constraints") setActiveTab("allocation");
              else setActiveTab(tab);
            }}
          />
        </TabsContent>

        <TabsContent value="factors-regimes" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
          <PreparedInputsPanel b2Mode={b2Mode} onB2ModeChange={setB2Mode} onPreparedSelectionChange={handleB2PreparedSelection} />
          <FactorsRegimesTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="models" className="space-y-6 pt-4">
          <ModelsTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="backtest" className="space-y-6 pt-4">
          {b2Mode
            ? <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>Historical validation is unavailable for B2 as-of allocations. No legacy backtest has been run for this allocation policy.</AlertDescription></Alert>
            : <BacktestTab
              bt={bt}
              loading={loadingBt || isValidating}
              hasData={hasData}
              hasRun={hasRun}
              validationRequested={validationRequested}
              validationRun={savedValidation?.strategySnapshotId === result?.sessionId ? savedValidation : undefined}
              validationRuns={validationRuns ?? []}
              selectedValidationRunId={visibleValidationRunId}
              onSelectValidationRun={(id) => setSelectedValidationRunId(id)}
              validationError={validationError}
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
        </TabsContent>

        <TabsContent value="allocation" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden">
          {b2Mode
            ? <B2AllocationPanel prepared={b2Prepared} runToken={b2RunToken} onRunningChange={setB2Running} />
            : <AllocationTab result={result} constraints={constraints} hasData={hasData} hasRun={hasRun} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
