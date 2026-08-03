import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GenerateReportBody,
  GenerateReportResponse,
} from "@workspace/api-zod";
import { randomBytes } from "crypto";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

// In-memory token store (tokens expire after 10 minutes)
const reportTokens = new Map<
  string,
  { contentType: string; filename: string; data: Buffer | string; expiresAt: number }
>();

// ── Colours & fonts ────────────────────────────────────────────────────────
const NAVY = "#1B2F5B";
const NAVY_LIGHT = "#33456F";
const GRAY = "#64748B";
const LIGHT_GRAY = "#F1F5F9";
const BORDER = "#E2E8F0";
const BLACK = "#0F172A";
const GREEN = "#15803D";
const RED = "#B91C1C";
const AMBER = "#B45309";

interface ReportMeta {
  title?: string;
  subtitle?: string;
  reportDate?: string;
  portfolioName?: string;
  internalNote?: string;
}

function formatPct(v: number | undefined | null): string {
  if (v === undefined || v === null) return "—";
  return (v * 100).toFixed(2) + "%";
}

function formatPctChange(v: number | undefined | null): string {
  if (v === undefined || v === null) return "—";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function truncate(text: string | undefined | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

// Maps a 0-100 score to a heatmap color (red -> amber -> green).
function scoreColor(score: number): string {
  if (score >= 70) return "#15803D";
  if (score >= 55) return "#65A30D";
  if (score >= 40) return "#CA8A04";
  if (score >= 25) return "#EA580C";
  return "#B91C1C";
}

// ── CSV builder ────────────────────────────────────────────────────────────
function generateCsv(result: Record<string, unknown>, meta: ReportMeta): string {
  const allocations = (result.allocations ?? []) as Array<Record<string, unknown>>;
  const regime = result.regime as Record<string, unknown> | undefined;
  const lines: string[] = [];

  lines.push(`${meta.title ?? "Allocation Lab v2"} — Committee Report`);
  if (meta.subtitle) lines.push(meta.subtitle);
  lines.push(`Portfolio,${meta.portfolioName ?? "Allocation Lab v2"}`);
  lines.push(`Report Date,${meta.reportDate ?? (result.runAt as string ?? "").slice(0, 10)}`);
  lines.push(`Run Date,${result.runAt ?? ""}`);
  lines.push(`Cash Weight,${formatPct(result.cashWeight as number)}`);
  lines.push(`Cash Change,${formatPctChange(result.cashChange as number)}`);
  lines.push(`Active ETFs,${result.activeEtfCount ?? ""}`);
  lines.push(`Invested Sleeve,${formatPct(result.investedSleeve as number)}`);
  lines.push(`Price Data Through,${result.priceDataEnd ?? ""}`);
  if (meta.internalNote) lines.push(`Internal Note,"${meta.internalNote.replace(/"/g, '""')}"`);
  lines.push("");

  if (regime) {
    lines.push("Market Regime");
    lines.push(`Regime Label,${regime.label ?? ""}`);
    lines.push(`Trend,${regime.trend ?? ""}`);
    lines.push(`Breadth,${regime.breadth ?? ""}`);
    lines.push(`Volatility,${regime.volatility ?? ""}`);
    lines.push(`Liquidity,${regime.liquidity ?? ""}`);
    lines.push(`Composite,${regime.composite ?? ""}`);
    lines.push("");
  }

  const diagnostics = result.diagnostics as Record<string, unknown> | undefined;
  if (diagnostics) {
    lines.push("Portfolio Diagnostics");
    lines.push(`Expected Volatility,${formatPct(diagnostics.expectedVolatility as number)}`);
    lines.push(`HHI,${(diagnostics.hhi as number)?.toFixed(3) ?? ""}`);
    lines.push(`Effective Number of Bets,${(diagnostics.effectiveNumberOfBets as number)?.toFixed(2) ?? ""}`);
    lines.push(`Diversification Score,${diagnostics.diversificationScore ?? ""}`);
    lines.push("");
  }

  lines.push("Final Allocation");
  lines.push("Ticker,Name,Sector,Weight,Prior Weight,Change,Composite Score,Mom20,Mom60,Mom120,Mom252,TrendQuality,RealizedVol60,Drawdown,MeanReversion,Active");
  for (const a of allocations) {
    const fs = a.factorScores as Record<string, number> | undefined;
    lines.push([
      a.ticker ?? "",
      `"${a.name ?? ""}"`,
      `"${a.sector ?? ""}"`,
      formatPct(a.weight as number),
      formatPct(a.priorWeight as number),
      formatPctChange(a.change as number),
      fs?.composite ?? "",
      fs?.mom20 ?? "",
      fs?.mom60 ?? "",
      fs?.mom120 ?? "",
      fs?.mom252 ?? "",
      fs?.trendQuality ?? "",
      fs?.realizedVol60 ?? "",
      fs?.drawdown ?? "",
      fs?.meanReversion ?? "",
      a.active ? "Yes" : "No",
    ].join(","));
  }

  const watchlist = (result.watchlist ?? []) as Array<Record<string, unknown>>;
  if (watchlist.length > 0) {
    lines.push("");
    lines.push("Watchlist");
    lines.push("Ticker,Name,Sector,Composite Score,Blocking Reason,Improvement Needed");
    for (const w of watchlist) {
      lines.push([
        w.ticker ?? "",
        `"${w.name ?? ""}"`,
        `"${w.sector ?? ""}"`,
        w.compositeScore ?? "",
        w.blockingReason ?? "",
        `"${w.improvement ?? ""}"`,
      ].join(","));
    }
  }

  return lines.join("\n");
}

// ── PDF builder ────────────────────────────────────────────────────────────
// One-page landscape committee report. Left column: exec summary, allocation
// table, diagnostics strip. Right column: regime card, donut, factor heatmap,
// risks, watchlist. Footer: methodology + internal note.
function generatePdf(result: Record<string, unknown>, meta: ReportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: { top: 28, left: 28, right: 28, bottom: 4 },
      size: "A4",
      layout: "landscape",
      compress: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const allocations = (result.allocations ?? []) as Array<Record<string, unknown>>;
    const regime = result.regime as Record<string, unknown> | undefined;
    const diagnostics = result.diagnostics as Record<string, unknown> | undefined;
    const icSummary = result.icSummary as Record<string, unknown> | undefined;
    const watchlist = (result.watchlist ?? []) as Array<Record<string, unknown>>;

    const runDate = ((result.runAt as string | undefined) ?? "").slice(0, 10);
    const title = meta.title || "Committee Report";
    const subtitle = meta.subtitle || (result.label as string | undefined) || `Run ${runDate}`;
    const portfolioName = meta.portfolioName || "Allocation Lab v2";
    const reportDate = meta.reportDate || runDate;

    const M = 28;
    const PAGE_W = doc.page.width - M * 2;
    const PAGE_H = doc.page.height - M * 2;
    const HEADER_H = 46;

    // ── Header band ──────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, HEADER_H).fill(NAVY);
    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(portfolioName, M, 9, { width: PAGE_W * 0.65 });
    doc
      .fillColor("#C7D2E5")
      .font("Helvetica")
      .fontSize(8.5)
      .text(`${title} — ${truncate(subtitle, 70)}`, M, 27, { width: PAGE_W * 0.65 });

    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`Report Date: ${reportDate}`, M, 12, { width: PAGE_W, align: "right" });
    doc
      .fillColor("#C7D2E5")
      .font("Helvetica")
      .fontSize(7.5)
      .text(`Price data through ${result.priceDataEnd ?? "—"}`, M, 27, { width: PAGE_W, align: "right" });

    const bodyTop = HEADER_H + 10;
    const colGap = 14;
    const leftW = PAGE_W * 0.62;
    const rightW = PAGE_W - leftW - colGap;
    const rightX = M + leftW + colGap;

    // ── Section heading helper ───────────────────────────────────────────
    function sectionHeading(text: string, x: number, y: number, w: number): number {
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(text.toUpperCase(), x, y, { width: w, characterSpacing: 0.3 });
      doc.moveTo(x, y + 12).lineTo(x + w, y + 12).strokeColor(BORDER).lineWidth(0.75).stroke();
      return y + 17;
    }

    // ════════════════════════════════════════════════════════════════════
    // LEFT COLUMN
    // ════════════════════════════════════════════════════════════════════
    let ly = bodyTop;

    // Executive summary
    ly = sectionHeading("Executive Summary", M, ly, leftW);
    const execText = truncate(
      [icSummary?.whatChanged, icSummary?.why].filter(Boolean).join(" "),
      420
    ) || "No committee narrative available for this session.";
    doc.fillColor(BLACK).font("Helvetica").fontSize(8).text(execText, M, ly, { width: leftW, lineGap: 1.5 });
    ly = doc.y + 8;

    // Summary KPI strip
    const kpis = [
      { label: "Cash Weight", value: formatPct(result.cashWeight as number) },
      { label: "Cash Change", value: formatPctChange(result.cashChange as number) },
      { label: "Active ETFs", value: String(result.activeEtfCount ?? "—") },
      { label: "Invested Sleeve", value: formatPct(result.investedSleeve as number) },
    ];
    const kpiColW = leftW / kpis.length;
    kpis.forEach((k, i) => {
      const x = M + i * kpiColW;
      doc.rect(x, ly, kpiColW - 5, 34).fill(LIGHT_GRAY);
      doc.fillColor(GRAY).font("Helvetica").fontSize(6.5).text(k.label.toUpperCase(), x + 6, ly + 5, { width: kpiColW - 12 });
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11).text(k.value, x + 6, ly + 16, { width: kpiColW - 12 });
    });
    ly += 42;

    // Diagnostics strip
    if (diagnostics) {
      const diagItems = [
        { label: "Expected Vol", value: formatPct(diagnostics.expectedVolatility as number) },
        { label: "HHI", value: (diagnostics.hhi as number)?.toFixed(3) ?? "—" },
        { label: "Eff. # Bets", value: (diagnostics.effectiveNumberOfBets as number)?.toFixed(1) ?? "—" },
        { label: "Diversification", value: `${Math.round((diagnostics.diversificationScore as number) ?? 0)}/100` },
      ];
      const dColW = leftW / diagItems.length;
      diagItems.forEach((d, i) => {
        const x = M + i * dColW;
        doc.fillColor(GRAY).font("Helvetica").fontSize(6.5).text(d.label.toUpperCase(), x, ly, { width: dColW - 6 });
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(d.value, x, ly + 9, { width: dColW - 6 });
      });
      ly += 26;
    }

    // Final allocation table
    ly = sectionHeading("Final Allocation & Changes vs. Prior Month", M, ly, leftW);

    const cols = [
      { label: "Ticker", w: 40, align: "left" as const },
      { label: "Sector", w: leftW - 40 - 55 - 50 - 55 - 40 - 44, align: "left" as const },
      { label: "Weight", w: 55, align: "right" as const },
      { label: "Prior", w: 50, align: "right" as const },
      { label: "Change", w: 55, align: "right" as const },
      { label: "Score", w: 40, align: "right" as const },
      { label: "Status", w: 44, align: "center" as const },
    ];

    const tableX = M;
    let tableY = ly;
    const ROW_H = 13.5;
    const TABLE_HEADER_H = 15;

    doc.rect(tableX, tableY, leftW, TABLE_HEADER_H).fill(NAVY);
    let cx = tableX + 4;
    cols.forEach((col) => {
      doc.fillColor("white").font("Helvetica-Bold").fontSize(6.8).text(col.label, cx, tableY + 4, { width: col.w - 4, align: col.align });
      cx += col.w;
    });
    tableY += TABLE_HEADER_H;

    const active = allocations.filter((a) => a.active);
    const inactive = allocations.filter((a) => !a.active);
    const sorted = [...active, ...inactive];

    // Reserve space for footer + internal note; clip rows to fit one page.
    const maxTableBottom = PAGE_H + HEADER_H - 46;
    const maxRows = Math.max(0, Math.floor((maxTableBottom - tableY) / ROW_H));
    const shown = sorted.slice(0, maxRows);
    const omitted = sorted.length - shown.length;

    shown.forEach((a, idx) => {
      const rowBg = idx % 2 === 0 ? "white" : LIGHT_GRAY;
      doc.rect(tableX, tableY, leftW, ROW_H).fill(rowBg);

      const fs = a.factorScores as Record<string, number> | undefined;
      const change = a.change as number | undefined;
      const changeStr = formatPctChange(change);
      const changeColor = (change ?? 0) > 0 ? GREEN : (change ?? 0) < 0 ? RED : GRAY;
      const isActive = Boolean(a.active);

      const rowValues: { text: string; color?: string }[] = [
        { text: String(a.ticker ?? ""), color: NAVY },
        { text: truncate(String(a.sector ?? ""), 22) },
        { text: formatPct(a.weight as number) },
        { text: formatPct(a.priorWeight as number) },
        { text: changeStr, color: changeColor },
        { text: String(fs?.composite?.toFixed(0) ?? "—") },
        { text: isActive ? "Active" : "—", color: isActive ? GREEN : GRAY },
      ];

      let rx = tableX + 4;
      cols.forEach((col, ci) => {
        const val = rowValues[ci];
        doc
          .fillColor(val?.color ?? BLACK)
          .font(ci === 0 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(6.8)
          .text(val?.text ?? "", rx, tableY + 3.5, { width: col.w - 4, align: col.align });
        rx += col.w;
      });

      tableY += ROW_H;
    });

    if (omitted > 0) {
      doc.fillColor(GRAY).font("Helvetica-Oblique").fontSize(6.5).text(`+ ${omitted} more position(s) — see full CSV export.`, tableX, tableY + 2, { width: leftW });
    }

    // ════════════════════════════════════════════════════════════════════
    // RIGHT COLUMN
    // ════════════════════════════════════════════════════════════════════
    let ry = bodyTop;

    // Regime card
    ry = sectionHeading("Market Regime", rightX, ry, rightW);
    if (regime) {
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text(String(regime.label ?? "—"), rightX, ry);
      doc.fillColor(GRAY).font("Helvetica").fontSize(7.5).text(`Composite ${Math.round((regime.composite as number) ?? 0)}/100  •  Confidence ${Math.round((regime.confidence as number) ?? 0)}%`, rightX, doc.y + 1);
      ry = doc.y + 6;

      const regimeFields: [string, number][] = [
        ["Trend", regime.trend as number],
        ["Breadth", regime.breadth as number],
        ["Volatility", regime.volatility as number],
        ["Liquidity", regime.liquidity as number],
      ];
      regimeFields.forEach(([label, score]) => {
        doc.fillColor(GRAY).font("Helvetica").fontSize(6.8).text(label, rightX, ry, { width: 50 });
        const barX = rightX + 52;
        const barW = rightW - 52 - 22;
        doc.rect(barX, ry + 1, barW, 5).fill(BORDER);
        doc.rect(barX, ry + 1, barW * Math.max(0, Math.min(1, (score ?? 0) / 100)), 5).fill(scoreColor(score ?? 0));
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(6.8).text(String(Math.round(score ?? 0)), barX + barW + 4, ry);
        ry += 10;
      });
      ry += 4;
    }

    // Allocation donut — full-width, all positions
    ry = sectionHeading("Allocation Mix", rightX, ry, rightW);
    const donutSlices = [
      ...active.map((a) => ({ label: String(a.ticker), value: a.weight as number })),
      { label: "Cash", value: result.cashWeight as number },
    ].filter((s) => s.value > 0.001);

    const rOuter = 50;
    const rInner = 22;
    const cxCenter = rightX + rightW / 2;
    const cyCenter = ry + rOuter + 4;
    let angleStart = -Math.PI / 2;
    const palette = ["#1B2F5B", "#2A4170", "#3B5284", "#4C6398", "#6B84B5", "#8DA4CC", "#A8B4D1", "#C1D2EE", "#D8E4F5"];
    donutSlices.forEach((s, i) => {
      const angleSweep = s.value * 2 * Math.PI;
      const color = s.label === "Cash" ? "#CBD5E1" : palette[i % palette.length];
      doc.save();
      doc.path(donutArcPath(cxCenter, cyCenter, rOuter, rInner, angleStart, angleStart + angleSweep)).fill(color);
      doc.restore();
      angleStart += angleSweep;
    });
    // Center label
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7).text("100%", cxCenter - 14, cyCenter - 5, { width: 28, align: "center" });
    ry = cyCenter + rOuter + 8;

    // Legend — all items, 2-column grid below the donut
    const legendItems = [...donutSlices].sort((a, b) => b.value - a.value);
    const legendColW = rightW / 2;
    legendItems.forEach((s, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = rightX + col * legendColW;
      const ly = ry + row * 11;
      const color = s.label === "Cash" ? "#94A3B8" : palette[donutSlices.findIndex((d) => d.label === s.label) % palette.length];
      doc.rect(lx, ly + 2, 6, 6).fill(color);
      doc.fillColor(BLACK).font("Helvetica").fontSize(6.5)
        .text(`${s.label}  ${(s.value * 100).toFixed(1)}%`, lx + 9, ly, { width: legendColW - 12 });
    });
    ry += Math.ceil(legendItems.length / 2) * 11 + 8;

    // Factor heatmap (compact grid: top active tickers x key factors)
    ry = sectionHeading("Factor Heatmap", rightX, ry, rightW);
    const heatmapFactors: [string, string][] = [
      ["mom60", "M60"],
      ["trendQuality", "TrQ"],
      ["realizedVol60", "Vol"],
      ["drawdown", "DD"],
      ["composite", "Comp"],
    ];
    const heatTickers = active;
    const cellW = (rightW - 34) / heatmapFactors.length;
    const cellH = 12;
    // header row
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(6).text("", rightX, ry, { width: 34 });
    heatmapFactors.forEach(([, label], i) => {
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(6).text(label, rightX + 34 + i * cellW, ry, { width: cellW, align: "center" });
    });
    let heatY = ry + 10;
    heatTickers.forEach((a) => {
      const fs = a.factorScores as Record<string, number> | undefined;
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(6.5).text(String(a.ticker ?? ""), rightX, heatY + 3, { width: 34 });
      heatmapFactors.forEach(([key], i) => {
        const val = fs?.[key] ?? 0;
        const x = rightX + 34 + i * cellW;
        doc.rect(x + 1, heatY, cellW - 2, cellH).fill(scoreColor(val));
        doc.fillColor("white").font("Helvetica-Bold").fontSize(6).text(String(Math.round(val)), x + 1, heatY + 3, { width: cellW - 2, align: "center" });
      });
      heatY += cellH + 1;
    });
    ry = heatY + 6;

    // Top risks
    ry = sectionHeading("Top Risks", rightX, ry, rightW);
    const risksText = truncate(String(icSummary?.risks ?? ""), 220) || "No risks flagged for this session.";
    doc.fillColor(BLACK).font("Helvetica").fontSize(7).text(risksText, rightX, ry, { width: rightW, lineGap: 1 });
    ry = doc.y + 6;

    // Watchlist (compact)
    if (ry < PAGE_H + HEADER_H - 50) {
      ry = sectionHeading("Watchlist", rightX, ry, rightW);
      if (watchlist.length === 0) {
        doc.fillColor(GRAY).font("Helvetica-Oblique").fontSize(7).text("No ETFs currently on watch.", rightX, ry);
        ry = doc.y + 4;
      } else {
        watchlist.slice(0, 3).forEach((w) => {
          doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(6.8).text(String(w.ticker ?? ""), rightX, ry, { continued: true, width: rightW });
          doc.fillColor(GRAY).font("Helvetica").fontSize(6.8).text(`  ${truncate(String(w.improvement ?? ""), 60)}`, { width: rightW });
          ry = doc.y + 2;
        });
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 24;
    doc.moveTo(M, footerY - 4).lineTo(doc.page.width - M, footerY - 4).strokeColor(BORDER).lineWidth(0.5).stroke();
    const methodologyLine = "Methodology: factor & regime scores computed from real uploaded price data only (0–100 cross-sectional ranks); no synthetic values.";
    doc.fillColor(GRAY).font("Helvetica").fontSize(6.5).text(methodologyLine, M, footerY, { width: PAGE_W * 0.65 });
    if (meta.internalNote) {
      doc.fillColor(AMBER).font("Helvetica-Oblique").fontSize(6.5).text(`Internal note: ${truncate(meta.internalNote, 140)}`, M, footerY + 9, { width: PAGE_W * 0.65 });
    }
    doc.fillColor(GRAY).font("Helvetica").fontSize(6.5).text(
      `Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC  •  For internal use only`,
      M, footerY, { width: PAGE_W, align: "right" }
    );

    doc.end();
  });
}

