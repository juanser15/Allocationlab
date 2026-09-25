import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationRequest } from "./allocation-b2";
import {
  C1_ESTIMATION_ALIGNMENT_RULE,
  runB3Validation,
  type B3Assumptions,
  type B3EstimationDatePlan,
  type B3Result,
} from "./b3-policy";
import { planC1Policies, summarizeC1Experiment } from "./c1-contribution";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import type { FactorDefinition } from "./factor-library";

const tickers = ["A", "B", "C"];
const day = (index: number) => new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);

function csvFor(length = 180, missing?: { ticker: string; index: number }): string {
  return ["date,A,B,C", ...Array.from({ length }, (_, index) => {
    const prices = tickers.map((ticker, asset) => ticker === missing?.ticker && index === missing.index
      ? "" : (100 + (index + 1) * (asset + 1) * 0.17 + Math.sin(index * (asset + 1)) * 2).toFixed(8));
    return `${day(index)},${prices.join(",")}`;
  })].join("\n");
}

const factor: FactorDefinition = {
  id: "c1_momentum", name: "C1 deterministic momentum", description: "C1 fixture", family: "Test",
  enabled: true, status: "active", inputSeries: "adjusted close", calculationType: "momentum",
  formula: "P(t-lag)/P(t-lag-lookback)-1", direction: "higher_is_better", lookback: 5, lag: 0,
  normalization: "percentile_rank", winsorizationLower: 0, winsorizationUpper: 1,
  missingDataTreatment: "exclude", baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "synthetic C1 test data",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "c1-test-v1",
};

function snapshot(source = csvFor()): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams", assetTickers: tickers, factorIds: [],
      alphaDefinitions: tickers.map((ticker, index) => ({
        name: `candidate-${ticker}`, factorId: factor.id, assetTickers: [ticker],
        mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
        threshold: -100, grossFraction: [0.45, 0.7, 1][index],
        rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
        transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
      })),
    },
    csvContent: source, factorVersion: factor.version, factors: [factor], datasetId: 91,
  });
}

function request(prepared: PreparedSnapshot, overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    preparedInputId: 91, candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: day(89), decisionTimestamp: day(90), estimationWindow: 45, minObservations: 25,
    representation: "alpha_streams", returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0.1, covarianceDiagonalShrinkage: 0.05, dailyCashYield: 0.0001,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 1 }, groupCaps: [{
      name: "first two", candidateIds: prepared.candidates.slice(0, 2).map((candidate) => candidate.candidateId),
      max: 1,
    }] },
    ...overrides,
  };
}

function assumptions(start = 55, end = 150, overrides: Partial<B3Assumptions> = {}): B3Assumptions {
  return {
    evaluationStartDate: day(start), evaluationEndDate: day(end), decisionCalendar: "monthly",
    executionTiming: "next_close", initialNav: 100, initialHoldings: {}, initialCash: 100,
    transactionCostBps: 2, slippageBps: 1, dailyCashYield: 0.0001,
    ...overrides,
  };
}

function execute(prepared: PreparedSnapshot, policy: AllocationRequest, assumptionsValue = assumptions()): B3Result {
  return runB3Validation(prepared, policy, prepared, assumptionsValue);
}

