import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { GetScenarioStressMetaResponse, RunScenarioStressBody, RunScenarioStressResponse } from "@workspace/api-zod";
import { parseCsv, type AllocationResult, type EtfEntry } from "../lib/calculator";
import {
  computeScenarioAnalysis,
  computeStressTest,
  resolveMacroProxies,
  PREDEFINED_STRESS_SCENARIOS,
  type MacroShockInput,
  type CustomEtfShockInput,
} from "../lib/scenarioStress";
import { getLatestPriceData } from "./prices";
import { getUniverseConfig } from "./universe";

const router: IRouter = Router();

type SessionRow = typeof sessionsTable.$inferSelect;

async function loadAllocationSource(versionId: number | null | undefined): Promise<{ allocations: AllocationResult[]; cashWeight: number; label: string } | null> {
  let row: SessionRow | undefined;
  if (versionId) {
    const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, versionId)).limit(1);
    row = rows[0];
  } else {
    const rows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
    row = rows[0];
  }
  if (!row) return null;
  const stored = row.resultJson as Record<string, unknown>;
  const allocations = stored.allocations as AllocationResult[] | undefined;
  if (!allocations) return null;
  return {
    allocations,
    cashWeight: row.cashWeight ?? 0,
    label: row.label ? `${row.label} (#${row.id})` : `Session #${row.id}`,
  };
}

router.get("/scenario-stress/meta", async (req, res): Promise<void> => {
  const priceRow = await getLatestPriceData();
  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt));
  const latestAllocationRow = sessions[0];
  const hasAllocation = !!(latestAllocationRow?.resultJson as Record<string, unknown> | undefined)?.allocations;

  const versions = sessions
    .filter((s) => !!(s.resultJson as Record<string, unknown>)?.allocations)
    .map((s) => ({ id: s.id, label: s.label ? `${s.label} (#${s.id})` : `Session #${s.id}`, runAt: s.runAt instanceof Date ? s.runAt.toISOString() : String(s.runAt) }));

  if (!priceRow) {
    res.json(
      GetScenarioStressMetaResponse.parse({
        proxies: [],
        scenarios: PREDEFINED_STRESS_SCENARIOS.map((s) => ({ ...s, available: false, reason: "No price data uploaded yet." })),
        versions,
        dataStartDate: null,
        dataEndDate: null,
        hasAllocation,
      })
    );
    return;
  }

  let priceRows;
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch {
    res.json(
      GetScenarioStressMetaResponse.parse({
        proxies: [],
        scenarios: PREDEFINED_STRESS_SCENARIOS.map((s) => ({ ...s, available: false, reason: "Uploaded price data could not be parsed." })),
        versions,
        dataStartDate: null,
        dataEndDate: null,
        hasAllocation,
      })
    );
    return;
  }

  const availableTickers = JSON.parse(priceRow.tickers) as string[];
  const proxies = resolveMacroProxies(availableTickers, priceRows);
  const sorted = priceRows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const dataStartDate = sorted[0]?.date ?? null;
  const dataEndDate = sorted[sorted.length - 1]?.date ?? null;

  const scenarios = PREDEFINED_STRESS_SCENARIOS.map((s) => {
    const covered = sorted.filter((r) => r.date >= s.startDate && r.date <= s.endDate).length >= 2;
    return {
      ...s,
      available: covered,
      reason: covered ? null : `Uploaded price history (${dataStartDate ?? "n/a"} to ${dataEndDate ?? "n/a"}) does not cover this window.`,
    };
  });

  res.json(GetScenarioStressMetaResponse.parse({ proxies, scenarios, versions, dataStartDate, dataEndDate, hasAllocation }));
});

router.post("/scenario-stress/run", async (req, res): Promise<void> => {
  const parsed = RunScenarioStressBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const source = await loadAllocationSource(body.versionId ?? null);
  if (!source) {
    res.status(400).json({ error: "No allocation run found for the selected portfolio version. Run the pipeline in Portfolio Lab first." });
    return;
  }

  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.status(400).json({ error: "No price data available. Upload a CSV in Portfolio Construction." });
    return;
  }
  let priceRows;
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch (err: unknown) {
    res.status(400).json({ error: `Failed to parse price data: ${err instanceof Error ? err.message : "CSV parse error"}` });
    return;
  }

  const universe = await getUniverseConfig();
  const etfMap = new Map<string, EtfEntry>((universe.etfs as EtfEntry[]).map((e) => [e.ticker, e]));
  const availableTickers = JSON.parse(priceRow.tickers) as string[];

  if (body.mode === "scenario") {
    const macroShocks: MacroShockInput[] = body.macroShocks ?? [];
    const customEtfShocks: CustomEtfShockInput[] = body.customEtfShocks ?? [];
    const result = computeScenarioAnalysis(priceRows, source.allocations, etfMap, availableTickers, source.cashWeight, macroShocks, customEtfShocks);
    res.json(RunScenarioStressResponse.parse(result));
    return;
  }

  // Stress mode
  let window: { startDate: string; endDate: string; label: string } | null = null;
  if (body.scenarioId === "custom") {
    if (!body.customStart || !body.customEnd) {
      res.status(400).json({ error: "A custom window requires both a start and end date." });
      return;
    }
    window = { startDate: body.customStart, endDate: body.customEnd, label: "Custom Historical Window" };
  } else {
    const preset = PREDEFINED_STRESS_SCENARIOS.find((s) => s.id === body.scenarioId);
    if (!preset) {
      res.status(400).json({ error: "Unknown stress scenario id." });
      return;
    }
    window = preset;
  }

  const result = computeStressTest(priceRows, source.allocations, etfMap, availableTickers, source.cashWeight, window);
  res.json(RunScenarioStressResponse.parse(result));
});

export default router;
