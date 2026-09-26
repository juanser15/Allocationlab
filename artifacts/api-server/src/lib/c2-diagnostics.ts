import { computeRegime, parseCsv } from "./calculator";
import type { AllocationRequest } from "./allocation-b2";
import { C1_ESTIMATION_ALIGNMENT_RULE, runB3Validation, type B3EstimationDatePlan, type B3Result } from "./b3-policy";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";

export const C2_ENGINE_VERSION = "c2-diagnostics-1.0.0";
const TOLERANCE = 1e-8;
const ANNUALIZATION = 252;

export interface C2Input {
  allocationId: number;
  validationPreparedInputId: number;
  c1ExperimentId: number | null;
  alphaIds: string[];
  startDate: string;
  endDate: string;
  regimeSource: "frozen_b1_prefix";
  regimeMapping: Record<string, string>;
  rollingWindow: number;
  rollingStep: number;
  contributionWindow: number;
  contributionStep: number;
  minRollingPaired: number;
  minRegimePaired: number;
  minSharpeObservations: number;
  highCorrelationThreshold: number;
  materialCorrelationGap: number;
}

export interface C2Sources {
  validation: PreparedSnapshot;
  policy: PreparedSnapshot;
  allocationRequest: AllocationRequest;
  c1?: { manifest: any; children: any[]; summary: any };
}

