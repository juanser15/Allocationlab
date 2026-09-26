import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationRequest } from "./allocation-b2";
import { runB3Validation, type B3Assumptions, type B3Decision } from "./b3-policy";
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
    factorVersion: "d4-b3-test-v1",
    factors: [],
    datasetId: 92,
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

function request(
  source: PreparedSnapshot,
  views?: NonNullable<Extract<AllocationRequest["forecastModel"], { type: "BAYESIAN_VIEWS" }>["views"]>,
  method: "NOMINAL" | "ROBUST_MEAN_UNCERTAINTY" = "ROBUST_MEAN_UNCERTAINTY",
): AllocationRequest {
  const ids = source.candidates.map((candidate) => candidate.candidateId);
  return {
    preparedInputId: 92,
    candidateIds: ids,
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
    forecastModel: {
      type: "BAYESIAN_VIEWS",
      priorMean: {
        source: "USER_DEFINED_PRIOR",
        values: Object.fromEntries(ids.map((id, index) => [id, 0.0001 * (index + 1)])),
      },
      priorUncertainty: {
        type: "USER_DEFINED",
        candidateIds: ids,
        matrix: [[0.00002, 0.000003], [0.000003, 0.00003]],
      },
      views: views ?? ids.map((candidateId, index) => ({
        type: "ABSOLUTE" as const,
        candidateId,
        q: 0.0005 * (index + 1),
        variance: 0.000001,
        effectiveTimestamp: dateAt(5),
        availabilityTimestamp: dateAt(5),
      })),
    },
    robustness: {
      method,
      kappa: method === "NOMINAL" ? 0 : 0.2,
    },
  };
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by > ${tolerance}`);
}

function stableD4Decision(decision: B3Decision) {
  const diagnostics = decision.d4Policy?.diagnostics?.diagnostics as {
    comparison?: unknown;
    sensitivity?: unknown;
    covarianceUncertainty?: unknown;
  } | undefined;
  const definitionIds = new Map([
    ...decision.policyCandidateIds.map((id, index) => [id, `candidate_${index}`] as const),
    ...decision.pointInTimeCandidateIds.map((id, index) => [id, `candidate_${index}`] as const),
  ]);
  const byDefinition = (value: unknown): unknown => {
    if (typeof value === "string") return definitionIds.get(value) ?? value;
    if (Array.isArray(value)) return value.map(byDefinition);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        definitionIds.get(key) ?? key, byDefinition(child),
      ]));
    return value;
  };
  return byDefinition({
    forecastStatus: decision.forecastStatus,
    estimationDates: decision.estimationDates,
    V_mu: decision.d4Policy?.V_mu,
    viewDiagnostics: decision.forecast?.views.map((view) => ({
      candidateId: view.candidateId,
      status: view.status,
      ...(view.status === "ELIGIBLE" ? { q: view.q, exposure: view.exposure, variance: view.variance } : {}),
    })),
    forecastMuHat: decision.forecast?.muHat,
    forecastSigma: decision.forecast?.sigma,
    forecastVmu: decision.forecast?.V_mu,
    P: decision.forecast?.P,
    q: decision.forecast?.q,
    Omega: decision.forecast?.Omega,
    modelMu: decision.optimizer.model?.mu,
    modelRiskCovariance: decision.optimizer.model?.sigma,
    nominalWeights: decision.d4Policy?.nominalWeights,
    robustWeights: decision.d4Policy?.robustWeights,
    nominalTargetAssetWeights: decision.d4Policy?.nominalTargetAssetWeights,
    robustTargetAssetWeights: decision.d4Policy?.robustTargetAssetWeights,
    selectedTargetAssetWeights: decision.targetAssetWeights,
    solverDiagnostics: diagnostics && {
      comparison: diagnostics.comparison,
      sensitivity: diagnostics.sensitivity,
      covarianceUncertainty: diagnostics.covarianceUncertainty,
    },
    estimatedGrossReturn: decision.optimizer.estimatedGrossReturn,
    estimatedVolatility: decision.optimizer.estimatedVolatility,
    objectiveContributions: decision.optimizer.objectiveContributions,
  });
}

test("D4 B3 T5 — future prices and dated views cannot alter frozen earlier decisions", () => {
  const policySnapshot = snapshot();
  const initialPolicy = request(policySnapshot);
  const calendarRun = runB3Validation(policySnapshot, initialPolicy, policySnapshot, assumptions());
  assert.ok(calendarRun.decisionCalendar.length >= 3);
  const informationCutoff = (decisionDate: string) =>
    dateAt(Number((Date.parse(`${decisionDate}T00:00:00Z`) -
      Date.parse(`${dateAt(0)}T00:00:00Z`)) / 86_400_000) - 1);
  const firstCutoff = informationCutoff(calendarRun.decisionCalendar[0].decisionDate);
  const secondCutoff = informationCutoff(calendarRun.decisionCalendar[1].decisionDate);
  const thirdCutoff = informationCutoff(calendarRun.decisionCalendar[2].decisionDate);
  const ids = policySnapshot.candidates.map((candidate) => candidate.candidateId);
  const datedViews = (futureQ: number) => [
    {
      type: "ABSOLUTE" as const,
      candidateId: ids[0],
      q: 0.0008,
      variance: 0.000001,
      effectiveTimestamp: dateAt(5),
      availabilityTimestamp: dateAt(5),
    },
    {
      type: "ABSOLUTE" as const,
      candidateId: ids[1],
      q: futureQ,
      variance: 0.000001,
      effectiveTimestamp: thirdCutoff,
      availabilityTimestamp: thirdCutoff,
    },
  ];
  assert.ok(dateAt(5) <= firstCutoff);
  assert.ok(firstCutoff < secondCutoff && secondCutoff < thirdCutoff);

  const clean = runB3Validation(
    policySnapshot, request(policySnapshot, datedViews(0.001)), policySnapshot, assumptions(),
  );
  const mutated = runB3Validation(
    policySnapshot,
    request(policySnapshot, datedViews(-0.002)),
    snapshot(csvFor({
      index: Number((Date.parse(`${secondCutoff}T00:00:00Z`) -
        Date.parse(`${dateAt(0)}T00:00:00Z`)) / 86_400_000),
      multiplier: 1.8,
    })),
    assumptions(),
  );

  for (const result of [clean, mutated]) assert.equal(result.status, "completed");
  assert.deepEqual(stableD4Decision(clean.decisions[0]), stableD4Decision(mutated.decisions[0]));
  assert.deepEqual(stableD4Decision(clean.decisions[1]), stableD4Decision(mutated.decisions[1]));
  for (let index = 0; index < 2; index++) {
    assert.equal(clean.decisions[index].forecast?.views[1].status, "NOT_EFFECTIVE_OR_AVAILABLE");
    assert.equal(mutated.decisions[index].forecast?.views[1].status, "NOT_EFFECTIVE_OR_AVAILABLE");
    assert.notEqual(
      clean.decisions[index].forecast?.views[1].q,
      mutated.decisions[index].forecast?.views[1].q,
      "the unavailable future view keeps its changed frozen provenance without affecting the current forecast",
    );
  }
  assert.notDeepEqual(
    clean.decisions[2].forecast?.views[1].q,
    mutated.decisions[2].forecast?.views[1].q,
    "the changed future view should only affect decisions after its timestamps",
  );
  for (const result of [clean, mutated]) {
    for (const decision of result.decisions) {
      assert.equal(decision.d4Policy?.method, "ROBUST_MEAN_UNCERTAINTY");
      assert.ok(decision.d4Policy?.V_mu?.length);
      assert.deepEqual(Object.keys(decision.d4Policy?.robustWeights ?? {}).sort(),
        [...decision.policyCandidateIds].sort());
      assert.deepEqual(Object.keys(decision.d4Policy?.robustTargetAssetWeights ?? {}).sort(), tickers);
      const diagnostics = decision.optimizer.robustness?.diagnostics as
        { nominalRequest?: { candidateIds?: string[] } } | undefined;
      assert.ok(diagnostics);
      assert.deepEqual(diagnostics.nominalRequest?.candidateIds, decision.policyCandidateIds);
    }
  }
});

test("D4 B3 T7 — nominal and robust ledgers independently reconcile as factual comparisons", () => {
  const source = snapshot();
  const nominal = runB3Validation(source, request(source, undefined, "NOMINAL"), source, assumptions());
  const robust = runB3Validation(
    source, request(source, undefined, "ROBUST_MEAN_UNCERTAINTY"), source, assumptions(),
  );
  assert.equal(nominal.status, "completed");
  assert.equal(robust.status, "completed");
  assert.equal(nominal.dailyLedger.length, robust.dailyLedger.length);
  assert.equal(nominal.metrics?.totalTransactionCosts, 0);
  assert.equal(nominal.metrics?.totalSlippage, 0);
  assert.equal(robust.metrics?.totalTransactionCosts, 0);
  assert.equal(robust.metrics?.totalSlippage, 0);
  for (const result of [nominal, robust]) {
    assert.equal(result.decisions.length, result.decisionCalendar.length);
    assert.ok((result.diagnostics.maximumReconciliationDifference ?? Infinity) <= 1e-8);
    for (const entry of result.dailyLedger) {
      close(entry.beginningNav + entry.assetPnl + entry.cashPnl -
        entry.transactionCosts - entry.slippage, entry.endingNav);
      close(entry.reconciliationDifference, 0);
    }
  }
  assert.equal(nominal.decisions[0].d4Policy?.method, "NOMINAL");
  assert.equal(robust.decisions[0].d4Policy?.method, "ROBUST_MEAN_UNCERTAINTY");
  // These are two factual ledgers for the same frozen inputs, not a ranking.
});