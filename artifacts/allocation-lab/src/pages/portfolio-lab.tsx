import { useState } from "react";
import {
  useGetLatestResults, useGetPricesStatus, useGetConstraints,
  useRunPipeline, useGetBacktest, useGetRiskModel, useCreateGovernanceSnapshot,
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
import { FactorsTab } from "@/components/portfolio-lab/FactorsTab";
import { RegimesTab } from "@/components/portfolio-lab/RegimesTab";
import { ModelsTab } from "@/components/portfolio-lab/ModelsTab";
import { BacktestTab } from "@/components/portfolio-lab/BacktestTab";
import { RobustnessTab } from "@/components/portfolio-lab/RobustnessTab";
import { ConstraintsTab } from "@/components/portfolio-lab/ConstraintsTab";
import { FinalAllocationTab } from "@/components/portfolio-lab/FinalAllocationTab";

export default function PortfolioLab() {
  const { openSettings } = useSettingsDrawer();
  const [activeTab, setActiveTab] = useState("overview");

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
  const [validationRequested, setValidationRequested] = useState(false);

  const { data: bt, isLoading: loadingBt, refetch: refetchBt } = useGetBacktest(
    {
      ...(btBenchmark !== "none" ? { benchmark: btBenchmark } : {}),
      rebalanceFrequency: btFrequency,
      executionTiming: btTiming,
      transactionCostBps: btTxnCostBps,
      slippageBps: btSlippageBps,
      cashYieldAnnual: btCashYield / 100,
      ...(btStartDate ? { startDate: btStartDate } : {}),
      ...(btEndDate ? { endDate: btEndDate } : {}),
    },
    { query: { enabled: hasData && validationRequested } as any },
  );

  const handleRunOptimizer = () => {
    runPipeline.mutate(
      { data: {} },
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

  const handleRunValidation = () => {
    setValidationRequested(true);
    setActiveTab("backtest");
    refetchBt();
  };

  const isRunning = runPipeline.isPending;
  const isValidating = loadingBt && validationRequested;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        section="2 · Portfolio Lab"
        title="Optimizer Pro"
        description="Systematic multi-factor portfolio optimizer. Run Optimizer generates the recommended allocation. Run Validation executes the historical backtest, walk-forward validation, and robustness framework."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunValidation}
              disabled={!hasRun || isValidating}
            >
              {isValidating
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Validating…</>
                : <><FlaskConical className="mr-2 h-3.5 w-3.5" /> Run Validation</>
              }
            </Button>
            <Button
              size="sm"
              onClick={handleRunOptimizer}
              disabled={!hasData || isRunning}
            >
              {isRunning
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                : <><Play className="mr-2 h-3.5 w-3.5" /> Run Optimizer</>
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
          <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">1 · Overview</TabsTrigger>
          <TabsTrigger value="factors" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">2 · Factors</TabsTrigger>
          <TabsTrigger value="regimes" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">3 · Regimes</TabsTrigger>
          <TabsTrigger value="models" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">4 · Models</TabsTrigger>
          <TabsTrigger value="backtest" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">5 · Backtest</TabsTrigger>
          <TabsTrigger value="robustness" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">6 · Robustness</TabsTrigger>
          <TabsTrigger value="constraints" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">7 · Constraints</TabsTrigger>
          <TabsTrigger value="allocation" className="text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">8 · Final Allocation</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <OverviewTab
            result={result}
            loading={loadingResult}
            hasData={hasData}
            validationRan={validationRequested && !!bt}
            bt={bt}
            onNavigate={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="factors" className="space-y-6 pt-4">
          <FactorsTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="regimes" className="space-y-6 pt-4">
          <RegimesTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="models" className="space-y-6 pt-4">
          <ModelsTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>

        <TabsContent value="backtest" className="space-y-6 pt-4">
          <BacktestTab
            bt={bt}
            loading={loadingBt}
            hasData={hasData}
            hasRun={hasRun}
            validationRequested={validationRequested}
            onRunValidation={handleRunValidation}
            benchmark={btBenchmark} setBenchmark={setBtBenchmark}
            frequency={btFrequency} setFrequency={setBtFrequency}
            timing={btTiming} setTiming={setBtTiming}
            txnCostBps={btTxnCostBps} setTxnCostBps={setBtTxnCostBps}
            slippageBps={btSlippageBps} setSlippageBps={setBtSlippageBps}
            cashYield={btCashYield} setCashYield={setBtCashYield}
            startDate={btStartDate} setStartDate={setBtStartDate}
            endDate={btEndDate} setEndDate={setBtEndDate}
          />
        </TabsContent>

        <TabsContent value="robustness" className="space-y-6 pt-4">
          <RobustnessTab
            bt={bt}
            hasRun={hasRun}
            validationRan={validationRequested && !!bt}
            onRunValidation={handleRunValidation}
          />
        </TabsContent>

        <TabsContent value="constraints" className="space-y-6 pt-4">
          <ConstraintsTab result={result} constraints={constraints} hasRun={hasRun} hasData={hasData} />
        </TabsContent>

        <TabsContent value="allocation" className="space-y-6 pt-4">
          <FinalAllocationTab result={result} hasData={hasData} hasRun={hasRun} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
