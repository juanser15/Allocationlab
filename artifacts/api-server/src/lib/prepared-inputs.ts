import { createHash } from "node:crypto";
import {
  computeFactors, defaultBacktestConfig, parseCsv, runBacktestEngine,
  resolveExecutionDate, type Constraints, type PriceRow, type RebalanceFrequency, type ExecutionTiming,
} from "./calculator";
import type { FactorDefinition } from "./factor-library";
import { ENGINE_VERSION, hashDataset } from "./run-snapshot";

export type PreparedRepresentation = "asset_returns" | "signals" | "alpha_streams";
export type PreparedStatus = "READY" | "INCOMPLETE" | "INSUFFICIENT_HISTORY" | "INVALID_DATA" | "UNSUPPORTED";
export const PREPARED_INPUT_ENGINE_VERSION = "allocation-b1.0";
export type MappingPolicy = "single_asset_long_cash" | "cross_sectional_long_only";
export interface AlphaDefinition {
  name: string;
  factorId: string;
  assetTickers: string[];
  mapping: MappingPolicy;
  signalUnits: "raw" | "oriented" | "normalized";
  threshold: number;
  grossFraction: number;
  rebalanceFrequency: RebalanceFrequency;
  executionTiming: "next_close" | "same_close";
  transactionCostBps: number;
  slippageBps: number;
  cashYieldAnnual: number;
}
export interface PreparedRequest {
  representation: PreparedRepresentation;
  assetTickers: string[];
  factorIds: string[];
  alphaDefinitions: AlphaDefinition[];
  cutoffDate?: string;
  suppliedWeights?: Record<string, number>;
}
export interface PreparedCandidate {
  candidateId: string;
  canonicalFingerprint: string;
  name: string;
  kind: PreparedRepresentation;
  status: PreparedStatus;
  reasons: string[];
  factorId?: string;
  assetTickers: string[];
  mapping?: AlphaDefinition["mapping"];
  signalUnits?: AlphaDefinition["signalUnits"];
  targetAssetExposures: Record<string, number>;
  actualAssetExposures: Record<string, number>;
  targetHistory: Array<{ signalDate: string; informationCutoff: string; executionDate: string | null; targetPositions: Record<string, number> }>;
  residualCash: number | null;
  signalSeries: Array<{ ticker: string; peerUniverse: string[]; date: string; informationCutoff: string; value: number | null;
    rawValue: number | null; transformedValue: number | null; winsorizedValue: number | null;
    orientedValue: number | null; normalizedValue: number | null }>;
  returnSeries: Array<{ date: string; value: number | null }>;
  ledger: unknown[];
  lineage: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

export interface PreparedSnapshot {
  schemaVersion: 1;
  engineVersion: string;
  a1EngineVersion: string;
  representation: PreparedRepresentation;
  dataset: { id: number | null; sha256: string; csvContent: string; startDate: string; endDate: string; tickers: string[]; priceConvention: string };
  factorSet: { version: string; factors: FactorDefinition[] };
  request: PreparedRequest;
  coverage: Record<string, unknown>;
  candidates: PreparedCandidate[];
  dependence: Record<string, unknown>;
  suppliedWeights: Record<string, number>;
  createdAt: string;
}

const MIN_CORRELATION_OBSERVATIONS = 30;
const supported = new Set(["momentum", "trend_quality", "volatility", "drawdown", "mean_reversion",
  "relative_strength", "diversification_benefit", "return_over_volatility", "ma_distance",
  "downside_beta", "drawdown_recovery"]);
const engineConstraints: Constraints = {
  cashMin: 0, cashMax: 1, maxEtfWeight: 1, minEtfWeight: 0,
  minInclusionThreshold: 0, targetActiveEtfs: 1, diversificationEnabled: false,
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function correlation(a: Array<{ date: string; ticker?: string; value: number | null }>,
  b: Array<{ date: string; ticker?: string; value: number | null }>) {
  const key = (item: { date: string; ticker?: string }) => `${item.ticker ?? ""}\u0000${item.date}`;
  const right = new Map(b.map((item) => [key(item), item.value]));
  const pairs = a.filter((item) => item.value !== null && Number.isFinite(item.value) &&
    right.get(key(item)) !== null && Number.isFinite(right.get(key(item)))).map((item) => [item.value!, right.get(key(item))!] as const);
  if (pairs.length < MIN_CORRELATION_OBSERVATIONS)
    return { value: null, pairedObservations: pairs.length, minimumObservations: MIN_CORRELATION_OBSERVATIONS };
  const am = pairs.reduce((sum, p) => sum + p[0], 0) / pairs.length;
  const bm = pairs.reduce((sum, p) => sum + p[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, p) => sum + (p[0] - am) * (p[1] - bm), 0);
  const da = pairs.reduce((sum, p) => sum + (p[0] - am) ** 2, 0);
  const db = pairs.reduce((sum, p) => sum + (p[1] - bm) ** 2, 0);
  return { value: da > 0 && db > 0 ? numerator / Math.sqrt(da * db) : null,
    pairedObservations: pairs.length, minimumObservations: MIN_CORRELATION_OBSERVATIONS };
}

function signalValue(definition: FactorDefinition, contribution: { rawValue: number | null; normalizedValue: number | null } | undefined,
  units: AlphaDefinition["signalUnits"]): number | null {
  if (!contribution) return null;
  if (units === "normalized") return contribution.normalizedValue !== null && Number.isFinite(contribution.normalizedValue)
    ? contribution.normalizedValue : null;
  if (contribution.rawValue === null || !Number.isFinite(contribution.rawValue)) return null;
  return units === "oriented" && definition.direction === "lower_is_better"
    ? -contribution.rawValue : contribution.rawValue;
}

function contributionAt(rowsBeforeDate: PriceRow[], tickers: string[], factorSet: { factors: FactorDefinition[] },
  factorId: string, ticker: string) {
  const factor = factorSet.factors.find((item) => item.id === factorId);
  if (!factor || !supported.has(factor.calculationType)) return { value: null, factor };
  const data = computeFactors(rowsBeforeDate, tickers, factorSet).find((item) => item.ticker === ticker);
  const contribution = data?.factorContributions.find((item) => item.factorId === factorId);
  return { value: signalValue(factor, contribution, "oriented"), factor };
}

function normalizePrices(rows: PriceRow[], tickers: string[]) {
  const invalid: string[] = [];
  for (const ticker of tickers) {
    const observed = rows.flatMap((row, index) =>
      Number.isFinite(row.prices[ticker]) && row.prices[ticker] > 0 ? [index] : []);
    for (const row of rows) {
      const price = row.prices[ticker];
      if (price !== undefined && (!Number.isFinite(price) || price <= 0))
        invalid.push(`${ticker} has invalid price on ${row.date}`);
    }
    if (observed.length > 1) {
      const first = observed[0], last = observed.at(-1)!;
      const missingInside = rows.slice(first, last + 1).filter((row) =>
        !Number.isFinite(row.prices[ticker]) || row.prices[ticker] <= 0).length;
      if (missingInside) invalid.push(`${ticker} has ${missingInside} missing held-period price observations within its observed coverage.`);
    }
  }
  return invalid;
}

function hasContiguousHistory(rows: PriceRow[], tickers: string[], requiredRows: number): boolean {
  if (rows.length < requiredRows) return false;
  return rows.slice(-requiredRows).every((row) => tickers.every((ticker) =>
    Number.isFinite(row.prices[ticker]) && row.prices[ticker] > 0));
}

function deriveDailyReturns(rows: PriceRow[], ticker: string) {
  return rows.map((row, i) => ({
    date: row.date,
    value: i > 0 && Number.isFinite(rows[i - 1].prices[ticker]) && Number.isFinite(row.prices[ticker]) &&
      rows[i - 1].prices[ticker] > 0 ? row.prices[ticker] / rows[i - 1].prices[ticker] - 1 : null,
  }));
}

export function mapExposure(def: AlphaDefinition, values: Map<string, number | null>): Record<string, number> | null {
  if (def.mapping === "single_asset_long_cash") {
    if (def.assetTickers.length !== 1) return null;
    const ticker = def.assetTickers[0];
    const value = values.get(ticker);
    if (value === null || value === undefined) return null;
    return value > def.threshold ? { [ticker]: def.grossFraction } : {};
  }
  const available = def.assetTickers.map((ticker) => [ticker, values.get(ticker)] as const);
  if (available.some(([, value]) => value === null || value === undefined)) return null;
  const positive = available.map(([ticker, value]) => [ticker, Math.max(value! - def.threshold, 0)] as const);
  const sum = positive.reduce((total, [, value]) => total + value, 0);
  return sum > 0 ? Object.fromEntries(positive.filter(([, value]) => value > 0)
    .map(([ticker, value]) => [ticker, def.grossFraction * value / sum])) : {};
}

function calculateDependence(candidates: PreparedCandidate[]) {
  const signal: unknown[] = [];
  const returns: unknown[] = [];
  const exposure: unknown[] = [];
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    const compatible = a.factorId === b.factorId && a.signalUnits === b.signalUnits &&
      canonicalJson(a.assetTickers) === canonicalJson(b.assetTickers);
    if (compatible && a.signalSeries.length && b.signalSeries.length)
      signal.push({ a: a.candidateId, b: b.candidateId, label: "signal correlation",
        scope: { factorId: a.factorId, assetTickers: a.assetTickers,
          peerUniverse: a.lineage.peerUniverse, signalUnits: a.signalUnits },
        window: [a.signalSeries[0].date, a.signalSeries.at(-1)!.date],
        ...correlation(a.signalSeries, b.signalSeries) });
    if (a.kind === "alpha_streams" && b.kind === "alpha_streams" && a.returnSeries.length && b.returnSeries.length)
      returns.push({ a: a.candidateId, b: b.candidateId, label: "alpha-return correlation",
        window: [a.returnSeries[0].date, a.returnSeries.at(-1)!.date],
        ...correlation(a.returnSeries, b.returnSeries) });
    const tickers = [...new Set([...Object.keys(a.actualAssetExposures), ...Object.keys(b.actualAssetExposures)])].sort();
    const av = tickers.map((t) => a.actualAssetExposures[t] ?? 0);
    const bv = tickers.map((t) => b.actualAssetExposures[t] ?? 0);
    const an = Math.sqrt(av.reduce((s, x) => s + x * x, 0)), bn = Math.sqrt(bv.reduce((s, x) => s + x * x, 0));
    exposure.push({ a: a.candidateId, b: b.candidateId, label: "asset-exposure similarity",
      metric: "cosine similarity of aligned actual asset exposure vectors",
      assetTickers: tickers, value: an > 0 && bn > 0 ? av.reduce((s, x, k) => s + x * bv[k], 0) / (an * bn) : null });
  }
  return { signalCorrelations: signal, alphaReturnCorrelations: returns, assetExposureSimilarities: exposure,
    note: `Descriptive only; correlations require at least ${MIN_CORRELATION_OBSERVATIONS} paired observations.` };
}

function makeCandidateIdentity(def: unknown, name: string) {
  const canonical = { ...(def as Record<string, unknown>) };
  delete canonical.name;
  const id = fingerprint(canonical);
  return { canonicalFingerprint: id, candidateId: id, name };
}

export function prepareSnapshot(args: {
  request: PreparedRequest; csvContent: string; factorVersion: string; factors: FactorDefinition[]; datasetId?: number;
}): PreparedSnapshot {
  const { request } = args;
  const fullRows = parseCsv(args.csvContent);
  const rows = request.cutoffDate ? fullRows.filter((row) => row.date <= request.cutoffDate!) : fullRows;
  const tickers = [...new Set(request.assetTickers.map((ticker) => ticker.toUpperCase()))];
  const factorSet = { factors: structuredClone(args.factors) };
  const byFactor = new Map(factorSet.factors.map((f) => [f.id, f]));
  const candidates: PreparedCandidate[] = [];
  const invalidPrices = normalizePrices(rows, tickers);
  const dataHash = hashDataset(args.csvContent);
  const sourceLineage = { datasetHash: dataHash, priceDataId: args.datasetId ?? null, priceConvention: "persisted adjusted-close CSV",
    calendar: "uploaded observation dates", returnUnits: "simple close-to-close returns", a1EngineVersion: ENGINE_VERSION };

  if (request.representation === "asset_returns") {
    for (const ticker of tickers) {
      const series = deriveDailyReturns(rows, ticker);
      const valid = series.filter((point) => point.value !== null).length;
      const ident = makeCandidateIdentity({ type: "asset_returns", ticker, datasetHash: dataHash }, ticker);
      const assetIssues = normalizePrices(rows, [ticker]);
      const hasPrices = rows.some((row) => Number.isFinite(row.prices[ticker]));
      candidates.push({
        ...ident, kind: "asset_returns", status: !hasPrices ? "INCOMPLETE" : assetIssues.length ? "INVALID_DATA"
          : valid ? "READY" : "INSUFFICIENT_HISTORY",
        reasons: !hasPrices ? [`No price observations for ${ticker}.`] : assetIssues.length ? assetIssues
          : valid ? [] : ["No consecutive valid adjusted-close observations."],
        assetTickers: [ticker], targetAssetExposures: {}, actualAssetExposures: {}, targetHistory: [], residualCash: null,
        signalSeries: [], returnSeries: series, ledger: [], lineage: { ...sourceLineage, instrumentId: ticker },
        diagnostics: { coverage: rows.length ? valid / Math.max(rows.length - 1, 1) : 0, validReturnObservations: valid,
          deployableAllocation: false, note: "Asset returns are research inputs; no exposure mapping or deployable allocation is implied." },
      });
    }
  } else {
    const definitions = request.representation === "signals"
      ? request.factorIds.flatMap((factorId) => tickers.map((ticker) => ({
        name: `${factorId}:${ticker}`, factorId, assetTickers: [ticker], mapping: "single_asset_long_cash" as const,
        signalUnits: "oriented" as const, threshold: 0, grossFraction: 0, rebalanceFrequency: "monthly" as const,
        executionTiming: "next_close" as const, transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
      })))
      : request.alphaDefinitions;
    for (const definition of definitions) {
      const factor = byFactor.get(definition.factorId);
      const universe = [...new Set(definition.assetTickers.map((ticker) => ticker.toUpperCase()))];
      const commonReasons: string[] = [];
      let status: PreparedStatus = "READY";
      if (!factor) { status = "INCOMPLETE"; commonReasons.push(`Required factor definition ${definition.factorId} is missing.`); }
      else if (!supported.has(factor.calculationType)) { status = "UNSUPPORTED"; commonReasons.push(`Unsupported executable factor calculation: ${factor.calculationType}.`); }
      else if (!factor.enabled || factor.status !== "active") {
        status = "INCOMPLETE"; commonReasons.push(`Factor ${factor.id} is not enabled and active in the frozen factor library.`);
      }
      if (factor?.benchmarkTicker && !tickers.includes(factor.benchmarkTicker.toUpperCase())) {
        status = "INCOMPLETE"; commonReasons.push(`Required benchmark ${factor.benchmarkTicker} must be included in the declared input universe.`);
      }
      if (definition.mapping === "single_asset_long_cash" && universe.length !== 1) {
        status = "INCOMPLETE"; commonReasons.push("single_asset_long_cash requires exactly one asset.");
      }
      if (definition.mapping === "cross_sectional_long_only" && universe.length < 2) {
        status = "INCOMPLETE"; commonReasons.push("cross_sectional_long_only requires a declared peer universe of at least two assets.");
      }
      if (definition.grossFraction < 0 || definition.grossFraction > 1) {
        status = "UNSUPPORTED"; commonReasons.push("Signed or leveraged gross fractions are unsupported; grossFraction must be between 0 and 1.");
      }
      const required = factor ? factor.lookback + factor.lag + 2 : Infinity;
      if (rows.length < required && status === "READY") {
        status = "INSUFFICIENT_HISTORY"; commonReasons.push(`Need ${required} dated rows for the factor lookback and lag; found ${rows.length}.`);
      }
      if (universe.some((ticker) => !tickers.includes(ticker))) {
        status = "INCOMPLETE"; commonReasons.push("Candidate references an asset outside the selected asset universe.");
      }
      if (universe.some((ticker) => !rows.some((row) => Number.isFinite(row.prices[ticker])))) {
        status = "INCOMPLETE"; commonReasons.push("One or more required assets have no finite observations in the selected dataset.");
      }
      const absentUniverse = universe.filter((ticker) => !rows.some((row) => Number.isFinite(row.prices[ticker])));
      const candidatePriceIssues = normalizePrices(rows, universe);
      if (absentUniverse.length) {
        status = "INCOMPLETE";
      } else if (candidatePriceIssues.length) {
        status = "INVALID_DATA";
        commonReasons.push(...candidatePriceIssues);
      }
      const ident = makeCandidateIdentity({ factorId: definition.factorId, factorVersion: factor?.version,
        factorCalculationType: factor?.calculationType,
        executableDefinition: factor && { formula: factor.formula, benchmarkTicker: factor.benchmarkTicker,
          inputSeries: factor.inputSeries, missingDataTreatment: factor.missingDataTreatment },
        parameters: factor && { lookback: factor.lookback, lag: factor.lag, direction: factor.direction,
          normalization: factor.normalization, winsorizationLower: factor.winsorizationLower,
          winsorizationUpper: factor.winsorizationUpper }, universe,
        mapping: request.representation === "signals" ? null : definition.mapping,
        signalUnits: request.representation === "signals" ? "oriented" : definition.signalUnits,
        threshold: request.representation === "signals" ? null : definition.threshold,
        grossFraction: request.representation === "signals" ? null : definition.grossFraction,
        frequency: definition.rebalanceFrequency, timing: definition.executionTiming,
        costs: [definition.transactionCostBps, definition.slippageBps], cashYieldAnnual: definition.cashYieldAnnual,
        datasetHash: dataHash, representation: request.representation }, definition.name);
      const signalSeries: PreparedCandidate["signalSeries"] = [];
      const peerUniverse = request.representation === "signals" ? tickers : universe;
      const signalAssets = request.representation === "signals" ? universe : universe;
      const requiredHistory = factor ? factor.lookback + factor.lag + 1 : Infinity;
      if (factor && supported.has(factor.calculationType)) {
        for (let i = 1; i < rows.length; i++) {
          const prefix = rows.slice(0, i);
          const enoughHistory = hasContiguousHistory(prefix, peerUniverse, requiredHistory);
          const values = enoughHistory ? computeFactors(prefix, peerUniverse, factorSet) : [];
          for (const ticker of signalAssets) {
            const found = values.find((item) => item.ticker === ticker);
            const contribution = found?.factorContributions.find((item) => item.factorId === factor.id);
            const rawValue = contribution?.rawValue !== undefined && contribution.rawValue !== null &&
              Number.isFinite(contribution.rawValue) ? contribution.rawValue : null;
            const transformedValue = contribution?.transformedValue !== undefined && contribution.transformedValue !== null &&
              Number.isFinite(contribution.transformedValue) ? contribution.transformedValue : null;
            const winsorizedValue = contribution?.winsorizedValue !== undefined && contribution.winsorizedValue !== null &&
              Number.isFinite(contribution.winsorizedValue) ? contribution.winsorizedValue : null;
            const orientedValue = rawValue === null ? null
              : factor.direction === "lower_is_better" ? -rawValue : rawValue;
            const normalizedValue = contribution?.normalizedValue !== undefined && contribution.normalizedValue !== null &&
              Number.isFinite(contribution.normalizedValue) ? contribution.normalizedValue : null;
            const value = definition.signalUnits === "raw" ? rawValue
              : definition.signalUnits === "oriented" ? orientedValue : normalizedValue;
            signalSeries.push({ ticker, peerUniverse, date: rows[i].date, informationCutoff: rows[i - 1].date,
              value, rawValue, transformedValue, winsorizedValue, orientedValue, normalizedValue });
          }
        }
      }
      if (status === "READY" && signalSeries.length && !signalSeries.some((point) => point.value !== null)) {
        status = "INSUFFICIENT_HISTORY";
        commonReasons.push("Factor calculation produced no finite point-in-time signal observations.");
      }
      let targetAssetExposures: Record<string, number> = {};
      let actualAssetExposures: Record<string, number> = {};
      const targetHistory: PreparedCandidate["targetHistory"] = [];
      let residualCash: number | null = null;
      let ledger: unknown[] = [];
      let returnSeries: PreparedCandidate["returnSeries"] = [];
      if (request.representation === "alpha_streams" && status === "READY") {
        const historyFactor = factor!;
        const etfs = universe.map((ticker) => ({ ticker, name: ticker, sector: "Unknown", priorWeight: 0, enabled: true }));
        const warmup = Math.max(1, historyFactor.lookback + historyFactor.lag);
        const backtestConfig = {
          ...defaultBacktestConfig(), rebalanceFrequency: definition.rebalanceFrequency,
          executionTiming: definition.executionTiming as ExecutionTiming, transactionCostBps: definition.transactionCostBps,
          slippageBps: definition.slippageBps, cashYieldAnnual: definition.cashYieldAnnual, warmupDays: warmup,
          startDate: null, maxTurnoverPerRebalance: 1,
        };
        const valueAt = (signalDate: string, prices: PriceRow[]) => {
          const prior = prices.filter((row) => row.date < signalDate);
          const data = hasContiguousHistory(prior, universe, requiredHistory)
            ? computeFactors(prior, universe, factorSet) : [];
          const values = new Map<string, number | null>();
          for (const ticker of universe) {
            const contribution = data.find((item) => item.ticker === ticker)?.factorContributions.find((item) => item.factorId === historyFactor.id);
            values.set(ticker, signalValue(historyFactor, contribution, definition.signalUnits));
          }
          return values;
        };
        const engine = runBacktestEngine(rows, etfs, engineConstraints, backtestConfig, null, factorSet,
          (date, prices) => {
            const targetPositions = mapExposure(definition, valueAt(date, prices));
            if (targetPositions !== null) targetHistory.push({
              signalDate: date,
              informationCutoff: rows.filter((row) => row.date < date).at(-1)?.date ?? "",
              executionDate: resolveExecutionDate(rows, date, definition.executionTiming),
              targetPositions,
            });
            return targetPositions;
          });
        if (!engine.hasSufficientData) {
          status = engine.insufficientReason?.includes("Need at least") ? "INSUFFICIENT_HISTORY"
            : /missing or invalid price/i.test(engine.insufficientReason ?? "") ? "INVALID_DATA" : "INCOMPLETE";
          commonReasons.push(engine.insufficientReason ?? "A1 execution did not produce a complete stream.");
        } else {
          ledger = engine.dailyLedger;
          if (!ledger.length) {
            status = "INSUFFICIENT_HISTORY";
            commonReasons.push("A1 returned no daily execution ledger; no alpha-return series is admissible.");
          }
          returnSeries = engine.dailyLedger.map((entry) => ({ date: entry.date,
            value: entry.beginningNav > 0 ? entry.netPnl / entry.beginningNav : null }));
          const latest = engine.dailyLedger.at(-1);
          actualAssetExposures = Object.fromEntries((latest?.endingPositions ?? []).map((position) =>
            [position.ticker, position.weight]));
          const latestSignalDate = rows.at(-1)?.date;
          if (latestSignalDate) {
            const latestValues = valueAt(latestSignalDate, rows);
            const target = mapExposure(definition, latestValues);
            if (target !== null) targetAssetExposures = target;
            else if (status === "READY") {
              status = "INCOMPLETE";
              commonReasons.push("Latest point-in-time signal is unavailable for the declared mapping; READY is withheld.");
            }
          }
          if (status === "READY" && targetHistory.length === 0) {
            status = "INSUFFICIENT_HISTORY";
            commonReasons.push("No executable target mapping was available to A1; READY is withheld.");
          }
          residualCash = Math.max(0, 1 - Object.values(actualAssetExposures).reduce((sum, weight) => sum + weight, 0));
        }
      }
      const latestSignals = signalSeries.filter((point) => point.date === rows.at(-1)?.date);
      if (status === "READY" && (!latestSignals.length || latestSignals.some((point) => point.value === null))) {
        status = "INSUFFICIENT_HISTORY";
        commonReasons.push("Latest point-in-time signal is unavailable; missing is not treated as below-threshold or cash.");
      }
      if (candidatePriceIssues.length && status === "READY") { status = "INVALID_DATA"; commonReasons.push(...candidatePriceIssues); }
      candidates.push({
        ...ident, kind: request.representation, status, reasons: commonReasons, factorId: definition.factorId,
        assetTickers: universe, mapping: request.representation === "signals" ? undefined : definition.mapping,
        signalUnits: definition.signalUnits, targetAssetExposures, actualAssetExposures, residualCash,
        targetHistory,
        signalSeries, returnSeries, ledger,
        lineage: { ...sourceLineage, factorDefinitionId: factor?.id ?? null, factorVersion: factor?.version ?? null,
          peerUniverse,
          calculationType: factor?.calculationType ?? null, formula: factor?.formula ?? null, direction: factor?.direction ?? null,
          signalAvailability: "computed from price observations strictly before each signal date",
          definition: request.representation === "signals" ? null : definition },
        diagnostics: { lookback: factor?.lookback ?? null, lag: factor?.lag ?? null,
          warmupRows: factor ? factor.lookback + factor.lag + 1 : null, coverage: signalSeries.length
            ? signalSeries.filter((point) => point.value !== null).length / signalSeries.length : 0,
          duplicateOf: null, a1Accounting: request.representation === "alpha_streams" ? "A1 BacktestLedgerEntry from existing accounting engine" : null },
      });
    }
  }
  const duplicateMap = new Map<string, string>();
  for (const candidate of candidates) {
    const prior = duplicateMap.get(candidate.canonicalFingerprint);
    if (prior) candidate.diagnostics.duplicateOf = prior;
    else duplicateMap.set(candidate.canonicalFingerprint, candidate.candidateId);
  }
  const endDate = rows.at(-1)?.date ?? "";
  const snapshot: PreparedSnapshot = {
    schemaVersion: 1, engineVersion: PREPARED_INPUT_ENGINE_VERSION, a1EngineVersion: ENGINE_VERSION,
    representation: request.representation,
    dataset: { id: args.datasetId ?? null, sha256: dataHash, csvContent: args.csvContent, startDate: rows[0]?.date ?? "",
      endDate, tickers, priceConvention: "persisted adjusted-close prices; not broker-level corporate-action accounting" },
    factorSet: { version: args.factorVersion, factors: factorSet.factors }, request: structuredClone(request),
    coverage: { requestedAssets: tickers, availableAssets: tickers.filter((ticker) => rows.some((row) => Number.isFinite(row.prices[ticker]))),
      startDate: rows[0]?.date ?? null, endDate: endDate || null, observationCount: rows.length,
      missingData: invalidPrices, priceConvention: "adjusted close", status: invalidPrices.length ? "INVALID_DATA" : "observed uploaded coverage" },
    candidates, dependence: calculateDependence(candidates), suppliedWeights: request.suppliedWeights ?? {},
    createdAt: new Date().toISOString(),
  };
  return snapshot;
}

export function validatePreparedRequest(request: PreparedRequest): string | null {
  if (!request.assetTickers.length) return "At least one asset ticker is required.";
  if (new Set(request.assetTickers.map((ticker) => ticker.toUpperCase())).size !== request.assetTickers.length)
    return "Asset tickers must be unique.";
  if (request.cutoffDate && !/^\d{4}-\d{2}-\d{2}$/.test(request.cutoffDate))
    return "cutoffDate must use YYYY-MM-DD.";
  if (request.representation === "signals" && !request.factorIds.length)
    return "Signals representation requires at least one factorId.";
  if (request.representation === "alpha_streams" && !request.alphaDefinitions.length)
    return "Alpha streams require explicit alphaDefinitions and position mappings.";
  for (const alpha of request.alphaDefinitions) {
    if (!Number.isFinite(alpha.threshold) || !Number.isFinite(alpha.grossFraction) ||
      alpha.grossFraction < 0 || alpha.grossFraction > 1)
      return `Alpha ${alpha.name} has an invalid threshold or grossFraction; signed and leveraged mappings are unsupported.`;
    if (alpha.mapping === "single_asset_long_cash" && alpha.assetTickers.length !== 1)
      return `Alpha ${alpha.name}: single_asset_long_cash requires exactly one asset.`;
    if (alpha.mapping === "cross_sectional_long_only" && alpha.assetTickers.length < 2)
      return `Alpha ${alpha.name}: cross_sectional_long_only requires a peer universe of at least two assets.`;
  }
  return null;
}

export function snapshotStatus(snapshot: PreparedSnapshot): PreparedStatus {
  const statuses = snapshot.candidates.map((candidate) => candidate.status);
  if (!statuses.length) return "INCOMPLETE";
  for (const status of ["INVALID_DATA", "UNSUPPORTED", "INCOMPLETE", "INSUFFICIENT_HISTORY"] as PreparedStatus[])
    if (statuses.includes(status)) return status;
  return "READY";
}

export function replayPreparedSnapshot(snapshot: PreparedSnapshot) {
  if (snapshot.engineVersion !== PREPARED_INPUT_ENGINE_VERSION)
    return { status: "engine_mismatch" as const, fingerprint: fingerprint(snapshot.candidates), differences: [],
      replayedCandidates: [] };
  try {
    const replayed = prepareSnapshot({ request: snapshot.request, csvContent: snapshot.dataset.csvContent,
      factorVersion: snapshot.factorSet.version, factors: snapshot.factorSet.factors });
    const originalFingerprint = fingerprint(snapshot.candidates);
    const replayFingerprint = fingerprint(replayed.candidates);
    return { status: originalFingerprint === replayFingerprint ? "pass" as const : "fail" as const,
      fingerprint: originalFingerprint, differences: originalFingerprint === replayFingerprint ? [] : ["candidate results differ on frozen-input replay"],
      replayedCandidates: replayed.candidates };
  } catch (error) {
    return { status: "fail" as const, fingerprint: fingerprint(snapshot.candidates),
      differences: [error instanceof Error ? error.message : String(error)], replayedCandidates: [] };
  }
}

export function composePreparedSnapshot(snapshot: PreparedSnapshot, weights: Record<string, number>) {
  if (Object.values(weights).some((weight) => !Number.isFinite(weight) || weight < 0))
    throw new Error("Signed or invalid alpha capital weights are unsupported.");
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (sum > 1 + 1e-12) throw new Error("Alpha capital weights must be nonnegative and sum to at most one.");
  const byId = new Map(snapshot.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const target: Record<string, number> = {};
  const actual: Record<string, number> = {};
  let streamResidualCash = 0;
  for (const [candidateId, capital] of Object.entries(weights)) {
    const candidate = byId.get(candidateId);
    if (!candidate) throw new Error(`Unknown candidateId ${candidateId}.`);
    if (candidate.kind !== "alpha_streams" || candidate.status !== "READY")
      throw new Error(`Candidate ${candidateId} is not a READY alpha stream and cannot be composed.`);
    for (const [ticker, weight] of Object.entries(candidate.targetAssetExposures)) target[ticker] = (target[ticker] ?? 0) + capital * weight;
    for (const [ticker, weight] of Object.entries(candidate.actualAssetExposures)) actual[ticker] = (actual[ticker] ?? 0) + capital * weight;
    streamResidualCash += capital * (candidate.residualCash ?? 1);
  }
  const masterUnallocatedCash = 1 - sum;
  const cashTotal = streamResidualCash + masterUnallocatedCash;
  return { status: "USER-SPECIFIED" as const, date: snapshot.dataset.endDate || null, suppliedWeights: weights,
    targetAssetExposures: target, actualAssetExposures: actual, streamResidualCash,
    masterUnallocatedCash, cashTotal,
    formula: "w_assets = H * b; actual and target exposures are separate; alpha stream costs are not deducted again from a consolidated book." };
}