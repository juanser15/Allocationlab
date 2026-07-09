/**
 * Allocation Lab v2 — Risk Model Pro (Iteration 11)
 *
 * A professional risk layer that sits on top of the Portfolio Diagnostics
 * computed in calculator.ts. Adds a selectable covariance model, marginal /
 * component contribution to risk, beta to detected benchmarks, downside
 * volatility, drawdown-based risk, risk-based concentration, a diversification
 * ratio, and risk decomposition by ETF / sector / cash.
 *
 * Every number here is derived from real uploaded price history and the
 * current allocation weights — no synthetic or placeholder values. When
 * there isn't enough history to estimate a stable covariance matrix, the
 * function returns hasSufficientData: false with a plain-language reason
 * instead of fabricating a number.
 */

import type { AllocationResult, EtfEntry, PriceRow } from "./calculator";

export type CovarianceModel = "sample" | "ewma" | "shrinkage";

const RISK_MODEL_BENCHMARKS = ["SPY", "QQQ"] as const;

const LOOKBACK_PREFERRED = 126; // ~6 months of trading days
const MIN_LOOKBACK = 21;
const MIN_ACTIVE_ETFS_FOR_STABILITY = 5;
const EWMA_LAMBDA = 0.94; // RiskMetrics-style daily decay
const SHRINKAGE_INTENSITY = 0.3; // blend toward constant-correlation target

export interface RiskModelWarning {
  id: string;
  severity: "warn" | "fail";
  message: string;
}

export interface RiskContributionDetail {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  marginalContributionToRisk: number; // MCR, annualized vol units
  componentContributionToRisk: number; // CCR, annualized vol units, sums to portfolio vol
  componentContributionPct: number; // CCR as % of total portfolio vol
}

export interface RiskDecompositionBucket {
  key: string;
  label: string;
  weight: number;
  componentContributionPct: number;
}

export interface BetaResult {
  benchmarkTicker: string;
  available: boolean;
  reason: string | null;
  beta: number | null;
  rSquared: number | null;
}

export interface RiskModelResult {
  hasSufficientData: boolean;
  insufficientReason: string | null;
  covarianceModel: CovarianceModel;
  lookbackDays: number;
  activeTickers: string[];
  annualizedVolatility: number | null;
  downsideVolatility: number | null;
  drawdownRisk: number | null;
  concentrationRisk: number | null; // risk-based HHI (0-1), based on CCR shares, not weights
  effectiveRiskBets: number | null;
  diversificationRatio: number | null; // >= 1; weighted avg vol / portfolio vol
  diversificationScore: number | null; // 0-100, % vol reduction from diversification
  riskContributions: RiskContributionDetail[];
  decompositionBySector: RiskDecompositionBucket[];
  cashWeight: number;
  betas: BetaResult[];
  warnings: RiskModelWarning[];
  availableBenchmarks: string[];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    else returns.push(0);
  }
  return returns;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Sample daily covariance, annualized (×252). */
function sampleCovariance(returnMatrix: number[][], n: number): number[][] {
  const nT = returnMatrix.length;
  const cov: number[][] = Array.from({ length: nT }, () => Array(nT).fill(0));
  for (let i = 0; i < nT; i++) {
    for (let j = i; j < nT; j++) {
      const ri = returnMatrix[i].slice(0, n);
      const rj = returnMatrix[j].slice(0, n);
      const mi = mean(ri);
      const mj = mean(rj);
      let c = 0;
      for (let t = 0; t < n; t++) c += (ri[t] - mi) * (rj[t] - mj);
      const dailyCov = n > 1 ? c / (n - 1) : 0;
      cov[i][j] = dailyCov * 252;
      cov[j][i] = cov[i][j];
    }
  }
  return cov;
}

/** Exponentially-weighted covariance (RiskMetrics style), annualized. Weights recent days more heavily. */
function ewmaCovariance(returnMatrix: number[][], n: number, lambda: number): number[][] {
  const nT = returnMatrix.length;
  const cov: number[][] = Array.from({ length: nT }, () => Array(nT).fill(0));
  // Weight for observation t (0 = oldest, n-1 = most recent): (1-lambda) * lambda^(n-1-t)
  const weights: number[] = [];
  let wSum = 0;
  for (let t = 0; t < n; t++) {
    const age = n - 1 - t;
    const w = (1 - lambda) * Math.pow(lambda, age);
    weights.push(w);
    wSum += w;
  }
  // Normalize so weights sum to 1 (finite-sample correction)
  const normWeights = weights.map((w) => w / wSum);

  for (let i = 0; i < nT; i++) {
    for (let j = i; j < nT; j++) {
      const ri = returnMatrix[i].slice(0, n);
      const rj = returnMatrix[j].slice(0, n);
      // EWMA mean (weighted)
      let mi = 0;
      let mj = 0;
      for (let t = 0; t < n; t++) {
        mi += normWeights[t] * ri[t];
        mj += normWeights[t] * rj[t];
      }
      let c = 0;
      for (let t = 0; t < n; t++) c += normWeights[t] * (ri[t] - mi) * (rj[t] - mj);
      cov[i][j] = c * 252;
      cov[j][i] = cov[i][j];
    }
  }
  return cov;
}

