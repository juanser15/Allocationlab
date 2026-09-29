import assert from "node:assert/strict";
import test from "node:test";
import type { FactorDefinition } from "./factor-library";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import { buildSignalRidgePanel } from "./signal-ridge-panel";

const dates = Array.from({ length: 16 }, (_, index) =>
  new Date(Date.UTC(2022, 0, index + 1)).toISOString().slice(0, 10));
const tickers = ["AAA", "BBB"];

function csv(mutateAfterCutoff = false, missing?: { date: string; ticker: string }) {
  const rows = dates.map((date, index) => {
    const prices = tickers.map((ticker, assetIndex) => {
      let value = 100 + index * (assetIndex + 1) + Math.sin(index * (assetIndex + 1)) * 3;
      if (mutateAfterCutoff && date > dates[8]) value *= 7;
      return `${missing?.date === date && missing.ticker === ticker ? "" : value.toFixed(8)}`;
    });
    return [date, ...prices].join(",");
  });
  return ["date,AAA,BBB", ...rows].join("\n");
}

function factor(id: string, lookback: number, overrides: Partial<FactorDefinition> = {}): FactorDefinition {
  return {
    id, name: id, description: "", family: "Test", enabled: true, status: "active",
    inputSeries: "adjusted close", calculationType: "momentum",
    formula: `return(${lookback})`, direction: "higher_is_better", lookback, lag: 1,
    normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
    missingDataTreatment: "exclude", baseWeight: 1,
    regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
    activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "fixture",
    benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "frozen-v1",
    ...overrides,
  };
}

function snapshot(csvContent = csv(), cutoffDate?: string): PreparedSnapshot {
  const factors = [
    factor("mom-short", 2),
    factor("mom-short-alias", 2, { name: "display name only" }),
    factor("mom-long", 3),
  ];
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: tickers, factorIds: [], alphaDefinitions: [],
      ...(cutoffDate ? { cutoffDate } : {}) },
    csvContent, factorVersion: "frozen-v1", factors,
  });
}

function build(prepared: PreparedSnapshot, executionTiming: "same_close" | "next_close", decisionDate?: string) {
  return buildSignalRidgePanel({
    snapshot: prepared,
    factorIds: ["mom-short", "mom-short-alias", "mom-long"],
    assetTickers: tickers,
    asOfCutoff: dates[8],
    ...(decisionDate ? { decisionDate } : {}),
    executionTiming,
    dailyCashReturn: 0.0001,
  });
}

test("Signal Ridge panel canonicalizes exact aliases but retains distinct factors and records B1 stages", () => {
  const panel = build(snapshot(), "same_close");
  assert.deepEqual(panel.canonicalFactorIds, ["mom-short", "mom-long"]);
  assert.deepEqual(panel.factorAliases, {
    "mom-short": "mom-short",
    "mom-short-alias": "mom-short",
    "mom-long": "mom-long",
  });
  const current = panel.currentRows.find((row) => row.ticker === "AAA")!;
  assert.equal(current.signalDate, dates[9]);
  assert.equal(current.informationCutoff, dates[8]);
  assert.equal(current.calendarIndex, 9);
  const stages = current.features["mom-short"];
  assert.ok(Number.isFinite(stages.rawValue));
  assert.equal(stages.orientedValue, stages.transformedValue);
  assert.ok(Number.isFinite(stages.winsorizedValue));
  assert.ok(Number.isFinite(stages.normalizedValue));
  assert.deepEqual(current.peerUniverse, tickers);
  assert.ok(panel.trainingRows.every((row) => row.labelStatus === "MATURED" &&
    row.labelEnd !== null && row.labelEnd <= dates[8]));
});

