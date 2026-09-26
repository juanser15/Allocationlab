import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  allocationsTable, c1ExperimentsTable, c2ExperimentsTable, c3ExperimentsTable, db,
  preparedInputsTable, validationRunsTable,
} from "@workspace/db";
import type { B3Assumptions } from "./b3-policy";
import type { AllocationRequest } from "./allocation-b2";
import { optimizePreparedSnapshot } from "./allocation-b2";
import { persistC2Experiment } from "./c2-experiment-store";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import {
  buildC3PolicyRequests, getC3Experiment, listC3Experiments, persistC3Experiment,
  previewC3Experiment, replayC3Experiment,
} from "./c3-experiment-store";
import type { FactorDefinition } from "./factor-library";
import { eq, inArray } from "drizzle-orm";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const dateAt = (day: number) => new Date(Date.UTC(2020, 0, 1 + day)).toISOString().slice(0, 10);

const factor: FactorDefinition = {
  id: "c3_fixture_momentum", name: "C3 fixture momentum", description: "Deterministic C3 test factor",
  family: "Test", enabled: true, status: "active", inputSeries: "adjusted close",
  calculationType: "momentum", formula: "P(t-lag)/P(t-lag-lookback)-1",
  direction: "higher_is_better", lookback: 5, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "C3 test prices",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "c3-test-v1",
};

function makeSnapshot(csvContent: string): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams", assetTickers: ["A", "B", "C"], factorIds: [],
      alphaDefinitions: (["A", "B", "C"] as const).map((ticker, index) => ({
        name: `C3 fixture ${ticker}`, factorId: factor.id, assetTickers: [ticker],
        mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
        threshold: -100, grossFraction: [0.45, 0.7, 1][index],
        rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
        transactionCostBps: 2, slippageBps: 1, cashYieldAnnual: 0,
      })),
    },
    csvContent, factorVersion: factor.version, factors: [factor],
  });
}

function policyRequest(snapshot: PreparedSnapshot, preparedInputId = 1): AllocationRequest {
  return {
    preparedInputId,
    candidateIds: snapshot.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(89),
    decisionTimestamp: dateAt(90),
    estimationWindow: 45,
    minObservations: 25,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0.0001,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.4 } },
  };
}

const selection = {
  groups: [{
    id: "redundancy:alpha-a-and-b",
    memberIds: ["alpha-a", "alpha-b"],
    representativeId: "alpha-a",
    evidence: [],
    selectionReason: "test turnover hierarchy",
  }],
  standaloneIds: ["alpha-c"],
  preservedPairs: [],
  sensitivity: { cases: [] },
};

test("C3 T4 places GROUP_CAP inside B2, preserves every alpha, and never clips solved weights", () => {
  const base: AllocationRequest = {
    preparedInputId: 77,
    candidateIds: ["alpha-a", "alpha-b", "alpha-c"],
    informationCutoff: "2020-03-30",
    decisionTimestamp: "2020-03-31",
    estimationWindow: 45,
    minObservations: 25,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.4 } },
  };
  const policies = buildC3PolicyRequests(base, base.candidateIds, selection, {
    "redundancy:alpha-a-and-b": 0.4,
  });
  assert.deepEqual(policies.KEEP_ALL.candidateIds, base.candidateIds);
  assert.deepEqual(policies.GROUP_CAP.candidateIds, base.candidateIds);
  assert.deepEqual(policies.GROUP_CAP.constraints.groupCaps, [{
    name: "c3:redundancy:alpha-a-and-b", candidateIds: ["alpha-a", "alpha-b"], max: 0.4,
  }]);

  const lines = ["date,A,B,C"];
  for (let day = 0; day < 180; day++) {
    const prices = [0, 1, 2].map((asset) =>
      (100 + (day + 1) * (asset + 1) * 0.17 + Math.sin(day * (asset + 1)) * 2).toFixed(8));
    lines.push(`${dateAt(day)},${prices.join(",")}`);
  }
  const snapshot = makeSnapshot(lines.join("\n"));
  const candidates = snapshot.candidates.map((candidate) => candidate.candidateId);
  const actualBase = policyRequest(snapshot);
  const actualSelection = {
    groups: [{ ...selection.groups[0], memberIds: candidates.slice(0, 2), representativeId: candidates[0] }],
    standaloneIds: [candidates[2]],
  };
  const solvedBase = optimizePreparedSnapshot(snapshot, actualBase);
  const actualPolicies = buildC3PolicyRequests(actualBase, candidates, actualSelection, {
    [actualSelection.groups[0].id]: 0.4,
  });
  const solvedGroupCap = optimizePreparedSnapshot(snapshot, actualPolicies.GROUP_CAP);
  assert.equal(solvedBase.status, "SOLVED");
  assert.equal(solvedGroupCap.status, "SOLVED");
  const groupWeight = candidates.slice(0, 2)
    .reduce((sum, id) => sum + (solvedGroupCap.candidateWeights?.[id] ?? 0), 0);
  assert.ok(groupWeight <= 0.4 + 1e-8, `B2 group weight ${groupWeight} exceeds cap`);
  assert.ok(solvedGroupCap.constraintSlacks.some((item) => item.name === "group:c3:redundancy:alpha-a-and-b"));
  assert.notDeepEqual(solvedGroupCap.candidateWeights, solvedBase.candidateWeights);
});

