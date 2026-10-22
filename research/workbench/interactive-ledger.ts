/** Mechanical snapshot of the certified close-fill ledger. Only schedule injection
 * and memoized display-regime metadata differ. Financial operations are unchanged.
 * Protected-source equivalence is enforced in interactive.test.ts. */
import { computeSignalAsOf, resolveExecutionDate, type PriceRow, type EtfEntry, type Constraints,
 type BacktestConfig, type BacktestTargetContext, type BacktestInitialState, type BacktestEngineResult,
 type BacktestPosition, type BacktestLedgerEntry, type RebalanceLogEntry, type AllocationResult,
 type BacktestEquityPoint, type EnrichedRegimeScores } from "../../artifacts/api-server/src/lib/calculator";
import type { FactorDefinition } from "../../artifacts/api-server/src/lib/factor-library";
import { d6Trace } from "../../artifacts/api-server/src/lib/d6-trace";
const TRADING_DAYS_PER_YEAR = 252, MIN_DAYS_FOR_ANNUALIZATION = 10;
function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }
function mean(arr: number[]): number { if (arr.length === 0) return 0; return arr.reduce((a,b) => a+b,0)/arr.length; }
export function runScheduledLedger(
  priceRows: PriceRow[],
  etfs: EtfEntry[],
  constraints: Constraints,
  config: BacktestConfig,
  benchmarkTicker: string | null,
  factorSet: { factors: FactorDefinition[] } | undefined,
  targetWeightsForSignal: ((
    signalDate: string, rows: PriceRow[], context?: BacktestTargetContext,
  ) => Record<string, number> | null) | undefined,
  initialState: BacktestInitialState,
  signalDates: string[],
  logRegime: (history: PriceRow[]) => EnrichedRegimeScores,
): BacktestEngineResult {
  if (config.executionTiming !== "next_close") throw new Error("Interactive execution supports certified next-close only");
  const enabledTickers = etfs.filter((e) => e.enabled).map((e) => e.ticker);
  const empty = (reason: string): BacktestEngineResult => ({
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
  });

  if (priceRows.length < config.warmupDays + 2) {
    return empty(
      `Need at least ${config.warmupDays + 2} days of price history (a ${config.warmupDays}-day signal warmup plus tradeable days ahead); only ${priceRows.length} are uploaded.`
    );
  }

  const rebalanceDates = signalDates;
  if (rebalanceDates.length === 0) {
    return empty("No rebalance dates fall after the signal warmup window — upload more price history.");
  }

  let benchmarkUnavailableReason: string | null = null;
  if (benchmarkTicker) {
    if (!enabledTickers.includes(benchmarkTicker)) benchmarkUnavailableReason = `${benchmarkTicker} is not an enabled ETF in the current universe.`;
    else if (!priceRows.some((r) => r.prices[benchmarkTicker] !== undefined))
      benchmarkUnavailableReason = `No price data available for ${benchmarkTicker} over the backtest period.`;
  }

  const scheduled = new Map<string, string>();
  for (const date of rebalanceDates) {
    const executionDate = resolveExecutionDate(priceRows, date, config.executionTiming);
    if (executionDate) scheduled.set(date, executionDate);
  }
  if (scheduled.size === 0) {
    return empty("No rebalance could be executed — there is no trading day available after any rebalance date to apply weights.");
  }
  const firstSignalIndex = priceRows.findIndex((r) => r.date === [...scheduled.keys()][0]);
  const firstExecutionIndex = priceRows.findIndex((r) => r.date === [...scheduled.values()][0]);
  if (firstSignalIndex < 1 || firstExecutionIndex >= priceRows.length - 1) {
    return empty("Not enough trading days remain after the first executable rebalance to simulate returns.");
  }

  // Start one close before the first signal, in cash. Every entry is the interval
  // (previous close, current close] followed by any trade AT the current close.
  const simRows = priceRows.slice(firstSignalIndex - 1);
  if (initialState) {
    const { initialNav, initialCash, initialHoldings, dailyCashYield, allowShortPositions = false } = initialState;
    if (!Number.isFinite(initialNav) || initialNav <= 0 || !Number.isFinite(initialCash) ||
        (!allowShortPositions && initialCash < 0) ||
        !Number.isFinite(dailyCashYield) || dailyCashYield <= -1 ||
        !initialHoldings || typeof initialHoldings !== "object")
      return empty("Invalid initial NAV, cash, holdings or daily cash yield.");
    let initialAssets = 0;
    for (const [ticker, quantity] of Object.entries(initialHoldings)) {
      const price = simRows[0].prices[ticker];
      if (!enabledTickers.includes(ticker) || !Number.isFinite(quantity) ||
          (!allowShortPositions && quantity < 0) ||
          !Number.isFinite(price) || price <= 0)
        return empty(`Invalid initial holding or missing price for ${ticker} on ${simRows[0].date}.`);
      initialAssets += quantity * price;
    }
    if (Math.abs(initialCash + initialAssets - initialNav) > 1e-8)
      return empty(`Initial holdings and cash do not reconcile to NAV on ${simRows[0].date}.`);
  }
  const dailyCashReturn = initialState?.dailyCashYield ??
    (Math.pow(1 + config.cashYieldAnnual, 1 / TRADING_DAYS_PER_YEAR) - 1);
  const allowShortPositions = initialState?.allowShortPositions ?? false;
  const dailyReturns: Array<{ date: string; portfolioReturn: number; benchmarkReturn: number | null }> = [];
  const dailyLedger: BacktestLedgerEntry[] = [];
  const rebalanceLog: RebalanceLogEntry[] = [];
  let shares = new Map<string, number>(Object.entries(initialState?.initialHoldings ?? {}));
  let cash = initialState?.initialCash ?? 100;
  let nav = initialState?.initialNav ?? 100;
  let pending: { signalDate: string; executionDate: string; target: Map<string, number>; lookbackDays: number; regimeLabel: string; regimeComposite: number } | null = null;
  const positionSnapshot = (prices: Record<string, number>, value: number): BacktestPosition[] =>
    [...shares].filter(([, quantity]) => quantity !== 0).map(([ticker, quantity]) => ({
      ticker, quantity, price: prices[ticker], marketValue: quantity * prices[ticker],
      weight: value > 0 ? quantity * prices[ticker] / value : 0,
    }));
  let benchmarkUnavailable = benchmarkUnavailableReason;
  for (let i = 1; i < simRows.length; i++) {
    const prevRow = simRows[i - 1];
    const row = simRows[i];
    const beginningNav = nav;
    const beginningCash = cash;
    const beginningPositions = positionSnapshot(prevRow.prices, beginningNav);
    let etfPnl = 0;
    for (const [ticker, quantity] of shares) {
      if (quantity === 0) continue;
      const prevPrice = prevRow.prices[ticker];
      const price = row.prices[ticker];
      if (!Number.isFinite(prevPrice) || !Number.isFinite(price) || prevPrice <= 0 || price <= 0)
        return empty(`Missing or invalid price for held asset ${ticker} on ${prevRow.date} or ${row.date}; P&L cannot be determined.`);
      etfPnl += quantity * (price - prevPrice);
    }
    const cashPnl = cash * dailyCashReturn;
    cash += cashPnl;
    nav = cash + [...shares].reduce((sum, [ticker, quantity]) => sum + quantity * row.prices[ticker], 0);
    let signalDate: string | null = null;
    if (scheduled.has(row.date)) {
      signalDate = row.date;
      const priorWeights = new Map(beginningPositions.map((p) => [p.ticker, p.weight]));
      // For NEXT_CLOSE the market has just closed; use currently drifted weights.
      for (const [ticker, quantity] of shares)
        if (quantity !== 0) priorWeights.set(ticker, quantity * row.prices[ticker] / nav);
      const etfsForSignal = etfs.map((e) => ({
        ...e, priorWeight: rebalanceLog.length ? (priorWeights.get(e.ticker) ?? 0) : e.priorWeight,
      }));
      const informationRows = priceRows.filter((item) => item.date < row.date);
      const signalInputs = targetWeightsForSignal
        ? { regime: logRegime(informationRows),
            allocations: [] as AllocationResult[], lookbackDays: informationRows.length }
        : computeSignalAsOf(priceRows, row.date, enabledTickers, etfsForSignal, constraints, factorSet);
      const { regime, allocations, lookbackDays } = signalInputs;
      let explicitTarget: Record<string, number> | null | undefined;
      if (targetWeightsForSignal) {
        if (initialState?.d5GrossTradeCosts || initialState?.provideTargetContext) {
          const quantities = Object.freeze(Object.fromEntries([...shares]));
          explicitTarget = targetWeightsForSignal(row.date, informationRows, Object.freeze({
            asOf: prevRow.date, quantities, cash: beginningCash, nav: beginningNav,
          }));
        } else {
          // Preserve the legacy callback invocation contract when D5 is omitted.
          explicitTarget = targetWeightsForSignal(row.date, informationRows);
        }
      }
      if (targetWeightsForSignal && explicitTarget === null) {
        pending = null;
      } else {
        pending = {
          signalDate: row.date, executionDate: scheduled.get(row.date)!,
          target: new Map(targetWeightsForSignal
            ? Object.entries(explicitTarget ?? {})
            : allocations.filter((a) => a.active).map((a) => [a.ticker, a.weight])),
          lookbackDays, regimeLabel: regime.label, regimeComposite: regime.composite,
        };
      }
    }
    let transactionCosts = 0;
    let slippage = 0;
    let executionSignalDate: string | null = null;
    const trades: BacktestLedgerEntry["trades"] = [];
    if (pending && pending.executionDate === row.date) {
      executionSignalDate = pending.signalDate;
      const currentWeights = new Map([...shares].filter(([, q]) => q !== 0).map(([ticker, quantity]) =>
        [ticker, quantity * row.prices[ticker] / nav] as const));
      const allTickers = new Set([...currentWeights.keys(), ...pending.target.keys()]);
      for (const [ticker, weight] of pending.target) {
        d6Trace("a1.target.check", { date: row.date, ticker, value: String(weight), type: typeof weight,
          enabled: enabledTickers.includes(ticker), finite: Number.isFinite(weight), allowShortPositions });
        if (!enabledTickers.includes(ticker) || !Number.isFinite(weight) ||
            (!allowShortPositions && weight < 0))
          return empty(`Invalid ${allowShortPositions ? "signed " : ""}target exposure for ${ticker} on ${row.date}.`);
      }
      let requestedTurnover = 0;
      for (const ticker of allTickers)
        requestedTurnover += Math.abs((pending.target.get(ticker) ?? 0) - (currentWeights.get(ticker) ?? 0));
      requestedTurnover /= 2;
      // Signed B3 targets are the solved underlying book, not an instruction to
      // incrementally approach it. Preserve the legacy turnover cap for all
      // long-only execution paths.
      const cap = (allowShortPositions || initialState?.d5GrossTradeCosts)
        ? requestedTurnover : clamp(config.maxTurnoverPerRebalance, 0, 1);
      const scale = requestedTurnover > 0 ? Math.min(1, cap / requestedTurnover) : 1;
      const applied = new Map<string, number>();
      for (const ticker of allTickers)
        applied.set(ticker, (currentWeights.get(ticker) ?? 0) +
          ((pending.target.get(ticker) ?? 0) - (currentWeights.get(ticker) ?? 0)) * scale);
      let turnoverApplied = 0;
      for (const ticker of allTickers)
        turnoverApplied += Math.abs((applied.get(ticker) ?? 0) - (currentWeights.get(ticker) ?? 0));
      if (!initialState?.d5GrossTradeCosts) turnoverApplied /= 2;
      const preTradeNav = nav;
      let afterCostNav = preTradeNav;
      if (initialState?.d5GrossTradeCosts) {
        // Solve the self-financing equation against the actual consolidated
        // absolute fill notional, including gap-driven changes from cutoff values.
        const oldMarketValues = new Map([...shares].map(([ticker, quantity]) =>
          [ticker, quantity * row.prices[ticker]]));
        const chargeRate = (config.transactionCostBps + config.slippageBps) / 10000;
        const tradedAt = (candidateNav: number) => [...applied].reduce((sum, [ticker, weight]) =>
          sum + Math.abs(candidateNav * weight - (oldMarketValues.get(ticker) ?? 0)), 0);
        let low = 0, high = preTradeNav;
        for (let iteration = 0; iteration < 80; iteration++) {
          const candidate = (low + high) / 2;
          if (candidate + chargeRate * tradedAt(candidate) > preTradeNav) high = candidate;
          else low = candidate;
        }
        afterCostNav = (low + high) / 2;
        const actualTradedNotional = tradedAt(afterCostNav);
        transactionCosts = actualTradedNotional * config.transactionCostBps / 10000;
        slippage = actualTradedNotional * config.slippageBps / 10000;
      } else {
        transactionCosts = preTradeNav * turnoverApplied * config.transactionCostBps / 10000;
        slippage = preTradeNav * turnoverApplied * config.slippageBps / 10000;
        afterCostNav = preTradeNav - transactionCosts - slippage;
      }
      if (afterCostNav <= 0) return empty(`Trading costs exhaust NAV on ${row.date}.`);
      const nextShares = new Map<string, number>();
      let invested = 0;
      for (const [ticker, weight] of applied) {
        if (allowShortPositions ? weight === 0 : weight <= 0) continue;
        const price = row.prices[ticker];
        if (!Number.isFinite(price) || price <= 0)
          return empty(`Missing or invalid execution price for ${ticker} on ${row.date}; cannot execute trade.`);
        const quantity = afterCostNav * weight / price;
        nextShares.set(ticker, quantity);
        invested += quantity * price;
      }
      for (const ticker of allTickers) {
        const difference = (nextShares.get(ticker) ?? 0) - (shares.get(ticker) ?? 0);
        if (Math.abs(difference) > 1e-12) trades.push({ ticker, quantity: difference, notional: difference * row.prices[ticker] });
      }
      shares = nextShares;
      cash = afterCostNav - invested;
      if (initialState?.d5GrossTradeCosts && cash < 0 && cash > -1e-8 * Math.max(1, afterCostNav))
        cash = 0;
      nav = afterCostNav;
      const topHoldings = [...applied].filter(([, w]) => w > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
      rebalanceLog.push({
        rebalanceDate: pending.signalDate, executionDate: row.date, lookbackDays: pending.lookbackDays,
        regimeLabel: pending.regimeLabel, regimeComposite: pending.regimeComposite,
        cashWeight: round4(cash / nav), activeEtfCount: [...applied.values()].filter((w) => Math.abs(w) > 0.001).length,
        topHoldings, turnoverRequested: round4(requestedTurnover), turnoverApplied: round4(turnoverApplied),
        turnoverCapped: requestedTurnover > cap + 1e-9,
        transactionCostPct: round4((transactionCosts + slippage) / preTradeNav),
      });
      pending = null;
    }
    const netPnl = etfPnl + cashPnl - transactionCosts - slippage;
    if (Math.abs(beginningNav + netPnl - nav) > 1e-8)
      return empty(`Ledger reconciliation failed on ${row.date}.`);
    dailyLedger.push({
      date: row.date, intervalStart: prevRow.date, signalDate, executionSignalDate,
      beginningNav, beginningCash, beginningPositions, etfPnl, cashPnl, transactionCosts, slippage,
      trades, netPnl, endingNav: nav, endingCash: cash,
      endingPositions: positionSnapshot(row.prices, nav),
    });

    let benchmarkReturn: number | null = null;
    if (benchmarkTicker && !benchmarkUnavailable) {
      const prevPrice = prevRow.prices[benchmarkTicker];
      const price = row.prices[benchmarkTicker];
      if (prevPrice && price && prevPrice > 0) benchmarkReturn = (price - prevPrice) / prevPrice;
      else benchmarkUnavailable = `Missing benchmark price for ${benchmarkTicker} on ${row.date}.`;
    }
    dailyReturns.push({ date: row.date, portfolioReturn: netPnl / beginningNav, benchmarkReturn });
  }

  // Do not display a partial benchmark as though missing days earned zero.
  if (benchmarkUnavailable) for (const value of dailyReturns) value.benchmarkReturn = null;
  const { equityCurve, cumulativeReturn, annualizedReturn, annualizedVolatility, sharpeRatio, maxDrawdown, benchmarkCumulativeReturn, benchmarkAnnualizedReturn } =
    computeCurveMetrics(simRows[0].date, dailyReturns, !!benchmarkTicker && !benchmarkUnavailable);

  const monthlyReturns = computeMonthlyReturns(dailyReturns, !!benchmarkTicker && !benchmarkUnavailable);

  const turnoverValues = rebalanceLog.map((e) => e.turnoverApplied);
  const avgTurnover = turnoverValues.length > 0 ? round4(turnoverValues.reduce((s, t) => s + t, 0) / turnoverValues.length) : null;
  const totalTransactionCostPct = round4(dailyLedger.reduce((s, e) => s + (e.transactionCosts + e.slippage) / e.beginningNav, 0));

  return {
    hasSufficientData: true,
    insufficientReason: null,
    startDate: simRows[0].date,
    endDate: simRows[simRows.length - 1].date,
    tradingDays: dailyReturns.length,
    canAnnualize: dailyReturns.length >= MIN_DAYS_FOR_ANNUALIZATION,
    equityCurve,
    dailyLedger,
    cumulativeReturn,
    annualizedReturn,
    annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    avgTurnover,
    totalTransactionCostPct,
    monthlyReturns,
    rebalanceLog,
    benchmarkTicker: benchmarkTicker && !benchmarkUnavailable ? benchmarkTicker : null,
    benchmarkCumulativeReturn,
    benchmarkAnnualizedReturn,
    benchmarkUnavailableReason: benchmarkUnavailable,
  };
}

function computeCurveMetrics(
  firstDate: string,
  dailyReturns: Array<{ date: string; portfolioReturn: number; benchmarkReturn: number | null }>,
  hasBenchmark: boolean
) {
  let portfolioIndex = 100;
  let benchmarkIndex = hasBenchmark ? 100 : null;
  let peak = 100;
  const equityCurve: BacktestEquityPoint[] = [{ date: firstDate, portfolioIndex: 100, benchmarkIndex, drawdownPct: 0 }];

  for (const dr of dailyReturns) {
    portfolioIndex *= 1 + dr.portfolioReturn;
    if (benchmarkIndex !== null) benchmarkIndex *= 1 + (dr.benchmarkReturn ?? 0);
    peak = Math.max(peak, portfolioIndex);
    const drawdownPct = peak > 0 ? portfolioIndex / peak - 1 : 0;
    equityCurve.push({
      date: dr.date,
      portfolioIndex: Math.round(portfolioIndex * 1e10) / 1e10,
      benchmarkIndex: benchmarkIndex !== null ? Math.round(benchmarkIndex * 1e10) / 1e10 : null,
      drawdownPct: Math.round(drawdownPct * 10000) / 10000,
    });
  }

  const tradingDays = dailyReturns.length;
  const cumulativeReturn = round4(portfolioIndex / 100 - 1);
  const maxDrawdown = Math.min(...equityCurve.map((p) => p.drawdownPct), 0);
  const canAnnualize = tradingDays >= MIN_DAYS_FOR_ANNUALIZATION;

  let annualizedReturn: number | null = null;
  let annualizedVolatility: number | null = null;
  let sharpeRatio: number | null = null;
  if (canAnnualize) {
    annualizedReturn = Math.pow(1 + cumulativeReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1;
    const m = mean(dailyReturns.map((d) => d.portfolioReturn));
    const variance = dailyReturns.reduce((s, d) => s + Math.pow(d.portfolioReturn - m, 2), 0) / tradingDays;
    const dailyStd = Math.sqrt(variance);
    annualizedVolatility = dailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR);
    sharpeRatio = annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : null;
    annualizedReturn = round4(annualizedReturn);
    annualizedVolatility = round4(annualizedVolatility);
    sharpeRatio = sharpeRatio !== null ? Math.round(sharpeRatio * 1000) / 1000 : null;
  }

  const benchmarkCumulativeReturn = benchmarkIndex !== null ? round4(benchmarkIndex / 100 - 1) : null;
  const benchmarkAnnualizedReturn =
    benchmarkCumulativeReturn !== null && canAnnualize ? round4(Math.pow(1 + benchmarkCumulativeReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1) : null;

  return {
    equityCurve,
    cumulativeReturn,
    annualizedReturn,
    annualizedVolatility,
    sharpeRatio,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    benchmarkCumulativeReturn,
    benchmarkAnnualizedReturn,
  };
}

function computeMonthlyReturns(
  dailyReturns: Array<{ date: string; portfolioReturn: number; benchmarkReturn: number | null }>,
  hasBenchmark: boolean
): Array<{ month: string; portfolioReturn: number; benchmarkReturn: number | null }> {
  const monthlyMap = new Map<string, { portfolioFactor: number; benchmarkFactor: number | null }>();
  for (const dr of dailyReturns) {
    const month = dr.date.slice(0, 7);
    const existing = monthlyMap.get(month) ?? { portfolioFactor: 1, benchmarkFactor: hasBenchmark ? 1 : null };
    existing.portfolioFactor *= 1 + dr.portfolioReturn;
    if (existing.benchmarkFactor !== null) existing.benchmarkFactor *= 1 + (dr.benchmarkReturn ?? 0);
    monthlyMap.set(month, existing);
  }
  return Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      portfolioReturn: round4(v.portfolioFactor - 1),
      benchmarkReturn: v.benchmarkFactor !== null ? round4(v.benchmarkFactor - 1) : null,
    }));
}
