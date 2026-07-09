import { useState, useRef, useEffect } from "react";
import { useGetUniverse, useUpdateUniverse, useGetConstraints, useUpdateConstraints, useGetPricesStatus, useUploadPrices, useFetchLivePrices } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Loader2, Save, Upload, CheckCircle2, AlertCircle, RefreshCw, WifiOff, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function PortfolioConstruction() {
  const { toast } = useToast();
  
  // Universe State
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

  // Constraints State
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

  // Prices State
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

  if (loadingUniverse || loadingConstraints) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Portfolio Construction</h1>
        <p className="text-muted-foreground mt-2">Configure ETF universe, set constraints, and manage price data.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* ETF Universe Panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>ETF Universe & Prior Weights</CardTitle>
            <CardDescription>Select which ETFs to include and define their prior month allocations.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
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
                      <TableCell className="font-medium">
                        <Link
                          href={`/etf/${etf.ticker}`}
                          className="inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group"
                        >
                          {etf.ticker}
                          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </Link>
                      </TableCell>
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
          </CardContent>
          <CardFooter className="justify-end border-t bg-gray-50/50 py-4">
            <Button onClick={handleSaveUniverse} disabled={updateUniverse.isPending}>
              {updateUniverse.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Universe
            </Button>
          </CardFooter>
        </Card>

        {/* Constraints Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Allocation Constraints</CardTitle>
            <CardDescription>Rules enforced during portfolio construction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {localConstraints && (
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
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end border-t bg-gray-50/50 py-4">
            <Button onClick={handleSaveConstraints} disabled={updateConstraints.isPending}>
              {updateConstraints.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Constraints
            </Button>
          </CardFooter>
        </Card>

        {/* Price Data Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Price Data Source</CardTitle>
            <CardDescription>Download live market data or upload a CSV file.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Current data status */}
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

            {/* Live fetch section */}
            <div className="space-y-3">
              <div>
                <Label className="text-base">Refresh Market Data</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Downloads adjusted close prices for all enabled ETFs from Yahoo Finance
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
                className="w-full"
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

              {/* Live fetch result */}
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

            {/* CSV upload */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                CSV format: First column "Date" (YYYY-MM-DD), remaining columns are ticker symbols.
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

      </div>
    </div>
  );
}
