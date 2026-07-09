/**
 * Allocation Lab v2 — Calculation Engine (Iteration 2)
 *
 * Computes factor scores, regime scores, allocation, IC summary and watchlist
 * from raw price data. All scores on a 0-100 scale.
 *
 * Regime framework (10 components):
 *   Computed (from prices): Trend, Breadth, Volatility, Liquidity
 *   Proxy (ETF-derived):    Credit (XLF), Commodities (XLE+XLB), Cross-Asset Confirmation
 *   Unavailable:            Dollar (no FX), Rates (no bond data), Earnings Revision (no EPS)
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

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

export interface RegimeComponent {
  key: string;
  label: string;
  score: number | null;
  method: "computed" | "proxy" | "unavailable";
  description: string;
}

export interface EnrichedRegimeScores {
  trend: number;
  breadth: number;
  volatility: number;
  liquidity: number;
  composite: number;
  label: string;
  components: RegimeComponent[];
  confidence: number;
  drivers: string;
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

export type WatchlistReason = "score_below_threshold" | "rank_cutoff" | "no_price_data";

export interface WatchlistEntry {
  ticker: string;
  name: string;
  sector: string;
  compositeScore: number;
  blockingReason: WatchlistReason;
  blockingFactor: string;
  improvement: string;
}

export interface IcSummary {
  whatChanged: string;
  why: string;
  risks: string;
  watchNext: string;
}

// ── Price parsing ────────────────────────────────────────────────────────────

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

// ── Time-series helpers ──────────────────────────────────────────────────────

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
  return (ssxy / Math.sqrt(ssx * ssy)) ** 2;
}

function shortTermMeanReversion(prices: number[], shortWindow = 5, longWindow = 20): number {
  if (prices.length < longWindow + 1) return NaN;
  const recent = prices.slice(-longWindow);
  const shortMa = mean(recent.slice(-shortWindow));
  const longMa = mean(recent);
  if (longMa <= 0) return NaN;
  return -(shortMa - longMa) / longMa;
}

// ── Cross-sectional rank normalization ───────────────────────────────────────

function crossSectionalRank(values: Map<string, number>): Map<string, number> {
  const valid: Array<[string, number]> = [];
  for (const [k, v] of values) {
    if (!isNaN(v) && isFinite(v)) valid.push([k, v]);
  }
  if (valid.length === 0) return new Map();
  valid.sort((a, b) => a[1] - b[1]);
  const result = new Map<string, number>();
  for (let i = 0; i < valid.length; i++) {
    result.set(valid[i][0], valid.length === 1 ? 50 : (i / (valid.length - 1)) * 100);
  }
  return result;
}

// ── Factor computation ───────────────────────────────────────────────────────

export function computeFactors(rows: PriceRow[], tickers: string[]): EtfFactorData[] {
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
    rawVol60.set(ticker, vol);
    rawDD.set(ticker, maxDrawdown(prices));
    rawTQ.set(ticker, trendQuality(prices.slice(-Math.min(120, prices.length))));
    rawMR.set(ticker, shortTermMeanReversion(prices));
  }

  const rankMom20 = crossSectionalRank(rawMom20);
  const rankMom60 = crossSectionalRank(rawMom60);
  const rankMom120 = crossSectionalRank(rawMom120);
  const rankMom252 = crossSectionalRank(rawMom252);
  const rankTQ = crossSectionalRank(rawTQ);

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

// ── Regime estimation (10 components) ───────────────────────────────────────

export function computeRegime(rows: PriceRow[], tickers: string[]): EnrichedRegimeScores {
  if (rows.length < 10) {
    return insufficientRegime();
  }

  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker]) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  // ── 1. Trend (computed): % ETFs above 50d MA weighted with 200d ──────────
  let above50 = 0;
  let above200 = 0;
  let withEnoughData = 0;
  let with200 = 0;
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 50) {
      withEnoughData++;
      const ma50 = mean(prices.slice(-50));
      if (prices[prices.length - 1] > ma50) above50++;
    }
    if (prices.length >= 200) {
      with200++;
      const ma200 = mean(prices.slice(-200));
      if (prices[prices.length - 1] > ma200) above200++;
    }
  }
  const trendRaw =
    withEnoughData > 0
      ? (above50 / withEnoughData) * 0.6 + (with200 > 0 ? (above200 / with200) * 0.4 : 0.4)
      : 0.5;
  const trendScore = clamp(trendRaw * 100, 0, 100);

  // ── 2. Breadth (computed): advance-decline 20d ────────────────────────────
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
  const breadthScore = clamp(total > 0 ? (advances / total) * 100 : 50, 0, 100);

  // ── 3. Volatility (computed): avg 20d realized vol → invert ──────────────
  const vols: number[] = [];
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 21) {
      const v = realizedVolatility(prices, 20);
      if (!isNaN(v)) vols.push(v);
    }
  }
  const avgVol = vols.length > 0 ? mean(vols) : 0.15;
  const volScore = clamp(100 - ((avgVol - 0.05) / 0.25) * 100, 0, 100);

  // ── 4. Liquidity (computed): cross-sectional short-term dispersion ────────
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
  const liquidityScore = clamp(100 - (avgDisp / 0.02) * 50, 0, 100);

  // ── 5. Credit (proxy via XLF): XLF relative momentum vs universe ─────────
  let creditScore: number | null = null;
  const creditTicker = "XLF";
  const xlfPrices = pricesByTicker[creditTicker];
  if (xlfPrices && xlfPrices.length >= 21) {
    const xlfMom20 = momentum(xlfPrices, 20);
    const allMom20s = tickers
      .map((t) => {
        const p = pricesByTicker[t];
        return p && p.length >= 21 ? momentum(p, 20) : NaN;
      })
      .filter((v) => !isNaN(v));
    const medianMom = allMom20s.sort((a, b) => a - b)[Math.floor(allMom20s.length / 2)] ?? 0;
    // XLF outperforming = credit supportive
    const relPerf = xlfMom20 - medianMom;
    // Map -0.05 to +0.05 relative return → 0–100
    creditScore = clamp(50 + relPerf * 1000, 0, 100);
  }

  // ── 6. Commodities (proxy via XLE + XLB): relative strength ──────────────
  let commoditiesScore: number | null = null;
  const commTickers = ["XLE", "XLB"].filter(
    (t) => pricesByTicker[t] && pricesByTicker[t].length >= 21
  );
  if (commTickers.length > 0) {
    const allMom20s = tickers
      .map((t) => {
        const p = pricesByTicker[t];
        return p && p.length >= 21 ? momentum(p, 20) : NaN;
      })
      .filter((v) => !isNaN(v));
    const medianMom = allMom20s.sort((a, b) => a - b)[Math.floor(allMom20s.length / 2)] ?? 0;

    const commMoms = commTickers.map((t) => momentum(pricesByTicker[t], 20));
    const avgCommMom = mean(commMoms);
    const relPerf = avgCommMom - medianMom;
    commoditiesScore = clamp(50 + relPerf * 1000, 0, 100);
  }

  // ── 7. Cross-Asset Confirmation (proxy): average pairwise correlation ─────
  let crossAssetScore: number | null = null;
  const tickersWithData = tickers.filter(
    (t) => pricesByTicker[t] && pricesByTicker[t].length >= 21
  );
  if (tickersWithData.length >= 3) {
    // Use 20d returns for correlation
    const returnSeries: Record<string, number[]> = {};
    for (const ticker of tickersWithData) {
      const prices = pricesByTicker[ticker];
      const slice = prices.slice(-21);
      returnSeries[ticker] = getReturns(slice);
    }

    // Average pairwise correlation (sample of pairs to keep O(n) reasonable)
    const pairs: [string, string][] = [];
    for (let i = 0; i < tickersWithData.length - 1; i++) {
      for (let j = i + 1; j < tickersWithData.length; j++) {
        pairs.push([tickersWithData[i], tickersWithData[j]]);
      }
    }

    const corrs: number[] = [];
    for (const [a, b] of pairs) {
      const ra = returnSeries[a];
      const rb = returnSeries[b];
      if (!ra || !rb || ra.length !== rb.length || ra.length < 5) continue;
      const corr = pearsonCorr(ra, rb);
      if (!isNaN(corr)) corrs.push(corr);
    }

    if (corrs.length > 0) {
      const avgCorr = mean(corrs);
      // High positive correlation = markets moving together = confirming trend
      // Map -0.5 to +1.0 corr range → 0-100
      crossAssetScore = clamp(((avgCorr + 0.5) / 1.5) * 100, 0, 100);
    }
  }

  // ── Components array ─────────────────────────────────────────────────────
  const components: RegimeComponent[] = [
    {
      key: "trend",
      label: "Trend",
      score: round2(trendScore),
      method: "computed",
      description: `${above50}/${withEnoughData} ETFs above 50d MA; ${with200 > 0 ? `${above200}/${with200}` : "n/a"} above 200d MA`,
    },
    {
      key: "breadth",
      label: "Breadth",
      score: round2(breadthScore),
      method: "computed",
      description: `${advances} advancing vs ${declines} declining over 20 days`,
    },
    {
      key: "volatility",
      label: "Volatility",
      score: round2(volScore),
      method: "computed",
      description: `Avg 20d realized vol: ${(avgVol * 100).toFixed(1)}% annualized (lower = better)`,
    },
    {
      key: "liquidity",
      label: "Liquidity",
      score: round2(liquidityScore),
      method: "computed",
      description: "Proxy via short-term cross-sectional return dispersion (lower = tighter spreads)",
    },
    {
      key: "credit",
      label: "Credit",
      score: creditScore !== null ? round2(creditScore) : null,
      method: creditScore !== null ? "proxy" : "unavailable",
      description:
        creditScore !== null
          ? "XLF 20d momentum relative to universe median — financials outperformance signals credit support"
          : "Insufficient XLF price data",
    },
    {
      key: "commodities",
      label: "Commodities",
      score: commoditiesScore !== null ? round2(commoditiesScore) : null,
      method: commoditiesScore !== null ? "proxy" : "unavailable",
      description:
        commoditiesScore !== null
          ? "XLE + XLB relative strength vs universe — commodity ETF outperformance signals inflation/growth demand"
          : "Insufficient XLE/XLB price data",
    },
    {
      key: "cross_asset",
      label: "Cross-Asset Confirmation",
      score: crossAssetScore !== null ? round2(crossAssetScore) : null,
      method: crossAssetScore !== null ? "proxy" : "unavailable",
      description:
        crossAssetScore !== null
          ? `Avg pairwise 20d return correlation: ${crossAssetScore > 60 ? "high" : crossAssetScore > 40 ? "moderate" : "low"} — higher = broader participation`
          : "Insufficient data for correlation",
    },
    {
      key: "dollar",
      label: "Dollar",
      score: null,
      method: "unavailable",
      description: "Requires FX price data (DXY). Not available in current price upload.",
    },
    {
      key: "rates",
      label: "Rates",
      score: null,
      method: "unavailable",
      description: "Requires Treasury yield data (IEF, TLT). Not available in current price upload.",
    },
    {
      key: "earnings_revision",
      label: "Earnings Revision",
      score: null,
      method: "unavailable",
      description: "Requires EPS consensus data. Not derivable from price history.",
    },
  ];

  // ── Composite (weighted over available components only) ───────────────────
  // Weights by priority (must sum to 1.0 when all available)
  // Computed: Trend 25%, Breadth 20%, Vol 20%, Liq 10%
  // Proxy:    Credit 10%, Commodities 8%, CrossAsset 7%
  const weightMap: Record<string, number> = {
    trend: 0.25,
    breadth: 0.20,
    volatility: 0.20,
    liquidity: 0.10,
    credit: 0.10,
    commodities: 0.08,
    cross_asset: 0.07,
  };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const c of components) {
    const w = weightMap[c.key];
    if (!w) continue;
    if (c.score !== null) {
      weightedSum += c.score * w;
      totalWeight += w;
    }
  }

  const composite = totalWeight > 0 ? clamp(weightedSum / totalWeight, 0, 100) : 50;

  // ── Confidence: function of data coverage ─────────────────────────────────
  const computedAvail = components.filter((c) => c.method === "computed" && c.score !== null).length;
  const proxyAvail = components.filter((c) => c.method === "proxy" && c.score !== null).length;
  const maxScore = 4 * 2 + 3 * 1; // 4 computed × 2pts + 3 proxy × 1pt = 11
  const actualScore = computedAvail * 2 + proxyAvail * 1;
  const confidence = round2(clamp((actualScore / maxScore) * 100, 0, 100));

  // ── Label ─────────────────────────────────────────────────────────────────
  let label: string;
  if (composite >= 70) label = "Risk-On";
  else if (composite >= 55) label = "Constructive";
  else if (composite >= 40) label = "Neutral";
  else if (composite >= 25) label = "Cautious";
  else label = "Risk-Off";

  // ── Driver narrative ──────────────────────────────────────────────────────
  const drivers = buildDriverNarrative(components, composite, confidence);

  return {
    trend: round2(trendScore),
    breadth: round2(breadthScore),
    volatility: round2(volScore),
    liquidity: round2(liquidityScore),
    composite: round2(composite),
    label,
    components,
    confidence,
    drivers,
  };
}

function insufficientRegime(): EnrichedRegimeScores {
  const unavail = (key: string, label: string, desc: string): RegimeComponent => ({
    key, label, score: null, method: "unavailable", description: desc,
  });
  return {
    trend: 50, breadth: 50, volatility: 50, liquidity: 50,
    composite: 50, label: "Unknown",
    confidence: 0,
    drivers: "Insufficient price history to compute regime.",
    components: [
      unavail("trend", "Trend", "Requires ≥50 rows of price data"),
      unavail("breadth", "Breadth", "Requires ≥21 rows"),
      unavail("volatility", "Volatility", "Requires ≥21 rows"),
      unavail("liquidity", "Liquidity", "Requires ≥5 rows"),
      unavail("credit", "Credit", "Requires XLF price data"),
      unavail("commodities", "Commodities", "Requires XLE/XLB price data"),
      unavail("cross_asset", "Cross-Asset Confirmation", "Requires ≥3 tickers"),
      unavail("dollar", "Dollar", "Requires FX data"),
      unavail("rates", "Rates", "Requires Treasury yield data"),
      unavail("earnings_revision", "Earnings Revision", "Requires EPS consensus data"),
    ],
  };
}

function buildDriverNarrative(
  components: RegimeComponent[],
  composite: number,
  confidence: number
): string {
  const available = components.filter((c) => c.score !== null);
  if (available.length === 0) return "No components available.";

  const strong = available.filter((c) => (c.score ?? 0) >= 65).map((c) => c.label);
  const weak = available.filter((c) => (c.score ?? 100) <= 40).map((c) => c.label);

  const parts: string[] = [];

  if (strong.length > 0) {
    parts.push(`Supported by ${strong.slice(0, 3).join(", ")}.`);
  }
  if (weak.length > 0) {
    parts.push(`Headwinds from ${weak.slice(0, 3).join(", ")}.`);
  }
  if (composite >= 55 && weak.length === 0) {
    parts.push("Broad conditions favour risk exposure.");
  } else if (composite < 40) {
    parts.push("Model recommends defensive positioning.");
  }
  if (confidence < 60) {
    parts.push(`Note: ${confidence.toFixed(0)}% confidence — ${3 - available.filter(c => c.method !== "unavailable").length} key components unavailable.`);
  }

  return parts.join(" ") || "Composite conditions broadly neutral.";
}

function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] - ma;
    const bi = b[i] - mb;
    num += ai * bi;
    da += ai * ai;
    db += bi * bi;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? NaN : num / denom;
}

// ── Allocation constructor ───────────────────────────────────────────────────

export function constructAllocation(
  factorData: EtfFactorData[],
  etfs: EtfEntry[],
  constraints: Constraints,
  regime: EnrichedRegimeScores
): AllocationResult[] {
  const { cashMin, cashMax, maxEtfWeight, minInclusionThreshold, targetActiveEtfs, diversificationEnabled } = constraints;

  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);

  const regimeScore = regime.composite;
  const cashTargetUnadjusted = cashMin + (cashMax - cashMin) * 0.5;
  const regimeCashAdjust = ((50 - regimeScore) / 50) * (cashMax - cashMin) * 0.5;
  const cashTarget = clamp(cashTargetUnadjusted + regimeCashAdjust, cashMin, cashMax);
  const investedBudget = 1 - cashTarget;

  const eligible = factorData.filter((f) => {
    const etf = etfMap.get(f.ticker);
    if (!etf || !etf.enabled) return false;
    if (f.factorScores.composite < minInclusionThreshold) return false;
    return true;
  });

  eligible.sort((a, b) => b.factorScores.composite - a.factorScores.composite);
  const topN = eligible.slice(0, targetActiveEtfs);

  const totalScore = topN.reduce((s, f) => s + f.factorScores.composite, 0);
  const rawWeights = new Map<string, number>();
  for (const f of topN) {
    rawWeights.set(f.ticker, totalScore > 0 ? (f.factorScores.composite / totalScore) * investedBudget : investedBudget / topN.length);
  }

  let weights = new Map<string, number>(rawWeights);
  weights = enforceMaxWeight(weights, maxEtfWeight, investedBudget);

  if (diversificationEnabled) {
    weights = blendWithPrior(weights, etfMap, topN, investedBudget);
  }

  weights = normalizeWeights(weights, investedBudget);

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

  results.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return b.weight - a.weight;
  });

  return results;
}

// ── Watchlist computation ────────────────────────────────────────────────────

export function computeWatchlist(
  factorData: EtfFactorData[],
  etfs: EtfEntry[],
  constraints: Constraints,
  activeAllocations: AllocationResult[]
): WatchlistEntry[] {
  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);

  const activeSet = new Set(activeAllocations.filter((a) => a.active).map((a) => a.ticker));
  const { minInclusionThreshold, targetActiveEtfs } = constraints;

  // Enabled ETFs with price data that are NOT active
  const inactiveFactors = factorData.filter((f) => {
    const etf = etfMap.get(f.ticker);
    return etf && etf.enabled && !activeSet.has(f.ticker);
  });

  const entries: WatchlistEntry[] = [];

  for (const f of inactiveFactors) {
    const etf = etfMap.get(f.ticker)!;
    const score = f.factorScores.composite;

    let blockingReason: WatchlistReason;
    let blockingFactor: string;
    let improvement: string;

    if (score < minInclusionThreshold) {
      blockingReason = "score_below_threshold";
      // Find weakest factor
      const factorPairs: Array<[string, number]> = [
        ["Momentum 20d", f.factorScores.mom20],
        ["Momentum 60d", f.factorScores.mom60],
        ["Momentum 120d", f.factorScores.mom120],
        ["Trend Quality", f.factorScores.trendQuality],
        ["Low Volatility", f.factorScores.realizedVol60],
        ["Drawdown", f.factorScores.drawdown],
      ];
      factorPairs.sort((a, b) => a[1] - b[1]);
      blockingFactor = factorPairs[0][0];
      const gap = round2(minInclusionThreshold - score);
      improvement = `Composite needs +${gap} pts (currently ${score.toFixed(0)} vs ${minInclusionThreshold} threshold). Requires improvement in ${blockingFactor}.`;
    } else {
      blockingReason = "rank_cutoff";
      blockingFactor = "Rank cutoff";
      improvement = `Score (${score.toFixed(0)}) meets threshold but top-${targetActiveEtfs} positions are filled. Needs higher composite to displace an active position.`;
    }

    entries.push({
      ticker: f.ticker,
      name: etf.name,
      sector: etf.sector,
      compositeScore: round2(score),
      blockingReason,
      blockingFactor,
      improvement,
    });
  }

  // Sort: closest to inclusion first (score_below_threshold sorted by score desc, then rank_cutoff)
  entries.sort((a, b) => {
    if (a.blockingReason === "rank_cutoff" && b.blockingReason !== "rank_cutoff") return -1;
    if (a.blockingReason !== "rank_cutoff" && b.blockingReason === "rank_cutoff") return 1;
    return b.compositeScore - a.compositeScore;
  });

  return entries.slice(0, 5); // Top 5 near-miss watchlist
}

// ── IC Summary ───────────────────────────────────────────────────────────────

export function generateIcSummary(
  regime: EnrichedRegimeScores,
  cashWeight: number,
  cashPriorWeight: number,
  activeEtfCount: number,
  allocations: AllocationResult[]
): IcSummary {
  const cashChange = cashWeight - cashPriorWeight;
  const cashChangePct = (Math.abs(cashChange) * 100).toFixed(1);

  // What changed
  const cashDir = cashChange > 0.005 ? `increased by ${cashChangePct}pp` : cashChange < -0.005 ? `decreased by ${cashChangePct}pp` : "unchanged";
  const activeText = `${activeEtfCount} ETFs active in the invested sleeve.`;
  const addedEtfs = allocations.filter((a) => a.active && a.priorWeight < 0.001).map((a) => a.ticker);
  const removedEtfs = allocations.filter((a) => !a.active && a.priorWeight >= 0.001).map((a) => a.ticker);
  const changesText =
    addedEtfs.length > 0 || removedEtfs.length > 0
      ? ` ${addedEtfs.length > 0 ? `Added: ${addedEtfs.join(", ")}.` : ""} ${removedEtfs.length > 0 ? `Removed: ${removedEtfs.join(", ")}.` : ""}`
      : " No position changes vs prior month.";
  const whatChanged = `Cash ${cashDir} to ${(cashWeight * 100).toFixed(1)}%. ${activeText}${changesText}`;

  // Why
  const why = regime.drivers;

  // Risks
  const weakComponents = regime.components
    .filter((c) => c.score !== null && c.score <= 40)
    .map((c) => c.label);
  const unavailable = regime.components.filter((c) => c.method === "unavailable").length;
  const riskParts: string[] = [];
  if (weakComponents.length > 0) {
    riskParts.push(`Weak readings in ${weakComponents.join(", ")}.`);
  }
  if (regime.volatility < 45) {
    riskParts.push("Elevated realized volatility warrants caution on position sizing.");
  }
  if (cashWeight >= 0.58) {
    riskParts.push("High cash allocation reflects model defensiveness.");
  }
  if (unavailable >= 3) {
    riskParts.push(`${unavailable} regime components (Dollar, Rates, Earnings Revision) unavailable — model is incomplete; external macro judgment required.`);
  }
  const risks = riskParts.length > 0 ? riskParts.join(" ") : "No acute risk signals from available components.";

  // Watch next
  const borderline = regime.components
    .filter((c) => c.score !== null && c.score > 40 && c.score < 55)
    .map((c) => c.label);
  const watchParts: string[] = [];
  if (borderline.length > 0) {
    watchParts.push(`Monitor ${borderline.join(", ")} — currently borderline.`);
  }
  watchParts.push("Upload Treasury (IEF/TLT) and DXY price data to activate Rates and Dollar components.");
  if (regime.breadth < 55) {
    watchParts.push("Breadth improvement (more ETFs above MA) would signal broader participation.");
  }
  const watchNext = watchParts.join(" ");

  return { whatChanged, why, risks, watchNext };
}

// ── Internal allocation helpers ──────────────────────────────────────────────

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
  const blendFactor = 0.3;
  const result = new Map<string, number>();
  for (const [k, w] of weights) {
    const etf = etfMap.get(k);
    if (!etf) { result.set(k, w); continue; }
    const blended = w * (1 - blendFactor) + etf.priorWeight * blendFactor;
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

// ── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
