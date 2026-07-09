import { Router, type IRouter } from "express";
import { GetBacktestResponse } from "@workspace/api-zod";
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
import { getLatestPriceData } from "./prices";
import { getUniverseConfig } from "./universe";
import { getConstraintsConfig } from "./constraints";

const router: IRouter = Router();

const METHODOLOGY_NOTE =
  "This is a point-in-time walk-forward backtest: at each rebalance date, the factor and regime signal is recomputed from scratch using only price data strictly before that date, then applied at the chosen execution timing. Cash and transaction cost/slippage assumptions are configurable below. Results are illustrative research output, not investment advice, and are never labeled production-grade if any integrity check fails.";

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

router.get("/backtest", async (req, res): Promise<void> => {
  const benchmarkParam = typeof req.query.benchmark === "string" ? req.query.benchmark.toUpperCase() : null;

  const defaults = defaultBacktestConfig();
  const config: BacktestConfig = {
    rebalanceFrequency: parseFrequency(req.query.rebalanceFrequency),
    executionTiming: parseTiming(req.query.executionTiming),
    transactionCostBps: parseNumber(req.query.transactionCostBps, defaults.transactionCostBps, 0, 500),
    slippageBps: parseNumber(req.query.slippageBps, defaults.slippageBps, 0, 500),
    maxTurnoverPerRebalance: parseNumber(req.query.maxTurnoverPerRebalance, defaults.maxTurnoverPerRebalance, 0, 1),
    cashYieldAnnual: parseNumber(req.query.cashYieldAnnual, defaults.cashYieldAnnual, 0, 0.2),
    warmupDays: Math.round(parseNumber(req.query.warmupDays, defaults.warmupDays, 60, 756)),
  };

  const universe = await getUniverseConfig();
  const etfs = universe.etfs as EtfEntry[];
  const enabledTickers = etfs.filter((e) => e.enabled).map((e) => e.ticker);
  const constraints = (await getConstraintsConfig()) as Constraints;

  const empty = (reason: string) =>
    GetBacktestResponse.parse({
      hasSufficientData: false,
      insufficientReason: reason,
      startDate: null,
      endDate: null,
      tradingDays: 0,
      canAnnualize: false,
      equityCurve: [],
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
      config,
      integrity: { score: 0, grade: "not_reliable", hardFail: true, checklist: [] },
      walkForward: { folds: [], note: "" },
      sensitivity: { runs: [], stabilityWarning: false, note: "" },
      warnings: [],
      methodologyNote: METHODOLOGY_NOTE,
    });

  const priceRow = await getLatestPriceData();
  if (!priceRow) {
    res.json(empty("No price data uploaded. Upload a price CSV in Portfolio Construction to backtest the portfolio."));
    return;
  }

  let priceRows: PriceRow[];
  try {
    priceRows = parseCsv(priceRow.csvContent);
  } catch {
    res.json(empty("Could not parse the uploaded price data."));
    return;
  }

  if (enabledTickers.length === 0) {
    res.json(empty("No ETFs are enabled in the current universe. Enable at least one ETF in Portfolio Construction."));
    return;
  }

  const engineResult = runBacktestEngine(priceRows, etfs, constraints, config, benchmarkParam);
  if (!engineResult.hasSufficientData) {
    res.json(empty(engineResult.insufficientReason ?? "Not enough data to run a backtest."));
    return;
  }

  const walkForward = runWalkForwardFolds(engineResult, 3);
  const sensitivity = runSensitivityGrid(priceRows, etfs, constraints, config);
  const integrity = computeIntegrityAudit(engineResult, config, sensitivity, walkForward);

  const warnings: string[] = [
    "Price history is fetched live from Yahoo Finance and reflects the ETF universe as configured today — ETFs that were delisted, merged, or renamed historically cannot be reconstructed (survivorship bias).",
    "Prices used are adjusted close, which bakes in dividend and split adjustments; a live execution's fills would not exactly match these adjusted values.",
  ];
  if (config.executionTiming === "next_open") {
    warnings.push("\"Next open\" execution is approximated using the next trading day's close because intraday open prices are not collected — treat next-open results as an approximation, not a true open-price fill.");
  }
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
      benchmarkUnavailableReason,
      availableBenchmarkTickers: enabledTickers,
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
