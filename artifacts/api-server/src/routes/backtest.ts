import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetBacktestResponse, CreateValidationRunBody, CreateValidationRunResponse,
  GetValidationRunResponse, ListValidationRunsResponse,
  type BacktestResult,
} from "@workspace/api-zod";
import { db, sessionsTable, validationRunsTable } from "@workspace/db";
import { desc, eq, isNotNull } from "drizzle-orm";
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
import { listB3ValidationRuns, persistB3ValidationRun, replayB3ValidationRun } from "../lib/b3-validation-store";
import { d6Trace, d6TraceContext, d6Error, withD6Trace } from "../lib/d6-trace";

const router: IRouter = Router();

function tracedD6(action: "validation" | "replay", handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): Promise<void> => {
    const context = d6TraceContext();
    res.setHeader("X-D6-Trace-Id", context.id);
    res.setHeader("Access-Control-Expose-Headers", "X-D6-Trace-Id");
    return withD6Trace(context, async () => {
      const body = req.body as Record<string, unknown> | undefined;
      d6Trace("receive", {
        action,
        allocationId: typeof body?.allocationId === "number" ? body.allocationId : null,
        validationPreparedInputId: typeof body?.validationPreparedInputId === "number" ? body.validationPreparedInputId : null,
        validationRunId: action === "replay" ? String(req.params.validationRunId ?? "") : null,
      });
      res.once("finish", () => d6Trace("response.finish", { action, statusCode: res.statusCode }));
      res.once("close", () => d6Trace("response.close", { action, statusCode: res.statusCode, writableFinished: res.writableFinished }));
      try {
        await handler(req, res);
      } catch (error) {
        d6Trace("request.exception", { action, ...d6Error(error) });
        throw error;
      }
    });
  };
}

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

router.post("/validation-runs", tracedD6("validation", async (req, res): Promise<void> => {
  const parsed = CreateValidationRunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if ("allocationId" in parsed.data) {
    if (!Number.isSafeInteger(parsed.data.allocationId) || !Number.isSafeInteger(parsed.data.validationPreparedInputId)) {
      res.status(400).json({ error: "allocationId and validationPreparedInputId must be positive safe integers." });
      return;
    }
    const saved = await persistB3ValidationRun(parsed.data);
    if ("error" in saved) {
      res.status(typeof saved.status === "number" ? saved.status : 409).json({ error: saved.error });
      return;
    }
    res.status(201).json(CreateValidationRunResponse.parse(saved.run));
    return;
  }
  try {
    const result = await computeBacktest(parsed.data);
    if (!result.hasSufficientData) {
      res.status(422).json({ error: result.insufficientReason ?? "Validation could not be completed." });
      return;
    }
    res.status(201).json(CreateValidationRunResponse.parse(await persistValidationRun(result)));
  } catch (error) { sendError(res, error); }
}));

router.get("/validation-runs", async (req, res): Promise<void> => {
  const rawSessionId = req.query.sessionId;
  const rawAllocationId = req.query.allocationId;
  const source = req.query.source;
  if (rawSessionId !== undefined && rawAllocationId !== undefined ||
      rawSessionId !== undefined && source !== undefined ||
      rawAllocationId !== undefined && source !== undefined) {
    res.status(400).json({ error: "Use only one of sessionId, allocationId, or source=b3." }); return;
  }
  if (rawSessionId !== undefined) {
    if (typeof rawSessionId !== "string" || !/^[1-9]\d*$/.test(rawSessionId) || !Number.isSafeInteger(Number(rawSessionId))) {
      res.status(400).json({ error: "Invalid session ID" }); return;
    }
    res.json(ListValidationRunsResponse.parse(await listValidationRuns(Number(rawSessionId))));
    return;
  }
  if (rawAllocationId !== undefined) {
    if (typeof rawAllocationId !== "string" || !/^[1-9]\d*$/.test(rawAllocationId) || !Number.isSafeInteger(Number(rawAllocationId))) {
      res.status(400).json({ error: "Invalid allocation ID" }); return;
    }
    res.json(ListValidationRunsResponse.parse(await listB3ValidationRuns(Number(rawAllocationId))));
    return;
  }
  if (source === "b3") {
    if (req.query.summary === "1") {
      const rows = await db.select({
        id: validationRunsTable.id,
        allocationId: validationRunsTable.allocationId,
        validationPreparedInputId: validationRunsTable.validationPreparedInputId,
        reconciliationStatus: validationRunsTable.reconciliationStatus,
        validatedAt: validationRunsTable.validatedAt,
      }).from(validationRunsTable)
        .where(isNotNull(validationRunsTable.allocationId))
        .orderBy(desc(validationRunsTable.id));
      res.json(rows.map(row => ({
        validationRunId: row.id,
        allocationId: row.allocationId,
        validationPreparedInputId: row.validationPreparedInputId,
        status: row.reconciliationStatus,
        validatedAt: row.validatedAt,
      })));
      return;
    }
    res.json(ListValidationRunsResponse.parse(await listB3ValidationRuns()));
    return;
  }
  res.status(400).json({ error: "Specify sessionId, allocationId, or source=b3." });
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

router.post("/validation-runs/:validationRunId/replay", tracedD6("replay", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.validationRunId) ? req.params.validationRunId[0] : req.params.validationRunId;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    res.status(400).json({ error: "Invalid Validation Run ID" }); return;
  }
  const replay = await replayB3ValidationRun(Number(raw));
  if (!replay) { res.status(404).json({ error: "Validation Run not found." }); return; }
  res.json(replay);
}));

export default router;
