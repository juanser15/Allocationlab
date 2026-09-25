import { Router, type IRouter } from "express";
import { GetBacktestResponse } from "@workspace/api-zod";
import { db, sessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  parseCsv,
  defaultBacktestConfig,
  runBacktestEngine,
  runWalkForwardFolds,
  runSensitivityGrid,
  computeIntegrityAudit,
  type PriceRow,
  type BacktestConfig,
  type RebalanceFrequency,
  type ExecutionTiming,
  type EtfEntry,
  type Constraints,
} from "../lib/calculator";
import { frozenValidationInputs, reproduceRun, resolveRunSnapshot } from "../lib/run-snapshot";

const router: IRouter = Router();

const METHODOLOGY_NOTE =
  "Each signal uses price data strictly before its signal date. Same-close and next-close trades fill at the indicated close, AFTER the preceding close-to-close return; shares held at the previous close earn that return. Trades and costs affect NAV at the fill and new shares earn subsequent intervals. Next-open requires open-price data and is unavailable. Results are illustrative research output, not investment advice.";

function parseFrequency(v: unknown): RebalanceFrequency {
  return v === "quarterly" ? "quarterly" : "monthly";
}

function parseTiming(v: unknown): ExecutionTiming {
  return v === "same_close" || v === "next_open" ? v : "next_close";
}

function parseNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseFloat(v) : NaN;
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE_RE.test(v) ? v : null;
}

