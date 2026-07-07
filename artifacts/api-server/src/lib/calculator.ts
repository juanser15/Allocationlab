/**
 * Allocation Lab v2 — Calculation Engine
 *
 * Computes factor scores, regime scores, and final allocation
 * from raw price data. All scores are on a 0-100 scale.
 */

export interface PriceRow {
  date: string;
  prices: Record<string, number>;
}

export interface FactorScores {
  mom20: number;
  mom60: number;
  mom120: number;
  mom252: number;
  trendQuality: number;
  realizedVol60: number;
  drawdown: number;
  meanReversion: number;
  composite: number;
}

export interface EtfFactorData {
  ticker: string;
  factorScores: FactorScores;
  rawMom20: number;
  rawMom60: number;
  rawMom120: number;
  rawMom252: number;
  rawVol60: number;
  rawDrawdown: number;
  rawTrendQuality: number;
  rawMeanReversion: number;
}

export interface RegimeScores {
  trend: number;
  breadth: number;
  volatility: number;
  liquidity: number;
  composite: number;
  label: string;
}

export interface EtfEntry {
  ticker: string;
  name: string;
  sector: string;
  priorWeight: number;
  enabled: boolean;
}

export interface Constraints {
  cashMin: number;
  cashMax: number;
  maxEtfWeight: number;
  minInclusionThreshold: number;
  targetActiveEtfs: number;
  diversificationEnabled: boolean;
}

export interface AllocationResult {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  priorWeight: number;
  change: number;
  factorScores: FactorScores;
  active: boolean;
}

// --- Price parsing ---

export function parseCsv(csvContent: string): PriceRow[] {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const dateCol = headers[0];
  const tickers = headers.slice(1);

  if (!dateCol) throw new Error("First column must be a date column.");
  if (tickers.length === 0) throw new Error("CSV must have at least one ticker column.");

  const rows: PriceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
    const date = cols[0];
    const prices: Record<string, number> = {};
    for (let j = 0; j < tickers.length; j++) {
      const val = parseFloat(cols[j + 1]);
      if (!isNaN(val) && val > 0) {
        prices[tickers[j]] = val;
      }
    }
    if (date && Object.keys(prices).length > 0) {
      rows.push({ date, prices });
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// --- Time-series helpers ---

function getReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    } else {
      returns.push(0);
    }
  }
  return returns;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function momentum(prices: number[], period: number): number {
  if (prices.length < period + 1) return NaN;
  const current = prices[prices.length - 1];
  const base = prices[prices.length - 1 - period];
  if (!base || base <= 0) return NaN;
  return (current - base) / base;
}

function realizedVolatility(prices: number[], period: number): number {
  if (prices.length < period + 1) return NaN;
  const slice = prices.slice(prices.length - period - 1);
  const rets = getReturns(slice);
  return std(rets) * Math.sqrt(252);
}

function maxDrawdown(prices: number[]): number {
  if (prices.length === 0) return 0;
  let peak = prices[0];
  let maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = peak > 0 ? (peak - p) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function trendQuality(prices: number[]): number {
  // R² of price vs linear regression over the window
  if (prices.length < 5) return NaN;
  const n = prices.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs);
  const my = mean(prices);
  let ssxy = 0;
  let ssx = 0;
  let ssy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (xs[i] - mx) * (prices[i] - my);
    ssx += (xs[i] - mx) ** 2;
    ssy += (prices[i] - my) ** 2;
  }
  if (ssx === 0 || ssy === 0) return 0;
  return (ssxy / Math.sqrt(ssx * ssy)) ** 2; // R²
}

function shortTermMeanReversion(prices: number[], shortWindow = 5, longWindow = 20): number {
  // Negative: price far above short MA vs long MA → expect reversion (lower score)
  if (prices.length < longWindow + 1) return NaN;
  const recent = prices.slice(-longWindow);
  const shortMa = mean(recent.slice(-shortWindow));
  const longMa = mean(recent);
  if (longMa <= 0) return NaN;
  return -(shortMa - longMa) / longMa; // positive when oversold
}