type Metric = number | null;
type Point = { date: string; value: number | null };
type Stat = { observations: number; mean: Metric; volatility: Metric; sharpe: Metric; hitRate: Metric; reason: string | null };

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function dailyYieldFromAnnual(annualYield: number): number {
  return Math.pow(1 + annualYield, 1 / ANNUALIZATION) - 1;
}
function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = avg(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}
function sharpe(values: number[], cashYield: number, minimum: number): Metric {
  if (values.length < minimum) return null;
  const excess = values.map((value) => value - cashYield);
  const deviation = sampleStd(excess);
  return deviation === null || deviation <= 1e-12 ? null : Math.sqrt(ANNUALIZATION) * avg(excess)! / deviation;
}
function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
function summarize(values: number[]) {
  return { median: quantile(values, .5), interquartileRange: values.length
    ? [quantile(values, .25), quantile(values, .75)] : [null, null],
  minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null,
  validWindows: values.length };
}
function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const am = avg(a)!, bm = avg(b)!;
  const da = a.reduce((s, x) => s + (x - am) ** 2, 0);
  const db = b.reduce((s, x) => s + (x - bm) ** 2, 0);
  return da > 0 && db > 0 ? a.reduce((s, x, i) => s + (x - am) * (b[i] - bm), 0) / Math.sqrt(da * db) : null;
}
function metricStat(values: number[], cashYield: number, minSharpe: number): Stat {
  if (values.length < minSharpe) return {
    observations: values.length, mean: null, volatility: null, sharpe: null, hitRate: null,
    reason: "INSUFFICIENT_HISTORY: below minimum observations.",
  };
  const mean = avg(values), vol = sampleStd(values);
  return { observations: values.length, mean, volatility: vol === null ? null : vol * Math.sqrt(ANNUALIZATION),
    sharpe: sharpe(values, cashYield, minSharpe),
    hitRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
    reason: values.length < 2 ? "At least two daily observations are required for sample volatility and Sharpe." :
      vol === 0 ? "Daily excess-return volatility is zero; Sharpe is undefined." : null };
}
function dateWithin(date: string, input: C2Input) { return date >= input.startDate && date <= input.endDate; }
function getCandidate(snapshot: PreparedSnapshot, id: string): PreparedCandidate {
  const candidate = snapshot.candidates.find((item) => item.candidateId === id && item.canonicalFingerprint === id);
  if (!candidate) throw new Error(`C2 candidate ${id} is not a canonical candidate in its frozen B1 snapshot.`);
  return candidate;
}
function alignedSeries(candidate: PreparedCandidate, input: C2Input): Point[] {
  return candidate.returnSeries.filter((point) => dateWithin(point.date, input)).map((point) => ({
    date: point.date, value: point.value !== null && Number.isFinite(point.value) ? point.value : null,
  }));
}
function ledgerByDate(candidate: PreparedCandidate) {
  return new Map((candidate.ledger as any[]).filter((entry) => typeof entry?.date === "string").map((entry) => [entry.date, entry]));
}
function numericField(entry: any, names: string[]): number | null {
  for (const name of names) if (typeof entry?.[name] === "number" && Number.isFinite(entry[name])) return entry[name];
  return null;
}
function grossAlpha(candidate: PreparedCandidate, date: string, net: number | null) {
  if (net === null) return { value: null, reason: "Net B1 return is unavailable." };
  const entry = ledgerByDate(candidate).get(date);
  const pnl = numericField(entry, ["netPnl"]);
  const transactionCosts = numericField(entry, ["transactionCosts"]);
  const slippage = numericField(entry, ["slippage"]);
  const nav = numericField(entry, ["beginningNav"]);
  if (pnl === null || transactionCosts === null || slippage === null || nav === null || nav <= 0)
    return { value: null, reason: "B1 ledger lacks matched net P&L, transaction costs, slippage, or positive beginning NAV." };
  if (Math.abs(pnl / nav - net) > TOLERANCE)
    return { value: null, reason: "B1 net return does not reconcile to matched daily net P&L / beginning NAV." };
  return { value: (pnl + transactionCosts + slippage) / nav, reason: null };
}
function c2Regimes(input: C2Input, snapshot: PreparedSnapshot, dates: string[]) {
  if (input.regimeSource !== "frozen_b1_prefix" || !snapshot.dataset.csvContent)
    return { available: false, status: "REGIME_ANALYSIS_UNAVAILABLE", version: null, series: [] as any[] };
  const rows = parseCsv(snapshot.dataset.csvContent);
  const series = dates.map((date) => {
    const strictlyPrior = rows.filter((row) => row.date < date);
    if (strictlyPrior.length < 10) return { date, detailedLabel: null, label: null, status: "INSUFFICIENT_HISTORY" };
    const detailedLabel = computeRegime(strictlyPrior, snapshot.dataset.tickers).label;
    const valid = detailedLabel !== "Unknown" && detailedLabel !== "Insufficient Data";
    const label = valid ? input.regimeMapping[detailedLabel] ?? detailedLabel : null;
    return { date, detailedLabel, label, status: valid && label ? "AVAILABLE" : "INSUFFICIENT_HISTORY" };
  });
  return { available: series.some((item) => item.label !== null), status: "AVAILABLE",
    version: "calculator.computeRegime/frozen-prefix-v1", series };
}
function rollingPairs(a: Point[], b: Point[], window: number, step: number, min: number) {
  const bm = new Map(b.map((item) => [item.date, item.value]));
  const pairs = a.flatMap((item) => item.value !== null && bm.get(item.date) !== null &&
    Number.isFinite(bm.get(item.date)) ? [{ date: item.date, a: item.value, b: bm.get(item.date)! }] : []);
  const results: any[] = [];
  for (let end = window; end <= pairs.length; end += step) {
    const sample = pairs.slice(end - window, end);
    results.push({ startDate: sample[0].date, endDate: sample.at(-1)!.date, observations: sample.length,
      value: sample.length >= min ? pearson(sample.map((p) => p.a), sample.map((p) => p.b)) : null,
      status: sample.length < min ? "INSUFFICIENT_HISTORY" : "AVAILABLE" });
  }
  return { pairedObservations: pairs.length, status: pairs.length < window ? "INSUFFICIENT_HISTORY" : "AVAILABLE", series: results };
}
function actualExposure(candidate: PreparedCandidate, date: string) {
  const decision = candidate.targetHistory.filter((item) => item.executionDate === date).at(-1);
  if (!decision) return null;
  const entry = ledgerByDate(candidate).get(date);
  const nav = numericField(entry, ["endingNav"]);
  const cash = numericField(entry, ["endingCash"]);
  if (!entry || nav === null || nav <= 0 || cash === null || !Array.isArray(entry.endingPositions)) return null;
  const risky = Object.fromEntries(entry.endingPositions.flatMap((position: any) =>
    typeof position.ticker === "string" && typeof position.marketValue === "number" &&
      Number.isFinite(position.marketValue) ? [[position.ticker, position.marketValue / nav]] : []));
  const riskyMagnitude = Object.values(risky).reduce((sum, value) => sum + Math.abs(value), 0);
  if (riskyMagnitude <= 0) return { normalizedRisky: null, riskyExposure: 0, cashExposure: cash / nav };
  return {
    normalizedRisky: Object.fromEntries(Object.entries(risky).map(([ticker, value]) => [ticker, value / riskyMagnitude])),
    riskyExposure: riskyMagnitude, cashExposure: cash / nav,
  };
}
function distance(a: Record<string, number> | null, b: Record<string, number> | null) {
  if (!a || !b) return { distance: null, similarity: null, status: "UNAVAILABLE_ZERO_OR_UNDEFINED_VECTOR" };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const value = .5 * [...keys].reduce((sum, key) => sum + Math.abs((a[key] ?? 0) - (b[key] ?? 0)), 0);
  return { distance: value, similarity: 1 - value, status: "AVAILABLE" };
}
function episodes(regimeSeries: any[], returns: Map<string, number | null>) {
  const result: Record<string, any[]> = {};
  let current: any = null;
  const finish = () => { if (current) (result[current.regime] ??= []).push(current); };
  for (const item of regimeSeries) {
    const value = returns.get(item.date);
    if (!item.label || value === null || value === undefined) { finish(); current = null; continue; }
    if (!current || current.regime !== item.label) {
      finish(); current = { regime: item.label, startDate: item.date, endDate: item.date, observations: 1, cumulativeReturn: value };
    } else { current.endDate = item.date; current.observations++; current.cumulativeReturn = (1 + current.cumulativeReturn) * (1 + value) - 1; }
  }
  finish();
  return result;
}
function mapStatsByRegime(series: Point[], regimes: any[], cash: number, minimum: number, candidate: PreparedCandidate) {
  const regimeByDate = new Map(regimes.map((item) => [item.date, item]));
  const groups = new Map<string, number[]>();
  for (const item of regimes) if (item.label && !groups.has(item.label)) groups.set(item.label, []);
  for (const point of series) {
    const label = regimeByDate.get(point.date)?.label;
    if (label && point.value !== null) (groups.get(label) ?? (groups.set(label, []), groups.get(label)!)).push(point.value);
  }
  const ledger = ledgerByDate(candidate);
  const datesByRegime = new Map<string, string[]>();
  for (const point of series) {
    const label = regimeByDate.get(point.date)?.label;
    if (label && point.value !== null) (datesByRegime.get(label) ?? (datesByRegime.set(label, []), datesByRegime.get(label)!)).push(point.date);
  }
  return Object.fromEntries([...groups].map(([label, values]) => {
    const entries = (datesByRegime.get(label) ?? []).map((date) => ledger.get(date)).filter(Boolean);
    const turnover = entries.map((entry) => numericField(entry, ["externalTradedNotional", "tradedNotional", "turnover"]) ??
      (Array.isArray(entry.trades) ? entry.trades.reduce((sum: number, trade: any) => sum + Math.abs(trade.notional ?? 0), 0) : null))
      .filter((value: number | null): value is number => value !== null);
    const risky = entries.map((entry) => numericField(entry, ["averageRiskyExposure", "riskyExposure"]) ??
      (Array.isArray(entry.endingPositions) ? entry.endingPositions.reduce((sum: number, position: any) => sum + (position.weight ?? 0), 0) : null))
      .filter((value: number | null): value is number => value !== null);
    const costs = entries.map((entry) => numericField(entry, ["transactionCosts", "costs", "transactionCost"])).filter(
      (value: number | null): value is number => value !== null);
    const completeCosts = entries.every((entry) => numericField(entry, ["transactionCosts"]) !== null &&
      numericField(entry, ["slippage"]) !== null);
    const totalDailyCosts = entries.map((entry) => {
      const transactionCosts = numericField(entry, ["transactionCosts"]);
      const slippage = numericField(entry, ["slippage"]);
      return transactionCosts === null || slippage === null ? null : transactionCosts + slippage;
    });
    return [label, {
      ...metricStat(values, cash, minimum),
      status: values.length < minimum ? "INSUFFICIENT_HISTORY" : "AVAILABLE",
      meanDailyExcessReturn: values.length >= minimum ? avg(values.map((value) => value - cash)) : null,
      averageRiskyExposure: avg(risky), averageTurnoverOrTradedNotional: avg(turnover),
      averageDailyCost: completeCosts ? avg(totalDailyCosts.filter((value): value is number => value !== null)) : null,
      averageDailyCostReason: completeCosts ? null : "Unavailable: matched B1 ledger requires both transaction costs and slippage.",
      averageTransactionCost: avg(costs), dailyCashYield: cash,
    }];
  }));
}
function decisionDistances(full: B3Result, variant: B3Result, date: string, fullPolicyIds: string[]) {
  const fullDecision = full.decisions.find((item) => item.decisionDate === date);
  const variantDecision = variant.decisions.find((item) => item.decisionDate === date);
  if (!fullDecision || !variantDecision) return null;
  const ids = [...fullPolicyIds];
  const fullAlpha = [...ids.map((id) => fullDecision.candidateWeights[id] ?? 0), fullDecision.masterCash];
  const variantAlpha = [...ids.map((id) => variantDecision.candidateWeights[id] ?? 0), variantDecision.masterCash];
  const alphaCapitalDistance = .5 * fullAlpha.reduce((sum, value, index) =>
    sum + Math.abs(value - (variantAlpha[index] ?? 0)), 0);
  const tickers = [...new Set([...Object.keys(fullDecision.targetAssetWeights), ...Object.keys(variantDecision.targetAssetWeights)])].sort();
  const fullAsset = [...tickers.map((ticker) => fullDecision.targetAssetWeights[ticker] ?? 0), fullDecision.totalCash];
  const variantAsset = [...tickers.map((ticker) => variantDecision.targetAssetWeights[ticker] ?? 0), variantDecision.totalCash];
  const underlyingAssetDistance = .5 * fullAsset.reduce((sum, value, index) =>
    sum + Math.abs(value - (variantAsset[index] ?? 0)), 0);
  return { date, alphaCapitalDistance, underlyingAssetDistance };
}
function dailyResultStats(result: B3Result, dates: Set<string>, minSharpe: number) {
  const entries = result.dailyLedger.filter((entry) => dates.has(entry.date));
  const returns = entries.map((entry) => entry.dailyNetReturn);
  const cashYield = result.assumptions?.dailyCashYield;
  if (typeof cashYield !== "number" || !Number.isFinite(cashYield))
    return { ...metricStat([], 0, minSharpe), observations: entries.length,
      reason: "C1 frozen B3 assumptions lack a valid daily cash yield.", totalCosts: null, cumulativeReturn: null };
  const stat = metricStat(returns, cashYield, minSharpe);
  const completeCosts = entries.every((entry) => Number.isFinite(entry.transactionCosts) && Number.isFinite(entry.slippage));
  return { ...stat, dailyCashYield: cashYield,
    totalCosts: entries.length >= minSharpe && completeCosts
      ? entries.reduce((sum, entry) => sum + entry.transactionCosts + entry.slippage, 0) : null,
    costReason: completeCosts ? null : "Matched B3 ledger is missing transaction-cost or slippage evidence.",
    cumulativeReturn: entries.length >= minSharpe ? returns.reduce((wealth, value) => wealth * (1 + value), 1) - 1 : null };
}
function makeWindowAlignmentPlan(
  reference: B3Result,
  validation: PreparedSnapshot,
  referenceCandidateIds: string[],
): B3EstimationDatePlan {
  const decisions = new Map(reference.decisions.map((decision) => [decision.decisionDate, decision]));
  const rows = parseCsv(validation.dataset.csvContent);
  let blocked = false;
  return {
    rule: C1_ESTIMATION_ALIGNMENT_RULE,
    referenceCandidateIds: [...referenceCandidateIds],
    decisions: reference.decisionCalendar.map(({ decisionDate }) => {
      const decision = decisions.get(decisionDate);
      if (decision && !blocked) return {
        decisionDate, informationCutoff: decision.informationCutoff,
        estimationDates: [...decision.estimationDates], observationCount: decision.estimationDates.length,
      };
      blocked = true;
      const cutoff = rows.filter((row) => row.date < decisionDate).at(-1)?.date ?? "";
      return { decisionDate, informationCutoff: cutoff, estimationDates: [], observationCount: 0,
        failureReason: reference.reason ?? `Full-baseline B3 alignment failed at ${reference.failureDate ?? decisionDate}.` };
    }),
  };
}

