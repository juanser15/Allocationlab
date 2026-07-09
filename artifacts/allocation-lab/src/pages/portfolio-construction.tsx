import { useState, useRef, useEffect } from "react";
import { useGetConstraints, useUpdateConstraints, useGetLatestResults, useGetOrCreateDecisionLog } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Loader2, Save, Info, ExternalLink, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function EtfLink({ ticker, className }: { ticker: string; className?: string }) {
  return (
    <Link
      href={`/etf/${ticker}`}
      className={`inline-flex items-center gap-0.5 hover:text-accent hover:underline transition-colors group ${className ?? ""}`}
    >
      {ticker}
      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </Link>
  );
}

export default function PortfolioConstruction() {
  const { toast } = useToast();

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

  const { data: result, isLoading: loadingResult } = useGetLatestResults();
  const sessionId = result?.sessionId;
  const { data: decisionLog } = useGetOrCreateDecisionLog(sessionId ?? 0);
  const tradeList = decisionLog?.content?.tradeList ?? [];

  if (loadingConstraints) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        section="3 · Portfolio Construction"
        title="Portfolio Construction"
        description="Rules that govern how the model builds a portfolio from scored ETFs, plus the resulting allocation and trade list."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        {/* Factor weighting note */}
        <Card>
          <CardHeader>
            <CardTitle>Factor Weighting</CardTitle>
            <CardDescription>How ETF composite scores are computed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
              <span>
                Factor weights (momentum, trend quality, realized volatility, drawdown, mean reversion) are fixed by
                the model methodology and are not user-adjustable — this keeps the model consistent and auditable
                across runs. See the full factor definitions on{" "}
                <Link href="/methodology" className="underline font-medium text-primary">Methodology &amp; Settings</Link>.
              </span>
            </div>
            <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
              <span>
                ETF universe membership and prior weights are configured in{" "}
                <Link href="/setup-data" className="underline font-medium text-primary">Setup &amp; Data</Link>.
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Allocation Output */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Allocation Output</CardTitle>
            <CardDescription>Target weights from the most recent run, applying the constraints above. Click any ticker to open its ETF Explorer.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loadingResult ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : !result ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No allocation run yet. Run the pipeline from the{" "}
                <Link href="/" className="underline font-medium">Command Center</Link>.
              </p>
            ) : (
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead className="text-right">Prior</TableHead>
                    <TableHead className="text-right">New Weight</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-primary/5 font-medium border-b-2 border-primary/20">
                    <TableCell>CASH</TableCell>
                    <TableCell>Cash Reserve</TableCell>
                    <TableCell>Cash</TableCell>
                    <TableCell className="text-right">{(result.cashPriorWeight * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right text-primary font-bold">{(result.cashWeight * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      <span className={result.cashChange > 0 ? "text-green-600" : result.cashChange < 0 ? "text-red-600" : "text-gray-500"}>
                        {result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-xs px-2 py-0.5 rounded border bg-gray-100">BASE</span>
                    </TableCell>
                  </TableRow>
                  {result.allocations
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((etf) => (
                      <TableRow key={etf.ticker} className={!etf.active ? "opacity-60 bg-gray-50/50" : ""}>
                        <TableCell className="font-medium"><EtfLink ticker={etf.ticker} className="font-semibold" /></TableCell>
                        <TableCell>{etf.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{etf.sector}</TableCell>
                        <TableCell className="text-right">{(etf.priorWeight * 100).toFixed(1)}%</TableCell>
                        <TableCell className={`text-right font-medium ${etf.active ? "text-gray-900" : "text-gray-400"}`}>
                          {(etf.weight * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {Math.abs(etf.change) > 0.0001 ? (
                            <span className={etf.change > 0 ? "text-green-600" : "text-red-600"}>
                              {etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {etf.active ? (
                            <span className="text-xs px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">ACTIVE</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded border text-gray-400 border-gray-200">OUT</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Trade List Preview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> Trade List Preview
            </CardTitle>
            <CardDescription>Full execution list implied by this rebalance. Committee approval happens in Investment Committee.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            {tradeList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No trade list available yet — run the pipeline to generate one.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ticker</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs text-right">Weight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeList.map((t: any) => (
                    <TableRow key={t.ticker}>
                      <TableCell className="text-xs font-medium">{t.ticker}</TableCell>
                      <TableCell className="text-xs">{t.action}</TableCell>
                      <TableCell className="text-xs text-right">{pct(t.toWeight)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
