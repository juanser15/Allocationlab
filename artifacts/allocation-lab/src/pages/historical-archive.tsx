import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  useListArchive,
  useGetArchiveEntry,
  useCompareArchive,
  useGenerateReport,
} from "@workspace/api-client-react";
import type { ArchiveListItem, ArchiveEntry, ArchiveTickerChange } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Archive as ArchiveIcon, Download, FileText, Image as ImageIcon, FileSpreadsheet,
  X, ArrowRight, GitCompare, Info, ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function signedPct(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("default", { year: "numeric", month: "short", day: "numeric" });
}

function getCellColorClass(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function StatusBadge({ status }: { status: ArchiveListItem["decisionLogStatus"] }) {
  if (status === "approved") return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Approved</Badge>;
  if (status === "under_review") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Under Review</Badge>;
  if (status === "draft") return <Badge variant="outline" className="text-gray-600">Draft</Badge>;
  return <Badge variant="outline" className="text-gray-400 border-dashed">No Decision Log</Badge>;
}

const HEATMAP_FACTORS: [string, string][] = [
  ["mom60", "Mom60"],
  ["trendQuality", "TrendQ"],
  ["realizedVol60", "RealVol"],
  ["drawdown", "Drawdn"],
  ["composite", "Comp"],
];

function ExportButtons({ entry }: { entry: ArchiveEntry }) {
  const { toast } = useToast();
  const generateReport = useGenerateReport();
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);

  const handle = (format: "pdf" | "csv") => {
    setDownloading(format);
    generateReport.mutate(
      { data: { format, sessionId: entry.sessionId, title: "Archived Committee Report", portfolioName: entry.portfolioVersion } },
      {
        onSuccess: (data) => {
          window.open(`/api/reports/download/${data.downloadToken}`, "_blank");
          setDownloading(null);
        },
        onError: () => {
          toast({ title: "Failed to generate report", variant: "destructive" });
          setDownloading(null);
        },
      }
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => handle("pdf")} disabled={downloading !== null}>
        {downloading === "pdf" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
        Archived PDF
      </Button>
      <Button size="sm" variant="outline" onClick={() => handle("csv")} disabled={downloading !== null}>
        {downloading === "csv" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
        Portfolio CSV
      </Button>
    </div>
  );
}

function EntryDetail({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const { data: entry, isLoading } = useGetArchiveEntry(sessionId);
  const previewRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [downloadingPng, setDownloadingPng] = useState(false);

  const handlePng = async () => {
    if (!previewRef.current) return;
    setDownloadingPng(true);
    try {
      const canvas = await html2canvas(previewRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const link = document.createElement("a");
      link.download = `archive-${sessionId}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      toast({ title: "Failed to export PNG", variant: "destructive" });
    } finally {
      setDownloadingPng(false);
    }
  };

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">{entry?.portfolioVersion ?? `Session #${sessionId}`}</CardTitle>
          {entry && <CardDescription>{fmtDate(entry.runAt)}</CardDescription>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        )}
        {entry && (
          <div ref={previewRef} className="bg-white space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Regime</p>
                <p className="text-sm font-bold text-primary">{entry.regime.label}</p>
                <p className="text-xs text-muted-foreground">{entry.regime.composite.toFixed(0)}/100</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Cash Weight</p>
                <p className="text-sm font-bold">{pct(entry.cashWeight)}</p>
                <p className="text-xs text-muted-foreground">{signedPct(entry.cashChange)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Active ETFs</p>
                <p className="text-sm font-bold">{entry.activeEtfCount}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Exp. Vol</p>
                <p className="text-sm font-bold">{pct(entry.diagnostics.expectedVolatility)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Decision Log</p>
                <StatusBadge status={(entry.decisionLog?.status ?? "none") as ArchiveListItem["decisionLogStatus"]} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Notes</p>
              <p className="text-sm text-gray-700 leading-relaxed">{entry.notes}</p>
            </div>

            <div className="overflow-x-auto">
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Allocation &amp; Factor Heatmap</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-1.5 pr-3">Ticker</th>
                    <th className="text-right py-1.5 pr-3">Weight</th>
                    <th className="text-right py-1.5 pr-3">Change</th>
                    {HEATMAP_FACTORS.map(([, label]) => (
                      <th key={label} className="text-center py-1.5 px-1">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entry.allocations
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((a) => (
                      <tr key={a.ticker} className={`border-b border-gray-50 ${!a.active ? "text-gray-400" : ""}`}>
                        <td className="py-1 pr-3 font-medium">{a.ticker}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{pct(a.weight, 2)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{signedPct(a.change, 2)}</td>
                        {HEATMAP_FACTORS.map(([key, label]) => {
                          const val = a.factorScores[key as keyof typeof a.factorScores] as number;
                          return (
                            <td key={label} className="text-center py-1 px-1">
                              <span className={`inline-block w-9 rounded px-1 py-0.5 font-medium ${getCellColorClass(val)}`}>
                                {val.toFixed(0)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {entry.diagnostics.insufficientDataReasons.length > 0 && (
              <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {entry.diagnostics.insufficientDataReasons.join(" ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
      {entry && (
        <div className="px-6 pb-6 -mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons entry={entry} />
            <Button size="sm" variant="outline" onClick={handlePng} disabled={downloadingPng}>
              {downloadingPng ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
              PNG Snapshot
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function tickerChangesToCsv(changes: ArchiveTickerChange[]): string {
  const header = ["Ticker", "Name", "Sector", "Weight A", "Weight B", "Delta Weight", "Factor Score A", "Factor Score B", "Factor Score Change", "Action"];
  const rows = changes.map((c) => [
    c.ticker, c.name, c.sector,
    (c.weightA * 100).toFixed(2), (c.weightB * 100).toFixed(2), (c.deltaWeight * 100).toFixed(2),
    c.factorScoreA?.toFixed(1) ?? "", c.factorScoreB?.toFixed(1) ?? "", c.factorScoreChange?.toFixed(1) ?? "",
    c.action,
  ]);
  return [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function CompareView({ idA, idB, onClose }: { idA: number; idB: number; onClose: () => void }) {
  const { data: cmp, isLoading, error } = useCompareArchive({ a: idA, b: idB });
  const previewRef = useRef<HTMLDivElement>(null);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const { toast } = useToast();

  const handlePng = async () => {
    if (!previewRef.current) return;
    setDownloadingPng(true);
    try {
      const canvas = await html2canvas(previewRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const link = document.createElement("a");
      link.download = `archive-compare-${idA}-vs-${idB}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      toast({ title: "Failed to export PNG", variant: "destructive" });
    } finally {
      setDownloadingPng(false);
    }
  };

  const handleChangesCsv = () => {
    if (!cmp) return;
    const csv = tickerChangesToCsv(cmp.tickerChanges);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `archive-changes-${idA}-vs-${idB}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-l-4 border-l-accent">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><GitCompare className="h-4 w-4" /> Period Comparison</CardTitle>
          <CardDescription>Comparing two saved rebalances side by side.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {error && !isLoading && <p className="text-sm text-red-600 py-6 text-center">Failed to load comparison.</p>}
        {cmp && (
          <div ref={previewRef} className="bg-white space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Period A</p>
                <p className="font-bold text-primary">{cmp.a.portfolioVersion}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(cmp.a.runAt)} • {cmp.a.regime.label}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Period B</p>
                <p className="font-bold text-primary">{cmp.b.portfolioVersion}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(cmp.b.runAt)} • {cmp.b.regime.label}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Cash Weight</p>
                <p className="text-sm font-bold">{pct(cmp.a.cashWeight)} <ArrowRight className="inline h-3 w-3 mx-0.5" /> {pct(cmp.b.cashWeight)}</p>
                <p className="text-xs text-muted-foreground">{signedPct(cmp.cashWeightChange)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Regime Score</p>
                <p className="text-sm font-bold">{cmp.a.regime.composite.toFixed(0)} <ArrowRight className="inline h-3 w-3 mx-0.5" /> {cmp.b.regime.composite.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">{cmp.regimeCompositeChange >= 0 ? "+" : ""}{cmp.regimeCompositeChange.toFixed(1)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Active ETFs</p>
                <p className="text-sm font-bold">{cmp.a.activeEtfCount} <ArrowRight className="inline h-3 w-3 mx-0.5" /> {cmp.b.activeEtfCount}</p>
                <p className="text-xs text-muted-foreground">{cmp.activeEtfCountChange >= 0 ? "+" : ""}{cmp.activeEtfCountChange}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Turnover</p>
                <p className="text-sm font-bold">{pct(cmp.turnover)}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Realized Return</p>
                <p className={`text-sm font-bold ${cmp.realizedReturn !== null ? (cmp.realizedReturn >= 0 ? "text-green-700" : "text-red-600") : "text-gray-400"}`}>
                  {cmp.realizedReturn !== null ? signedPct(cmp.realizedReturn) : "N/A"}
                </p>
              </div>
            </div>
            {cmp.realizedReturnNote && (
              <p className="text-xs text-muted-foreground -mt-2">{cmp.realizedReturnNote}</p>
            )}

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Key Rationale</p>
              <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                {cmp.keyRationale.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>

            <div className="overflow-x-auto">
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Ticker Changes</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-1.5 pr-3">Ticker</th>
                    <th className="text-left py-1.5 pr-3">Sector</th>
                    <th className="text-right py-1.5 pr-3">A</th>
                    <th className="text-right py-1.5 pr-3">B</th>
                    <th className="text-right py-1.5 pr-3">Δ Weight</th>
                    <th className="text-right py-1.5 pr-3">Δ Score</th>
                    <th className="text-left py-1.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.tickerChanges.map((c) => (
                    <tr key={c.ticker} className="border-b border-gray-50">
                      <td className="py-1 pr-3 font-medium">{c.ticker}</td>
                      <td className="py-1 pr-3 text-gray-500">{c.sector}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{pct(c.weightA, 2)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{pct(c.weightB, 2)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{signedPct(c.deltaWeight, 2)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{c.factorScoreChange !== null ? (c.factorScoreChange >= 0 ? "+" : "") + c.factorScoreChange.toFixed(1) : "—"}</td>
                      <td className="py-1">
                        <Badge
                          variant="outline"
                          className={
                            c.action === "ADD" ? "border-green-300 text-green-700" :
                            c.action === "REMOVE" ? "border-red-300 text-red-700" :
                            c.action === "INCREASE" ? "border-blue-300 text-blue-700" :
                            c.action === "DECREASE" ? "border-amber-300 text-amber-700" :
                            "border-gray-300 text-gray-500"
                          }
                        >
                          {c.action}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
      {cmp && (
        <div className="px-6 pb-6 -mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handlePng} disabled={downloadingPng}>
            {downloadingPng ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
            PNG Snapshot
          </Button>
          <Button size="sm" variant="outline" onClick={handleChangesCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Changes CSV
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function HistoricalArchive() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [regime, setRegime] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [portfolioName, setPortfolioName] = useState("");
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  const [compareSelection, setCompareSelection] = useState<number[]>([]);
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (fromDate) p.fromDate = fromDate;
    if (toDate) p.toDate = toDate;
    if (regime !== "all") p.regime = regime;
    if (status !== "all") p.status = status;
    if (portfolioName.trim()) p.portfolioName = portfolioName.trim();
    return p;
  }, [fromDate, toDate, regime, status, portfolioName]);

  const { data, isLoading, error } = useListArchive(params);

  const toggleCompare = (id: number) => {
    setCompareSelection((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const hasFilters = !!(fromDate || toDate || (regime !== "all") || (status !== "all") || portfolioName.trim());
  const clearFilters = () => {
    setFromDate(""); setToDate(""); setRegime("all"); setStatus("all"); setPortfolioName("");
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Historical Archive</h1>
          <p className="text-muted-foreground mt-1">
            Browse every completed rebalance, open a prior month in detail, or compare two periods side by side.
          </p>
        </div>
        {compareSelection.length === 2 && (
          <Button onClick={() => { setCompareIds([compareSelection[0], compareSelection[1]]); setOpenSessionId(null); }}>
            <GitCompare className="mr-1.5 h-4 w-4" />
            Compare Selected
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From Date</label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To Date</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Regime</label>
              <Select value={regime} onValueChange={setRegime}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Regimes</SelectItem>
                  {(data?.availableRegimes ?? []).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="none">No Decision Log</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Portfolio Name</label>
              <Input placeholder="Search..." value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} />
            </div>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-muted-foreground" onClick={clearFilters}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      )}

      {error && !isLoading && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 text-center text-sm text-red-700">Failed to load the archive.</CardContent>
        </Card>
      )}

      {data && !isLoading && data.entries.length === 0 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <ArchiveIcon className="h-14 w-14 text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {hasFilters ? "No rebalances match these filters" : "No completed rebalances yet"}
            </h2>
            <p className="text-muted-foreground max-w-md mb-4">
              {hasFilters
                ? "Try widening your date range or clearing a filter."
                : "Every rebalance you run from Investment Committee is saved here automatically. Run the pipeline once to start building history."}
            </p>
            {hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Button asChild><Link href="/">Go to Investment Committee</Link></Button>
            )}
          </CardContent>
        </Card>
      )}

      {data && !isLoading && data.entries.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2.5 pl-4 pr-2 font-semibold w-10"></th>
                  <th className="text-left py-2.5 pr-3 font-semibold">Date</th>
                  <th className="text-left py-2.5 pr-3 font-semibold">Portfolio</th>
                  <th className="text-left py-2.5 pr-3 font-semibold">Regime</th>
                  <th className="text-right py-2.5 pr-3 font-semibold">Cash</th>
                  <th className="text-right py-2.5 pr-3 font-semibold">Active ETFs</th>
                  <th className="text-left py-2.5 pr-3 font-semibold">Decision Log</th>
                  <th className="text-left py-2.5 pr-4 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.sessionId} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="pl-4 pr-2 py-2.5">
                      <Checkbox
                        checked={compareSelection.includes(e.sessionId)}
                        onCheckedChange={() => toggleCompare(e.sessionId)}
                        aria-label="Select for comparison"
                      />
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 whitespace-nowrap">{fmtDate(e.runAt)}</td>
                    <td className="py-2.5 pr-3 text-gray-800 font-medium">{e.portfolioVersion}</td>
                    <td className="py-2.5 pr-3">
                      <span className="text-gray-700">{e.regimeLabel}</span>{" "}
                      <span className="text-xs text-muted-foreground">({e.regimeComposite.toFixed(0)})</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{pct(e.cashWeight)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{e.activeEtfCount}</td>
                    <td className="py-2.5 pr-3"><StatusBadge status={e.decisionLogStatus} /></td>
                    <td className="py-2.5 pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setOpenSessionId(e.sessionId); setCompareIds(null); }}
                      >
                        Open <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {openSessionId !== null && (
        <EntryDetail sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
      )}

      {compareIds && (
        <CompareView idA={compareIds[0]} idB={compareIds[1]} onClose={() => { setCompareIds(null); setCompareSelection([]); }} />
      )}
    </div>
  );
}
