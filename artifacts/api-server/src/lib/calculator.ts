/**
 * Allocation Lab v2 — Calculation Engine (Iteration 3)
 *
 * Computes factor scores, regime scores, allocation, IC summary, watchlist,
 * and portfolio diagnostics from raw price data.
 * All factor/regime scores on a 0-100 scale.
 *
 * Regime framework (10 components):
 *   Computed: Trend, Breadth, Volatility, Liquidity
 *   Proxy:    Credit (XLF), Commodities (XLE+XLB), Cross-Asset Confirmation
 *   Unavailable: Dollar (no FX), Rates (no bonds), Earnings Revision (no EPS)
 *
 * Diagnostics:
 *   Expected Portfolio Volatility, HHI, ENB, Diversification Score,
 *   Risk Contribution by ETF, Correlation Matrix, Tracking Error
 */

// ── Core Interfaces ──────────────────────────────────────────────────────────

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

// ── Diagnostics Interfaces ───────────────────────────────────────────────────

export interface RiskContributionEntry {
  ticker: string;
  name: string;
  weight: number;
  riskContributionPct: number;
  marginalVolContribution: number;
}

export interface CorrelationCell {
  tickerA: string;
  tickerB: string;
  correlation: number;
}

export interface TrackingErrorEntry {
  benchmarkTicker: string;
  trackingError: number;
}

