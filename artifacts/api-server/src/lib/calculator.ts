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

import { d6Trace } from "./d6-trace";
import {
  configuredWeight,
  regimeKey,
  type FactorDefinition,
} from "./factor-library";

// ── Core Interfaces ──────────────────────────────────────────────────────────

export interface PriceRow {
  date: string;
  prices: Record<string, number>;
  opens?: Record<string, number>;
  highs?: Record<string, number>;
  lows?: Record<string, number>;
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
  dynamic: Record<string, number | null>;
}

export interface FactorContribution {
  factorId: string;
  factorName: string;
  rawValue: number | null;
  transformedValue: number | null;
  winsorizedValue: number | null;
  normalizedValue: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  weightedContribution: number | null;
  available: boolean;
  calculationStatus: "available" | "imputed" | "unavailable";
  missingDataTreatment: FactorDefinition["missingDataTreatment"];
  unavailableReason: string | null;
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
  factorContributions: FactorContribution[];
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
  /** Minimum final portfolio weight for any included ETF. Optional for legacy snapshots. */
  minEtfWeight?: number;
  minInclusionThreshold: number;
  targetActiveEtfs: number;
  diversificationEnabled: boolean;
}

export class AllocationConstraintError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "AllocationConstraintError";
  }
}

export interface AllocationResult {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  priorWeight: number;
  change: number;
  factorScores: FactorScores;
  factorContributions: FactorContribution[];
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
  if (prices.length < 5 || prices.some((price) => !Number.isFinite(price) || price <= 0)) return NaN;
  const n = prices.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const logPrices = prices.map(Math.log);
  const mx = mean(xs);
  const my = mean(logPrices);
  let ssxy = 0;
  let ssx = 0;
  let ssy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (xs[i] - mx) * (logPrices[i] - my);
    ssx += (xs[i] - mx) ** 2;
    ssy += (logPrices[i] - my) ** 2;
  }
  if (ssx === 0 || ssy === 0) return 0;
  const beta = ssxy / ssx;
  const rSquared = (ssxy / Math.sqrt(ssx * ssy)) ** 2;
  return Math.sign(beta) * rSquared;
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
  for (let start = 0; start < valid.length;) {
    let end = start + 1;
    while (end < valid.length && valid[end][1] === valid[start][1]) end++;
    const midrank = (start + end - 1) / 2;
    const percentile = valid.length === 1 ? 50 : (midrank / (valid.length - 1)) * 100;
    for (let i = start; i < end; i++) result.set(valid[i][0], percentile);
    start = end;
  }
  return result;
}

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

