/**
 * Allocation Lab v2 — Attribution Engine (Iteration 14)
 *
 * Decomposes REALIZED performance of a saved rebalance version using only
 * uploaded price history — never synthetic returns. Every number here is
 * derived from `computeRealizedReturn` (same primitive used by the Historical
 * Archive comparison view) applied to real weights stored on the session.
 *
 * Sections:
 *  - Portfolio vs benchmark (excess return, tracking error, hit ratio, IR)
 *  - ETF contribution (weight, realized return, contribution, active contribution, cash drag)
 *  - Decision attribution (new/removed/increased/reduced/held + cash — helped or hurt)
 *  - Factor attribution (correlation of factor scores with realized return)
 *  - Trading cost attribution (gross -> net using execution assumptions)
 *  - Committee report summary (best/worst contributors, lessons learned)
 */

import { type PriceRow, type AllocationResult, computeRealizedReturn, computeTurnover } from "./calculator";

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(fromDate).getTime();
  const b = new Date(toDate).getTime();
  return Math.max(0, (b - a) / (1000 * 60 * 60 * 24));
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return round(cov / Math.sqrt(varX * varY), 3);
}

export interface EtfContributionEntry {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  priorWeight: number;
  realizedReturn: number | null;
  contribution: number | null;
  activeContribution: number | null;
  priceDataAvailable: boolean;
}

export interface EtfContributionResult {
  entries: EtfContributionEntry[];
  cashWeight: number;
  cashPriorWeight: number;
  cashReturnContribution: number;
  cashDrag: number;
  cashDragNote: string;
  etfSleeveReturn: number;
  totalPortfolioReturn: number;
}

export interface DecisionEntry {
  ticker: string;
  name: string;
  action: "NEW" | "REMOVED" | "INCREASED" | "REDUCED" | "HELD";
  priorWeight: number;
  weight: number;
  realizedReturn: number | null;
  helped: boolean | null;
  note: string;
}

export interface CashDecision {
  cashChange: number;
  avgActiveReturn: number | null;
  helped: boolean | null;
  note: string;
}

export interface DecisionAttributionResult {
  available: boolean;
  reason: string | null;
  entries: DecisionEntry[];
  cashDecision: CashDecision | null;
  helpedCount: number;
  hurtCount: number;
}

export interface FactorBucketResult {
  key: "momentum" | "trend" | "volatility" | "meanReversion" | "riskFit";
  label: string;
  weightedAvgScore: number;
  correlationWithReturn: number | null;
}

export interface FactorAttributionResult {
  available: boolean;
  reason: string | null;
  buckets: FactorBucketResult[];
  macroRegime: {
    regimeLabel: string;
    regimeComposite: number;
    portfolioReturn: number;
    aligned: boolean;
    note: string;
  } | null;
}

export interface CostAttributionResult {
  grossReturn: number;
  transactionCostBps: number;
  slippageBps: number;
  turnoverPct: number;
  costImpact: number;
  netReturn: number;
}

export interface BenchmarkComparisonResult {
  available: boolean;
  reason: string | null;
  benchmarkTicker: string | null;
  portfolioReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  trackingError: number | null;
  hitRatio: number | null;
  informationRatio: number | null;
}

export interface ReportSummary {
  bestContributors: EtfContributionEntry[];
  worstContributors: EtfContributionEntry[];
  decisionsHelped: DecisionEntry[];
  decisionsHurt: DecisionEntry[];
  cashDragNote: string;
  benchmarkComparisonNote: string;
  lessonsLearned: string[];
}

const FACTOR_BUCKET_DEFS: Array<{ key: FactorBucketResult["key"]; label: string; score: (fs: AllocationResult["factorScores"]) => number }> = [
  { key: "momentum", label: "Momentum", score: (fs) => (fs.mom20 + fs.mom60 + fs.mom120 + fs.mom252) / 4 },
  { key: "trend", label: "Trend Quality", score: (fs) => fs.trendQuality },
  { key: "volatility", label: "Realized Volatility", score: (fs) => fs.realizedVol60 },
  { key: "meanReversion", label: "Mean Reversion", score: (fs) => fs.meanReversion },
  { key: "riskFit", label: "Drawdown / Risk Fit", score: (fs) => fs.drawdown },
];