export interface PortfolioDiagnostics {
  expectedVolatility: number;
  hhi: number;
  effectiveNumberOfBets: number;
  diversificationScore: number;
  riskContributions: RiskContributionEntry[];
  correlationMatrix: CorrelationCell[];
  activeTickers: string[];
  trackingErrors: TrackingErrorEntry[];
  lookbackDays: number;
  insufficientDataReasons: string[];
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

// ── Factor computation ───────────────────────────────────────────────────────

export function computeFactors(rows: PriceRow[], tickers: string[]): EtfFactorData[] {
  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker] !== undefined) pricesByTicker[ticker].push(row.prices[ticker]);
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
    rawVol60.set(ticker, realizedVolatility(prices, Math.min(60, prices.length - 1)));
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
      factorScores: { mom20: round2(m20), mom60: round2(m60), mom120: round2(m120), mom252: round2(m252), trendQuality: round2(tq), realizedVol60: round2(v60), drawdown: round2(dd), meanReversion: round2(mr), composite: round2(composite) },
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
  if (rows.length < 10) return insufficientRegime();

  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker]) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  let above50 = 0, above200 = 0, withEnoughData = 0, with200 = 0;
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 50) {
      withEnoughData++;
      if (prices[prices.length - 1] > mean(prices.slice(-50))) above50++;
    }
    if (prices.length >= 200) {
      with200++;
      if (prices[prices.length - 1] > mean(prices.slice(-200))) above200++;
    }
  }
  const trendRaw = withEnoughData > 0 ? (above50 / withEnoughData) * 0.6 + (with200 > 0 ? (above200 / with200) * 0.4 : 0.4) : 0.5;
  const trendScore = clamp(trendRaw * 100, 0, 100);

  let advances = 0, declines = 0;
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 21) {
      const ret = (prices[prices.length - 1] - prices[prices.length - 21]) / prices[prices.length - 21];
      if (ret > 0) advances++; else declines++;
    }
  }
  const breadthScore = clamp((advances + declines) > 0 ? (advances / (advances + declines)) * 100 : 50, 0, 100);

  const vols: number[] = [];
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 21) { const v = realizedVolatility(prices, 20); if (!isNaN(v)) vols.push(v); }
  }
  const avgVol = vols.length > 0 ? mean(vols) : 0.15;
  const volScore = clamp(100 - ((avgVol - 0.05) / 0.25) * 100, 0, 100);

  const dispersion: number[] = [];
  for (const ticker of tickers) {
    const prices = pricesByTicker[ticker];
    if (prices.length >= 5) { const rets = getReturns(prices.slice(-5)); dispersion.push(std(rets)); }
  }
  const liquidityScore = clamp(100 - ((dispersion.length > 0 ? mean(dispersion) : 0.01) / 0.02) * 50, 0, 100);

  let creditScore: number | null = null;
  const xlfPrices = pricesByTicker["XLF"];
  if (xlfPrices && xlfPrices.length >= 21) {
    const xlfMom = momentum(xlfPrices, 20);
    const allMoms = tickers.map(t => { const p = pricesByTicker[t]; return p && p.length >= 21 ? momentum(p, 20) : NaN; }).filter(v => !isNaN(v));
    const medMom = allMoms.sort((a, b) => a - b)[Math.floor(allMoms.length / 2)] ?? 0;
    creditScore = clamp(50 + (xlfMom - medMom) * 1000, 0, 100);
  }

  let commoditiesScore: number | null = null;
  const commTickers = ["XLE", "XLB"].filter(t => pricesByTicker[t] && pricesByTicker[t].length >= 21);
  if (commTickers.length > 0) {
    const allMoms = tickers.map(t => { const p = pricesByTicker[t]; return p && p.length >= 21 ? momentum(p, 20) : NaN; }).filter(v => !isNaN(v));
    const medMom = allMoms.sort((a, b) => a - b)[Math.floor(allMoms.length / 2)] ?? 0;
    commoditiesScore = clamp(50 + (mean(commTickers.map(t => momentum(pricesByTicker[t], 20))) - medMom) * 1000, 0, 100);
  }

  let crossAssetScore: number | null = null;
  const withData = tickers.filter(t => pricesByTicker[t] && pricesByTicker[t].length >= 21);
  if (withData.length >= 3) {
    const retSeries: Record<string, number[]> = {};
    for (const t of withData) retSeries[t] = getReturns(pricesByTicker[t].slice(-21));
    const corrs: number[] = [];
    for (let i = 0; i < withData.length - 1; i++) {
      for (let j = i + 1; j < withData.length; j++) {
        const c = pearsonCorr(retSeries[withData[i]], retSeries[withData[j]]);
        if (!isNaN(c)) corrs.push(c);
      }
    }
    if (corrs.length > 0) crossAssetScore = clamp(((mean(corrs) + 0.5) / 1.5) * 100, 0, 100);
  }

  const components: RegimeComponent[] = [
    { key: "trend", label: "Trend", score: round2(trendScore), method: "computed", description: `${above50}/${withEnoughData} ETFs above 50d MA; ${with200 > 0 ? `${above200}/${with200}` : "n/a"} above 200d MA` },
    { key: "breadth", label: "Breadth", score: round2(breadthScore), method: "computed", description: `${advances} advancing vs ${declines} declining over 20 days` },
    { key: "volatility", label: "Volatility", score: round2(volScore), method: "computed", description: `Avg 20d realized vol: ${(avgVol * 100).toFixed(1)}% annualized (lower = better)` },
    { key: "liquidity", label: "Liquidity", score: round2(liquidityScore), method: "computed", description: "Proxy via short-term cross-sectional return dispersion (lower = tighter spreads)" },
    { key: "credit", label: "Credit", score: creditScore !== null ? round2(creditScore) : null, method: creditScore !== null ? "proxy" : "unavailable", description: creditScore !== null ? "XLF 20d momentum relative to universe median" : "Insufficient XLF price data" },
    { key: "commodities", label: "Commodities", score: commoditiesScore !== null ? round2(commoditiesScore) : null, method: commoditiesScore !== null ? "proxy" : "unavailable", description: commoditiesScore !== null ? "XLE + XLB relative strength vs universe" : "Insufficient XLE/XLB price data" },
    { key: "cross_asset", label: "Cross-Asset Confirmation", score: crossAssetScore !== null ? round2(crossAssetScore) : null, method: crossAssetScore !== null ? "proxy" : "unavailable", description: crossAssetScore !== null ? `Avg pairwise 20d return correlation: ${crossAssetScore > 60 ? "high" : crossAssetScore > 40 ? "moderate" : "low"}` : "Insufficient data for correlation" },
    { key: "dollar", label: "Dollar", score: null, method: "unavailable", description: "Requires FX price data (DXY/UUP). Not in current price upload." },
    { key: "rates", label: "Rates", score: null, method: "unavailable", description: "Requires Treasury yield data (IEF, TLT). Not in current price upload." },
    { key: "earnings_revision", label: "Earnings Revision", score: null, method: "unavailable", description: "Requires EPS consensus data. Not derivable from prices." },
  ];

  const weightMap: Record<string, number> = { trend: 0.25, breadth: 0.20, volatility: 0.20, liquidity: 0.10, credit: 0.10, commodities: 0.08, cross_asset: 0.07 };
  let wSum = 0, wTotal = 0;
  for (const c of components) {
    const w = weightMap[c.key]; if (!w) continue;
    if (c.score !== null) { wSum += c.score * w; wTotal += w; }
  }
  const composite = wTotal > 0 ? clamp(wSum / wTotal, 0, 100) : 50;

  const computedAvail = components.filter(c => c.method === "computed" && c.score !== null).length;
  const proxyAvail = components.filter(c => c.method === "proxy" && c.score !== null).length;
  const confidence = round2(clamp(((computedAvail * 2 + proxyAvail * 1) / 11) * 100, 0, 100));

  let label: string;
  if (composite >= 70) label = "Risk-On";
  else if (composite >= 55) label = "Constructive";
  else if (composite >= 40) label = "Neutral";
  else if (composite >= 25) label = "Cautious";
  else label = "Risk-Off";

  return { trend: round2(trendScore), breadth: round2(breadthScore), volatility: round2(volScore), liquidity: round2(liquidityScore), composite: round2(composite), label, components, confidence, drivers: buildDriverNarrative(components, composite, confidence) };
}