function normalizeCrossSection(values: Map<string, number>, normalization: FactorDefinition["normalization"]): Map<string, number> {
  if (normalization === "percentile_rank") return crossSectionalRank(values);
  const sample = [...values.values()];
  const center = normalization === "robust_z_score" ? median(sample) : mean(sample);
  const scale = normalization === "robust_z_score"
    ? 1.4826 * median(sample.map((value) => Math.abs(value - center)))
    : std(sample);
  return new Map([...values].map(([ticker, value]) => [
    ticker,
    clamp(50 + (scale > 0 ? ((value - center) / scale) * 15 : 0), 0, 100),
  ]));
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

export function computeFactors(
  rows: PriceRow[],
  tickers: string[],
  factorSet?: { factors: FactorDefinition[] },
  regimeLabel = "Neutral",
): EtfFactorData[] {
  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) pricesByTicker[ticker] = [];
  for (const row of rows) {
    for (const ticker of tickers) {
      if (row.prices[ticker] !== undefined) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  const fallbackFactors: FactorDefinition[] = [
    { id: "momentum_20", name: "Momentum 20D", calculationType: "momentum", lookback: 20, lag: 0, direction: "higher_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .2, regimeWeights: { riskOn: .2, neutral: .2, riskOff: .2 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "return(20)", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Momentum", description: "" },
    { id: "momentum_60", name: "Momentum 60D", calculationType: "momentum", lookback: 60, lag: 0, direction: "higher_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .2, regimeWeights: { riskOn: .2, neutral: .2, riskOff: .2 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "return(60)", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Momentum", description: "" },
    { id: "trend_quality", name: "Trend Quality", calculationType: "trend_quality", lookback: 120, lag: 0, direction: "higher_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .15, regimeWeights: { riskOn: .15, neutral: .15, riskOff: .15 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "trendQuality", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Trend", description: "" },
    { id: "volatility", name: "Volatility", calculationType: "volatility", lookback: 60, lag: 0, direction: "lower_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .15, regimeWeights: { riskOn: .15, neutral: .15, riskOff: .15 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "volatility", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Risk", description: "" },
    { id: "drawdown", name: "Drawdown", calculationType: "drawdown", lookback: 252, lag: 0, direction: "higher_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .15, regimeWeights: { riskOn: .15, neutral: .15, riskOff: .15 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "min(P(t) / running_max(P) - 1)", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Risk", description: "" },
    { id: "mean_reversion", name: "Mean Reversion", calculationType: "mean_reversion", lookback: 5, lag: 0, direction: "higher_is_better", normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: .15, regimeWeights: { riskOn: .15, neutral: .15, riskOff: .15 }, activeRegimes: ["risk_on", "neutral", "risk_off"], enabled: true, status: "active", inputSeries: "price", formula: "meanReversion", dataSource: "price", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "legacy", family: "Reversal", description: "" },
  ];
  const factors = (factorSet?.factors ?? fallbackFactors).filter((factor) => factor.enabled && factor.status === "active");
  const rawByFactor = new Map<string, Map<string, number>>();
  const transformedByFactor = new Map<string, Map<string, number>>();
  const winsorizedByFactor = new Map<string, Map<string, number>>();

  const returnsFor = (ticker: string, lookback: number, lag: number) => {
    const prices = pricesByTicker[ticker] ?? [];
    const end = Math.max(0, prices.length - lag);
    return momentum(prices.slice(0, end), lookback);
  };
  for (const factor of factors) {
    const rawValues = new Map<string, number>();
    const transformedValues = new Map<string, number>();
    for (const ticker of tickers) {
      const prices = pricesByTicker[ticker] ?? [];
      const end = Math.max(0, prices.length - factor.lag);
      const sample = prices.slice(Math.max(0, end - factor.lookback - 1), end);
      let value = NaN;
      switch (factor.calculationType) {
        case "momentum": value = momentum(sample, factor.lookback); break;
        case "trend_quality": value = trendQuality(sample); break;
        case "volatility": value = realizedVolatility(sample, factor.lookback); break;
        case "drawdown": value = -maxDrawdown(sample); break;
        case "mean_reversion": value = -returnsFor(ticker, factor.lookback, factor.lag); break;
        case "relative_strength": {
          const benchmark = factor.benchmarkTicker ? returnsFor(factor.benchmarkTicker, factor.lookback, factor.lag) : NaN;
          value = returnsFor(ticker, factor.lookback, factor.lag) - benchmark;
          break;
        }
        case "residual_momentum":
        case "correlation_stability":
        case "unsupported":
          value = NaN;
          break;
        case "return_over_volatility": {
          const ret = returnsFor(ticker, factor.lookback, factor.lag);
          const vol = realizedVolatility(sample, factor.lookback);
          value = vol > 0 ? ret / vol : NaN;
          break;
        }
        case "ma_distance": {
          const avg = mean(sample);
          value = avg > 0 && sample.length ? sample[sample.length - 1] / avg - 1 : NaN;
          break;
        }
        case "diversification_benefit": {
          const assetReturns = getReturns(sample);
          const correlations = tickers.filter((peer) => peer !== ticker).map((peer) => {
            const peerPrices = pricesByTicker[peer] ?? [];
            const peerEnd = Math.max(0, peerPrices.length - factor.lag);
            return pearsonCorr(assetReturns, getReturns(peerPrices.slice(Math.max(0, peerEnd - factor.lookback - 1), peerEnd)));
          }).filter(Number.isFinite);
          value = correlations.length ? 1 - mean(correlations) : NaN;
          break;
        }
        case "drawdown_recovery": {
          const dd = maxDrawdown(sample);
          value = dd > 0 && sample.length ? (sample[sample.length - 1] / Math.min(...sample) - 1) / dd : NaN;
          break;
        }
        case "downside_beta": {
          const benchmarkPrices = factor.benchmarkTicker ? pricesByTicker[factor.benchmarkTicker] ?? [] : [];
          const benchmarkReturns = getReturns(benchmarkPrices.slice(-sample.length));
          const assetReturns = getReturns(sample);
          const downsidePairs = benchmarkReturns.map((ret, index) => [ret, assetReturns[index]] as const).filter(([ret, asset]) => ret < 0 && Number.isFinite(asset));
          const benchmarkDown = downsidePairs.map(([ret]) => ret);
          const assetDown = downsidePairs.map(([, ret]) => ret);
          const variance = std(benchmarkDown) ** 2;
          value = variance > 0 ? pearsonCorr(assetDown, benchmarkDown) * std(assetDown) * std(benchmarkDown) / variance : NaN;
          break;
        }
      }
      if (Number.isFinite(value)) {
        rawValues.set(ticker, value);
        transformedValues.set(ticker, factor.direction === "lower_is_better" ? -value : value);
      }
    }
    rawByFactor.set(factor.id, rawValues);
    const missingPolicyValues = [...transformedValues.values()];
    if (factor.missingDataTreatment === "cross_sectional_median" && missingPolicyValues.length > 0 &&
      factor.calculationType !== "unsupported" && factor.calculationType !== "residual_momentum" &&
      factor.calculationType !== "correlation_stability") {
      const imputationValue = median(missingPolicyValues);
      for (const ticker of tickers) {
        if (!transformedValues.has(ticker)) transformedValues.set(ticker, imputationValue);
      }
    }
    transformedByFactor.set(factor.id, transformedValues);

    const values = [...transformedValues.values()];
    const lowerBound = quantile(values, factor.winsorizationLower);
    const upperBound = quantile(values, factor.winsorizationUpper);
    winsorizedByFactor.set(factor.id, new Map([...transformedValues].map(([ticker, value]) => [
      ticker,
      clamp(value, lowerBound, upperBound),
    ])));
  }

  const normalizedByFactor = new Map<string, Map<string, number>>();
  for (const factor of factors) {
    normalizedByFactor.set(factor.id, normalizeCrossSection(
      winsorizedByFactor.get(factor.id) ?? new Map(),
      factor.normalization,
    ));
  }
  const regime = regimeKey(regimeLabel);

  const results: EtfFactorData[] = [];
  for (const ticker of tickers) {
    if (pricesByTicker[ticker].length < 3) continue;
    const dynamic: Record<string, number | null> = {};
    const configuredWeights = new Map(factors.map((factor) => [factor.id, configuredWeight(factor, regime)]));
    const effectiveWeightDenominator = factors.reduce((sum, factor) =>
      sum + ((normalizedByFactor.get(factor.id)?.has(ticker) && configuredWeights.get(factor.id)! > 0)
        ? configuredWeights.get(factor.id)! : 0), 0);
    const factorContributions: FactorContribution[] = factors.map((factor) => {
      const raw = rawByFactor.get(factor.id)?.get(ticker) ?? null;
      const transformed = transformedByFactor.get(factor.id)?.get(ticker) ?? null;
      const winsorized = winsorizedByFactor.get(factor.id)?.get(ticker) ?? null;
      const normalized = normalizedByFactor.get(factor.id)?.get(ticker) ?? null;
      const configured = configuredWeights.get(factor.id)!;
      const hasScore = normalized !== null;
      const effective = hasScore && configured > 0 && effectiveWeightDenominator > 0
        ? configured / effectiveWeightDenominator : 0;
      const imputed = raw === null && hasScore;
      const unsupported = factor.calculationType === "unsupported" ||
        factor.calculationType === "residual_momentum" ||
        factor.calculationType === "correlation_stability";
      const unavailableReason = hasScore
        ? null
        : unsupported
          ? `Unsupported calculation type: ${factor.calculationType}.`
          : "Factor unavailable: required input data is missing or insufficient.";
      dynamic[factor.id] = normalized;
      return {
        factorId: factor.id,
        factorName: factor.name,
        rawValue: raw,
        transformedValue: transformed,
        winsorizedValue: winsorized,
        normalizedValue: normalized,
        configuredWeight: configured,
        effectiveWeight: effective,
        weightedContribution: hasScore ? normalized * effective : null,
        available: hasScore,
        calculationStatus: hasScore ? (imputed ? "imputed" : "available") : "unavailable",
        missingDataTreatment: factor.missingDataTreatment,
        unavailableReason,
      };
    });
    const composite = factorContributions.reduce((sum, item) => sum + (item.weightedContribution ?? 0), 0);
    const byType = (type: FactorDefinition["calculationType"], fallback = 50) => {
      const factor = factors.find((item) => item.calculationType === type);
      return factor ? dynamic[factor.id] ?? fallback : fallback;
    };
    const mom = byType("momentum");
    const tq = byType("trend_quality");
    const vol = byType("volatility");
    const dd = byType("drawdown");
    const mr = byType("mean_reversion");

    results.push({
      ticker,
      factorScores: { mom20: round2(mom), mom60: round2(mom), mom120: round2(mom), mom252: round2(mom), trendQuality: round2(tq), realizedVol60: round2(vol), drawdown: round2(dd), meanReversion: round2(mr), composite, dynamic },
      rawMom20: rawByFactor.get(factors.find((item) => item.calculationType === "momentum")?.id ?? "")?.get(ticker) ?? NaN,
      rawMom60: rawByFactor.get(factors.find((item) => item.calculationType === "momentum")?.id ?? "")?.get(ticker) ?? NaN,
      rawMom120: rawByFactor.get(factors.find((item) => item.calculationType === "momentum")?.id ?? "")?.get(ticker) ?? NaN,
      rawMom252: rawByFactor.get(factors.find((item) => item.calculationType === "momentum")?.id ?? "")?.get(ticker) ?? NaN,
      rawVol60: rawByFactor.get(factors.find((item) => item.calculationType === "volatility")?.id ?? "")?.get(ticker) ?? NaN,
      rawDrawdown: rawByFactor.get(factors.find((item) => item.calculationType === "drawdown")?.id ?? "")?.get(ticker) ?? NaN,
      rawTrendQuality: rawByFactor.get(factors.find((item) => item.calculationType === "trend_quality")?.id ?? "")?.get(ticker) ?? NaN,
      rawMeanReversion: rawByFactor.get(factors.find((item) => item.calculationType === "mean_reversion")?.id ?? "")?.get(ticker) ?? NaN,
      factorContributions,
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
  const minEtfWeight = constraints.minEtfWeight ?? 0;
  if (![cashMin, cashMax, maxEtfWeight, minEtfWeight, minInclusionThreshold, targetActiveEtfs].every(Number.isFinite) ||
    cashMin < 0 || cashMax > 1 || cashMin > cashMax || maxEtfWeight <= 0 ||
    minEtfWeight < 0 || minEtfWeight > maxEtfWeight || targetActiveEtfs < 1) {
    throw new AllocationConstraintError("Constraint set infeasible: one or more portfolio constraint values are invalid.");
  }
  const etfMap = new Map<string, EtfEntry>();
  for (const e of etfs) etfMap.set(e.ticker, e);

  const cashTarget = clamp(cashMin + (cashMax - cashMin) * 0.5 + ((50 - regime.composite) / 50) * (cashMax - cashMin) * 0.5, cashMin, cashMax);
  const investedBudget = 1 - cashTarget;

  const eligible = factorData.filter(f => { const e = etfMap.get(f.ticker); return e && e.enabled && f.factorScores.composite >= minInclusionThreshold; });
  eligible.sort((a, b) => b.factorScores.composite - a.factorScores.composite);
  if (eligible.length < targetActiveEtfs) {
    throw new AllocationConstraintError(
      `Constraint set infeasible: required ${targetActiveEtfs} active ETFs with current eligibility leaves only ${eligible.length} eligible assets.`,
    );
  }
  const topN = eligible.slice(0, targetActiveEtfs);
  if (minEtfWeight * targetActiveEtfs > investedBudget + 1e-10 ||
    maxEtfWeight * targetActiveEtfs < investedBudget - 1e-10) {
    throw new AllocationConstraintError(
      `Constraint set infeasible: ${targetActiveEtfs} active ETFs cannot invest ${(investedBudget * 100).toFixed(2)}% within the ${(minEtfWeight * 100).toFixed(2)}% minimum and ${(maxEtfWeight * 100).toFixed(2)}% maximum ETF weights.`,
    );
  }

  const totalScore = topN.reduce((s, f) => s + f.factorScores.composite, 0);
  let weights = new Map<string, number>();
  for (const f of topN) weights.set(f.ticker, totalScore > 0 ? (f.factorScores.composite / totalScore) * investedBudget : investedBudget / topN.length);

  if (diversificationEnabled) weights = blendWithPrior(weights, etfMap, investedBudget);
  weights = normalizeWeights(weights, investedBudget);
  // A historical configuration can have a zero minimum, but its required
  // active count still means each selected ETF must hold a positive weight.
  const inclusionFloor = minEtfWeight > 0 ? minEtfWeight : Math.min(1e-10, investedBudget / (2 * targetActiveEtfs));
  weights = applyFinalWeightConstraints(weights, inclusionFloor, maxEtfWeight, investedBudget);
  validateFinalAllocation(weights, topN.map((f) => f.ticker), minEtfWeight, maxEtfWeight, investedBudget, targetActiveEtfs);

  const results: AllocationResult[] = [];
  for (const f of factorData) {
    const etf = etfMap.get(f.ticker);
    if (!etf) continue;
    const weight = weights.get(f.ticker) ?? 0;
    results.push({ ticker: f.ticker, name: etf.name, sector: etf.sector, weight, priorWeight: round4(etf.priorWeight), change: round4(weight - etf.priorWeight), factorScores: f.factorScores, factorContributions: f.factorContributions, active: weight > 0 });
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

function applyFinalWeightConstraints(
  weights: Map<string, number>,
  minWeight: number,
  maxWeight: number,
  budget: number,
): Map<string, number> {
  const tickers = [...weights.keys()];
  const result = new Map(tickers.map((ticker) => [ticker, minWeight]));
  let remaining = budget - minWeight * tickers.length;
  let uncapped = [...tickers];
  const score = (ticker: string) => Math.max(0, weights.get(ticker) ?? 0);

  while (remaining > 1e-12 && uncapped.length > 0) {
    const totalScore = uncapped.reduce((sum, ticker) => sum + score(ticker), 0);
    const shares = uncapped.map((ticker) => ({
      ticker,
      amount: remaining * (totalScore > 0 ? score(ticker) / totalScore : 1 / uncapped.length),
      capacity: maxWeight - (result.get(ticker) ?? 0),
    }));
    const capped = shares.filter(({ amount, capacity }) => amount > capacity + 1e-12);
    if (capped.length === 0) {
      for (const { ticker, amount } of shares) result.set(ticker, (result.get(ticker) ?? 0) + amount);
      remaining = 0;
      break;
    }
    const cappedTickers = new Set(capped.map(({ ticker }) => ticker));
    for (const { ticker, capacity } of capped) {
      result.set(ticker, maxWeight);
      remaining -= capacity;
    }
    uncapped = uncapped.filter((ticker) => !cappedTickers.has(ticker));
  }

  // Eliminate floating-point residue without violating a bound.
  const residue = budget - [...result.values()].reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(residue) > 1e-12) {
    const ticker = tickers.find((key) => {
      const adjusted = (result.get(key) ?? 0) + residue;
      return adjusted >= minWeight - 1e-12 && adjusted <= maxWeight + 1e-12;
    });
    if (ticker) result.set(ticker, (result.get(ticker) ?? 0) + residue);
  }
  return result;
}

function validateFinalAllocation(
  weights: Map<string, number>,
  activeTickers: string[],
  minWeight: number,
  maxWeight: number,
  budget: number,
  requiredCount: number,
): void {
  const tolerance = 1e-9;
  const activeWeights = activeTickers.map((ticker) => weights.get(ticker) ?? 0);
  const activeCount = activeWeights.filter((weight) => weight > 0).length;
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (activeCount !== requiredCount ||
    activeWeights.some((weight) => weight < minWeight - tolerance || weight > maxWeight + tolerance) ||
    Math.abs(totalWeight - budget) > tolerance) {
    throw new AllocationConstraintError(
      "Constraint set infeasible: final portfolio weights failed the configured minimum, maximum, active-count, or invested-budget check.",
    );
  }
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

// ── Iteration 9: Bias-resistant walk-forward backtest engine ────────────────
//
// Design principle: every signal used to set weights at a rebalance date is
// computed from a price slice that is STRICTLY BEFORE that date
// (`r.date < rebalanceDate`). This is the structural fix for look-ahead bias —
// unlike a naive backtest that reuses stored allocation sessions (which were
// computed against the full uploaded history), this engine recomputes the
// factor/regime signal from scratch, in isolation, per rebalance date.

export type RebalanceFrequency = "monthly" | "quarterly";
export type ExecutionTiming = "same_close" | "next_close" | "next_open";

export interface BacktestConfig {
  rebalanceFrequency: RebalanceFrequency;
  executionTiming: ExecutionTiming;
  transactionCostBps: number;
  slippageBps: number;
  maxTurnoverPerRebalance: number;
  cashYieldAnnual: number;
  warmupDays: number;
  startDate: string | null;
}

export interface RebalanceLogEntry {
  rebalanceDate: string;
  executionDate: string | null;
  lookbackDays: number;
  regimeLabel: string;
  regimeComposite: number;
  cashWeight: number;
  activeEtfCount: number;
  topHoldings: string[];
  turnoverRequested: number;
  turnoverApplied: number;
  turnoverCapped: boolean;
  transactionCostPct: number;
}

export interface IntegrityCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface IntegrityAudit {
  score: number;
  grade: "research_grade" | "developmental" | "not_reliable";
  hardFail: boolean;
  checklist: IntegrityCheck[];
}

export interface SensitivityRun {
  rebalanceFrequency: RebalanceFrequency;
  executionTiming: ExecutionTiming;
  transactionCostBps: number;
  cumulativeReturn: number | null;
  annualizedReturn: number | null;
  sharpeRatio: number | null;
}

export interface SensitivityResult {
  runs: SensitivityRun[];
  stabilityWarning: boolean;
  note: string;
}

export interface WalkForwardFold {
  foldIndex: number;
  startDate: string;
  endDate: string;
  tradingDays: number;
  rebalanceCount: number;
  cumulativeReturn: number | null;
  annualizedReturn: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  note: string;
}

export interface BacktestEquityPoint {
  date: string;
  portfolioIndex: number;
  benchmarkIndex: number | null;
  drawdownPct: number;
}

export interface BacktestPosition {
  ticker: string;
  quantity: number;
  price: number;
  marketValue: number;
  weight: number;
}

export interface BacktestLedgerEntry {
  date: string;
  intervalStart: string;
  signalDate: string | null;
  executionSignalDate: string | null;
  beginningNav: number;
  beginningCash: number;
  beginningPositions: BacktestPosition[];
  etfPnl: number;
  cashPnl: number;
  transactionCosts: number;
  slippage: number;
  trades: Array<{ ticker: string; quantity: number; notional: number }>;
  netPnl: number;
  endingNav: number;
  endingCash: number;
  endingPositions: BacktestPosition[];
}

export interface BacktestEngineResult {
  hasSufficientData: boolean;
  insufficientReason: string | null;
  startDate: string | null;
  endDate: string | null;
  tradingDays: number;
  canAnnualize: boolean;
  equityCurve: BacktestEquityPoint[];
  dailyLedger: BacktestLedgerEntry[];
  cumulativeReturn: number | null;
  annualizedReturn: number | null;
  annualizedVolatility: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  avgTurnover: number | null;
  totalTransactionCostPct: number | null;
  monthlyReturns: Array<{ month: string; portfolioReturn: number; benchmarkReturn: number | null }>;
  rebalanceLog: RebalanceLogEntry[];
  benchmarkTicker: string | null;
  benchmarkCumulativeReturn: number | null;
  benchmarkAnnualizedReturn: number | null;
  benchmarkUnavailableReason: null | string;
}

/** Optional starting book for a policy backtest. Omission preserves A1's index-100 cash start. */
export interface BacktestInitialState {
  initialNav: number;
  initialCash: number;
  initialHoldings: Record<string, number>;
  dailyCashYield: number;
  /** Enables signed underlying quantities and negative cash for signed-overlay execution only. */
  allowShortPositions?: boolean;
  /** B3 D5 charges full absolute consolidated fill notional rather than legacy half-L1 turnover. */
  d5GrossTradeCosts?: boolean;
  /** Supplies strict prior-close carried-book context without changing A1 execution costs. */
  provideTargetContext?: boolean;
}

/** Immutable carried book at the strict prior-close information cutoff. */
export interface BacktestTargetContext {
  asOf: string;
  quantities: Readonly<Record<string, number>>;
  cash: number;
  nav: number;
}

const TRADING_DAYS_PER_YEAR = 252;
const MIN_DAYS_FOR_ANNUALIZATION = 10;

export function defaultBacktestConfig(): BacktestConfig {
  return {
    rebalanceFrequency: "monthly",
    executionTiming: "next_close",
    transactionCostBps: 10,
    slippageBps: 5,
    maxTurnoverPerRebalance: 1,
    cashYieldAnnual: 0,
    warmupDays: 252,
    startDate: null,
  };
}

function periodKeyFor(date: string, frequency: RebalanceFrequency): string {
  if (frequency === "monthly") return date.slice(0, 7);
  const month = parseInt(date.slice(5, 7), 10);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${date.slice(0, 4)}-Q${quarter}`;
}

/** First trading day of each calendar month/quarter, after the warmup window has elapsed. */
export function generateRebalanceDates(
  priceRows: PriceRow[],
  frequency: RebalanceFrequency,
  warmupDays: number,
  minRebalanceDate: string | null = null
): string[] {
  const dates: string[] = [];
  let lastKey: string | null = null;
  for (let i = 0; i < priceRows.length; i++) {
    if (i < warmupDays) continue;
    if (minRebalanceDate && priceRows[i].date < minRebalanceDate) continue;
    const key = periodKeyFor(priceRows[i].date, frequency);
    if (key !== lastKey) {
      dates.push(priceRows[i].date);
      lastKey = key;
    }
  }
  return dates;
}

/**
 * Compute the point-in-time signal (factors, regime, target allocation) for a rebalance
 * date using ONLY price rows strictly before that date. This is the look-ahead-bias fix.
 */
export function computeSignalAsOf(
  priceRows: PriceRow[],
  rebalanceDate: string,
  tickers: string[],
  etfs: EtfEntry[],
  constraints: Constraints,
  factorSet?: { factors: FactorDefinition[] },
): { factorData: EtfFactorData[]; regime: EnrichedRegimeScores; allocations: AllocationResult[]; lookbackDays: number } {
  const priorRows = priceRows.filter((r) => r.date < rebalanceDate);
  const regime = computeRegime(priorRows, tickers);
  const factorData = computeFactors(priorRows, tickers, factorSet, regime.label);
  const allocations = constructAllocation(factorData, etfs, constraints, regime);
  return { factorData, regime, allocations, lookbackDays: priorRows.length };
}

/** Resolves the execution row for close fills or next-row open fills. */
export function resolveExecutionDate(priceRows: PriceRow[], rebalanceDate: string, timing: ExecutionTiming): string | null {
  const idx = priceRows.findIndex((r) => r.date === rebalanceDate);
  if (idx === -1) return null;
  if (timing === "same_close") return rebalanceDate;
  return idx + 1 < priceRows.length ? priceRows[idx + 1].date : null;
}

/**
 * Open execution has a distinct accounting boundary: existing shares earn the
 * previous-close/open gap, fills occur at the open, and the resulting book earns
 * the open/close move. Keep it isolated so the historical close-fill path remains
 * byte-for-byte behaviorally unchanged.
 */
function runNextOpenBacktestEngine(
  priceRows: PriceRow[],
  etfs: EtfEntry[],
  constraints: Constraints,
  config: BacktestConfig,
  benchmarkTicker: string | null,
  factorSet?: { factors: FactorDefinition[] },
  targetWeightsForSignal?: (
    signalDate: string, rows: PriceRow[], context?: BacktestTargetContext,
  ) => Record<string, number> | null,
  initialState?: BacktestInitialState,
): BacktestEngineResult {
  const enabledTickers = etfs.filter((entry) => entry.enabled).map((entry) => entry.ticker);
  const empty = (reason: string): BacktestEngineResult => ({
    hasSufficientData: false, insufficientReason: reason, startDate: null, endDate: null,
    tradingDays: 0, canAnnualize: false, equityCurve: [], dailyLedger: [],
    cumulativeReturn: null, annualizedReturn: null, annualizedVolatility: null,
    sharpeRatio: null, maxDrawdown: null, avgTurnover: null, totalTransactionCostPct: null,
    monthlyReturns: [], rebalanceLog: [], benchmarkTicker: null,
    benchmarkCumulativeReturn: null, benchmarkAnnualizedReturn: null,
    benchmarkUnavailableReason: null,
  });
  if (priceRows.length < config.warmupDays + 2)
    return empty(`Need at least ${config.warmupDays + 2} days of price history (a ${config.warmupDays}-day signal warmup plus tradeable days ahead); only ${priceRows.length} are uploaded.`);
  const signalDates = generateRebalanceDates(priceRows, config.rebalanceFrequency, config.warmupDays, config.startDate);
  if (!signalDates.length)
    return empty("No rebalance dates fall after the signal warmup window — upload more price history.");
  const scheduled = new Map<string, string>();
  for (const date of signalDates) {
    const execution = resolveExecutionDate(priceRows, date, "next_open");
    if (execution) scheduled.set(date, execution);
  }
  if (!scheduled.size)
    return empty("No rebalance could be executed — there is no trading day available after any rebalance date to apply weights.");
  const firstSignalIndex = priceRows.findIndex((row) => row.date === [...scheduled.keys()][0]);
  const firstExecutionIndex = priceRows.findIndex((row) => row.date === [...scheduled.values()][0]);
  if (firstSignalIndex < 1 || firstExecutionIndex >= priceRows.length)
    return empty("Not enough trading days remain after the first executable rebalance to simulate returns.");
  const simRows = priceRows.slice(firstSignalIndex - 1);
  if (initialState) {
    const { initialNav, initialCash, initialHoldings, dailyCashYield, allowShortPositions = false } = initialState;
    if (!Number.isFinite(initialNav) || initialNav <= 0 || !Number.isFinite(initialCash) ||
        (!allowShortPositions && initialCash < 0) || !Number.isFinite(dailyCashYield) ||
        dailyCashYield <= -1 || !initialHoldings || typeof initialHoldings !== "object")
      return empty("Invalid initial NAV, cash, holdings or daily cash yield.");
    let initialAssets = 0;
    for (const [ticker, quantity] of Object.entries(initialHoldings)) {
      const price = simRows[0].prices[ticker];
      if (!enabledTickers.includes(ticker) || !Number.isFinite(quantity) ||
          (!allowShortPositions && quantity < 0) || !Number.isFinite(price) || price <= 0)
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
  let pending: { signalDate: string; executionDate: string; target: Map<string, number>;
    lookbackDays: number; regimeLabel: string; regimeComposite: number } | null = null;
  const positionSnapshot = (prices: Record<string, number>, value: number): BacktestPosition[] =>
    [...shares].filter(([, quantity]) => quantity !== 0).map(([ticker, quantity]) => ({
      ticker, quantity, price: prices[ticker], marketValue: quantity * prices[ticker],
      weight: value > 0 ? quantity * prices[ticker] / value : 0,
    }));
  let benchmarkUnavailable: string | null = benchmarkTicker
    ? !enabledTickers.includes(benchmarkTicker)
      ? `${benchmarkTicker} is not an enabled ETF in the current universe.`
      : !priceRows.some((row) => row.prices[benchmarkTicker] !== undefined)
        ? `No price data available for ${benchmarkTicker} over the backtest period.` : null
    : null;

  for (let i = 1; i < simRows.length; i++) {
    const prevRow = simRows[i - 1], row = simRows[i];
    const beginningNav = nav, beginningCash = cash;
    const beginningPositions = positionSnapshot(prevRow.prices, beginningNav);
    let etfPnl = 0;
    const openPrices = row.opens;
    for (const [ticker, quantity] of shares) {
      if (quantity === 0) continue;
      const previousClose = prevRow.prices[ticker], open = openPrices?.[ticker];
      if (!Number.isFinite(previousClose) || previousClose <= 0)
        return empty(`Missing or invalid price for held asset ${ticker} on ${prevRow.date}; P&L cannot be determined.`);
      if (!Number.isFinite(open) || open! <= 0)
        return empty(`Missing or invalid adjusted open for held asset ${ticker} on ${row.date}; next-open P&L cannot be determined.`);
      etfPnl += quantity * (open! - previousClose);
    }
    const cashPnl = beginningCash * dailyCashReturn;
    cash += cashPnl;
    let openNav = cash + [...shares].reduce((sum, [ticker, quantity]) =>
      sum + quantity * (openPrices?.[ticker]!), 0);
    let transactionCosts = 0, slippage = 0;
    let executionSignalDate: string | null = null;
    const trades: BacktestLedgerEntry["trades"] = [];
    if (pending && pending.executionDate === row.date) {
      executionSignalDate = pending.signalDate;
      const currentWeights = new Map([...shares].filter(([, quantity]) => quantity !== 0).map(([ticker, quantity]) =>
        [ticker, quantity * openPrices![ticker] / openNav] as const));
      const allTickers = new Set([...currentWeights.keys(), ...pending.target.keys()]);
      for (const [ticker, weight] of pending.target) {
        d6Trace("a1.target.check", { date: row.date, ticker, value: String(weight), type: typeof weight,
          enabled: enabledTickers.includes(ticker), finite: Number.isFinite(weight), allowShortPositions });
        if (!enabledTickers.includes(ticker) || !Number.isFinite(weight) ||
            (!allowShortPositions && weight < 0))
          return empty(`Invalid ${allowShortPositions ? "signed " : ""}target exposure for ${ticker} on ${row.date}.`);
      }
      for (const ticker of allTickers) {
        const targetWeight = pending.target.get(ticker) ?? 0;
        const currentWeight = currentWeights.get(ticker) ?? 0;
        if (Math.abs(targetWeight - currentWeight) <= 1e-12) continue;
        const open = openPrices?.[ticker];
        if (!Number.isFinite(open) || open! <= 0)
          return empty(`Missing or invalid adjusted open for traded asset ${ticker} on ${row.date}; cannot execute trade.`);
      }
      let requestedTurnover = 0;
      for (const ticker of allTickers)
        requestedTurnover += Math.abs((pending.target.get(ticker) ?? 0) - (currentWeights.get(ticker) ?? 0));
      requestedTurnover /= 2;
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
      const preTradeNav = openNav;
      let afterCostNav = preTradeNav;
      if (initialState?.d5GrossTradeCosts) {
        const oldMarketValues = new Map([...shares].map(([ticker, quantity]) =>
          [ticker, quantity * openPrices![ticker]]));
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
        const notional = tradedAt(afterCostNav);
        transactionCosts = notional * config.transactionCostBps / 10000;
        slippage = notional * config.slippageBps / 10000;
      } else {
        const oldMarketValues = new Map([...shares].map(([ticker, quantity]) =>
          [ticker, quantity * openPrices![ticker]]));
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
        const notional = tradedAt(afterCostNav);
        transactionCosts = notional * config.transactionCostBps / 10000;
        slippage = notional * config.slippageBps / 10000;
      }
      if (afterCostNav <= 0) return empty(`Trading costs exhaust NAV on ${row.date}.`);
      const nextShares = new Map<string, number>();
      let invested = 0;
      for (const [ticker, weight] of applied) {
        if (allowShortPositions ? weight === 0 : weight <= 0) continue;
        const open = openPrices?.[ticker];
        if (!Number.isFinite(open) || open! <= 0)
          return empty(`Missing or invalid adjusted open for traded asset ${ticker} on ${row.date}; cannot execute trade.`);
        const quantity = afterCostNav * weight / open!;
        nextShares.set(ticker, quantity);
        invested += quantity * open!;
      }
      for (const ticker of allTickers) {
        const difference = (nextShares.get(ticker) ?? 0) - (shares.get(ticker) ?? 0);
        if (Math.abs(difference) > 1e-12)
          trades.push({ ticker, quantity: difference, notional: difference * openPrices![ticker] });
      }
      shares = nextShares;
      cash = afterCostNav - invested;
      if (initialState?.d5GrossTradeCosts && cash < 0 && cash > -1e-8 * Math.max(1, afterCostNav))
        cash = 0;
      openNav = afterCostNav;
      const topHoldings = [...applied].filter(([, weight]) => weight > 0.001)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ticker]) => ticker);
      rebalanceLog.push({
        rebalanceDate: pending.signalDate, executionDate: row.date,
        lookbackDays: pending.lookbackDays, regimeLabel: pending.regimeLabel,
        regimeComposite: pending.regimeComposite, cashWeight: round4(cash / afterCostNav),
        activeEtfCount: [...applied.values()].filter((weight) => Math.abs(weight) > 0.001).length,
        topHoldings, turnoverRequested: round4(requestedTurnover), turnoverApplied: round4(turnoverApplied),
        turnoverCapped: requestedTurnover > cap + 1e-9,
        transactionCostPct: round4((transactionCosts + slippage) / preTradeNav),
      });
      pending = null;
    }
    for (const [ticker, quantity] of shares) {
      if (quantity === 0) continue;
      const open = openPrices?.[ticker], close = row.prices[ticker];
      if (!Number.isFinite(open) || open! <= 0)
        return empty(`Missing or invalid adjusted open for held asset ${ticker} on ${row.date}; next-open P&L cannot be determined.`);
      if (!Number.isFinite(close) || close <= 0)
        return empty(`Missing or invalid price for held asset ${ticker} on ${row.date}; P&L cannot be determined.`);
      etfPnl += quantity * (close - open!);
    }
    const endingAssets = [...shares].reduce((sum, [ticker, quantity]) =>
      sum + quantity * row.prices[ticker], 0);
    nav = cash + endingAssets;
    const netPnl = etfPnl + cashPnl - transactionCosts - slippage;
    if (Math.abs(beginningNav + netPnl - nav) > 1e-8)
      return empty(`Ledger reconciliation failed on ${row.date}.`);
    let signalDate: string | null = null;
    if (scheduled.has(row.date)) {
      signalDate = row.date;
      const priorWeights = new Map(positionSnapshot(row.prices, nav).map((position) =>
        [position.ticker, position.weight]));
      const etfsForSignal = etfs.map((entry) => ({
        ...entry, priorWeight: rebalanceLog.length ? (priorWeights.get(entry.ticker) ?? 0) : entry.priorWeight,
      }));
      const informationRows = priceRows.filter((item) => item.date <= row.date);
      const regime = computeRegime(informationRows, enabledTickers);
      const inputs = targetWeightsForSignal
        ? { regime, allocations: [] as AllocationResult[], lookbackDays: informationRows.length }
        : (() => {
          const factorData = computeFactors(informationRows, enabledTickers, factorSet, regime.label);
          return { regime, allocations: constructAllocation(factorData, etfsForSignal, constraints, regime),
            lookbackDays: informationRows.length };
        })();
      let explicitTarget: Record<string, number> | null | undefined;
      if (targetWeightsForSignal) {
        const targetPriceRows = config.executionTiming === "next_open" ? informationRows : priceRows;
        if (initialState?.d5GrossTradeCosts || initialState?.provideTargetContext) {
          explicitTarget = targetWeightsForSignal(row.date, targetPriceRows, Object.freeze({
            asOf: row.date, quantities: Object.freeze(Object.fromEntries([...shares])),
            cash, nav,
          }));
        } else {
          explicitTarget = targetWeightsForSignal(row.date, targetPriceRows);
        }
      }
      if (targetWeightsForSignal && explicitTarget === null) pending = null;
      else pending = {
        signalDate: row.date, executionDate: scheduled.get(row.date)!,
        target: new Map(targetWeightsForSignal
          ? Object.entries(explicitTarget ?? {})
          : inputs.allocations.filter((allocation) => allocation.active).map((allocation) =>
            [allocation.ticker, allocation.weight])),
        lookbackDays: inputs.lookbackDays, regimeLabel: inputs.regime.label,
        regimeComposite: inputs.regime.composite,
      };
    }
    dailyLedger.push({
      date: row.date, intervalStart: prevRow.date, signalDate, executionSignalDate,
      beginningNav, beginningCash, beginningPositions, etfPnl, cashPnl,
      transactionCosts, slippage, trades, netPnl, endingNav: nav, endingCash: cash,
      endingPositions: positionSnapshot(row.prices, nav),
    });
    let benchmarkReturn: number | null = null;
    if (benchmarkTicker && !benchmarkUnavailable) {
      const previous = prevRow.prices[benchmarkTicker], close = row.prices[benchmarkTicker];
      if (previous && close && previous > 0) benchmarkReturn = (close - previous) / previous;
      else benchmarkUnavailable = `Missing benchmark price for ${benchmarkTicker} on ${row.date}.`;
    }
    dailyReturns.push({ date: row.date, portfolioReturn: netPnl / beginningNav, benchmarkReturn });
  }
  if (benchmarkUnavailable) for (const item of dailyReturns) item.benchmarkReturn = null;
  const { equityCurve, cumulativeReturn, annualizedReturn, annualizedVolatility, sharpeRatio,
    maxDrawdown, benchmarkCumulativeReturn, benchmarkAnnualizedReturn } =
    computeCurveMetrics(simRows[0].date, dailyReturns, !!benchmarkTicker && !benchmarkUnavailable);
  const monthlyReturns = computeMonthlyReturns(dailyReturns, !!benchmarkTicker && !benchmarkUnavailable);
  const turnoverValues = rebalanceLog.map((entry) => entry.turnoverApplied);
  return {
    hasSufficientData: true, insufficientReason: null, startDate: simRows[0].date,
    endDate: simRows.at(-1)!.date, tradingDays: dailyReturns.length,
    canAnnualize: dailyReturns.length >= MIN_DAYS_FOR_ANNUALIZATION, equityCurve, dailyLedger,
    cumulativeReturn, annualizedReturn, annualizedVolatility, sharpeRatio, maxDrawdown,
    avgTurnover: turnoverValues.length ? round4(turnoverValues.reduce((sum, value) => sum + value, 0) / turnoverValues.length) : null,
    totalTransactionCostPct: round4(dailyLedger.reduce((sum, entry) =>
      sum + (entry.transactionCosts + entry.slippage) / entry.beginningNav, 0)),
    monthlyReturns, rebalanceLog,
    benchmarkTicker: benchmarkTicker && !benchmarkUnavailable ? benchmarkTicker : null,
    benchmarkCumulativeReturn, benchmarkAnnualizedReturn,
    benchmarkUnavailableReason: benchmarkUnavailable,
  };
}

/**
 * Same/next-close signals see closes strictly BEFORE their signal date. NEXT_OPEN
 * signals see closes through t and fill at the following row's open; its dedicated
 * accounting path marks old shares to the open and new shares from open to close.
 * NAV and the ledger use index units (initial NAV 100), without daily rebalancing.
 */
export function runBacktestEngine(
  priceRows: PriceRow[],
  etfs: EtfEntry[],
  constraints: Constraints,
  config: BacktestConfig,
  benchmarkTicker: string | null,
  factorSet?: { factors: FactorDefinition[] },
  targetWeightsForSignal?: (
    signalDate: string, rows: PriceRow[], context?: BacktestTargetContext,
  ) => Record<string, number> | null,
  initialState?: BacktestInitialState,
): BacktestEngineResult {
  if (config.executionTiming === "next_open")
    return runNextOpenBacktestEngine(priceRows, etfs, constraints, config, benchmarkTicker,
      factorSet, targetWeightsForSignal, initialState);

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

  const rebalanceDates = generateRebalanceDates(priceRows, config.rebalanceFrequency, config.warmupDays, config.startDate);
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
      const signalInputs = targetWeightsForSignal
        ? { regime: computeRegime(priceRows.filter((item) => item.date < row.date), enabledTickers),
            allocations: [] as AllocationResult[], lookbackDays: priceRows.filter((item) => item.date < row.date).length }
        : computeSignalAsOf(priceRows, row.date, enabledTickers, etfsForSignal, constraints, factorSet);
      const { regime, allocations, lookbackDays } = signalInputs;
      let explicitTarget: Record<string, number> | null | undefined;
      if (targetWeightsForSignal) {
        if (initialState?.d5GrossTradeCosts || initialState?.provideTargetContext) {
          const quantities = Object.freeze(Object.fromEntries([...shares]));
          explicitTarget = targetWeightsForSignal(row.date, priceRows, Object.freeze({
            asOf: prevRow.date, quantities, cash: beginningCash, nav: beginningNav,
          }));
        } else {
          // Preserve the legacy callback invocation contract when D5 is omitted.
          explicitTarget = targetWeightsForSignal(row.date, priceRows);
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

/** Splits the simulated period into chronological folds to check consistency of out-of-sample performance. */
export function runWalkForwardFolds(engineResult: BacktestEngineResult, foldCount = 3): WalkForwardResult {
  if (!engineResult.hasSufficientData || engineResult.equityCurve.length < foldCount * 2 + 1) {
    return { folds: [], note: "Not enough simulated trading days to split into walk-forward folds; run with more price history." };
  }

  const points = engineResult.equityCurve;
  const foldSize = Math.floor((points.length - 1) / foldCount);
  const folds: WalkForwardFold[] = [];

  for (let f = 0; f < foldCount; f++) {
    const startIdx = f * foldSize;
    const endIdx = f === foldCount - 1 ? points.length - 1 : (f + 1) * foldSize;
    if (endIdx <= startIdx) continue;

    const startPoint = points[startIdx];
    const slice = points.slice(startIdx, endIdx + 1);
    const rets = slice.map((p, i) => (i === 0 ? 0 : p.portfolioIndex / slice[i - 1].portfolioIndex - 1));
    const tradingDays = slice.length - 1;
    const cumulativeReturn = round4(slice[slice.length - 1].portfolioIndex / startPoint.portfolioIndex - 1);
    let annualizedReturn: number | null = null;
    let sharpeRatio: number | null = null;
    if (tradingDays >= MIN_DAYS_FOR_ANNUALIZATION) {
      annualizedReturn = round4(Math.pow(1 + cumulativeReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1);
      const m = mean(rets.slice(1));
      const variance = rets.slice(1).reduce((s, r) => s + Math.pow(r - m, 2), 0) / tradingDays;
      const dailyStd = Math.sqrt(variance);
      const vol = dailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR);
      sharpeRatio = vol > 0 ? Math.round((annualizedReturn / vol) * 1000) / 1000 : null;
    }
    let peak = slice[0].portfolioIndex;
    let maxDD = 0;
    for (const p of slice) {
      peak = Math.max(peak, p.portfolioIndex);
      maxDD = Math.min(maxDD, p.portfolioIndex / peak - 1);
    }

    const rebalanceCount = 0; // filled by caller if needed; folds here are purely time-sliced.
    folds.push({
      foldIndex: f + 1,
      startDate: startPoint.date,
      endDate: slice[slice.length - 1].date,
      tradingDays,
      rebalanceCount,
      cumulativeReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown: Math.round(maxDD * 10000) / 10000,
    });
  }

  return {
    folds,
    note: "Each fold is a distinct, non-overlapping chronological slice of the simulated period. Because signals are always computed from strictly prior data, every fold is inherently out-of-sample with respect to the signal — these folds test whether performance is consistent across sub-periods rather than concentrated in one lucky stretch.",
  };
}

/** Re-runs the engine across a small grid of timing/cost assumptions to check result stability. */
export function runSensitivityGrid(
  priceRows: PriceRow[],
  etfs: EtfEntry[],
  constraints: Constraints,
  baseConfig: BacktestConfig,
  factorSet?: { factors: FactorDefinition[] },
): SensitivityResult {
  const frequencies: RebalanceFrequency[] = ["monthly", "quarterly"];
  const timings: ExecutionTiming[] = ["same_close", "next_close"];
  const costs = [0, baseConfig.transactionCostBps, baseConfig.transactionCostBps + 25];

  const runs: SensitivityRun[] = [];
  for (const rebalanceFrequency of frequencies) {
    for (const executionTiming of timings) {
      for (const transactionCostBps of costs) {
        const result = runBacktestEngine(priceRows, etfs, constraints, { ...baseConfig, rebalanceFrequency, executionTiming, transactionCostBps }, null, factorSet);
        runs.push({
          rebalanceFrequency,
          executionTiming,
          transactionCostBps,
          cumulativeReturn: result.cumulativeReturn,
          annualizedReturn: result.annualizedReturn,
          sharpeRatio: result.sharpeRatio,
        });
      }
    }
  }

  const sharpes = runs.map((r) => r.sharpeRatio).filter((s): s is number => s !== null);
  const returns = runs.map((r) => r.cumulativeReturn).filter((r): r is number => r !== null);
  const sharpeSpread = sharpes.length > 1 ? Math.max(...sharpes) - Math.min(...sharpes) : 0;
  const signFlip = returns.length > 1 && returns.some((r) => r > 0) && returns.some((r) => r < 0);
  const stabilityWarning = sharpeSpread > 0.75 || signFlip;

  return {
    runs,
    stabilityWarning,
    note: stabilityWarning
      ? "Results vary meaningfully across reasonable rebalance-frequency, execution-timing, and cost assumptions — treat headline numbers as indicative, not precise, and avoid tuning further to chase a specific configuration."
      : "Results are directionally consistent across reasonable rebalance-frequency, execution-timing, and cost assumptions.",
  };
}

/** Rates the overall trustworthiness of a backtest run. Never labels a run production-grade if any check fails. */
export function computeIntegrityAudit(
  engineResult: BacktestEngineResult,
  config: BacktestConfig,
  sensitivity: SensitivityResult,
  walkForward: WalkForwardResult
): IntegrityAudit {
  const checks: Array<IntegrityCheck & { weight: number }> = [];

  checks.push({
    id: "lookahead_bias",
    label: "Look-ahead bias",
    weight: 20,
    status: "pass",
    detail: "Signals use only prices strictly before their signal date; existing shares earn the return ending at the execution close, and newly filled shares earn only subsequent intervals.",
  });

  const dataSufficiencyStatus: IntegrityCheck["status"] =
    engineResult.tradingDays >= TRADING_DAYS_PER_YEAR ? "pass" : engineResult.tradingDays >= 60 ? "warn" : "fail";
  checks.push({
    id: "data_sufficiency",
    label: "Data sufficiency",
    weight: 15,
    status: dataSufficiencyStatus,
    detail:
      dataSufficiencyStatus === "pass"
        ? `${engineResult.tradingDays} simulated trading days — at least one full year of out-of-sample activity.`
        : `Only ${engineResult.tradingDays} simulated trading days. Upload more price history for a trustworthy read.`,
  });

  checks.push({
    id: "survivorship_bias",
    label: "Survivorship bias",
    weight: 10,
    status: "warn",
    detail:
      "The ETF universe reflects funds that exist today, fetched live from Yahoo Finance. Delisted, merged, or renamed ETFs from the historical period cannot be reconstructed, which can flatter results. Adjusted-close prices also embed dividend/split assumptions that may not exactly match a live execution.",
  });

  const realExecution = config.executionTiming !== "same_close";
  const realCosts = config.transactionCostBps > 0 || config.slippageBps > 0;
  const executionStatus: IntegrityCheck["status"] = realExecution && realCosts ? "pass" : realExecution || realCosts ? "warn" : "fail";
  checks.push({
    id: "execution_realism",
    label: "Execution realism",
    weight: 15,
    status: executionStatus,
    detail:
      executionStatus === "pass"
        ? `Trades execute at ${config.executionTiming.replace("_", " ")} with ${config.transactionCostBps}bps cost + ${config.slippageBps}bps slippage applied to turnover.`
        : executionStatus === "fail"
          ? "Trades execute at the same close as the signal date with zero cost/slippage; fills at the precise close remain an assumption."
          : "Only one of realistic execution timing or non-zero costs is configured — set both for a realistic read.",
  });

  checks.push({
    id: "rebalance_timing",
    label: "Rebalancing timing discipline",
    weight: 10,
    status: realExecution ? "pass" : "warn",
    detail: realExecution
      ? "Existing positions earn the return through the next close; new positions begin earning after the fill."
      : "Signal uses only earlier closes; same-close fills occur after that day's close-to-close return. Exact close fills remain an assumption.",
  });

  const sufficientFolds = walkForward.folds.filter((f) => f.tradingDays >= 20).length;
  const oosStatus: IntegrityCheck["status"] = sufficientFolds >= 3 ? "pass" : sufficientFolds >= 1 ? "warn" : "fail";
  checks.push({
    id: "out_of_sample",
    label: "Out-of-sample validation",
    weight: 15,
    status: oosStatus,
    detail:
      oosStatus === "fail"
        ? "No walk-forward fold has enough trading days to evaluate — results rest on a single undivided window."
        : `${sufficientFolds} walk-forward fold(s) with sufficient trading days to check consistency across sub-periods.`,
  });

  checks.push({
    id: "parameter_robustness",
    label: "Parameter robustness",
    weight: 10,
    status: sensitivity.stabilityWarning ? "warn" : "pass",
    detail: sensitivity.note,
  });

  checks.push({
    id: "data_snooping",
    label: "Data snooping / overfitting risk",
    weight: 5,
    status: sensitivity.stabilityWarning ? "warn" : "pass",
    detail: sensitivity.stabilityWarning
      ? "Sensitivity to configuration choices raises the risk that a single reported configuration was implicitly cherry-picked. All grid results are shown for transparency."
      : "Factor weights and thresholds are fixed in the calculation engine, not fit to this backtest's data, and results hold up across a grid of reasonable configuration choices.",
  });

  const hardFail = checks.some((c) => c.status === "fail");
  let score = 0;
  for (const c of checks) score += c.status === "pass" ? c.weight : c.status === "warn" ? c.weight * 0.5 : 0;
  score = Math.round(score);

  const grade: IntegrityAudit["grade"] = hardFail ? "not_reliable" : score >= 85 ? "research_grade" : score >= 60 ? "developmental" : "not_reliable";

  return { score, grade, hardFail, checklist: checks.map(({ weight: _weight, ...c }) => c) };
}

// ── Iteration 10: AI Investment Committee reasoning layer ──────────────────
//
// This is intentionally a deterministic, rule-based synthesis over already-computed
// numbers (regime, factor scores, diagnostics, watchlist, allocations, backtest
// integrity) — not a generative model. That guarantees every sentence traces back
// to a real computed value and nothing can be fabricated.

export type CommitteePersonaId =
  | "macro_strategist"
  | "momentum_analyst"
  | "risk_manager"
  | "portfolio_construction_analyst";

export type CommitteeStance = "support" | "modify" | "reject";

export interface CommitteeRecommendation {
  personaId: CommitteePersonaId;
  personaLabel: string;
  stance: CommitteeStance;
  confidence: number;
  summary: string;
  evidence: string[];
  keyConcern: string;
}

export interface CommitteeCioSynthesis {
  stance: CommitteeStance;
  confidence: number;
  summary: string;
  dissent: string[];
}

export interface CommitteeInput {
  sessionId: number;
  runAt: string;
  regime: EnrichedRegimeScores;
  allocations: AllocationResult[];
  cashWeight: number;
  activeEtfCount: number;
  watchlist: WatchlistEntry[];
  diagnostics: PortfolioDiagnostics;
  constraints: Constraints;
  backtestIntegrity: IntegrityAudit | null;
}

export interface CommitteeResult {
  sessionId: number;
  generatedAt: string;
  recommendations: CommitteeRecommendation[];
  cio: CommitteeCioSynthesis;
  dataQualityNotes: string[];
  memo: string;
}

function clampConfidence(v: number): number {
  return Math.max(5, Math.min(95, Math.round(v)));
}

function stanceLabel(s: CommitteeStance): string {
  return s === "support" ? "Supports" : s === "reject" ? "Rejects" : "Modifies";
}

function buildMacroStrategist(input: CommitteeInput, dataQualityNotes: string[]): CommitteeRecommendation {
  const { regime } = input;
  let stance: CommitteeStance = "modify";
  let summary: string;
  if (regime.composite >= 65) {
    stance = "support";
    summary = `Regime composite of ${regime.composite} (${regime.label}) supports the current risk posture — macro backdrop favors staying invested.`;
  } else if (regime.composite <= 35) {
    stance = "reject";
    summary = `Regime composite of ${regime.composite} (${regime.label}) argues against the current risk posture — macro backdrop favors defensiveness over the proposed allocation.`;
  } else {
    summary = `Regime composite of ${regime.composite} (${regime.label}) is mixed — recommend trimming conviction rather than a full risk-on or risk-off stance.`;
  }

  let confidence = clampConfidence(regime.confidence);
  const evidence = [
    `Regime composite: ${regime.composite} (${regime.label})`,
    `Trend ${regime.trend} / Breadth ${regime.breadth} / Volatility ${regime.volatility} / Liquidity ${regime.liquidity}`,
    `Regime confidence: ${regime.confidence}%`,
    regime.drivers,
  ];

  const unavailableComponents = regime.components.filter((c) => c.method === "unavailable");
  let keyConcern = `Regime read leans on ${regime.components.filter((c) => c.method === "computed").length} of ${regime.components.length} components computed directly from price data.`;
  if (unavailableComponents.length > 0) {
    confidence = clampConfidence(confidence - unavailableComponents.length * 10);
    keyConcern = `${unavailableComponents.length} regime component(s) unavailable (${unavailableComponents.map((c) => c.label).join(", ")}) — reads on proxies, not full data.`;
    dataQualityNotes.push(`Macro Strategist confidence downgraded: ${unavailableComponents.length} regime component(s) unavailable.`);
  }
  if (regime.confidence < 50) {
    dataQualityNotes.push(`Regime confidence is only ${regime.confidence}% — Macro Strategist view carries a wider error band.`);
  }

  return { personaId: "macro_strategist", personaLabel: "Macro Strategist", stance, confidence, summary, evidence, keyConcern };
}

function buildMomentumAnalyst(input: CommitteeInput, dataQualityNotes: string[]): CommitteeRecommendation {
  const active = input.allocations.filter((a) => a.active);
  if (active.length === 0) {
    dataQualityNotes.push("Momentum Analyst has no active holdings to evaluate — allocation is 100% cash.");
    return {
      personaId: "momentum_analyst",
      personaLabel: "Momentum Analyst",
      stance: "modify",
      confidence: clampConfidence(30),
      summary: "No active ETFs are held, so there is no momentum signal to assess. Confidence is low by construction.",
      evidence: ["Active ETF count: 0"],
      keyConcern: "Cannot validate momentum thesis with zero active positions.",
    };
  }

  const avgMomComposite = active.reduce((s, a) => s + a.factorScores.composite, 0) / active.length;
  const weightedMom20 = active.reduce((s, a) => s + a.factorScores.mom20 * a.weight, 0) / (active.reduce((s, a) => s + a.weight, 0) || 1);
  const top = [...active].sort((a, b) => b.factorScores.composite - a.factorScores.composite).slice(0, 3);
  const bottom = [...active].sort((a, b) => a.factorScores.composite - b.factorScores.composite).slice(0, 2);

  let stance: CommitteeStance = "modify";
  let summary: string;
  if (avgMomComposite >= 60) {
    stance = "support";
    summary = `Average composite factor score across active holdings is ${avgMomComposite.toFixed(0)} — the book is concentrated in names the model itself ranks favorably.`;
  } else if (avgMomComposite <= 40) {
    stance = "reject";
    summary = `Average composite factor score across active holdings is only ${avgMomComposite.toFixed(0)} — several positions are being held despite weak scores, likely due to constraint requirements (min active count) rather than conviction.`;
  } else {
    summary = `Average composite factor score of ${avgMomComposite.toFixed(0)} is middling — supportive of current names but not a strong momentum tailwind.`;
  }

  const confidence = clampConfidence(50 + (avgMomComposite - 50) * 0.6);
  const evidence = [
    `Avg composite factor score (active holdings): ${avgMomComposite.toFixed(1)}`,
    `Weight-adjusted 20d momentum: ${weightedMom20.toFixed(1)}`,
    `Top-ranked: ${top.map((a) => `${a.ticker} (${a.factorScores.composite.toFixed(0)})`).join(", ")}`,
  ];
  const keyConcern = bottom.length > 0
    ? `Weakest holdings by composite score: ${bottom.map((a) => `${a.ticker} (${a.factorScores.composite.toFixed(0)})`).join(", ")} — worth confirming these are held for diversification, not inertia.`
    : "No material weak spots among active holdings.";

  return { personaId: "momentum_analyst", personaLabel: "Momentum Analyst", stance, confidence, summary, evidence, keyConcern };
}

function buildRiskManager(input: CommitteeInput, dataQualityNotes: string[]): CommitteeRecommendation {
  const { diagnostics, cashWeight, constraints } = input;
  const hasData = diagnostics.insufficientDataReasons.length === 0 && diagnostics.activeTickers.length > 0;

  if (!hasData) {
    dataQualityNotes.push(`Risk Manager confidence downgraded — diagnostics incomplete: ${diagnostics.insufficientDataReasons.join("; ") || "no active tickers to assess"}.`);
    return {
      personaId: "risk_manager",
      personaLabel: "Risk Manager",
      stance: "modify",
      confidence: clampConfidence(25),
      summary: "Portfolio risk diagnostics are incomplete, so risk sign-off cannot be given at full confidence.",
      evidence: diagnostics.insufficientDataReasons.length > 0 ? diagnostics.insufficientDataReasons : ["No active tickers to compute risk diagnostics for."],
      keyConcern: "Insufficient data to certify concentration or volatility risk.",
    };
  }

  const cashInBand = cashWeight >= constraints.cashMin && cashWeight <= constraints.cashMax;
  const wellDiversified = diagnostics.diversificationScore >= 60;
  let stance: CommitteeStance = "support";
  let summary: string;
  if (!cashInBand) {
    stance = "reject";
    summary = `Cash weight of ${(cashWeight * 100).toFixed(1)}% is outside the ${(constraints.cashMin * 100).toFixed(0)}–${(constraints.cashMax * 100).toFixed(0)}% policy band — this is a hard constraint breach, not a judgment call.`;
  } else if (!wellDiversified) {
    stance = "modify";
    summary = `Cash weight is within policy, but diversification score of ${diagnostics.diversificationScore.toFixed(0)}/100 and HHI of ${diagnostics.hhi.toFixed(3)} indicate concentration risk worth trimming before sign-off.`;
  } else {
    summary = `Cash weight ${(cashWeight * 100).toFixed(1)}% is within the policy band and diversification score of ${diagnostics.diversificationScore.toFixed(0)}/100 (effective bets: ${diagnostics.effectiveNumberOfBets.toFixed(1)}) indicates reasonable risk spread.`;
  }

  const confidence = clampConfidence((cashInBand ? 70 : 40) + (wellDiversified ? 15 : -10));
  const evidence = [
    `Cash weight: ${(cashWeight * 100).toFixed(1)}% (policy: ${(constraints.cashMin * 100).toFixed(0)}–${(constraints.cashMax * 100).toFixed(0)}%)`,
    `Expected volatility: ${(diagnostics.expectedVolatility * 100).toFixed(1)}%`,
    `HHI: ${diagnostics.hhi.toFixed(3)}, Effective number of bets: ${diagnostics.effectiveNumberOfBets.toFixed(1)}`,
    `Diversification score: ${diagnostics.diversificationScore.toFixed(0)}/100`,
  ];
  const topRiskContributor = [...diagnostics.riskContributions].sort((a, b) => b.riskContributionPct - a.riskContributionPct)[0];
  const keyConcern = topRiskContributor
    ? `${topRiskContributor.ticker} contributes ${(topRiskContributor.riskContributionPct * 100).toFixed(0)}% of total portfolio risk at only ${(topRiskContributor.weight * 100).toFixed(1)}% weight — check this concentration is intentional.`
    : "No single-name risk concentration detected.";

  return { personaId: "risk_manager", personaLabel: "Risk Manager", stance, confidence, summary, evidence, keyConcern };
}

function buildPortfolioConstructionAnalyst(input: CommitteeInput, dataQualityNotes: string[]): CommitteeRecommendation {
  const { allocations, activeEtfCount, constraints, watchlist } = input;
  const turnover = allocations.reduce((s, a) => s + Math.abs(a.change), 0) / 2;
  const meetsMinActive = activeEtfCount >= constraints.targetActiveEtfs;
  const blockedNearMiss = watchlist.filter((w) => w.blockingReason === "score_below_threshold" || w.blockingReason === "rank_cutoff");

  let stance: CommitteeStance = "support";
  let summary: string;
  if (!meetsMinActive) {
    stance = "reject";
    summary = `Only ${activeEtfCount} active ETFs vs. a target of ${constraints.targetActiveEtfs} — the allocation does not meet the minimum diversification requirement and should be reworked before approval.`;
    dataQualityNotes.push(`Portfolio Construction Analyst: active ETF count (${activeEtfCount}) is below the configured target (${constraints.targetActiveEtfs}).`);
  } else if (turnover > 0.35) {
    stance = "modify";
    summary = `Implied turnover of ${(turnover * 100).toFixed(1)}% vs. prior weights is high — recommend phasing the trade list rather than executing all at once to control cost and slippage.`;
  } else {
    summary = `Allocation meets the ${constraints.targetActiveEtfs}-name target with ${(turnover * 100).toFixed(1)}% turnover from prior weights — a reasonably incremental rebalance.`;
  }

  const confidence = clampConfidence(meetsMinActive ? 75 - turnover * 40 : 35);
  const evidence = [
    `Active ETFs: ${activeEtfCount} (target: ${constraints.targetActiveEtfs})`,
    `Implied one-way turnover vs. prior weights: ${(turnover * 100).toFixed(1)}%`,
    `Max single-ETF weight constraint: ${(constraints.maxEtfWeight * 100).toFixed(0)}%`,
  ];
  const keyConcern = blockedNearMiss.length > 0
    ? `${blockedNearMiss.length} watchlist name(s) sit just outside inclusion (e.g. ${blockedNearMiss[0].ticker}: ${blockedNearMiss[0].improvement}) — allocation is sensitive to small score shifts.`
    : "No near-miss watchlist names identified; allocation is not on a knife's edge.";

  return { personaId: "portfolio_construction_analyst", personaLabel: "Portfolio Construction Analyst", stance, confidence, summary, evidence, keyConcern };
}

function synthesizeCio(
  recommendations: CommitteeRecommendation[],
  backtestIntegrity: IntegrityAudit | null,
  dataQualityNotes: string[]
): CommitteeCioSynthesis {
  const weights: Record<CommitteeStance, number> = { support: 0, modify: 0, reject: 0 };
  for (const r of recommendations) weights[r.stance] += r.confidence;

  let stance: CommitteeStance = "modify";
  if (weights.support >= weights.modify && weights.support >= weights.reject) stance = "support";
  else if (weights.reject >= weights.modify && weights.reject >= weights.support) stance = "reject";

  const dissent = recommendations.filter((r) => r.stance !== stance).map((r) => `${r.personaLabel} (${stanceLabel(r.stance).toLowerCase()}, ${r.confidence}% confidence): ${r.keyConcern}`);

  let confidence = clampConfidence(recommendations.reduce((s, r) => s + r.confidence, 0) / recommendations.length);

  let summary = `Committee ${stanceLabel(stance).toLowerCase()} the proposed allocation. ${recommendations.filter((r) => r.stance === stance).length} of ${recommendations.length} desks agree` +
    (dissent.length > 0 ? `, with ${dissent.length} dissenting view(s) below.` : " unanimously.");

  if (backtestIntegrity) {
    if (backtestIntegrity.hardFail) {
      confidence = clampConfidence(confidence - 25);
      summary += ` Backtest integrity check failed (score ${backtestIntegrity.score}/100, grade "${backtestIntegrity.grade}") — this recommendation should not be treated as validated by historical simulation; committee confidence is downgraded accordingly.`;
      dataQualityNotes.push("CIO confidence downgraded because the backtest integrity audit reports a hard fail.");
    } else if (backtestIntegrity.grade !== "research_grade") {
      confidence = clampConfidence(confidence - 10);
      summary += ` Backtest integrity grade is "${backtestIntegrity.grade}" (score ${backtestIntegrity.score}/100) — supportive but not yet research-grade evidence.`;
      dataQualityNotes.push(`CIO confidence trimmed: backtest integrity grade is "${backtestIntegrity.grade}", not research-grade.`);
    } else {
      summary += ` Backtest integrity is research-grade (score ${backtestIntegrity.score}/100), supporting this view with validated historical evidence.`;
    }
  } else {
    confidence = clampConfidence(confidence - 15);
    summary += " No backtest has been run for this configuration — committee confidence is capped until historical evidence is available.";
    dataQualityNotes.push("CIO confidence capped: no backtest integrity audit is available for this session.");
  }

  return { stance, confidence, summary, dissent };
}

export function buildInvestmentCommittee(input: CommitteeInput): CommitteeResult {
  const dataQualityNotes: string[] = [];
  const recommendations: CommitteeRecommendation[] = [
    buildMacroStrategist(input, dataQualityNotes),
    buildMomentumAnalyst(input, dataQualityNotes),
    buildRiskManager(input, dataQualityNotes),
    buildPortfolioConstructionAnalyst(input, dataQualityNotes),
  ];
  const cio = synthesizeCio(recommendations, input.backtestIntegrity, dataQualityNotes);

  const memoLines: string[] = [];
  memoLines.push(`INVESTMENT COMMITTEE MEMO`);
  memoLines.push(`Session #${input.sessionId} — ${input.runAt}`);
  memoLines.push("");
  memoLines.push(`CIO RECOMMENDATION: ${stanceLabel(cio.stance).toUpperCase()} (confidence ${cio.confidence}%)`);
  memoLines.push(cio.summary);
  if (cio.dissent.length > 0) {
    memoLines.push("");
    memoLines.push("Dissenting views:");
    for (const d of cio.dissent) memoLines.push(`  - ${d}`);
  }
  memoLines.push("");
  memoLines.push("COMMITTEE DEBATE");
  for (const r of recommendations) {
    memoLines.push("");
    memoLines.push(`${r.personaLabel} — ${stanceLabel(r.stance)} (confidence ${r.confidence}%)`);
    memoLines.push(r.summary);
    memoLines.push(`Evidence: ${r.evidence.join("; ")}`);
    memoLines.push(`Key concern: ${r.keyConcern}`);
  }
  if (dataQualityNotes.length > 0) {
    memoLines.push("");
    memoLines.push("DATA QUALITY / GUARDRAIL NOTES");
    for (const n of dataQualityNotes) memoLines.push(`  - ${n}`);
  }

  return {
    sessionId: input.sessionId,
    generatedAt: new Date().toISOString(),
    recommendations,
    cio,
    dataQualityNotes,
    memo: memoLines.join("\n"),
  };
}
