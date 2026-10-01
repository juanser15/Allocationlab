export type AlphaMapping = "single_asset_long_cash" | "cross_sectional_long_only";
export type SignalUnits = "raw" | "oriented" | "normalized";

export interface AlphaParameters {
  signalUnits: SignalUnits;
  threshold: number;
  grossFraction: number;
  rebalanceFrequency: "monthly" | "quarterly";
  executionTiming: "next_close" | "same_close";
  transactionCostBps: number;
  slippageBps: number;
  cashYieldAnnual: number;
}

export interface AlphaDefinition extends AlphaParameters {
  name: string;
  factorId: string;
  assetTickers: string[];
  mapping: AlphaMapping;
}

export const DEFAULT_ALPHA_PARAMETERS: AlphaParameters = {
  signalUnits: "oriented",
  threshold: 0,
  grossFraction: 1,
  rebalanceFrequency: "monthly",
  executionTiming: "next_close",
  transactionCostBps: 10,
  slippageBps: 5,
  cashYieldAnnual: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

/**
 * Draft identity is based only on executable fields. Asset normalization mirrors
 * B1 prepared-input identity: uppercase and de-duplicate while preserving order.
 */
export function executableAlphaDraftKey(definition: AlphaDefinition): string {
  const executable = {
    factorId: definition.factorId,
    assetTickers: [...new Set(definition.assetTickers.map((ticker) => ticker.toUpperCase()))],
    mapping: definition.mapping,
    signalUnits: definition.signalUnits,
    threshold: definition.threshold,
    grossFraction: definition.grossFraction,
    rebalanceFrequency: definition.rebalanceFrequency,
    executionTiming: definition.executionTiming,
    transactionCostBps: definition.transactionCostBps,
    slippageBps: definition.slippageBps,
    cashYieldAnnual: definition.cashYieldAnnual,
  };
  return JSON.stringify(canonicalize(executable)) ?? "null";
}

interface AlphaStreamDraftPreview {
  definitions: AlphaDefinition[];
  additions: AlphaDefinition[];
  duplicateCount: number;
  totalCount: number;
  error: string | null;
}

function failedPreview(existingCount: number, error: string): AlphaStreamDraftPreview {
  return {
    definitions: [],
    additions: [],
    duplicateCount: 0,
    totalCount: existingCount,
    error,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateParameters(value: unknown): value is AlphaParameters {
  if (!isRecord(value)) return false;
  return (value.signalUnits === "raw" || value.signalUnits === "oriented" || value.signalUnits === "normalized") &&
    (value.rebalanceFrequency === "monthly" || value.rebalanceFrequency === "quarterly") &&
    (value.executionTiming === "next_close" || value.executionTiming === "same_close") &&
    typeof value.threshold === "number" && Number.isFinite(value.threshold) &&
    typeof value.grossFraction === "number" && Number.isFinite(value.grossFraction) &&
    value.grossFraction >= 0 && value.grossFraction <= 1 &&
    typeof value.transactionCostBps === "number" && Number.isFinite(value.transactionCostBps) &&
    value.transactionCostBps >= 0 && value.transactionCostBps <= 500 &&
    typeof value.slippageBps === "number" && Number.isFinite(value.slippageBps) &&
    value.slippageBps >= 0 && value.slippageBps <= 500 &&
    typeof value.cashYieldAnnual === "number" && Number.isFinite(value.cashYieldAnnual) &&
    value.cashYieldAnnual >= 0 && value.cashYieldAnnual <= 0.2;
}

export function previewAlphaDraft(
  selection: {
    assetTickers: string[];
    factorIds: string[];
    mapping: AlphaMapping;
    parameters: AlphaParameters;
  },
  existing: AlphaDefinition[],
): AlphaStreamDraftPreview {
  const existingCount = Array.isArray(existing) ? existing.length : 0;
  if (!isRecord(selection)) return failedPreview(existingCount, "A valid alpha draft selection is required.");
  if (!Array.isArray(existing)) return failedPreview(0, "Existing alpha definitions must be an array.");
  if (!isStringArray(selection.assetTickers) || !isStringArray(selection.factorIds)) {
    return failedPreview(existingCount, "Asset tickers and factor IDs must be string arrays.");
  }
  if (selection.mapping !== "single_asset_long_cash" && selection.mapping !== "cross_sectional_long_only") {
    return failedPreview(existingCount, "Choose a supported alpha mapping.");
  }
  if (!validateParameters(selection.parameters)) {
    return failedPreview(existingCount, "Alpha parameters contain an unsupported value or are outside the allowed range.");
  }

  const assetTickers = [...new Set(
    selection.assetTickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean),
  )].sort();
  const factorIds = [...new Set(selection.factorIds)].sort();

  if (assetTickers.length === 0) return failedPreview(existingCount, "Select at least one asset.");
  if (factorIds.length === 0) return failedPreview(existingCount, "Select at least one factor.");
  if (factorIds.some(id => !id.trim())) return failedPreview(existingCount, "Select valid existing factor IDs.");
  if (selection.mapping === "cross_sectional_long_only" && assetTickers.length < 2) {
    return failedPreview(existingCount, "Cross-sectional long-only mapping requires at least two assets.");
  }

  const definitions: AlphaDefinition[] = [];
  for (const factorId of factorIds) {
    const universes = selection.mapping === "single_asset_long_cash"
      ? assetTickers.map((ticker) => [ticker])
      : [assetTickers];
    for (const universe of universes) {
      definitions.push({
        ...selection.parameters,
        name: `${factorId} × ${universe.join(", ")}`,
        factorId,
        assetTickers: [...universe],
        mapping: selection.mapping,
      });
    }
  }

  const existingKeys = new Set(existing.map(executableAlphaDraftKey));
  const additions = definitions.filter((definition) => !existingKeys.has(executableAlphaDraftKey(definition)));
  return {
    definitions,
    additions,
    duplicateCount: definitions.length - additions.length,
    totalCount: existing.length + additions.length,
    error: null,
  };
}