export function computeEtfContribution(
  priceRows: PriceRow[],
  allocations: AllocationResult[],
  cashWeight: number,
  cashPriorWeight: number,
  fromDate: string,
  toDate: string,
  cashYieldAnnualPct: number
): EtfContributionResult {
  const entries: EtfContributionEntry[] = allocations
    .filter((a) => a.active || a.priorWeight > 0)
    .map((a) => {
      const { returnPct } = computeRealizedReturn(priceRows, [{ ticker: a.ticker, weight: 1 }], fromDate, toDate);
      const contribution = returnPct !== null ? round(a.weight * returnPct) : null;
      const activeContribution = returnPct !== null ? round((a.weight - a.priorWeight) * returnPct) : null;
      return {
        ticker: a.ticker,
        name: a.name,
        sector: a.sector,
        weight: a.weight,
        priorWeight: a.priorWeight,
        realizedReturn: returnPct,
        contribution,
        activeContribution,
        priceDataAvailable: returnPct !== null,
      };
    });

  const activeHoldings = allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }));
  const { returnPct: etfSleeveReturnRaw } = computeRealizedReturn(priceRows, activeHoldings, fromDate, toDate);
  const etfSleeveReturn = etfSleeveReturnRaw ?? 0;

  const periodDays = daysBetween(fromDate, toDate);
  const cashReturnContribution = round(cashWeight * (cashYieldAnnualPct / 100) * (periodDays / 365));
  const totalPortfolioReturn = round(etfSleeveReturn + cashReturnContribution);

  const activeWeightSum = activeHoldings.reduce((s, h) => s + h.weight, 0);
  const avgActiveReturn = activeWeightSum > 0 ? etfSleeveReturn / activeWeightSum : 0;
  const cashOpportunityCost = round(cashWeight * (avgActiveReturn - cashYieldAnnualPct / 100 / (365 / periodDays || 1)));
  const cashDragNote =
    cashOpportunityCost > 0.001
      ? `Holding ${round(cashWeight * 100, 1)}% in cash cost approximately ${round(cashOpportunityCost * 100, 2)}% of return versus deploying it at the average active-ETF return.`
      : cashOpportunityCost < -0.001
        ? `Holding ${round(cashWeight * 100, 1)}% in cash preserved approximately ${round(Math.abs(cashOpportunityCost) * 100, 2)}% of return by avoiding a negative average active-ETF return.`
        : "Cash allocation had a negligible impact on realized return over this period.";

  return {
    entries,
    cashWeight,
    cashPriorWeight,
    cashReturnContribution,
    cashDrag: cashOpportunityCost,
    cashDragNote,
    etfSleeveReturn: round(etfSleeveReturn),
    totalPortfolioReturn,
  };
}