router.get("/backtest", async (req, res): Promise<void> => {
  const requestedId = req.query.sessionId;
  if (requestedId !== undefined && (typeof requestedId !== "string" || !/^[1-9]\d*$/.test(requestedId) || !Number.isSafeInteger(Number(requestedId)))) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }
  const [session] = requestedId
    ? await db.select().from(sessionsTable).where(eq(sessionsTable.id, Number(requestedId))).limit(1)
    : await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt), desc(sessionsTable.id)).limit(1);
  if (!session) {
    res.status(404).json({ error: "Optimization run not found." });
    return;
  }
  const stored = session.resultJson as Record<string, unknown>;
  const resolution = resolveRunSnapshot(stored);
  const reproduction = reproduceRun(stored);
  const snapshot = resolution.snapshot;
  const snapshotStatus = resolution.status === "ready" && reproduction.status === "fail"
    ? "reproducibility_fail" : resolution.status;
  const benchmarkParam = typeof req.query.benchmark === "string"
    ? req.query.benchmark.toLowerCase() === "none" ? null : req.query.benchmark.toUpperCase()
    : snapshot?.benchmarkConfiguration.defaultTicker ?? null;
  const validatedAt = new Date().toISOString();

  const defaults = defaultBacktestConfig();
  const config: BacktestConfig = {
    rebalanceFrequency: parseFrequency(req.query.rebalanceFrequency),
    executionTiming: parseTiming(req.query.executionTiming),
    transactionCostBps: parseNumber(req.query.transactionCostBps, defaults.transactionCostBps, 0, 500),
    slippageBps: parseNumber(req.query.slippageBps, defaults.slippageBps, 0, 500),
    maxTurnoverPerRebalance: parseNumber(req.query.maxTurnoverPerRebalance, defaults.maxTurnoverPerRebalance, 0, 1),
    cashYieldAnnual: parseNumber(req.query.cashYieldAnnual, defaults.cashYieldAnnual, 0, 0.2),
    warmupDays: Math.round(parseNumber(req.query.warmupDays, defaults.warmupDays, 60, 756)),
    startDate: parseIsoDate(req.query.startDate),
  };
  const endDate = parseIsoDate(req.query.endDate);

  const etfs = (snapshot?.universe.etfs ?? []) as EtfEntry[];
  const enabledTickers = etfs.filter((e) => e.enabled).map((e) => e.ticker);
  const constraints = snapshot?.constraints as Constraints;
  const factorSet = snapshot ? { factors: snapshot.factorSet.factors } : undefined;
  const validationIdentity = snapshot ? {
    optimizationRunId: session.id, datasetId: snapshot.dataset.id,
    datasetHash: snapshot.dataset.sha256, factorSetVersion: snapshot.factorSet.version,
    factorSetSnapshot: snapshot.factorSet.factors,
    constraintsSnapshot: snapshot.constraints, universeSnapshot: snapshot.universe,
    engineVersion: snapshot.engineVersion, validationAssumptions: {
      ...config, benchmarkTicker: benchmarkParam, endDate: parseIsoDate(req.query.endDate),
    }, validatedAt,
  } : null;

  const empty = (reason: string, dataStartDate: string | null = null, dataEndDate: string | null = null) =>
    GetBacktestResponse.parse({
      optimizationRunId: session.id, snapshotStatus, reproducibility: reproduction, validationIdentity,
      hasSufficientData: false,
      insufficientReason: reason,
      startDate: null,
      endDate: null,
      tradingDays: 0,
      canAnnualize: false,
      equityCurve: [],
      dailyLedger: [],
      cumulativeReturn: null,
      annualizedReturn: null,
      annualizedVolatility: null,
      sharpeRatio: null,
      maxDrawdown: null,
      avgTurnover: null,
      totalTransactionCostPct: null,
      monthlyReturns: [],
      rebalanceLog: [],
      benchmarkTicker: null,
      benchmarkCumulativeReturn: null,
      benchmarkAnnualizedReturn: null,
      benchmarkUnavailableReason: null,
      availableBenchmarkTickers: enabledTickers,
      dataStartDate,
      dataEndDate,
      config,
      integrity: { score: 0, grade: "not_reliable", hardFail: true, checklist: [] },
      walkForward: { folds: [], note: "" },
      sensitivity: { runs: [], stabilityWarning: false, note: "" },
      warnings: [],
      methodologyNote: METHODOLOGY_NOTE,
    });

  if (snapshotStatus !== "ready") {
    res.json(empty(reproduction.status === "fail"
      ? `REPRODUCIBILITY FAIL: ${reproduction.differences.join("; ")}`
      : resolution.message));
    return;
  }
  if (config.executionTiming === "next_open") {
    res.json(empty("Next-open execution requires open-price data and is currently unavailable."));
    return;
  }

  let priceRows: PriceRow[];
  try {
    priceRows = frozenValidationInputs(stored)!.priceRows;
  } catch {
    res.json(empty("Could not parse the run's frozen price data."));
    return;
  }

  const fullDataStartDate = snapshot!.dataset.startDate;
  const fullDataEndDate = snapshot!.dataset.endDate;

  if (enabledTickers.length === 0) {
    res.json(empty("No ETFs are enabled in the current universe. Enable at least one ETF in Portfolio Construction.", fullDataStartDate, fullDataEndDate));
    return;
  }

  if (endDate) {
    priceRows = priceRows.filter((r) => r.date <= endDate);
    if (priceRows.length === 0) {
      res.json(empty("No price data available on or before the selected end date.", fullDataStartDate, fullDataEndDate));
      return;
    }
  }

  const engineResult = runBacktestEngine(priceRows, etfs, constraints, config, benchmarkParam, factorSet);
  if (!engineResult.hasSufficientData) {
    res.json(empty(engineResult.insufficientReason ?? "Not enough data to run a backtest.", fullDataStartDate, fullDataEndDate));
    return;
  }

  const walkForward = runWalkForwardFolds(engineResult, 3);
  const sensitivity = runSensitivityGrid(priceRows, etfs, constraints, config, factorSet);
  const integrity = computeIntegrityAudit(engineResult, config, sensitivity, walkForward);

  const warnings: string[] = [
    "Price history is fetched live from Yahoo Finance and reflects the ETF universe as configured today — ETFs that were delisted, merged, or renamed historically cannot be reconstructed (survivorship bias).",
    "Prices used are adjusted close, which bakes in dividend and split adjustments; a live execution's fills would not exactly match these adjusted values.",
  ];
  if (integrity.hardFail) {
    warnings.push("This configuration fails at least one integrity check and should not be treated as research-grade until resolved (see the integrity checklist).");
  }

  const benchmarkUnavailableReason =
    engineResult.benchmarkUnavailableReason ??
    (benchmarkParam && !engineResult.benchmarkTicker
      ? !enabledTickers.includes(benchmarkParam)
        ? `${benchmarkParam} is not an enabled ETF in the current universe.`
        : `No price data available for ${benchmarkParam} over the backtest period.`
      : null);

  res.json(
    GetBacktestResponse.parse({
      ...engineResult,
      optimizationRunId: session.id, snapshotStatus, reproducibility: reproduction, validationIdentity,
      benchmarkUnavailableReason,
      availableBenchmarkTickers: enabledTickers,
      dataStartDate: fullDataStartDate,
      dataEndDate: fullDataEndDate,
      config,
      integrity,
      walkForward,
      sensitivity,
      warnings,
      methodologyNote: METHODOLOGY_NOTE,
    })
  );
});

export default router;