// Builds an SVG-style path string for a donut slice between two angles.
function donutArcPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(rOuter, startAngle);
  const [x2, y2] = p(rOuter, endAngle);
  const [x3, y3] = p(rInner, endAngle);
  const [x4, y4] = p(rInner, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

// ── Routes ─────────────────────────────────────────────────────────────────
router.post("/reports/generate", async (req, res): Promise<void> => {
  const parsed = GenerateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { format, sessionId, title, subtitle, reportDate, portfolioName, internalNote } = parsed.data;
  const meta: ReportMeta = { title, subtitle, reportDate, portfolioName, internalNote };

  let resultRow;
  if (sessionId != null) {
    const rows = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);
    resultRow = rows[0] ?? null;
  } else {
    const rows = await db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.runAt))
      .limit(1);
    resultRow = rows[0] ?? null;
  }

  if (!resultRow) {
    res.status(404).json({ error: "No session found. Run the pipeline first." });
    return;
  }

  const result = resultRow.resultJson as Record<string, unknown>;
  const token = randomBytes(24).toString("hex");
  const generatedAt = new Date().toISOString();
  const runDate = (result.runAt as string | undefined)?.slice(0, 10) ?? "report";

  let data: Buffer | string;
  let contentType: string;
  let filename: string;

  if (format === "pdf") {
    data = await generatePdf(result, meta);
    contentType = "application/pdf";
    filename = `allocation-lab-committee-report-${runDate}.pdf`;
  } else {
    data = generateCsv(result, meta);
    contentType = "text/csv";
    filename = `allocation-lab-${runDate}.csv`;
  }

  reportTokens.set(token, { contentType, filename, data, expiresAt: Date.now() + 10 * 60 * 1000 });

  res.json(GenerateReportResponse.parse({ format, downloadToken: token, filename, generatedAt }));
});

router.get("/reports/download/:token", async (req, res): Promise<void> => {
  const rawToken = Array.isArray(req.params.token)
    ? req.params.token[0]
    : req.params.token;

  const entry = reportTokens.get(rawToken);
  if (!entry || Date.now() > entry.expiresAt) {
    reportTokens.delete(rawToken);
    res.status(404).json({ error: "Report token not found or expired." });
    return;
  }

  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
  res.send(entry.data);
});

export default router;
