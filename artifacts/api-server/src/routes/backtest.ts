import { Router, type IRouter } from "express";
import {
  GetBacktestResponse, CreateValidationRunBody, CreateValidationRunResponse,
  GetValidationRunResponse, ListValidationRunsResponse,
  type BacktestResult,
} from "@workspace/api-zod";
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
  AllocationConstraintError,
} from "../lib/calculator";
import { frozenValidationInputs, reproduceRun, resolveRunSnapshot } from "../lib/run-snapshot";
import { getValidationRun, listValidationRuns, persistValidationRun } from "../lib/validation-run-store";

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
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE_RE.test(v) ? v : null;
}

class BacktestRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function computeBacktest(params: Record<string, unknown>): Promise<BacktestResult> {
  const requestedId = params.sessionId;
  if (requestedId !== undefined && !(/^[1-9]\d*$/.test(String(requestedId)) && Number.isSafeInteger(Number(requestedId))))
    throw new BacktestRequestError("Invalid session ID", 400);
  const [session] = requestedId
    ? await db.select().from(sessionsTable).where(eq(sessionsTable.id, Number(requestedId))).limit(1)
    : await db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt), desc(sessionsTable.id)).limit(1);
  if (!session) throw new BacktestRequestError("Optimization run not found.", 404);
  const stored = session.resultJson as Record<string, unknown>;
  const resolution = resolveRunSnapshot(stored);
  const reproduction = reproduceRun(stored);
  const snapshot = resolution.snapshot;
  const snapshotStatus = resolution.status === "ready" && reproduction.status === "fail"
    ? "reproducibility_fail" : resolution.status;
  const benchmarkParam = typeof params.benchmark === "string"
    ? params.benchmark.toLowerCase() === "none" ? null : params.benchmark.toUpperCase()
    : snapshot?.benchmarkConfiguration.defaultTicker ?? null;
  const validatedAt = new Date().toISOString();

  const defaults = defaultBacktestConfig();
  const config: BacktestConfig = {
    rebalanceFrequency: parseFrequency(params.rebalanceFrequency),
    executionTiming: parseTiming(params.executionTiming),
    transactionCostBps: parseNumber(params.transactionCostBps, defaults.transactionCostBps, 0, 500),
    slippageBps: parseNumber(params.slippageBps, defaults.slippageBps, 0, 500),
    maxTurnoverPerRebalance: parseNumber(params.maxTurnoverPerRebalance, defaults.maxTurnoverPerRebalance, 0, 1),
    cashYieldAnnual: parseNumber(params.cashYieldAnnual, defaults.cashYieldAnnual, 0, 0.2),
    warmupDays: Math.round(parseNumber(params.warmupDays, defaults.warmupDays, 60, 756)),
    startDate: parseIsoDate(params.startDate),
  };
  const endDate = parseIsoDate(params.endDate);

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
      ...config, benchmarkTicker: benchmarkParam, endDate,
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
    return empty(reproduction.status === "fail"
      ? `REPRODUCIBILITY FAIL: ${reproduction.differences.join("; ")}`
      : resolution.message);
  }
  if (config.executionTiming === "next_open") {
    return empty("Next-open execution requires open-price data and is currently unavailable.");
  }

  let priceRows: PriceRow[];
  try {
    priceRows = frozenValidationInputs(stored)!.priceRows;
  } catch {
    return empty("Could not parse the run's frozen price data.");
  }

  const fullDataStartDate = snapshot!.dataset.startDate;
  const fullDataEndDate = snapshot!.dataset.endDate;

  if (enabledTickers.length === 0) {
    return empty("No ETFs are enabled in this run's frozen universe.", fullDataStartDate, fullDataEndDate);
  }

  if (endDate) {
    priceRows = priceRows.filter((r) => r.date <= endDate);
    if (priceRows.length === 0) {
      return empty("No price data available on or before the selected end date.", fullDataStartDate, fullDataEndDate);
    }
  }

  const engineResult = runBacktestEngine(priceRows, etfs, constraints, config, benchmarkParam, factorSet);
  if (!engineResult.hasSufficientData) {
    return empty(engineResult.insufficientReason ?? "Not enough data to run a backtest.", fullDataStartDate, fullDataEndDate);
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

  return GetBacktestResponse.parse({
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
    });
}

function sendError(res: import("express").Response, error: unknown): void {
  if (error instanceof AllocationConstraintError) {
    res.status(422).json({ error: error.reason });
    return;
  }
  if (error instanceof BacktestRequestError) {
    res.status(error.status).json({ error: error.message });
  } else {
    throw error;
  }
}

router.get("/backtest", async (req, res): Promise<void> => {
  try { res.json(await computeBacktest(req.query)); }
  catch (error) { sendError(res, error); }
});

router.post("/validation-runs", async (req, res): Promise<void> => {
  const parsed = CreateValidationRunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const result = await computeBacktest(parsed.data);
    if (!result.hasSufficientData) {
      res.status(422).json({ error: result.insufficientReason ?? "Validation could not be completed." });
      return;
    }
    res.status(201).json(CreateValidationRunResponse.parse(await persistValidationRun(result)));
  } catch (error) { sendError(res, error); }
});

router.get("/validation-runs", async (req, res): Promise<void> => {
  const raw = req.query.sessionId;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  res.json(ListValidationRunsResponse.parse(await listValidationRuns(Number(raw))));
});

router.get("/validation-runs/:validationRunId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.validationRunId) ? req.params.validationRunId[0] : req.params.validationRunId;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    res.status(400).json({ error: "Invalid Validation Run ID" }); return;
  }
  const run = await getValidationRun(Number(raw));
  if (!run) { res.status(404).json({ error: "Validation Run not found." }); return; }
  res.json(GetValidationRunResponse.parse(run));
});

export default router;
