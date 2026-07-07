import { Router, type IRouter } from "express";
import { db, configTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetUniverseResponse,
  UpdateUniverseBody,
  UpdateUniverseResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_UNIVERSE = {
  etfs: [
    { ticker: "XLK", name: "Technology Select Sector", sector: "Technology", priorWeight: 0.09, enabled: true },
    { ticker: "XLC", name: "Communication Services Select Sector", sector: "Communication Services", priorWeight: 0.085, enabled: true },
    { ticker: "XLRE", name: "Real Estate Select Sector", sector: "Real Estate", priorWeight: 0.055, enabled: true },
    { ticker: "XLI", name: "Industrials Select Sector", sector: "Industrials", priorWeight: 0.05, enabled: true },
    { ticker: "XLY", name: "Consumer Discretionary Select Sector", sector: "Consumer Discretionary", priorWeight: 0.045, enabled: true },
    { ticker: "XLF", name: "Financial Select Sector", sector: "Financials", priorWeight: 0.045, enabled: true },
    { ticker: "XLU", name: "Utilities Select Sector", sector: "Utilities", priorWeight: 0.045, enabled: true },
    { ticker: "XLE", name: "Energy Select Sector", sector: "Energy", priorWeight: 0.045, enabled: true },
    { ticker: "XLV", name: "Health Care Select Sector", sector: "Health Care", priorWeight: 0, enabled: true },
    { ticker: "XLB", name: "Materials Select Sector", sector: "Materials", priorWeight: 0, enabled: true },
    { ticker: "EEM", name: "iShares MSCI Emerging Markets", sector: "Emerging Markets", priorWeight: 0, enabled: false },
    { ticker: "EWJ", name: "iShares MSCI Japan", sector: "Global - Japan", priorWeight: 0, enabled: false },
    { ticker: "AAXJ", name: "iShares MSCI All Country Asia ex Japan", sector: "Global - Asia ex-Japan", priorWeight: 0, enabled: false },
    { ticker: "EWC", name: "iShares MSCI Canada", sector: "Global - Canada", priorWeight: 0, enabled: false },
    { ticker: "EWB", name: "iShares MSCI Belgium", sector: "Global - Belgium", priorWeight: 0, enabled: false },
    { ticker: "EWG", name: "iShares MSCI Germany", sector: "Global - Germany", priorWeight: 0, enabled: false },
    { ticker: "EUFN", name: "iShares MSCI Europe Financials", sector: "Global - Europe Financials", priorWeight: 0, enabled: false },
  ],
  cashPriorWeight: 0.54,
};

async function getUniverseConfig() {
  const row = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "universe"))
    .then((rows) => rows[0]);

  if (!row) return { ...DEFAULT_UNIVERSE, updatedAt: new Date().toISOString() };

  const parsed = JSON.parse(row.value);
  return { ...parsed, updatedAt: row.updatedAt.toISOString() };
}

router.get("/universe", async (req, res): Promise<void> => {
  const universe = await getUniverseConfig();
  res.json(GetUniverseResponse.parse(universe));
});

router.put("/universe", async (req, res): Promise<void> => {
  const parsed = UpdateUniverseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const value = JSON.stringify(parsed.data);
  const existing = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "universe"))
    .then((rows) => rows[0]);

  if (existing) {
    await db
      .update(configTable)
      .set({ value, updatedAt: new Date() })
      .where(eq(configTable.key, "universe"));
  } else {
    await db.insert(configTable).values({ key: "universe", value });
  }

  const updated = await getUniverseConfig();
  res.json(UpdateUniverseResponse.parse(updated));
});

export { getUniverseConfig };
export default router;