function insufficientRegime(): EnrichedRegimeScores {
  const u = (key: string, label: string, desc: string): RegimeComponent => ({ key, label, score: null, method: "unavailable", description: desc });
  return { trend: 50, breadth: 50, volatility: 50, liquidity: 50, composite: 50, label: "Unknown", confidence: 0, drivers: "Insufficient price history to compute regime.", components: [u("trend","Trend","Requires ≥50 rows"), u("breadth","Breadth","Requires ≥21 rows"), u("volatility","Volatility","Requires ≥21 rows"), u("liquidity","Liquidity","Requires ≥5 rows"), u("credit","Credit","Requires XLF"), u("commodities","Commodities","Requires XLE/XLB"), u("cross_asset","Cross-Asset Confirmation","Requires ≥3 tickers"), u("dollar","Dollar","Requires FX data"), u("rates","Rates","Requires Treasury data"), u("earnings_revision","Earnings Revision","Requires EPS data")] };
}

function buildDriverNarrative(components: RegimeComponent[], composite: number, confidence: number): string {
  const available = components.filter(c => c.score !== null);
  if (available.length === 0) return "No components available.";
  const strong = available.filter(c => (c.score ?? 0) >= 65).map(c => c.label);
  const weak = available.filter(c => (c.score ?? 100) <= 40).map(c => c.label);
  const parts: string[] = [];
  if (strong.length > 0) parts.push(`Supported by ${strong.slice(0, 3).join(", ")}.`);
  if (weak.length > 0) parts.push(`Headwinds from ${weak.slice(0, 3).join(", ")}.`);
  if (composite >= 55 && weak.length === 0) parts.push("Broad conditions favour risk exposure.");
  else if (composite < 40) parts.push("Model recommends defensive positioning.");
  if (confidence < 60) parts.push(`Note: ${confidence.toFixed(0)}% confidence — key macro dimensions unavailable.`);
  return parts.join(" ") || "Composite conditions broadly neutral.";
}

// ── Allocation constructor ───────────────────────────────────────────────────

export function constructAllocation(factorData: EtfFactorData[], etfs: EtfEntry[], constraints: Constraints, regime: EnrichedRegimeScores): AllocationResult[] {
  const { cashMin, cashMax, maxEtfWeight, minInclusionThreshold, targetActiveEtfs, diversificationEnabled } = constraints;
  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);

  const cashTarget = clamp(cashMin + (cashMax - cashMin) * 0.5 + ((50 - regime.composite) / 50) * (cashMax - cashMin) * 0.5, cashMin, cashMax);
  const investedBudget = 1 - cashTarget;

  const eligible = factorData.filter(f => { const e = etfMap.get(f.ticker); return e && e.enabled && f.factorScores.composite >= minInclusionThreshold; });
  eligible.sort((a, b) => b.factorScores.composite - a.factorScores.composite);
  const topN = eligible.slice(0, targetActiveEtfs);

  const totalScore = topN.reduce((s, f) => s + f.factorScores.composite, 0);
  let weights = new Map<string, number>();
  for (const f of topN) weights.set(f.ticker, totalScore > 0 ? (f.factorScores.composite / totalScore) * investedBudget : investedBudget / topN.length);

  weights = enforceMaxWeight(weights, maxEtfWeight, investedBudget);
  if (diversificationEnabled) weights = blendWithPrior(weights, etfMap, investedBudget);
  weights = normalizeWeights(weights, investedBudget);

  const results: AllocationResult[] = [];
  for (const f of factorData) {
    const etf = etfMap.get(f.ticker);
    if (!etf) continue;
    const weight = weights.get(f.ticker) ?? 0;
    results.push({ ticker: f.ticker, name: etf.name, sector: etf.sector, weight: round4(weight), priorWeight: round4(etf.priorWeight), change: round4(weight - etf.priorWeight), factorScores: f.factorScores, active: weight > 0.001 });
  }
  results.sort((a, b) => { if (a.active && !b.active) return -1; if (!a.active && b.active) return 1; return b.weight - a.weight; });
  return results;
}

// ── Watchlist ────────────────────────────────────────────────────────────────

