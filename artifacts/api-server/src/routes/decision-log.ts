import { Router, type IRouter } from "express";
import { db, sessionsTable, decisionLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ListDecisionLogsResponse,
  GetOrCreateDecisionLogResponse,
  UpdateDecisionLogStatusBody,
  UpdateDecisionLogStatusResponse,
} from "@workspace/api-zod";
import { buildDecisionLogContent, type EnrichedRegimeScores, type AllocationResult, type WatchlistEntry, type PortfolioDiagnostics } from "../lib/calculator";
import { getConstraintsConfig } from "./constraints";

const router: IRouter = Router();

function serialize(row: typeof decisionLogsTable.$inferSelect) {
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

router.get("/decision-log", async (req, res): Promise<void> => {
  const rows = await db.select().from(decisionLogsTable).orderBy(desc(decisionLogsTable.createdAt));
  res.json(ListDecisionLogsResponse.parse(rows.map(serialize)));
});

router.get("/decision-log/:sessionId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(rawId, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const existing = await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1);
  if (existing.length > 0) {
    res.json(GetOrCreateDecisionLogResponse.parse(serialize(existing[0])));
    return;
  }

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const session = sessionRows[0];
  const result = session.resultJson as Record<string, unknown>;
  const regime = result.regime as EnrichedRegimeScores;
  const allocations = (result.allocations ?? []) as AllocationResult[];
  const watchlist = (result.watchlist ?? []) as WatchlistEntry[];
  const diagnostics = (result.diagnostics ?? {
    expectedVolatility: 0, hhi: 0, effectiveNumberOfBets: 0, diversificationScore: 0,
  }) as PortfolioDiagnostics;
  const cashWeight = (result.cashWeight as number) ?? 0;
  const cashChange = (result.cashChange as number) ?? 0;
  const activeEtfCount = (result.activeEtfCount as number) ?? 0;

  const constraints = await getConstraintsConfig();
  const content = buildDecisionLogContent(regime, allocations, watchlist, diagnostics, cashWeight, cashChange, activeEtfCount, constraints.minInclusionThreshold);

  const [created] = await db.insert(decisionLogsTable).values({
    sessionId,
    portfolioVersion: session.label ? `${session.label} (#${sessionId})` : `Session #${sessionId}`,
    status: "draft",
    regimeLabel: regime.label,
    regimeComposite: Math.round(regime.composite),
    contentJson: content,
  }).returning();

  res.json(GetOrCreateDecisionLogResponse.parse(serialize(created)));
});

const FORWARD_TRANSITIONS: Record<string, string[]> = {
  draft: ["under_review"],
  under_review: ["approved", "draft"],
  approved: ["draft"],
};

router.patch("/decision-log/:id/status", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid decision log ID" });
    return;
  }

  const parsed = UpdateDecisionLogStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.id, id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Decision log not found" });
    return;
  }
  const current = rows[0];
  const nextStatus = parsed.data.status;
  const allowed = FORWARD_TRANSITIONS[current.status] ?? [];
  if (nextStatus !== current.status && !allowed.includes(nextStatus)) {
    res.status(400).json({ error: `Cannot transition from "${current.status}" to "${nextStatus}".` });
    return;
  }

  const now = new Date();
  const updates: Partial<typeof decisionLogsTable.$inferInsert> = { status: nextStatus, updatedAt: now };
  if (nextStatus === "under_review" && current.status !== "under_review") updates.submittedAt = now;
  if (nextStatus === "approved") {
    updates.approvedAt = now;
    updates.approvedBy = parsed.data.approvedBy ?? "Investment Committee";
  }
  if (nextStatus === "draft") {
    updates.approvedAt = null;
    updates.approvedBy = null;
  }

  const [updated] = await db.update(decisionLogsTable).set(updates).where(eq(decisionLogsTable.id, id)).returning();
  res.json(UpdateDecisionLogStatusResponse.parse(serialize(updated)));
});

export default router;
