/**
 * Allocation Lab v2 — Scenario & Stress Lab (Iteration 12)
 *
 * Two engines built on the same real price history used everywhere else in
 * the app — no synthetic or placeholder return assumptions:
 *
 *  - Scenario Analysis: the user sets a hypothetical % move in a macro proxy
 *    instrument (e.g. "SPY -20%") or a direct shock to a specific ETF. Each
 *    holding's estimated response is derived from its own historical
 *    sensitivity to that proxy (regression beta, or a correlation-scaled
 *    fallback when the regression window is too short/noisy), or taken
 *    directly from the user's per-ETF shock when one is supplied.
 *
 *  - Stress Testing: predefined historical episodes (date windows). When the
 *    uploaded price history actually covers the window, each holding's
 *    contribution is its own *realized* historical return over that window
 *    ("historical-replay") — not a model estimate. When a holding lacks
 *    price coverage for the window, it falls back to a correlation-scaled
 *    estimate via SPY's realized return in the window, or is excluded with
 *    a stated reason if even that isn't possible.
 *
 * Every result carries a basis tag per holding so the UI can show exactly
 * how each number was derived, and the whole result is gated on
 * hasSufficientData with a plain-language reason instead of ever fabricating
 * a number.
 */

import type { AllocationResult, EtfEntry, PriceRow } from "./calculator";

export type MacroShockKey = "equityBeta" | "rates" | "usd" | "oilCommodities" | "volatility" | "creditSpreads";

export type ImpactBasis = "historical-beta" | "correlation-shock" | "direct-etf-shock" | "historical-replay" | "excluded";

export interface MacroProxyInfo {
  key: MacroShockKey;
  label: string;
  description: string;
  candidateTickers: string[];
  resolvedTicker: string | null;
  available: boolean;
}

export interface MacroShockInput {
  key: MacroShockKey;
  magnitudePct: number; // assumed % return of the proxy instrument, e.g. -20 for -20%
}

export interface CustomEtfShockInput {
  ticker: string;
  magnitudePct: number; // assumed direct % return for this ETF
}

export interface PredefinedStressScenario {
  id: string;
  label: string;
  description: string;
  startDate: string;
  endDate: string;
}

export interface EtfShockContribution {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  assumedReturnPct: number;
  contributionPct: number; // weight * assumedReturnPct, in portfolio-return percentage points
  basis: ImpactBasis;
  basisDetail: string;
}

export interface BucketContribution {
  key: string;
  label: string;
  weight: number;
  contributionPct: number;
}

export interface ScenarioWarning {
  id: string;
  severity: "warn" | "fail";
  message: string;
}

export interface ScenarioStressResult {
  hasSufficientData: boolean;
  insufficientReason: string | null;
  basisSummary: string;
  portfolioImpactPct: number | null;
  cashWeight: number;
  cashBufferAdequate: boolean | null;
  cashBufferNote: string;
  etfContributions: EtfShockContribution[];
  bucketContributions: BucketContribution[];
  largestRiskDrivers: EtfShockContribution[];
  watchItems: string[];
  warnings: ScenarioWarning[];
  excludedTickers: { ticker: string; reason: string }[];
}

const MIN_LOOKBACK = 21;
const LOOKBACK_PREFERRED = 126;
const MIN_OBS_FOR_BETA = 30;
const MIN_OBS_FOR_CORRELATION = 10;

export const MACRO_PROXIES: Omit<MacroProxyInfo, "resolvedTicker" | "available">[] = [
  { key: "equityBeta", label: "SPX / Equity Beta", description: "Broad equity market move", candidateTickers: ["SPY", "QQQ"] },
  { key: "rates", label: "Rates", description: "Interest-rate-sensitive move (long-duration bond proxy)", candidateTickers: ["TLT", "IEF", "AGG", "BND"] },
  { key: "usd", label: "USD", description: "US dollar strength/weakness", candidateTickers: ["UUP"] },
  { key: "oilCommodities", label: "Oil / Commodities", description: "Energy and broad commodity move", candidateTickers: ["USO", "DBC", "XLE"] },
  { key: "volatility", label: "Volatility", description: "Vol spike/compression (long-vol instrument)", candidateTickers: ["VXX", "UVXY"] },
  { key: "creditSpreads", label: "Credit Spreads", description: "High-yield credit spread move (HY bond proxy)", candidateTickers: ["HYG", "JNK", "LQD"] },
];

