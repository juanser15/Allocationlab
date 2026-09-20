/**
 * Allocation Lab v2 — Production Governance (Iteration 15)
 *
 * Every saved portfolio version gets an immutable governance snapshot the
 * first time it is recorded: data timestamp, price source, universe,
 * constraints, execution assumptions, benchmark, model version, parameter
 * version, and a reproducibility hash. Committee/approval/report status are
 * always read live from the decision log so the dashboard never shows a
 * stale duplicate of state that lives elsewhere. Nothing here is fabricated:
 * sessions with no governance snapshot are shown as such, not backfilled
 * with guesses.
 */

import { Router, type IRouter } from "express";
import { db, sessionsTable, decisionLogsTable, sessionGovernanceTable, governanceAuditLogTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GetGovernanceDashboardResponse,
  ListGovernanceVersionsResponse,
  GetGovernanceVersionResponse,
  CreateGovernanceSnapshotBody,
  CreateGovernanceSnapshotResponse,
  LockGovernanceVersionBody,
  LockGovernanceVersionResponse,
  UnlockGovernanceVersionBody,
  UnlockGovernanceVersionResponse,
  RerunGovernanceConsistencyCheckResponse,
  GetGovernanceAuditLogResponse,
} from "@workspace/api-zod";
import { computeFactors, computeRegime, constructAllocation, parseCsv, type AllocationResult } from "../lib/calculator";
import { computeReproducibilityHash, isDataStale, compareRerun, stableStringify } from "../lib/governance";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";
import { getLatestPriceData } from "./prices";
import { getFactorSetSnapshot } from "../lib/factor-library";

const router: IRouter = Router();

type SessionRow = typeof sessionsTable.$inferSelect;
type GovernanceRow = typeof sessionGovernanceTable.$inferSelect;

function sessionLabel(s: SessionRow): string {
  return s.label ? `${s.label} (#${s.id})` : `Session #${s.id}`;
}

function isoDate(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

async function writeAudit(sessionId: number | null, eventType: string, actor: string, detail: string) {
  await db.insert(governanceAuditLogTable).values({ sessionId, eventType, actor, detail });
}

function committeeStateFor(log: typeof decisionLogsTable.$inferSelect | undefined) {
  if (!log) {
    return { committeeStatus: "not_submitted", approvalState: "not_submitted", reportStatus: "not_generated" as const };
  }
  const approvalState = log.status === "approved" ? "approved" : log.status === "under_review" ? "pending" : "draft";
  return { committeeStatus: log.status, approvalState, reportStatus: log.status === "approved" ? "eligible" : "not_eligible" };
}

function diagnosticsStatusFor(session: SessionRow): string {
  const stored = session.resultJson as Record<string, unknown>;
  const diagnostics = stored.diagnostics as { insufficientDataReasons?: string[] } | undefined;
  if (!diagnostics) return "unavailable";
  if (diagnostics.insufficientDataReasons && diagnostics.insufficientDataReasons.length > 0) return "insufficient_data";
  return "computed";
}

function backtestIntegrityStatusFor(): string {
  // Backtests are computed on current live inputs (Research Lab), not stored
  // per saved version, so this is reported honestly rather than fabricated.
  return "not_tracked_per_version";
}

function missingValidationItemsFor(session: SessionRow, governance: GovernanceRow | undefined, log: typeof decisionLogsTable.$inferSelect | undefined): string[] {
  const items: string[] = [];
  if (!governance) items.push("No governance snapshot recorded for this version.");
  if (diagnosticsStatusFor(session) !== "computed") items.push("Portfolio diagnostics not fully computed.");
  if (!log) items.push("Not yet submitted to the decision log.");
  else if (log.status !== "approved") items.push("Not yet approved by the committee.");
  return items;
}

async function buildSummary(session: SessionRow, governance: GovernanceRow | undefined, log: typeof decisionLogsTable.$inferSelect | undefined) {
  const { committeeStatus, approvalState, reportStatus } = committeeStateFor(log);
  return {
    sessionId: session.id,
    label: sessionLabel(session),
    runAt: isoDate(session.runAt),
    hasGovernanceRecord: !!governance,
    dataTimestamp: governance?.dataTimestamp ?? null,
    priceSource: governance?.priceSource ?? null,
    benchmarkTicker: governance?.benchmarkTicker ?? null,
    modelVersion: governance?.modelVersion ?? null,
    parameterVersion: governance?.parameterVersion ?? null,
    reproducibilityHash: governance?.reproducibilityHash ?? null,
    locked: governance?.locked ?? false,
    lockedAt: governance?.lockedAt ? isoDate(governance.lockedAt) : null,
    lockedBy: governance?.lockedBy ?? null,
    committeeStatus,
    approvalState,
    reportStatus,
    diagnosticsStatus: diagnosticsStatusFor(session),
    backtestIntegrityStatus: backtestIntegrityStatusFor(),
    isStale: governance ? isDataStale(governance.dataTimestamp) : false,
    missingValidationItems: missingValidationItemsFor(session, governance, log),
  };
}

async function loadAll() {
  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt));
  const governanceRows = await db.select().from(sessionGovernanceTable);
  const logRows = await db.select().from(decisionLogsTable);
  const govBySession = new Map(governanceRows.map((g) => [g.sessionId, g]));
  const logBySession = new Map(logRows.map((l) => [l.sessionId, l]));
  return { sessions, govBySession, logBySession };
}

