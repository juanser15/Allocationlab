import assert from "node:assert/strict";
import test from "node:test";
import type { B3Result } from "./b3-policy";
import {
  compareC1ReplayChildren,
  differenceObjects,
  formatC1IntegrityDifference,
  recomputeAndCompareC1Summary,
} from "./c1-replay-integrity";

function failedResult(reason = "recorded infeasibility"): B3Result {
  return {
    status: "failed",
    reason,
    failureDate: "2024-01-31",
    policyIdentity: {
      representation: "alpha_streams",
      candidateIds: ["candidate-a"],
      validationCandidateIds: { "candidate-a": "validation-a" },
      datasetHash: "dataset-hash",
      validationDatasetHash: "validation-dataset-hash",
      objective: { type: "minimum_variance", gamma: 1, eta: 0 },
      estimationWindow: 20,
      minObservations: 10,
    },
    assumptions: {} as B3Result["assumptions"],
    decisionCalendar: [],
    decisions: [],
    dailyLedger: [],
    metrics: null,
    diagnostics: {
      reconciliationTolerance: 1e-8,
      maximumReconciliationDifference: null,
      engineVersion: "test-engine",
      solverVersions: [],
      limitations: [],
    },
  };
}

const expectedChild = {
  label: "Baseline",
  excludedCandidateIds: [],
  validationRunId: 41,
  policyRequest: { candidateIds: ["candidate-a"], informationCutoff: "2024-01-01" },
  result: failedResult(),
};

test("exactly compares identities, dates, exclusions, statuses and aligned plans", () => {
  const plan = {
    policyId: 41,
    status: "completed",
    excludedCandidateIds: ["candidate-a"],
    estimationDates: ["2024-01-02", "2024-01-03"],
  };
  assert.equal(differenceObjects(plan, structuredClone(plan)).length, 0);

  const changed = differenceObjects(plan, {
    ...plan,
    policyId: 42,
    status: "failed",
    excludedCandidateIds: [],
    estimationDates: ["2024-01-02", "2024-01-04"],
  });
  assert.deepEqual(changed.map((item) => item.field), [
    "value.policyId",
    "value.status",
    "value.excludedCandidateIds.length",
    "value.estimationDates[1]",
  ]);
});

test("uses 1e-8 only when explicitly requested and preserves undefined", () => {
  assert.equal(differenceObjects({ amount: 2 }, { amount: 2 + 1e-9 }).length, 1);
  assert.equal(differenceObjects(
    { amount: 2 },
    { amount: 2 + 1e-9 },
    { numericTolerance: 1e-8 },
  ).length, 0);
  assert.equal(differenceObjects({ metric: undefined }, { metric: null }).length, 1);
  assert.equal(differenceObjects({ metric: undefined }, {}).length, 1);
});

test("R4(a): wrong child reference is reported with expected and observed values", () => {
  const differences = compareC1ReplayChildren(
    [expectedChild],
    [{ ...expectedChild, validationRunId: 99 }],
  );
  assert.deepEqual(differences.map((item) => item.field), ["children[0].validationRunId"]);
  assert.equal(formatC1IntegrityDifference(differences[0]),
    "children[0].validationRunId: expected=41, observed=99");
});

test("R4(b): a mismatched persisted child result copy is detected", () => {
  const observedResult = { ...expectedChild.result, reason: "different recorded outcome" };
  const differences = compareC1ReplayChildren(
    [expectedChild],
    [{ ...expectedChild, result: observedResult }],
  );
  assert.deepEqual(differences.map((item) => item.field), ["children[0].result.reason"]);
  assert.equal(differences[0].expected, "recorded infeasibility");
  assert.equal(differences[0].observed, "different recorded outcome");
});

test("R4(c): recomputed summary detects an altered saved delta", () => {
  const children = [
    { label: "Baseline", excludedCandidateIds: [], result: failedResult() },
    { label: "Exclude candidate-a", excludedCandidateIds: ["candidate-a"], result: failedResult() },
  ];
  const correct = recomputeAndCompareC1Summary(children, ["candidate-a"], undefined).recomputedSummary;
  const savedCopy = structuredClone(correct);
  savedCopy.variants[0].deltaFullMinusVariant.cumulativeReturn.reason = "fabricated delta";

  const integrity = recomputeAndCompareC1Summary(children, ["candidate-a"], savedCopy);
  assert.ok(integrity.differences.some((item) =>
    item.field === "summary.variants[0].deltaFullMinusVariant.cumulativeReturn.reason"));
  assert.equal(integrity.differences.find((item) =>
    item.field === "summary.variants[0].deltaFullMinusVariant.cumulativeReturn.reason")?.expected,
  "Delta unavailable: recorded infeasibility");
});

test("result copies accept numeric replay noise up to 1e-8 but not beyond", () => {
  const near = { ...expectedChild, result: { ...expectedChild.result, metrics: { totalTransactionCosts: 3 } } };
  const nearObserved = { ...near, result: { ...near.result, metrics: { totalTransactionCosts: 3 + 1e-9 } } };
  assert.equal(compareC1ReplayChildren([near], [nearObserved]).length, 0);
  const farObserved = { ...near, result: { ...near.result, metrics: { totalTransactionCosts: 3 + 2e-8 } } };
  assert.deepEqual(compareC1ReplayChildren([near], [farObserved]).map((item) => item.field),
    ["children[0].result.metrics.totalTransactionCosts"]);
  const alteredAssumption = {
    ...near,
    result: { ...near.result, assumptions: { transactionCostBps: 2 + 1e-9 } },
  };
  const originalAssumption = {
    ...near,
    result: { ...near.result, assumptions: { transactionCostBps: 2 } },
  };
  assert.deepEqual(compareC1ReplayChildren([originalAssumption], [alteredAssumption])
    .map((item) => item.field), ["children[0].result.assumptions.transactionCostBps"]);
});