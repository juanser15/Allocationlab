import { useEffect, useState } from "react";
import { useGetTradeImplementationMeta, useGetTradeImplementation } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeftRight, Download, Info, AlertTriangle, XCircle } from "lucide-react";
import { useSettingsDrawer } from "@/context/settings-drawer-context";
import { localSettings } from "@/lib/local-settings";

const AUM_KEY = "allocation-lab.trade-implementation.aumUsd";

function loadAum(): number {
  try {
    const raw = localStorage.getItem(AUM_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    return !isNaN(n) && n > 0 ? n : 10_000_000;
  } catch {
    return 10_000_000;
  }
}

function usd(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct1(n: number) {
  return `${n.toFixed(1)}%`;
}

function actionBadge(action: string) {
  const map: Record<string, string> = {
    NEW: "bg-blue-50 text-blue-700 border-blue-200",
    BUY: "bg-green-50 text-green-700 border-green-200",
    SELL: "bg-amber-50 text-amber-700 border-amber-200",
    REMOVE: "bg-red-50 text-red-700 border-red-200",
    HOLD: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return <Badge variant="outline" className={map[action] ?? ""}>{action}</Badge>;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function TradeImplementationSection() {
  const { openSettings } = useSettingsDrawer();
  const { data: meta, isLoading: loadingMeta } = useGetTradeImplementationMeta();
  const [aumInput, setAumInput] = useState<string>(() => String(loadAum()));
  const assumptions = localSettings.getExecutionAssumptions();

  const aumUsd = parseFloat(aumInput);
  const validAum = !isNaN(aumUsd) && aumUsd > 0;

  useEffect(() => {
    if (validAum) localStorage.setItem(AUM_KEY, String(aumUsd));
  }, [aumUsd, validAum]);

  const { data: trade, isLoading: loadingTrade, isError } = useGetTradeImplementation(
    {
      aumUsd: validAum ? aumUsd : 0,
      executionTiming: assumptions.executionTiming,
      transactionCostBps: assumptions.transactionCostBps,
      slippageBps: assumptions.slippageBps,
      cashYieldAnnualPct: assumptions.cashYieldAnnualPct,
      rebalanceFrequency: assumptions.rebalanceFrequency,
      minTradeSizeUsd: assumptions.minTradeSizeUsd,
    },
    { query: { enabled: !!meta?.ready && validAum } as any }
  );

  const handleExportCsv = () => {
    if (!trade) return;
    const rows: string[][] = [
      ["Ticker", "Name", "Sector", "Action", "Current Weight %", "Target Weight %", "Delta Weight %", "Latest Price", "Est. Shares", "Est. $ Trade", "Est. Cost $", "Below Min Trade Size", "Violates Max Weight", "Liquidity/ADV", "Warnings"],
      ...trade.trades.map((t) => [
        t.ticker, t.name, t.sector, t.action,
        t.currentWeight.toFixed(2), t.targetWeight.toFixed(2), t.deltaWeight.toFixed(2),
        t.latestPrice !== null ? t.latestPrice.toFixed(2) : "N/A",
        t.estimatedShares !== null ? String(t.estimatedShares) : "N/A",
        t.estimatedTradeUsd.toFixed(2), t.estimatedCostUsd.toFixed(2),
        t.belowMinTradeSize ? "YES" : "NO",
        t.violatesMaxWeight ? "YES" : "NO",
        "Unavailable — no volume data uploaded",
        t.warnings.join("; "),
      ]),
      [],
      ["Cash", "", "", trade.cash.cashImpactUsd >= 0 ? "SELL-FUNDED" : "BUY-FUNDED",
        trade.cash.currentWeight.toFixed(2), trade.cash.targetWeight.toFixed(2), "",
        "", "", trade.cash.cashImpactUsd.toFixed(2), "", "", "", "", ""],
    ];
    downloadCsv(`trade-blotter-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" /> Trade Implementation
        </CardTitle>
        <CardDescription>
          Converts current → target weights into an actionable trade list at your entered AUM. Execution assumptions come from the{" "}
          <button onClick={() => openSettings("execution")} className="underline font-medium text-primary">Settings drawer</button>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingMeta ? (
          <p className="text-sm text-muted-foreground py-2">Checking readiness…</p>
        ) : !meta?.ready ? (
          <p className="text-sm text-muted-foreground py-2">
            {meta?.reason ?? "Run the rebalance pipeline before generating a trade list."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5 w-48">
                <Label htmlFor="aum">Portfolio AUM ($)</Label>
                <Input id="aum" type="number" min={0} value={aumInput} onChange={(e) => setAumInput(e.target.value)} placeholder="10000000" />
              </div>
              <div className="text-xs text-muted-foreground pb-2 space-x-3">
                <span>Timing: {assumptions.executionTiming === "next_open" ? "Next open" : "Next close"}</span>
                <span>Txn cost: {assumptions.transactionCostBps}bps</span>
                <span>Slippage: {assumptions.slippageBps}bps</span>
                <span>Min trade: {usd(assumptions.minTradeSizeUsd)}</span>
                <span>Rebalance: {assumptions.rebalanceFrequency}</span>
              </div>
            </div>

            {!validAum ? (
              <p className="text-sm text-muted-foreground py-2">Enter a positive portfolio AUM to size the trade list in dollars.</p>
            ) : loadingTrade ? (
              <p className="text-sm text-muted-foreground py-2">Computing trade list…</p>
            ) : isError || !trade ? (
              <Alert variant="destructive">
                <AlertDescription>Could not compute the trade list. Confirm starting weights are configured in Settings.</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Est. turnover</p>
                    <p className="font-semibold text-gray-900">{pct1(trade.turnoverPct)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Gross trade $</p>
                    <p className="font-semibold text-gray-900">{usd(trade.grossTradeUsd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Est. cost (txn+slip)</p>
                    <p className="font-semibold text-gray-900">{usd(trade.estimatedTotalCostUsd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Post-trade cash</p>
                    <p className="font-semibold text-gray-900">{usd(trade.cash.postTradeCashUsd)} <span className="text-xs text-muted-foreground">(target {usd(trade.cash.targetUsd)})</span></p>
                  </div>
                </div>

                {trade.warnings.length > 0 && (
                  <div className="space-y-1.5">
                    {trade.warnings.map((w) => (
                      <div key={w.id} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${w.severity === "fail" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                        {w.severity === "fail" ? <XCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                        <span>{w.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Target</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                        <TableHead className="text-right">Est. Shares</TableHead>
                        <TableHead className="text-right">Est. $ Trade</TableHead>
                        <TableHead>Liquidity/ADV</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trade.trades.filter((t) => t.action !== "HOLD" || t.warnings.length > 0).map((t) => (
                        <TableRow key={t.ticker} className={t.belowMinTradeSize ? "opacity-60" : ""}>
                          <TableCell className="font-medium">{t.ticker}</TableCell>
                          <TableCell>{actionBadge(t.action)}{t.belowMinTradeSize && <span className="ml-1.5 text-[10px] text-muted-foreground">below min</span>}</TableCell>
                          <TableCell className="text-right">{pct1(t.currentWeight)}</TableCell>
                          <TableCell className="text-right">{pct1(t.targetWeight)}</TableCell>
                          <TableCell className={`text-right ${t.deltaWeight > 0 ? "text-green-700" : t.deltaWeight < 0 ? "text-red-700" : ""}`}>{t.deltaWeight > 0 ? "+" : ""}{pct1(t.deltaWeight)}</TableCell>
                          <TableCell className="text-right">{t.estimatedShares !== null ? t.estimatedShares.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right">{usd(t.estimatedTradeUsd)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">Unavailable</TableCell>
                        </TableRow>
                      ))}
                      {trade.trades.every((t) => t.action === "HOLD" && t.warnings.length === 0) && (
                        <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-4">No trades required — target weights match current weights.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span>Liquidity/ADV is always shown as unavailable — the uploaded price CSV contains close prices only, with no trading volume feed. Estimated shares are rounded to whole shares using the latest available close price; this is illustrative, not a broker-ready ticket.</span>
                </div>

                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Download Trade Blotter (CSV)
                </Button>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