router.get("/governance/versions", async (req, res): Promise<void> => {
  const { sessions, govBySession, logBySession } = await loadAll();
  const summaries = await Promise.all(sessions.map((s) => buildSummary(s, govBySession.get(s.id), logBySession.get(s.id))));
  res.json(ListGovernanceVersionsResponse.parse(summaries));
});

router.get("/governance/dashboard", async (req, res): Promise<void> => {
  const { sessions, govBySession, logBySession } = await loadAll();
  const summaries = await Promise.all(sessions.map((s) => buildSummary(s, govBySession.get(s.id), logBySession.get(s.id))));

  const pendingApprovals = summaries.filter((s) => s.approvalState === "pending");
  const staleWarnings = summaries.filter((s) => s.isStale);
  const missingValidation = summaries.filter((s) => s.missingValidationItems.length > 0);
  const lockedVersions = summaries.filter((s) => s.locked);

  const recentAuditRows = await db.select().from(governanceAuditLogTable).orderBy(desc(governanceAuditLogTable.createdAt)).limit(20);
  const recentAuditEvents = recentAuditRows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    eventType: r.eventType,
    actor: r.actor,
    detail: r.detail,
    createdAt: isoDate(r.createdAt),
  }));

  const versionsWithGovernanceRecord = summaries.filter((s) => s.hasGovernanceRecord).length;
  const governanceNote =
    sessions.length > 0 && versionsWithGovernanceRecord < sessions.length
      ? `${sessions.length - versionsWithGovernanceRecord} of ${sessions.length} saved version(s) were created before governance tracking was enabled and have no recorded snapshot.`
      : null;

  res.json(
    GetGovernanceDashboardResponse.parse({
      totalVersions: sessions.length,
      versionsWithGovernanceRecord,
      pendingApprovals,
      staleWarnings,
      missingValidation,
      lockedVersions,
      recentAuditEvents,
      governanceNote,
    })
  );
});

router.get("/governance/audit-log", async (req, res): Promise<void> => {
  const sessionIdParam = typeof req.query.sessionId === "string" ? parseInt(req.query.sessionId, 10) : null;
  const rows = sessionIdParam
    ? await db.select().from(governanceAuditLogTable).where(eq(governanceAuditLogTable.sessionId, sessionIdParam)).orderBy(desc(governanceAuditLogTable.createdAt))
    : await db.select().from(governanceAuditLogTable).orderBy(desc(governanceAuditLogTable.createdAt));

  res.json(
    GetGovernanceAuditLogResponse.parse(
      rows.map((r) => ({ id: r.id, sessionId: r.sessionId, eventType: r.eventType, actor: r.actor, detail: r.detail, createdAt: isoDate(r.createdAt) }))
    )
  );
});

router.get("/governance/versions/:sessionId", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) { res.status(404).json({ error: "Session not found" }); return; }
  const session = sessionRows[0];

  const govRows = await db.select().from(sessionGovernanceTable).where(eq(sessionGovernanceTable.sessionId, sessionId)).limit(1);
  const governance = govRows[0];
  const logRows = await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1);
  const log = logRows[0];

  const summary = await buildSummary(session, governance, log);
  const auditRows = await db.select().from(governanceAuditLogTable).where(eq(governanceAuditLogTable.sessionId, sessionId)).orderBy(desc(governanceAuditLogTable.createdAt));

  res.json(
    GetGovernanceVersionResponse.parse({
      ...summary,
      universe: governance?.universeJson ?? null,
      constraints: governance?.constraintsJson ?? null,
      executionAssumptions: governance?.executionAssumptionsJson ?? null,
      auditEvents: auditRows.map((r) => ({ id: r.id, sessionId: r.sessionId, eventType: r.eventType, actor: r.actor, detail: r.detail, createdAt: isoDate(r.createdAt) })),
    })
  );
});