export const PREDEFINED_STRESS_SCENARIOS: PredefinedStressScenario[] = [
  { id: "covid_crash", label: "COVID Crash", description: "Feb–Mar 2020 pandemic selloff", startDate: "2020-02-19", endDate: "2020-03-23" },
  { id: "rates_shock_2022", label: "2022 Rates Shock", description: "H1 2022 Fed tightening cycle drawdown", startDate: "2022-01-03", endDate: "2022-06-16" },
  { id: "regional_banking_2023", label: "Regional Banking Crisis", description: "Mar 2023 SVB / Signature Bank collapse", startDate: "2023-03-08", endDate: "2023-03-13" },
  { id: "tech_unwind_2024", label: "Tech Unwind / AI Selloff", description: "Jul–Aug 2024 carry-trade unwind & tech growth selloff", startDate: "2024-07-16", endDate: "2024-08-05" },
  { id: "dollar_rally_2022", label: "Risk-Off Dollar Rally", description: "Sep 2022 broad dollar strength amid global risk-off", startDate: "2022-09-01", endDate: "2022-09-30" },
  { id: "inflation_oil_2022", label: "Inflation / Oil Shock", description: "Feb–Mar 2022 commodity spike following the Russia invasion of Ukraine", startDate: "2022-02-24", endDate: "2022-03-08" },
];

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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
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

function stdev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

/** Simple OLS beta of y on x, using the last n observations of each. */
function regressionBeta(y: number[], x: number[], n: number): number | null {
  const yy = y.slice(0, n);
  const xx = x.slice(0, n);
  const mx = mean(xx);
  const my = mean(yy);
  let cov = 0;
  let varX = 0;
  for (let t = 0; t < n; t++) {
    cov += (xx[t] - mx) * (yy[t] - my);
    varX += (xx[t] - mx) ** 2;
  }
  if (varX === 0) return null;
  return cov / varX;
}

function pricesByTickerFromRows(priceRows: PriceRow[], tickers: string[]): Record<string, { date: string; price: number }[]> {
  const out: Record<string, { date: string; price: number }[]> = {};
  for (const t of tickers) out[t] = [];
  for (const row of priceRows) {
    for (const t of tickers) {
      if (row.prices[t] !== undefined) out[t].push({ date: row.date, price: row.prices[t] });
    }
  }
  return out;
}

function emptyResult(reason: string, cashWeight = 0): ScenarioStressResult {
  return {
    hasSufficientData: false,
    insufficientReason: reason,
    basisSummary: "",
    portfolioImpactPct: null,
    cashWeight,
    cashBufferAdequate: null,
    cashBufferNote: "",
    etfContributions: [],
    bucketContributions: [],
    largestRiskDrivers: [],
    watchItems: [],
    warnings: [{ id: "insufficient_data", severity: "fail", message: reason }],
    excludedTickers: [],
  };
}

function buildBuckets(contributions: EtfShockContribution[], cashWeight: number): BucketContribution[] {
  const map = new Map<string, { weight: number; contributionPct: number }>();
  for (const c of contributions) {
    const b = map.get(c.sector) ?? { weight: 0, contributionPct: 0 };
    b.weight += c.weight;
    b.contributionPct += c.contributionPct;
    map.set(c.sector, b);
  }
  const buckets: BucketContribution[] = Array.from(map.entries()).map(([sector, v]) => ({
    key: sector,
    label: sector,
    weight: round4(v.weight),
    contributionPct: round2(v.contributionPct),
  }));
  buckets.push({ key: "cash", label: "Cash", weight: round4(cashWeight), contributionPct: 0 });
  buckets.sort((a, b) => a.contributionPct - b.contributionPct);
  return buckets;
}

