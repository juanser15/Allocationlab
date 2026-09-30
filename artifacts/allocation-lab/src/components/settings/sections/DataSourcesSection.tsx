import { useState, useRef, useEffect } from "react";
import { useGetPricesStatus, useUploadPrices, useFetchLivePrices } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function DataSourcesSection() {
  const { toast } = useToast();
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
            if (fileInputRef.current) fileInputRef.current.value = "";
          },
          onError: (err: any) => {
            toast({ title: "Error uploading prices", description: err.message || "Failed to process CSV", variant: "destructive" });
          },
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
        },
      }
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900">Data Sources</h3>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          Download live market data from Yahoo Finance or upload a CSV file. All factor and regime scores are computed
          directly from this data — nothing is simulated.
        </p>
      </div>

      {!loadingPrices && pricesStatus && (
        <div className={`p-4 rounded-md border ${pricesStatus.hasData ? "bg-green-50/50 border-green-100" : "bg-amber-50/50 border-amber-100"}`}>
          <div className="flex items-start">
            {pricesStatus.hasData ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
            )}
            <div>
              <h4 className={`font-medium ${pricesStatus.hasData ? "text-green-900" : "text-amber-900"}`}>
                {pricesStatus.message}
              </h4>
              {pricesStatus.hasData && (
                <div className="mt-2 text-sm text-gray-600 space-y-1">
                  <p><strong>Date Range:</strong> {pricesStatus.startDate} to {pricesStatus.endDate}</p>
                  <p><strong>Latest Data:</strong> {pricesStatus.endDate}</p>
                  <p><strong>Records:</strong> {pricesStatus.rowCount} daily rows</p>
                  <p><strong>Coverage:</strong> {pricesStatus.tickers.length} tickers found</p>
                </div>
              )}
              {pricesStatus.missingTickers.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="text-destructive font-medium">Missing data for requested ETFs:</p>
                  <p className="text-gray-600">{pricesStatus.missingTickers.join(", ")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Refresh Market Data (Yahoo Finance)</Label>
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
        <Button onClick={handleRefreshMarketData} disabled={fetchLivePrices.isPending} variant="default" className="w-full sm:w-auto">
          {fetchLivePrices.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Downloading from Yahoo Finance...</>
          ) : (
            <><RefreshCw className="mr-2 h-4 w-4" />Refresh Market Data</>
          )}
        </Button>

        {liveResult && !fetchLivePrices.isPending && (
          <div className={`p-3 rounded-md border text-sm ${liveResult.error ? "bg-red-50 border-red-100" : liveResult.savedToDb ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}`}>
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
                  <p className={`font-medium ${liveResult.savedToDb ? "text-green-900" : "text-amber-900"}`}>{liveResult.message}</p>
                  {liveResult.totalRows > 0 && (
                    <p className="text-gray-600">{liveResult.startDate} to {liveResult.endDate} &middot; {liveResult.totalRows} rows</p>
                  )}
                  {liveResult.failed?.length > 0 && (
                    <p className="text-gray-500">Skipped: {liveResult.failed.map((f: any) => f.ticker).join(", ")}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-muted-foreground">or upload CSV</span></div>
      </div>

      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          CSV format: legacy adjusted closes as Date and ticker columns, or adjusted OHLC rows as Date,Ticker,Open,High,Low,Close. Minimum 21 trading dates required. OHLC must be on the same adjusted price scale; raw opens cannot be mixed with adjusted closes.
        </div>
        <div className="flex items-center gap-4">
          <Input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleFileUpload}
            disabled={uploadPrices.isPending}
            className="hidden"
            id="csv-upload-drawer"
          />
          <Label
            htmlFor="csv-upload-drawer"
            className={`flex-1 border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-gray-50 transition-colors ${uploadPrices.isPending ? "opacity-50 pointer-events-none" : ""}`}
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
    </div>
  );
}