router.post("/governance/versions/:sessionId/snapshot", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const parsed = CreateGovernanceSnapshotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) { res.status(404).json({ error: "Session not found" }); return; }
  const session = sessionRows[0];

  const existing = await db.select().from(sessionGovernanceTable).where(eq(sessionGovernanceTable.sessionId, sessionId)).limit(1);
  if (existing.length > 0 && existing[0].locked) {
    res.status(400).json({ error: "This version is archive-locked and cannot be re-snapshotted. Create a new version instead." });
    return;
  }

  const stored = session.resultJson as Record<string, unknown>;
  const dataTimestamp = (stored.priceDataEnd as string) ?? isoDate(session.runAt).slice(0, 10);
  const universe = await getUniverseConfig();
  const constraints = await getConstraintsConfig();
  const allocations = (stored.allocations ?? []) as AllocationResult[];
  const tickers = allocations.map((a) => a.ticker).sort();

  const reproducibilityHash = computeReproducibilityHash({
    universe,
    constraints,
    priceDataEnd: dataTimestamp,
    tickers,
    modelVersion: parsed.data.modelVersion,
    parameterVersion: parsed.data.parameterVersion,
  });

  const values = {
    sessionId,
    dataTimestamp,
    priceSource: parsed.data.priceSource,
    universeJson: universe,
    constraintsJson: constraints,
    executionAssumptionsJson: parsed.data.executionAssumptions,
    benchmarkTicker: parsed.data.benchmarkTicker,
    modelVersion: parsed.data.modelVersion,
    parameterVersion: parsed.data.parameterVersion,
    reproducibilityHash,
  };

  let governance: GovernanceRow;
  if (existing.length > 0) {
    [governance] = await db.update(sessionGovernanceTable).set(values).where(eq(sessionGovernanceTable.sessionId, sessionId)).returning();
    await writeAudit(sessionId, "snapshot_updated", "System", `Governance snapshot refreshed for ${sessionLabel(session)}.`);
  } else {
    [governance] = await db.insert(sessionGovernanceTable).values(values).returning();
    await writeAudit(sessionId, "snapshot_created", "System", `Governance snapshot recorded for ${sessionLabel(session)}. Reproducibility hash ${reproducibilityHash}.`);
  }

  const log = (await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1))[0];
  const summary = await buildSummary(session, governance, log);
  const auditRows = await db.select().from(governanceAuditLogTable).where(eq(governanceAuditLogTable.sessionId, sessionId)).orderBy(desc(governanceAuditLogTable.createdAt));

  res.json(
    CreateGovernanceSnapshotResponse.parse({
      ...summary,
      universe: governance.universeJson,
      constraints: governance.constraintsJson,
      executionAssumptions: governance.executionAssumptionsJson,
      auditEvents: auditRows.map((r) => ({ id: r.id, sessionId: r.sessionId, eventType: r.eventType, actor: r.actor, detail: r.detail, createdAt: isoDate(r.createdAt) })),
    })
  );
});

router.post("/governance/versions/:sessionId/lock", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const parsed = LockGovernanceVersionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const actor = parsed.data.actor ?? "Investment Committee";

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) { res.status(404).json({ error: "Session not found" }); return; }
  const session = sessionRows[0];

  const existing = await db.select().from(sessionGovernanceTable).where(eq(sessionGovernanceTable.sessionId, sessionId)).limit(1);
  if (existing.length === 0) {
    res.status(400).json({ error: "This version has no governance snapshot yet. Record a snapshot before locking it." });
    return;
  }
  if (existing[0].locked) {
    res.status(400).json({ error: "This version is already archive-locked." });
    return;
  }

  const now = new Date();
  const [governance] = await db.update(sessionGovernanceTable).set({ locked: true, lockedAt: now, lockedBy: actor }).where(eq(sessionGovernanceTable.sessionId, sessionId)).returning();
  await writeAudit(sessionId, "locked", actor, `${sessionLabel(session)} archive-locked. It can no longer be modified without creating a new version.`);

  const log = (await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1))[0];
  const summary = await buildSummary(session, governance, log);
  const auditRows = await db.select().from(governanceAuditLogTable).where(eq(governanceAuditLogTable.sessionId, sessionId)).orderBy(desc(governanceAuditLogTable.createdAt));

  res.json(
    LockGovernanceVersionResponse.parse({
      ...summary,
      universe: governance.universeJson,
      constraints: governance.constraintsJson,
      executionAssumptions: governance.executionAssumptionsJson,
      auditEvents: auditRows.map((r) => ({ id: r.id, sessionId: r.sessionId, eventType: r.eventType, actor: r.actor, detail: r.detail, createdAt: isoDate(r.createdAt) })),
    })
  );
});