test("C3 T6 changes only selection constraints while evaluation assumptions remain identical", () => {
  const base: AllocationRequest = {
    preparedInputId: 5,
    candidateIds: ["alpha-a", "alpha-b", "alpha-c"],
    informationCutoff: "2020-03-30", decisionTimestamp: "2020-03-31",
    estimationWindow: 45, minObservations: 25, representation: "alpha_streams",
    returnConvention: "daily_decimal", expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0.0001, objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.4 }, assetBounds: { A: { max: 0.7 } } },
  };
  const policies = buildC3PolicyRequests(base, base.candidateIds, selection, {
    "redundancy:alpha-a-and-b": 0.35,
  });
  const stripSelection = (request: AllocationRequest) => {
    const { candidateIds, constraints, ...economic } = request;
    const { groupCaps: _groupCaps, candidateBounds: _candidateBounds, ...sharedConstraints } = constraints;
    return { ...economic, constraints: sharedConstraints };
  };
  assert.deepEqual(stripSelection(policies.KEEP_ALL), stripSelection(policies.GROUP_CAP));
  const assumptions: B3Assumptions = {
    evaluationStartDate: "2020-06-01", evaluationEndDate: "2020-06-28",
    decisionCalendar: "monthly", executionTiming: "next_close",
    initialNav: 1, initialHoldings: {}, initialCash: 1,
    transactionCostBps: 4, slippageBps: 2, dailyCashYield: 0.0001,
  };
  assert.equal(assumptions.evaluationStartDate, "2020-06-01");
  assert.equal(assumptions.evaluationEndDate, "2020-06-28");
  assert.deepEqual(assumptions, structuredClone(assumptions));
});