function alignmentPlan(reference: B3Result, candidateIds: string[]): B3EstimationDatePlan {
  const decisions = new Map(reference.decisions.map((decision) => [decision.decisionDate, decision]));
  let blocked = false;
  return {
    rule: C1_ESTIMATION_ALIGNMENT_RULE,
    referenceCandidateIds: candidateIds,
    decisions: reference.decisionCalendar.map(({ decisionDate }) => {
      const decision = decisions.get(decisionDate);
      if (decision && !blocked) return {
        decisionDate, informationCutoff: decision.informationCutoff,
        estimationDates: decision.estimationDates, observationCount: decision.estimationDates.length,
      };
      blocked = true;
      return {
        decisionDate,
        informationCutoff: new Date(Date.parse(`${decisionDate}T00:00:00Z`) - 86_400_000)
          .toISOString().slice(0, 10),
        estimationDates: [], observationCount: 0,
        failureReason: reference.reason ?? `Full-baseline reference failed at ${reference.failureDate ?? decisionDate}.`,
      };
    }),
  };
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function unequalWarmupSnapshot(): PreparedSnapshot {
  const slowFactor: FactorDefinition = { ...factor, id: "c1_slow_momentum", lookback: 90 };
  const definitions = [
    { name: "fast alpha", factorId: factor.id, assetTickers: ["A"] },
    { name: "slow alpha", factorId: slowFactor.id, assetTickers: ["B"] },
  ].map((item, index) => ({
    ...item, mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
    threshold: -100, grossFraction: index === 0 ? 0.6 : 0.7,
    rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
    transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
  }));
  return prepareSnapshot({
    request: { representation: "alpha_streams", assetTickers: ["A", "B"], factorIds: [],
      alphaDefinitions: definitions },
    csvContent: csvFor(), factorVersion: factor.version, factors: [factor, slowFactor], datasetId: 91,
  });
}

test("C1 T2 pre-change evidence: unequal alpha warmups alter shared estimation inputs", () => {
  const prepared = unequalWarmupSnapshot();
  const base = request(prepared, { candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    estimationWindow: 45, minObservations: 25 });
  const period = assumptions(120, 160);
  const full = execute(prepared, base, period);
  const reducedRequest = {
    ...base, candidateIds: [base.candidateIds[0]], constraints: {},
  };
  const reduced = execute(prepared, reducedRequest, period);
  assert.equal(full.status, "completed", full.reason);
  assert.equal(reduced.status, "completed", reduced.reason);
  assert.deepEqual(full.decisions.map((item) => item.decisionDate), reduced.decisions.map((item) => item.decisionDate));
  const fullFirst = full.decisions[0].optimizer.model!;
  const reducedFirst = reduced.decisions[0].optimizer.model!;
  const sharedFullIndex = fullFirst.candidateIds.indexOf(base.candidateIds[0]);
  const fullReturns = fullFirst.grossReturns[sharedFullIndex];
  const reducedReturns = reducedFirst.grossReturns[0];
  const returnDifference = fullReturns.length === reducedReturns.length &&
    fullReturns.every((value, index) => value === reducedReturns[index])
    ? 0 : Math.max(...fullReturns.slice(-Math.min(fullReturns.length, reducedReturns.length))
      .map((value, index) => Math.abs(value - reducedReturns[reducedReturns.length - Math.min(fullReturns.length, reducedReturns.length) + index])));
  const sharedDate = fullFirst.dates[0];
  const fullSharedReturn = fullReturns[0];
  const reducedSharedReturn = reducedReturns[reducedFirst.dates.indexOf(sharedDate)];
  console.log("C1 T2 pre-change unequal-warmup evidence", JSON.stringify({
    decisionDate: fullFirst.decisionTimestamp,
    fullDates: [fullFirst.dates[0], fullFirst.dates.at(-1)], fullCount: fullFirst.observationCount,
    reducedDates: [reducedFirst.dates[0], reducedFirst.dates.at(-1)], reducedCount: reducedFirst.observationCount,
    sharedCandidate: base.candidateIds[0],
    sharedFirstReturn: { full: fullReturns[0], reduced: reducedReturns[0] },
    firstSameDateReturn: { date: sharedDate, full: fullSharedReturn, reduced: reducedSharedReturn,
      absoluteDifference: Math.abs(fullSharedReturn - reducedSharedReturn) },
    sharedMean: { full: fullFirst.sampleMeans[sharedFullIndex], reduced: reducedFirst.sampleMeans[0] },
    sharedMu: { full: fullFirst.mu[sharedFullIndex], reduced: reducedFirst.mu[0] },
    sharedVariance: { full: fullFirst.sigma[sharedFullIndex][sharedFullIndex], reduced: reducedFirst.sigma[0][0] },
    commonTailMaxReturnDifference: returnDifference,
  }));
  assert.ok(reducedFirst.observationCount > fullFirst.observationCount,
    "Pre-change reduced policy should expose its longer natural estimation history.");
  assert.notEqual(fullFirst.sampleMeans[sharedFullIndex], reducedFirst.sampleMeans[0]);
  assert.notEqual(fullFirst.sigma[sharedFullIndex][sharedFullIndex], reducedFirst.sigma[0][0]);
});

test("C1 R1 aligns unequal alpha warmups on the full-baseline rows and inputs", () => {
  const prepared = unequalWarmupSnapshot();
  const base = request(prepared, { candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
    estimationWindow: 45, minObservations: 25 });
  const period = assumptions(120, 160);
  const reducedRequest = { ...base, candidateIds: [base.candidateIds[0]], constraints: {} };
  const reference = execute(prepared, base, period);
  assert.equal(reference.status, "completed", reference.reason);
  const plan = alignmentPlan(reference, base.candidateIds);
  const alignedFull = runB3Validation(prepared, base, prepared, period, plan);
  const alignedReduced = runB3Validation(prepared, reducedRequest, prepared, period, plan);
  assert.equal(alignedFull.status, "completed", alignedFull.reason);
  assert.equal(alignedReduced.status, "completed", alignedReduced.reason);
  assert.deepEqual(alignedFull.decisions.map((decision) => decision.decisionDate),
    alignedReduced.decisions.map((decision) => decision.decisionDate));
  for (const [index, fullDecision] of alignedFull.decisions.entries()) {
    const reducedDecision = alignedReduced.decisions[index];
    const fullModel = fullDecision.optimizer.model!;
    const reducedModel = reducedDecision.optimizer.model!;
    assert.deepEqual(fullDecision.estimationDates, plan.decisions[index].estimationDates);
    assert.deepEqual(reducedDecision.estimationDates, plan.decisions[index].estimationDates);
    assert.equal(fullModel.observationCount, reducedModel.observationCount);
    const fullCandidateIndex = fullModel.candidateIds.indexOf(base.candidateIds[0]);
    assert.deepEqual(fullModel.grossReturns[fullCandidateIndex], reducedModel.grossReturns[0]);
    assert.deepEqual(fullModel.netReturns[fullCandidateIndex], reducedModel.netReturns[0]);
    assert.deepEqual(fullModel.costs.total[fullCandidateIndex], reducedModel.costs.total[0]);
    close(fullModel.sampleMeans[fullCandidateIndex], reducedModel.sampleMeans[0], 0);
    close(fullModel.mu[fullCandidateIndex], reducedModel.mu[0], 0);
    close(fullModel.sigma[fullCandidateIndex][fullCandidateIndex], reducedModel.sigma[0][0], 0);
  }
  const fullFirstModel = alignedFull.decisions[0].optimizer.model!;
  const reducedFirstModel = alignedReduced.decisions[0].optimizer.model!;
  const alignedReturnDiff = Math.max(...fullFirstModel.grossReturns[0].map((value, row) =>
    Math.abs(value - reducedFirstModel.grossReturns[0][row])));
  console.log("C1 R1 aligned sample", JSON.stringify({
    decisionDate: alignedFull.decisions[0].decisionDate,
    estimationDates: fullFirstModel.dates,
    observationCount: fullFirstModel.observationCount,
    sharedCandidate: base.candidateIds[0],
    sharedReturn: fullFirstModel.grossReturns[0][0],
    maxSharedReturnDifference: alignedReturnDiff,
    muDifference: Math.abs(fullFirstModel.mu[0] - reducedFirstModel.mu[0]),
    retainedCovarianceDifference: Math.abs(fullFirstModel.sigma[0][0] - reducedFirstModel.sigma[0][0]),
  }));
  assert.deepEqual(alignedFull.decisions[0].estimationDates,
    alignedReduced.decisions[0].estimationDates);
  assert.equal(alignedFull.decisions[0].optimizer.model!.observationCount, 30);
});

test("C1 R2 blocks insufficient full-baseline history and preserves cutoff isolation", () => {
  const insufficientPrepared = unequalWarmupSnapshot();
  const slowFactor: FactorDefinition = { ...factor, id: "c1_slow_momentum", lookback: 110 };
  const insufficientSnapshot = prepareSnapshot({
    request: insufficientPrepared.request,
    csvContent: csvFor(),
    factorVersion: factor.version,
    factors: [factor, slowFactor],
    datasetId: 91,
  });
  const base = request(insufficientSnapshot, { candidateIds: insufficientSnapshot.candidates.map((candidate) => candidate.candidateId),
    estimationWindow: 45, minObservations: 25 });
  const period = assumptions(120, 160);
  const reference = execute(insufficientSnapshot, base, period);
  assert.equal(reference.status, "failed");
  assert.equal(reference.failureDate, day(120));
  assert.match(reference.reason ?? "", /complete common observations|alignment/i);
  const plan = alignmentPlan(reference, base.candidateIds);
  assert.equal(plan.decisions[0].decisionDate, reference.decisionCalendar[0].decisionDate);
  assert.equal(plan.decisions[0].observationCount, 0);
  assert.match(plan.decisions[0].failureReason ?? "", /observations|failed/i);
  const reduced = runB3Validation(insufficientSnapshot,
    { ...base, candidateIds: [base.candidateIds[0]], constraints: {} }, insufficientSnapshot, period, plan);
  assert.equal(reduced.status, "failed");
  assert.ok(plan.decisions.some((item) => item.decisionDate === reduced.failureDate && item.failureReason));
  assert.match(reduced.reason ?? "", /Full-baseline C1 estimation alignment failed/);
  assert.equal(reduced.assumptions.evaluationStartDate, period.evaluationStartDate);
  assert.equal(reduced.assumptions.evaluationEndDate, period.evaluationEndDate);

  const sufficient = unequalWarmupSnapshot();
  const sufficientRequest = request(sufficient, { candidateIds: sufficient.candidates.map((candidate) => candidate.candidateId),
    estimationWindow: 45, minObservations: 25 });
  const sufficientReference = execute(sufficient, sufficientRequest, period);
  assert.equal(sufficientReference.status, "completed", sufficientReference.reason);
  const stablePlan = alignmentPlan(sufficientReference, sufficientRequest.candidateIds);
  const futureChangedCsv = csvFor().split("\n").map((line, index) => index < 122
    ? line : `${line.split(",")[0]},${Number(line.split(",")[1]) * 1.4},${line.split(",")[2]},${line.split(",")[3]}`).join("\n");
  const futureChanged = prepareSnapshot({
    request: sufficient.request, csvContent: futureChangedCsv, factorVersion: factor.version,
    factors: [factor, { ...factor, id: "c1_slow_momentum", lookback: 90 }], datasetId: 91,
  });
  const before = runB3Validation(sufficient, sufficientRequest, sufficient, period, stablePlan);
  const after = runB3Validation(sufficient, sufficientRequest, futureChanged, period, stablePlan);
  assert.equal(before.status, "completed", before.reason);
  assert.equal(after.status, "completed", after.reason);
  const economics = (decision: B3Result["decisions"][number]) => ({
    decisionDate: decision.decisionDate,
    informationCutoff: decision.informationCutoff,
    estimationDates: decision.estimationDates,
    candidateTargetAssetExposures: decision.candidateTargetAssetExposures,
    grossReturns: decision.optimizer.model!.grossReturns,
    mu: decision.optimizer.model!.mu,
    sigma: decision.optimizer.model!.sigma,
    H: decision.optimizer.model!.H,
    d: decision.optimizer.model!.d,
    candidateWeights: sufficientRequest.candidateIds.map((id) => decision.candidateWeights[id]),
    masterCash: decision.masterCash,
    totalCash: decision.totalCash,
    targetAssetWeights: decision.targetAssetWeights,
  });
  assert.deepEqual(economics(before.decisions[0]), economics(after.decisions[0]));
});

test("C1 T1 independently reoptimizes exclusions through B3", () => {
  const prepared = snapshot();
  const baselineRequest = request(prepared);
  const plans = planC1Policies(prepared, baselineRequest, assumptions(), {
    mode: "single", exclusionSets: [[baselineRequest.candidateIds[0]]],
  });
  const plannedFull = execute(prepared, plans[0].policyRequest);
  const independentFull = execute(prepared, baselineRequest);
  const plannedReduced = execute(prepared, plans[1].policyRequest);
  const independentReduced = execute(prepared, {
    ...baselineRequest, candidateIds: baselineRequest.candidateIds.slice(1),
    constraints: { ...baselineRequest.constraints, groupCaps: [{
      name: "first two", candidateIds: [baselineRequest.candidateIds[1]], max: 0.85,
    }] },
  });
  for (const [actual, expected] of [[plannedFull, independentFull], [plannedReduced, independentReduced]] as const) {
    assert.equal(actual.status, "completed", actual.reason);
    assert.equal(expected.status, "completed", expected.reason);
    assert.deepEqual(actual.decisions.map((item) => item.estimationDates), expected.decisions.map((item) => item.estimationDates));
    actual.decisions.forEach((decision, index) => {
      close(decision.masterCash, expected.decisions[index].masterCash);
      for (const id of expected.policyIdentity.candidateIds)
        close(decision.candidateWeights[id], expected.decisions[index].candidateWeights[id]);
    });
  }
  assert.notDeepEqual(plannedFull.decisions[0].candidateWeights, plannedReduced.decisions[0].candidateWeights);
  const retainedIds = baselineRequest.candidateIds.slice(1);
  const retainedBaselineSum = retainedIds.reduce((sum, id) =>
    sum + plannedFull.decisions[0].candidateWeights[id], 0);
  assert.ok(retainedIds.some((id) => Math.abs(plannedReduced.decisions[0].candidateWeights[id] -
    plannedFull.decisions[0].candidateWeights[id] / retainedBaselineSum) > 1e-8),
  "Reduced policy must not be a normalized rescaling of saved baseline weights.");
  assert.equal(plans[1].policyRequest.objective.type, baselineRequest.objective.type);
  assert.equal(plans[1].policyRequest.estimationWindow, baselineRequest.estimationWindow);
});

test("C1 T2 preserves frozen alpha peers, shared histories, and the reduced group cap", () => {
  const prepared = snapshot();
  const original = request(prepared);
  const excluded = original.candidateIds[0];
  const peerUniverses = Object.fromEntries(prepared.candidates.map((candidate) =>
    [candidate.candidateId, structuredClone(candidate.lineage.peerUniverse)]));
  const plan = planC1Policies(prepared, original, assumptions(), {
    mode: "single", exclusionSets: [[excluded]],
  })[1];
  assert.equal(plan.policyRequest.constraints.groupCaps?.[0].name, "first two");
  assert.deepEqual(plan.policyRequest.constraints.groupCaps?.[0].candidateIds, [original.candidateIds[1]]);
  for (const id of plan.policyRequest.candidateIds) {
    const frozenCandidate = prepared.candidates.find((candidate) => candidate.candidateId === id)!;
    assert.deepEqual(frozenCandidate.lineage.peerUniverse, peerUniverses[id]);
  }
  const full = execute(prepared, original);
  const variant = execute(prepared, plan.policyRequest);
  assert.equal(full.status, "completed", full.reason);
  assert.equal(variant.status, "completed", variant.reason);
  assert.deepEqual(full.decisions.map((item) => item.estimationDates), variant.decisions.map((item) => item.estimationDates));
  assert.deepEqual(full.dailyLedger.map((item) => item.date), variant.dailyLedger.map((item) => item.date));
});

test("C1 T3 reconciles ledger metrics, full-minus-variant deltas, and both allocation distances", () => {
  const prepared = snapshot();
  const baseline = request(prepared);
  const plans = planC1Policies(prepared, baseline, assumptions(), {
    mode: "single", exclusionSets: [[baseline.candidateIds[2]]],
  });
  const results = plans.map((plan) => execute(prepared, plan.policyRequest));
  const summary = summarizeC1Experiment(plans.map((plan, index) => ({
    label: plan.label, excludedCandidateIds: plan.excludedCandidateIds, result: results[index],
  })), baseline.candidateIds);
  assert.equal(summary.variants[0].comparisonAvailable, true);
  const [full, variant] = results;
  const fullReturn = full.dailyLedger.at(-1)!.endingNav / full.assumptions.initialNav - 1;
  const variantReturn = variant.dailyLedger.at(-1)!.endingNav / variant.assumptions.initialNav - 1;
  close(summary.baseline.metrics.cumulativeReturn.value!, fullReturn);
  close(summary.variants[0].metrics.cumulativeReturn.value!, variantReturn);
  close(summary.variants[0].deltaFullMinusVariant.cumulativeReturn.value!, fullReturn - variantReturn);
  const expectedCash = full.dailyLedger.reduce((sum, entry) => sum + entry.endingCash / entry.endingNav, 0) /
    full.dailyLedger.length;
  close(summary.baseline.metrics.averageCashExposure.value!, expectedCash);
  assert.equal(summary.baseline.turnoverConvention, full.metrics!.turnoverConvention);
  const a = full.decisions[0], b = variant.decisions[0];
  const alpha = 0.5 * (baseline.candidateIds.reduce((sum, id) =>
    sum + Math.abs((a.candidateWeights[id] ?? 0) - (b.candidateWeights[id] ?? 0)), 0) +
    Math.abs(a.masterCash - b.masterCash));
  close(summary.variants[0].alphaCapitalDistance.dateSeries[0].distance, alpha);
  assert.ok(summary.variants[0].finalAssetAndCashDistance.dateSeries.length > 0);
  const alphaDistances = summary.variants[0].alphaCapitalDistance.dateSeries.map((item) => item.distance);
  close(summary.variants[0].alphaCapitalDistance.mean!,
    alphaDistances.reduce((sum, value) => sum + value, 0) / alphaDistances.length);
  close(summary.variants[0].alphaCapitalDistance.maximum!, Math.max(...alphaDistances));
  assert.equal(summary.deltaConvention, "Full set minus exclusion variant.");

  const allCash = execute(prepared, {
    ...baseline, constraints: { totalCash: { min: 1, max: 1 } },
  }, assumptions(55, 90, { dailyCashYield: 0 }));
  assert.equal(allCash.status, "completed", allCash.reason);
  const cashSummary = summarizeC1Experiment([{ label: "cash", excludedCandidateIds: [], result: allCash }],
    baseline.candidateIds);
  assert.equal(cashSummary.baseline.metrics.sharpe.value, null);
  assert.match(cashSummary.baseline.metrics.sharpe.reason ?? "", /zero/);
});

test("C1 T4 pair mode executes the selected four policies without assuming additive effects", () => {
  const prepared = snapshot();
  const base = request(prepared);
  const plans = planC1Policies(prepared, base, assumptions(), {
    mode: "pair", exclusionSets: [[base.candidateIds[0], base.candidateIds[1]]],
  });
  assert.equal(plans.length, 4);
  const pair = [base.candidateIds[0], base.candidateIds[1]].sort();
  assert.deepEqual(plans.slice(1).map((plan) => plan.excludedCandidateIds), [
    [pair[0]], [pair[1]], pair,
  ]);
  const results = plans.map((plan) => execute(prepared, plan.policyRequest));
  assert.ok(results.every((result) => result.status === "completed"));
  const summary = summarizeC1Experiment(plans.map((plan, index) => ({
    label: plan.label, excludedCandidateIds: plan.excludedCandidateIds, result: results[index],
  })), base.candidateIds);
  assert.equal(summary.variants.length, 3);
  for (const plan of plans) {
    const independent = execute(prepared, plan.policyRequest);
    assert.equal(independent.status, "completed", independent.reason);
    assert.deepEqual(independent.decisions.map((item) => item.targetAssetWeights),
      results[plans.indexOf(plan)].decisions.map((item) => item.targetAssetWeights));
  }
});

test("C1 T5 retains weak/correlated candidates and aliases cannot create duplicate policies", () => {
  const prepared = snapshot();
  const base = request(prepared);
  const alias = { ...prepared.candidates[0], candidateId: "alias-for-first", diagnostics: { ...prepared.candidates[0].diagnostics } };
  const withAlias = { ...prepared, candidates: [...prepared.candidates, alias] };
  const plans = planC1Policies(withAlias, base, assumptions(), {
    mode: "single", exclusionSets: [["alias-for-first"], [base.candidateIds[0]]],
  });
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[1].excludedCandidateIds, [base.candidateIds[0]]);
  assert.deepEqual(plans[0].policyRequest.candidateIds, base.candidateIds);
  assert.throws(() => planC1Policies(withAlias, base, assumptions(), {
    mode: "single", exclusionSets: [[base.candidateIds[0]], [base.candidateIds[1]], [base.candidateIds[2]],
      [base.candidateIds[0], base.candidateIds[1]]],
  }), /Single mode/);
  assert.equal(new Set(prepared.candidates.map((candidate) => candidate.candidateId)).size, 3);
});

