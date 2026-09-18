import { db, priceDataTable, sessionGovernanceTable, sessionsTable } from "@workspace/db";
import { desc, inArray } from "drizzle-orm";

export type SignalAvailability =
  | "persisted_history"
  | "latest_dataset_history"
  | "request_time_only";
export type SignalScope = "global" | "market" | "asset" | "pair";
export type SignalValue = number | string | boolean | null;

export interface SignalCatalogEntry {
  signalId: string;
  originalPath: string;
  category: string;
  availability: SignalAvailability;
  scope: SignalScope;
  valueType: "number" | "string" | "boolean" | "null" | "mixed";
  unit: string | null;
  historyAvailable: boolean;
  description: string;
}

export interface SignalObservation {
  signalId: string;
  category: string;
  availability: Exclude<SignalAvailability, "request_time_only">;
  scope: SignalScope;
  asset: string | null;
  dimension: string | null;
  asOf: string;
  value: SignalValue;
  unit: string | null;
  quality: "recorded" | "source_null" | "unavailable";
  provenance: {
    source: string;
    sourceRecordId: string | null;
    originalPath: string;
    uploadedAt: string | null;
    modelVersion: string | null;
    parameterVersion: string | null;
  };
  ageSeconds: number;
}

interface SignalLoadOptions {
  signalId?: string;
  asset?: string;
  dateFrom?: string;
  dateTo?: string;
  maxRecords?: number;
  catalogOnly?: boolean;
}

const KNOWN_SESSION_PATHS = [
  "sessionId", "runAt", "label", "cashWeight", "cashPriorWeight", "cashChange",
  "activeEtfCount", "investedSleeve", "priceDataEnd",
  "regime.trend", "regime.breadth", "regime.volatility", "regime.liquidity",
  "regime.composite", "regime.label", "regime.confidence", "regime.drivers",
  "regime.components.key", "regime.components.label", "regime.components.score",
  "regime.components.method", "regime.components.description",
  "allocations.ticker", "allocations.name", "allocations.sector", "allocations.weight",
  "allocations.priorWeight", "allocations.change", "allocations.active",
  "allocations.factorScores.mom20", "allocations.factorScores.mom60",
  "allocations.factorScores.mom120", "allocations.factorScores.mom252",
  "allocations.factorScores.trendQuality", "allocations.factorScores.realizedVol60",
  "allocations.factorScores.drawdown", "allocations.factorScores.meanReversion",
  "allocations.factorScores.composite",
  "watchlist.ticker", "watchlist.name", "watchlist.sector", "watchlist.compositeScore",
  "watchlist.blockingReason", "watchlist.blockingFactor", "watchlist.improvement",
  "icSummary.whatChanged", "icSummary.why", "icSummary.risks", "icSummary.watchNext",
  "steps.step", "steps.label", "steps.status", "steps.message",
  "iterationInfo.current", "iterationInfo.max", "iterationInfo.completed",
  "iterationInfo.next", "iterationInfo.postV1Backlog",
  "diagnostics.expectedVolatility", "diagnostics.hhi",
  "diagnostics.effectiveNumberOfBets", "diagnostics.diversificationScore",
  "diagnostics.lookbackDays", "diagnostics.activeTickers",
  "diagnostics.insufficientDataReasons",
  "diagnostics.riskContributions.ticker", "diagnostics.riskContributions.name",
  "diagnostics.riskContributions.weight",
  "diagnostics.riskContributions.riskContributionPct",
  "diagnostics.riskContributions.marginalVolContribution",
  "diagnostics.correlationMatrix.tickerA", "diagnostics.correlationMatrix.tickerB",
  "diagnostics.correlationMatrix.correlation",
  "diagnostics.trackingErrors.benchmarkTicker",
  "diagnostics.trackingErrors.trackingError",
] as const;

const REQUEST_TIME_CAPABILITIES: SignalCatalogEntry[] = [
  ["backtest", "/backtest", "backtest"],
  ["risk_model", "/risk-model", "risk_model"],
  ["attribution", "/attribution?sessionId={sessionId}", "attribution"],
  ["scenario_stress", "/scenario-stress/run", "scenario_stress"],
  ["trade_implementation", "/trade-implementation", "trade_implementation"],
].map(([name, path, category]) => ({
  signalId: `optimizer.capability.${name}`,
  originalPath: path,
  category,
  availability: "request_time_only",
  scope: "global",
  valueType: "mixed",
  unit: null,
  historyAvailable: false,
  description: "Implemented analytical output, computed only when its own endpoint is requested; no persisted history is available to this export.",
}));

function snake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function signalIdForPath(path: string): string {
  return `optimizer.session.${path.split(".").map(snake).join(".")}`;
}