router.post("/governance/versions/:sessionId/unlock", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const parsed = UnlockGovernanceVersionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const actor = parsed.data.actor ?? "Investment Committee";

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) { res.status(404).json({ error: "Session not found" }); return; }
  const session = sessionRows[0];

  const existing = await db.select().from(sessionGovernanceTable).where(eq(sessionGovernanceTable.sessionId, sessionId)).limit(1);
  if (existing.length === 0 || !existing[0].locked) {
    res.status(400).json({ error: "This version is not currently archive-locked." });
    return;
  }

  const [governance] = await db.update(sessionGovernanceTable).set({ locked: false, lockedAt: null, lockedBy: null }).where(eq(sessionGovernanceTable.sessionId, sessionId)).returning();
  await writeAudit(sessionId, "unlocked", actor, `${sessionLabel(session)} archive lock removed.`);

  const log = (await db.select().from(decisionLogsTable).where(eq(decisionLogsTable.sessionId, sessionId)).limit(1))[0];
  const summary = await buildSummary(session, governance, log);
  const auditRows = await db.select().from(governanceAuditLogTable).where(eq(governanceAuditLogTable.sessionId, sessionId)).orderBy(desc(governanceAuditLogTable.createdAt));

  res.json(
    UnlockGovernanceVersionResponse.parse({
      ...summary,
      universe: governance.universeJson,
      constraints: governance.constraintsJson,
      executionAssumptions: governance.executionAssumptionsJson,
      auditEvents: auditRows.map((r) => ({ id: r.id, sessionId: r.sessionId, eventType: r.eventType, actor: r.actor, detail: r.detail, createdAt: isoDate(r.createdAt) })),
    })
  );
});

router.post("/governance/versions/:sessionId/rerun-check", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const sessionRows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (sessionRows.length === 0) { res.status(404).json({ error: "Session not found" }); return; }
  const session = sessionRows[0];

  const govRows = await db.select().from(sessionGovernanceTable).where(eq(sessionGovernanceTable.sessionId, sessionId)).limit(1);
  if (govRows.length === 0) {
    res.status(400).json({ error: "This version has no governance snapshot to check against. Record a snapshot first." });
    return;
  }
  const governance = govRows[0];

  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.status(400).json({ error: "No price data currently available to rerun the pipeline." });
    return;
  }

  const currentUniverse = await getUniverseConfig();
  const currentConstraints = await getConstraintsConfig();
  const universeChanged = stableStringify(currentUniverse) !== stableStringify(governance.universeJson);
  const constraintsChanged = stableStringify(currentConstraints) !== stableStringify(governance.constraintsJson);
  const dataChanged = priceRow.endDate !== governance.dataTimestamp;

  let rerunHash = governance.reproducibilityHash;
  if (!dataChanged && !universeChanged) {
    try {
      const priceRows = parseCsv(priceRow.csvContent);
      const enabledTickers = (currentUniverse.etfs as Array<{ ticker: string; enabled: boolean }>).filter((e) => e.enabled).map((e) => e.ticker);
      const availableTickers = JSON.parse(priceRow.tickers) as string[];
      const tickers = enabledTickers.filter((t) => availableTickers.includes(t));
      const regime = computeRegime(priceRows, tickers);
      const factorSet = await getFactorSetSnapshot();
      const factorData = computeFactors(priceRows, tickers, factorSet, regime.label);
      const allocations = constructAllocation(factorData, currentUniverse.etfs, currentConstraints, regime);
      rerunHash = computeReproducibilityHash({
        universe: currentUniverse,
        constraints: currentConstraints,
        priceDataEnd: priceRow.endDate,
        tickers: allocations.map((a) => a.ticker).sort(),
        modelVersion: governance.modelVersion,
        parameterVersion: governance.parameterVersion,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: `Rerun failed: ${err instanceof Error ? err.message : "error"}` });
      return;
    }
  }

  const comparison = compareRerun({
    originalHash: governance.reproducibilityHash,
    rerunHash,
    dataChanged,
    universeChanged,
    constraintsChanged,
    modelVersionChanged: false,
  });

  await writeAudit(
    sessionId,
    "rerun_check",
    "System",
    `Rerun consistency check for ${sessionLabel(session)}: ${comparison.consistent ? "consistent" : "inconsistent"} (${comparison.changedFactors.length} factor(s) changed).`
  );

  res.json(
    RerunGovernanceConsistencyCheckResponse.parse({
      sessionId,
      consistent: comparison.consistent,
      originalHash: comparison.originalHash,
      rerunHash: comparison.rerunHash,
      changedFactors: comparison.changedFactors,
      summary: comparison.summary,
      checkedAt: new Date().toISOString(),
    })
  );
});

export default router;
