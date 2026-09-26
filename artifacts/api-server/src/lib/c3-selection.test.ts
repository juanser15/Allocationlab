import assert from "node:assert/strict";
import test from "node:test";
import { buildC3Selection, type C3GroupingThresholds } from "./c3-selection";

const thresholds: C3GroupingThresholds = {
  returnCorrelation: 0.8,
  rollingMedianCorrelation: 0.8,
  exposureSimilarity: 0.8,
  regimeCorrelation: 0.75,
  minPairedObservations: 40,
  minRollingWindows: 3,
  minRegimeObservations: 20,
  epsilon: 0.02,
};

function pair(alphaA: string, alphaB: string, overrides: Record<string, unknown> = {}): any {
  return {
    alphaA, alphaB,
    fullSample: { correlation: 0.92, pairedObservations: 120 },
    rollingCorrelation: {
      series: [
        { value: 0.90, status: "AVAILABLE" },
        { value: 0.88, status: "AVAILABLE" },
        { value: 0.86, status: "AVAILABLE" },
      ],
      summary: { median: 0.88, validWindows: 3 },
    },
    regimeCorrelation: [
      { regime: "Risk-On", correlation: 0.94, pairedObservations: 60, status: "AVAILABLE",
        meanReturnA: 0.002, meanReturnB: 0.0019 },
      { regime: "Risk-Off", correlation: 0.86, pairedObservations: 60, status: "AVAILABLE",
        meanReturnA: -0.0002, meanReturnB: -0.0001 },
    ],
    exposureSimilarityByRegime: [
      { regime: "Risk-On", meanSimilarity: 0.93, observations: 30, status: "AVAILABLE" },
      { regime: "Risk-Off", meanSimilarity: 0.88, observations: 30, status: "AVAILABLE" },
    ],
    flag: "PERSISTENTLY_SIMILAR",
    ...overrides,
  };
}

function candidates(ids: string[], values: Record<string, { turnover?: number | null; coverage?: number }> = {}) {
  return ids.map((id) => ({
    id,
    developmentTurnover: values[id] && Object.hasOwn(values[id], "turnover")
      ? values[id].turnover! : 0.02,
    coverage: values[id] && Object.hasOwn(values[id], "coverage")
      ? values[id].coverage! : 0.95,
  }));
}

function select(
  alphaIds: string[],
  dependence: any[],
  candidateValues?: Record<string, { turnover?: number | null; coverage?: number }>,
  manualOverrides: Record<string, string> = {},
) {
  return buildC3Selection({
    alphaIds, dependence, candidates: candidates(alphaIds, candidateValues), thresholds, manualOverrides,
  });
}

test("T1 groups persistently redundant A/B using all required C2 evidence and keeps C standalone", () => {
  const result = select(["alpha-a", "alpha-b", "alpha-c"], [
    pair("alpha-a", "alpha-b"),
    pair("alpha-a", "alpha-c", {
      fullSample: { correlation: 0.25, pairedObservations: 120 },
      flag: "INSUFFICIENT_REGIME_EVIDENCE",
    }),
    pair("alpha-b", "alpha-c", {
      fullSample: { correlation: 0.1, pairedObservations: 120 },
      flag: "INSUFFICIENT_REGIME_EVIDENCE",
    }),
  ]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].memberIds, ["alpha-a", "alpha-b"]);
  assert.equal(result.groups[0].id, 'redundancy:["alpha-a","alpha-b"]');
  assert.deepEqual(result.standaloneIds, ["alpha-c"]);
  assert.equal(result.groups[0].evidence.length, 1);
  assert.equal(result.groups[0].evidence[0].eligible, true);
});