export function computeDecisionAttribution(
  allocations: AllocationResult[],
  etfContribution: EtfContributionResult,
  cashChange: number
): DecisionAttributionResult {
  const hasPriorWeights = allocations.some((a) => a.priorWeight > 0);
  if (!hasPriorWeights && allocations.every((a) => !a.active)) {
    return { available: false, reason: "No prior or target weights are available to evaluate decisions.", entries: [], cashDecision: null, helpedCount: 0, hurtCount: 0 };
  }

  const byTicker = new Map(etfContribution.entries.map((e) => [e.ticker, e]));

  const entries: DecisionEntry[] = allocations
    .filter((a) => a.active || a.priorWeight > 0)
    .map((a) => {
      const priorWeight = a.priorWeight;
      const weight = a.weight;
      const deltaWeight = weight - priorWeight;
      let action: DecisionEntry["action"] = "HELD";
      if (priorWeight === 0 && weight > 0) action = "NEW";
      else if (priorWeight > 0 && weight === 0) action = "REMOVED";
      else if (deltaWeight > 0.0005) action = "INCREASED";
      else if (deltaWeight < -0.0005) action = "REDUCED";

      const realizedReturn = byTicker.get(a.ticker)?.realizedReturn ?? null;
      let helped: boolean | null = null;
      let note = "";
      if (realizedReturn === null) {
        note = "No price coverage over this period to evaluate the decision.";
      } else if (action === "NEW" || action === "INCREASED" || action === "HELD") {
        helped = realizedReturn > 0;
        note = helped
          ? `${action === "HELD" ? "Holding" : action === "NEW" ? "Adding" : "Increasing"} ${a.ticker} helped — it returned ${round(realizedReturn * 100, 2)}% over the period.`
          : `${action === "HELD" ? "Holding" : action === "NEW" ? "Adding" : "Increasing"} ${a.ticker} hurt — it returned ${round(realizedReturn * 100, 2)}% over the period.`;
      } else {
        // REMOVED or REDUCED
        helped = realizedReturn < 0;
        note = helped
          ? `${action === "REMOVED" ? "Removing" : "Reducing"} ${a.ticker} helped — it went on to return ${round(realizedReturn * 100, 2)}%.`
          : `${action === "REMOVED" ? "Removing" : "Reducing"} ${a.ticker} hurt — it went on to return ${round(realizedReturn * 100, 2)}%, foregoing gains.`;
      }

      return { ticker: a.ticker, name: a.name, action, priorWeight, weight, realizedReturn, helped, note };
    });

  const activeWeightSum = allocations.filter((a) => a.active).reduce((s, a) => s + a.weight, 0);
  const avgActiveReturn = activeWeightSum > 0 ? etfContribution.etfSleeveReturn / activeWeightSum : null;
  let cashHelped: boolean | null = null;
  let cashNote = "Cash weight was essentially unchanged this period.";
  if (avgActiveReturn !== null && Math.abs(cashChange) > 0.0005) {
    if (cashChange > 0) {
      cashHelped = avgActiveReturn < 0;
      cashNote = cashHelped
        ? `Raising cash by ${round(cashChange * 100, 1)}pts helped — the active sleeve returned ${round(avgActiveReturn * 100, 2)}%.`
        : `Raising cash by ${round(cashChange * 100, 1)}pts hurt — the active sleeve returned ${round(avgActiveReturn * 100, 2)}%, foregoing gains.`;
    } else {
      cashHelped = avgActiveReturn > 0;
      cashNote = cashHelped
        ? `Deploying cash by ${round(Math.abs(cashChange) * 100, 1)}pts helped — the active sleeve returned ${round(avgActiveReturn * 100, 2)}%.`
        : `Deploying cash by ${round(Math.abs(cashChange) * 100, 1)}pts hurt — the active sleeve returned ${round(avgActiveReturn * 100, 2)}%.`;
    }
  }

  const cashDecision: CashDecision = { cashChange: round(cashChange), avgActiveReturn: avgActiveReturn !== null ? round(avgActiveReturn) : null, helped: cashHelped, note: cashNote };

  const helpedCount = entries.filter((e) => e.helped === true).length + (cashHelped === true ? 1 : 0);
  const hurtCount = entries.filter((e) => e.helped === false).length + (cashHelped === false ? 1 : 0);

  return { available: true, reason: null, entries, cashDecision, helpedCount, hurtCount };
}