test("same_close and next_close labels cover only the post-execution close interval", () => {
  const prepared = snapshot();
  const same = build(prepared, "same_close");
  const next = build(prepared, "next_close");
  const sameRow = same.panelRows.find((row) => row.signalDate === dates[5] && row.ticker === "AAA")!;
  const nextRow = next.panelRows.find((row) => row.signalDate === dates[5] && row.ticker === "AAA")!;
  assert.equal(sameRow.executionDate, dates[5]);
  assert.equal(sameRow.labelStart, dates[5]);
  assert.equal(sameRow.labelEnd, dates[6]);
  assert.equal(nextRow.executionDate, dates[6]);
  assert.equal(nextRow.labelStart, dates[6]);
  assert.equal(nextRow.labelEnd, dates[7]);
  const expectedSame = (100 + 6 + Math.sin(6) * 3) / (100 + 5 + Math.sin(5) * 3) - 1 - 0.0001;
  const expectedNext = (100 + 7 + Math.sin(7) * 3) / (100 + 6 + Math.sin(6) * 3) - 1 - 0.0001;
  assert.ok(Math.abs(sameRow.excessReturnLabel! - expectedSame) < 1e-8);
  assert.ok(Math.abs(nextRow.excessReturnLabel! - expectedNext) < 1e-8);
  assert.ok(next.panelRows.some((row) => row.labelStatus === "PENDING" && row.labelEnd! > dates[8]));
});

test("future price mutation cannot alter as-of features or matured training inputs", () => {
  const original = build(snapshot(csv()), "next_close");
  const mutated = build(snapshot(csv(true)), "next_close");
  assert.deepEqual(original.panelRows, mutated.panelRows);
  assert.deepEqual(original.trainingRows, mutated.trainingRows);
  assert.deepEqual(original.currentRows, mutated.currentRows);
});

test("calendar indexes retain CSV date gaps rather than compressing available panel dates", () => {
  const lines = csv().split("\n");
  const missingDateLine = dates[4];
  lines[5] = `${missingDateLine},,`;
  const panel = build(snapshot(lines.join("\n")), "same_close");
  const afterGap = panel.panelRows.find((row) => row.signalDate === dates[5] && row.ticker === "AAA")!;
  assert.equal(afterGap.calendarIndex, 5);
});

test("latest-cutoff live panel supports virtual same_close and rejects unknown next_close execution", () => {
  const original = build(snapshot(csv(), dates[8]), "same_close", dates[9]);
  assert.equal(original.currentSignalIsVirtual, true);
  assert.equal(original.declaredDecisionDate, dates[9]);
  assert.equal(original.currentSignalDate, dates[9]);
  assert.equal(original.currentRows[0].informationCutoff, dates[8]);
  assert.equal(original.currentRows[0].calendarIndex, 9);
  assert.equal(original.currentRows[0].executionDate, dates[9]);
  assert.equal(original.currentRows[0].labelStart, dates[9]);
  assert.equal(original.currentRows[0].labelEnd, null);
  assert.equal(original.currentRows[0].labelStatus, "PENDING");

  const mutated = build(snapshot(csv(true), dates[8]), "same_close", dates[9]);
  assert.deepEqual(original.currentRows, mutated.currentRows);
  assert.throws(
    () => build(snapshot(csv(), dates[8]), "next_close", dates[9]),
    /next_close execution after decisionDate .* no following trading-calendar observation/,
  );
  assert.throws(
    () => build(snapshot(csv()), "same_close", dates[10]),
    /does not match the frozen following observation/,
  );
});

test("an incomplete historical training date is excluded as a balanced date and missing current features fail explicitly", () => {
  const missingHistorical = snapshot(csv(false, { date: dates[3], ticker: "AAA" }));
  const panel = build(missingHistorical, "same_close");
  const affected = panel.excludedTrainingDates.find((date) => date.signalDate === dates[2]);
  assert.ok(affected);
  assert.ok(affected.reasons.some((reason) => reason.startsWith("label_unavailable:")));
  assert.ok(!panel.trainingRows.some((row) => row.signalDate === dates[2]));

  const missingCurrent = snapshot(csv(false, { date: dates[8], ticker: "AAA" }));
  assert.throws(() => build(missingCurrent, "same_close"), /Current as-of features are missing/);
});