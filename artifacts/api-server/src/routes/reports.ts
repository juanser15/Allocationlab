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
const GRAY = "#64748B";
const LIGHT_GRAY = "#F1F5F9";
const BLACK = "#0F172A";
const GREEN = "#15803D";
const RED = "#B91C1C";

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

// ── CSV builder ────────────────────────────────────────────────────────────
function generateCsv(result: Record<string, unknown>): string {
  const allocations = (result.allocations ?? []) as Array<Record<string, unknown>>;
  const regime = result.regime as Record<string, unknown> | undefined;
  const lines: string[] = [];

  lines.push("Allocation Lab v2 — Run Report");
  lines.push(`Run Date,${result.runAt ?? ""}`);
  lines.push(`Label,${result.label ?? ""}`);
  lines.push(`Cash Weight,${formatPct(result.cashWeight as number)}`);
  lines.push(`Cash Change,${formatPctChange(result.cashChange as number)}`);
  lines.push(`Active ETFs,${result.activeEtfCount ?? ""}`);
  lines.push(`Invested Sleeve,${formatPct(result.investedSleeve as number)}`);
  lines.push(`Price Data Through,${result.priceDataEnd ?? ""}`);
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

  return lines.join("\n");
}

// ── PDF builder ────────────────────────────────────────────────────────────
function generatePdf(result: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4", compress: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const allocations = (result.allocations ?? []) as Array<Record<string, unknown>>;
    const regime = result.regime as Record<string, unknown> | undefined;
    const runDate = ((result.runAt as string | undefined) ?? "").slice(0, 10);
    const label = (result.label as string | undefined) ?? `Run ${runDate}`;
    const PAGE_W = doc.page.width - 96; // usable width

    // ── Header bar ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 56).fill(NAVY);
    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Allocation Lab v2", 48, 16, { continued: true })
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#CBD5E1")
      .text(`   —   ${label}`, { baseline: "middle" });

    doc.moveDown(2);

    // ── Summary row ───────────────────────────────────────────────────────
    const summaryY = doc.y;
    const colW = PAGE_W / 4;

    const summaryItems = [
      { label: "Run Date", value: runDate },
      { label: "Cash Weight", value: formatPct(result.cashWeight as number) },
      { label: "Cash Change", value: formatPctChange(result.cashChange as number) },
      { label: "Active ETFs", value: String(result.activeEtfCount ?? "—") },
    ];

    summaryItems.forEach((item, i) => {
      const x = 48 + i * colW;
      doc.rect(x, summaryY, colW - 6, 52).fill(LIGHT_GRAY);
      doc
        .fillColor(GRAY)
        .font("Helvetica")
        .fontSize(8)
        .text(item.label.toUpperCase(), x + 8, summaryY + 8);
      doc
        .fillColor(BLACK)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(item.value, x + 8, summaryY + 20);
    });

    doc.y = summaryY + 64;

    // ── Regime section ────────────────────────────────────────────────────
    if (regime) {
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Market Regime", 48);
      doc.moveDown(0.3);

      const regimeFields = [
        ["Regime", String(regime.label ?? "")],
        ["Composite", String(regime.composite ?? "")],
        ["Trend", String(regime.trend ?? "")],
        ["Breadth", String(regime.breadth ?? "")],
        ["Volatility", String(regime.volatility ?? "")],
        ["Liquidity", String(regime.liquidity ?? "")],
      ];

      const rColW = PAGE_W / 3;
      const rStartY = doc.y;
      regimeFields.forEach(([k, v], i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 48 + col * rColW;
        const y = rStartY + row * 22;
        doc.fillColor(GRAY).font("Helvetica").fontSize(8).text(`${k}:`, x, y, { continued: true });
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(8).text(`  ${v}`);
      });

      doc.y = rStartY + Math.ceil(regimeFields.length / 3) * 22 + 10;
    }

    // ── Allocation table ──────────────────────────────────────────────────
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Final Allocation", 48);
    doc.moveDown(0.4);

    // Table headers
    const cols = [
      { label: "Ticker",       w: 50,  align: "left"  as const },
      { label: "Sector",       w: 130, align: "left"  as const },
      { label: "Weight",       w: 60,  align: "right" as const },
      { label: "Prior",        w: 60,  align: "right" as const },
      { label: "Change",       w: 60,  align: "right" as const },
      { label: "Score",        w: 44,  align: "right" as const },
      { label: "Status",       w: 50,  align: "center" as const },
    ];

    const tableX = 48;
    let tableY = doc.y;
    const ROW_H = 18;
    const HEADER_H = 20;

    // Header background
    doc.rect(tableX, tableY, PAGE_W, HEADER_H).fill(NAVY);
    let cx = tableX + 4;
    cols.forEach((col) => {
      doc
        .fillColor("white")
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(col.label, cx, tableY + 6, { width: col.w - 4, align: col.align });
      cx += col.w;
    });
    tableY += HEADER_H;

    // Rows
    const active = allocations.filter((a) => a.active);
    const inactive = allocations.filter((a) => !a.active);
    const sorted = [...active, ...inactive];

    sorted.forEach((a, idx) => {
      if (tableY + ROW_H > doc.page.height - 60) {
        doc.addPage();
        tableY = 48;
      }

      const rowBg = idx % 2 === 0 ? "white" : LIGHT_GRAY;
      doc.rect(tableX, tableY, PAGE_W, ROW_H).fill(rowBg);

      const fs = a.factorScores as Record<string, number> | undefined;
      const change = a.change as number | undefined;
      const changeStr = formatPctChange(change);
      const changeColor = (change ?? 0) > 0 ? GREEN : (change ?? 0) < 0 ? RED : GRAY;
      const isActive = Boolean(a.active);

      const rowValues: { text: string; color?: string }[] = [
        { text: String(a.ticker ?? ""), color: NAVY },
        { text: String(a.sector ?? "") },
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
          .fontSize(7.5)
          .text(val?.text ?? "", rx, tableY + 5, { width: col.w - 4, align: col.align });
        rx += col.w;
      });

      tableY += ROW_H;
    });

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 36;
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `Allocation Lab v2  •  Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC  •  For internal use only`,
        48,
        footerY,
        { width: PAGE_W, align: "center" }
      );

    doc.end();
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────
router.post("/reports/generate", async (req, res): Promise<void> => {
  const parsed = GenerateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { format, sessionId } = parsed.data;

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
    data = await generatePdf(result);
    contentType = "application/pdf";
    filename = `allocation-lab-${runDate}.pdf`;
  } else {
    data = generateCsv(result);
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
