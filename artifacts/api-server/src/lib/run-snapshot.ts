import { createHash } from "node:crypto";
import {
  parseCsv, computeRegime, computeFactors, constructAllocation,
  type AllocationResult, type Constraints, type EnrichedRegimeScores,
  type EtfEntry, type EtfFactorData,
} from "./calculator";
import type { FactorDefinition } from "./factor-library";
import { attachAdjustedOhlcRows } from "./price-ohlc";

// Bump when the optimizer, factor computation or backtest semantics change.
export const ENGINE_VERSION = "allocation-a2.1";
export const REPRODUCTION_TOLERANCE = 1e-8;
export const LEGACY_MESSAGE = "Legacy run — exact input snapshot unavailable.";

export interface RunSnapshot {
  schemaVersion: 1;
  engineVersion: string;
  optimizationTimestamp: string;
  dataset: {
    id: number;
    sha256: string;
    startDate: string;
    endDate: string;
    tickers: string[];
    csvContent: string;
    /** Optional companion; absent on legacy persisted datasets and snapshots. */
    ohlcCsvContent?: string;
    ohlcSha256?: string;
    ohlcConvention?: string;
  };
  universe: { etfs: EtfEntry[]; cashPriorWeight: number };
  constraints: Constraints;
  factorSet: { version: string; factors: FactorDefinition[] };
  benchmarkConfiguration: { defaultTicker: string | null };
  outputs: {
    allocations: AllocationResult[];
    regime: EnrichedRegimeScores;
    factorData: EtfFactorData[];
  };
}

export function hashDataset(csvContent: string): string {
  return createHash("sha256").update(csvContent, "utf8").digest("hex");
}

export function createRunSnapshot(input: Omit<RunSnapshot, "schemaVersion" | "engineVersion">): RunSnapshot {
  const snapshot: RunSnapshot = structuredClone({
    ...input, schemaVersion: 1 as const, engineVersion: ENGINE_VERSION,
  });
  if (hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256)
    throw new Error("Dataset hash does not match snapshot content.");
  if (snapshot.dataset.ohlcCsvContent !== undefined) {
    if (!snapshot.dataset.ohlcSha256 || !snapshot.dataset.ohlcConvention ||
        hashDataset(snapshot.dataset.ohlcCsvContent) !== snapshot.dataset.ohlcSha256)
      throw new Error("Adjusted OHLC dataset hash or convention metadata is missing or invalid.");
    attachAdjustedOhlcRows(parseCsv(snapshot.dataset.csvContent), snapshot.dataset.ohlcCsvContent);
  }
  return snapshot;
}

export type SnapshotResolution =
  | { status: "legacy"; message: string; snapshot: null }
  | { status: "engine_mismatch" | "integrity_fail" | "ready"; message: string; snapshot: RunSnapshot };

/** No fallback to current configurations, even for incomplete historical rows. */
export function resolveRunSnapshot(stored: Record<string, unknown>): SnapshotResolution {
  const s = stored.runSnapshot as RunSnapshot | undefined;
  if (!s || s.schemaVersion !== 1 || !s.engineVersion || !s.optimizationTimestamp ||
    !s.dataset || !Number.isInteger(s.dataset.id) || !s.dataset.csvContent ||
    !s.dataset.sha256 || !s.dataset.startDate || !s.dataset.endDate ||
    !Array.isArray(s.dataset.tickers) || !s.universe || !Array.isArray(s.universe.etfs) ||
    !Number.isFinite(s.universe.cashPriorWeight) || !s.constraints ||
    !s.factorSet || !s.factorSet.version || !Array.isArray(s.factorSet.factors) ||
    !s.benchmarkConfiguration || !s.outputs || !Array.isArray(s.outputs.allocations) ||
    !s.outputs.regime || !Array.isArray(s.outputs.factorData)) {
    return { status: "legacy", message: LEGACY_MESSAGE, snapshot: null };
  }
  if (hashDataset(s.dataset.csvContent) !== s.dataset.sha256)
    return { status: "integrity_fail", message: "REPRODUCIBILITY FAIL: stored dataset hash does not match its content.", snapshot: s };
  if (s.dataset.ohlcCsvContent !== undefined &&
      (!s.dataset.ohlcSha256 || !s.dataset.ohlcConvention ||
       hashDataset(s.dataset.ohlcCsvContent) !== s.dataset.ohlcSha256))
    return { status: "integrity_fail", message: "REPRODUCIBILITY FAIL: stored adjusted OHLC hash does not match its content.", snapshot: s };
  if (s.engineVersion !== ENGINE_VERSION)
    return { status: "engine_mismatch", message: `Historical inputs are preserved, but exact reproduction requires engine version ${s.engineVersion}.`, snapshot: s };
  return { status: "ready", message: "Frozen input snapshot available.", snapshot: s };
}

