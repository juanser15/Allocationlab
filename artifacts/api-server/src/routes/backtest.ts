import { Router, type IRouter } from "express";
import { db, sessionsTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { GetBacktestResponse } from "@workspace/api-zod";
import { parseCsv, type PriceRow } from "../lib/calculator";
import { getLatestPriceData } from "./prices";
import { getUniverseConfig } from "./universe";

const router: IRouter = Router();

const TRADING_DAYS_PER_YEAR = 252;
const MIN_DAYS_FOR_ANNUALIZATION = 10;
const MIN_DAYS_FOR_BACKTEST = 2;

interface SessionAllocation {
  ticker: string;
  weight: number;
}

interface ParsedSession {
  sessionId: number;
  runAt: string;
  label: string | null;
  regimeLabel: string;
  cashWeight: number;
  allocations: SessionAllocation[];
}

function extractSession(row: typeof sessionsTable.$inferSelect): ParsedSession {
  const result = row.resultJson as Record<string, unknown>;
  const allocs = (result.allocations as Array<Record<string, unknown>>) ?? [];
  return {
    sessionId: row.id,
    runAt: row.runAt instanceof Date ? row.runAt.toISOString() : String(row.runAt),
    label: row.label,
    regimeLabel: row.regimeLabel,
    cashWeight: row.cashWeight,
    allocations: allocs
      .filter((a) => (a.active as boolean) && (a.weight as number) > 0)
      .map((a) => ({ ticker: a.ticker as string, weight: a.weight as number })),
  };
}

function topHoldings(allocations: SessionAllocation[]): string[] {
  return [...allocations]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((a) => a.ticker);
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

router.get("/backtest", async (req, res): Promise<void> => {
  const benchmarkParam = typeof req.query.benchmark === "string" ? req.query.benchmark.toUpperCase() : null;

  const universe = await getUniverseConfig();
  const enabledTickers = (universe.etfs as Array<{ ticker: string; enabled: boolean }>)
    .filter((e) => e.enabled)
    .map((e) => e.ticker);

  const sessionRows = await db.select().from(sessionsTable).orderBy(asc(sessionsTable.runAt));
  const priceRow = await getLatestPriceData();

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
      monthlyReturns: [],
      periods: [],
      narrative: null,
      benchmarkTicker: null,
      benchmarkCumulativeReturn: null,
      benchmarkAnnualizedReturn: null,
      benchmarkUnavailableReason: null,
      availableBenchmarkTickers: enabledTickers,
      methodologyNote:
        "Backtests apply each rebalance's allocation weights forward from its run date to the next rebalance (or to the latest available price date). Price history predating the first rebalance uses that rebalance's weights, backdated, so a single allocation can be evaluated across all available history. Cash is assumed to earn 0% for simplicity. Results are illustrative, not investment advice.",
    });

  if (sessionRows.length === 0) {
    res.json(empty("Run the allocation pipeline at least once from Investment Committee to generate a backtest."));
    return;
  }

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

  if (priceRows.length < 2) {
    res.json(empty("Not enough price history uploaded to compute a backtest."));
    return;
  }

  const sessions = sessionRows.map(extractSession);

  // Use the full uploaded price history: price dates before the earliest known allocation are
  // backdated to that allocation's weights, since it's the earliest rebalance on record.
  // This is a disclosed simplifying assumption (see methodologyNote) that allows a full-history
  // backtest even with a single session.
  const eligiblePriceRows = priceRows;

  if (eligiblePriceRows.length < MIN_DAYS_FOR_BACKTEST) {
    res.json(empty(`Only ${eligiblePriceRows.length} day(s) of price history are uploaded — not enough to compute a backtest.`));
    return;
  }

  // Determine which session governs each price date (piecewise-constant weights, forward-chained).
  // Dates before the first session use the first session's weights (backdated).
  function sessionForDate(date: string): ParsedSession {
    let active = sessions[0];
    for (const s of sessions) {
      if (dateOnly(s.runAt) <= date) active = s;
      else break;
    }
    return active;
  }

  const dailyReturns: Array<{ date: string; portfolioReturn: number; benchmarkReturn: number | null }> = [];
  let benchmarkUnavailableReason: string | null = null;

  if (benchmarkParam) {
    const hasBenchmarkPrices = eligiblePriceRows.some((r) => r.prices[benchmarkParam] !== undefined);
    if (!enabledTickers.includes(benchmarkParam)) {
      benchmarkUnavailableReason = `${benchmarkParam} is not an enabled ETF in the current universe.`;
    } else if (!hasBenchmarkPrices) {
      benchmarkUnavailableReason = `No price data available for ${benchmarkParam} over the backtest period.`;
    }
  }

  for (let i = 1; i < eligiblePriceRows.length; i++) {
    const prevRow = eligiblePriceRows[i - 1];
    const row = eligiblePriceRows[i];
    const session = sessionForDate(row.date);

    let portfolioReturn = 0;
    for (const alloc of session.allocations) {
      const prevPrice = prevRow.prices[alloc.ticker];
      const price = row.prices[alloc.ticker];
      if (prevPrice && price && prevPrice > 0) {
        portfolioReturn += alloc.weight * ((price - prevPrice) / prevPrice);
      }
      // Missing price data for a held ticker on this day contributes 0% for that day only.
    }
    // Cash portion contributes 0% (stated methodology assumption).

    let benchmarkReturn: number | null = null;
    if (benchmarkParam && !benchmarkUnavailableReason) {
      const prevPrice = prevRow.prices[benchmarkParam];
      const price = row.prices[benchmarkParam];
      if (prevPrice && price && prevPrice > 0) {
        benchmarkReturn = (price - prevPrice) / prevPrice;
      }
    }

    dailyReturns.push({ date: row.date, portfolioReturn, benchmarkReturn });
  }

  const tradingDays = dailyReturns.length;
  const canAnnualize = tradingDays >= MIN_DAYS_FOR_ANNUALIZATION;

  // Build equity curve indexed to 100, tracking running peak for drawdown.
  let portfolioIndex = 100;
  let benchmarkIndex = benchmarkParam && !benchmarkUnavailableReason ? 100 : null;
  let peak = 100;
  const equityCurve: Array<{ date: string; portfolioIndex: number; benchmarkIndex: number | null; drawdownPct: number }> = [
    { date: eligiblePriceRows[0].date, portfolioIndex: 100, benchmarkIndex, drawdownPct: 0 },
  ];

  for (const dr of dailyReturns) {
    portfolioIndex *= 1 + dr.portfolioReturn;
    if (benchmarkIndex !== null) {
      benchmarkIndex *= 1 + (dr.benchmarkReturn ?? 0);
    }
    peak = Math.max(peak, portfolioIndex);
    const drawdownPct = peak > 0 ? portfolioIndex / peak - 1 : 0;
    equityCurve.push({
      date: dr.date,
      portfolioIndex: Math.round(portfolioIndex * 100) / 100,
      benchmarkIndex: benchmarkIndex !== null ? Math.round(benchmarkIndex * 100) / 100 : null,
      drawdownPct: Math.round(drawdownPct * 10000) / 10000,
    });
  }

  const cumulativeReturn = portfolioIndex / 100 - 1;
  const maxDrawdown = Math.min(...equityCurve.map((p) => p.drawdownPct), 0);

  let annualizedReturn: number | null = null;
  let annualizedVolatility: number | null = null;
  let sharpeRatio: number | null = null;

  if (canAnnualize) {
    annualizedReturn = Math.pow(1 + cumulativeReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1;
    const mean = dailyReturns.reduce((s, d) => s + d.portfolioReturn, 0) / tradingDays;
    const variance = dailyReturns.reduce((s, d) => s + Math.pow(d.portfolioReturn - mean, 2), 0) / tradingDays;
    const dailyStd = Math.sqrt(variance);
    annualizedVolatility = dailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR);
    sharpeRatio = annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : null;
  }

  const benchmarkCumulativeReturn = benchmarkIndex !== null ? benchmarkIndex / 100 - 1 : null;
  const benchmarkAnnualizedReturn =
    benchmarkCumulativeReturn !== null && canAnnualize
      ? Math.pow(1 + benchmarkCumulativeReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1
      : null;

  // Monthly returns table
  const monthlyMap = new Map<string, { portfolioFactor: number; benchmarkFactor: number | null; hasBenchmark: boolean }>();
  for (const dr of dailyReturns) {
    const month = dr.date.slice(0, 7);
    const existing = monthlyMap.get(month) ?? { portfolioFactor: 1, benchmarkFactor: 1, hasBenchmark: benchmarkIndex !== null };
    existing.portfolioFactor *= 1 + dr.portfolioReturn;
    if (existing.hasBenchmark) {
      existing.benchmarkFactor = (existing.benchmarkFactor ?? 1) * (1 + (dr.benchmarkReturn ?? 0));
    }
    monthlyMap.set(month, existing);
  }
  const monthlyReturns = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      portfolioReturn: Math.round((v.portfolioFactor - 1) * 10000) / 10000,
      benchmarkReturn: v.hasBenchmark && v.benchmarkFactor !== null ? Math.round((v.benchmarkFactor - 1) * 10000) / 10000 : null,
    }));

  // Per-session periods with contribution decomposition.
  const periods: Array<{
    sessionId: number;
    label: string | null;
    startDate: string;
    endDate: string;
    tradingDays: number;
    regimeLabel: string;
    cashWeight: number;
    topHoldings: string[];
    periodReturn: number | null;
    contributionPct: number | null;
    turnover: number | null;
  }> = [];

  for (let s = 0; s < sessions.length; s++) {
    const session = sessions[s];
    // The first session's period starts at the beginning of available price history (backdated);
    // subsequent sessions' periods start at their own run date.
    const periodStart = s === 0 ? eligiblePriceRows[0].date : dateOnly(session.runAt);
    const nextSessionDate = s + 1 < sessions.length ? dateOnly(sessions[s + 1].runAt) : null;

    const periodDays = eligiblePriceRows.filter(
      (r) => r.date >= periodStart && (nextSessionDate === null || r.date < nextSessionDate)
    );

    if (periodDays.length === 0) {
      periods.push({
        sessionId: session.sessionId,
        label: session.label,
        startDate: periodStart,
        endDate: nextSessionDate ?? periodStart,
        tradingDays: 0,
        regimeLabel: session.regimeLabel,
        cashWeight: session.cashWeight,
        topHoldings: topHoldings(session.allocations),
        periodReturn: null,
        contributionPct: null,
        turnover: null,
      });
      continue;
    }

    // equity index at the start/end of this period, found from equityCurve.
    const startEquityPoint = equityCurve.find((p) => p.date === periodDays[0].date);
    const endEquityPoint = [...equityCurve].reverse().find((p) => p.date === periodDays[periodDays.length - 1].date);

    let periodReturn: number | null = null;
    let contributionPct: number | null = null;
    if (startEquityPoint && endEquityPoint) {
      // Use the index value just before this period started (prior day) when available, for a true period return.
      const startIdx = equityCurve.indexOf(startEquityPoint);
      const preStart = startIdx > 0 ? equityCurve[startIdx - 1] : startEquityPoint;
      periodReturn = preStart.portfolioIndex > 0 ? endEquityPoint.portfolioIndex / preStart.portfolioIndex - 1 : null;
      contributionPct = (endEquityPoint.portfolioIndex - preStart.portfolioIndex) / 100;
    }

    let turnover: number | null = null;
    if (s > 0) {
      const prevWeights = new Map(sessions[s - 1].allocations.map((a) => [a.ticker, a.weight]));
      const currWeights = new Map(session.allocations.map((a) => [a.ticker, a.weight]));
      const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
      let sumAbsDiff = 0;
      for (const t of allTickers) {
        sumAbsDiff += Math.abs((currWeights.get(t) ?? 0) - (prevWeights.get(t) ?? 0));
      }
      turnover = sumAbsDiff / 2;
    }

    periods.push({
      sessionId: session.sessionId,
      label: session.label,
      startDate: periodDays[0].date,
      endDate: periodDays[periodDays.length - 1].date,
      tradingDays: periodDays.length,
      regimeLabel: session.regimeLabel,
      cashWeight: session.cashWeight,
      topHoldings: topHoldings(session.allocations),
      periodReturn: periodReturn !== null ? Math.round(periodReturn * 10000) / 10000 : null,
      contributionPct: contributionPct !== null ? Math.round(contributionPct * 10000) / 10000 : null,
      turnover: turnover !== null ? Math.round(turnover * 10000) / 10000 : null,
    });
  }

  const turnoverValues = periods.map((p) => p.turnover).filter((t): t is number => t !== null);
  const avgTurnover = turnoverValues.length > 0 ? turnoverValues.reduce((s, t) => s + t, 0) / turnoverValues.length : null;

  // Narrative on contribution
  const scoredPeriods = periods.filter((p) => p.contributionPct !== null && p.tradingDays > 0);
  let narrative: string | null = null;
  if (scoredPeriods.length > 0) {
    const sorted = [...scoredPeriods].sort((a, b) => (b.contributionPct ?? 0) - (a.contributionPct ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const fmt = (p: typeof best) =>
      `${p.label ? `"${p.label}"` : `the ${p.startDate} rebalance`} (${p.regimeLabel} regime, holding ${p.topHoldings.join(", ") || "cash only"})`;

    if (sorted.length === 1) {
      narrative = `The only priced period, ${fmt(best)}, produced a return of ${((best.periodReturn ?? 0) * 100).toFixed(1)}%, contributing ${((best.contributionPct ?? 0) * 100).toFixed(1)}pp to cumulative performance.`;
    } else if (best.contributionPct !== null && worst.contributionPct !== null && best !== worst) {
      narrative =
        `The largest positive contributor was ${fmt(best)}, adding ${((best.contributionPct ?? 0) * 100).toFixed(1)}pp to cumulative return over ${best.tradingDays} trading day(s). ` +
        `The largest detractor was ${fmt(worst)}, ${(worst.contributionPct ?? 0) >= 0 ? "adding only" : "subtracting"} ${Math.abs((worst.contributionPct ?? 0) * 100).toFixed(1)}pp.`;
    }
  }

  res.json(
    GetBacktestResponse.parse({
      hasSufficientData: true,
      insufficientReason: null,
      startDate: eligiblePriceRows[0].date,
      endDate: eligiblePriceRows[eligiblePriceRows.length - 1].date,
      tradingDays,
      canAnnualize,
      equityCurve,
      cumulativeReturn: Math.round(cumulativeReturn * 10000) / 10000,
      annualizedReturn: annualizedReturn !== null ? Math.round(annualizedReturn * 10000) / 10000 : null,
      annualizedVolatility: annualizedVolatility !== null ? Math.round(annualizedVolatility * 10000) / 10000 : null,
      sharpeRatio: sharpeRatio !== null ? Math.round(sharpeRatio * 1000) / 1000 : null,
      maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
      avgTurnover: avgTurnover !== null ? Math.round(avgTurnover * 10000) / 10000 : null,
      monthlyReturns,
      periods,
      narrative,
      benchmarkTicker: benchmarkParam && !benchmarkUnavailableReason ? benchmarkParam : null,
      benchmarkCumulativeReturn: benchmarkCumulativeReturn !== null ? Math.round(benchmarkCumulativeReturn * 10000) / 10000 : null,
      benchmarkAnnualizedReturn: benchmarkAnnualizedReturn !== null ? Math.round(benchmarkAnnualizedReturn * 10000) / 10000 : null,
      benchmarkUnavailableReason,
      availableBenchmarkTickers: enabledTickers,
      methodologyNote:
        "Backtests apply each rebalance's allocation weights forward from its run date to the next rebalance (or to the latest available price date). Price history predating the first rebalance uses that rebalance's weights, backdated, so a single allocation can be evaluated across all available history. Cash is assumed to earn 0% for simplicity. Results are illustrative, not investment advice.",
    })
  );
});

export default router;
