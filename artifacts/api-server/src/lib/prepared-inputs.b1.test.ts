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
  const transformations = [
    { type: "momentum", lookback: 5, direction: "higher_is_better", formula: "P(t-lag)/P(t-lag-lookback)-1" },
    { type: "trend_quality", lookback: 10, direction: "higher_is_better", formula: "trendQuality(P[t-lookback:t-lag])" },
    { type: "volatility", lookback: 8, direction: "lower_is_better", formula: "realizedVolatility(P[t-lookback:t-lag])" },
    { type: "drawdown", lookback: 12, direction: "higher_is_better", formula: "-maxDrawdown(P[t-lookback:t-lag])" },
    { type: "mean_reversion", lookback: 4, direction: "higher_is_better", formula: "-return(P[t-lookback:t-lag])" },
    { type: "ma_distance", lookback: 15, direction: "higher_is_better", formula: "P(t-lag)/mean(P[t-lookback:t-lag])-1" },
  ];
  return Array.from({ length: count }, (_, i) => {
    const definition = transformations[i % transformations.length];
    return {
      id: `factor_${i}`, name: `${definition.type} ${i}`, description: "test commentary", family: "Test",
      enabled: true, status: "active", inputSeries: "adjusted close", calculationType: definition.type,
      formula: definition.formula, direction: definition.direction,
      lookback: definition.lookback + Math.floor(i / transformations.length), lag: 0, normalization: "percentile_rank",
      winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude", baseWeight: 1,
      regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 }, activeRegimes: ["risk_on", "neutral", "risk_off"],
      dataSource: "test synthetic prices", benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "v-test",
    } as FactorDefinition;
  });
}
function alpha(overrides: Partial<AlphaDefinition> = {}): AlphaDefinition {
  return {
    name: "Long A", factorId: "factor_0", assetTickers: ["A"], mapping: "single_asset_long_cash",
    signalUnits: "oriented", threshold: -1, grossFraction: 0.5, rebalanceFrequency: "monthly",
    executionTiming: "next_close", transactionCostBps: 10, slippageBps: 5, cashYieldAnnual: 0, ...overrides,
  };
}
function makeSnapshot(request: PreparedRequest, csv = csvWithMutation()) {
  return prepareSnapshot({ request, csvContent: csv, factorVersion: "v-test", factors: factors(6) });
}

test("B1 T1 separates raw signal values from alpha returns and blocks absent mappings", () => {
  const snapshot = makeSnapshot({ representation: "signals", assetTickers: ["A"], factorIds: ["factor_0"], alphaDefinitions: [] });
  const candidate = snapshot.candidates[0];
  assert.equal(candidate.kind, "signals");
  assert.ok(candidate.signalSeries.some((point) => point.value !== null));
  assert.deepEqual(candidate.returnSeries, []);
  assert.match(validatePreparedRequest({ representation: "alpha_streams", assetTickers: ["A"], factorIds: [],
    alphaDefinitions: [] }) ?? "", /explicit alphaDefinitions/);
});