function cashBufferAssessment(portfolioImpactPct: number, cashWeight: number): { adequate: boolean; note: string } {
  if (portfolioImpactPct >= 0) {
    return { adequate: true, note: "Estimated impact is non-negative — cash buffer is not being tested by this scenario." };
  }
  const lossFraction = Math.abs(portfolioImpactPct) / 100;
  if (lossFraction <= cashWeight) {
    return {
      adequate: true,
      note: `Estimated drawdown of ${Math.abs(portfolioImpactPct).toFixed(1)}% is within the ${(cashWeight * 100).toFixed(1)}% cash buffer.`,
    };
  }
  return {
    adequate: false,
    note: `Estimated drawdown of ${Math.abs(portfolioImpactPct).toFixed(1)}% exceeds the ${(cashWeight * 100).toFixed(1)}% cash buffer by ${(lossFraction * 100 - cashWeight * 100).toFixed(1)} points — a redemption or margin call during this scenario could force selling into weakness.`,
  };
}

function buildWatchItems(contributions: EtfShockContribution[], cashAssessment: { adequate: boolean; note: string }, excluded: { ticker: string; reason: string }[]): string[] {
  const items: string[] = [];
  const losers = contributions.filter((c) => c.contributionPct < 0).sort((a, b) => a.contributionPct - b.contributionPct);
  for (const l of losers.slice(0, 3)) {
    items.push(`${l.ticker} (${l.name}) drives ${Math.abs(l.contributionPct).toFixed(1)}pp of the estimated loss at ${(l.weight * 100).toFixed(1)}% weight — review sizing if this scenario is a live concern.`);
  }
  if (!cashAssessment.adequate) items.push(cashAssessment.note);
  if (excluded.length > 0) {
    items.push(`${excluded.length} holding${excluded.length > 1 ? "s" : ""} excluded from this estimate (${excluded.map((e) => e.ticker).join(", ")}) — impact is understated relative to full coverage.`);
  }
  if (items.length === 0) items.push("No single holding or exclusion stands out — impact is broadly distributed across the portfolio.");
  return items;
}

// ── Scenario Analysis ──────────────────────────────────────────────────────

export function resolveMacroProxies(availableTickers: string[], priceRows: PriceRow[]): MacroProxyInfo[] {
  return MACRO_PROXIES.map((p) => {
    const resolved = p.candidateTickers.find((t) => availableTickers.includes(t) && priceRows.some((r) => r.prices[t] !== undefined));
    return { ...p, resolvedTicker: resolved ?? null, available: !!resolved };
  });
}

