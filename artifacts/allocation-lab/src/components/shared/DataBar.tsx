import { Link } from "wouter";
import { useGetPricesStatus } from "@workspace/api-client-react";
import { CheckCircle2, AlertCircle, RefreshCw, Upload } from "lucide-react";

export function DataBar() {
  const { data: pricesStatus, isLoading } = useGetPricesStatus();
  const hasData = !!pricesStatus?.hasData;

  if (isLoading) return null;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 text-xs border-b shrink-0 ${
        hasData ? "bg-gray-50 border-gray-200 text-gray-600" : "bg-destructive/5 border-destructive/20 text-destructive-foreground"
      }`}
    >
      {hasData ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
      )}
      <span className="font-medium truncate">
        {hasData ? `Data valid through ${pricesStatus?.endDate}` : "No price data loaded"}
      </span>
      {hasData && (
        <span className="text-gray-400 hidden sm:inline truncate">
          · {pricesStatus?.rowCount} rows · {pricesStatus?.tickers.length} tickers
        </span>
      )}
      <span className="ml-auto flex items-center gap-3 shrink-0">
        <Link href="/settings" className="inline-flex items-center gap-1 hover:underline font-medium text-primary">
          <RefreshCw className="h-3 w-3" /> Refresh
        </Link>
        <Link href="/settings" className="inline-flex items-center gap-1 hover:underline font-medium text-primary">
          <Upload className="h-3 w-3" /> Upload
        </Link>
      </span>
    </div>
  );
}
