import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { GetAttributionMetaResponse, GetAttributionResponse } from "@workspace/api-zod";
import { parseCsv, computeRealizedReturn, type PriceRow, type AllocationResult } from "../lib/calculator";
import {
  computeEtfContribution,
  computeDecisionAttribution,
  computeFactorAttribution,
  computeCostAttribution,
  computeBenchmarkComparison,
  buildReportSummary,
} from "../lib/attribution";
import { getLatestPriceData } from "./prices";

const router: IRouter = Router();

type SessionRow = typeof sessionsTable.$inferSelect;

const METHODOLOGY_NOTE =
  "Attribution decomposes REALIZED performance of a saved rebalance version using uploaded price history from the rebalance date forward. It never uses hypothetical or synthetic returns. Sections that require data not yet available (benchmark prices, sufficient factor-score variance, or a second saved version for regime attribution) are shown as explicitly unavailable rather than estimated.";

function sessionLabel(s: SessionRow): string {
  return s.label ? `${s.label} (#${s.id})` : `Session #${s.id}`;
}

async function loadVersions() {
  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt));
  return sessions
    .filter((s) => !!(s.resultJson as Record<string, unknown>)?.allocations)
    .map((s) => ({ id: s.id, label: sessionLabel(s), runAt: s.runAt instanceof Date ? s.runAt.toISOString() : String(s.runAt) }));
}

async function loadSession(versionId: number | null): Promise<SessionRow | undefined> {
  if (versionId) {
    const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, versionId)).limit(1);
    return rows[0];
  }
  const rows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
  return rows[0];
}

router.get("/attribution/meta", async (req, res): Promise<void> => {
  const versionIdParam = typeof req.query.versionId === "string" ? parseInt(req.query.versionId, 10) : null;
  const benchmarkTicker = typeof req.query.benchmarkTicker === "string" ? req.query.benchmarkTicker.toUpperCase() : null;

  const versions = await loadVersions();
  const session = await loadSession(versionIdParam || null);

  if (!session) {
    res.json(
      GetAttributionMetaResponse.parse({
        ready: false,
        reason: "No saved portfolio version found. Run and save a rebalance in Portfolio Lab first.",
        hasSession: false,
        hasRealizedHistory: false,
        hasPriorWeights: false,
        benchmarkAvailable: false,
        versions,
        selectedSessionId: null,
        runAt: null,
      })
    );
    return;
  }

  const stored = session.resultJson as Record<string, unknown>;
  const allocations = (stored.allocations ?? []) as AllocationResult[];
  const hasPriorWeights = allocations.some((a) => a.priorWeight > 0);

  const priceRow = await getLatestPriceData();
  const runAtDate = (session.runAt instanceof Date ? session.runAt : new Date(session.runAt)).toISOString().slice(0, 10);

  let hasRealizedHistory = false;
  let benchmarkAvailable = false;
  if (priceRow) {
    try {
      const priceRows = parseCsv(priceRow.csvContent);
      const after = priceRows.filter((r) => r.date >= runAtDate);
      hasRealizedHistory = after.length >= 2;
      if (benchmarkTicker) {
        benchmarkAvailable = after.filter((r) => r.prices[benchmarkTicker] !== undefined).length >= 2;
      }
    } catch {
      hasRealizedHistory = false;
    }
  }

  const ready = hasRealizedHistory;
  const reason = ready
    ? null
    : !priceRow
      ? "No price data uploaded. Upload a price CSV in Portfolio Construction to compute realized performance."
      : `No price history is available on or after ${runAtDate} (the rebalance date). Upload more recent price data to attribute realized performance.`;

  res.json(
    GetAttributionMetaResponse.parse({
      ready,
      reason,
      hasSession: true,
      hasRealizedHistory,
      hasPriorWeights,
      benchmarkAvailable,
      versions,
      selectedSessionId: session.id,
      runAt: session.runAt instanceof Date ? session.runAt.toISOString() : String(session.runAt),
    })
  );
});

