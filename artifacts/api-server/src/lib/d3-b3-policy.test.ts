import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationRequest } from "./allocation-b2";
import { runB3Validation, type B3Assumptions } from "./b3-policy";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";

const tickers = ["A", "B"];

function dateAt(index: number): string {
  return new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);
}

function csvFor(mutateAfter?: { index: number; multiplier: number }): string {
  return ["date,A,B", ...Array.from({ length: 180 }, (_, index) => {
    const prices = tickers.map((_, asset) => {
      let price = 100 + (index + 1) * (asset + 1) * 0.13 +
        Math.sin(index * (asset + 1) * 0.31) * (asset + 1) * 2;
      if (mutateAfter && index > mutateAfter.index) price *= mutateAfter.multiplier;
      return price.toFixed(8);
    });
    return `${dateAt(index)},${prices.join(",")}`;
  })].join("\n");
}

function snapshot(source = csvFor()): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "asset_returns",
      assetTickers: tickers,
      factorIds: [],
      alphaDefinitions: [],
    },
    csvContent: source,
    factorVersion: "d3-b3-test-v1",
    factors: [],
    datasetId: 91,
  });
}

function assumptions(): B3Assumptions {
  return {
    evaluationStartDate: dateAt(40),
    evaluationEndDate: dateAt(150),
    decisionCalendar: "monthly",
    executionTiming: "next_close",
    initialNav: 100,
    initialHoldings: {},
    initialCash: 100,
    transactionCostBps: 0,
    slippageBps: 0,
    dailyCashYield: 0,
  };
}

function request(source: PreparedSnapshot, forecastModel?: AllocationRequest["forecastModel"]): AllocationRequest {
  return {
    preparedInputId: 91,
    candidateIds: source.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(90),
    decisionTimestamp: dateAt(91),
    estimationWindow: 35,
    minObservations: 20,
    representation: "asset_returns",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.001 },
    constraints: { totalCash: { max: 0.2 } },
    ...(forecastModel ? { forecastModel } : {}),
  };
}

function view(
  candidateId: string,
  q: number,
  effectiveTimestamp: string,
  availabilityTimestamp: string,
) {
  return {
    type: "ABSOLUTE" as const,
    candidateId,
    q,
    variance: 0.000001,
    effectiveTimestamp,
    availabilityTimestamp,
  };
}

