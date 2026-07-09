import { Router, type IRouter } from "express";
import { GetRiskModelResponse } from "@workspace/api-zod";
import { parseCsv, type EtfEntry } from "../lib/calculator";
import { computeRiskModel, type CovarianceModel } from "../lib/riskModel";
import { getLatestPriceData } from "./prices";
import { getUniverseConfig } from "./universe";
import { db, sessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

function parseCovarianceModel(v: unknown): CovarianceModel {
  return v === "ewma" || v === "shrinkage" ? v : "sample";
}

router.get("/risk-model", async (req, res): Promise<void> => {
  const covarianceModel = parseCovarianceModel(req.query.covarianceModel);

  const sessions = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
  if (sessions.length === 0) {
    res.status(400).json({ error: "No allocation run found. Run the pipeline from Investment Committee first." });
    return;
  }
  const stored = sessions[0].resultJson as Record<string, unknown>;
  const allocations = stored.allocations as import("../lib/calculator").AllocationResult[] | undefined;
  const cashWeight = (stored.cashWeight as number) ?? 0;
  if (!allocations) {
    res.status(400).json({ error: "The latest session has no allocation data. Re-run the pipeline." });
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
  const etfMap = new Map<string, EtfEntry>(
    (universe.etfs as EtfEntry[]).map((e) => [e.ticker, e])
  );
  const availableTickers = JSON.parse(priceRow.tickers) as string[];

  const result = computeRiskModel(priceRows, allocations, etfMap, availableTickers, cashWeight, covarianceModel);

  res.json(GetRiskModelResponse.parse(result));
});

export default router;
