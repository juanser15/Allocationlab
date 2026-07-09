import { Router, type IRouter } from "express";
import { db, sessionsTable, decisionLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ListArchiveResponse,
  GetArchiveEntryResponse,
  CompareArchiveResponse,
} from "@workspace/api-zod";
import {
  parseCsv,
  computeTurnover,
  computeRealizedReturn,
  type AllocationResult,
  type EnrichedRegimeScores,
  type PortfolioDiagnostics,
  type IcSummary,
} from "../lib/calculator";
import { getLatestPriceData } from "./prices";

const router: IRouter = Router();

type SessionRow = typeof sessionsTable.$inferSelect;
type DecisionLogRow = typeof decisionLogsTable.$inferSelect;

function serializeDecisionLog(row: DecisionLogRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    portfolioVersion: row.portfolioVersion,
    status: row.status as "draft" | "under_review" | "approved",
    regimeLabel: row.regimeLabel,
    regimeComposite: row.regimeComposite,
    content: row.contentJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    approvedBy: row.approvedBy,
  };
}

function portfolioVersion(session: SessionRow): string {
  return session.label ? `${session.label} (#${session.id})` : `Session #${session.id}`;
}

function notesFor(session: SessionRow): string {
  const result = session.resultJson as Record<string, unknown>;
  const icSummary = result.icSummary as IcSummary | undefined;
  return icSummary?.whatChanged || session.label || "No committee narrative recorded for this rebalance.";
}

function backfillRegime(raw: unknown): EnrichedRegimeScores {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(r as object),
    components: (r.components as unknown[]) ?? [],
    confidence: (r.confidence as number) ?? 0,
    drivers: (r.drivers as string) ?? "Pre-Iteration-2 session. Re-run the pipeline to populate.",
  } as EnrichedRegimeScores;
}

function buildArchiveEntry(session: SessionRow, decisionLog: DecisionLogRow | null) {
  const result = session.resultJson as Record<string, unknown>;
  return {
    sessionId: session.id,
    runAt: session.runAt instanceof Date ? session.runAt.toISOString() : String(session.runAt),
    label: session.label,
    portfolioVersion: portfolioVersion(session),
    regime: backfillRegime(result.regime),
    allocations: (result.allocations ?? []) as AllocationResult[],
    cashWeight: session.cashWeight,
    cashChange: (result.cashChange as number) ?? 0,
    activeEtfCount: session.activeEtfCount,
    diagnostics: (result.diagnostics ?? {
      expectedVolatility: 0,
      hhi: 0,
      effectiveNumberOfBets: 0,
      diversificationScore: 0,
      riskContributions: [],
      correlationMatrix: [],
      activeTickers: [],
      trackingErrors: [],
      lookbackDays: 0,
      insufficientDataReasons: ["Pre-Iteration-3 session. Re-run the pipeline to generate diagnostics."],
    }) as PortfolioDiagnostics,
    decisionLog: decisionLog ? serializeDecisionLog(decisionLog) : null,
    reportAvailable: true,
    notes: notesFor(session),
  };
}

router.get("/archive", async (req, res): Promise<void> => {
  const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === "string" ? req.query.toDate : null;
  const regimeFilter = typeof req.query.regime === "string" ? req.query.regime : null;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
  const nameFilter = typeof req.query.portfolioName === "string" ? req.query.portfolioName.toLowerCase() : null;

  const sessionRows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt));
  const decisionLogRows = await db.select().from(decisionLogsTable);
  const decisionLogBySession = new Map(decisionLogRows.map((d) => [d.sessionId, d]));

  const availableRegimes = Array.from(new Set(sessionRows.map((s) => s.regimeLabel))).sort();
  const availablePortfolioNames = Array.from(new Set(sessionRows.map((s) => portfolioVersion(s)))).sort();

  let entries = sessionRows.map((session) => {
    const decisionLog = decisionLogBySession.get(session.id) ?? null;
    return {
      sessionId: session.id,
      runAt: session.runAt instanceof Date ? session.runAt.toISOString() : String(session.runAt),
      label: session.label,
      portfolioVersion: portfolioVersion(session),
      regimeLabel: session.regimeLabel,
      regimeComposite: session.regimeComposite,
      cashWeight: session.cashWeight,
      activeEtfCount: session.activeEtfCount,
      decisionLogStatus: (decisionLog?.status ?? "none") as "draft" | "under_review" | "approved" | "none",
      reportAvailable: true,
      notes: notesFor(session),
    };
  });

  if (fromDate) entries = entries.filter((e) => e.runAt.slice(0, 10) >= fromDate);
  if (toDate) entries = entries.filter((e) => e.runAt.slice(0, 10) <= toDate);
  if (regimeFilter) entries = entries.filter((e) => e.regimeLabel === regimeFilter);
  if (statusFilter) entries = entries.filter((e) => e.decisionLogStatus === statusFilter);
  if (nameFilter) entries = entries.filter((e) => e.portfolioVersion.toLowerCase().includes(nameFilter));

  res.json(ListArchiveResponse.parse({ entries, availableRegimes, availablePortfolioNames }));
});