// --- Cross-sectional rank normalization to 0-100 ---

function crossSectionalRank(values: Map<string, number>): Map<string, number> {
  const valid: Array<[string, number]> = [];
  for (const [k, v] of values) {
    if (!isNaN(v) && isFinite(v)) valid.push([k, v]);
  }
  if (valid.length === 0) return new Map();
  valid.sort((a, b) => a[1] - b[1]);
  const result = new Map<string, number>();
  for (let i = 0; i < valid.length; i++) {
    result.set(valid[i][0], (i / (valid.length - 1)) * 100);
  }
  return result;
}

// --- Factor computation ---

export function computeFactors(
  rows: PriceRow[],
  tickers: string[]
): EtfFactorData[] {
  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) {
    pricesByTicker[ticker] = [];
  }
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker] !== undefined) {
        pricesByTicker[ticker].push(row.prices[ticker]);
      }
    }
  }

  // Raw factor maps
  const rawMom20 = new Map<string, number>();
  const rawMom60 = new Map<string, number>();
  const rawMom120 = new Map<string, number>();
  const rawMom252 = new Map<string, number>();
  const rawVol60 = new Map<string, number>();
  const rawDD = new Map<string, number>();
  const rawTQ = new Map<string, number>();
  const rawMR = new Map<string, number>();

  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length < 21) continue;

    rawMom20.set(ticker, momentum(prices, 20));
    rawMom60.set(ticker, momentum(prices, Math.min(60, prices.length - 1)));
    rawMom120.set(ticker, momentum(prices, Math.min(120, prices.length - 1)));
    rawMom252.set(ticker, momentum(prices, Math.min(252, prices.length - 1)));

    const vol = realizedVolatility(prices, Math.min(60, prices.length - 1));
    rawVol60.set(ticker, vol); // invert later (lower vol = higher score)

    rawDD.set(ticker, maxDrawdown(prices)); // invert later (smaller drawdown = higher score)
    rawTQ.set(ticker, trendQuality(prices.slice(-Math.min(120, prices.length))));
    rawMR.set(ticker, shortTermMeanReversion(prices));
  }

  // Rank each factor cross-sectionally
  const rankMom20 = crossSectionalRank(rawMom20);
  const rankMom60 = crossSectionalRank(rawMom60);
  const rankMom120 = crossSectionalRank(rawMom120);
  const rankMom252 = crossSectionalRank(rawMom252);
  const rankTQ = crossSectionalRank(rawTQ);

  // Invert vol and drawdown (lower raw = higher score)
  const invertedVol = new Map<string, number>();
  for (const [k, v] of rawVol60) invertedVol.set(k, isNaN(v) ? NaN : -v);
  const rankVol = crossSectionalRank(invertedVol);

  const invertedDD = new Map<string, number>();
  for (const [k, v] of rawDD) invertedDD.set(k, isNaN(v) ? NaN : -v);
  const rankDD = crossSectionalRank(invertedDD);

  const rankMR = crossSectionalRank(rawMR);

  const results: EtfFactorData[] = [];
  for (const ticker of tickers) {
    if (pricesByTicker[ticker].length < 21) continue;

    const m20 = rankMom20.get(ticker) ?? 50;
    const m60 = rankMom60.get(ticker) ?? 50;
    const m120 = rankMom120.get(ticker) ?? 50;
    const m252 = rankMom252.get(ticker) ?? 50;
    const tq = rankTQ.get(ticker) ?? 50;
    const v60 = rankVol.get(ticker) ?? 50;
    const dd = rankDD.get(ticker) ?? 50;
    const mr = rankMR.get(ticker) ?? 50;

    // Composite: momentum weighted highest
    const composite = 0.20 * m20 + 0.20 * m60 + 0.15 * m120 + 0.15 * m252 + 0.10 * tq + 0.10 * v60 + 0.05 * dd + 0.05 * mr;

    results.push({
      ticker,
      factorScores: {
        mom20: round2(m20),
        mom60: round2(m60),
        mom120: round2(m120),
        mom252: round2(m252),
        trendQuality: round2(tq),
        realizedVol60: round2(v60),
        drawdown: round2(dd),
        meanReversion: round2(mr),
        composite: round2(composite),
      },
      rawMom20: rawMom20.get(ticker) ?? NaN,
      rawMom60: rawMom60.get(ticker) ?? NaN,
      rawMom120: rawMom120.get(ticker) ?? NaN,
      rawMom252: rawMom252.get(ticker) ?? NaN,
      rawVol60: rawVol60.get(ticker) ?? NaN,
      rawDrawdown: rawDD.get(ticker) ?? NaN,
      rawTrendQuality: rawTQ.get(ticker) ?? NaN,
      rawMeanReversion: rawMR.get(ticker) ?? NaN,
    });
  }

  return results;
}

