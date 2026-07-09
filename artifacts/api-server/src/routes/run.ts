import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  RunPipelineBody,
  RunPipelineResponse,
  GetLatestResultsResponse,
} from "@workspace/api-zod";
import {
  parseCsv,
  computeFactors,
  computeRegime,
  constructAllocation,
  computeWatchlist,
  generateIcSummary,
  computePortfolioDiagnostics,
} from "../lib/calculator";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";
import { getLatestPriceData } from "./prices";

const router: IRouter = Router();

const ITERATION_INFO = {
  current: 13,
  max: 15,
  completed: [
    "Core UI scaffold & navigation",
    "Price data upload & live Yahoo Finance integration",
    "Factor computation engine (8 factors)",
    "Regime estimation (4 computed components)",
    "Allocation constructor with constraints",
    "Results dashboard with heatmap",
    "Report generation (CSV + PDF)",
    "10-component Market Health module + IC Summary + Watchlist",
    "Portfolio Diagnostics (vol, HHI, ENB, risk contributions, correlation heatmap, tracking error)",
    "ETF Explorer (price chart, factor breakdown, score history, IC narrative, clickable links)",
    "Backtesting workspace (equity curve, return/vol/Sharpe/drawdown/turnover, monthly returns, benchmark comparison, contribution summary)",
    "Committee report builder (editable one-page report, preview mode, polished PDF/PNG export, quality checklist)",
    "PM Decision Room with structured recommendation cards and an auditable Decision Log",
    "Historical Archive workspace (browse prior rebalances, side-by-side comparison with turnover & realized return, filters, PDF/PNG/CSV export)",
    "Bias-resistant backtester (execution timing/costs/slippage, walk-forward testing, sensitivity checks, bias audit checklist, Integrity Score)",
    "AI Investment Committee reasoning layer (deterministic persona debate + CIO synthesis + exportable memo, zero fabrication)",
    "Risk Model Pro (selectable covariance models, MCR/CCR, beta, downside vol, drawdown risk, risk-based concentration & decomposition, embedded in Portfolio Lab diagnostics)",
    "Scenario & Stress Lab (user-defined macro shocks and predefined historical stress scenarios, ETF/bucket contribution, cash buffer adequacy, watch items, embedded in Research Lab, Portfolio Lab, Investment Committee, and Reports)",
    "Trade Implementation (current -> target trade list with AUM-scaled $ sizing, rounding to whole shares, min trade size filter, turnover & cash impact, ADV/liquidity marked unavailable never fabricated, execution assumptions, CSV blotter export, embedded in Portfolio Lab, Dashboard, Investment Committee, and Reports)",
  ],
  next: [
    "Attribution Engine (return decomposition by factor, sector, and selection vs. allocation)",
    "Production Governance (audit trails, approval workflows, role-based access controls)",
  ],
};

const EMPTY_DIAGNOSTICS = {
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
};

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
    if (s) { s.status = status; s.message = message ?? null; }
    const idx = steps.findIndex((x) => x.step === step);
    if (idx >= 0 && idx + 1 < steps.length && status === "done") steps[idx + 1].status = "running";
  }

  // Step 1: Load price data
  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.status(400).json({ error: "No price data available. Please upload a CSV or use Refresh Market Data in Portfolio Construction." });
    return;
  }

  let priceRows;
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch (err: unknown) {
    res.status(400).json({ error: `Failed to parse price data: ${err instanceof Error ? err.message : "CSV parse error"}` });
    return;
  }
  markStep("load_data", "done", `${priceRows.length} rows loaded (${priceRow.startDate} → ${priceRow.endDate})`);

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
    res.status(500).json({ error: `Factor computation failed: ${err instanceof Error ? err.message : "error"}` });
    return;
  }

  // Step 3: Estimate regime
  let regime;
  try {
    regime = computeRegime(priceRows, tickers);
    markStep("estimate_regime", "done", `Regime: ${regime.label} (composite: ${regime.composite}, confidence: ${regime.confidence}%)`);
  } catch (err: unknown) {
    res.status(500).json({ error: `Regime estimation failed: ${err instanceof Error ? err.message : "error"}` });
    return;
  }

  // Step 4: Score ETFs
  markStep("score_etfs", "done", `${factorData.length} ETFs scored`);

  // Step 5: Construct allocation
  let allocations;
  try {
    allocations = constructAllocation(factorData, universe.etfs, constraints, regime);
    markStep("construct_allocation", "done", `${allocations.filter((a) => a.active).length} active ETFs allocated`);
  } catch (err: unknown) {
    res.status(500).json({ error: `Allocation construction failed: ${err instanceof Error ? err.message : "error"}` });
    return;
  }

  const activeEtfs = allocations.filter((a) => a.active);
  const cashWeight = Math.max(0, Math.min(1, 1 - allocations.reduce((s, a) => s + a.weight, 0)));
  const cashChange = cashWeight - universe.cashPriorWeight;
  const investedSleeve = 1 - cashWeight;

  // Build ETF map for diagnostics
  const etfMap = new Map((universe.etfs as Array<{ ticker: string; name: string; sector: string; priorWeight: number; enabled: boolean }>).map((e) => [e.ticker, e]));

  const watchlist = computeWatchlist(factorData, universe.etfs, constraints, allocations);
  const icSummary = generateIcSummary(regime, cashWeight, universe.cashPriorWeight, activeEtfs.length, allocations);
  const diagnostics = computePortfolioDiagnostics(allocations, etfMap, priceRows, availableTickers);

  const result = {
    sessionId: 0,
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
    watchlist,
    icSummary,
    iterationInfo: ITERATION_INFO,
    diagnostics,
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

  await db.update(sessionsTable).set({ resultJson: result }).where(eq(sessionsTable.id, session.id));

  res.json(RunPipelineResponse.parse(result));
});

router.get("/results/latest", async (req, res): Promise<void> => {
  const rows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "No allocation runs found. Run the pipeline first." });
    return;
  }

  const stored = rows[0].resultJson as Record<string, unknown>;

  // Back-fill fields added in Iterations 2 & 3 for old sessions
  const result = {
    ...stored,
    watchlist: (stored.watchlist as unknown[]) ?? [],
    icSummary: (stored.icSummary as object | undefined) ?? {
      whatChanged: "Pre-Iteration-2 session. Re-run the pipeline to generate.",
      why: "Not available.", risks: "Not available.", watchNext: "Re-run the pipeline.",
    },
    iterationInfo: (stored.iterationInfo as object | undefined) ?? ITERATION_INFO,
    diagnostics: (stored.diagnostics as object | undefined) ?? EMPTY_DIAGNOSTICS,
    regime: {
      ...(stored.regime as object),
      components: ((stored.regime as Record<string, unknown>)?.components as unknown[]) ?? [],
      confidence: ((stored.regime as Record<string, unknown>)?.confidence as number) ?? 0,
      drivers: ((stored.regime as Record<string, unknown>)?.drivers as string) ?? "Pre-Iteration-2 session. Re-run to populate.",
    },
  };

  res.json(GetLatestResultsResponse.parse(result));
});

import { eq } from "drizzle-orm";

export default router;
