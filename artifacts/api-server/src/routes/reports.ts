import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GenerateReportBody,
  GenerateReportResponse,
} from "@workspace/api-zod";
import { randomBytes } from "crypto";

const router: IRouter = Router();

// In-memory token store (tokens expire after 10 minutes)
const reportTokens = new Map<string, { format: string; data: string; expiresAt: number }>();

function generateCsv(result: Record<string, unknown>): string {
  const allocations = (result.allocations ?? []) as Array<Record<string, unknown>>;
  const regime = result.regime as Record<string, unknown> | undefined;
  const lines: string[] = [];

  lines.push("Allocation Lab v2 — Run Report");
  lines.push(`Run Date,${result.runAt ?? ""}`);
  lines.push(`Label,${result.label ?? ""}`);
  lines.push(`Cash Weight,${formatPct(result.cashWeight as number)}`);
  lines.push(`Cash Change,${formatPct(result.cashChange as number)}`);
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
      formatPct(a.change as number),
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

function formatPct(v: number | undefined): string {
  if (v === undefined || v === null) return "";
  return (v * 100).toFixed(2) + "%";
}

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

  let data: string;
  let contentType: string;
  let filename: string;

  if (format === "csv") {
    data = generateCsv(result);
    contentType = "text/csv";
    filename = `allocation-lab-${runDate}.csv`;
  } else {
    // PDF and PNG: return CSV for now (client-side PDF/PNG generation is recommended)
    data = generateCsv(result);
    contentType = "text/csv";
    filename = `allocation-lab-${runDate}.csv`;
  }

  reportTokens.set(token, {
    format: contentType,
    data,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const response = {
    format,
    downloadToken: token,
    filename,
    generatedAt,
  };

  res.json(GenerateReportResponse.parse(response));
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

  res.setHeader("Content-Type", entry.format);
  res.setHeader("Content-Disposition", `attachment`);
  res.send(entry.data);
});

export default router;