test("C1 T6 preserves positive-bound infeasibility and dated held-price failures", () => {
  const prepared = snapshot();
  const base = request(prepared, { constraints: { candidateBounds: { [prepared.candidates[0].candidateId]: { min: 0.2 } } } });
  const plans = planC1Policies(prepared, base, assumptions(), {
    mode: "single", exclusionSets: [[prepared.candidates[0].candidateId]],
  });
  assert.equal(plans[1].policyRequest.constraints.candidateBounds?.[prepared.candidates[0].candidateId].min, 0.2);
  const infeasible = execute(prepared, plans[1].policyRequest);
  assert.equal(infeasible.status, "failed");
  assert.match(infeasible.reason ?? "", /B2 INFEASIBLE/);
  assert.ok(infeasible.failureDate);
  assert.deepEqual(infeasible.dailyLedger, []);

  const missing = snapshot(csvFor(180, { ticker: "A", index: 115 }));
  const missingBase = request(missing, {
    candidateIds: [missing.candidates[0].candidateId],
    constraints: { totalCash: { min: 0, max: 0 } },
  });
  assert.throws(() => planC1Policies(missing, missingBase, assumptions(), {
    mode: "single", exclusionSets: [[missingBase.candidateIds[0]]],
  }), /all baseline/);
  const failed = execute(missing, missingBase);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureDate, day(115));
  assert.deepEqual(failed.dailyLedger, []);
  const comparison = summarizeC1Experiment([{ label: "missing", excludedCandidateIds: [], result: failed }], missingBase.candidateIds);
  assert.equal(comparison.baseline.comparisonAvailable, false);
  assert.match(comparison.baseline.comparisonReason ?? "", /B2 INVALID_INPUT/);
});

