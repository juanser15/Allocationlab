import type { AllocationResult, Constraints, PriceRow } from "./calculator";

export type ImplementationAction = "BUY" | "SELL" | "HOLD" | "REMOVE" | "NEW";
export type ExecutionTimingMode = "next_close" | "next_open";
export type ImplementationRebalanceFrequency = "monthly" | "quarterly";

export interface TradeImplementationExecutionAssumptions {
  executionTiming: ExecutionTimingMode;
  transactionCostBps: number;
  slippageBps: number;
  cashYieldAnnualPct: number;
  rebalanceFrequency: ImplementationRebalanceFrequency;
  minTradeSizeUsd: number;
}

export interface TradeImplementationEntry {
  ticker: string;
  name: string;
  sector: string;
  currentWeight: number;
  targetWeight: number;
  deltaWeight: number;
  action: ImplementationAction;
  latestPrice: number | null;
  estimatedShares: number | null;
  estimatedTradeUsd: number;
  estimatedCostUsd: number;
  advAvailable: false;
  advReason: string;
  belowMinTradeSize: boolean;
  violatesMaxWeight: boolean;
  warnings: string[];
}

export interface CashImplementationEntry {
  currentWeight: number;
  targetWeight: number;
  currentUsd: number;
  targetUsd: number;
  cashImpactUsd: number;
  postTradeCashUsd: number;
}

export interface TradeImplementationWarning {
  id: string;
  severity: "warn" | "fail";
  message: string;
}

export interface TradeImplementationResult {
  hasSufficientData: boolean;
  insufficientReason: string | null;
  generatedAt: string;
  aumUsd: number;
  assumptions: TradeImplementationExecutionAssumptions;
  trades: TradeImplementationEntry[];
  cash: CashImplementationEntry;
  grossTradeUsd: number;
  estimatedTotalCostUsd: number;
  turnoverPct: number;
  buyCount: number;
  sellCount: number;
  newCount: number;
  removeCount: number;
  holdCount: number;
  belowMinCount: number;
  warnings: TradeImplementationWarning[];
}

const ADV_UNAVAILABLE_REASON =
  "No trading volume data has been uploaded. The price CSV contains close prices only — average daily volume/liquidity cannot be estimated without a volume feed. Upload volume data to enable liquidity checks.";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function latestPriceFor(priceRows: PriceRow[], ticker: string): number | null {
  for (let i = priceRows.length - 1; i >= 0; i--) {
    const p = priceRows[i].prices[ticker];
    if (typeof p === "number" && !isNaN(p) && p > 0) return p;
  }
  return null;
}

