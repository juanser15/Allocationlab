import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "./calculator";
import {
  composePreparedSnapshot, mapExposure, prepareSnapshot, snapshotStatus, validatePreparedRequest,
  type AlphaDefinition, type PreparedRequest, type PreparedSnapshot,
} from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";

const tickers = ["A", "B", "C", "D", "E"];
const dates = Array.from({ length: 180 }, (_, i) => new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10));
function csvWithMutation(afterCutoffMutation = false) {
  const header = ["date", ...tickers].join(",");
  const lines = dates.map((date, i) => [date, ...tickers.map((_, asset) => {
    const normal = 100 + (i + 1) * (asset + 1) * 0.17 + Math.sin(i * (asset + 1)) * 2;
    return afterCutoffMutation && date > "2020-04-01" ? normal * 8 : normal;
  })].join(","));
  return [header, ...lines].join("\n");
}
function factors(count = 1): FactorDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `momentum_${i}`, name: `Momentum ${i}`, description: "test commentary", family: "Momentum", enabled: true,
    status: "active", inputSeries: "adjusted close", calculationType: "momentum", formula: "P(t-lag)/P(t-lag-lookback)-1",
    direction: "higher_is_better", lookback: 5 + i, lag: 0, normalization: "percentile_rank",
    winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
    dataSource: "test synthetic prices", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "v-test",
  } as FactorDefinition));
}
function alpha(overrides: Partial<AlphaDefinition> = {}): AlphaDefinition {
  return {
    name: "Long A", factorId: "momentum_0", assetTickers: ["A"], mapping: "single_asset_long_cash",
    signalUnits: "oriented", threshold: -1, grossFraction: 0.5, rebalanceFrequency: "monthly",
    executionTiming: "next_close", transactionCostBps: 10, slippageBps: 5, cashYieldAnnual: 0, ...overrides,
  };
}
function makeSnapshot(request: PreparedRequest, csv = csvWithMutation()) {
  return prepareSnapshot({ request, csvContent: csv, factorVersion: "v-test", factors: factors(6) });
}

test("B1 T1 separates raw signal values from alpha returns and blocks absent mappings", () => {
  const snapshot = makeSnapshot({ representation: "signals", assetTickers: ["A"], factorIds: ["momentum_0"], alphaDefinitions: [] });
  const candidate = snapshot.candidates[0];
  assert.equal(candidate.kind, "signals");
  assert.ok(candidate.signalSeries.some((point) => point.value !== null));
  assert.deepEqual(candidate.returnSeries, []);
  assert.match(validatePreparedRequest({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    alphaDefinitions: [] }) ?? "", /explicit alphaDefinitions/);
});

test("B1 T2 retains thirty distinct factor-by-asset lineages", () => {
  const snapshot = makeSnapshot({ representation: "signals", assetTickers: tickers,
    factorIds: factors(6).map((factor) => factor.id), alphaDefinitions: [] });
  assert.equal(snapshot.candidates.length, 30);
  assert.equal(new Set(snapshot.candidates.map((candidate) => candidate.lineage.factorDefinitionId)).size, 6);
  assert.equal(new Set(snapshot.candidates.map((candidate) => candidate.assetTickers[0])).size, 5);
  assert.ok(snapshot.candidates.every((candidate) => candidate.lineage.datasetHash && candidate.candidateId));
});

test("B1 T3 verifies both reference mappings, no-position cash, H*b and cash identity", () => {
  const single = mapExposure(alpha(), new Map([["A", 0.2]]));
  assert.deepEqual(single, { A: 0.5 });
  assert.deepEqual(mapExposure(alpha({ threshold: 0 }), new Map([["A", -0.2]])), {});
  const cross = mapExposure(alpha({ mapping: "cross_sectional_long_only", assetTickers: ["A", "B"],
    threshold: 0, grossFraction: 0.6 }), new Map([["A", 2], ["B", 1]]));
  assert.ok(Math.abs(cross!.A - 0.4) < 1e-8);
  assert.ok(Math.abs(cross!.B - 0.2) < 1e-8);
  const panel = makeSnapshot({ representation: "alpha_streams", assetTickers: ["A", "B"], factorIds: [],
    alphaDefinitions: [alpha({ assetTickers: ["A", "B"], mapping: "cross_sectional_long_only", threshold: -1 })] });
  assert.deepEqual([...new Set(panel.candidates[0].signalSeries.map((point) => point.ticker))].sort(), ["A", "B"]);
  assert.deepEqual(panel.candidates[0].lineage.peerUniverse, ["A", "B"]);
  assert.equal(mapExposure(alpha({ mapping: "cross_sectional_long_only", assetTickers: ["A", "B"] }),
    new Map([["A", -1], ["B", -2]])) && Object.keys(mapExposure(
      alpha({ mapping: "cross_sectional_long_only", assetTickers: ["A", "B"] }),
      new Map([["A", -1], ["B", -2]]))!).length, 0);
  const candidate = {
    candidateId: "a", canonicalFingerprint: "a", name: "a", kind: "alpha_streams" as const, status: "READY" as const,
    reasons: [], assetTickers: ["A"], targetAssetExposures: { A: 0.5 }, actualAssetExposures: { A: 0.4 },
    residualCash: 0.6, signalSeries: [], returnSeries: [], ledger: [], lineage: {}, diagnostics: {},
  };
  const snapshot = { dataset: { endDate: "2020-01-01" }, candidates: [candidate] } as unknown as PreparedSnapshot;
  const result = composePreparedSnapshot(snapshot, { a: 0.5 });
  assert.equal(result.targetAssetExposures.A, 0.25);
  assert.equal(result.actualAssetExposures.A, 0.2);
  assert.equal(result.streamResidualCash, 0.3);
  assert.equal(result.masterUnallocatedCash, 0.5);
  assert.ok(Math.abs(result.cashTotal + result.actualAssetExposures.A - 1) < 1e-8);
  assert.throws(() => composePreparedSnapshot(snapshot, { a: -0.1 }), /Signed/);
});