function runWindowPair(sources: C2Sources, input: C2Input, from: string, to: string, alphaId: string) {
  const c1 = sources.c1;
  if (!c1?.manifest?.plans || !c1.manifest.assumptions || !c1.manifest.developmentPeriod)
    return { error: "INSUFFICIENT_HISTORY: frozen C1 development period and plans are required for rolling comparisons." };
  const development = c1.manifest.developmentPeriod;
  if (from < development.startDate || to > development.endDate ||
      (c1.manifest.holdoutStartDate && to >= c1.manifest.holdoutStartDate))
    return { error: "INSUFFICIENT_HISTORY: rolling window falls outside frozen C1 development or overlaps holdout." };
  const full = c1.manifest.plans.find((plan: any) => !(plan.excludedCandidateIds ?? []).length);
  const without = c1.manifest.plans.find((plan: any) => (plan.excludedCandidateIds ?? []).includes(alphaId));
  if (!full || !without) return null;
  const assumptions = { ...c1.manifest.assumptions, evaluationStartDate: from, evaluationEndDate: to };
  try {
    const fullReference = runB3Validation(sources.policy, full.policyRequest, sources.validation, assumptions);
    const alignmentPlan = makeWindowAlignmentPlan(fullReference, sources.validation, full.policyRequest.candidateIds);
    const baseline = runB3Validation(sources.policy, full.policyRequest, sources.validation, assumptions, alignmentPlan);
    const excluded = runB3Validation(sources.policy, without.policyRequest, sources.validation, assumptions, alignmentPlan);
    return { baseline, excluded, alignmentPlan, fullReference };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function computeC2Diagnostics(input: C2Input, sources: C2Sources): Promise<C2Output> {
  if (!input.alphaIds.length || input.alphaIds.length > 5 || new Set(input.alphaIds).size !== input.alphaIds.length)
    throw new Error("C2 requires one to five unique selected canonical alpha IDs.");
  for (const [name, value] of Object.entries({ rollingWindow: input.rollingWindow, rollingStep: input.rollingStep,
    contributionWindow: input.contributionWindow, contributionStep: input.contributionStep,
    minRollingPaired: input.minRollingPaired, minRegimePaired: input.minRegimePaired,
    minSharpeObservations: input.minSharpeObservations }))
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  if (input.startDate > input.endDate) throw new Error("C2 startDate must not follow endDate.");
  if (![input.startDate, input.endDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(`${date}T00:00:00Z`))))
    throw new Error("C2 period dates must use valid YYYY-MM-DD values.");
  if (!Number.isFinite(input.highCorrelationThreshold) || input.highCorrelationThreshold < -1 ||
      input.highCorrelationThreshold > 1 || !Number.isFinite(input.materialCorrelationGap) ||
      input.materialCorrelationGap < 0 || input.materialCorrelationGap > 2)
    throw new Error("C2 correlation thresholds must be finite; high-correlation threshold is [-1, 1] and material gap is [0, 2].");
  const validationId = (id: string) => sources.c1?.manifest?.validationCandidateIds?.[id] ?? id;
  const candidates = input.alphaIds.map((id) => getCandidate(sources.validation, validationId(id)));
  if (candidates.some((candidate) => candidate.kind !== "alpha_streams"))
    throw new Error("C2 diagnostics require tradable B1 alpha_streams candidates.");
  const manifestIds = sources.c1?.manifest?.candidateIds ?? sources.allocationRequest.candidateIds;
  const validationToPolicy = Object.fromEntries(Object.entries(sources.c1?.manifest?.validationCandidateIds ?? {})
    .map(([policyId, b1Id]: [string, any]) => [b1Id, policyId]));
  const policyId = (requestedId: string, resolvedB1Id: string) =>
    manifestIds.includes(requestedId) ? requestedId : validationToPolicy[resolvedB1Id] ?? requestedId;
  const selected = candidates.map((candidate, index) => ({ candidate,
    series: alignedSeries(candidate, input), policyId: policyId(input.alphaIds[index], candidate.candidateId) }));
  if (new Set(selected.map((item) => item.candidate.candidateId)).size !== selected.length)
    throw new Error("Selected C2 IDs must resolve to unique canonical validation B1 candidates.");
  const dates = [...new Set(selected.flatMap(({ series }) => series.map((point) => point.date)))].sort();
  const regimeInfo = c2Regimes(input, sources.validation, dates);
  const regimeByDate = new Map(regimeInfo.series.map((item: any) => [item.date, item]));
  const regimeNames = [...new Set(regimeInfo.series.flatMap((item: any) => item.label ? [item.label] : []))].sort();
  const stability = selected.map(({ candidate, series }) => {
    const definition = candidate.lineage.definition as any;
    const dailyCashYield = typeof definition?.cashYieldAnnual === "number"
      ? dailyYieldFromAnnual(definition.cashYieldAnnual) : 0;
    const ledger = ledgerByDate(candidate);
    const windows: any[] = [];
    for (let end = input.rollingWindow; end <= series.length; end += input.rollingStep) {
      const sample = series.slice(end - input.rollingWindow, end);
      const complete = sample.every((point) => point.value !== null);
      const returns = sample.flatMap((point) => point.value === null ? [] : [point.value]);
      if (!complete) {
        windows.push({ startDate: sample[0].date, endDate: sample.at(-1)!.date, observations: returns.length,
          requestedWindowObservations: input.rollingWindow, status: "INSUFFICIENT_HISTORY",
          reason: "One or more B1 alpha-stream return observations are missing; the window was not shortened.",
          netReturn: null, annualizedVolatility: null, sharpe: null, sharpeReason: "INSUFFICIENT_HISTORY",
          hitRate: null, tradedNotional: null, averageRiskyExposure: null, drawdownFromAlphaStreamNav: null,
          grossReturn: null, grossReturnStatus: "UNAVAILABLE_LEDGER_EVIDENCE",
          grossReturnReason: "Return window contains missing observations." });
        continue;
      }
      const nav = returns.reduce((wealth, value) => wealth * (1 + value), 1);
      let wealth = 1, peak = 1, drawdown = 0;
      for (const value of returns) { wealth *= 1 + value; peak = Math.max(peak, wealth); drawdown = Math.max(drawdown, (peak - wealth) / peak); }
      const entries = sample.map((point) => ledger.get(point.date)).filter(Boolean);
      const turnover = entries.map((entry) => numericField(entry, ["externalTradedNotional", "tradedNotional", "turnover"]) ??
        (Array.isArray(entry.trades) ? entry.trades.reduce((sum: number, trade: any) => sum + Math.abs(trade.notional ?? 0), 0) : null));
      const exposureValues = entries.map((entry) => numericField(entry, ["averageRiskyExposure", "riskyExposure"]) ??
        (Array.isArray(entry.endingPositions) ? entry.endingPositions.reduce((sum: number, position: any) => sum + (position.weight ?? 0), 0) : null))
        .filter((value: number | null): value is number => value !== null);
      const grossItems = sample.map((point) => grossAlpha(candidate, point.date, point.value));
      const grossComplete = grossItems.every((item) => item.value !== null);
      const vol = sampleStd(returns);
      windows.push({ startDate: sample[0].date, endDate: sample.at(-1)!.date, observations: sample.length,
        requestedWindowObservations: input.rollingWindow, status: "AVAILABLE", reason: null,
        netReturn: nav - 1, annualizedVolatility: vol === null ? null : vol * Math.sqrt(ANNUALIZATION),
        sharpe: sharpe(returns, dailyCashYield, input.minSharpeObservations),
        sharpeReason: sample.length < input.minSharpeObservations ? "INSUFFICIENT_HISTORY" :
          vol === null ? "At least two daily observations are required for sample volatility and Sharpe." :
            vol === 0 ? "Zero sample volatility." : null,
        hitRate: returns.filter((value) => value > 0).length / returns.length,
        tradedNotional: avg(turnover.filter((value): value is number => value !== null)),
        turnoverConvention: "mean daily ledger traded notional; native ledger units",
        averageRiskyExposure: avg(exposureValues), drawdownFromAlphaStreamNav: drawdown,
        grossReturn: grossComplete
          ? grossItems.reduce((wealth, item) => wealth * (1 + item.value!), 1) - 1 : null,
        grossReturnStatus: grossComplete ? "AVAILABLE" : "UNAVAILABLE_LEDGER_EVIDENCE",
        grossReturnReason: grossComplete ? null : grossItems.find((item) => item.value === null)?.reason ?? "Missing matched B1 ledger evidence.",
      });
    }
    const rollingMetric = (key: string) => summarize(windows.flatMap((window) =>
      typeof window[key] === "number" && Number.isFinite(window[key]) ? [window[key] as number] : []));
    return { alphaId: candidate.candidateId, name: candidate.name,
      lineage: { factorId: candidate.factorId ?? null, definition: candidate.lineage.definition ?? null,
        datasetHash: candidate.lineage.datasetHash ?? sources.validation.dataset.sha256, mapping: candidate.mapping ?? null },
      methodology: "B1 tradable alpha-stream daily net returns; non-overlapping rolling observation windows; daily excess cash yield = (1 + annual definition yield)^(1/252) - 1.",
      units: { returns: "daily decimal / window compounded decimal", grossReturn: "window compounded decimal",
        volatility: "annualized decimal", sharpe: "annualized ratio",
        turnover: "mean daily native B1 ledger traded-notional units", exposure: "portfolio weight" },
      rollingStatus: windows.some((window) => window.status === "AVAILABLE") ? "AVAILABLE" : "INSUFFICIENT_HISTORY",
      rolling: windows, summary: Object.fromEntries(["netReturn", "annualizedVolatility", "sharpe", "hitRate",
        "tradedNotional", "averageRiskyExposure", "drawdownFromAlphaStreamNav"].map((key) => [key, rollingMetric(key)])),
      dailyCashYield };
  });
  const conditional = selected.map(({ candidate, series }) => {
    const cash = dailyYieldFromAnnual((candidate.lineage.definition as any)?.cashYieldAnnual ?? 0);
    const stats = mapStatsByRegime(series, regimeInfo.series, cash, input.minSharpeObservations, candidate);
    const returns = new Map(series.map((point) => [point.date, point.value]));
    return { alphaId: candidate.candidateId, regimes: stats,
      episodes: episodes(regimeInfo.series, returns),
      methodology: "Conditional statistics use only dates assigned to a frozen point-in-time regime; episodes preserve contiguous runs; no drawdown on concatenated regimes." };
  });
  const dependence: any[] = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const left = selected[i], right = selected[j];
    const rm = new Map(right.series.map((point) => [point.date, point.value]));
    const pairs = left.series.flatMap((point) => point.value !== null && rm.get(point.date) !== null &&
      Number.isFinite(rm.get(point.date)) ? [{ date: point.date, a: point.value, b: rm.get(point.date)! }] : []);
    const fullCorr = pearson(pairs.map((p) => p.a), pairs.map((p) => p.b));
    const rolling = rollingPairs(left.series, right.series, input.rollingWindow, input.rollingStep, input.minRollingPaired);
    const conditionalCorr = regimeNames.map((regime) => {
      const values = pairs.filter((pair) => regimeByDate.get(pair.date)?.label === regime);
      return { regime, pairedObservations: values.length,
        correlation: values.length >= input.minRegimePaired ? pearson(values.map((p) => p.a), values.map((p) => p.b)) : null,
        meanReturnA: values.length >= input.minRegimePaired ? avg(values.map((p) => p.a)) : null,
        meanReturnB: values.length >= input.minRegimePaired ? avg(values.map((p) => p.b)) : null,
        volatilityA: values.length >= input.minRegimePaired ? sampleStd(values.map((p) => p.a)) : null,
        volatilityB: values.length >= input.minRegimePaired ? sampleStd(values.map((p) => p.b)) : null,
        status: values.length < input.minRegimePaired ? "INSUFFICIENT_HISTORY" : "AVAILABLE" };
    });
    const rightDecisionDates = new Set(right.candidate.targetHistory.flatMap((item) =>
      item.executionDate && dateWithin(item.executionDate, input) ? [item.executionDate] : []));
    const decisionDates = [...new Set(left.candidate.targetHistory.flatMap((item) =>
      item.executionDate && rightDecisionDates.has(item.executionDate) ? [item.executionDate] : []))].sort();
    const exposureSeries: Array<{ date: string; distance: number | null; similarity: number | null; status: string;
      riskyExposureA: number | null; riskyExposureB: number | null;
      cashExposureA: number | null; cashExposureB: number | null }> = decisionDates.map((date) => {
      const a = actualExposure(left.candidate, date), b = actualExposure(right.candidate, date);
      if (!a || !b) return { date, distance: null, similarity: null, status: "UNAVAILABLE_ACTUAL_HOLDINGS",
        riskyExposureA: null, riskyExposureB: null, cashExposureA: null, cashExposureB: null };
      const result = distance(a.normalizedRisky, b.normalizedRisky);
      return { date, ...result, riskyExposureA: a.riskyExposure, riskyExposureB: b.riskyExposure,
        cashExposureA: a.cashExposure, cashExposureB: b.cashExposure };
    });
    const exposureByRegime = regimeNames.map((regime) => {
      const values = exposureSeries.filter((point) => regimeByDate.get(point.date)?.label === regime)
        .flatMap((point) => point.similarity === null ? [] : [point.similarity]);
      return { regime, observations: values.length, meanSimilarity: avg(values),
        status: values.length >= input.minRegimePaired ? "AVAILABLE" : "INSUFFICIENT_HISTORY" };
    });
    const validConditional = conditionalCorr.filter((row) => row.correlation !== null);
    const materiallyLower = validConditional.some((row) => fullCorr !== null && row.correlation !== null &&
      fullCorr - row.correlation >= input.materialCorrelationGap);
    const sufficient = validConditional.length > 0;
    const high = fullCorr !== null && fullCorr >= input.highCorrelationThreshold;
    const flag = !sufficient ? "INSUFFICIENT_REGIME_EVIDENCE"
      : high && materiallyLower ? "REGIME_DIVERGENCE_OBSERVED"
        : high && validConditional.every((row) => row.correlation! >= input.highCorrelationThreshold) &&
          rolling.series.filter((point) => point.value !== null).length > 0 &&
          rolling.series.filter((point) => point.value !== null)
            .every((point) => point.value! >= input.highCorrelationThreshold) &&
          exposureByRegime.every((row) => row.meanSimilarity !== null && row.meanSimilarity >= input.highCorrelationThreshold)
          ? "PERSISTENTLY_SIMILAR" : "INSUFFICIENT_REGIME_EVIDENCE";
    const policyWeights = sources.c1?.children?.[0]?.result?.decisions ?? [];
    dependence.push({ alphaA: left.candidate.candidateId, alphaB: right.candidate.candidateId,
      fullSample: { correlation: pairs.length >= input.minRegimePaired ? fullCorr : null,
        startDate: pairs[0]?.date ?? null, endDate: pairs.at(-1)?.date ?? null, pairedObservations: pairs.length,
        method: "Pearson correlation of aligned B1 daily alpha-stream returns.",
        units: "dimensionless correlation; aligned B1 alpha-stream daily simple returns in decimal units." },
      rollingCorrelation: { ...rolling, summary: summarize(rolling.series.flatMap((point) => point.value === null ? [] : [point.value])) },
      regimeCorrelation: conditionalCorr, exposureDistance: exposureSeries, exposureSimilarityByRegime: exposureByRegime,
      optimizedCapitalWeights: policyWeights.map((decision: any) => ({ date: decision.decisionDate,
        weightA: decision.candidateWeights?.[left.policyId] ?? null,
        weightB: decision.candidateWeights?.[right.policyId] ?? null })),
      flag, flagVersion: "c2-descriptive-thresholds-v1",
      flagNote: "Descriptive only; no candidate selection, deletion, merge, or reweighting.",
    });
  }
  const incrementalContribution: any = { methodology: "Conditional incremental policy comparison; evaluated on shared regime-labeled ledger dates, not regime-optimized portfolios; differences are not causal.",
    units: { netReturn: "decimal", sharpe: "annualized ratio", volatility: "annualized decimal",
      cost: "B3 native currency units", allocationDistance: "half-L1 normalized weight distance" },
    conditional: [], rolling: [] };
  if (sources.c1?.children?.length) {
    const fullChild = sources.c1.children.find((child: any) => !(child.excludedCandidateIds ?? []).length);
    for (const child of sources.c1.children.filter((item: any) => (item.excludedCandidateIds ?? []).length)) {
      const variantId = child.excludedCandidateIds[0];
      if (!selected.some((item) => item.policyId === variantId)) continue;
      const variant = child.result as B3Result, full = fullChild?.result as B3Result | undefined;
      const rows = regimeNames.map((regime) => {
        const common = new Set(regimeInfo.series.filter((item: any) => item.label === regime).map((item: any) => item.date));
        const dailyDates = [...common].filter((date) => full?.dailyLedger.some((entry) => entry.date === date) &&
          variant?.dailyLedger.some((entry) => entry.date === date));
        const matchedDailyDates = new Set(dailyDates);
        const fullStats = full ? dailyResultStats(full, matchedDailyDates, input.minSharpeObservations) : null;
        const withoutStats = variant ? dailyResultStats(variant, matchedDailyDates, input.minSharpeObservations) : null;
        const fullDecisions = full?.decisions.map((decision) => decision.decisionDate) ?? [];
        const variantDecisions = new Set(variant?.decisions.map((decision) => decision.decisionDate) ?? []);
        const decisionDates = fullDecisions.filter((date) => variantDecisions.has(date) && common.has(date));
        const fullPolicyIds = full?.policyIdentity.candidateIds ??
          sources.c1?.manifest?.candidateIds ?? sources.allocationRequest.candidateIds;
        const allocationDistances = full && variant
          ? decisionDates.flatMap((date) => {
            const value = decisionDistances(full, variant, date, fullPolicyIds);
            return value ? [value] : [];
          }) : [];
        return { alphaId: variantId, regime, observations: dailyDates.length,
          dailyDates, full: fullStats, without: withoutStats,
          deltas: fullStats && withoutStats ? { meanReturn: fullStats.mean === null || withoutStats.mean === null ? null : fullStats.mean - withoutStats.mean,
            volatility: fullStats.volatility === null || withoutStats.volatility === null ? null : fullStats.volatility - withoutStats.volatility,
            sharpe: fullStats.sharpe === null || withoutStats.sharpe === null ? null : fullStats.sharpe - withoutStats.sharpe,
            cost: fullStats.totalCosts === null || withoutStats.totalCosts === null ? null : fullStats.totalCosts - withoutStats.totalCosts } : null,
          matchedDecisionDates: decisionDates, allocationDistances,
          status: dailyDates.length < input.minSharpeObservations ? "INSUFFICIENT_HISTORY" : "AVAILABLE" };
      });
      incrementalContribution.conditional.push(...rows);
    }
  }
  const developmentPeriod = sources.c1?.manifest?.developmentPeriod;
  const holdoutStartDate = sources.c1?.manifest?.holdoutStartDate;
  const orderedDates = developmentPeriod ? dates.filter((date) => date >= developmentPeriod.startDate &&
    date <= developmentPeriod.endDate && (!holdoutStartDate || date < holdoutStartDate)) : [];
  const rollingWindows: Array<{ startDate: string; endDate: string }> = [];
  for (let end = input.contributionWindow; end <= orderedDates.length; end += input.contributionStep)
    rollingWindows.push({ startDate: orderedDates[end - input.contributionWindow], endDate: orderedDates[end - 1] });
  incrementalContribution.rollingConfiguration = {
    period: orderedDates.length
      ? { startDate: orderedDates[0], endDate: orderedDates.at(-1) }
      : { startDate: null, endDate: null },
    c1DevelopmentPeriod: developmentPeriod ?? null, holdoutStartDate: holdoutStartDate ?? null,
    windowObservations: input.contributionWindow, stepObservations: input.contributionStep,
    selectedAlphaIds: [...input.alphaIds], maximumCandidates: 5, predeclaredWindows: rollingWindows,
  };
  incrementalContribution.rollingStatus = rollingWindows.length && sources.c1?.manifest?.plans
    ? "AVAILABLE" : "INSUFFICIENT_HISTORY";
  for (const selectedAlpha of selected) for (const window of rollingWindows) {
    const rerun = runWindowPair(sources, input, window.startDate, window.endDate, selectedAlpha.policyId);
    const base = rerun && "baseline" in rerun ? rerun.baseline : null;
    const without = rerun && "excluded" in rerun ? rerun.excluded : null;
    const sameDecisionDates = base && without &&
      JSON.stringify(base.decisions.map((item) => item.decisionDate)) ===
        JSON.stringify(without.decisions.map((item) => item.decisionDate));
    const sameLedgerDates = base && without &&
      JSON.stringify(base.dailyLedger.map((item) => item.date)) ===
        JSON.stringify(without.dailyLedger.map((item) => item.date));
    const sameEstimationHistory = base && without && base.decisions.every((decision) => {
      const other = without.decisions.find((item) => item.decisionDate === decision.decisionDate);
      return other && JSON.stringify(other.estimationDates) === JSON.stringify(decision.estimationDates);
    });
    const comparable = base?.status === "completed" && without?.status === "completed" &&
      base.decisions.length >= 2 && without.decisions.length >= 2 &&
      sameDecisionDates && sameLedgerDates && sameEstimationHistory;
    const metrics = (result: B3Result | null | undefined) => result?.metrics ?? null;
    const fullMetrics = metrics(base), withoutMetrics = metrics(without);
    const fullPolicyIds = base?.policyIdentity.candidateIds ?? sources.c1?.manifest?.candidateIds ??
      sources.allocationRequest.candidateIds;
    const windowDecisionDistances = comparable ? base!.decisions.flatMap((decision) => {
      const result = decisionDistances(base!, without!, decision.decisionDate, fullPolicyIds);
      return result ? [result] : [];
    }) : [];
    const windowAlignment = rerun && "alignmentPlan" in rerun ? rerun.alignmentPlan : null;
    incrementalContribution.rolling.push({ alphaId: selectedAlpha.candidate.candidateId,
      policyCandidateId: selectedAlpha.policyId, ...window,
      alignment: windowAlignment ? { rule: windowAlignment.rule,
        referenceCandidateIds: windowAlignment.referenceCandidateIds,
        plannedDecisions: windowAlignment.decisions.length,
        alignedDecisions: windowAlignment.decisions.filter((item) => !item.failureReason).length,
        failedDecisions: windowAlignment.decisions.filter((item) => item.failureReason).length } : null,
      metrics: comparable ? {
        netReturnDelta: fullMetrics?.cumulativeReturn !== null && withoutMetrics?.cumulativeReturn !== null
          ? fullMetrics!.cumulativeReturn! - withoutMetrics!.cumulativeReturn! : null,
        sharpeDelta: fullMetrics?.sharpe !== null && withoutMetrics?.sharpe !== null ? fullMetrics!.sharpe! - withoutMetrics!.sharpe! : null,
        volatilityDelta: fullMetrics?.annualizedVolatility !== null && withoutMetrics?.annualizedVolatility !== null
          ? fullMetrics!.annualizedVolatility! - withoutMetrics!.annualizedVolatility! : null,
        drawdownDelta: fullMetrics?.maximumDrawdown !== null && withoutMetrics?.maximumDrawdown !== null
          ? fullMetrics!.maximumDrawdown! - withoutMetrics!.maximumDrawdown! : null,
        costDelta: fullMetrics?.totalTransactionCosts !== null && withoutMetrics?.totalTransactionCosts !== null
          ? fullMetrics!.totalTransactionCosts! - withoutMetrics!.totalTransactionCosts! : null,
      } : null, allocationDistances: windowDecisionDistances, status: comparable ? "AVAILABLE" :
        rerun && "error" in rerun ? "INSUFFICIENT_HISTORY" : "INSUFFICIENT_HISTORY",
      reason: comparable ? null : "INSUFFICIENT_HISTORY: independent full/exclusion B3 reruns require at least two valid decisions and complete shared ledgers." });
  }
  return {
    engineVersion: C2_ENGINE_VERSION,
    source: { allocationId: input.allocationId, validationPreparedInputId: input.validationPreparedInputId,
      c1ExperimentId: input.c1ExperimentId, regimeSource: input.regimeSource,
      regimeVersion: regimeInfo.version, policyDatasetHash: sources.policy.dataset.sha256,
      validationDatasetHash: sources.validation.dataset.sha256, policyEngineVersion: sources.policy.engineVersion,
      validationEngineVersion: sources.validation.engineVersion, selectedAlphaIds: input.alphaIds,
      b1AlphaIds: candidates.map((candidate) => candidate.candidateId),
      validationCandidateIds: Object.fromEntries(input.alphaIds.map((id, index) => [id, candidates[index].candidateId])),
      policyCandidateIds: Object.fromEntries(selected.map((item) => [item.candidate.candidateId, item.policyId])),
      b2Policy: { representation: sources.allocationRequest.representation,
        candidateIds: [...sources.allocationRequest.candidateIds], estimationWindow: sources.allocationRequest.estimationWindow,
        minObservations: sources.allocationRequest.minObservations, objective: structuredClone(sources.allocationRequest.objective),
        returnConvention: sources.allocationRequest.returnConvention },
      b3EngineVersions: [...new Set((sources.c1?.children ?? []).map((child: any) =>
        child.result?.diagnostics?.engineVersion).filter(Boolean))],
      c1ManifestSchemaVersion: sources.c1?.manifest?.schemaVersion ?? null },
    configuration: structuredClone(input),
    thresholds: { version: "c2-descriptive-thresholds-v1", tolerance: TOLERANCE,
      minRollingPaired: input.minRollingPaired, minRegimePaired: input.minRegimePaired,
      minSharpeObservations: input.minSharpeObservations, highCorrelationThreshold: input.highCorrelationThreshold,
      materialCorrelationGap: input.materialCorrelationGap },
    stability: { methodology: "Rolling B1 alpha-stream returns and their B1 ledger; sample standard deviation; Sharpe uses daily excess return and sqrt(252).", alphas: stability },
    regimes: { status: regimeInfo.available ? "AVAILABLE" : "REGIME_ANALYSIS_UNAVAILABLE",
      source: input.regimeSource, version: regimeInfo.version, mapping: structuredClone(input.regimeMapping),
      series: regimeInfo.series, conditionalPerformance: conditional,
      units: { returns: "daily decimal", volatility: "annualized decimal", sharpe: "annualized ratio" } },
    dependence: { method: "Separate alpha-return correlation, rolling Pearson correlation, conditional correlation, normalized exposure L1 distance, and optimized capital weights.", pairs: dependence },
    incrementalContribution,
    methodology: { numericTolerance: TOLERANCE, undefinedMetrics: "null with explicit reason/status; no zero fill or interpolation.",
      selection: "Evidence only: no automatic ranking, selection, merging, deletion, reweighting, or promotion.",
      quantities: { stability: "B1 tradable alpha-stream returns and ledger", dependence: "B1 daily alpha-stream returns / B1 target underlying exposures / B3 optimized capital weights",
        incrementalContribution: "B3 full and C1 exclusion policy daily ledgers and decisions" } },
  };
}

export interface C2Output {
  engineVersion: string;
  source: Record<string, unknown>;
  configuration: C2Input;
  thresholds: Record<string, unknown>;
  stability: any;
  regimes: any;
  dependence: any;
  incrementalContribution: any;
  methodology: Record<string, unknown>;
}