// --- Regime estimation ---

export function computeRegime(rows: PriceRow[], tickers: string[]): RegimeScores {
  if (rows.length < 10) {
    return { trend: 50, breadth: 50, volatility: 50, liquidity: 50, composite: 50, label: "Unknown" };
  }

  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker]) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  // Trend: % ETFs above their 50-day MA
  let above50 = 0;
  let above200 = 0;
  let withEnoughData = 0;
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 50) {
      withEnoughData++;
      const ma50 = mean(prices.slice(-50));
      if (prices[prices.length - 1] > ma50) above50++;
    }
    if (prices.length >= 200) {
      const ma200 = mean(prices.slice(-200));
      if (prices[prices.length - 1] > ma200) above200++;
    }
  }
  const trendRaw = withEnoughData > 0 ? (above50 / withEnoughData + above200 / Math.max(withEnoughData, 1)) / 2 : 0.5;
  const trend = clamp(trendRaw * 100, 0, 100);

  // Breadth: advance-decline over last 20 days
  let advances = 0;
  let declines = 0;
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 21) {
      const ret = (prices[prices.length - 1] - prices[prices.length - 21]) / prices[prices.length - 21];
      if (ret > 0) advances++;
      else declines++;
    }
  }
  const total = advances + declines;
  const breadthRaw = total > 0 ? advances / total : 0.5;
  const breadth = clamp(breadthRaw * 100, 0, 100);

  // Volatility: average 20d realized vol across universe → invert to score (lower = better)
  const vols: number[] = [];
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 21) {
      const v = realizedVolatility(prices, 20);
      if (!isNaN(v)) vols.push(v);
    }
  }
  const avgVol = vols.length > 0 ? mean(vols) : 0.15;
  // Map 5-30% annualized vol range → 100-0 score
  const volatility = clamp(100 - ((avgVol - 0.05) / 0.25) * 100, 0, 100);

  // Liquidity: proxy via price stability (low cross-sectional dispersion = good liquidity)
  const dispersion: number[] = [];
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 5) {
      const recent = prices.slice(-5);
      const rets = getReturns(recent);
      dispersion.push(std(rets));
    }
  }
  const avgDisp = dispersion.length > 0 ? mean(dispersion) : 0.01;
  const liquidity = clamp(100 - (avgDisp / 0.02) * 50, 0, 100);

  const composite = 0.35 * trend + 0.30 * breadth + 0.20 * volatility + 0.15 * liquidity;

  let label: string;
  if (composite >= 70) label = "Risk-On";
  else if (composite >= 55) label = "Constructive";
  else if (composite >= 40) label = "Neutral";
  else if (composite >= 25) label = "Cautious";
  else label = "Risk-Off";

  return {
    trend: round2(trend),
    breadth: round2(breadth),
    volatility: round2(volatility),
    liquidity: round2(liquidity),
    composite: round2(composite),
    label,
  };
}

// --- Allocation constructor ---