router.get("/archive/compare", async (req, res): Promise<void> => {
  const rawA = Array.isArray(req.query.a) ? req.query.a[0] : req.query.a;
  const rawB = Array.isArray(req.query.b) ? req.query.b[0] : req.query.b;
  const idA = parseInt(String(rawA), 10);
  const idB = parseInt(String(rawB), 10);
  if (isNaN(idA) || isNaN(idB)) {
    res.status(400).json({ error: "Both `a` and `b` session IDs are required." });
    return;
  }

  const [rowsA, rowsB] = await Promise.all([
    db.select().from(sessionsTable).where(eq(sessionsTable.id, idA)).limit(1),
    db.select().from(sessionsTable).where(eq(sessionsTable.id, idB)).limit(1),
  ]);
  const sessionA = rowsA[0] as SessionRow | undefined;
  const sessionB = rowsB[0] as SessionRow | undefined;
  if (!sessionA || !sessionB) {
    res.status(404).json({ error: "One or both sessions were not found." });
    return;
  }

  const [decisionLogRowsA, decisionLogRowsB] = await Promise.all([
    db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, idA)).limit(1),
    db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, idB)).limit(1),
  ]);
  const decisionLogA = decisionLogRowsA[0] ?? null;
  const decisionLogB = decisionLogRowsB[0] ?? null;

  // Order chronologically so "a" is always the earlier period for diff/turnover purposes,
  // regardless of the order the caller passed the two IDs in.
  const [earlier, later, earlierLog, laterLog] =
    sessionA.runAt.getTime() <= sessionB.runAt.getTime()
      ? [sessionA, sessionB, decisionLogA, decisionLogB]
      : [sessionB, sessionA, decisionLogB, decisionLogA];

  const entryA = buildArchiveEntry(earlier, earlierLog);
  const entryB = buildArchiveEntry(later, laterLog);

  const cashWeightChange = Math.round((entryB.cashWeight - entryA.cashWeight) * 10000) / 10000;
  const regimeCompositeChange = Math.round((entryB.regime.composite - entryA.regime.composite) * 100) / 100;
  const activeEtfCountChange = entryB.activeEtfCount - entryA.activeEtfCount;

  const turnover = computeTurnover(
    entryA.allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight })),
    entryB.allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }))
  );

  const byTickerA = new Map(entryA.allocations.map((a) => [a.ticker, a]));
  const byTickerB = new Map(entryB.allocations.map((a) => [a.ticker, a]));
  const allTickers = new Set([...byTickerA.keys(), ...byTickerB.keys()]);

  const tickerChanges = Array.from(allTickers)
    .map((ticker) => {
      const a = byTickerA.get(ticker);
      const b = byTickerB.get(ticker);
      const weightA = a?.active ? a.weight : 0;
      const weightB = b?.active ? b.weight : 0;
      const deltaWeight = Math.round((weightB - weightA) * 10000) / 10000;
      const factorScoreA = a?.factorScores.composite ?? null;
      const factorScoreB = b?.factorScores.composite ?? null;
      const factorScoreChange = factorScoreA !== null && factorScoreB !== null ? Math.round((factorScoreB - factorScoreA) * 10) / 10 : null;

      let action: "ADD" | "REMOVE" | "INCREASE" | "DECREASE" | "HOLD" = "HOLD";
      if (weightA === 0 && weightB > 0) action = "ADD";
      else if (weightA > 0 && weightB === 0) action = "REMOVE";
      else if (deltaWeight > 0.0005) action = "INCREASE";
      else if (deltaWeight < -0.0005) action = "DECREASE";

      return {
        ticker,
        name: b?.name ?? a?.name ?? ticker,
        sector: b?.sector ?? a?.sector ?? "—",
        weightA,
        weightB,
        deltaWeight,
        factorScoreA,
        factorScoreB,
        factorScoreChange,
        action,
      };
    })
    .filter((c) => c.action !== "HOLD" || c.weightA > 0 || c.weightB > 0)
    .sort((x, y) => Math.abs(y.deltaWeight) - Math.abs(x.deltaWeight));

  const priceRow = await getLatestPriceData();
  let realizedReturn: number | null = null;
  let realizedReturnNote: string | null = null;
  if (!priceRow) {
    realizedReturnNote = "No price data uploaded — cannot compute a realized return between these periods.";
  } else {
    try {
      const priceRows = parseCsv(priceRow.csvContent);
      const fromDate = entryA.runAt.slice(0, 10);
      const toDate = entryB.runAt.slice(0, 10);
      const holdings = entryA.allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }));
      const { returnPct, reason } = computeRealizedReturn(priceRows, holdings, fromDate, toDate);
      realizedReturn = returnPct;
      realizedReturnNote = reason ?? `Realized return of the ${fromDate} allocation held through ${toDate}.`;
    } catch {
      realizedReturnNote = "Could not parse the uploaded price data to compute a realized return.";
    }
  }

  const changedTickers = new Set(tickerChanges.map((c) => c.ticker));
  const rationaleSource = laterLog?.contentJson as { tradeList?: Array<{ ticker: string; rationale: string }>; marketView?: string } | undefined;
  const keyRationale: string[] = [];
  if (rationaleSource?.tradeList) {
    for (const trade of rationaleSource.tradeList) {
      if (changedTickers.has(trade.ticker) && trade.rationale) keyRationale.push(`${trade.ticker}: ${trade.rationale}`);
    }
  }
  if (keyRationale.length === 0 && rationaleSource?.marketView) {
    keyRationale.push(rationaleSource.marketView);
  }
  if (keyRationale.length === 0) {
    keyRationale.push("No decision log rationale is recorded for the later period yet — open it from PM Decision Room to generate one.");
  }

  res.json(
    CompareArchiveResponse.parse({
      a: entryA,
      b: entryB,
      cashWeightChange,
      regimeCompositeChange,
      activeEtfCountChange,
      turnover,
      tickerChanges,
      realizedReturn,
      realizedReturnNote,
      keyRationale,
    })
  );
});

router.get("/archive/:sessionId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(rawId, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const decisionLogRows = await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1);
  res.json(GetArchiveEntryResponse.parse(buildArchiveEntry(rows[0], decisionLogRows[0] ?? null)));
});

export default router;
