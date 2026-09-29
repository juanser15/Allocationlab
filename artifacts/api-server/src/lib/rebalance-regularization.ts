import { parseCsv } from "./calculator";
import type { PreparedSnapshot } from "./prepared-inputs";

export interface RebalanceRegularizationRequest {
  lambdaR: number;
  holdings?: {
    asOf: string;
    quantities: Record<string, number>;
    cash: number;
    nav: number;
  };
}

export interface RebalanceRegularizationPlan {
  lambdaR: number;
  assets: string[];
  prices: Record<string, number>;
  referenceAssetWeights: Record<string, number>;
  nav: number;
  holdings: NonNullable<RebalanceRegularizationRequest["holdings"]>;
}

export function prepareRebalanceRegularizationPlan(
  snapshot: PreparedSnapshot,
  request: RebalanceRegularizationRequest,
  candidateAssets: string[],
  informationCutoff: string,
  signedMode = false,
): RebalanceRegularizationPlan | string {
  if (!request || typeof request !== "object" ||
    typeof request.lambdaR !== "number" || !Number.isFinite(request.lambdaR) || request.lambdaR < 0)
    return "rebalanceRegularization.lambdaR must be finite and nonnegative.";
  if (request.lambdaR === 0) return {
    lambdaR: 0, assets: [], prices: {}, referenceAssetWeights: {}, nav: 0,
    holdings: request.holdings ?? { asOf: informationCutoff, quantities: {}, cash: 0, nav: 0 },
  };
  const holdings = request.holdings;
  if (!holdings || holdings.asOf !== informationCutoff)
    return "Positive rebalance regularization requires explicit holdings.asOf exactly matching informationCutoff.";
  if (!holdings.quantities || typeof holdings.quantities !== "object" || Array.isArray(holdings.quantities) ||
    !Number.isFinite(holdings.cash) || (!signedMode && holdings.cash < 0) ||
    !Number.isFinite(holdings.nav) || holdings.nav <= 0)
    return `Explicit holdings quantities, ${signedMode ? "finite cash" : "nonnegative cash"} and positive NAV are required.`;
  if (Object.values(holdings.quantities).some((quantity) => typeof quantity !== "number" || !Number.isFinite(quantity)))
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
  const prices: Record<string, number> = {};
  const referenceAssetWeights: Record<string, number> = {};
  for (const ticker of assets) {
    if (!snapshot.dataset.tickers.includes(ticker))
      return `Held or targeted asset ${ticker} is unknown to the immutable prepared dataset.`;
    const price = row.prices[ticker];
    if (!Number.isFinite(price) || price <= 0)
      return `Missing or invalid exact asOf price for ${ticker} on ${date}.`;
    prices[ticker] = price;
    referenceAssetWeights[ticker] = (holdings.quantities[ticker] ?? 0) * price / holdings.nav;
  }
  const markedValue = holdings.cash + assets.reduce((sum, ticker) =>
    sum + (holdings.quantities[ticker] ?? 0) * prices[ticker], 0);
  if (Math.abs(markedValue - holdings.nav) > 1e-8 * Math.max(1, holdings.nav))
    return `Initial holdings are inconsistent with pre-trade NAV at asOf prices (marked value ${markedValue}, NAV ${holdings.nav}).`;
  return { lambdaR: request.lambdaR, assets, prices, referenceAssetWeights, nav: holdings.nav,
    holdings: structuredClone(holdings) };
}