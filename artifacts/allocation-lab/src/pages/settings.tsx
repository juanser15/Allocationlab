import { useState, useRef, useEffect } from "react";
import {
  useGetUniverse, useUpdateUniverse, useGetPricesStatus, useUploadPrices, useFetchLivePrices,
  useGetConstraints, useUpdateConstraints,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Save, Upload, CheckCircle2, AlertCircle, RefreshCw, WifiOff, ExternalLink, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";

function EtfLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/etf/${ticker}`} className="inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group">
      {ticker}
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

const cycles = [
  { id: 1, label: "Core UI scaffold & navigation", done: true },
  { id: 2, label: "Price data upload & Yahoo Finance integration", done: true },
  { id: 3, label: "Factor computation engine (8 factors)", done: true },
  { id: 4, label: "Regime estimation & allocation constructor", done: true },
  { id: 5, label: "Results dashboard with factor heatmap", done: true },
  { id: 6, label: "Report generation (CSV + PDF)", done: true },
  { id: 7, label: "Session history & reporting", done: true },
  { id: 8, label: "10-component Market Health module + IC Summary + Watchlist", done: true },
  { id: 9, label: "Portfolio Diagnostics (vol, HHI, ENB, risk contributions, correlation heatmap, tracking error)", done: true },
  { id: 10, label: "ETF Explorer (price chart, factor breakdown, score history, IC narrative, clickable links)", done: true },
  { id: 11, label: "Backtesting workspace (equity curve, return/vol/Sharpe/drawdown/turnover, monthly returns, benchmark comparison, contribution summary)", done: true },
  { id: 12, label: "Committee report builder (editable one-page report, preview mode, polished PDF/PNG export, quality checklist)", done: true },
  { id: 13, label: "PM Decision Room with structured recommendation cards and an auditable Decision Log", done: true },
  { id: 14, label: "Historical Archive workspace (browse prior rebalances, side-by-side comparison with turnover & realized return, filters, PDF/PNG/CSV export)", done: true },
  { id: 15, label: "Bias-resistant backtester (execution timing/costs/slippage, walk-forward testing, sensitivity checks, bias audit checklist, Integrity Score)", done: true },
  { id: 16, label: "AI Investment Committee reasoning layer (deterministic persona debate + CIO synthesis + exportable memo, zero fabrication)", done: true },
  { id: 17, label: "Navigation reorganized into a clear 7-section hierarchy with an interactive, as-of-date Dashboard", done: true },
  { id: 18, label: "Reorganized into a strict 12-stage workflow dependency model (5 modules, gated empty-states, gear-icon Settings)", done: true },
  { id: 19, label: "Scenario & Stress Lab (historical and hypothetical macro shock scenarios)", done: false },
  { id: 20, label: "Trade Implementation (order staging, execution scheduling, broker-ready trade tickets)", done: false },
  { id: 21, label: "Attribution Engine (return decomposition by factor, sector, and selection vs. allocation)", done: false },
  { id: 22, label: "Production Governance (audit trails, approval workflows, role-based access controls)", done: false },
];
const CURRENT_ITERATION = 13;
const MAX_ITERATIONS = 15;

export default function Settings() {
  const { toast } = useToast();

  // Universe & prior weights
  const { data: universe, isLoading: loadingUniverse } = useGetUniverse();
  const updateUniverse = useUpdateUniverse();
  const [etfs, setEtfs] = useState<any[]>([]);
  const [cashPriorWeight, setCashPriorWeight] = useState(0.54);
  const universeInitialized = useRef(false);

  useEffect(() => {
    if (universe && !universeInitialized.current) {
      setEtfs([...universe.etfs]);
      setCashPriorWeight(universe.cashPriorWeight);
      universeInitialized.current = true;
    }
  }, [universe]);

  const handleEtfChange = (index: number, field: string, value: any) => {
    const newEtfs = [...etfs];
    newEtfs[index] = { ...newEtfs[index], [field]: value };
    setEtfs(newEtfs);
  };

  const handleSaveUniverse = () => {
    updateUniverse.mutate(
      { data: { etfs, cashPriorWeight } },
      {
        onSuccess: () => toast({ title: "Universe saved successfully" }),
        onError: () => toast({ title: "Error saving universe", variant: "destructive" })
      }
    );
  };

  // Constraints
  const { data: constraints, isLoading: loadingConstraints } = useGetConstraints();
  const updateConstraints = useUpdateConstraints();
  const [localConstraints, setLocalConstraints] = useState<any>(null);
  const constraintsInitialized = useRef(false);

  useEffect(() => {
    if (constraints && !constraintsInitialized.current) {
      setLocalConstraints({ ...constraints });
      constraintsInitialized.current = true;
    }
  }, [constraints]);

  const handleConstraintChange = (field: string, value: any) => {
    setLocalConstraints((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSaveConstraints = () => {
    if (!localConstraints) return;
    updateConstraints.mutate(
      { data: localConstraints },
      {
        onSuccess: () => toast({ title: "Constraints saved successfully" }),
        onError: () => toast({ title: "Error saving constraints", variant: "destructive" })
      }
    );
  };

  // Price data
  const { data: pricesStatus, isLoading: loadingPrices, refetch: refetchPrices } = useGetPricesStatus();
  const uploadPrices = useUploadPrices();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [liveResult, setLiveResult] = useState<any>(null);
  const fetchLivePrices = useFetchLivePrices();
  const [fetchStartDate, setFetchStartDate] = useState<string>("");
  const [fetchEndDate, setFetchEndDate] = useState<string>("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvContent = event.target?.result as string;
      uploadPrices.mutate(
        { data: { csvContent } },
        {
          onSuccess: () => {
            toast({ title: "Prices uploaded successfully" });
            refetchPrices();
            setLiveResult(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          },
          onError: (err: any) => {
            toast({ title: "Error uploading prices", description: err.message || "Failed to process CSV", variant: "destructive" });
          }
        }
      );
    };
    reader.readAsText(file);
  };

  const handleRefreshMarketData = () => {
    setLiveResult(null);
    fetchLivePrices.mutate(
      {
        data: {
          ...(fetchStartDate ? { startDate: fetchStartDate } : {}),
          ...(fetchEndDate ? { endDate: fetchEndDate } : {}),
          ...(fetchStartDate || fetchEndDate ? {} : { lookbackDays: 400 }),
        },
      },
      {
        onSuccess: (data: any) => {
          setLiveResult(data);
          if (data.savedToDb) {
            refetchPrices();
            toast({ title: "Market data refreshed", description: data.message });
          } else {
            toast({ title: "Partial download", description: data.message, variant: "destructive" });
          }
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.message || err?.message || "Failed to fetch live prices";
          setLiveResult({ error: msg });
          toast({ title: "Download failed", description: msg, variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        section="Settings"
        title="Settings"
        description="Define the ETF universe and prior weights, allocation constraints, price data source, benchmark, and cost assumptions that power every run. This module sits outside the main workflow sequence."
      />

      <Tabs defaultValue="universe">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="universe">Universe & Prior Weights</TabsTrigger>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
          <TabsTrigger value="data">Data Source</TabsTrigger>
          <TabsTrigger value="benchmark">Benchmark & Costs</TabsTrigger>
          <TabsTrigger value="methodology">Methodology & Roadmap</TabsTrigger>
        </TabsList>

        {/* ── Universe ── */}
        <TabsContent value="universe" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>ETF Universe & Prior Weights</CardTitle>
              <CardDescription>Select which ETFs to include and define their prior month allocations.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUniverse ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : (
                <div className="border rounded-md overflow-hidden overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead className="w-16">Enabled</TableHead>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Sector</TableHead>
                        <TableHead className="w-32 text-right">Prior Weight (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {etfs.map((etf, idx) => (
                        <TableRow key={etf.ticker} className={etf.enabled ? "" : "opacity-50"}>
                          <TableCell>
                            <Switch
                              checked={etf.enabled}
                              onCheckedChange={(c) => handleEtfChange(idx, "enabled", c)}
                            />
                          </TableCell>
                          <TableCell className="font-medium"><EtfLink ticker={etf.ticker} /></TableCell>
                          <TableCell>{etf.name}</TableCell>
                          <TableCell>{etf.sector}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.1"
                              className="w-24 ml-auto text-right"
                              value={(etf.priorWeight * 100).toFixed(1)}
                              onChange={(e) => handleEtfChange(idx, "priorWeight", parseFloat(e.target.value) / 100)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-gray-50 font-medium">
                        <TableCell colSpan={4} className="text-right">Cash Reserve</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.1"
                            className="w-24 ml-auto text-right"
                            value={(cashPriorWeight * 100).toFixed(1)}
                            onChange={(e) => setCashPriorWeight(parseFloat(e.target.value) / 100)}
                          />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-end border-t bg-gray-50/50 py-4">
              <Button onClick={handleSaveUniverse} disabled={updateUniverse.isPending}>
                {updateUniverse.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Universe
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Constraints ── */}
        <TabsContent value="constraints" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Allocation Constraints</CardTitle>
              <CardDescription>Rules enforced during portfolio construction. See the resulting allocation in Portfolio Lab.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {loadingConstraints || !localConstraints ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Cash Range (%)</Label>
                      <span className="text-sm font-medium">{(localConstraints.cashMin * 100).toFixed(1)}% - {(localConstraints.cashMax * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Input
                        type="number"
                        className="w-24"
                        value={(localConstraints.cashMin * 100).toFixed(1)}
                        onChange={(e) => handleConstraintChange("cashMin", parseFloat(e.target.value) / 100)}
                      />
                      <span className="text-muted-foreground">to</span>
                      <Input
                        type="number"
                        className="w-24"
                        value={(localConstraints.cashMax * 100).toFixed(1)}
                        onChange={(e) => handleConstraintChange("cashMax", parseFloat(e.target.value) / 100)}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Max Single ETF Weight (%)</Label>
                      <span className="text-sm font-medium">{(localConstraints.maxEtfWeight * 100).toFixed(1)}%</span>
                    </div>
                    <Slider
                      value={[localConstraints.maxEtfWeight * 100]}
                      min={1} max={30} step={1}
                      onValueChange={(v) => handleConstraintChange("maxEtfWeight", v[0] / 100)}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Min Inclusion Threshold (Score)</Label>
                      <span className="text-sm font-medium">{localConstraints.minInclusionThreshold} pts</span>
                    </div>
                    <Slider
                      value={[localConstraints.minInclusionThreshold]}
                      min={0} max={50} step={1}
                      onValueChange={(v) => handleConstraintChange("minInclusionThreshold", v[0])}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Target Active ETFs</Label>
                      <span className="text-sm font-medium">{localConstraints.targetActiveEtfs}</span>
                    </div>
                    <Slider
                      value={[localConstraints.targetActiveEtfs]}
                      min={1} max={20} step={1}
                      onValueChange={(v) => handleConstraintChange("targetActiveEtfs", v[0])}
                    />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="space-y-0.5">
                      <Label>Sector Diversification</Label>
                      <p className="text-sm text-muted-foreground">Prevent over-concentration in a single sector</p>
                    </div>
                    <Switch
                      checked={localConstraints.diversificationEnabled}
                      onCheckedChange={(c) => handleConstraintChange("diversificationEnabled", c)}
                    />
                  </div>

                  <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                    <span>
                      Factor weights (momentum, trend quality, realized volatility, drawdown, mean reversion) are fixed by
                      the model methodology and are not user-adjustable. See the full definitions in the{" "}
                      <span className="font-medium">Methodology & Roadmap</span> tab above.
                    </span>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="justify-end border-t bg-gray-50/50 py-4">
              <Button onClick={handleSaveConstraints} disabled={updateConstraints.isPending || !localConstraints}>
                {updateConstraints.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Constraints
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Data Source ── */}
        <TabsContent value="data" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Price Data Source</CardTitle>
              <CardDescription>Download live market data from Yahoo Finance or upload a CSV file. All factor and regime scores are computed from this data — nothing is simulated.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!loadingPrices && pricesStatus && (
                <div className={`p-4 rounded-md border ${pricesStatus.hasData ? 'bg-green-50/50 border-green-100' : 'bg-amber-50/50 border-amber-100'}`}>
                  <div className="flex items-start">
                    {pricesStatus.hasData ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
                    )}
                    <div>
                      <h4 className={`font-medium ${pricesStatus.hasData ? 'text-green-900' : 'text-amber-900'}`}>
                        {pricesStatus.message}
                      </h4>
                      {pricesStatus.hasData && (
                        <div className="mt-2 text-sm text-gray-600 space-y-1">
                          <p><strong>Date Range:</strong> {pricesStatus.startDate} to {pricesStatus.endDate}</p>
                          <p><strong>Records:</strong> {pricesStatus.rowCount} daily rows</p>
                          <p><strong>Coverage:</strong> {pricesStatus.tickers.length} tickers found</p>
                        </div>
                      )}
                      {pricesStatus.missingTickers.length > 0 && (
                        <div className="mt-3 text-sm">
                          <p className="text-destructive font-medium">Missing data for requested ETFs:</p>
                          <p className="text-gray-600">{pricesStatus.missingTickers.join(', ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <Label className="text-base">Refresh Market Data (Yahoo Finance)</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Downloads adjusted close prices for all enabled ETFs
                    {fetchStartDate || fetchEndDate ? " for the selected date range." : " (last 400 days by default)."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={fetchStartDate}
                      max={fetchEndDate || undefined}
                      onChange={(e) => setFetchStartDate(e.target.value)}
                      className="h-8 text-sm w-[150px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={fetchEndDate}
                      min={fetchStartDate || undefined}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setFetchEndDate(e.target.value)}
                      className="h-8 text-sm w-[150px]"
                    />
                  </div>
                  {(fetchStartDate || fetchEndDate) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground self-end"
                      onClick={() => { setFetchStartDate(""); setFetchEndDate(""); }}
                    >
                      Use default (last 400 days)
                    </Button>
                  )}
                </div>
                <Button
                  onClick={handleRefreshMarketData}
                  disabled={fetchLivePrices.isPending}
                  variant="default"
                  className="w-full sm:w-auto"
                >
                  {fetchLivePrices.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Downloading from Yahoo Finance...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Market Data
                    </>
                  )}
                </Button>

                {liveResult && !fetchLivePrices.isPending && (
                  <div className={`p-3 rounded-md border text-sm ${
                    liveResult.error
                      ? 'bg-red-50 border-red-100'
                      : liveResult.savedToDb
                      ? 'bg-green-50 border-green-100'
                      : 'bg-amber-50 border-amber-100'
                  }`}>
                    {liveResult.error ? (
                      <div className="flex items-start gap-2">
                        <WifiOff className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-red-900">Download failed</p>
                          <p className="text-red-700 mt-0.5">{liveResult.error}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        {liveResult.savedToDb ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="space-y-1">
                          <p className={`font-medium ${liveResult.savedToDb ? 'text-green-900' : 'text-amber-900'}`}>
                            {liveResult.message}
                          </p>
                          {liveResult.totalRows > 0 && (
                            <p className="text-gray-600">
                              {liveResult.startDate} to {liveResult.endDate} &middot; {liveResult.totalRows} rows
                            </p>
                          )}
                          {liveResult.failed?.length > 0 && (
                            <p className="text-gray-500">
                              Skipped: {liveResult.failed.map((f: any) => f.ticker).join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">or upload CSV</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  CSV format: First column "Date" (YYYY-MM-DD), remaining columns are ticker symbols. Minimum 21 rows required.
                </div>
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept=".csv"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    disabled={uploadPrices.isPending}
                    className="hidden"
                    id="csv-upload"
                  />
                  <Label
                    htmlFor="csv-upload"
                    className={`flex-1 border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-gray-50 transition-colors ${uploadPrices.isPending ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <span className="text-sm font-medium text-gray-900">Click to select CSV file</span>
                  </Label>
                </div>
                {uploadPrices.isPending && (
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing price data...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Benchmark & Costs ── */}
        <TabsContent value="benchmark" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Benchmark & Trading Costs</CardTitle>
              <CardDescription>How benchmark tracking and execution cost assumptions are configured.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                <span>
                  Benchmarks (SPY, QQQ, IWM, VTI, AGG, EFA, GLD) are auto-detected from ticker columns in your uploaded
                  price data — no separate benchmark selection is needed. Add one of these tickers to your CSV or live
                  fetch to unlock tracking error, shown in{" "}
                  <Link href="/market-monitor" className="underline font-medium text-primary">Market Monitor</Link>.
                </span>
              </div>
              <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                <span>
                  Execution timing, transaction cost (bps), and rebalance frequency assumptions used for backtest
                  simulation are configured directly in{" "}
                  <Link href="/research-lab" className="underline font-medium text-primary">Research Lab</Link>,
                  where you can immediately see their effect on returns and Sharpe ratio.
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Methodology ── */}
        <TabsContent value="methodology" className="pt-4 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-8">
              <section className="space-y-4">
                <h2 className="text-xl font-bold text-primary border-b pb-2">Factor Definitions</h2>
                <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
                  <div>
                    <h3 className="font-bold text-gray-900">Momentum (20d, 60d, 120d, 252d)</h3>
                    <p>Standard price return over the specified lookback window. Captures multiple timeframes to smooth short-term noise while maintaining responsiveness to trend shifts.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Trend Quality</h3>
                    <p>R² of the price series versus a linear regression line. Penalizes volatile, jagged trends and rewards smooth, persistent price movement.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Realized Volatility (60d)</h3>
                    <p>Inverse of the annualized standard deviation of daily returns over 60 days. Higher scores indicate lower volatility (a positive signal for inclusion).</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Drawdown</h3>
                    <p>Current price relative to the 252-day high. Higher scores indicate smaller drawdowns from peak.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Short-term Mean Reversion</h3>
                    <p>Deviation of price from the 10-day moving average. Used as a short-term timing adjustment to avoid buying extended spikes.</p>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <h2 className="text-xl font-bold text-primary border-b pb-2">Workflow Dependency Model</h2>
                <p className="text-sm text-gray-700">
                  Every module is gated by the real backend state of the prior step, so outputs never appear before the
                  run that generates them. Diagnostics specifically wait on their generating run — e.g. Backtest
                  Diagnostics never renders until a backtest with sufficient data has actually completed.
                </p>
                <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                  <li>No Data</li>
                  <li>Data Loaded</li>
                  <li>Committee Run</li>
                  <li>Market Health</li>
                  <li>Portfolio Construction</li>
                  <li>Backtest Run</li>
                  <li>Backtest Diagnostics</li>
                  <li>Decision Draft</li>
                  <li>AI Committee</li>
                  <li>Approval</li>
                  <li>Report</li>
                  <li>Archived</li>
                </ol>
              </section>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Build Progress</CardTitle>
                  <CardDescription>Iteration {CURRENT_ITERATION} of {MAX_ITERATIONS}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
                  {cycles.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-sm">
                      {c.done ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-gray-300 shrink-0 mt-0.5" />
                      )}
                      <span className={c.done ? "text-gray-800" : "text-gray-400"}>{c.label}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