function categoryForPath(path: string): string {
  const root = path.split(".")[0];
  const categories: Record<string, string> = {
    regime: "registered_signal",
    allocations: "allocation",
    watchlist: "registered_signal",
    diagnostics: "historical_calculation",
    steps: "run_metadata",
    iterationInfo: "product_metadata",
    icSummary: "investment_committee_summary",
  };
  return categories[root] ?? "run_metadata";
}

function unitForPath(path: string): string | null {
  const key = path.split(".").at(-1) ?? "";
  if (/weight|change|sleeve/i.test(key)) return "decimal_fraction";
  if (/volatility|trackingError|marginalVolContribution/i.test(key)) return "annualized_decimal";
  if (/riskContributionPct/i.test(key)) return "percent";
  if (/score|composite|confidence|mom\\d+|trendQuality|realizedVol60|drawdown|meanReversion/i.test(key)) return "score_0_100";
  if (/correlation/i.test(key)) return "coefficient_-1_1";
  if (/count|current|max|lookbackDays|sessionId/i.test(key)) return "count";
  return null;
}

function scopeForPath(path: string): SignalScope {
  if (path.startsWith("allocations.") || path.startsWith("watchlist.") || path.startsWith("diagnostics.riskContributions.")) return "asset";
  if (path.startsWith("diagnostics.correlationMatrix.")) return "pair";
  if (path.startsWith("regime.")) return "market";
  return "global";
}

function valueType(value: SignalValue): SignalCatalogEntry["valueType"] {
  if (value === null) return "null";
  return typeof value as "number" | "string" | "boolean";
}

function catalogForPath(path: string, observed?: SignalValue): SignalCatalogEntry {
  return {
    signalId: signalIdForPath(path),
    originalPath: `sessions.resultJson.${path}`,
    category: categoryForPath(path),
    availability: "persisted_history",
    scope: scopeForPath(path),
    valueType: observed === undefined ? "mixed" : valueType(observed),
    unit: unitForPath(path),
    historyAvailable: true,
    description: "Value read verbatim from a saved optimizer session result.",
  };
}

function ageSeconds(asOf: string, now: Date): number {
  const timestamp = Date.parse(asOf);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.floor((now.getTime() - timestamp) / 1000))
    : 0;
}

function semanticAsset(value: Record<string, unknown>, inherited: string | null): string | null {
  if (typeof value.ticker === "string") return value.ticker.toUpperCase();
  if (typeof value.benchmarkTicker === "string") return value.benchmarkTicker.toUpperCase();
  if (typeof value.tickerA === "string" && typeof value.tickerB === "string") {
    return `${value.tickerA.toUpperCase()}/${value.tickerB.toUpperCase()}`;
  }
  return inherited;
}

function flattenValue(
  value: unknown,
  stablePath: string,
  sourcePath: string,
  asset: string | null,
  dimension: string | null,
  emit: (stablePath: string, sourcePath: string, value: SignalValue, asset: string | null, dimension: string | null) => void,
): void {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    emit(stablePath, sourcePath, value, asset, dimension);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      flattenValue(value[index], stablePath, `${sourcePath}[${index}]`, asset, String(index), emit);
    }
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const nextAsset = semanticAsset(object, asset);
  const semanticDimension =
    typeof object.key === "string" ? object.key :
    typeof object.step === "string" ? object.step :
    typeof object.tickerA === "string" && typeof object.tickerB === "string"
      ? `${object.tickerA}/${object.tickerB}`
      : dimension;
  for (const [key, child] of Object.entries(object)) {
    const nextStablePath = stablePath ? `${stablePath}.${key}` : key;
    const nextSourcePath = sourcePath ? `${sourcePath}.${key}` : key;
    flattenValue(child, nextStablePath, nextSourcePath, nextAsset, semanticDimension, emit);
  }
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === "\"") {
      if (quoted && csv[i + 1] === "\"") {
        cell += "\"";
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((entry) => entry.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((entry) => entry.length > 0)) rows.push(row);
  return rows;
}

function priceObservations(
  row: typeof priceDataTable.$inferSelect,
  now: Date,
  options: SignalLoadOptions,
): SignalObservation[] {
  const parsed = parseCsvRows(row.csvContent);
  if (parsed.length < 2) return [];
  const headers = parsed[0].map((header) => header.trim());
  const output: SignalObservation[] = [];
  const maxRecords = options.maxRecords ?? 5001;
  const from = options.dateFrom ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(options.dateFrom) ? `${options.dateFrom}T00:00:00.000Z` : options.dateFrom) : null;
  const to = options.dateTo ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(options.dateTo) ? `${options.dateTo}T23:59:59.999Z` : options.dateTo) : null;
  for (const values of parsed.slice(1).reverse()) {
    const asOf = values[0]?.trim();
    if (!asOf) continue;
    const timestamp = Date.parse(asOf);
    if ((from !== null && timestamp < from) || (to !== null && timestamp > to)) continue;
    for (let column = 1; column < headers.length; column++) {
      const asset = headers[column];
      if (!asset) continue;
      if (options.signalId && options.signalId !== "optimizer.market.price.close") continue;
      if (options.asset && asset.toUpperCase() !== options.asset.toUpperCase()) continue;
      const raw = values[column] ?? "";
      const numeric = raw.trim() === "" ? null : Number(raw);
      const value: SignalValue =
        raw.trim() === "" ? null : Number.isFinite(numeric) ? numeric : raw;
      output.push({
        signalId: "optimizer.market.price.close",
        category: "market_observation",
        availability: "latest_dataset_history",
        scope: "asset",
        asset: asset.toUpperCase(),
        dimension: null,
        asOf,
        value,
        unit: null,
        quality: value === null ? "source_null" : "recorded",
        provenance: {
          source: "price_data.csv_content",
          sourceRecordId: String(row.id),
          originalPath: `price_data.csvContent[${asOf}][${asset}]`,
          uploadedAt: row.uploadedAt.toISOString(),
          modelVersion: null,
          parameterVersion: null,
        },
        ageSeconds: ageSeconds(asOf, now),
      });
      if (output.length >= maxRecords) return output;
    }
  }
  return output;
}