router.get("/attribution", async (req, res): Promise<void> => {
  const versionIdParam = typeof req.query.versionId === "string" ? parseInt(req.query.versionId, 10) : null;
  const benchmarkTickerParam = typeof req.query.benchmarkTicker === "string" ? req.query.benchmarkTicker.toUpperCase() : null;
  const transactionCostBps = typeof req.query.transactionCostBps === "string" ? parseFloat(req.query.transactionCostBps) : 5;
  const slippageBps = typeof req.query.slippageBps === "string" ? parseFloat(req.query.slippageBps) : 3;
  const cashYieldAnnualPct = typeof req.query.cashYieldAnnualPct === "string" ? parseFloat(req.query.cashYieldAnnualPct) : 4.5;

  const versions = await loadVersions();
  const session = await loadSession(versionIdParam || null);

  const empty = (reason: string) =>
    GetAttributionResponse.parse({
      hasSufficientData: false,
      insufficientReason: reason,
      sessionId: null,
      versionLabel: null,
      runAt: null,
      asOfDate: null,
      versions,
      etfContribution: null,
      decisionAttribution: null,
      factorAttribution: null,
      regimeAttribution: null,
      costAttribution: null,
      benchmarkComparison: null,
      reportSummary: null,
      methodologyNote: METHODOLOGY_NOTE,
    });

  if (!session) {
    res.json(empty("No saved portfolio version found. Run and save a rebalance in Portfolio Lab first."));
    return;
  }

  const stored = session.resultJson as Record<string, unknown>;
  const allocations = (stored.allocations ?? []) as AllocationResult[];
  if (allocations.length === 0) {
    res.json(empty("This saved version has no allocation data to attribute."));
    return;
  }

  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.json(empty("No price data uploaded. Upload a price CSV in Portfolio Construction to compute realized performance."));
    return;
  }

  let priceRows: PriceRow[];
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch {
    res.json(empty("Could not parse the uploaded price data."));
    return;
  }

  const runAtDate = (session.runAt instanceof Date ? session.runAt : new Date(session.runAt)).toISOString().slice(0, 10);
  const sorted = priceRows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const asOfDate = sorted.length > 0 ? sorted[sorted.length - 1].date : null;

  if (!asOfDate || asOfDate <= runAtDate) {
    res.json(empty(`No price history is available on or after ${runAtDate} (the rebalance date). Upload more recent price data to attribute realized performance.`));
    return;
  }

  const cashWeight = (stored.cashWeight as number) ?? 0;
  const cashPriorWeight = (stored.cashPriorWeight as number) ?? 0;
  const cashChange = (stored.cashChange as number) ?? cashWeight - cashPriorWeight;
  const regime = (stored.regime as { label?: string; composite?: number } | undefined) ?? {};

  const etfContribution = computeEtfContribution(priceRows, allocations, cashWeight, cashPriorWeight, runAtDate, asOfDate, cashYieldAnnualPct);
  const decisionAttribution = computeDecisionAttribution(allocations, etfContribution, cashChange);
  const factorAttribution = computeFactorAttribution(allocations, etfContribution, regime.label ?? "Neutral", regime.composite ?? 50);
  const costAttribution = computeCostAttribution(allocations, etfContribution.totalPortfolioReturn, transactionCostBps, slippageBps);
  const benchmarkComparison = computeBenchmarkComparison(
    priceRows,
    allocations,
    cashWeight,
    cashYieldAnnualPct,
    runAtDate,
    asOfDate,
    benchmarkTickerParam,
    etfContribution.totalPortfolioReturn,
    etfContribution
  );
  const reportSummary = buildReportSummary(etfContribution, decisionAttribution, benchmarkComparison);

  // Regime attribution requires at least two saved versions to bucket realized
  // periods by the regime label active at the start of each period.
  const allSessions = (await db.select().from(sessionsTable).orderBy(sessionsTable.runAt)).filter(
    (s) => !!(s.resultJson as Record<string, unknown>)?.allocations
  );
  let regimeAttribution;
  if (allSessions.length < 2) {
    regimeAttribution = {
      available: false,
      reason: "At least two saved rebalance versions are required to attribute realized performance by regime.",
      buckets: [],
    };
  } else {
    const byRegime = new Map<string, { count: number; totalReturn: number }>();
    for (let i = 0; i < allSessions.length - 1; i++) {
      const from = allSessions[i];
      const to = allSessions[i + 1];
      const fromStored = from.resultJson as Record<string, unknown>;
      const fromAllocations = (fromStored.allocations ?? []) as AllocationResult[];
      const fromDateStr = (from.runAt instanceof Date ? from.runAt : new Date(from.runAt)).toISOString().slice(0, 10);
      const toDateStr = (to.runAt instanceof Date ? to.runAt : new Date(to.runAt)).toISOString().slice(0, 10);
      const holdings = fromAllocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }));
      const { returnPct } = computeRealizedReturn(priceRows, holdings, fromDateStr, toDateStr);
      if (returnPct === null) continue;
      const label = from.regimeLabel ?? "Unknown";
      const bucket = byRegime.get(label) ?? { count: 0, totalReturn: 0 };
      bucket.count += 1;
      bucket.totalReturn += returnPct;
      byRegime.set(label, bucket);
    }
    const buckets = Array.from(byRegime.entries()).map(([regimeLabel, v]) => ({
      regimeLabel,
      periodCount: v.count,
      avgRealizedReturn: v.count > 0 ? Math.round((v.totalReturn / v.count) * 10000) / 10000 : 0,
    }));
    regimeAttribution =
      buckets.length > 0
        ? { available: true, reason: null, buckets }
        : { available: false, reason: "No completed rebalance-to-rebalance periods have price coverage yet.", buckets: [] };
  }

  res.json(
    GetAttributionResponse.parse({
      hasSufficientData: true,
      insufficientReason: null,
      sessionId: session.id,
      versionLabel: sessionLabel(session),
      runAt: session.runAt instanceof Date ? session.runAt.toISOString() : String(session.runAt),
      asOfDate,
      versions,
      etfContribution,
      decisionAttribution,
      factorAttribution,
      regimeAttribution,
      costAttribution,
      benchmarkComparison,
      reportSummary,
      methodologyNote: METHODOLOGY_NOTE,
    })
  );
});

export default router;
