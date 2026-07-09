import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { GetTradeImplementationMetaResponse, GetTradeImplementationResponse } from "@workspace/api-zod";
import { parseCsv, type AllocationResult, type Constraints } from "../lib/calculator";
import {
  computeTradeImplementation,
  type ExecutionTimingMode,
  type ImplementationRebalanceFrequency,
} from "../lib/tradeImplementation";
import { getLatestPriceData } from "./prices";
import { getConstraintsConfig } from "./constraints";

const router: IRouter = Router();

function parseTiming(v: unknown): ExecutionTimingMode {
  return v === "next_open" ? "next_open" : "next_close";
}

function parseFrequency(v: unknown): ImplementationRebalanceFrequency {
  return v === "quarterly" ? "quarterly" : "monthly";
}

function parseNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseFloat(v) : NaN;
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

router.get("/trade-implementation/meta", async (req, res): Promise<void> => {
  const priceRow = await getLatestPriceData();
  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
  const latest = sessions[0];
  const stored = latest?.resultJson as Record<string, unknown> | undefined;
  const allocations = stored?.allocations as AllocationResult[] | undefined;
  const hasAllocation = !!allocations && allocations.length > 0;
  const hasPreviousWeights = !!allocations?.some((a) => a.priorWeight > 0.0001);
  const priceDataAvailable = !!priceRow;

  let ready = hasAllocation && priceDataAvailable;
  let reason: string | null = null;
  if (!priceDataAvailable) reason = "No price data uploaded. Upload price history before generating a trade list.";
  else if (!hasAllocation) reason = "No allocation run found. Run the rebalance pipeline in Portfolio Lab first.";

  res.json(
    GetTradeImplementationMetaResponse.parse({
      ready,
      reason,
      hasAllocation,
      hasPreviousWeights,
      priceDataAvailable,
      activeEtfCount: allocations?.filter((a) => a.active).length ?? 0,
      lastRunAt: latest?.runAt instanceof Date ? latest.runAt.toISOString() : (latest?.runAt ? String(latest.runAt) : null),
    })
  );
});

router.get("/trade-implementation", async (req, res): Promise<void> => {
  const aumUsd = parseNumber(req.query.aumUsd, NaN, 0, Number.MAX_SAFE_INTEGER);
  if (!aumUsd || isNaN(aumUsd) || aumUsd <= 0) {
    res.status(400).json({ error: "A positive portfolio AUM (aumUsd) is required to generate the trade list." });
    return;
  }

  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
  const latest = sessions[0];
  if (!latest) {
    res.status(400).json({ error: "No allocation run found. Run the rebalance pipeline in Portfolio Lab first." });
    return;
  }
  const stored = latest.resultJson as Record<string, unknown>;
  const allocations = stored.allocations as AllocationResult[] | undefined;
  const cashWeight = (stored.cashWeight as number) ?? 0;
  const cashPriorWeight = (stored.cashPriorWeight as number) ?? 0;
  if (!allocations) {
    res.status(400).json({ error: "The latest session has no allocation data. Re-run the pipeline." });
    return;
  }
  if (!allocations.some((a) => a.priorWeight > 0.0001)) {
    res.status(400).json({ error: "No previous weights are configured. Set previous weights in Settings before generating trades." });
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

  const constraints = (await getConstraintsConfig()) as Constraints;

  const assumptions = {
    executionTiming: parseTiming(req.query.executionTiming),
    transactionCostBps: parseNumber(req.query.transactionCostBps, 5, 0, 500),
    slippageBps: parseNumber(req.query.slippageBps, 3, 0, 500),
    cashYieldAnnualPct: parseNumber(req.query.cashYieldAnnualPct, 4.5, 0, 20),
    rebalanceFrequency: parseFrequency(req.query.rebalanceFrequency),
    minTradeSizeUsd: parseNumber(req.query.minTradeSizeUsd, 500, 0, 10_000_000),
  };

  const result = computeTradeImplementation(allocations, cashWeight, cashPriorWeight, priceRows, aumUsd, assumptions, constraints);

  res.json(GetTradeImplementationResponse.parse(result));
});

export default router;