test("B1 T2 prepares thirty mapped alpha streams with executed holdings and reconciled A1 ledgers", () => {
  const definitions = tickers.flatMap((ticker) => factors(6).map((factor, factorIndex) => alpha({
    name: `${ticker} ${factor.id}`, factorId: factor.id, assetTickers: [ticker], mapping: "single_asset_long_cash",
    signalUnits: "oriented", threshold: -1, grossFraction: 0.35 + factorIndex * 0.02,
    rebalanceFrequency: "monthly", executionTiming: "next_close", transactionCostBps: 0,
    slippageBps: 0, cashYieldAnnual: 0,
  })));
  const snapshot = makeSnapshot({ representation: "alpha_streams", assetTickers: tickers,
    factorIds: [], alphaDefinitions: definitions });
  assert.equal(snapshot.candidates.length, 30);
  assert.equal(new Set(snapshot.candidates.map((candidate) => candidate.candidateId)).size, 30);
  assert.equal(new Set(snapshot.candidates.map((candidate) => candidate.lineage.factorDefinitionId)).size, 6);
  assert.equal(new Set(snapshot.candidates.map((candidate) => candidate.assetTickers[0])).size, 5);
  for (const candidate of snapshot.candidates) {
    assert.equal(candidate.status, "READY", `${candidate.name}: ${candidate.reasons.join("; ")}`);
    assert.ok(candidate.lineage.datasetHash && candidate.candidateId);
    assert.equal(candidate.mapping, "single_asset_long_cash");
    assert.ok(candidate.targetHistory.length > 0, `${candidate.name} has target history`);
    assert.ok(candidate.targetHistory.some((entry) => Object.keys(entry.targetPositions).length > 0),
      `${candidate.name} has a nonzero mapped target`);
    assert.ok(candidate.ledger.length > 0, `${candidate.name} has daily A1 ledger rows`);
    assert.ok(candidate.returnSeries.length > 0, `${candidate.name} has daily returns`);
    assert.ok(Object.values(candidate.actualAssetExposures).some((weight) => weight > 0),
      `${candidate.name} has an executed ending holding`);
    const frozenDefinition = candidate.lineage.definition as AlphaDefinition;
    assert.equal(frozenDefinition.mapping, "single_asset_long_cash");
    assert.ok(frozenDefinition.grossFraction > 0 && frozenDefinition.grossFraction < 1);
    assert.equal(frozenDefinition.cashYieldAnnual, 0);
    assert.ok(candidate.targetHistory.some((entry) =>
      Math.abs(Object.values(entry.targetPositions).reduce((sum, weight) => sum + weight, 0) -
        frozenDefinition.grossFraction) < 1e-8), `${candidate.name} applies its configured asset/cash split`);
    assert.equal((candidate.ledger[0] as { beginningNav: number }).beginningNav, 100,
      `${candidate.name} starts with $100 A1 reference capital`);
    assert.ok((candidate.ledger as Array<{ endingCash: number }>).some((entry) => entry.endingCash > 0),
      `${candidate.name} retains the explicit residual cash allocation`);
    for (const raw of candidate.ledger) {
      const entry = raw as { beginningNav: number; netPnl: number; endingNav: number;
        transactionCosts: number; slippage: number; cashPnl: number; etfPnl: number };
      assert.ok(Math.abs(entry.beginningNav + entry.netPnl - entry.endingNav) < 1e-8,
        `${candidate.name} NAV reconciliation`);
      assert.ok(Math.abs(entry.netPnl - (entry.etfPnl + entry.cashPnl -
        entry.transactionCosts - entry.slippage)) < 1e-8, `${candidate.name} P&L reconciliation`);
    }
  }
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
  const weak = makeSnapshot({ representation: "signals", assetTickers: ["A"], factorIds: ["factor_0"], alphaDefinitions: [] });
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

test("B1 T6 marks a missing price on a previously held asset INVALID_DATA without fabricated full-period results", () => {
  const missingDate = dates[45];
  const request: PreparedRequest = { representation: "alpha_streams", assetTickers: ["A", "B"], factorIds: [],
    alphaDefinitions: [alpha({ threshold: -1 })] };
  const validCsv = csvWithMutation();
  const valid = makeSnapshot(request, validCsv).candidates[0];
  assert.equal(valid.status, "READY", valid.reasons.join("; "));
  assert.ok(valid.ledger.some((raw) => {
    const row = raw as { date: string; endingPositions: Array<{ ticker: string; weight: number }> };
    return row.date < missingDate &&
      row.endingPositions.some((position) => position.ticker === "A" && position.weight > 0);
  }), "the valid fixture executes and holds A before the removed price observation");

  const lines = validCsv.split("\n");
  const rowIndex = lines.findIndex((line) => line.startsWith(`${missingDate},`));
  assert.ok(rowIndex > 0, `the fixture contains ${missingDate}`);
  const columns = lines[rowIndex].split(",");
  columns[1] = "";
  lines[rowIndex] = columns.join(",");
  const missingCsv = lines.join("\n");
  const missingRow = parseCsv(missingCsv).find((row) => row.date === missingDate);
  assert.ok(missingRow, "other price observations retain the date");
  assert.equal(missingRow.prices.A, undefined);
  assert.ok(Number.isFinite(missingRow.prices.B), "peer asset B remains observed on that date");

  const invalid = makeSnapshot(request, missingCsv).candidates[0];
  assert.equal(invalid.status, "INVALID_DATA");
  assert.ok(invalid.reasons.some((reason) => reason.includes("A") && reason.includes(missingDate)),
    `the affected ticker and date are explicit: ${invalid.reasons.join("; ")}`);
  assert.deepEqual(invalid.returnSeries, [], "no full-period return is presented for the invalid stream");
  assert.deepEqual(invalid.ledger, [], "no successful full-period A1 ledger is presented");
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