test("B1 T4 cutoff isolates signals, targets, executions and P&L from later prices", () => {
  const request: PreparedRequest = { representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    cutoffDate: "2020-04-01", alphaDefinitions: [alpha()] };
  const original = makeSnapshot(request);
  const mutated = makeSnapshot(request, csvWithMutation(true));
  assert.deepEqual(original.candidates[0].signalSeries, mutated.candidates[0].signalSeries);
  assert.deepEqual(original.candidates[0].targetAssetExposures, mutated.candidates[0].targetAssetExposures);
  assert.deepEqual(original.candidates[0].ledger, mutated.candidates[0].ledger);
  assert.ok(original.candidates[0].ledger.length > 0);
});

test("B1 T5 uses A1 ledger reconciliation and explicit cost components", () => {
  const snapshot = makeSnapshot({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    alphaDefinitions: [alpha({ threshold: -1 })] });
  const candidate = snapshot.candidates[0];
  assert.ok(candidate.ledger.length > 0);
  for (const entry of candidate.ledger as Array<{ beginningNav: number; netPnl: number; endingNav: number;
    transactionCosts: number; slippage: number; cashPnl: number; etfPnl: number }>) {
    assert.ok(Math.abs(entry.beginningNav + entry.netPnl - entry.endingNav) < 1e-8);
    assert.ok(entry.transactionCosts >= 0 && entry.slippage >= 0);
    assert.ok(Math.abs(entry.netPnl - (entry.etfPnl + entry.cashPnl - entry.transactionCosts - entry.slippage)) < 1e-8);
  }
});

test("B1 T6 technical status ignores weak performance and reports missing factor", () => {
  const weak = makeSnapshot({ representation: "signals", assetTickers: ["A"], factorIds: ["momentum_0"], alphaDefinitions: [] });
  assert.equal(weak.candidates[0].status, "READY");
  const correlated = makeSnapshot({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    alphaDefinitions: [alpha({ name: "High cost", threshold: -1, transactionCostBps: 500 }),
      alpha({ name: "Correlated", threshold: -1, transactionCostBps: 500 })] });
  assert.ok(correlated.candidates.every((candidate) => candidate.status === "READY"));
  assert.equal(correlated.candidates.length, 2);
  assert.ok((correlated.dependence.signalCorrelations as unknown[]).length > 0);
  const absent = makeSnapshot({ representation: "signals", assetTickers: ["A"], factorIds: ["not-in-library"], alphaDefinitions: [] });
  assert.equal(absent.candidates[0].status, "INCOMPLETE");
  assert.match(absent.candidates[0].reasons.join(" "), /missing/);
  assert.equal(snapshotStatus(weak), "READY");
  const shortHistory = makeSnapshot({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    cutoffDate: "2020-01-04", alphaDefinitions: [alpha()] });
  assert.equal(shortHistory.candidates[0].status, "INSUFFICIENT_HISTORY");
  assert.equal(shortHistory.coverage.status, "observed uploaded coverage");
});

test("B1 T7 canonical identity ignores aliases but changes with executable rule; no legacy mandate", () => {
  const definitions = [alpha({ name: "Alias one" }), alpha({ name: "Alias two" }), alpha({ name: "Different threshold", threshold: 0 })];
  const snapshot = makeSnapshot({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [], alphaDefinitions: definitions });
  assert.equal(snapshot.candidates[0].canonicalFingerprint, snapshot.candidates[1].canonicalFingerprint);
  assert.equal(snapshot.candidates[0].diagnostics.duplicateOf, null);
  assert.equal(snapshot.candidates[1].diagnostics.duplicateOf, snapshot.candidates[0].candidateId);
  assert.notEqual(snapshot.candidates[0].candidateId, snapshot.candidates[2].candidateId);
  assert.equal("constraints" in snapshot.request, false);
  assert.equal(parseCsv(snapshot.dataset.csvContent).length, dates.length);
});