export function computeScenarioAnalysis(
  priceRows: PriceRow[],
  allocations: AllocationResult[],
  etfMap: Map<string, EtfEntry>,
  availableTickers: string[],
  cashWeight: number,
  macroShocks: MacroShockInput[],
  customEtfShocks: CustomEtfShockInput[]
): ScenarioStressResult {
  const activeAllocs = allocations.filter((a) => a.active && a.weight > 0.001);
  if (activeAllocs.length === 0) {
    return emptyResult("No active ETFs in the current allocation — run the pipeline in Portfolio Lab first.", cashWeight);
  }
  if (macroShocks.length === 0 && customEtfShocks.length === 0) {
    return emptyResult("No shocks configured — set at least one macro shock magnitude or a custom ETF shock to run scenario analysis.", cashWeight);
  }

  const activeTickers = activeAllocs.map((a) => a.ticker);
  const proxies = resolveMacroProxies(availableTickers, priceRows);
  const proxyTickers = proxies.map((p) => p.resolvedTicker).filter((t): t is string => !!t);
  const allTickers = Array.from(new Set([...activeTickers, ...proxyTickers]));
  const priceMap = pricesByTickerFromRows(priceRows, allTickers);

  const coveragePerActive = activeTickers.map((t) => Math.max(0, priceMap[t].length - 1));
  const usedLookback = Math.min(LOOKBACK_PREFERRED, ...coveragePerActive);
  if (usedLookback < MIN_LOOKBACK) {
    return emptyResult(`Only ${Math.max(0, usedLookback)} overlapping return observations across active ETFs — need at least ${MIN_LOOKBACK} for a scenario estimate.`, cashWeight);
  }

  const warnings: ScenarioWarning[] = [];
  const returnsByTicker: Record<string, number[]> = {};
  for (const t of allTickers) returnsByTicker[t] = getReturns(priceMap[t].slice(-(usedLookback + 1)).map((r) => r.price));

  const unavailableProxies = proxies.filter((p) => macroShocks.some((s) => s.key === p.key) && !p.available);
  for (const p of unavailableProxies) {
    warnings.push({ id: `proxy_unavailable_${p.key}`, severity: "warn", message: `${p.label}: no proxy instrument (${p.candidateTickers.join("/")}) found in the uploaded price data — this shock was skipped.` });
  }

  const customByTicker = new Map(customEtfShocks.map((c) => [c.ticker, c.magnitudePct]));
  const contributions: EtfShockContribution[] = [];
  const totalActiveWeight = activeAllocs.reduce((s, a) => s + a.weight, 0);

  for (const alloc of activeAllocs) {
    const etf = etfMap.get(alloc.ticker);
    const w = alloc.weight;

    if (customByTicker.has(alloc.ticker)) {
      const assumedReturnPct = customByTicker.get(alloc.ticker)!;
      contributions.push({
        ticker: alloc.ticker,
        name: etf?.name ?? alloc.name,
        sector: etf?.sector ?? alloc.sector,
        weight: round4(w),
        assumedReturnPct: round2(assumedReturnPct),
        contributionPct: round2((assumedReturnPct * w) / (totalActiveWeight || 1)),
        basis: "direct-etf-shock",
        basisDetail: "User-defined direct shock to this ETF, applied as-is.",
      });
      continue;
    }

    let totalAssumedReturn = 0;
    const details: string[] = [];
    let usedAnyProxy = false;
    let usedFallback = false;

    for (const shock of macroShocks) {
      const proxy = proxies.find((p) => p.key === shock.key);
      if (!proxy?.resolvedTicker) continue;
      const proxyReturns = returnsByTicker[proxy.resolvedTicker];
      const etfReturns = returnsByTicker[alloc.ticker];
      const n = Math.min(proxyReturns.length, etfReturns.length);
      if (n < MIN_OBS_FOR_CORRELATION) continue;
      usedAnyProxy = true;

      let sensitivity: number | null;
      let basisNote: string;
      if (n >= MIN_OBS_FOR_BETA) {
        sensitivity = regressionBeta(etfReturns, proxyReturns, n);
        basisNote = `beta ${sensitivity !== null ? sensitivity.toFixed(2) : "n/a"} to ${proxy.resolvedTicker} over ${n}d`;
      } else {
        const corr = pearsonCorr(etfReturns.slice(0, n), proxyReturns.slice(0, n));
        const sEtf = stdev(etfReturns.slice(0, n));
        const sProxy = stdev(proxyReturns.slice(0, n));
        sensitivity = !isNaN(corr) && sProxy > 0 ? corr * (sEtf / sProxy) : null;
        basisNote = `correlation-scaled sensitivity ${sensitivity !== null ? sensitivity.toFixed(2) : "n/a"} to ${proxy.resolvedTicker} over a short ${n}d window`;
        usedFallback = true;
      }
      if (sensitivity === null) continue;
      totalAssumedReturn += sensitivity * shock.magnitudePct;
      details.push(`${proxy.label} ${shock.magnitudePct >= 0 ? "+" : ""}${shock.magnitudePct}% x ${basisNote}`);
    }

    if (!usedAnyProxy) {
      contributions.push({
        ticker: alloc.ticker,
        name: etf?.name ?? alloc.name,
        sector: etf?.sector ?? alloc.sector,
        weight: round4(w),
        assumedReturnPct: 0,
        contributionPct: 0,
        basis: "excluded",
        basisDetail: "No macro proxy had enough overlapping history with this ETF — no shock applied.",
      });
      continue;
    }

    contributions.push({
      ticker: alloc.ticker,
      name: etf?.name ?? alloc.name,
      sector: etf?.sector ?? alloc.sector,
      weight: round4(w),
      assumedReturnPct: round2(totalAssumedReturn),
      contributionPct: round2((totalAssumedReturn * w) / (totalActiveWeight || 1)),
      basis: usedFallback ? "correlation-shock" : "historical-beta",
      basisDetail: details.join("; ") || "No macro shock resolved for this ETF.",
    });
  }

  const portfolioImpactPct = round2(contributions.reduce((s, c) => s + c.contributionPct, 0));
  const cashAssessment = cashBufferAssessment(portfolioImpactPct, cashWeight);
  const bucketContributions = buildBuckets(contributions, cashWeight);
  const largestRiskDrivers = contributions
    .slice()
    .sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct))
    .slice(0, 5);
  const excludedTickers = contributions.filter((c) => c.basis === "excluded").map((c) => ({ ticker: c.ticker, reason: c.basisDetail }));
  const watchItems = buildWatchItems(contributions, cashAssessment, excludedTickers);

  const activeShockLabels = macroShocks
    .filter((s) => proxies.find((p) => p.key === s.key)?.available)
    .map((s) => proxies.find((p) => p.key === s.key)!.label);
  const basisParts: string[] = [];
  if (activeShockLabels.length > 0) basisParts.push(`Macro shocks (${activeShockLabels.join(", ")}) applied via each holding's historical beta or, for shorter overlapping windows, a correlation-scaled sensitivity.`);
  if (customEtfShocks.length > 0) basisParts.push(`${customEtfShocks.length} custom ETF shock${customEtfShocks.length > 1 ? "s" : ""} applied directly as user-defined return assumptions.`);
  const basisSummary = basisParts.join(" ") || "No shocks resolved.";

  return {
    hasSufficientData: true,
    insufficientReason: null,
    basisSummary,
    portfolioImpactPct,
    cashWeight: round4(cashWeight),
    cashBufferAdequate: cashAssessment.adequate,
    cashBufferNote: cashAssessment.note,
    etfContributions: contributions.sort((a, b) => a.contributionPct - b.contributionPct),
    bucketContributions,
    largestRiskDrivers,
    watchItems,
    warnings,
    excludedTickers,
  };
}