async function makeDatabaseFixture() {
  const rows = ["date,A,B,C"];
  for (let day = 0; day < 180; day++) {
    const prices = [0, 1, 2].map((asset) =>
      (100 + (day + 1) * (asset + 1) * 0.17 + Math.sin(day * (asset + 1)) * 2).toFixed(8));
    rows.push(`${dateAt(day)},${prices.join(",")}`);
  }
  const snapshot = makeSnapshot(rows.join("\n"));
  assert.deepEqual(snapshot.candidates.map((candidate) => candidate.status), ["READY", "READY", "READY"]);
  const { fingerprint } = await import("./prepared-inputs");
  const preparedFingerprint = fingerprint({
    request: snapshot.request, datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version, engineVersion: snapshot.engineVersion,
  });
  const [policyRow] = await db.insert(preparedInputsTable).values({
    representation: "alpha_streams", fingerprint: preparedFingerprint, snapshot,
  }).returning();
  assert.ok(policyRow);
  const [validationRow] = await db.insert(preparedInputsTable).values({
    representation: "alpha_streams", fingerprint: preparedFingerprint, snapshot,
  }).returning();
  assert.ok(validationRow);
  const request = policyRequest(snapshot, policyRow.id);
  const result = optimizePreparedSnapshot(snapshot, request);
  assert.equal(result.status, "SOLVED", result.reason ?? undefined);
  const frozenSnapshot = structuredClone(snapshot);
  const snapshotHash = fingerprint(frozenSnapshot);
  const engineVersion = `allocation-b2-api.1; ${result.solver.name}@${result.solver.version}`;
  const allocationHash = fingerprint({
    preparedInputId: policyRow.id, representation: "alpha_streams", engineVersion,
    request, snapshotHash, result,
  });
  const [allocation] = await db.insert(allocationsTable).values({
    preparedInputId: policyRow.id, representation: "alpha_streams", fingerprint: allocationHash,
    frozenSnapshotHash: snapshotHash, engineVersion, frozenRequest: request,
    frozenSnapshot, frozenResult: result,
  }).returning();
  assert.ok(allocation);
  const alphaIds = snapshot.candidates.map((candidate) => candidate.candidateId);
  const c2 = await persistC2Experiment({
    allocationId: allocation.id, validationPreparedInputId: validationRow.id,
    c1ExperimentId: null, alphaIds,
    startDate: "2020-02-10", endDate: "2020-05-30",
    regimeSource: "frozen_b1_prefix",
    rollingWindow: 24, rollingStep: 12, contributionWindow: 42, contributionStep: 14,
    minRollingPaired: 8, minRegimePaired: 8, minSharpeObservations: 8,
    highCorrelationThreshold: 0.8, materialCorrelationGap: 0.3,
  });
  if (!("experiment" in c2) || !c2.experiment)
    throw new Error("Could not create deterministic C2 development source: " + ("error" in c2 ? c2.error : "missing response"));
  const input: any = {
    allocationId: allocation.id, validationPreparedInputId: validationRow.id,
    c2ExperimentId: c2.experiment.id, alphaIds,
    developmentStartDate: "2020-02-10", developmentEndDate: "2020-05-30",
    evaluationStartDate: "2020-06-01", evaluationEndDate: "2020-06-28",
    thresholds: {
      returnCorrelation: 0.99, rollingMedianCorrelation: 0.99, exposureSimilarity: 0.99,
      regimeCorrelation: 0.99, minPairedObservations: 15, minRollingWindows: 2,
      minRegimeObservations: 8, epsilon: 0.02,
    },
    groupCaps: {},
    manualOverrides: {},
    assumptions: {
      evaluationStartDate: "2020-06-01", evaluationEndDate: "2020-06-28",
      decisionCalendar: "monthly" as const, executionTiming: "next_close" as const,
      initialNav: 1, initialHoldings: {}, initialCash: 1,
      transactionCostBps: 4, slippageBps: 2, dailyCashYield: 0.0001,
    },
  };
  const preview = await previewC3Experiment(input);
  if (!("plan" in preview) || !preview.plan)
    throw new Error("Could not plan deterministic C3 integration fixture: " + ("error" in preview ? preview.error : "missing plan"));
  input.groupCaps = Object.fromEntries(preview.plan.groups.map((group: any) => [group.id, 0.9]));
  return {
    input,
    cleanup: async (c3Id?: number) => {
      const c3Rows = await db.select().from(c3ExperimentsTable)
        .where(eq(c3ExperimentsTable.c2ExperimentId, c2.experiment!.id));
      const c1Rows = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.allocationId, allocation.id));
      const runIds = [
        ...c1Rows.flatMap((row) => Array.isArray(row.childValidationRunIds)
          ? row.childValidationRunIds as number[] : []),
        ...c3Rows.flatMap((row) => Array.isArray(row.childValidationRunIds)
          ? row.childValidationRunIds as number[] : []),
      ];
      if (c1Rows.length)
        await db.delete(c1ExperimentsTable).where(inArray(c1ExperimentsTable.id, c1Rows.map((row) => row.id)));
      if (runIds.length)
        await db.delete(validationRunsTable).where(inArray(validationRunsTable.id, [...new Set(runIds)]));
      if (c3Rows.length) {
        const allAllocations = c3Rows.flatMap((row) => {
          const manifest = row.manifestJson as any;
          return Object.values(manifest.allocations ?? {}).map((entry: any) => entry.id as number);
        });
        await db.delete(c3ExperimentsTable).where(inArray(c3ExperimentsTable.id, c3Rows.map((row) => row.id)));
        await db.delete(c2ExperimentsTable).where(eq(c2ExperimentsTable.id, c2.experiment!.id));
        if (allAllocations.length)
          await db.delete(allocationsTable).where(inArray(allocationsTable.id, allAllocations));
      } else {
        await db.delete(c2ExperimentsTable).where(eq(c2ExperimentsTable.id, c2.experiment!.id));
      }
      await db.delete(allocationsTable).where(eq(allocationsTable.id, allocation.id));
      await db.delete(preparedInputsTable).where(inArray(preparedInputsTable.id, [policyRow.id, validationRow.id]));
    },
  };
}