test("T2 never collapses a regime-divergent pair and preserves its conditional evidence", () => {
  const divergent = pair("alpha-a", "alpha-b", {
    flag: "REGIME_DIVERGENCE_OBSERVED",
    fullSample: { correlation: 0.92, pairedObservations: 120 },
    regimeCorrelation: [
      { regime: "Risk-On", correlation: 0.95, pairedObservations: 60, status: "AVAILABLE" },
      { regime: "Risk-Off", correlation: 0.3, pairedObservations: 60, status: "AVAILABLE" },
    ],
    conditionalPerformanceByRegime: { "Risk-Off": { meanA: -0.01, meanB: 0.02 } },
    conditionalContributionByRegime: { "Risk-Off": { deltaA: -0.03, deltaB: 0.01 } },
  });
  const result = select(["alpha-a", "alpha-b"], [divergent]);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.standaloneIds, ["alpha-a", "alpha-b"]);
  assert.equal(result.preservedPairs.length, 1);
  assert.equal(result.preservedPairs[0].fullSampleCorrelation, 0.92);
  assert.deepEqual(result.preservedPairs[0].regimeCorrelations, divergent.regimeCorrelation);
  assert.deepEqual(result.preservedPairs[0].conditionalPerformanceByRegime,
    divergent.conditionalPerformanceByRegime);
  assert.deepEqual(result.preservedPairs[0].conditionalContributionByRegime,
    divergent.conditionalContributionByRegime);
  assert.match(result.preservedPairs[0].reason, /Both candidates are preserved/);
});

test("T3 complete linkage refuses a similarity chain with a dissimilar cross-pair", () => {
  const result = select(["alpha-a", "alpha-b", "alpha-c"], [
    pair("alpha-a", "alpha-b"),
    pair("alpha-b", "alpha-c"),
    pair("alpha-a", "alpha-c", {
      fullSample: { correlation: 0.5, pairedObservations: 120 },
    }),
  ]);
  assert.deepEqual(result.groups.map((group) => group.memberIds), [["alpha-a", "alpha-b"]]);
  assert.deepEqual(result.standaloneIds, ["alpha-c"]);
  assert.ok(result.groups.every((group) =>
    group.evidence.every((evidence: any) => evidence.eligible)));
});

test("T5 representative rule uses turnover, coverage tie-break, canonical ID, and explicit overrides", () => {
  const ids = ["alpha-a", "alpha-b", "alpha-c"];
  const evidence = [pair("alpha-a", "alpha-b"), pair("alpha-a", "alpha-c"), pair("alpha-b", "alpha-c")];
  const candidateData = {
    "alpha-a": { turnover: 0.03, coverage: 1 },
    "alpha-b": { turnover: 0.02, coverage: 0.8 },
    "alpha-c": { turnover: 0.0200000001, coverage: 0.9 },
  };
  const automatic = select(ids, evidence, candidateData);
  assert.deepEqual(automatic.groups[0].memberIds, ids);
  assert.equal(automatic.groups[0].representativeId, "alpha-c",
    "turnover ties within 1e-8 must prefer coverage before canonical ID");
  assert.match(automatic.groups[0].selectionReason, /development traded notional/);

  const groupId = automatic.groups[0].id;
  const overridden = select(ids, evidence, candidateData, { [groupId]: "alpha-a" });
  assert.equal(overridden.groups[0].representativeId, "alpha-a");
  assert.match(overridden.groups[0].selectionReason, /manual override/);
  assert.throws(() => select(ids, evidence, candidateData, { [groupId]: "not-a-member" }),
    /must identify one of its group members/);
  assert.throws(() => select(ids, evidence, candidateData, { "unknown-group": "alpha-a" }),
    /unknown redundancy group/);
});

test("T5 selection fails closed when development turnover or valid coverage is missing", () => {
  assert.throws(() => select(["alpha-a", "alpha-b"], [pair("alpha-a", "alpha-b")], {
    "alpha-a": { turnover: null, coverage: 1 },
    "alpha-b": { turnover: 0.02, coverage: 1 },
  }), /development turnover/);
  assert.throws(() => select(["alpha-a", "alpha-b"], [pair("alpha-a", "alpha-b")], {
    "alpha-a": { turnover: 0.02, coverage: 0 },
    "alpha-b": { turnover: 0.02, coverage: 1 },
  }), /valid-data coverage/);
});