export function computeTradeImplementation(
  allocations: AllocationResult[],
  cashWeight: number,
  cashPriorWeight: number,
  priceRows: PriceRow[],
  aumUsd: number,
  assumptions: TradeImplementationExecutionAssumptions,
  constraints: Constraints,
): TradeImplementationResult {
  const costBpsTotal = assumptions.transactionCostBps + assumptions.slippageBps;
  const trades: TradeImplementationEntry[] = [];
  const warnings: TradeImplementationWarning[] = [];

  let grossTradeUsd = 0;
  let estimatedTotalCostUsd = 0;
  let oneWayTurnoverWeight = 0;
  let buyCount = 0, sellCount = 0, newCount = 0, removeCount = 0, holdCount = 0, belowMinCount = 0;
  let etfDollarFlow = 0; // positive = net cash spent buying ETFs, negative = net cash raised from sells

  for (const a of allocations) {
    const currentWeight = a.priorWeight;
    const targetWeight = a.weight;
    const deltaWeight = a.change;
    oneWayTurnoverWeight += Math.abs(deltaWeight);

    let action: ImplementationAction;
    if (a.active && currentWeight < 0.001) action = "NEW";
    else if (!a.active && currentWeight >= 0.001) action = "REMOVE";
    else if (deltaWeight > 0.0005) action = "BUY";
    else if (deltaWeight < -0.0005) action = "SELL";
    else action = "HOLD";

    const rawTradeUsd = deltaWeight * aumUsd;
    const latestPrice = latestPriceFor(priceRows, a.ticker);

    const entryWarnings: string[] = [];
    const belowMinTradeSize = action !== "HOLD" && Math.abs(rawTradeUsd) < assumptions.minTradeSizeUsd;
    if (belowMinTradeSize) {
      belowMinCount++;
      entryWarnings.push(
        `Below minimum trade size ($${assumptions.minTradeSizeUsd.toLocaleString()}) — no order will be staged this cycle.`
      );
    }

    let estimatedShares: number | null = null;
    let estimatedTradeUsd = rawTradeUsd;
    if (!belowMinTradeSize && action !== "HOLD") {
      if (latestPrice !== null) {
        estimatedShares = Math.round(Math.abs(rawTradeUsd) / latestPrice) * Math.sign(rawTradeUsd || 1);
        estimatedTradeUsd = estimatedShares * latestPrice;
      } else {
        entryWarnings.push("No price available for this ticker — cannot estimate share count.");
      }
    } else if (action === "HOLD") {
      estimatedTradeUsd = 0;
    }

    const violatesMaxWeight = targetWeight > constraints.maxEtfWeight + 0.0001;
    if (violatesMaxWeight) {
      entryWarnings.push(`Target weight ${(targetWeight * 100).toFixed(1)}% exceeds the max ETF weight constraint (${(constraints.maxEtfWeight * 100).toFixed(1)}%).`);
    }

    const costUsd = belowMinTradeSize ? 0 : Math.abs(estimatedTradeUsd) * (costBpsTotal / 10000);

    if (action === "BUY" || action === "NEW") buyCount++;
    else if (action === "SELL" || action === "REMOVE") sellCount++;
    if (action === "NEW") newCount++;
    if (action === "REMOVE") removeCount++;
    if (action === "HOLD" || belowMinTradeSize) holdCount++;

    if (!belowMinTradeSize && action !== "HOLD") {
      grossTradeUsd += Math.abs(estimatedTradeUsd);
      estimatedTotalCostUsd += costUsd;
      etfDollarFlow += estimatedTradeUsd;
    }

    trades.push({
      ticker: a.ticker,
      name: a.name,
      sector: a.sector,
      currentWeight: round2(currentWeight * 10000) / 100,
      targetWeight: round2(targetWeight * 10000) / 100,
      deltaWeight: round2(deltaWeight * 10000) / 100,
      action,
      latestPrice,
      estimatedShares,
      estimatedTradeUsd: round2(estimatedTradeUsd),
      estimatedCostUsd: round2(costUsd),
      advAvailable: false,
      advReason: ADV_UNAVAILABLE_REASON,
      belowMinTradeSize,
      violatesMaxWeight,
      warnings: entryWarnings,
    });
  }

  const actionRank: Record<ImplementationAction, number> = { NEW: 0, BUY: 1, SELL: 2, REMOVE: 3, HOLD: 4 };
  trades.sort((x, y) => actionRank[x.action] - actionRank[y.action] || Math.abs(y.deltaWeight) - Math.abs(x.deltaWeight));

  const currentCashUsd = cashPriorWeight * aumUsd;
  const targetCashUsd = cashWeight * aumUsd;
  const cashImpactUsd = -etfDollarFlow - estimatedTotalCostUsd;
  const postTradeCashUsd = currentCashUsd + cashImpactUsd;

  const cash: CashImplementationEntry = {
    currentWeight: round2(cashPriorWeight * 10000) / 100,
    targetWeight: round2(cashWeight * 10000) / 100,
    currentUsd: round2(currentCashUsd),
    targetUsd: round2(targetCashUsd),
    cashImpactUsd: round2(cashImpactUsd),
    postTradeCashUsd: round2(postTradeCashUsd),
  };

  if (postTradeCashUsd < 0) {
    warnings.push({
      id: "cash-shortfall",
      severity: "fail",
      message: `Estimated post-trade cash is negative ($${postTradeCashUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}). Buys exceed available cash plus sale proceeds at this AUM.`,
    });
  }
  const cashBufferGap = Math.abs(postTradeCashUsd - targetCashUsd);
  if (cashBufferGap > aumUsd * 0.01) {
    warnings.push({
      id: "cash-buffer-gap",
      severity: "warn",
      message: `Post-trade cash ($${postTradeCashUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}) differs from the target cash buffer ($${targetCashUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}) by more than 1% of AUM, mostly due to share rounding.`,
    });
  }
  if (belowMinCount > 0) {
    warnings.push({
      id: "below-min-trades",
      severity: "warn",
      message: `${belowMinCount} position${belowMinCount > 1 ? "s" : ""} below the minimum trade size and will not be staged this cycle.`,
    });
  }
  const violatingCount = trades.filter((t) => t.violatesMaxWeight).length;
  if (violatingCount > 0) {
    warnings.push({
      id: "max-weight-violation",
      severity: "fail",
      message: `${violatingCount} target weight${violatingCount > 1 ? "s" : ""} exceed the configured max ETF weight constraint.`,
    });
  }
  const missingPriceCount = trades.filter((t) => t.action !== "HOLD" && !t.belowMinTradeSize && t.latestPrice === null).length;
  if (missingPriceCount > 0) {
    warnings.push({
      id: "missing-price",
      severity: "warn",
      message: `${missingPriceCount} trade${missingPriceCount > 1 ? "s" : ""} could not be share-rounded because no price is available for that ticker.`,
    });
  }
  if (assumptions.executionTiming === "next_open") {
    warnings.push({
      id: "execution-timing",
      severity: "warn",
      message: "Execution timing is set to next open — an approximation, since this dataset provides only daily close prices.",
    });
  }

  return {
    hasSufficientData: true,
    insufficientReason: null,
    generatedAt: new Date().toISOString(),
    aumUsd: round2(aumUsd),
    assumptions,
    trades,
    cash,
    grossTradeUsd: round2(grossTradeUsd),
    estimatedTotalCostUsd: round2(estimatedTotalCostUsd),
    turnoverPct: round2((oneWayTurnoverWeight / 2) * 10000) / 100,
    buyCount,
    sellCount,
    newCount,
    removeCount,
    holdCount,
    belowMinCount,
    warnings,
  };
}