export function computeFactorAttribution(
  allocations: AllocationResult[],
  etfContribution: EtfContributionResult,
  regimeLabel: string,
  regimeComposite: number
): FactorAttributionResult {
  const active = allocations.filter((a) => a.active);
  const byTicker = new Map(etfContribution.entries.map((e) => [e.ticker, e]));
  const withReturn = active
    .map((a) => ({ a, ret: byTicker.get(a.ticker)?.realizedReturn ?? null }))
    .filter((x) => x.ret !== null) as Array<{ a: AllocationResult; ret: number }>;

  if (withReturn.length < 3) {
    return {
      available: false,
      reason: "At least 3 active ETFs with realized-return coverage are required to correlate factor scores with performance.",
      buckets: [],
      macroRegime: null,
    };
  }

  const totalWeight = withReturn.reduce((s, x) => s + x.a.weight, 0);
  const buckets: FactorBucketResult[] = FACTOR_BUCKET_DEFS.map((def) => {
    const scores = withReturn.map((x) => def.score(x.a.factorScores));
    const returns = withReturn.map((x) => x.ret);
    const weightedAvgScore = totalWeight > 0 ? round(withReturn.reduce((s, x, i) => s + x.a.weight * scores[i], 0) / totalWeight, 1) : 0;
    return { key: def.key, label: def.label, weightedAvgScore, correlationWithReturn: pearsonCorrelation(scores, returns) };
  });

  const aligned = (regimeLabel === "Risk-On" || regimeLabel === "Constructive") ? etfContribution.totalPortfolioReturn > 0
    : (regimeLabel === "Cautious" || regimeLabel === "Risk-Off") ? etfContribution.totalPortfolioReturn <= 0
    : true;

  return {
    available: true,
    reason: null,
    buckets,
    macroRegime: {
      regimeLabel,
      regimeComposite,
      portfolioReturn: etfContribution.totalPortfolioReturn,
      aligned,
      note: aligned
        ? `Realized return was directionally consistent with the ${regimeLabel} regime call.`
        : `Realized return diverged from what the ${regimeLabel} regime call would suggest — worth reviewing regime confidence and component drivers.`,
    },
  };
}

export function computeCostAttribution(
  allocations: AllocationResult[],
  grossReturn: number,
  transactionCostBps: number,
  slippageBps: number
): CostAttributionResult {
  const prior = allocations.filter((a) => a.priorWeight > 0).map((a) => ({ ticker: a.ticker, weight: a.priorWeight }));
  const current = allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }));
  const turnoverPct = computeTurnover(prior, current);
  const costImpact = round(turnoverPct * ((transactionCostBps + slippageBps) / 10000));
  return {
    grossReturn: round(grossReturn),
    transactionCostBps,
    slippageBps,
    turnoverPct,
    costImpact,
    netReturn: round(grossReturn - costImpact),
  };
}

export function computeBenchmarkComparison(
  priceRows: PriceRow[],
  allocations: AllocationResult[],
  cashWeight: number,
  cashYieldAnnualPct: number,
  fromDate: string,
  toDate: string,
  benchmarkTicker: string | null,
  totalPortfolioReturn: number,
  etfContribution: EtfContributionResult
): BenchmarkComparisonResult {
  if (!benchmarkTicker) {
    return { available: false, reason: "No benchmark ticker is configured in Settings.", benchmarkTicker: null, portfolioReturn: null, benchmarkReturn: null, excessReturn: null, trackingError: null, hitRatio: null, informationRatio: null };
  }
  const inRange = priceRows.filter((r) => r.date >= fromDate && r.date <= toDate && r.prices[benchmarkTicker] !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length < 2) {
    return { available: false, reason: `No price data for ${benchmarkTicker} over this period.`, benchmarkTicker, portfolioReturn: null, benchmarkReturn: null, excessReturn: null, trackingError: null, hitRatio: null, informationRatio: null };
  }

  const { returnPct: benchmarkReturn } = computeRealizedReturn(priceRows, [{ ticker: benchmarkTicker, weight: 1 }], fromDate, toDate);
  if (benchmarkReturn === null) {
    return { available: false, reason: `Could not compute a realized return for ${benchmarkTicker} over this period.`, benchmarkTicker, portfolioReturn: null, benchmarkReturn: null, excessReturn: null, trackingError: null, hitRatio: null, informationRatio: null };
  }

  const activeHoldings = allocations.filter((a) => a.active).map((a) => ({ ticker: a.ticker, weight: a.weight }));
  const dailyExcess: number[] = [];
  let hits = 0;
  for (let i = 1; i < inRange.length; i++) {
    const prevRow = inRange[i - 1];
    const row = inRange[i];
    let portReturn = 0;
    for (const h of activeHoldings) {
      const p0 = prevRow.prices[h.ticker];
      const p1 = row.prices[h.ticker];
      if (p0 && p1 && p0 > 0) portReturn += h.weight * ((p1 - p0) / p0);
    }
    const dailyCash = cashWeight * (cashYieldAnnualPct / 100) / 252;
    portReturn += dailyCash;
    const b0 = prevRow.prices[benchmarkTicker];
    const b1 = row.prices[benchmarkTicker];
    const benchReturn = b0 && b1 && b0 > 0 ? (b1 - b0) / b0 : 0;
    dailyExcess.push(portReturn - benchReturn);
    if (portReturn > benchReturn) hits++;
  }

  const excessReturn = round(totalPortfolioReturn - benchmarkReturn);
  const n = dailyExcess.length;
  const meanExcess = n > 0 ? dailyExcess.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n > 1 ? dailyExcess.reduce((s, v) => s + (v - meanExcess) ** 2, 0) / (n - 1) : 0;
  const dailyStd = Math.sqrt(variance);
  const trackingError = round(dailyStd * Math.sqrt(252));
  const informationRatio = trackingError > 0 ? round((meanExcess * 252) / trackingError) : null;
  const hitRatio = n > 0 ? round(hits / n) : null;

  return {
    available: true,
    reason: null,
    benchmarkTicker,
    portfolioReturn: round(totalPortfolioReturn),
    benchmarkReturn: round(benchmarkReturn),
    excessReturn,
    trackingError,
    hitRatio,
    informationRatio,
  };
}

