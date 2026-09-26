import assert from "node:assert/strict";
import test from "node:test";
import { computeRegime, parseCsv } from "./calculator";
import { computeC2Diagnostics, type C2Input } from "./c2-diagnostics";
import type { AllocationRequest } from "./allocation-b2";
import { C1_ESTIMATION_ALIGNMENT_RULE, runB3Validation, type B3Assumptions, type B3EstimationDatePlan, type B3Result } from "./b3-policy";
import { prepareSnapshot, type PreparedCandidate, type PreparedSnapshot } from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";

const dateAt = (index: number) => new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10);
const count = 180;

function frozenCsv() {
  const prices = ["date,A,B,C"];
  for (let i = 0; i < count; i++) {
    const level = i < 60 ? 100 + i * .5 : i < 120 ? 130 - (i - 60) * .5 : 100 + (i - 120) * .7;
    const wave = Math.sin(i * .37) * 1.5;
    prices.push(`${dateAt(i)},${(level + wave).toFixed(6)},${(level * .8 + Math.sin(i * .21) * 2).toFixed(6)},${(level * 1.2 + Math.cos(i * .17) * 2).toFixed(6)}`);
  }
  return prices.join("\n");
}

const csv = frozenCsv();
const rows = parseCsv(csv);
const frozenLabels = rows.map((row, index) => index < 10 ? null : computeRegime(rows.slice(0, index), ["A", "B", "C"]).label);
const labelCounts = new Map<string, number>();
for (const label of frozenLabels) if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
const dominant = [...labelCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Neutral";
const divergenceRegime = [...labelCounts].find(([label, n]) => label !== dominant && n >= 30)?.[0] ??
  [...labelCounts].sort((a, b) => b[1] - a[1])[1]?.[0] ?? dominant;

function candidate(id: string, returns: Array<number | null>, exposures = ["A"]): PreparedCandidate {
  return {
    candidateId: id, canonicalFingerprint: id, name: id, kind: "alpha_streams", status: "READY", reasons: [],
    factorId: "mom", assetTickers: exposures, mapping: "single_asset_long_cash", signalUnits: "oriented",
    targetAssetExposures: { [exposures[0]]: 1 }, actualAssetExposures: { [exposures[0]]: 1 },
    targetHistory: returns.map((_, i) => ({ signalDate: dateAt(i + 1), informationCutoff: dateAt(i),
      executionDate: dateAt(i + 1), targetPositions: { [exposures[0]]: 1 } })),
    residualCash: 0, signalSeries: [], returnSeries: returns.map((value, i) => ({ date: dateAt(i + 1), value })),
    ledger: returns.map((value, i) => ({ date: dateAt(i + 1), netPnl: value, beginningNav: 1,
      endingNav: 1, endingCash: 0, endingPositions: [{ ticker: exposures[0], marketValue: 1, weight: 1 }],
      externalTradedNotional: i / 1000, transactionCosts: .00001, slippage: .000005 })),
    lineage: { datasetHash: "fixture-hash", definition: { cashYieldAnnual: .025 } }, diagnostics: {},
  } as unknown as PreparedCandidate;
}

const fixtureReturns = Array.from({ length: count - 1 }, (_, i) => {
  const a = .0008 + Math.sin(i * 1.71) * .0015;
  return a;
});
const similarReturns = fixtureReturns.map((value, i) => value + Math.cos(i * 2.31) * .000015);
const divergentReturns = fixtureReturns.map((value, i) => frozenLabels[i + 1] === divergenceRegime
  ? .0002 + Math.sin(i * 2.43) * .0008 : value + Math.cos(i * 2.31) * .000015);

const alphaA = candidate("alpha-a", fixtureReturns);
const alphaB = candidate("alpha-b", divergentReturns, ["B"]);
const alphaSimilar = candidate("alpha-similar", similarReturns);
const validation = {
  schemaVersion: 1, engineVersion: "b1-test", a1EngineVersion: "a1-test", representation: "alpha_streams",
  dataset: { id: 1, sha256: "fixture-hash", csvContent: csv, startDate: dateAt(0), endDate: dateAt(count - 1),
    tickers: ["A", "B", "C"], priceConvention: "test" },
  factorSet: { version: "f1", factors: [] }, request: {}, coverage: {}, candidates: [alphaA, alphaB, alphaSimilar],
  dependence: {}, suppliedWeights: {}, createdAt: dateAt(0),
} as unknown as PreparedSnapshot;
const policy = validation;
const request = { preparedInputId: 1, candidateIds: ["alpha-a", "alpha-b"], informationCutoff: dateAt(100),
  decisionTimestamp: dateAt(101), estimationWindow: 30, minObservations: 20, representation: "alpha_streams",
  returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
  dailyCashYield: .0001, objective: { type: "minimum_variance", gamma: 1, eta: 0 },
  constraints: {} } as AllocationRequest;

function input(overrides: Partial<C2Input> = {}): C2Input {
  return {
    allocationId: 1, validationPreparedInputId: 1, c1ExperimentId: null, alphaIds: ["alpha-a", "alpha-b"],
    startDate: dateAt(1), endDate: dateAt(count - 1), regimeSource: "frozen_b1_prefix", regimeMapping: {},
    rollingWindow: 20, rollingStep: 10, contributionWindow: 40, contributionStep: 20,
    minRollingPaired: 10, minRegimePaired: 20, minSharpeObservations: 10,
    highCorrelationThreshold: .65, materialCorrelationGap: .15,
    ...overrides,
  };
}
async function analyze(config = input(), snapshot = validation, c1?: any) {
  return computeC2Diagnostics(config, { validation: snapshot, policy, allocationRequest: request, ...(c1 ? { c1 } : {}) });
}
function close(actual: number | null, expected: number, tolerance = 1e-8) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} differs from ${expected}`);
}
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function std(values: number[]) {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

function createB3Fixture() {
  const factor: FactorDefinition = {
    id: "c2_test_momentum", name: "C2 test momentum", description: "fixture", family: "Test",
    enabled: true, status: "active", inputSeries: "adjusted close", calculationType: "momentum",
    formula: "return(5)", direction: "higher_is_better", lookback: 5, lag: 0,
    normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
    missingDataTreatment: "exclude", baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
    activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "fixture", benchmarkTicker: null,
    currentCoverage: 1, availabilityReason: null, version: "fixture-v1",
  };
  const assets = ["A", "B"];
  const data = ["date,A,B", ...Array.from({ length: 180 }, (_, i) => {
    const a = 100 + i * .16 + Math.sin(i * .37) * 3 + Math.cos(i * .07);
    const b = 100 + i * .11 + Math.sin(i * .23) * 4 + Math.cos(i * .13) * 2;
    return `${dateAt(i)},${a.toFixed(8)},${b.toFixed(8)}`;
  })].join("\n");
  const prepared = prepareSnapshot({
    request: { representation: "alpha_streams", assetTickers: assets, factorIds: [],
      alphaDefinitions: assets.map((ticker) => ({ name: ticker, factorId: factor.id, assetTickers: [ticker],
        mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const, threshold: -100,
        grossFraction: 1, rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
        transactionCostBps: 1, slippageBps: 0, cashYieldAnnual: 0 })) },
    csvContent: data, factorVersion: factor.version, factors: [factor], datasetId: 17,
  });
  const ids = prepared.candidates.map((item) => item.candidateId);
  const fullRequest: AllocationRequest = {
    preparedInputId: 17, candidateIds: ids, informationCutoff: dateAt(100), decisionTimestamp: dateAt(101),
    estimationWindow: 30, minObservations: 15, representation: "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: .1, covarianceDiagonalShrinkage: .05,
    dailyCashYield: .0001, objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { min: 0, max: 1 } },
  };
  const withoutRequest = { ...fullRequest, candidateIds: [ids[0]] };
  const assumptions: B3Assumptions = {
    evaluationStartDate: dateAt(31), evaluationEndDate: dateAt(120), decisionCalendar: "monthly",
    executionTiming: "next_close", initialNav: 100, initialHoldings: {}, initialCash: 100,
    transactionCostBps: 2, slippageBps: 0, dailyCashYield: .0001,
  };
  const c1: any = { manifest: { schemaVersion: 1, candidateIds: ids, assumptions,
    developmentPeriod: { startDate: assumptions.evaluationStartDate, endDate: assumptions.evaluationEndDate },
    holdoutStartDate: dateAt(121), validationCandidateIds: Object.fromEntries(ids.map((id) => [id, id])),
    plans: [{ excludedCandidateIds: [], policyRequest: fullRequest },
      { excludedCandidateIds: [ids[1]], policyRequest: withoutRequest }] }, children: [], summary: {} };
  return { prepared, ids, fullRequest, withoutRequest, assumptions, c1 };
}

function independentlyAlignedPair(prepared: PreparedSnapshot, fullRequest: AllocationRequest,
  withoutRequest: AllocationRequest, assumptions: B3Assumptions) {
  const fullReference = runB3Validation(prepared, fullRequest, prepared, assumptions);
  const decisions = new Map(fullReference.decisions.map((item) => [item.decisionDate, item]));
  const rows = parseCsv(prepared.dataset.csvContent);
  let blocked = false;
  const alignmentPlan: B3EstimationDatePlan = {
    rule: C1_ESTIMATION_ALIGNMENT_RULE,
    referenceCandidateIds: [...fullRequest.candidateIds],
    decisions: fullReference.decisionCalendar.map(({ decisionDate }) => {
      const decision = decisions.get(decisionDate);
      if (decision && !blocked) return { decisionDate, informationCutoff: decision.informationCutoff,
        estimationDates: [...decision.estimationDates], observationCount: decision.estimationDates.length };
      blocked = true;
      return { decisionDate, informationCutoff: rows.filter((row) => row.date < decisionDate).at(-1)?.date ?? "",
        estimationDates: [], observationCount: 0,
        failureReason: fullReference.reason ?? `Full baseline failed at ${fullReference.failureDate ?? decisionDate}.` };
    }),
  };
  return { fullReference, alignmentPlan,
    full: runB3Validation(prepared, fullRequest, prepared, assumptions, alignmentPlan),
    without: runB3Validation(prepared, withoutRequest, prepared, assumptions, alignmentPlan) };
}

function decisionDistancesForTest(full: B3Result, without: B3Result, date: string, fullIds: string[]) {
  const a = full.decisions.find((item) => item.decisionDate === date)!;
  const b = without.decisions.find((item) => item.decisionDate === date)!;
  const alphaA = [...fullIds.map((id) => a.candidateWeights[id] ?? 0), a.masterCash];
  const alphaB = [...fullIds.map((id) => b.candidateWeights[id] ?? 0), b.masterCash];
  const alphaCapitalDistance = .5 * alphaA.reduce((sum, value, index) => sum + Math.abs(value - alphaB[index]), 0);
  const tickers = [...new Set([...Object.keys(a.targetAssetWeights), ...Object.keys(b.targetAssetWeights)])].sort();
  const assetsA = [...tickers.map((ticker) => a.targetAssetWeights[ticker] ?? 0), a.totalCash];
  const assetsB = [...tickers.map((ticker) => b.targetAssetWeights[ticker] ?? 0), b.totalCash];
  const underlyingAssetDistance = .5 * assetsA.reduce((sum, value, index) => sum + Math.abs(value - assetsB[index]), 0);
  return { alphaCapitalDistance, underlyingAssetDistance };
}

test("T1: rolling stability metrics match independent calculations and short Sharpe stays null", async () => {
  const config = input({ alphaIds: ["alpha-a"], rollingWindow: 8, rollingStep: 4, minSharpeObservations: 10 });
  const output = await analyze(config);
  const points = alphaA.returnSeries.filter((point) => point.date >= config.startDate && point.date <= config.endDate)
    .map((point) => point.value!).filter(Number.isFinite);
  const windows = (output.stability.alphas[0] as any).rolling;
  let outputIndex = 0;
  for (let end = 8; end <= points.length; end += 4) {
    const sample = points.slice(end - 8, end);
    const actual = windows[outputIndex++];
    close(actual.netReturn, sample.reduce((wealth, value) => wealth * (1 + value), 1) - 1);
    close(actual.annualizedVolatility, std(sample) * Math.sqrt(252));
    assert.equal(actual.sharpe, null);
    assert.equal(actual.sharpeReason, "INSUFFICIENT_HISTORY");
  }
  assert.equal(windows.length, outputIndex);
  const defined = await analyze(input({ alphaIds: ["alpha-a"], rollingWindow: 8, rollingStep: 4, minSharpeObservations: 8 }));
  const definedWindows = (defined.stability.alphas[0] as any).rolling;
  for (let index = 0, end = 8; end <= points.length; index++, end += 4) {
    const sample = points.slice(end - 8, end);
    const excess = sample.map((value) => value - (Math.pow(1.025, 1 / 252) - 1));
    close(definedWindows[index].sharpe, Math.sqrt(252) * mean(excess) / std(excess));
    close(definedWindows[index].grossReturn,
      sample.reduce((wealth, value) => wealth * (1 + value + .000015), 1) - 1);
  }
  const brokenLedgerCandidate = { ...alphaA, ledger: alphaA.ledger.map((entry: any) => {
    const { slippage: _slippage, ...remaining } = entry;
    return remaining;
  }) } as PreparedCandidate;
  const brokenSnapshot = { ...validation, candidates: [brokenLedgerCandidate] } as PreparedSnapshot;
  const noGross = await analyze(input({ alphaIds: ["alpha-a"], rollingWindow: 8, rollingStep: 4 }), brokenSnapshot);
  assert.equal((noGross.stability.alphas[0] as any).rolling[0].grossReturn, null);
  assert.equal((noGross.stability.alphas[0] as any).rolling[0].grossReturnStatus, "UNAVAILABLE_LEDGER_EVIDENCE");
  const short = await analyze(input({ alphaIds: ["alpha-a"], rollingWindow: 2_000 }));
  assert.equal((short.stability.alphas[0] as any).rollingStatus, "INSUFFICIENT_HISTORY");
  assert.equal((short.stability.alphas[0] as any).rolling.length, 0);
});

test("T2: prefix regime labels and conditional statistics are point-in-time", async () => {
  const output = await analyze(input({ alphaIds: ["alpha-a"] }));
  const firstStat = (output.regimes.conditionalPerformance[0] as any).regimes;
  const label = [...Object.keys(firstStat)].find((key) => (firstStat[key].observations ?? 0) >= 20);
  assert.ok(label);
  const selectedDates = output.regimes.series.filter((item: any) => item.label === label)
    .map((item: any) => item.date);
  const values = alphaA.returnSeries.filter((point) => selectedDates.includes(point.date)).map((point) => point.value!);
  const expectedExcess = values.map((value) => value - (Math.pow(1.025, 1 / 252) - 1));
  const actual = firstStat[label!];
  assert.equal(actual.observations, values.length);
  close(actual.meanDailyExcessReturn, mean(expectedExcess));
  close(actual.volatility, std(values) * Math.sqrt(252));
  close(actual.averageDailyCost, .000015);
  const alteredCsv = csv.split("\n").map((line, i) => i > 145 ? line.replace(/,([^,]+)$/, ",999.25") : line).join("\n");
  const altered = { ...validation, dataset: { ...validation.dataset, csvContent: alteredCsv } } as PreparedSnapshot;
  const later = await analyze(input({ alphaIds: ["alpha-a"] }), altered);
  const throughCutoff = dateAt(100);
  assert.deepEqual(output.regimes.series.filter((item: any) => item.date <= throughCutoff),
    later.regimes.series.filter((item: any) => item.date <= throughCutoff));
});

test("T3: high full-sample correlation retains regime divergence evidence", async () => {
  const output = await analyze();
  const pair = output.dependence.pairs[0] as any;
  assert.ok(pair.fullSample.correlation > .65);
  assert.ok(pair.regimeCorrelation.some((item: any) => item.correlation !== null));
  assert.equal(pair.flag, "REGIME_DIVERGENCE_OBSERVED");
  assert.ok(pair.regimeCorrelation.some((item: any) => item.regime === dominant && item.correlation > .65));
  assert.ok(pair.regimeCorrelation.some((item: any) => item.correlation !== null &&
    item.regime === divergenceRegime && pair.fullSample.correlation - item.correlation >= .15));
  assert.ok(pair.exposureDistance.length > 0);
  assert.ok(pair.exposureDistance.every((item: any) => item.distance === 1 && item.similarity === 0));
  assert.ok(pair.exposureDistance.every((item: any) => item.riskyExposureA === 1 &&
    item.riskyExposureB === 1 && item.cashExposureA === 0 && item.cashExposureB === 0));
  assert.deepEqual(output.source.b1AlphaIds, ["alpha-a", "alpha-b"]);
  assert.ok(pair.regimeCorrelation.some((item: any) => item.regime === divergenceRegime));
  assert.equal(pair.flagNote.includes("no candidate selection"), true);
});

test("T4: economically similar streams remain available without automatic selection", async () => {
  const snapshot = { ...validation, candidates: [alphaA, alphaSimilar] } as PreparedSnapshot;
  const output = await analyze(input({ alphaIds: ["alpha-a", "alpha-similar"] }), snapshot);
  const pair = output.dependence.pairs[0] as any;
  assert.ok(pair.fullSample.correlation > .99);
  assert.ok(pair.rollingCorrelation.series.length > 0);
  assert.ok(pair.rollingCorrelation.series.every((item: any) => item.value > .99));
  assert.ok(pair.regimeCorrelation.filter((item: any) => item.correlation !== null)
    .every((item: any) => item.correlation > .99));
  assert.ok(pair.exposureSimilarityByRegime.length > 0);
  assert.ok(pair.exposureSimilarityByRegime.every((item: any) => item.meanSimilarity === 1));
  assert.ok(pair.exposureDistance.every((item: any) => item.status === "AVAILABLE" &&
    item.riskyExposureA === 1 && item.riskyExposureB === 1 && item.cashExposureA === 0 && item.cashExposureB === 0));
  assert.equal(pair.flag, "PERSISTENTLY_SIMILAR");
  assert.equal(output.stability.alphas.length, 2);
  assert.deepEqual(output.source.b1AlphaIds, ["alpha-a", "alpha-similar"]);
});

test("T5: conditional contribution uses matched C1 ledgers, not regime-specific reoptimization", async () => {
  const fixture = createB3Fixture();
  const aligned = independentlyAlignedPair(fixture.prepared, fixture.fullRequest, fixture.withoutRequest, fixture.assumptions);
  fixture.c1.children = [
    { excludedCandidateIds: [], result: aligned.full },
    { excludedCandidateIds: [fixture.ids[1]], result: aligned.without },
  ];
  const output = await computeC2Diagnostics(input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: 42, alphaIds: [fixture.ids[1]], startDate: fixture.assumptions.evaluationStartDate,
    endDate: fixture.assumptions.evaluationEndDate,
    minSharpeObservations: 2 }), {
    validation: fixture.prepared, policy: fixture.prepared, allocationRequest: fixture.fullRequest, c1: fixture.c1,
  });
  const contribution = output.incrementalContribution.conditional as any[];
  const available = contribution.filter((item) => item.status === "AVAILABLE");
  assert.ok(available.length > 0);
  assert.equal(aligned.full.status, "completed");
  assert.equal(aligned.without.status, "completed");
  for (const row of available) {
    const regimeDates = new Set(output.regimes.series.filter((item: any) => item.label === row.regime)
      .map((item: any) => item.date));
    const commonDates = aligned.full.dailyLedger.filter((entry) => regimeDates.has(entry.date) &&
      aligned.without.dailyLedger.some((other) => other.date === entry.date)).map((entry) => entry.date);
    const fullEntries = aligned.full.dailyLedger.filter((entry) => commonDates.includes(entry.date));
    const withoutEntries = aligned.without.dailyLedger.filter((entry) => commonDates.includes(entry.date));
    const fullReturns = fullEntries.map((entry) => entry.dailyNetReturn);
    const withoutReturns = withoutEntries.map((entry) => entry.dailyNetReturn);
    const fullCash = aligned.full.assumptions.dailyCashYield;
    const withoutCash = aligned.without.assumptions.dailyCashYield;
    const fullExcess = fullReturns.map((value) => value - fullCash);
    const withoutExcess = withoutReturns.map((value) => value - withoutCash);
    close(row.deltas.meanReturn, mean(fullReturns) - mean(withoutReturns));
    close(row.deltas.volatility, (std(fullReturns) - std(withoutReturns)) * Math.sqrt(252));
    close(row.deltas.sharpe, Math.sqrt(252) * mean(fullExcess) / std(fullExcess) -
      Math.sqrt(252) * mean(withoutExcess) / std(withoutExcess));
    const fullCosts = fullEntries.reduce((sum, entry) => sum + entry.transactionCosts + entry.slippage, 0);
    const withoutCosts = withoutEntries.reduce((sum, entry) => sum + entry.transactionCosts + entry.slippage, 0);
    close(row.deltas.cost, fullCosts - withoutCosts);
    const decisionDates = aligned.full.decisions.filter((decision) => regimeDates.has(decision.decisionDate) &&
      aligned.without.decisions.some((item) => item.decisionDate === decision.decisionDate)).map((item) => item.decisionDate);
    assert.deepEqual(row.matchedDecisionDates, decisionDates);
    assert.equal(row.allocationDistances.length, decisionDates.length);
    for (const distance of row.allocationDistances) {
      const independent = decisionDistancesForTest(aligned.full, aligned.without, distance.date, fixture.ids);
      close(distance.alphaCapitalDistance, independent.alphaCapitalDistance);
      close(distance.underlyingAssetDistance, independent.underlyingAssetDistance);
    }
  }
  assert.equal(output.incrementalContribution.methodology.includes("not causal"), true);
});

test("T6: rolling C1 contribution exposes three predeclared development windows without promotion", async () => {
  const fixture = createB3Fixture();
  const aligned = independentlyAlignedPair(fixture.prepared, fixture.fullRequest, fixture.withoutRequest, fixture.assumptions);
  fixture.c1.children = [
    { excludedCandidateIds: [], result: aligned.full },
    { excludedCandidateIds: [fixture.ids[1]], result: aligned.without },
  ];
  const config = input({ allocationId: 17, validationPreparedInputId: 17, c1ExperimentId: 42,
    alphaIds: [fixture.ids[1]], startDate: fixture.assumptions.evaluationStartDate,
    endDate: fixture.assumptions.evaluationEndDate, contributionWindow: 65, contributionStep: 10 });
  const output = await computeC2Diagnostics(config, { validation: fixture.prepared,
    policy: fixture.prepared, allocationRequest: fixture.fullRequest, c1: fixture.c1 });
  const windows = output.incrementalContribution.rolling as any[];
  assert.equal(windows.length, 3);
  assert.equal(new Set(windows.map((item) => `${item.startDate}:${item.endDate}`)).size, 3);
  for (const window of windows) {
    assert.ok(window.startDate >= fixture.c1.manifest.developmentPeriod.startDate);
    assert.ok(window.endDate <= fixture.c1.manifest.developmentPeriod.endDate);
    assert.ok(window.endDate < fixture.c1.manifest.holdoutStartDate);
    const assumptions = { ...fixture.assumptions, evaluationStartDate: window.startDate, evaluationEndDate: window.endDate };
    const independent = independentlyAlignedPair(fixture.prepared, fixture.fullRequest, fixture.withoutRequest, assumptions);
    assert.deepEqual(window.alignment, {
      rule: C1_ESTIMATION_ALIGNMENT_RULE, referenceCandidateIds: fixture.ids,
      plannedDecisions: independent.alignmentPlan.decisions.length,
      alignedDecisions: independent.alignmentPlan.decisions.filter((item) => !item.failureReason).length,
      failedDecisions: independent.alignmentPlan.decisions.filter((item) => item.failureReason).length,
    });
    if (independent.full.status === "completed" && independent.without.status === "completed" &&
        independent.full.decisions.length >= 2 && independent.without.decisions.length >= 2) {
      assert.equal(window.status, "AVAILABLE");
      const a = independent.full.metrics!, b = independent.without.metrics!;
      close(window.metrics.netReturnDelta, a.cumulativeReturn! - b.cumulativeReturn!);
      close(window.metrics.sharpeDelta, a.sharpe! - b.sharpe!);
      close(window.metrics.volatilityDelta, a.annualizedVolatility! - b.annualizedVolatility!);
      close(window.metrics.drawdownDelta, a.maximumDrawdown! - b.maximumDrawdown!);
      close(window.metrics.costDelta, a.totalTransactionCosts! - b.totalTransactionCosts!);
      assert.equal(window.allocationDistances.length, independent.full.decisions.length);
      for (const distance of window.allocationDistances) {
        const expected = decisionDistancesForTest(independent.full, independent.without, distance.date, fixture.ids);
        close(distance.alphaCapitalDistance, expected.alphaCapitalDistance);
        close(distance.underlyingAssetDistance, expected.underlyingAssetDistance);
      }
    } else {
      assert.equal(window.status, "INSUFFICIENT_HISTORY");
      assert.equal(window.metrics, null);
    }
  }
  assert.equal(JSON.stringify(output).includes("bestAlpha"), false);
});

test("T7: sparse and missing prefix regimes remain explicitly insufficient", async () => {
  const result = await analyze(input({ alphaIds: ["alpha-a"], minRegimePaired: 10_000, minSharpeObservations: 10_000 }));
  assert.ok(result.regimes.series.some((item: any) => item.status === "INSUFFICIENT_HISTORY"));
  const conditional = (result.dependence.pairs as any[]);
  assert.equal(conditional.length, 0);
  const statistics = (result.regimes.conditionalPerformance[0] as any).regimes;
  assert.ok(Object.values(statistics).every((item: any) =>
    item.status === "INSUFFICIENT_HISTORY" && item.sharpe === null && item.meanDailyExcessReturn === null));
  assert.ok(result.regimes.series.some((item: any) => item.label === null));
});

test("R1: per-alpha adapter reuses only the selected alpha dependency and reports its immutable ID", async () => {
  const fixture = createB3Fixture();
  const aligned = independentlyAlignedPair(fixture.prepared, fixture.fullRequest,
    fixture.withoutRequest, fixture.assumptions);
  fixture.c1.children = [
    { excludedCandidateIds: [], result: aligned.full },
    { excludedCandidateIds: [fixture.ids[1]], result: aligned.without },
  ];
  const config = input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: null, alphaIds: [fixture.ids[1]],
    startDate: fixture.assumptions.evaluationStartDate, endDate: fixture.assumptions.evaluationEndDate,
    minSharpeObservations: 2 });
  const legacy = await computeC2Diagnostics(config, {
    validation: fixture.prepared, policy: fixture.prepared,
    allocationRequest: fixture.fullRequest, c1: fixture.c1,
  });
  const adapted = await computeC2Diagnostics(config, {
    validation: fixture.prepared, policy: fixture.prepared,
    allocationRequest: fixture.fullRequest,
    c1ByAlpha: { [fixture.ids[1]]: { id: 804, ...fixture.c1 } },
    dependencyPlan: [{ alphaId: fixture.ids[1], status: "REUSED", c1ExperimentId: 804,
      fingerprint: "exact-spec-fingerprint", reason: null, childPolicyCount: 2 }],
  });
  assert.deepEqual(adapted.incrementalContribution.conditional, legacy.incrementalContribution.conditional.map(
    (row: any) => ({ ...row, c1ExperimentId: 804, c1DependencyStatus: "REUSED" })));
  assert.ok(adapted.incrementalContribution.conditional.every((row: any) =>
    row.c1ExperimentId === 804 && row.c1DependencyStatus === "REUSED"));
  assert.deepEqual(adapted.dependencySummary, [{ alphaId: fixture.ids[1], status: "REUSED",
    c1ExperimentId: 804, fingerprint: "exact-spec-fingerprint", reason: null, childPolicyCount: 2 }]);
});

test("R2: each selected alpha consumes its own dependency, including a newly-created source", async () => {
  const fixture = createB3Fixture();
  const forB = independentlyAlignedPair(fixture.prepared, fixture.fullRequest,
    fixture.withoutRequest, fixture.assumptions);
  const withoutARequest = { ...fixture.fullRequest, candidateIds: [fixture.ids[1]] };
  const forA = independentlyAlignedPair(fixture.prepared, fixture.fullRequest,
    withoutARequest, fixture.assumptions);
  const source = (id: number, excludedId: string, variantResult: B3Result) => ({
    id, manifest: { ...fixture.c1.manifest, plans: [
      fixture.c1.manifest.plans[0],
      { excludedCandidateIds: [excludedId], policyRequest: withoutARequest },
    ] },
    children: [{ excludedCandidateIds: [], result: forB.full },
      { excludedCandidateIds: [excludedId], result: variantResult }],
    summary: {},
  });
  const config = input({ allocationId: 17, validationPreparedInputId: 17, c1ExperimentId: null,
    alphaIds: [fixture.ids[1], fixture.ids[0]], startDate: fixture.assumptions.evaluationStartDate,
    endDate: fixture.assumptions.evaluationEndDate, contributionWindow: 65, contributionStep: 10,
    minSharpeObservations: 2 });
  const output = await computeC2Diagnostics(config, {
    validation: fixture.prepared, policy: fixture.prepared, allocationRequest: fixture.fullRequest,
    c1ByAlpha: {
      [fixture.ids[1]]: source(811, fixture.ids[1], forB.without),
      [fixture.ids[0]]: source(812, fixture.ids[0], forA.without),
    },
    dependencyPlan: [
      { alphaId: fixture.ids[1], status: "REUSED", c1ExperimentId: 811, fingerprint: "fp-b",
        reason: null, childPolicyCount: 2 },
      { alphaId: fixture.ids[0], status: "CREATED", c1ExperimentId: 812, fingerprint: "fp-a",
        reason: null, childPolicyCount: 2 },
    ],
  });
  for (const [alphaId, c1Id, status] of [[fixture.ids[1], 811, "REUSED"], [fixture.ids[0], 812, "CREATED"]] as const) {
    const conditional = output.incrementalContribution.conditional.filter((row: any) => row.alphaId === alphaId);
    const rolling = output.incrementalContribution.rolling.filter((row: any) => row.alphaId === alphaId);
    assert.ok(conditional.some((row: any) => row.status === "AVAILABLE"));
    assert.ok(conditional.every((row: any) => row.c1ExperimentId === c1Id && row.c1DependencyStatus === status));
    assert.ok(rolling.length > 0);
    assert.ok(rolling.every((row: any) => row.c1ExperimentId === c1Id && row.c1DependencyStatus === status));
  }
  assert.equal(output.dependencySummary.find((row: any) => row.alphaId === fixture.ids[0]).status, "CREATED");
  assert.equal(output.stability.alphas.length, 2);
  assert.equal(output.regimes.conditionalPerformance.length, 2);
});

test("R3: an unavailable exact-spec dependency does not fall back to legacy C1 evidence", async () => {
  const fixture = createB3Fixture();
  const aligned = independentlyAlignedPair(fixture.prepared, fixture.fullRequest,
    fixture.withoutRequest, fixture.assumptions);
  fixture.c1.children = [
    { excludedCandidateIds: [], result: aligned.full },
    { excludedCandidateIds: [fixture.ids[1]], result: aligned.without },
  ];
  const output = await computeC2Diagnostics(input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: 900, alphaIds: [fixture.ids[1]], startDate: fixture.assumptions.evaluationStartDate,
    endDate: fixture.assumptions.evaluationEndDate }), {
    validation: fixture.prepared, policy: fixture.prepared, allocationRequest: fixture.fullRequest,
    c1: { ...fixture.c1, id: 900 },
    dependencyPlan: [{ alphaId: fixture.ids[1], status: "UNAVAILABLE", c1ExperimentId: null,
      fingerprint: "requested-fingerprint", reason: "NOT_COMPATIBLE: frozen transaction costs differ.",
      childPolicyCount: 0 }],
  });
  assert.equal(output.incrementalContribution.conditional[0].status, "UNAVAILABLE");
  assert.equal(output.incrementalContribution.conditional[0].deltas, null);
  assert.equal(output.incrementalContribution.conditional[0].c1ExperimentId, null);
  assert.match(output.incrementalContribution.conditional[0].reason, /NOT_COMPATIBLE/);
  assert.equal(output.dependencySummary[0].status, "UNAVAILABLE");
  assert.equal(output.stability.alphas.length, 1);
  assert.equal(output.regimes.conditionalPerformance.length, 1);
});

test("R4: failed dependency evidence stays unavailable while independent diagnostics remain", async () => {
  const fixture = createB3Fixture();
  const failure = "C1 exclusion infeasible at 2021-04-12: candidate bounds cannot be satisfied.";
  const output = await computeC2Diagnostics(input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: null, alphaIds: [fixture.ids[1]] }), {
    validation: fixture.prepared, policy: fixture.prepared, allocationRequest: fixture.fullRequest,
    dependencyPlan: [{ alphaId: fixture.ids[1], status: "UNAVAILABLE", c1ExperimentId: 933,
      fingerprint: "failed-dependency-fingerprint", reason: failure, childPolicyCount: 2 }],
  });
  assert.equal(output.incrementalContribution.conditional.length > 0, true);
  assert.ok(output.incrementalContribution.conditional.every((row: any) =>
    row.status === "UNAVAILABLE" && row.deltas === null && row.reason === failure &&
    row.c1ExperimentId === 933 && row.c1DependencyStatus === "UNAVAILABLE"));
  assert.ok(output.incrementalContribution.rolling.some((row: any) =>
    row.status === "UNAVAILABLE" && row.reason === failure && row.c1ExperimentId === 933));
  assert.equal(output.stability.alphas.length, 1);
  assert.equal(output.regimes.conditionalPerformance.length, 1);
  assert.equal(output.dependencySummary[0].reason, failure);
});

test("partial evidence: frozen policy-to-validation mapping survives an unavailable C1 dependency", async () => {
  const fixture = createB3Fixture();
  const renamedCandidates = fixture.prepared.candidates.map((candidate, index) => ({
    ...candidate,
    candidateId: `validation-alpha-${index}`,
    canonicalFingerprint: `validation-alpha-${index}`,
  }));
  const renamedValidation = { ...fixture.prepared, candidates: renamedCandidates } as PreparedSnapshot;
  const policyId = fixture.ids[1];
  const validationId = "validation-alpha-1";
  const reason = "C1 exclusion failed at 2021-04-12: frozen policy is infeasible.";
  const output = await computeC2Diagnostics(input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: null, alphaIds: [policyId] }), {
    validation: renamedValidation, policy: fixture.prepared, allocationRequest: fixture.fullRequest,
    validationCandidateIds: { [policyId]: validationId },
    dependencyPlan: [{ alphaId: policyId, status: "UNAVAILABLE", c1ExperimentId: 944,
      fingerprint: "failed-exclusion-fingerprint", reason, childPolicyCount: 2 }],
  });
  assert.deepEqual(output.source.validationCandidateIds, { [policyId]: validationId });
  assert.deepEqual(output.source.b1AlphaIds, [validationId]);
  assert.equal(output.stability.alphas[0].alphaId, validationId);
  assert.equal(output.regimes.conditionalPerformance[0].alphaId, validationId);
  assert.ok(output.stability.alphas[0].rolling.length > 0);
  assert.equal(output.incrementalContribution.conditional[0].status, "UNAVAILABLE");
  assert.equal(output.incrementalContribution.conditional[0].deltas, null);
  assert.equal(output.incrementalContribution.conditional[0].reason, reason);
  assert.equal(output.dependencySummary[0].c1ExperimentId, 944);
  const inconsistentC1 = structuredClone(fixture.c1);
  inconsistentC1.manifest.validationCandidateIds[policyId] = "different-validation-id";
  await assert.rejects(computeC2Diagnostics(input({ allocationId: 17, validationPreparedInputId: 17,
    c1ExperimentId: null, alphaIds: [policyId] }), {
    validation: renamedValidation, policy: fixture.prepared, allocationRequest: fixture.fullRequest,
    validationCandidateIds: { [policyId]: validationId },
    c1ByAlpha: { [policyId]: { id: 945, ...inconsistentC1 } },
    dependencyPlan: [{ alphaId: policyId, status: "REUSED", c1ExperimentId: 945,
      fingerprint: "inconsistent-map", reason: null, childPolicyCount: 2 }],
  }), /does not match its referenced C1 manifest/);
});