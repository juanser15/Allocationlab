import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ALPHA_PARAMETERS,
  executableAlphaDraftKey,
  previewAlphaDraft,
  type AlphaDefinition,
  type AlphaParameters,
} from "./alpha-stream-draft.ts";

const parameters: AlphaParameters = { ...DEFAULT_ALPHA_PARAMETERS };

function preview(
  assetTickers: string[],
  factorIds: string[],
  mapping: AlphaDefinition["mapping"],
  selectedParameters: AlphaParameters = parameters,
  existing: AlphaDefinition[] = [],
) {
  return previewAlphaDraft({ assetTickers, factorIds, mapping, parameters: selectedParameters }, existing);
}

test("default parameters exactly match the current makeAlpha defaults", () => {
  assert.deepEqual(DEFAULT_ALPHA_PARAMETERS, {
    signalUnits: "oriented",
    threshold: 0,
    grossFraction: 1,
    rebalanceFrequency: "monthly",
    executionTiming: "next_close",
    transactionCostBps: 10,
    slippageBps: 5,
    cashYieldAnnual: 0,
  });
});

test("single-asset mapping previews the factor-by-asset matrix in sorted deterministic order", () => {
  const result = preview([" msft ", "aapl", "MSFT"], ["z-factor", "a-factor", "z-factor"], "single_asset_long_cash");

  assert.equal(result.error, null);
  assert.equal(result.definitions.length, 4);
  assert.deepEqual(result.definitions.map(({ factorId, assetTickers }) => [factorId, assetTickers]), [
    ["a-factor", ["AAPL"]],
    ["a-factor", ["MSFT"]],
    ["z-factor", ["AAPL"]],
    ["z-factor", ["MSFT"]],
  ]);
  assert.deepEqual(result.definitions.map(({ name }) => name), [
    "a-factor × AAPL",
    "a-factor × MSFT",
    "z-factor × AAPL",
    "z-factor × MSFT",
  ]);
  assert.equal(result.additions.length, 4);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.totalCount, 4);
});

test("cross-sectional mapping creates one peer-universe definition per sorted factor", () => {
  const result = preview([" msft", "aapl", "goog", "AAPL"], ["factor-b", "factor-a"], "cross_sectional_long_only");

  assert.equal(result.error, null);
  assert.deepEqual(result.definitions.map(({ factorId, assetTickers }) => [factorId, assetTickers]), [
    ["factor-a", ["AAPL", "GOOG", "MSFT"]],
    ["factor-b", ["AAPL", "GOOG", "MSFT"]],
  ]);
});

test("selection order does not affect generated drafts while executable identity preserves peer order", () => {
  const first = preview(["MSFT", "AAPL"], ["factor-b", "factor-a"], "cross_sectional_long_only");
  const reordered = preview(["aapl", "msft", "MSFT"], ["factor-a", "factor-b"], "cross_sectional_long_only");
  assert.deepEqual(first.definitions, reordered.definitions);

  const ordered = { ...first.definitions[0], assetTickers: ["AAPL", "MSFT"] };
  const reversed = { ...ordered, assetTickers: ["MSFT", "AAPL"] };
  assert.notEqual(executableAlphaDraftKey(ordered), executableAlphaDraftKey(reversed));
});

test("identity ignores names and mirrors uppercase, unique, order-preserving B1 universe normalization", () => {
  const definition: AlphaDefinition = {
    name: "Original label",
    factorId: "factor-a",
    assetTickers: ["aapl", "MSFT", "AAPL"],
    mapping: "cross_sectional_long_only",
    ...parameters,
  };
  const alias = { ...definition, name: "Renamed", assetTickers: ["AAPL", "msft"] };
  assert.equal(executableAlphaDraftKey(definition), executableAlphaDraftKey(alias));

  const distinctOrder = { ...definition, assetTickers: ["MSFT", "aapl"] };
  assert.notEqual(executableAlphaDraftKey(definition), executableAlphaDraftKey(distinctOrder));
});

test("identity treats signed zero as its canonical JSON equivalent", () => {
  const positive = {
    name: "positive",
    factorId: "factor-a",
    assetTickers: ["AAPL"],
    mapping: "single_asset_long_cash" as const,
    ...parameters,
    threshold: 0,
  };
  const negative = { ...positive, name: "negative", threshold: -0 };
  assert.equal(executableAlphaDraftKey(positive), executableAlphaDraftKey(negative));
});

test("zero is valid for every bounded numeric parameter", () => {
  const allZero: AlphaParameters = {
    signalUnits: "oriented",
    threshold: 0,
    grossFraction: 0,
    rebalanceFrequency: "monthly",
    executionTiming: "next_close",
    transactionCostBps: 0,
    slippageBps: 0,
    cashYieldAnnual: 0,
  };
  const result = preview(["AAPL"], ["factor-a"], "single_asset_long_cash", allZero);
  assert.equal(result.error, null);
  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0].grossFraction, 0);
});