export async function loadSignalExport(options: SignalLoadOptions = {}): Promise<{
  catalog: SignalCatalogEntry[];
  sessionObservations: SignalObservation[];
  priceObservations: SignalObservation[];
}> {
  const now = new Date();
  const sessionLimit = options.catalogOnly ? 1 : Math.min(options.maxRecords ?? 5001, 5001);
  const [sessions, priceRows] = await Promise.all([
    db.select().from(sessionsTable).orderBy(desc(sessionsTable.runAt)).limit(sessionLimit),
    db.select().from(priceDataTable).orderBy(desc(priceDataTable.uploadedAt)).limit(1),
  ]);
  const sessionIds = sessions.map((session) => session.id);
  const governanceRows = sessionIds.length === 0
    ? []
    : await db.select().from(sessionGovernanceTable).where(inArray(sessionGovernanceTable.sessionId, sessionIds));
  const governanceBySession = new Map(governanceRows.map((row) => [row.sessionId, row]));
  const observedCatalog = new Map<string, SignalCatalogEntry>();
  const sessionObservations: SignalObservation[] = [];

  for (const session of sessions) {
    const asOf = session.runAt.toISOString();
    const governance = governanceBySession.get(session.id);
    flattenValue(session.resultJson, "", "", null, null, (path, sourcePath, value, asset, dimension) => {
      if (!path) return;
      const entry = catalogForPath(path, value);
      observedCatalog.set(entry.signalId, entry);
      if (options.catalogOnly) return;
      if (options.signalId && entry.signalId !== options.signalId) return;
      if (options.asset && asset !== options.asset.toUpperCase()) return;
      const timestamp = Date.parse(asOf);
      const from = options.dateFrom ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(options.dateFrom) ? `${options.dateFrom}T00:00:00.000Z` : options.dateFrom) : null;
      const to = options.dateTo ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(options.dateTo) ? `${options.dateTo}T23:59:59.999Z` : options.dateTo) : null;
      if ((from !== null && timestamp < from) || (to !== null && timestamp > to)) return;
      if (sessionObservations.length >= (options.maxRecords ?? 5001)) return;
      sessionObservations.push({
        signalId: entry.signalId,
        category: entry.category,
        availability: "persisted_history",
        scope: entry.scope,
        asset,
        dimension,
        asOf,
        value,
        unit: entry.unit,
        quality: value === null ? "source_null" : "recorded",
        provenance: {
          source: "sessions.result_json",
          sourceRecordId: String(session.id),
          originalPath: `sessions.resultJson.${sourcePath}`,
          uploadedAt: asOf,
          modelVersion: governance?.modelVersion ?? null,
          parameterVersion: governance?.parameterVersion ?? null,
        },
        ageSeconds: ageSeconds(asOf, now),
      });
    });
  }

  const staticCatalog = KNOWN_SESSION_PATHS.map((path) => catalogForPath(path));
  const priceCatalog: SignalCatalogEntry = {
    signalId: "optimizer.market.price.close",
    originalPath: "price_data.csvContent[date][ticker]",
    category: "market_observation",
    availability: "latest_dataset_history",
    scope: "asset",
    valueType: "number",
    unit: null,
    historyAvailable: true,
    description: "Original value from the most recently persisted price CSV; empty source cells remain null.",
  };
  const catalogById = new Map<string, SignalCatalogEntry>();
  for (const entry of [...staticCatalog, priceCatalog, ...REQUEST_TIME_CAPABILITIES, ...observedCatalog.values()]) {
    catalogById.set(entry.signalId, entry);
  }

  return {
    catalog: [...catalogById.values()].sort((a, b) => a.signalId.localeCompare(b.signalId)),
    sessionObservations,
    priceObservations: options.catalogOnly || !priceRows[0]
      ? []
      : priceObservations(priceRows[0], now, options),
  };
}