export function frozenValidationInputs(stored: Record<string, unknown>) {
  const resolution = resolveRunSnapshot(stored);
  if (resolution.status !== "ready") return null;
  const s = resolution.snapshot;
  return {
    priceRows: s.dataset.ohlcCsvContent
      ? attachAdjustedOhlcRows(parseCsv(s.dataset.csvContent), s.dataset.ohlcCsvContent)
      : parseCsv(s.dataset.csvContent),
    etfs: s.universe.etfs,
    constraints: s.constraints,
    factorSet: { factors: s.factorSet.factors },
  };
}

function compareValues(original: unknown, replayed: unknown, path: string, differences: string[]): void {
  if (differences.length >= 30) return;
  if (typeof original === "number" && typeof replayed === "number") {
    if (!Number.isFinite(original) || !Number.isFinite(replayed) ||
      Math.abs(original - replayed) > REPRODUCTION_TOLERANCE)
      differences.push(`${path}: stored ${original}, replay ${replayed}`);
  } else if (Array.isArray(original) && Array.isArray(replayed)) {
    if (original.length !== replayed.length) differences.push(`${path}.length: stored ${original.length}, replay ${replayed.length}`);
    for (let i = 0; i < Math.min(original.length, replayed.length); i++)
      compareValues(original[i], replayed[i], `${path}[${i}]`, differences);
  } else if (original && replayed && typeof original === "object" && typeof replayed === "object") {
    const a = original as Record<string, unknown>;
    const b = replayed as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      compareValues(a[key], b[key], `${path}.${key}`, differences);
  } else if (original !== replayed) {
    differences.push(`${path}: stored ${String(original)}, replay ${String(replayed)}`);
  }
}

export function reproduceRun(stored: Record<string, unknown>): {
  status: "pass" | "fail" | "legacy" | "engine_mismatch";
  message: string;
  differences: string[];
  tolerance: number;
} {
  const resolved = resolveRunSnapshot(stored);
  if (resolved.status !== "ready") return {
    status: resolved.status === "integrity_fail" ? "fail" : resolved.status,
    message: resolved.message, differences: resolved.status === "integrity_fail" ? ["dataset.sha256"] : [],
    tolerance: REPRODUCTION_TOLERANCE,
  };
  const s = resolved.snapshot;
  try {
    const rows = parseCsv(s.dataset.csvContent);
    const tickers = s.universe.etfs.filter((e) => e.enabled && s.dataset.tickers.includes(e.ticker)).map((e) => e.ticker);
    const regime = computeRegime(rows, tickers);
    const factorData = computeFactors(rows, tickers, s.factorSet, regime.label);
    const allocations = constructAllocation(factorData, s.universe.etfs, s.constraints, regime);
    // JSONB turns non-finite numeric values into null. Normalize replay the same way.
    const replayed = JSON.parse(JSON.stringify({ allocations, regime, factorData }));
    const original = { allocations: stored.allocations, regime: stored.regime, factorData: s.outputs.factorData };
    const differences: string[] = [];
    compareValues(original, replayed, "result", differences);
    compareValues(s.outputs, replayed, "snapshot.outputs", differences);
    return { status: differences.length ? "fail" : "pass",
      message: differences.length ? "REPRODUCIBILITY FAIL" : "Exact rerun matches stored outputs.",
      differences, tolerance: REPRODUCTION_TOLERANCE };
  } catch (error) {
    return { status: "fail", message: "REPRODUCIBILITY FAIL",
      differences: [`replay: ${error instanceof Error ? error.message : String(error)}`],
      tolerance: REPRODUCTION_TOLERANCE };
  }
}