test("preview deduplicates aliases against existing definitions and repeated creation is idempotent", () => {
  const initial = preview(["AAPL"], ["factor-a"], "single_asset_long_cash");
  const existingAlias = { ...initial.additions[0], name: "Existing differently named alpha" };
  const second = preview(["aapl", "AAPL"], ["factor-a", "factor-a"], "single_asset_long_cash", parameters, [existingAlias]);
  assert.equal(second.definitions.length, 1);
  assert.equal(second.duplicateCount, 1);
  assert.deepEqual(second.additions, []);
  assert.equal(second.totalCount, 1);

  const repeated = preview(["AAPL"], ["factor-a"], "single_asset_long_cash", parameters, initial.additions);
  assert.equal(repeated.duplicateCount, 1);
  assert.deepEqual(repeated.additions, []);
  assert.equal(repeated.totalCount, 1);
});

test("existing definitions stay untouched and additions preserve generated order", () => {
  const existing = [
    ...preview(["ZZZ"], ["old-factor"], "single_asset_long_cash").additions,
    ...preview(["YYY"], ["older-factor"], "single_asset_long_cash").additions,
  ];
  const before = structuredClone(existing);
  const result = preview(["MSFT", "AAPL"], ["factor-b", "factor-a"], "single_asset_long_cash", parameters, existing);
  assert.deepEqual(existing, before);
  assert.deepEqual(result.additions.map(({ factorId, assetTickers }) => [factorId, assetTickers]), [
    ["factor-a", ["AAPL"]],
    ["factor-a", ["MSFT"]],
    ["factor-b", ["AAPL"]],
    ["factor-b", ["MSFT"]],
  ]);
  assert.deepEqual(existing.map(({ factorId }) => factorId), ["old-factor", "older-factor"]);
  assert.equal(result.totalCount, existing.length + result.additions.length);
});

test("changes to executable parameters create distinct identities", () => {
  const base = preview(["AAPL"], ["factor-a"], "single_asset_long_cash").definitions[0];
  const changedParameters: AlphaParameters[] = [
    { ...parameters, signalUnits: "raw" },
    { ...parameters, threshold: 0.1 },
    { ...parameters, grossFraction: 0.5 },
    { ...parameters, rebalanceFrequency: "quarterly" },
    { ...parameters, executionTiming: "same_close" },
    { ...parameters, transactionCostBps: 11 },
    { ...parameters, slippageBps: 6 },
    { ...parameters, cashYieldAnnual: 0.01 },
  ];
  for (const changed of changedParameters) {
    const changedDraft = preview(["AAPL"], ["factor-a"], "single_asset_long_cash", changed).definitions[0];
    assert.notEqual(executableAlphaDraftKey(base), executableAlphaDraftKey(changedDraft));
  }
});

test("empty selections and unsupported runtime mapping return errors with no generated definitions", () => {
  for (const result of [
    preview([], ["factor-a"], "single_asset_long_cash"),
    preview(["AAPL"], [], "single_asset_long_cash"),
    preview(["AAPL"], ["factor-a"], "cross_sectional_long_only"),
    previewAlphaDraft({
      assetTickers: ["AAPL"],
      factorIds: ["factor-a"],
      mapping: "invented_mapping" as AlphaDefinition["mapping"],
      parameters,
    }, []),
  ]) {
    assert.ok(result.error);
    assert.deepEqual(result.definitions, []);
    assert.deepEqual(result.additions, []);
    assert.equal(result.duplicateCount, 0);
  }
});

test("parameter validation rejects invalid enums, timing, non-finite values, strings, and out-of-range numbers", () => {
  const invalidParameters: unknown[] = [
    { ...parameters, signalUnits: "invented" },
    { ...parameters, rebalanceFrequency: "weekly" },
    { ...parameters, executionTiming: "open" },
    { ...parameters, threshold: Number.NaN },
    { ...parameters, threshold: Number.POSITIVE_INFINITY },
    { ...parameters, threshold: "0" },
    { ...parameters, grossFraction: -0.01 },
    { ...parameters, grossFraction: 1.01 },
    { ...parameters, transactionCostBps: -1 },
    { ...parameters, transactionCostBps: 501 },
    { ...parameters, slippageBps: Number.NaN },
    { ...parameters, cashYieldAnnual: 0.201 },
  ];
  for (const invalid of invalidParameters) {
    const result = previewAlphaDraft({
      assetTickers: ["AAPL"],
      factorIds: ["factor-a"],
      mapping: "single_asset_long_cash",
      parameters: invalid as AlphaParameters,
    }, []);
    assert.ok(result.error);
    assert.deepEqual(result.definitions, []);
    assert.deepEqual(result.additions, []);
  }
});