/**
 * Shrinkage covariance: blends the sample covariance toward a constant-correlation
 * target (the average off-diagonal correlation applied uniformly, individual
 * variances kept as-is). This is a simplified, well-known shrinkage target
 * (Ledoit-Wolf's constant-correlation model) that stabilizes noisy sample
 * estimates when the number of assets is large relative to observations.
 */
function shrinkageCovariance(sampleCov: number[][], intensity: number): number[][] {
  const nT = sampleCov.length;
  const target: number[][] = Array.from({ length: nT }, () => Array(nT).fill(0));
  let corrSum = 0;
  let corrCount = 0;
  const stdev = sampleCov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  for (let i = 0; i < nT; i++) {
    for (let j = i + 1; j < nT; j++) {
      const denom = stdev[i] * stdev[j];
      if (denom > 0) {
        corrSum += sampleCov[i][j] / denom;
        corrCount++;
      }
    }
  }
  const avgCorr = corrCount > 0 ? corrSum / corrCount : 0;

  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) {
      if (i === j) target[i][j] = sampleCov[i][j];
      else target[i][j] = avgCorr * stdev[i] * stdev[j];
    }
  }

  const blended: number[][] = Array.from({ length: nT }, () => Array(nT).fill(0));
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) {
      blended[i][j] = (1 - intensity) * sampleCov[i][j] + intensity * target[i][j];
    }
  }
  return blended;
}

