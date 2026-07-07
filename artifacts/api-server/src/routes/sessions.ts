import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ListSessionsResponse,
  GetSessionParams,
  GetSessionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sessions", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: sessionsTable.id,
      runAt: sessionsTable.runAt,
      label: sessionsTable.label,
      activeEtfCount: sessionsTable.activeEtfCount,
      cashWeight: sessionsTable.cashWeight,
      regimeLabel: sessionsTable.regimeLabel,
      regimeComposite: sessionsTable.regimeComposite,
    })
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.runAt));

  const sessions = rows.map((r) => ({
    id: r.id,
    runAt: r.runAt.toISOString(),
    label: r.label,
    activeEtfCount: r.activeEtfCount,
    cashWeight: r.cashWeight,
    regimeLabel: r.regimeLabel,
    regimeComposite: r.regimeComposite,
  }));

  res.json(ListSessionsResponse.parse(sessions));
});

router.get("/sessions/:sessionId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const id = parseInt(rawId, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const rows = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const row = rows[0];
  const sessionSummary = {
    id: row.id,
    runAt: row.runAt.toISOString(),
    label: row.label,
    activeEtfCount: row.activeEtfCount,
    cashWeight: row.cashWeight,
    regimeLabel: row.regimeLabel,
    regimeComposite: row.regimeComposite,
  };

  res.json(
    GetSessionResponse.parse({
      session: sessionSummary,
      result: row.resultJson,
    })
  );
});

export default router;