test("T7 perturbation is bounded and evaluation-period outcomes cannot change frozen groups", () => {
  const developmentEvidence = pair("alpha-a", "alpha-b", {
    fullSample: { correlation: 0.81, pairedObservations: 120 },
    rollingCorrelation: {
      series: [{ value: 0.82, status: "AVAILABLE" }, { value: 0.81, status: "AVAILABLE" },
        { value: 0.81, status: "AVAILABLE" }],
      summary: { median: 0.81, validWindows: 3 },
    },
  });
  const base = select(["alpha-a", "alpha-b"], [developmentEvidence]);
  assert.equal(base.groups.length, 1);
  assert.equal(base.sensitivity.epsilon, thresholds.epsilon);
  assert.deepEqual(base.sensitivity.cases.map((item) => item.offset), [-1, 0, 1]);
  assert.equal(base.sensitivity.cases[0].groupCount, 1);
  assert.equal(base.sensitivity.cases[1].groupCount, 1);
  assert.equal(base.sensitivity.cases[2].groupCount, 0);
  assert.equal(base.sensitivity.cases[2].assignmentChangePercent, 100);

  const evaluationChanged = {
    ...developmentEvidence,
    evaluationCorrelation: -1,
    evaluationOutcome: { sharpe: -99, return: -1 },
  };
  const afterEvaluation = select(["alpha-a", "alpha-b"], [evaluationChanged]);
  assert.deepEqual(afterEvaluation.groups.map((group) => [group.id, group.memberIds, group.representativeId]),
    base.groups.map((group) => [group.id, group.memberIds, group.representativeId]));
  assert.deepEqual(afterEvaluation.standaloneIds, base.standaloneIds);
});

test("T7 sensitivity reports a dissolved group without invalidating its frozen manual representative", () => {
  const evidence = pair("alpha-a", "alpha-b", {
    fullSample: { correlation: 0.81, pairedObservations: 120 },
  });
  const result = select(["alpha-a", "alpha-b"], [evidence], undefined, {
    'redundancy:["alpha-a","alpha-b"]': "alpha-b",
  });
  assert.equal(result.groups[0].representativeId, "alpha-b");
  assert.equal(result.sensitivity.cases[1].groups[0].representativeId, "alpha-b");
  assert.equal(result.sensitivity.cases[2].groupCount, 0);
  assert.deepEqual(result.sensitivity.cases[2].membershipChanges, ["alpha-a", "alpha-b"]);
});

test("every correlation, exposure, and sample-count gate is mandatory", () => {
  const insufficientRolling = pair("alpha-a", "alpha-b", {
    rollingCorrelation: {
      series: [{ value: 0.99, status: "AVAILABLE" }],
      summary: { median: 0.99, validWindows: 1 },
    },
  });
  const insufficientExposure = pair("alpha-a", "alpha-b", {
    exposureSimilarityByRegime: [
      { regime: "Risk-On", meanSimilarity: 0.99, observations: 30, status: "AVAILABLE" },
      { regime: "Risk-Off", meanSimilarity: 0.99, observations: 4, status: "AVAILABLE" },
    ],
  });
  const insufficientRegime = pair("alpha-a", "alpha-b", {
    regimeCorrelation: [
      { regime: "Risk-On", correlation: 0.99, pairedObservations: 30, status: "AVAILABLE" },
    ],
  });
  for (const evidence of [insufficientRolling, insufficientExposure, insufficientRegime]) {
    const result = select(["alpha-a", "alpha-b"], [evidence]);
    assert.deepEqual(result.groups, []);
    assert.deepEqual(result.standaloneIds, ["alpha-a", "alpha-b"]);
  }
});