function bayesianModel(
  candidateIds: string[],
  availableFrom: string,
  futureAvailableFrom: string,
  futureQ: number,
) {
  return {
    type: "BAYESIAN_VIEWS" as const,
    priorMean: {
      source: "USER_DEFINED_PRIOR" as const,
      values: Object.fromEntries(candidateIds.map((id, index) => [id, 0.0001 * (index + 1)])),
    },
    priorUncertainty: {
      type: "USER_DEFINED" as const,
      candidateIds: [...candidateIds],
      matrix: [[0.00002, 0.000003], [0.000003, 0.00003]],
    },
    views: [
      view(candidateIds[0], 0.0008, availableFrom, availableFrom),
      view(candidateIds[1], futureQ, futureAvailableFrom, futureAvailableFrom),
    ],
  };
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by > ${tolerance}`);
}

test("D3 B3 T7 filters dated views, remaps frozen IDs, and carries holdings until a view is available", () => {
  const policySnapshot = snapshot();
  const initialRequest = request(policySnapshot);
  const calendarRun = runB3Validation(policySnapshot, initialRequest, policySnapshot, assumptions());
  assert.ok(calendarRun.decisionCalendar.length >= 3);
  const firstDecisionDate = calendarRun.decisionCalendar[0].decisionDate;
  const secondDecisionDate = calendarRun.decisionCalendar[1].decisionDate;
  const firstIndex = Number((Date.parse(`${firstDecisionDate}T00:00:00Z`) -
    Date.parse(`${dateAt(0)}T00:00:00Z`)) / 86_400_000);
  const secondIndex = Number((Date.parse(`${secondDecisionDate}T00:00:00Z`) -
    Date.parse(`${dateAt(0)}T00:00:00Z`)) / 86_400_000);
  const firstInformationCutoff = dateAt(firstIndex - 1);
  const secondInformationCutoff = dateAt(secondIndex - 1);
  const thirdDate = calendarRun.decisionCalendar[2].decisionDate;
  const thirdIndex = Number((Date.parse(`${thirdDate}T00:00:00Z`) -
    Date.parse(`${dateAt(0)}T00:00:00Z`)) / 86_400_000);
  const futureViewAvailability = dateAt(thirdIndex - 1);
  assert.ok(firstInformationCutoff < secondInformationCutoff);
  assert.ok(secondInformationCutoff < futureViewAvailability);
  const ids = policySnapshot.candidates.map((candidate) => candidate.candidateId);
  const basePolicy = request(policySnapshot,
    bayesianModel(ids, secondInformationCutoff, futureViewAvailability, 0.001));

  const clean = runB3Validation(policySnapshot, basePolicy, policySnapshot, assumptions());
  const changed = runB3Validation(
    policySnapshot,
    request(policySnapshot, bayesianModel(ids, secondInformationCutoff, futureViewAvailability, -0.002)),
    snapshot(csvFor({ index: secondIndex, multiplier: 1.8 })),
    assumptions(),
  );

  // The early dated decision is represented, but is explicitly unavailable and
  // leaves A1's current holdings untouched rather than optimizing its prior.
  assert.equal(clean.status, "failed");
  assert.match(clean.reason ?? "", /HISTORICAL_FORECAST_UNAVAILABLE/);
  assert.equal(clean.decisions.length, clean.decisionCalendar.length);
  const first = clean.decisions[0];
  assert.equal(first.forecastStatus, "UNAVAILABLE_HISTORICAL_VIEWS");
  assert.equal(first.optimizer.status, "UNAVAILABLE_HISTORICAL_VIEWS");
  assert.equal(first.forecast?.status, "HISTORICAL_FORECAST_UNAVAILABLE");
  assert.equal(first.forecast?.views.length, 2);
  assert.ok(first.forecast?.views.every((item) => item.status === "NOT_EFFECTIVE_OR_AVAILABLE"));
  assert.deepEqual(first.forecast?.P, []);
  assert.deepEqual(first.forecast?.q, []);
  assert.deepEqual(first.forecast?.Omega, []);
  assert.deepEqual(first.targetAssetWeights, {});
  assert.deepEqual(first.candidateWeights, {});
  assert.ok(clean.dailyLedger.length > 0);
  assert.ok(clean.decisions.slice(1).some((decision) => decision.optimizer.status === "SOLVED"),
    "later decisions must continue and solve after their views become available");

  const afterAvailability = clean.decisions[1];
  assert.equal(afterAvailability.forecastStatus, "AVAILABLE");
  assert.equal(afterAvailability.forecast?.status, "OK");
  assert.equal(afterAvailability.forecast?.views.length, 2);
  assert.equal(afterAvailability.forecast?.views[0].status, "ELIGIBLE");
  assert.equal(afterAvailability.forecast?.views[1].status, "NOT_EFFECTIVE_OR_AVAILABLE");
  assert.equal(afterAvailability.forecast?.P.length, 1);
  assert.equal(afterAvailability.forecast?.q.length, 1);
  assert.equal(afterAvailability.forecast?.Omega.length, 1);
  assert.equal(afterAvailability.forecast?.views[0].candidateId, afterAvailability.pointInTimeCandidateIds[0]);
  assert.deepEqual(afterAvailability.forecast?.candidateIds, afterAvailability.pointInTimeCandidateIds);
  assert.deepEqual(afterAvailability.forecast?.priorMean, [0.0001, 0.0002]);
  assert.deepEqual(afterAvailability.forecast?.priorUncertainty, [
    [0.00002, 0.000003],
    [0.000003, 0.00003],
  ]);
  assert.deepEqual(afterAvailability.forecast?.dates, afterAvailability.estimationDates);
  assert.ok(afterAvailability.forecast?.sigma.every((row) => row.every(Number.isFinite)));

  // Mutations occur strictly after the second cutoff and affect only a future
  // view. Neither can leak into either preceding decision's forecast or weights.
  const stable = (decision: (typeof clean.decisions)[number]) => ({
    forecastStatus: decision.forecastStatus,
    forecast: decision.forecast && {
      status: decision.forecast.status,
      dates: decision.forecast.dates,
      observationCount: decision.forecast.observationCount,
      sigma: decision.forecast.sigma,
      sampleMeans: decision.forecast.sampleMeans,
      muHat: decision.forecast.muHat,
      V_mu: decision.forecast.V_mu,
      priorMean: decision.forecast.priorMean,
      priorUncertainty: decision.forecast.priorUncertainty,
      P: decision.forecast.P,
      q: decision.forecast.q,
      Omega: decision.forecast.Omega,
    },
    candidateWeights: decision.candidateWeights,
    targetAssetWeights: decision.targetAssetWeights,
    optimizerStatus: decision.optimizer.status,
  });
  for (let index = 0; index < 2; index++)
    assert.deepEqual(stable(changed.decisions[index]), stable(clean.decisions[index]));
  assert.notDeepEqual(
    clean.decisions[2].forecast?.views[1].q,
    changed.decisions[2].forecast?.views[1].q,
    "the later dated view change should take effect only after its timestamps",
  );
  for (const entry of clean.dailyLedger)
    close(entry.beginningNav + entry.assetPnl + entry.cashPnl - entry.transactionCosts - entry.slippage,
      entry.endingNav);
});