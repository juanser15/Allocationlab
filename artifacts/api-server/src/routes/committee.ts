import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import { GetCommitteeResponse } from "@workspace/api-zod";
import {
  buildInvestmentCommittee,
  parseCsv,
  runBacktestEngine,
  runWalkForwardFolds,
  runSensitivityGrid,
  computeIntegrityAudit,
  defaultBacktestConfig,
  type EtfEntry,
  type Constraints,
  type CommitteeInput,
} from "../lib/calculator";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";
import { getLatestPriceData } from "./prices";
import { getFactorSetSnapshot } from "../lib/factor-library";

const router: IRouter = Router();

router.get("/committee", async (req, res): Promise<void> => {
  const rows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "No allocation runs found. Run the pipeline first to generate committee input." });
    return;
  }

  const stored = rows[0].resultJson as Record<string, unknown>;
  const regime = stored.regime as CommitteeInput["regime"] | undefined;
  const allocations = (stored.allocations as CommitteeInput["allocations"] | undefined) ?? [];
  const watchlist = (stored.watchlist as CommitteeInput["watchlist"] | undefined) ?? [];
  const diagnostics = stored.diagnostics as CommitteeInput["diagnostics"] | undefined;
  const cashWeight = (stored.cashWeight as number | undefined) ?? 0;
  const activeEtfCount = (stored.activeEtfCount as number | undefined) ?? 0;

  if (!regime || !diagnostics) {
    res.status(404).json({
      error: "The latest session predates the diagnostics/regime data the committee requires. Re-run the pipeline first.",
    });
    return;
  }

  const constraints = (await getConstraintsConfig()) as Constraints;

  let backtestIntegrity: CommitteeInput["backtestIntegrity"] = null;
  try {
    const priceRow = await getLatestPriceData();
    if (priceRow) {
      const priceRows = parseCsv(priceRow.csvContent);
      const universe = await getUniverseConfig();
      const etfs = universe.etfs as EtfEntry[];
      const config = defaultBacktestConfig();
      const factorSet = await getFactorSetSnapshot();
      const engineResult = runBacktestEngine(priceRows, etfs, constraints, config, null, factorSet);
      if (engineResult.hasSufficientData) {
        const walkForward = runWalkForwardFolds(engineResult, 3);
        const sensitivity = runSensitivityGrid(priceRows, etfs, constraints, config, factorSet);
        backtestIntegrity = computeIntegrityAudit(engineResult, config, sensitivity, walkForward);
      }
    }
  } catch {
    backtestIntegrity = null;
  }

  const input: CommitteeInput = {
    sessionId: rows[0].id,
    runAt: rows[0].runAt.toISOString(),
    regime,
    allocations,
    cashWeight,
    activeEtfCount,
    watchlist,
    diagnostics,
    constraints,
    backtestIntegrity,
  };

  const committee = buildInvestmentCommittee(input);
  res.json(GetCommitteeResponse.parse(committee));
});

export default router;
