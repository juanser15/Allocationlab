import { parseCsv } from "./calculator";
import type { PreparedSnapshot } from "./prepared-inputs";

export interface CostAwareRequest {
  costAmortizationDays: number;
  turnoverPreferenceBps?: number;
  transactionCostBps: number;
  slippageBps: number;
  holdings: {
    asOf: string;
    quantities: Record<string, number>;
    cash: number;
    nav: number;
  };
}

export interface CostAwarePlan {
  assets: string[];
  currentWeights: Record<string, number>;
  quantities: Record<string, number>;
  prices: Record<string, number>;
  nav: number;
  costAmortizationDays: number;
  transactionCostBps: number;
  slippageBps: number;
  turnoverPreferenceBps: number;
  hasPenalty: boolean;
}

export interface CostAwareSummary {
  costAmortizationDays: number;
  ratesBps: { transactionCost: number; slippage: number; turnoverPreference: number };
  assets: Array<{ ticker: string; currentWeight: number; targetWeight: number; tradeFraction: number; absoluteTradeFraction: number }>;
  tradedFraction: number;
  oneTimeFeeFractionOfNav: number;
  oneTimeSlippageFractionOfNav: number;
  economicFeeDailyEquivalent: number;
  slippageDailyEquivalent: number;
  turnoverPreferenceDailyEquivalent: number;
  totalDailyEquivalent: number;
  solverEvidence: { name: string; version: string; optimalityResidual: number | null; feasibilityResidual: number | null };
}

export function prepareCostAwarePlan(snapshot: PreparedSnapshot, request: CostAwareRequest,
  candidateAssets: string[], informationCutoff: string, signedMode = false): CostAwarePlan | string {
  const pref = request.turnoverPreferenceBps ?? 0;
  if (!request || !Number.isFinite(request.costAmortizationDays) || request.costAmortizationDays <= 0)
    return "costAmortizationDays must be finite and greater than zero.";
  if (!Number.isFinite(request.transactionCostBps) || request.transactionCostBps < 0 ||
    !Number.isFinite(request.slippageBps) || request.slippageBps < 0 ||
    !Number.isFinite(pref) || pref < 0)
    return "Transaction cost, slippage and turnover preference bps must be finite and nonnegative.";
  const holdings = request.holdings;
  if (!holdings || holdings.asOf !== informationCutoff)
    return "Explicit initial holdings.asOf must exactly match informationCutoff.";
  if (!holdings.quantities || typeof holdings.quantities !== "object" ||
    !Number.isFinite(holdings.cash) || (!signedMode && holdings.cash < 0) ||
    !Number.isFinite(holdings.nav) || holdings.nav <= 0)
    return `Explicit holdings quantities, ${signedMode ? "finite cash" : "nonnegative cash"} and positive pre-trade NAV are required.`;
  if (Object.values(holdings.quantities).some((quantity) => !Number.isFinite(quantity)))
    return "Every held quantity must be finite.";
  let rows;
  try {
    rows = parseCsv(snapshot.dataset.csvContent);
  } catch (error) {
    return `Immutable prepared dataset prices could not be parsed: ${error instanceof Error ? error.message : String(error)}.`;
  }
  const date = informationCutoff.slice(0, 10);
  if (informationCutoff !== date)
    return `The immutable daily price dataset has no exact intraday price for asOf ${informationCutoff}.`;
  const row = rows.find((item) => item.date === date);
  if (!row) return `No exact observable price row exists at asOf ${holdings.asOf}.`;
  const assets = [...new Set([...candidateAssets, ...Object.keys(holdings.quantities)])].sort();
  const quantities = Object.fromEntries(assets.map((ticker) => [ticker, holdings.quantities[ticker] ?? 0]));
  const prices: Record<string, number> = {};
  for (const ticker of assets) {
    if (!snapshot.dataset.tickers.includes(ticker))
      return `Held or targeted asset ${ticker} is unknown to the immutable prepared dataset.`;
    const price = row.prices[ticker];
    if (!Number.isFinite(price) || price <= 0)
      return `Missing or invalid exact asOf price for ${ticker} on ${date}.`;
    prices[ticker] = price;
  }
  const markedValue = holdings.cash + assets.reduce((sum, ticker) =>
    sum + quantities[ticker] * prices[ticker], 0);
  if (Math.abs(markedValue - holdings.nav) > 1e-8 * Math.max(1, holdings.nav))
    return `Initial holdings are inconsistent with pre-trade NAV at asOf prices (marked value ${markedValue}, NAV ${holdings.nav}).`;
  const currentWeights = Object.fromEntries(assets.map((ticker) =>
    [ticker, quantities[ticker] * prices[ticker] / holdings.nav]));
  return { assets, currentWeights, quantities, prices, nav: holdings.nav,
    costAmortizationDays: request.costAmortizationDays, transactionCostBps: request.transactionCostBps,
    slippageBps: request.slippageBps, turnoverPreferenceBps: pref,
    hasPenalty: request.transactionCostBps + request.slippageBps + pref > 0 };
}

export function summarizeCostAware(plan: CostAwarePlan, targets: Record<string, number>,
  solver: CostAwareSummary["solverEvidence"]): CostAwareSummary {
  const trades = plan.assets.map((ticker) => {
    const targetWeight = targets[ticker] ?? 0;
    const currentWeight = plan.currentWeights[ticker] ?? 0;
    return { ticker, currentWeight, targetWeight, tradeFraction: targetWeight - currentWeight,
      absoluteTradeFraction: Math.abs(targetWeight - currentWeight) };
  });
  const tradedFraction = trades.reduce((sum, item) => sum + item.absoluteTradeFraction, 0);
  const economicFeeDailyEquivalent = tradedFraction * plan.transactionCostBps /
    (10_000 * plan.costAmortizationDays);
  const slippageDailyEquivalent = tradedFraction * plan.slippageBps /
    (10_000 * plan.costAmortizationDays);
  const oneTimeFeeFractionOfNav = tradedFraction * plan.transactionCostBps / 10_000;
  const oneTimeSlippageFractionOfNav = tradedFraction * plan.slippageBps / 10_000;
  const turnoverPreferenceDailyEquivalent = tradedFraction * plan.turnoverPreferenceBps /
    (10_000 * plan.costAmortizationDays);
  return { costAmortizationDays: plan.costAmortizationDays,
    ratesBps: { transactionCost: plan.transactionCostBps, slippage: plan.slippageBps,
      turnoverPreference: plan.turnoverPreferenceBps },
    assets: trades, tradedFraction, oneTimeFeeFractionOfNav, oneTimeSlippageFractionOfNav,
    economicFeeDailyEquivalent, slippageDailyEquivalent,
    turnoverPreferenceDailyEquivalent,
    totalDailyEquivalent: economicFeeDailyEquivalent + slippageDailyEquivalent + turnoverPreferenceDailyEquivalent,
    solverEvidence: solver };
}