export function computeWatchlist(factorData: EtfFactorData[], etfs: EtfEntry[], constraints: Constraints, activeAllocations: AllocationResult[]): WatchlistEntry[] {
  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);
  const activeSet = new Set(activeAllocations.filter(a => a.active).map(a => a.ticker));
  const { minInclusionThreshold, targetActiveEtfs } = constraints;

  const entries: WatchlistEntry[] = [];
  for (const f of factorData.filter(f => { const e = etfMap.get(f.ticker); return e && e.enabled && !activeSet.has(f.ticker); })) {
    const etf = etfMap.get(f.ticker)!;
    const score = f.factorScores.composite;
    let blockingReason: WatchlistReason, blockingFactor: string, improvement: string;
    if (score < minInclusionThreshold) {
      blockingReason = "score_below_threshold";
      const weakest = [["Momentum 20d", f.factorScores.mom20], ["Momentum 60d", f.factorScores.mom60], ["Trend Quality", f.factorScores.trendQuality], ["Low Volatility", f.factorScores.realizedVol60]].sort((a, b) => (a[1] as number) - (b[1] as number));
      blockingFactor = weakest[0][0] as string;
      improvement = `Composite needs +${round2(minInclusionThreshold - score)}pts (${score.toFixed(0)} vs ${minInclusionThreshold} threshold). Weakest factor: ${blockingFactor}.`;
    } else {
      blockingReason = "rank_cutoff";
      blockingFactor = "Rank cutoff";
      improvement = `Score (${score.toFixed(0)}) meets threshold but top-${targetActiveEtfs} positions are filled.`;
    }
    entries.push({ ticker: f.ticker, name: etf.name, sector: etf.sector, compositeScore: round2(score), blockingReason, blockingFactor, improvement });
  }
  entries.sort((a, b) => { if (a.blockingReason === "rank_cutoff" && b.blockingReason !== "rank_cutoff") return -1; if (a.blockingReason !== "rank_cutoff" && b.blockingReason === "rank_cutoff") return 1; return b.compositeScore - a.compositeScore; });
  return entries.slice(0, 5);
}

// ── IC Summary ───────────────────────────────────────────────────────────────

export function generateIcSummary(regime: EnrichedRegimeScores, cashWeight: number, cashPriorWeight: number, activeEtfCount: number, allocations: AllocationResult[]): IcSummary {
  const cashChange = cashWeight - cashPriorWeight;
  const cashDir = cashChange > 0.005 ? `increased by ${(Math.abs(cashChange) * 100).toFixed(1)}pp` : cashChange < -0.005 ? `decreased by ${(Math.abs(cashChange) * 100).toFixed(1)}pp` : "unchanged";
  const addedEtfs = allocations.filter(a => a.active && a.priorWeight < 0.001).map(a => a.ticker);
  const removedEtfs = allocations.filter(a => !a.active && a.priorWeight >= 0.001).map(a => a.ticker);
  const changesText = addedEtfs.length > 0 || removedEtfs.length > 0 ? ` ${addedEtfs.length > 0 ? `Added: ${addedEtfs.join(", ")}.` : ""} ${removedEtfs.length > 0 ? `Removed: ${removedEtfs.join(", ")}.` : ""}` : " No position changes vs prior month.";
  const whatChanged = `Cash ${cashDir} to ${(cashWeight * 100).toFixed(1)}%. ${activeEtfCount} ETFs active.${changesText}`;
  const weak = regime.components.filter(c => c.score !== null && c.score <= 40).map(c => c.label);
  const unavailable = regime.components.filter(c => c.method === "unavailable").length;
  const riskParts: string[] = [];
  if (weak.length > 0) riskParts.push(`Weak readings in ${weak.join(", ")}.`);
  if (regime.volatility < 45) riskParts.push("Elevated realized volatility warrants caution on position sizing.");
  if (cashWeight >= 0.58) riskParts.push("High cash allocation reflects model defensiveness.");
  if (unavailable >= 3) riskParts.push(`${unavailable} regime components unavailable — external macro judgment required.`);
  const borderline = regime.components.filter(c => c.score !== null && c.score > 40 && c.score < 55).map(c => c.label);
  const watchParts: string[] = [];
  if (borderline.length > 0) watchParts.push(`Monitor ${borderline.join(", ")} — borderline.`);
  watchParts.push("Add IEF/TLT and DXY to price upload to activate Rates and Dollar components.");
  if (regime.breadth < 55) watchParts.push("Breadth improvement would signal broader participation.");
  return { whatChanged, why: regime.drivers, risks: riskParts.length > 0 ? riskParts.join(" ") : "No acute risk signals from available components.", watchNext: watchParts.join(" ") };
}

// ── Decision Log / PM Decision Room ─────────────────────────────────────────

export type TradeAction = "ADD" | "INCREASE" | "DECREASE" | "TRIM" | "REMOVE" | "HOLD";

export interface TradeListEntry {
  ticker: string;
  name: string;
  sector: string;
  action: TradeAction;
  fromWeight: number;
  toWeight: number;
  deltaWeight: number;
  compositeScore: number;
  rationale: string;
}

const FACTOR_LABELS: Record<string, string> = {
  mom20: "20d Momentum",
  mom60: "60d Momentum",
  mom120: "120d Momentum",
  mom252: "252d Momentum",
  trendQuality: "Trend Quality",
  realizedVol60: "Low Volatility",
  drawdown: "Drawdown Resilience",
  meanReversion: "Mean Reversion",
};

