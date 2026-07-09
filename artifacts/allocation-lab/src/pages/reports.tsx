import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { useGetLatestResults, useGetConstraints, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, Download, FileText, Image as ImageIcon, FileSpreadsheet, Eye, EyeOff,
  CheckCircle2, AlertTriangle, XCircle, PieChart as PieChartIcon,
} from "lucide-react";
import { Link } from "wouter";
import { PieChart, Pie, Cell } from "recharts";
import { useToast } from "@/hooks/use-toast";

type ChecklistSeverity = "pass" | "warn" | "fail";
interface ChecklistItem {
  id: string;
  label: string;
  severity: ChecklistSeverity;
  detail: string;
}

function getRegimeBarColor(score: number) {
  if (score >= 65) return "bg-green-500";
  if (score >= 45) return "bg-amber-400";
  return "bg-red-500";
}

function getCellColorClass(val: number) {
  if (val >= 80) return "bg-green-100 text-green-800";
  if (val >= 60) return "bg-green-50 text-green-700";
  if (val >= 40) return "bg-amber-50 text-amber-700";
  if (val >= 20) return "bg-red-50 text-red-700";
  return "bg-red-100 text-red-800";
}

function ChecklistIcon({ severity }: { severity: ChecklistSeverity }) {
  if (severity === "pass") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (severity === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
}

export default function Reports() {
  const { toast } = useToast();
  const { data: result, isLoading: loadingResult } = useGetLatestResults();
  const { data: constraints, isLoading: loadingConstraints } = useGetConstraints();
  const generateReport = useGenerateReport();

  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState("Monthly Committee Report");
  const [subtitle, setSubtitle] = useState("");
  const [reportDate, setReportDate] = useState(today);
  const [portfolioName, setPortfolioName] = useState("Core Tactical Allocation");
  const [internalNote, setInternalNote] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [downloadingFmt, setDownloadingFmt] = useState<"pdf" | "png" | "csv" | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  const isLoading = loadingResult || loadingConstraints;

  const checklist: ChecklistItem[] = useMemo(() => {
    const items: ChecklistItem[] = [];
    if (!result) {
      items.push({ id: "no-data", label: "No allocation run found", severity: "fail", detail: "Run the allocation pipeline from Investment Committee before building a report." });
      return items;
    }

    // Missing / stale data
    items.push(result.priceDataEnd
      ? { id: "price-data", label: "Price data present", severity: "pass", detail: `Prices through ${result.priceDataEnd}.` }
      : { id: "price-data", label: "Missing price data", severity: "fail", detail: "No price data end date on the latest run." });

    // Placeholder-like scores (uniform scores across all ETFs suggest synthetic/placeholder data)
    const composites = result.allocations.map((a) => a.factorScores.composite);
    const uniqueComposites = new Set(composites.map((c) => Math.round(c)));
    if (composites.length > 0 && uniqueComposites.size <= 1) {
      items.push({ id: "placeholder-scores", label: "Factor scores look placeholder-like", severity: "fail", detail: "All ETFs share an identical composite score — verify price data was actually uploaded." });
    } else if (composites.length > 0 && uniqueComposites.size <= 2) {
      items.push({ id: "placeholder-scores", label: "Factor scores show little variation", severity: "warn", detail: "Composite scores are nearly uniform across ETFs. Double-check price history depth." });
    } else {
      items.push({ id: "placeholder-scores", label: "Factor scores show healthy variation", severity: "pass", detail: `${uniqueComposites.size} distinct composite score levels across ${composites.length} ETFs.` });
    }

    // Cash constraint violations
    if (constraints) {
      const cashMin = constraints.cashMin;
      const cashMax = constraints.cashMax;
      if (result.cashWeight < cashMin - 0.0005 || result.cashWeight > cashMax + 0.0005) {
        items.push({
          id: "cash-constraint",
          label: "Cash weight violates constraint band",
          severity: "fail",
          detail: `Cash is ${(result.cashWeight * 100).toFixed(1)}%, outside the configured ${(cashMin * 100).toFixed(0)}–${(cashMax * 100).toFixed(0)}% band.`,
        });
      } else {
        items.push({
          id: "cash-constraint",
          label: "Cash weight within constraint band",
          severity: "pass",
          detail: `${(result.cashWeight * 100).toFixed(1)}% is within the ${(cashMin * 100).toFixed(0)}–${(cashMax * 100).toFixed(0)}% band.`,
        });
      }

      // Too few ETFs
      if (result.activeEtfCount < constraints.targetActiveEtfs) {
        const severity: ChecklistSeverity = result.activeEtfCount < 8 ? "fail" : "warn";
        items.push({
          id: "active-count",
          label: "Fewer active ETFs than target",
          severity,
          detail: `${result.activeEtfCount} active vs. target of ${constraints.targetActiveEtfs} (minimum 8 required).`,
        });
      } else {
        items.push({
          id: "active-count",
          label: "Active ETF count meets target",
          severity: "pass",
          detail: `${result.activeEtfCount} ETFs active, meeting the ${constraints.targetActiveEtfs}-ETF target.`,
        });
      }
    }

    // Unavailable regime components
    const unavailable = result.regime.components.filter((c) => c.method === "unavailable").length;
    if (unavailable > 0) {
      items.push({
        id: "regime-components",
        label: `${unavailable} regime component${unavailable > 1 ? "s" : ""} unavailable`,
        severity: unavailable >= 3 ? "warn" : "pass",
        detail: "Some regime inputs require external data feeds and are currently unavailable — external judgment should supplement the model.",
      });
    }

    // Report fields sanity
    if (!portfolioName.trim()) {
      items.push({ id: "portfolio-name", label: "Portfolio name is empty", severity: "warn", detail: "Add a portfolio name so the report is clearly attributed." });
    }
    if (!title.trim()) {
      items.push({ id: "title", label: "Report title is empty", severity: "warn", detail: "Add a title before distributing the report." });
    }

    return items;
  }, [result, constraints, portfolioName, title]);

  const failCount = checklist.filter((c) => c.severity === "fail").length;
  const warnCount = checklist.filter((c) => c.severity === "warn").length;

  const handleDownload = (format: "pdf" | "csv") => {
    if (!result) return;
    setDownloadingFmt(format);
    generateReport.mutate(
      {
        data: {
          format,
          sessionId: result.sessionId,
          title: title || undefined,
          subtitle: subtitle || undefined,
          reportDate: reportDate || undefined,
          portfolioName: portfolioName || undefined,
          internalNote: internalNote || undefined,
        },
      },
      {
        onSuccess: (data) => {
          window.open(`/api/reports/download/${data.downloadToken}`, "_blank");
          setDownloadingFmt(null);
        },
        onError: () => {
          toast({ title: "Failed to generate report", variant: "destructive" });
          setDownloadingFmt(null);
        },
      }
    );
  };

  const handleDownloadPng = async () => {
    if (!previewRef.current) {
      toast({ title: "Open the preview first", description: "PNG export captures the on-screen preview.", variant: "destructive" });
      return;
    }
    setDownloadingFmt("png");
    try {
      const canvas = await html2canvas(previewRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const link = document.createElement("a");
      link.download = `allocation-lab-committee-report-${reportDate || today}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      toast({ title: "Failed to export PNG", variant: "destructive" });
    } finally {
      setDownloadingFmt(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!result) {
    return (
      <div className="p-8 max-w-5xl mx-auto h-[calc(100vh-4rem)] flex flex-col items-center justify-center text-center">
        <PieChartIcon className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Results Available</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Run the allocation pipeline from Investment Committee before building a committee report.
        </p>
        <Button asChild size="lg">
          <Link href="/">Go to Investment Committee</Link>
        </Button>
      </div>
    );
  }

  const regime = result.regime;
  const donutData = [
    { name: "Cash", value: result.cashWeight * 100, color: "#1B2F5B" },
    ...result.allocations
      .filter((a) => a.weight > 0)
      .map((a, i) => ({
        name: a.ticker,
        value: a.weight * 100,
        color: ["#D4AF37", "#4A5568", "#64748B", "#A0AEC0", "#CBD5E1", "#6B7280", "#9CA3AF", "#E2E8F0"][i % 8],
      })),
  ];
  const heatmapFactors: [string, string][] = [
    ["mom60", "Mom60"],
    ["trendQuality", "TrendQ"],
    ["realizedVol60", "RealVol"],
    ["drawdown", "Drawdn"],
    ["composite", "Comp"],
  ];
  const topAllocations = result.allocations.slice().sort((a, b) => b.weight - a.weight);

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Committee Report Builder</h1>
        <p className="text-muted-foreground mt-2">
          Compose a one-page report for the latest allocation run, preview it, and export PDF, PNG, or CSV.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Left: editable fields + checklist */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Details</CardTitle>
              <CardDescription>These fields appear on the report header and footer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Monthly Committee Report" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subtitle">Subtitle</Label>
                <Input id="subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. July Rebalance" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reportDate">Report Date</Label>
                  <Input id="reportDate" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="portfolioName">Portfolio Name</Label>
                  <Input id="portfolioName" value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="internalNote">Internal Note</Label>
                <Textarea
                  id="internalNote"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Optional note shown in the report footer, e.g. for internal review."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Quality Checklist
                {failCount > 0 ? (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{failCount} issue{failCount > 1 ? "s" : ""}</Badge>
                ) : warnCount > 0 ? (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{warnCount} warning{warnCount > 1 ? "s" : ""}</Badge>
                ) : (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">All clear</Badge>
                )}
              </CardTitle>
              <CardDescription>Checked before you distribute the report.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {checklist.map((item) => (
                <div key={item.id} className="flex items-start gap-2">
                  <ChecklistIcon severity={item.severity} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 leading-snug">{item.label}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{item.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export</CardTitle>
              <CardDescription>One-page landscape PDF, on-screen PNG snapshot, or raw CSV data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                {showPreview ? "Hide Preview" : "Show Preview"}
              </Button>
              <Separator />
              <Button className="w-full justify-start" onClick={() => handleDownload("pdf")} disabled={downloadingFmt !== null}>
                {downloadingFmt === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Download PDF
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={handleDownloadPng} disabled={downloadingFmt !== null || !showPreview}>
                {downloadingFmt === "png" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Download PNG
              </Button>
              {!showPreview && <p className="text-xs text-muted-foreground pl-1">Open the preview to enable PNG export.</p>}
              <Button variant="outline" className="w-full justify-start" onClick={() => handleDownload("csv")} disabled={downloadingFmt !== null}>
                {downloadingFmt === "csv" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Download CSV Data
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: preview */}
        <div className="min-w-0">
          {!showPreview ? (
            <Card className="h-full flex items-center justify-center min-h-[420px]">
              <div className="text-center text-muted-foreground p-8">
                <Eye className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p>Click &quot;Show Preview&quot; to see how the one-page report will look before exporting.</p>
              </div>
            </Card>
          ) : (
            <div className="border rounded-md overflow-auto bg-gray-100 p-4">
              <div
                ref={previewRef}
                className="bg-white shadow-sm mx-auto"
                style={{ width: "1400px", maxWidth: "100%", padding: "28px", fontFamily: "Inter, sans-serif" }}
              >
                {/* Header */}
                <div className="flex justify-between items-start pb-3 border-b-2" style={{ borderColor: "#1B2F5B" }}>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-gray-500">{portfolioName || "Allocation Lab v2"}</p>
                    <h2 className="text-xl font-bold" style={{ color: "#1B2F5B" }}>
                      {title || "Committee Report"}{subtitle ? ` — ${subtitle}` : ""}
                    </h2>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>Report Date: {reportDate || today}</p>
                    <p>Price data through {result.priceDataEnd}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-4">
                  {/* Left col: exec summary + KPIs + table */}
                  <div className="col-span-2 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#1B2F5B" }}>Executive Summary</p>
                      <p className="text-xs text-gray-700 leading-relaxed mt-1">{result.icSummary.whatChanged} {result.icSummary.why}</p>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Cash Weight</p>
                        <p className="text-sm font-bold" style={{ color: "#1B2F5B" }}>{(result.cashWeight * 100).toFixed(1)}%</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Cash Change</p>
                        <p className="text-sm font-bold">{result.cashChange > 0 ? "+" : ""}{(result.cashChange * 100).toFixed(1)}%</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Active ETFs</p>
                        <p className="text-sm font-bold">{result.activeEtfCount}</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Invested Sleeve</p>
                        <p className="text-sm font-bold">{(result.investedSleeve * 100).toFixed(1)}%</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Exp. Vol</p>
                        <p className="text-xs font-semibold">{(result.diagnostics.expectedVolatility * 100).toFixed(1)}%</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">HHI</p>
                        <p className="text-xs font-semibold">{result.diagnostics.hhi.toFixed(3)}</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Eff. # Bets</p>
                        <p className="text-xs font-semibold">{result.diagnostics.effectiveNumberOfBets.toFixed(1)}</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="text-[9px] text-gray-500 uppercase">Diversification</p>
                        <p className="text-xs font-semibold">{result.diagnostics.diversificationScore.toFixed(0)}/100</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Final Allocation &amp; Changes vs. Prior Month</p>
                      <table className="w-full text-[10px] border-collapse">
                        <thead>
                          <tr className="text-left text-gray-500 border-b">
                            <th className="py-1 pr-2">Ticker</th>
                            <th className="py-1 pr-2">Sector</th>
                            <th className="py-1 pr-2 text-right">Weight</th>
                            <th className="py-1 pr-2 text-right">Prior</th>
                            <th className="py-1 pr-2 text-right">Change</th>
                            <th className="py-1 pr-2 text-right">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topAllocations.slice(0, 12).map((etf) => (
                            <tr key={etf.ticker} className={`border-b border-gray-100 ${!etf.active ? "text-gray-400" : ""}`}>
                              <td className="py-0.5 pr-2 font-medium">{etf.ticker}</td>
                              <td className="py-0.5 pr-2">{etf.sector}</td>
                              <td className="py-0.5 pr-2 text-right">{(etf.weight * 100).toFixed(2)}%</td>
                              <td className="py-0.5 pr-2 text-right">{(etf.priorWeight * 100).toFixed(2)}%</td>
                              <td className="py-0.5 pr-2 text-right">{etf.change > 0 ? "+" : ""}{(etf.change * 100).toFixed(2)}%</td>
                              <td className="py-0.5 pr-2 text-right">{etf.factorScores.composite.toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {topAllocations.length > 12 && (
                        <p className="text-[9px] text-gray-400 mt-1">+{topAllocations.length - 12} more rows omitted in preview (full list included in PDF/CSV).</p>
                      )}
                    </div>
                  </div>

                  {/* Right col: regime, donut, heatmap, risks, watchlist */}
                  <div className="col-span-1 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Market Regime</p>
                      <p className="text-base font-bold" style={{ color: "#1B2F5B" }}>{regime.label}</p>
                      <p className="text-[9px] text-gray-500 mb-1">Composite {regime.composite.toFixed(0)}/100 • Confidence {regime.confidence.toFixed(0)}%</p>
                      <div className="space-y-1">
                        {[["Trend", regime.trend], ["Breadth", regime.breadth], ["Volatility", regime.volatility], ["Liquidity", regime.liquidity]].map(([label, val]) => (
                          <div key={label as string} className="flex items-center gap-1">
                            <span className="text-[9px] text-gray-500 w-14 shrink-0">{label}</span>
                            <div className="h-1.5 bg-gray-100 rounded-full flex-1 overflow-hidden">
                              <div className={`h-full rounded-full ${getRegimeBarColor(val as number)}`} style={{ width: `${val}%` }} />
                            </div>
                            <span className="text-[9px] font-medium w-6 text-right">{(val as number).toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Allocation Mix</p>
                      <div className="h-[130px] flex justify-center">
                        <PieChart width={200} height={130}>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={30} outerRadius={45} paddingAngle={2} dataKey="value" isAnimationActive={false}>
                            {donutData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                          </Pie>
                        </PieChart>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        {donutData.slice(0, 6).map((d) => (
                          <div key={d.name} className="flex items-center gap-1 text-[9px]">
                            <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                            <span className="truncate">{d.name} {d.value.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Factor Heatmap</p>
                      <table className="w-full text-[8.5px] border-collapse">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-0.5"></th>
                            {heatmapFactors.map(([, label]) => <th key={label} className="text-center py-0.5">{label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {topAllocations.filter((a) => a.active).slice(0, 6).map((etf) => (
                            <tr key={etf.ticker}>
                              <td className="font-medium py-0.5 pr-1">{etf.ticker}</td>
                              {heatmapFactors.map(([key]) => {
                                const val = (etf.factorScores as unknown as Record<string, number>)[key];
                                return (
                                  <td key={key} className={`text-center py-0.5 ${getCellColorClass(val)}`}>{val.toFixed(0)}</td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Top Risks</p>
                      <p className="text-[9px] text-gray-700 leading-snug">{result.icSummary.risks}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#1B2F5B" }}>Watchlist</p>
                      {result.watchlist.length === 0 ? (
                        <p className="text-[9px] text-gray-400">No near-miss ETFs this cycle.</p>
                      ) : (
                        <div className="space-y-0.5">
                          {result.watchlist.slice(0, 3).map((w) => (
                            <p key={w.ticker} className="text-[9px] text-gray-700 leading-snug">
                              <span className="font-medium">{w.ticker}</span> Score ({w.compositeScore.toFixed(0)}) — {w.improvement}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-4 pt-2 border-t flex justify-between items-start gap-4">
                  <p className="text-[8.5px] text-gray-500 leading-snug max-w-[65%]">
                    Methodology: factor &amp; regime scores computed from real uploaded price data only (0–100 cross-sectional ranks); no synthetic values.
                    {internalNote && <><br /><span className="text-amber-700 italic">Internal note: {internalNote}</span></>}
                  </p>
                  <p className="text-[8.5px] text-gray-400 whitespace-nowrap">Generated {new Date().toLocaleString()} • For internal use only</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