export function buildReportSummary(
  etfContribution: EtfContributionResult,
  decisionAttribution: DecisionAttributionResult,
  benchmarkComparison: BenchmarkComparisonResult
): ReportSummary {
  const withContribution = etfContribution.entries.filter((e) => e.contribution !== null);
  const sorted = withContribution.slice().sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
  const bestContributors = sorted.slice(0, 3);
  const worstContributors = sorted.slice(-3).reverse().filter((e) => !bestContributors.includes(e));

  const decisionsHelped = decisionAttribution.entries.filter((e) => e.helped === true);
  const decisionsHurt = decisionAttribution.entries.filter((e) => e.helped === false);

  const benchmarkComparisonNote = benchmarkComparison.available
    ? benchmarkComparison.excessReturn !== null && benchmarkComparison.excessReturn >= 0
      ? `The portfolio outperformed ${benchmarkComparison.benchmarkTicker} by ${round((benchmarkComparison.excessReturn ?? 0) * 100, 2)}%.`
      : `The portfolio underperformed ${benchmarkComparison.benchmarkTicker} by ${round(Math.abs(benchmarkComparison.excessReturn ?? 0) * 100, 2)}%.`
    : benchmarkComparison.reason ?? "Benchmark comparison unavailable.";

  const lessonsLearned: string[] = [];
  if (bestContributors[0]) {
    lessonsLearned.push(`${bestContributors[0].ticker} was the top contributor at ${round((bestContributors[0].contribution ?? 0) * 100, 2)}% of portfolio return.`);
  }
  if (worstContributors[0]) {
    lessonsLearned.push(`${worstContributors[0].ticker} was the largest drag at ${round((worstContributors[0].contribution ?? 0) * 100, 2)}% of portfolio return.`);
  }
  if (decisionAttribution.cashDecision && decisionAttribution.cashDecision.helped !== null) {
    lessonsLearned.push(decisionAttribution.cashDecision.note);
  }
  if (etfContribution.cashDrag > 0.001 || etfContribution.cashDrag < -0.001) {
    lessonsLearned.push(etfContribution.cashDragNote);
  }
  if (decisionsHurt.length > 0) {
    lessonsLearned.push(`${decisionsHurt.length} decision(s) hurt realized performance this period — review the decision attribution table below.`);
  }
  if (lessonsLearned.length === 0) {
    lessonsLearned.push("No standout drivers were identified this period — performance was broadly in line across positions.");
  }

  return { bestContributors, worstContributors, decisionsHelped, decisionsHurt, cashDragNote: etfContribution.cashDragNote, benchmarkComparisonNote, lessonsLearned };
}