function topFactors(fs: FactorScores, n: number): Array<[string, number]> {
  return (Object.keys(FACTOR_LABELS) as Array<keyof typeof FACTOR_LABELS>)
    .map((k) => [FACTOR_LABELS[k], fs[k as keyof FactorScores]] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function bottomFactors(fs: FactorScores, n: number): Array<[string, number]> {
  return (Object.keys(FACTOR_LABELS) as Array<keyof typeof FACTOR_LABELS>)
    .map((k) => [FACTOR_LABELS[k], fs[k as keyof FactorScores]] as [string, number])
    .sort((a, b) => a[1] - b[1])
    .slice(0, n);
}

/**
 * Builds an institutional-grade rationale for a single allocation change,
 * tying the weight change back to the specific factors and regime backdrop
 * that drove it — never generic boilerplate.
 */
function buildTradeRationale(
  action: TradeAction,
  ticker: string,
  fs: FactorScores,
  regime: EnrichedRegimeScores,
  fromWeight: number,
  toWeight: number,
  minInclusionThreshold: number,
): string {
  const deltaPts = Math.abs((toWeight - fromWeight) * 100).toFixed(1);
  const strong = topFactors(fs, 2);
  const weak = bottomFactors(fs, 1)[0];
  const strongText = strong.map(([label, v]) => `${label} (${v.toFixed(0)})`).join(" and ");
  const regimeText = `${regime.label.toLowerCase()} regime (composite ${regime.composite.toFixed(0)})`;

  switch (action) {
    case "ADD":
      return `New position at ${(toWeight * 100).toFixed(1)}%. Composite score of ${fs.composite.toFixed(0)} led by ${strongText}, supported by the ${regimeText}.`;
    case "INCREASE":
      return `Increased +${deltaPts}pp to ${(toWeight * 100).toFixed(1)}% on continued strength in ${strongText}. Composite ${fs.composite.toFixed(0)}, consistent with the ${regimeText}.`;
    case "DECREASE":
    case "TRIM":
      return `Trimmed ${deltaPts}pp to ${(toWeight * 100).toFixed(1)}% as ${weak[0]} weakened to ${weak[0] === "Low Volatility" ? weak[1].toFixed(0) : weak[1].toFixed(0)}, pulling composite to ${fs.composite.toFixed(0)}.`;
    case "REMOVE":
      return `Exited position; composite fell to ${fs.composite.toFixed(0)}, below the ${minInclusionThreshold}pt inclusion threshold. Weakest factor: ${weak[0]} (${weak[1].toFixed(0)}).`;
    default:
      return `Held at ${(toWeight * 100).toFixed(1)}%. Composite ${fs.composite.toFixed(0)}, factors broadly unchanged (${strongText}).`;
  }
}

/** Builds a full, ranked trade list from allocation changes, each with a factor-tied rationale. */
export function generateTradeList(
  allocations: AllocationResult[],
  regime: EnrichedRegimeScores,
  minInclusionThreshold: number,
  includeHolds = false,
): TradeListEntry[] {
  const entries: TradeListEntry[] = [];
  for (const a of allocations) {
    const deltaWeight = a.change;
    let action: TradeAction;
    if (a.active && a.priorWeight < 0.001) action = "ADD";
    else if (!a.active && a.priorWeight >= 0.001) action = "REMOVE";
    else if (deltaWeight > 0.005) action = "INCREASE";
    else if (deltaWeight < -0.005) action = "DECREASE";
    else action = "HOLD";

    if (action === "HOLD" && !includeHolds) continue;

    entries.push({
      ticker: a.ticker,
      name: a.name,
      sector: a.sector,
      action,
      fromWeight: round4(a.priorWeight),
      toWeight: round4(a.weight),
      deltaWeight: round4(deltaWeight),
      compositeScore: round2(a.factorScores.composite),
      rationale: buildTradeRationale(action, a.ticker, a.factorScores, regime, a.priorWeight, a.weight, minInclusionThreshold),
    });
  }
  const rank: Record<TradeAction, number> = { ADD: 0, INCREASE: 1, DECREASE: 2, TRIM: 2, REMOVE: 3, HOLD: 4 };
  entries.sort((x, y) => rank[x.action] - rank[y.action] || Math.abs(y.deltaWeight) - Math.abs(x.deltaWeight));
  return entries;
}

/** Institutional market-view paragraph tying the regime backdrop directly to the resulting positioning. */
export function generateMarketView(regime: EnrichedRegimeScores, cashWeight: number, activeEtfCount: number): string {
  const supportive = regime.components.filter((c) => c.score !== null && c.score >= 55).map((c) => c.label);
  const weak = regime.components.filter((c) => c.score !== null && c.score <= 40).map((c) => c.label);
  const supportText = supportive.length > 0 ? `Supported by ${supportive.join(", ")}.` : "No components showing clear strength.";
  const weakText = weak.length > 0 ? ` Headwinds from ${weak.join(", ")}.` : "";
  return `The model reads a ${regime.label} regime (composite ${regime.composite.toFixed(0)}/100, confidence ${regime.confidence.toFixed(0)}%). ${supportText}${weakText} Positioning reflects this backdrop with ${(cashWeight * 100).toFixed(1)}% in cash and ${activeEtfCount} active ETF sleeves.`;
}

/** Structured key-risk bullets (regime softness, concentration, data coverage) for the committee. */
export function generateKeyRisks(regime: EnrichedRegimeScores, cashWeight: number, diagnostics: PortfolioDiagnostics): string[] {
  const risks: string[] = [];
  const weak = regime.components.filter((c) => c.score !== null && c.score <= 40).map((c) => c.label);
  if (weak.length > 0) risks.push(`Weak regime readings in ${weak.join(", ")} increase the odds of a near-term reversal in positioning.`);
  if (regime.volatility < 45) risks.push("Elevated realized volatility warrants caution on position sizing and tighter rebalancing bands.");
  if (cashWeight >= 0.58) risks.push("High cash allocation reflects model defensiveness — opportunity cost if the regime firms up quickly.");
  const unavailable = regime.components.filter((c) => c.method === "unavailable").length;
  if (unavailable >= 3) risks.push(`${unavailable} regime components (Dollar, Rates, Earnings Revision) are unavailable — external macro judgment should supplement the model.`);
  if (diagnostics.effectiveNumberOfBets > 0 && diagnostics.effectiveNumberOfBets < 5) risks.push(`Effective number of bets is low (${diagnostics.effectiveNumberOfBets.toFixed(1)}), indicating concentration risk in the invested sleeve.`);
  if (diagnostics.hhi > 0.15) risks.push(`HHI of ${diagnostics.hhi.toFixed(3)} signals meaningful concentration among active positions.`);
  if (risks.length === 0) risks.push("No acute risk signals from available components this cycle.");
  return risks;
}

export interface DecisionLogContent {
  marketView: string;
  keyRisks: string[];
  tradeList: TradeListEntry[];
  watchlist: WatchlistEntry[];
  cashWeight: number;
  cashChange: number;
  activeEtfCount: number;
}

/** Aggregates the full PM decision-room content for a session — the audit snapshot stored in the Decision Log. */
export function buildDecisionLogContent(
  regime: EnrichedRegimeScores,
  allocations: AllocationResult[],
  watchlist: WatchlistEntry[],
  diagnostics: PortfolioDiagnostics,
  cashWeight: number,
  cashChange: number,
  activeEtfCount: number,
  minInclusionThreshold: number,
): DecisionLogContent {
  return {
    marketView: generateMarketView(regime, cashWeight, activeEtfCount),
    keyRisks: generateKeyRisks(regime, cashWeight, diagnostics),
    tradeList: generateTradeList(allocations, regime, minInclusionThreshold),
    watchlist,
    cashWeight,
    cashChange,
    activeEtfCount,
  };
}

// ── Portfolio Diagnostics ────────────────────────────────────────────────────

/** Known benchmark tickers to auto-detect from price data. */
const BENCHMARK_TICKERS = ["SPY", "QQQ", "IWM", "VTI", "AGG", "EFA", "GLD"];

/**
 * Compute portfolio risk diagnostics from allocation weights and price history.
 * Uses a 60-day return window for covariance estimation (minimum 21 days).
 */
export function computePortfolioDiagnostics(
  allocations: AllocationResult[],
  etfMap: Map<string, EtfEntry>,
  rows: PriceRow[],
  availableTickers: string[]
): PortfolioDiagnostics {
  const LOOKBACK = 60;
  const MIN_LOOKBACK = 21;
  const insufficientDataReasons: string[] = [];

  // Active ETFs (non-cash, weight > 0)
  const activeAllocs = allocations.filter(a => a.active && a.weight > 0.001);
  const activeTickers = activeAllocs.map(a => a.ticker);

  if (activeAllocs.length < 2) {
    return {
      expectedVolatility: 0, hhi: 1, effectiveNumberOfBets: 1, diversificationScore: 0,
      riskContributions: [], correlationMatrix: [], activeTickers, trackingErrors: [],
      lookbackDays: 0, insufficientDataReasons: ["Fewer than 2 active ETFs — diagnostics require at least 2 positions."],
    };
  }

  // Build price history lookup
  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of [...activeTickers, ...BENCHMARK_TICKERS]) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of Object.keys(pricesByTicker)) {
      if (row.prices[ticker] !== undefined) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  // Determine actual lookback (min across active tickers)
  const availableLookback = Math.min(...activeTickers.map(t => Math.max(0, pricesByTicker[t].length - 1)));
  const usedLookback = Math.min(LOOKBACK, availableLookback);

  if (usedLookback < MIN_LOOKBACK) {
    insufficientDataReasons.push(`Only ${usedLookback} return observations available — minimum ${MIN_LOOKBACK} required for covariance.`);
    return {
      expectedVolatility: 0, hhi: 1 / activeAllocs.length, effectiveNumberOfBets: activeAllocs.length,
      diversificationScore: 0, riskContributions: [], correlationMatrix: [], activeTickers, trackingErrors: [],
      lookbackDays: usedLookback, insufficientDataReasons,
    };
  }

  if (usedLookback < LOOKBACK) {
    insufficientDataReasons.push(`Using ${usedLookback} days of history (preferred: ${LOOKBACK}). Covariance estimates may be less stable.`);
  }

  // Compute return matrices [days × tickers]
  const returnMatrix: number[][] = activeTickers.map(t => getReturns(pricesByTicker[t].slice(-(usedLookback + 1))));
  const n = Math.min(...returnMatrix.map(r => r.length));

  // Covariance matrix (annualized)
  const nT = activeTickers.length;
  const cov: number[][] = Array.from({ length: nT }, () => Array(nT).fill(0));
  for (let i = 0; i < nT; i++) {
    for (let j = i; j < nT; j++) {
      const ri = returnMatrix[i].slice(0, n);
      const rj = returnMatrix[j].slice(0, n);
      const mi = mean(ri);
      const mj = mean(rj);
      let c = 0;
      for (let t = 0; t < n; t++) c += (ri[t] - mi) * (rj[t] - mj);
      const dailyCov = c / (n - 1);
      cov[i][j] = dailyCov * 252; // annualize
      cov[j][i] = cov[i][j];
    }
  }

  // Portfolio weights vector (active ETFs only, normalized)
  const totalActiveWeight = activeAllocs.reduce((s, a) => s + a.weight, 0);
  const w = activeAllocs.map(a => a.weight / totalActiveWeight);

  // Portfolio variance: σ²_p = w^T Σ w
  let portfolioVariance = 0;
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) {
      portfolioVariance += w[i] * w[j] * cov[i][j];
    }
  }
  const portfolioVol = Math.sqrt(Math.max(0, portfolioVariance)); // annualized

  // Marginal contributions: (Σw)[i]
  const sigmaw: number[] = Array(nT).fill(0);
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) sigmaw[i] += cov[i][j] * w[j];
  }

  // Risk contributions: RC[i] = w[i] * (Σw)[i]
  const riskContributions: RiskContributionEntry[] = activeAllocs.map((a, i) => {
    const rc = w[i] * sigmaw[i]; // variance contribution (annualized)
    const rcPct = portfolioVariance > 0 ? (rc / portfolioVariance) * 100 : 0;
    const marginalVol = portfolioVol > 0 ? (w[i] * sigmaw[i]) / portfolioVol : 0; // vol contribution
    const etf = etfMap.get(a.ticker);
    return {
      ticker: a.ticker,
      name: etf?.name ?? a.name,
      weight: round4(a.weight),
      riskContributionPct: round2(Math.max(0, rcPct)),
      marginalVolContribution: round4(marginalVol),
    };
  });
  riskContributions.sort((a, b) => b.riskContributionPct - a.riskContributionPct);

  // Correlation matrix (all active-ticker pairs including self)
  const correlationMatrix: CorrelationCell[] = [];
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) {
      const denom = Math.sqrt(cov[i][i] * cov[j][j]);
      const corr = denom > 0 ? clamp(cov[i][j] / denom, -1, 1) : (i === j ? 1 : 0);
      correlationMatrix.push({ tickerA: activeTickers[i], tickerB: activeTickers[j], correlation: round4(corr) });
    }
  }

  // HHI (weight-based, active ETFs normalized)
  const hhi = round4(w.reduce((s, wi) => s + wi * wi, 0));
  const effectiveNumberOfBets = round2(hhi > 0 ? 1 / hhi : activeAllocs.length);

  // Diversification score: based on average off-diagonal correlation
  let corrSum = 0, corrCount = 0;
  for (let i = 0; i < nT - 1; i++) {
    for (let j = i + 1; j < nT; j++) {
      const cell = correlationMatrix.find(c => c.tickerA === activeTickers[i] && c.tickerB === activeTickers[j]);
      if (cell) { corrSum += cell.correlation; corrCount++; }
    }
  }
  const avgCorr = corrCount > 0 ? corrSum / corrCount : 0.5;
  const diversificationScore = round2(clamp((1 - avgCorr) * 100, 0, 100));

  // Tracking error vs detected benchmarks
  const trackingErrors: TrackingErrorEntry[] = [];
  const portfolioReturns: number[] = Array(n).fill(0);
  for (let i = 0; i < nT; i++) {
    const ri = returnMatrix[i].slice(0, n);
    for (let t = 0; t < n; t++) portfolioReturns[t] += w[i] * ri[t];
  }

  for (const bmTicker of BENCHMARK_TICKERS) {
    if (!availableTickers.includes(bmTicker)) continue;
    const bmPrices = pricesByTicker[bmTicker];
    if (bmPrices.length < usedLookback + 1) continue;
    const bmReturns = getReturns(bmPrices.slice(-(usedLookback + 1))).slice(0, n);
    if (bmReturns.length < n) continue;
    const activeErrors = portfolioReturns.map((r, t) => r - bmReturns[t]);
    const te = std(activeErrors) * Math.sqrt(252);
    if (!isNaN(te)) trackingErrors.push({ benchmarkTicker: bmTicker, trackingError: round4(te) });
  }

  if (trackingErrors.length === 0) {
    insufficientDataReasons.push("No benchmark tickers (SPY, QQQ, IWM, VTI, AGG, EFA, GLD) found in price data. Add one to compute tracking error.");
  }

  return {
    expectedVolatility: round4(portfolioVol),
    hhi,
    effectiveNumberOfBets,
    diversificationScore,
    riskContributions,
    correlationMatrix,
    activeTickers,
    trackingErrors,
    lookbackDays: usedLookback,
    insufficientDataReasons,
  };
}