export function constructAllocation(
  factorData: EtfFactorData[],
  etfs: EtfEntry[],
  constraints: Constraints,
  regime: RegimeScores
): AllocationResult[] {
  const { cashMin, cashMax, maxEtfWeight, minInclusionThreshold, targetActiveEtfs, diversificationEnabled } = constraints;

  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);

  // Regime-adjusted cash target: higher cash when regime is bearish
  const regimeScore = regime.composite;
  const cashTargetUnadjusted = cashMin + (cashMax - cashMin) * 0.5;
  const regimeCashAdjust = ((50 - regimeScore) / 50) * (cashMax - cashMin) * 0.5;
  const cashTarget = clamp(cashTargetUnadjusted + regimeCashAdjust, cashMin, cashMax);

  const investedBudget = 1 - cashTarget;

  // Filter to enabled ETFs with factor data above threshold
  const eligible = factorData.filter((f) => {
    const etf = etfMap.get(f.ticker);
    if (!etf || !etf.enabled) return false;
    if (f.factorScores.composite < minInclusionThreshold) return false;
    return true;
  });

  // Sort by composite score desc
  eligible.sort((a, b) => b.factorScores.composite - a.factorScores.composite);

  // Select top N by score
  const topN = eligible.slice(0, targetActiveEtfs);

  // Score-weighted raw allocation
  const totalScore = topN.reduce((s, f) => s + f.factorScores.composite, 0);
  const rawWeights = new Map<string, number>();
  for (const f of topN) {
    rawWeights.set(f.ticker, totalScore > 0 ? (f.factorScores.composite / totalScore) * investedBudget : investedBudget / topN.length);
  }

  // Apply max ETF weight constraint
  let weights = new Map<string, number>(rawWeights);
  weights = enforceMaxWeight(weights, maxEtfWeight, investedBudget);

  // Continuity awareness: blend with prior weights if diversification is enabled
  if (diversificationEnabled) {
    weights = blendWithPrior(weights, etfMap, topN, investedBudget);
  }

  // Normalize to exactly investedBudget
  weights = normalizeWeights(weights, investedBudget);

  // Build results
  const results: AllocationResult[] = [];
  for (const f of factorData) {
    const etf = etfMap.get(f.ticker);
    if (!etf) continue;
    const weight = weights.get(f.ticker) ?? 0;
    const priorWeight = etf.priorWeight;
    results.push({
      ticker: f.ticker,
      name: etf.name,
      sector: etf.sector,
      weight: round4(weight),
      priorWeight: round4(priorWeight),
      change: round4(weight - priorWeight),
      factorScores: f.factorScores,
      active: weight > 0.001,
    });
  }

  // Sort: active first by weight desc, then inactive
  results.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return b.weight - a.weight;
  });

  return results;
}

function enforceMaxWeight(weights: Map<string, number>, maxW: number, budget: number): Map<string, number> {
  let excess = 0;
  const result = new Map<string, number>();
  const uncapped: string[] = [];

  for (const [k, v] of weights) {
    if (v > maxW) {
      result.set(k, maxW);
      excess += v - maxW;
    } else {
      result.set(k, v);
      uncapped.push(k);
    }
  }

  if (excess > 0 && uncapped.length > 0) {
    const perUncapped = excess / uncapped.length;
    for (const k of uncapped) {
      const cur = result.get(k) ?? 0;
      result.set(k, Math.min(maxW, cur + perUncapped));
    }
  }

  return result;
}

function blendWithPrior(
  weights: Map<string, number>,
  etfMap: Map<string, EtfEntry>,
  topN: EtfFactorData[],
  budget: number
): Map<string, number> {
  const blendFactor = 0.3; // 30% continuity pull toward prior
  const result = new Map<string, number>();
  const activeSet = new Set(topN.map((f) => f.ticker));

  for (const [k, w] of weights) {
    const etf = etfMap.get(k);
    if (!etf) {
      result.set(k, w);
      continue;
    }
    const priorInvested = etf.priorWeight; // prior weight (which may include cash)
    const blended = w * (1 - blendFactor) + priorInvested * blendFactor;
    result.set(k, Math.max(0, blended));
  }

  return result;
}

function normalizeWeights(weights: Map<string, number>, budget: number): Map<string, number> {
  const total = Array.from(weights.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return weights;
  const result = new Map<string, number>();
  for (const [k, v] of weights) {
    result.set(k, (v / total) * budget);
  }
  return result;
}

// --- Helpers ---

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
