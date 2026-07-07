import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  RunPipelineBody,
  RunPipelineResponse,
  GetLatestResultsResponse,
} from "@workspace/api-zod";
import { parseCsv, computeFactors, computeRegime, constructAllocation } from "../lib/calculator";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";
import { getLatestPriceData } from "./prices";

const router: IRouter = Router();

router.post("/run", async (req, res): Promise<void> => {
  const parsed = RunPipelineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const label = parsed.data.label ?? null;

  const steps: Array<{ step: string; label: string; status: string; message: string | null }> = [
    { step: "load_data", label: "Load Price Data", status: "running", message: null },
    { step: "compute_factors", label: "Compute Factors", status: "pending", message: null },
    { step: "estimate_regime", label: "Estimate Regime", status: "pending", message: null },
    { step: "score_etfs", label: "Score ETFs", status: "pending", message: null },
    { step: "construct_allocation", label: "Construct Allocation", status: "pending", message: null },
    { step: "generate_report", label: "Generate Report", status: "pending", message: null },
  ];

  function markStep(step: string, status: "done" | "error", message?: string) {
    const s = steps.find((x) => x.step === step);
    if (s) {
      s.status = status;
      s.message = message !== undefined ? message : null;
    }
    const idx = steps.findIndex((x) => x.step === step);
    if (idx >= 0 && idx + 1 < steps.length && status === "done") {
      steps[idx + 1].status = "running";
    }
  }

  // Step 1: Load price data
  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.status(400).json({
      error: "No price data available. Please upload a CSV file in Portfolio Construction before running.",
    });
    return;
  }

  let priceRows;
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "CSV parse error";
    res.status(400).json({ error: `Failed to parse price data: ${msg}` });
    return;
  }
  markStep("load_data", "done", `${priceRows.length} rows loaded (${priceRow.startDate} → ${priceRow.endDate})`);

  // Get config
  const universe = await getUniverseConfig();
  const constraints = await getConstraintsConfig();
  const enabledTickers = (universe.etfs as Array<{ ticker: string; enabled: boolean }>).filter((e) => e.enabled).map((e) => e.ticker);
  const availableTickers = JSON.parse(priceRow.tickers) as string[];
  const tickers = enabledTickers.filter((t) => availableTickers.includes(t));

  if (tickers.length === 0) {
    res.status(400).json({ error: "No enabled ETFs have price data. Check your ETF universe and uploaded CSV." });
    return;
  }

  // Step 2: Compute factors
  let factorData;
  try {
    factorData = computeFactors(priceRows, tickers);
    markStep("compute_factors", "done", `Factors computed for ${factorData.length} ETFs`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Factor computation error";
    res.status(500).json({ error: `Factor computation failed: ${msg}` });
    return;
  }

  // Step 3: Estimate regime
  let regime;
  try {
    regime = computeRegime(priceRows, tickers);
    markStep("estimate_regime", "done", `Regime: ${regime.label} (composite: ${regime.composite})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Regime estimation error";
    res.status(500).json({ error: `Regime estimation failed: ${msg}` });
    return;
  }

  // Step 4: Score ETFs (already done in factors, mark as complete)
  markStep("score_etfs", "done", `${factorData.length} ETFs scored`);

  // Step 5: Construct allocation
  let allocations;
  try {
    allocations = constructAllocation(factorData, universe.etfs, constraints, regime);
    markStep("construct_allocation", "done", `${allocations.filter((a) => a.active).length} active ETFs allocated`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Allocation error";
    res.status(500).json({ error: `Allocation construction failed: ${msg}` });
    return;
  }

  // Step 6: Generate report (persisted to DB)
  const activeEtfs = allocations.filter((a) => a.active);
  const cashWeight = Math.max(0, Math.min(1, 1 - allocations.reduce((s, a) => s + a.weight, 0)));
  const cashChange = cashWeight - universe.cashPriorWeight;
  const investedSleeve = 1 - cashWeight;

  const result = {
    sessionId: 0, // will be replaced after insert
    runAt: new Date().toISOString(),
    label,
    regime,
    allocations,
    cashWeight: Math.round(cashWeight * 10000) / 10000,
    cashPriorWeight: universe.cashPriorWeight,
    cashChange: Math.round(cashChange * 10000) / 10000,
    activeEtfCount: activeEtfs.length,
    investedSleeve: Math.round(investedSleeve * 10000) / 10000,
    priceDataEnd: priceRow.endDate,
    steps,
  };

  const [session] = await db.insert(sessionsTable).values({
    label,
    activeEtfCount: activeEtfs.length,
    cashWeight: result.cashWeight,
    regimeLabel: regime.label,
    regimeComposite: regime.composite,
    resultJson: result,
  }).returning();

  markStep("generate_report", "done", "Results saved");
  result.sessionId = session.id;
  result.steps = steps;

  // Update stored JSON with final sessionId
  await db.update(sessionsTable)
    .set({ resultJson: result })
    .where(eq(sessionsTable.id, session.id));

  res.json(RunPipelineResponse.parse(result));
});

router.get("/results/latest", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.runAt))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "No allocation runs found. Run the pipeline first." });
    return;
  }

  const result = rows[0].resultJson as object;
  res.json(GetLatestResultsResponse.parse(result));
});

import { eq } from "drizzle-orm";

export default router;