// ── Allocation helpers ───────────────────────────────────────────────────────

function enforceMaxWeight(weights: Map<string, number>, maxW: number, budget: number): Map<string, number> {
  let excess = 0;
  const result = new Map<string, number>();
  const uncapped: string[] = [];
  for (const [k, v] of weights) {
    if (v > maxW) { result.set(k, maxW); excess += v - maxW; } else { result.set(k, v); uncapped.push(k); }
  }
  if (excess > 0 && uncapped.length > 0) {
    const perUncapped = excess / uncapped.length;
    for (const k of uncapped) result.set(k, Math.min(maxW, (result.get(k) ?? 0) + perUncapped));
  }
  return result;
}

function blendWithPrior(weights: Map<string, number>, etfMap: Map<string, EtfEntry>, budget: number): Map<string, number> {
  const result = new Map<string, number>();
  for (const [k, w] of weights) {
    const etf = etfMap.get(k);
    result.set(k, Math.max(0, etf ? w * 0.7 + etf.priorWeight * 0.3 : w));
  }
  return result;
}

function normalizeWeights(weights: Map<string, number>, budget: number): Map<string, number> {
  const total = Array.from(weights.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return weights;
  const result = new Map<string, number>();
  for (const [k, v] of weights) result.set(k, (v / total) * budget);
  return result;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }
function round2(v: number): number { return Math.round(v * 100) / 100; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }

// ── Archive: cross-period diff helpers ───────────────────────────────────────

export interface WeightedHolding {
  ticker: string;
  weight: number;
}

/**
 * One-way turnover between two allocation snapshots: half the sum of absolute
 * weight changes across all tickers held in either period. Matches the
 * convention used by the backtesting workspace.
 */
export function computeTurnover(prev: WeightedHolding[], curr: WeightedHolding[]): number {
  const prevWeights = new Map(prev.map((a) => [a.ticker, a.weight]));
  const currWeights = new Map(curr.map((a) => [a.ticker, a.weight]));
  const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
  let sumAbsDiff = 0;
  for (const t of allTickers) {
    sumAbsDiff += Math.abs((currWeights.get(t) ?? 0) - (prevWeights.get(t) ?? 0));
  }
  return round4(sumAbsDiff / 2);
}

/**
 * Realized return of holding a fixed allocation (piecewise-constant weights,
 * cash contributing 0%) from fromDate through toDate, using uploaded price
 * history. Returns null with a reason if there isn't enough price coverage.
 */
export function computeRealizedReturn(
  priceRows: PriceRow[],
  allocations: WeightedHolding[],
  fromDate: string,
  toDate: string
): { returnPct: number | null; reason: string | null } {
  if (toDate <= fromDate) {
    return { returnPct: null, reason: "The comparison period must move forward in time to compute a realized return." };
  }

  const inRange = priceRows.filter((r) => r.date >= fromDate && r.date <= toDate).sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length < 2) {
    return { returnPct: null, reason: "No uploaded price data covers this date range." };
  }

  let index = 100;
  for (let i = 1; i < inRange.length; i++) {
    const prevRow = inRange[i - 1];
    const row = inRange[i];
    let periodReturn = 0;
    for (const alloc of allocations) {
      const prevPrice = prevRow.prices[alloc.ticker];
      const price = row.prices[alloc.ticker];
      if (prevPrice && price && prevPrice > 0) {
        periodReturn += alloc.weight * ((price - prevPrice) / prevPrice);
      }
    }
    index *= 1 + periodReturn;
  }

  return { returnPct: round4(index / 100 - 1), reason: null };
}