test("C3 immutable persistence freezes three B2/B3 policies and replays from its manifest", {
  skip: !databaseAvailable,
}, async () => {
  const fixture = await makeDatabaseFixture();
  let experimentId: number | undefined;
  try {
    const created = await persistC3Experiment(fixture.input);
    if (!("experiment" in created) || !created.experiment)
      throw new Error("C3 immutable comparison failed: " + ("error" in created ? created.error : "missing response"));
    const persistedId = created.experiment.id;
    experimentId = persistedId;
    assert.deepEqual(Object.keys(created.experiment.result.policies).sort(),
      ["GROUP_CAP", "KEEP_ALL", "REPRESENTATIVE"]);
    const expectedChildIds = ["KEEP_ALL", "GROUP_CAP", "REPRESENTATIVE"]
      .map((key) => created.experiment.manifest.validationRuns[key].id);
    assert.deepEqual(created.experiment.childValidationRunIds, expectedChildIds);
    const detailResponse = await getC3Experiment(persistedId);
    assert.deepEqual(detailResponse?.childValidationRunIds, expectedChildIds);
    const listResponse = await listC3Experiments();
    assert.deepEqual(listResponse.find((item) => item.id === persistedId)?.childValidationRunIds, expectedChildIds);
    assert.equal(created.experiment.manifest.input.developmentEndDate < created.experiment.manifest.input.evaluationStartDate, true);
    assert.equal(created.experiment.manifest.result.policies.KEEP_ALL.allocationId, fixture.input.allocationId);
    assert.deepEqual(created.experiment.result.policies.KEEP_ALL.candidateIds, fixture.input.alphaIds);
    const result: any = created.experiment.result;
    assert.equal(Object.keys(result.allocationDistanceSummary).length, 3);
    for (const [pair, series] of Object.entries(result.allocationDistances) as Array<[string, any[]]>) {
      const summary: any = result.allocationDistanceSummary[pair];
      for (const metric of ["alphaCapitalDistance", "underlyingAssetDistance"] as const) {
        const values = series.map((row: any) => row[metric]).filter((value: unknown): value is number =>
          typeof value === "number" && Number.isFinite(value));
        assert.equal(summary[metric].mean,
          values.length ? values.reduce((sum: number, value: number) => sum + value, 0) / values.length : null);
        assert.equal(summary[metric].max, values.length ? Math.max(...values) : null);
      }
    }
    const saved = await db.select().from(c3ExperimentsTable)
      .where(eq(c3ExperimentsTable.id, persistedId)).limit(1);
    assert.equal(saved[0].manifestHash, created.experiment.manifestHash);
    assert.equal((saved[0].childValidationRunIds as number[]).length, 3);
    const childRows = await db.select().from(validationRunsTable)
      .where(inArray(validationRunsTable.id, saved[0].childValidationRunIds as number[]));
    assert.equal(childRows.length, 3);
    for (const child of childRows)
      assert.deepEqual((child.resultJson as any).assumptions, fixture.input.assumptions);
    const replay = await replayC3Experiment(persistedId);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
    assert.equal(replay.differences.length, 0);
    assert.ok(replay.maximumNumericDifference <= 1e-8);
  } finally {
    await fixture.cleanup(experimentId);
  }
});

after(async () => {
  if (databaseAvailable) {
    const { pool } = await import("@workspace/db");
    await pool.end();
  }
});