function computeCovariance(model: CovarianceModel, returnMatrix: number[][], n: number): number[][] {
  if (model === "ewma") return ewmaCovariance(returnMatrix, n, EWMA_LAMBDA);
  const sample = sampleCovariance(returnMatrix, n);
  if (model === "shrinkage") return shrinkageCovariance(sample, SHRINKAGE_INTENSITY);
  return sample;
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

function emptyResult(covarianceModel: CovarianceModel, reason: string, activeTickers: string[] = [], cashWeight = 0): RiskModelResult {
  return {
    hasSufficientData: false,
    insufficientReason: reason,
    covarianceModel,
    lookbackDays: 0,
    activeTickers,
    annualizedVolatility: null,
    downsideVolatility: null,
    drawdownRisk: null,
    concentrationRisk: null,
    effectiveRiskBets: null,
    diversificationRatio: null,
    diversificationScore: null,
    riskContributions: [],
    decompositionBySector: [],
    cashWeight,
    betas: RISK_MODEL_BENCHMARKS.map((b) => ({ benchmarkTicker: b, available: false, reason: "Risk model has insufficient data.", beta: null, rSquared: null })),
    warnings: [{ id: "insufficient_data", severity: "fail", message: reason }],
    availableBenchmarks: [],
  };
}

export function computeRiskModel(
  priceRows: PriceRow[],
  allocations: AllocationResult[],
  etfMap: Map<string, EtfEntry>,
  availableTickers: string[],
  cashWeight: number,
  covarianceModel: CovarianceModel
): RiskModelResult {
  const activeAllocs = allocations.filter((a) => a.active && a.weight > 0.001);
  const activeTickers = activeAllocs.map((a) => a.ticker);

  if (activeAllocs.length < 2) {
    return emptyResult(covarianceModel, "Fewer than 2 active ETFs — the risk model requires at least 2 positions to estimate a covariance matrix.", activeTickers, cashWeight);
  }

  const pricesByTicker: Record<string, number[]> = {};
  for (const ticker of [...activeTickers, ...RISK_MODEL_BENCHMARKS]) pricesByTicker[ticker] = [];
  for (const row of priceRows) {
    for (const ticker of Object.keys(pricesByTicker)) {
      if (row.prices[ticker] !== undefined) pricesByTicker[ticker].push(row.prices[ticker]);
    }
  }

  const coveragePerTicker = activeTickers.map((t) => Math.max(0, pricesByTicker[t].length - 1));
  const availableLookback = Math.min(...coveragePerTicker);
  const usedLookback = Math.min(LOOKBACK_PREFERRED, availableLookback);

  if (usedLookback < MIN_LOOKBACK) {
    return emptyResult(
      covarianceModel,
      `Only ${Math.max(0, usedLookback)} overlapping return observations available across active ETFs — the risk model needs at least ${MIN_LOOKBACK}.`,
      activeTickers,
      cashWeight
    );
  }

  const warnings: RiskModelWarning[] = [];
  if (usedLookback < LOOKBACK_PREFERRED) {
    warnings.push({ id: "short_history", severity: "warn", message: `Using ${usedLookback} days of history (preferred: ${LOOKBACK_PREFERRED}). Covariance and beta estimates may be less stable with a shorter window.` });
  }

  const tickersWithShortHistory = activeTickers.filter((t) => pricesByTicker[t].length - 1 < availableLookback + 5 && pricesByTicker[t].length - 1 < LOOKBACK_PREFERRED);
  const uniqueCoverage = new Set(coveragePerTicker);
  if (uniqueCoverage.size > 1) {
    warnings.push({ id: "missing_prices", severity: "warn", message: `Active ETFs have unequal price history depth (${Math.min(...coveragePerTicker)}–${Math.max(...coveragePerTicker)} days) — the shortest series (${tickersWithShortHistory.join(", ") || "n/a"}) caps the lookback window used for all metrics.` });
  }

  if (activeAllocs.length < MIN_ACTIVE_ETFS_FOR_STABILITY) {
    warnings.push({ id: "too_few_etfs", severity: "warn", message: `Only ${activeAllocs.length} active ETFs — risk estimates concentrate on very few names and may be unstable. The institutional minimum is 8 active ETFs.` });
  }

  const nT = activeTickers.length;
  if (nT > 0 && usedLookback / nT < 3) {
    warnings.push({ id: "unstable_covariance", severity: "warn", message: `Only ${usedLookback} return observations for ${nT} active ETFs (ratio < 3:1) — the sample covariance matrix may be poorly conditioned. Consider the shrinkage model or a longer price history.` });
  }

  const returnMatrix: number[][] = activeTickers.map((t) => getReturns(pricesByTicker[t].slice(-(usedLookback + 1))));
  const n = Math.min(...returnMatrix.map((r) => r.length));

  const cov = computeCovariance(covarianceModel, returnMatrix, n);

  const totalActiveWeight = activeAllocs.reduce((s, a) => s + a.weight, 0);
  const w = activeAllocs.map((a) => a.weight / totalActiveWeight);

  let portfolioVariance = 0;
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) portfolioVariance += w[i] * w[j] * cov[i][j];
  }
  const portfolioVol = Math.sqrt(Math.max(0, portfolioVariance));

  // Marginal contribution to risk: (Σw)_i / σ_p
  const sigmaw: number[] = Array(nT).fill(0);
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nT; j++) sigmaw[i] += cov[i][j] * w[j];
  }
  const mcr = sigmaw.map((s) => (portfolioVol > 0 ? s / portfolioVol : 0));
  const ccr = mcr.map((m, i) => m * w[i]); // sums to portfolioVol

  const riskContributions: RiskContributionDetail[] = activeAllocs.map((a, i) => {
    const etf = etfMap.get(a.ticker);
    return {
      ticker: a.ticker,
      name: etf?.name ?? a.name,
      sector: etf?.sector ?? a.sector,
      weight: round4(a.weight),
      marginalContributionToRisk: round4(mcr[i]),
      componentContributionToRisk: round4(ccr[i]),
      componentContributionPct: round2(portfolioVol > 0 ? (ccr[i] / portfolioVol) * 100 : 0),
    };
  });
  riskContributions.sort((a, b) => b.componentContributionPct - a.componentContributionPct);

  // Risk-based decomposition by sector bucket + cash
  const sectorMap = new Map<string, { weight: number; ccrPct: number }>();
  for (const rc of riskContributions) {
    const bucket = sectorMap.get(rc.sector) ?? { weight: 0, ccrPct: 0 };
    bucket.weight += rc.weight;
    bucket.ccrPct += rc.componentContributionPct;
    sectorMap.set(rc.sector, bucket);
  }
  const decompositionBySector: RiskDecompositionBucket[] = Array.from(sectorMap.entries()).map(([sector, v]) => ({
    key: sector,
    label: sector,
    weight: round4(v.weight),
    componentContributionPct: round2(v.ccrPct),
  }));
  decompositionBySector.push({ key: "cash", label: "Cash", weight: round4(cashWeight), componentContributionPct: 0 });
  decompositionBySector.sort((a, b) => b.componentContributionPct - a.componentContributionPct);

  // Concentration risk: HHI of risk shares (not weight shares) — how concentrated is *risk*, not capital.
  const riskShares = riskContributions.map((rc) => rc.componentContributionPct / 100);
  const concentrationRisk = round4(riskShares.reduce((s, r) => s + r * r, 0));
  const effectiveRiskBets = round2(concentrationRisk > 0 ? 1 / concentrationRisk : activeAllocs.length);

  // Diversification ratio: weighted avg of individual vols vs portfolio vol (>=1 if any diversification benefit exists)
  const individualVols = activeTickers.map((_, i) => Math.sqrt(Math.max(0, cov[i][i])));
  const weightedAvgVol = individualVols.reduce((s, v, i) => s + v * w[i], 0);
  const diversificationRatio = portfolioVol > 0 ? round4(weightedAvgVol / portfolioVol) : 1;
  const diversificationScore = round2(clamp(weightedAvgVol > 0 ? (1 - portfolioVol / weightedAvgVol) * 100 : 0, 0, 100));

  // Portfolio daily return series (weighted, static-weight lookback)
  const portfolioReturns: number[] = Array(n).fill(0);
  for (let i = 0; i < nT; i++) {
    const ri = returnMatrix[i].slice(0, n);
    for (let t = 0; t < n; t++) portfolioReturns[t] += w[i] * ri[t];
  }

  // Downside volatility (semi-deviation of negative returns, annualized)
  const negReturns = portfolioReturns.filter((r) => r < 0);
  const downsideVariance = negReturns.length > 0 ? negReturns.reduce((s, r) => s + r * r, 0) / portfolioReturns.length : 0;
  const downsideVolatility = round4(Math.sqrt(downsideVariance * 252));

  // Drawdown risk: max drawdown of the static-weight portfolio index over the lookback window.
  // This is a lookback-window risk estimate under fixed current weights, not a rebalanced backtest —
  // it answers "how much could this exact allocation have drawn down over its recent history."
  let index = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of portfolioReturns) {
    index *= 1 + r;
    if (index > peak) peak = index;
    const dd = peak > 0 ? (peak - index) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const drawdownRisk = round4(maxDD);

  // Beta to detected benchmarks
  const betas: BetaResult[] = [];
  const availableBenchmarks: string[] = [];
  for (const bm of RISK_MODEL_BENCHMARKS) {
    if (!availableTickers.includes(bm)) {
      betas.push({ benchmarkTicker: bm, available: false, reason: `${bm} is not present in the uploaded price data.`, beta: null, rSquared: null });
      continue;
    }
    const bmPrices = pricesByTicker[bm];
    if (bmPrices.length < usedLookback + 1) {
      betas.push({ benchmarkTicker: bm, available: false, reason: `${bm} has fewer than ${usedLookback + 1} price rows over the lookback window.`, beta: null, rSquared: null });
      continue;
    }
    const bmReturns = getReturns(bmPrices.slice(-(usedLookback + 1))).slice(0, n);
    if (bmReturns.length < n) {
      betas.push({ benchmarkTicker: bm, available: false, reason: `Insufficient overlapping trading days with ${bm}.`, beta: null, rSquared: null });
      continue;
    }
    const bmVar = (() => {
      const m = mean(bmReturns);
      return bmReturns.reduce((s, r) => s + (r - m) ** 2, 0) / bmReturns.length;
    })();
    const covPB = (() => {
      const mp = mean(portfolioReturns);
      const mb = mean(bmReturns);
      let c = 0;
      for (let t = 0; t < n; t++) c += (portfolioReturns[t] - mp) * (bmReturns[t] - mb);
      return c / n;
    })();
    const beta = bmVar > 0 ? covPB / bmVar : null;
    const corr = pearsonCorr(portfolioReturns, bmReturns);
    const rSquared = !isNaN(corr) ? corr * corr : null;
    betas.push({ benchmarkTicker: bm, available: beta !== null, reason: beta === null ? `${bm} has zero variance over the lookback window.` : null, beta: beta !== null ? round4(beta) : null, rSquared: rSquared !== null ? round4(rSquared) : null });
    availableBenchmarks.push(bm);
  }

  if (availableBenchmarks.length === 0) {
    warnings.push({ id: "no_benchmark", severity: "warn", message: "Neither SPY nor QQQ found in the uploaded price data — beta cannot be computed. Add one to your price CSV to enable benchmark-relative risk metrics." });
  }

  return {
    hasSufficientData: true,
    insufficientReason: null,
    covarianceModel,
    lookbackDays: usedLookback,
    activeTickers,
    annualizedVolatility: round4(portfolioVol),
    downsideVolatility,
    drawdownRisk,
    concentrationRisk,
    effectiveRiskBets,
    diversificationRatio,
    diversificationScore,
    riskContributions,
    decompositionBySector,
    cashWeight: round4(cashWeight),
    betas,
    warnings,
    availableBenchmarks,
  };
}