// ── Stress Testing ─────────────────────────────────────────────────────────

export function computeStressTest(
  priceRows: PriceRow[],
  allocations: AllocationResult[],
  etfMap: Map<string, EtfEntry>,
  availableTickers: string[],
  cashWeight: number,
  window: { startDate: string; endDate: string; label: string }
): ScenarioStressResult {
  const activeAllocs = allocations.filter((a) => a.active && a.weight > 0.001);
  if (activeAllocs.length === 0) {
    return emptyResult("No active ETFs in the current allocation — run the pipeline in Portfolio Lab first.", cashWeight);
  }

  const sorted = priceRows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const windowRows = sorted.filter((r) => r.date >= window.startDate && r.date <= window.endDate);
  if (windowRows.length < 2) {
    return emptyResult(`Uploaded price data does not cover the ${window.label} window (${window.startDate} to ${window.endDate}). Upload a longer price history to run this scenario.`, cashWeight);
  }

  const activeTickers = activeAllocs.map((a) => a.ticker);
  const totalActiveWeight = activeAllocs.reduce((s, a) => s + a.weight, 0);
  const warnings: ScenarioWarning[] = [];

  const spyAvailable = availableTickers.includes("SPY") && windowRows.some((r) => r.prices.SPY !== undefined);
  let spyWindowReturn: number | null = null;
  if (spyAvailable) {
    const spyStart = windowRows.find((r) => r.prices.SPY !== undefined)?.prices.SPY;
    const spyEndRow = [...windowRows].reverse().find((r) => r.prices.SPY !== undefined)?.prices.SPY;
    if (spyStart && spyEndRow) spyWindowReturn = (spyEndRow - spyStart) / spyStart;
  }

  // Precompute recent-history beta to SPY (outside the stress window) for the correlation-shock fallback.
  const recentLookback = Math.min(LOOKBACK_PREFERRED, priceRows.length - 1);
  const betaToSpy = new Map<string, number>();
  if (availableTickers.includes("SPY") && recentLookback >= MIN_OBS_FOR_CORRELATION) {
    const spyPrices = priceRows.slice(-(recentLookback + 1)).map((r) => r.prices.SPY).filter((p): p is number => p !== undefined);
    const spyReturns = getReturns(spyPrices);
    for (const t of activeTickers) {
      const tPrices = priceRows.slice(-(recentLookback + 1)).map((r) => r.prices[t]).filter((p): p is number => p !== undefined);
      const tReturns = getReturns(tPrices);
      const n = Math.min(tReturns.length, spyReturns.length);
      if (n >= MIN_OBS_FOR_CORRELATION) {
        const b = regressionBeta(tReturns, spyReturns, n);
        if (b !== null) betaToSpy.set(t, b);
      }
    }
  }

  const contributions: EtfShockContribution[] = [];
  const excludedTickers: { ticker: string; reason: string }[] = [];

  for (const alloc of activeAllocs) {
    const etf = etfMap.get(alloc.ticker);
    const w = alloc.weight;
    const tickerRows = windowRows.filter((r) => r.prices[alloc.ticker] !== undefined);

    if (tickerRows.length >= 2) {
      const startPrice = tickerRows[0].prices[alloc.ticker];
      const endPrice = tickerRows[tickerRows.length - 1].prices[alloc.ticker];
      const returnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
      contributions.push({
        ticker: alloc.ticker,
        name: etf?.name ?? alloc.name,
        sector: etf?.sector ?? alloc.sector,
        weight: round4(w),
        assumedReturnPct: round2(returnPct),
        contributionPct: round2((returnPct * w) / (totalActiveWeight || 1)),
        basis: "historical-replay",
        basisDetail: `Actual realized return from ${tickerRows[0].date} to ${tickerRows[tickerRows.length - 1].date}.`,
      });
      continue;
    }

    if (spyWindowReturn !== null && betaToSpy.has(alloc.ticker)) {
      const beta = betaToSpy.get(alloc.ticker)!;
      const estReturnPct = beta * spyWindowReturn * 100;
      contributions.push({
        ticker: alloc.ticker,
        name: etf?.name ?? alloc.name,
        sector: etf?.sector ?? alloc.sector,
        weight: round4(w),
        assumedReturnPct: round2(estReturnPct),
        contributionPct: round2((estReturnPct * w) / (totalActiveWeight || 1)),
        basis: "correlation-shock",
        basisDetail: `No price history for this ETF during the window — estimated via its recent beta (${beta.toFixed(2)}) to SPY's realized ${(spyWindowReturn * 100).toFixed(1)}% return in this window.`,
      });
      warnings.push({ id: `fallback_${alloc.ticker}`, severity: "warn", message: `${alloc.ticker} lacked price history during ${window.label} — used a beta-to-SPY estimate instead of realized return.` });
      continue;
    }

    excludedTickers.push({ ticker: alloc.ticker, reason: `No price history during ${window.label} and no SPY-based fallback available.` });
    contributions.push({
      ticker: alloc.ticker,
      name: etf?.name ?? alloc.name,
      sector: etf?.sector ?? alloc.sector,
      weight: round4(w),
      assumedReturnPct: 0,
      contributionPct: 0,
      basis: "excluded",
      basisDetail: `No price history during ${window.label} and no SPY-based fallback available.`,
    });
  }

  if (excludedTickers.length > 0) {
    warnings.push({ id: "excluded_coverage", severity: "warn", message: `${excludedTickers.length} holding${excludedTickers.length > 1 ? "s" : ""} excluded from this estimate for lack of price coverage — the impact below is understated relative to full coverage.` });
  }

  const portfolioImpactPct = round2(contributions.reduce((s, c) => s + c.contributionPct, 0));
  const cashAssessment = cashBufferAssessment(portfolioImpactPct, cashWeight);
  const bucketContributions = buildBuckets(contributions, cashWeight);
  const largestRiskDrivers = contributions
    .slice()
    .sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct))
    .slice(0, 5);
  const watchItems = buildWatchItems(contributions, cashAssessment, excludedTickers);

  const replayCount = contributions.filter((c) => c.basis === "historical-replay").length;
  const basisSummary = `${replayCount} of ${contributions.length} holdings used actual realized returns during ${window.label} (${window.startDate} to ${window.endDate}); the remainder used a correlation-scaled SPY fallback or were excluded for lack of coverage.`;

  return {
    hasSufficientData: true,
    insufficientReason: null,
    basisSummary,
    portfolioImpactPct,
    cashWeight: round4(cashWeight),
    cashBufferAdequate: cashAssessment.adequate,
    cashBufferNote: cashAssessment.note,
    etfContributions: contributions.sort((a, b) => a.contributionPct - b.contributionPct),
    bucketContributions,
    largestRiskDrivers,
    watchItems,
    warnings,
    excludedTickers,
  };
}