test("C1 T7 enforces holdout boundaries, ignores post-development observations, and caps distinct policies", () => {
  const prepared = snapshot();
  const base = request(prepared);
  assert.throws(() => planC1Policies(prepared, base, assumptions(55, 150), {
    mode: "single", exclusionSets: [[base.candidateIds[0]]], holdoutStartDate: day(150),
  }), /before the reserved holdout/);
  const plans = planC1Policies(prepared, base, assumptions(55, 100), {
    mode: "single", exclusionSets: base.candidateIds.map((id) => [id]),
    holdoutStartDate: day(120),
  });
  assert.equal(plans.length, 4);
  const changedSource = csvFor().split("\n").map((line, index) => {
    if (index <= 102) return line;
    const columns = line.split(",");
    columns[1] = (Number(columns[1]) * 1.5).toFixed(8);
    return columns.join(",");
  }).join("\n");
  const changed = snapshot(changedSource);
  const originalResult = runB3Validation(prepared, base, prepared, assumptions(55, 100));
  const futureChanged = runB3Validation(prepared, base, changed, assumptions(55, 100));
  assert.equal(originalResult.status, "completed", originalResult.reason);
  assert.equal(futureChanged.status, "completed", futureChanged.reason);
  assert.deepEqual(originalResult.dailyLedger, futureChanged.dailyLedger);
  const expanded = {
    ...prepared,
    candidates: [...prepared.candidates, ...Array.from({ length: 4 }, (_, index) => ({
      ...prepared.candidates[0],
      candidateId: `canonical-extra-${index}`, canonicalFingerprint: `canonical-extra-${index}`,
      diagnostics: { ...prepared.candidates[0].diagnostics },
    }))],
  };
  const expandedIds = [...base.candidateIds, ...Array.from({ length: 4 }, (_, index) => `canonical-extra-${index}`)];
  assert.throws(() => planC1Policies(expanded, { ...base, candidateIds: expandedIds }, assumptions(55, 100), {
    mode: "single", exclusionSets: expandedIds.slice(0, 6).map((id) => [id]),
  }), /at most six distinct policies/);
});