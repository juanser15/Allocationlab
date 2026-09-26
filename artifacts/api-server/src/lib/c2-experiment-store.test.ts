import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import type { C2ExperimentInput } from "@workspace/api-zod";
import { prepareSnapshot, type PreparedSnapshot } from "./prepared-inputs";
import type { AllocationRequest } from "./allocation-b2";
import { optimizePreparedSnapshot } from "./allocation-b2";
import type { FactorDefinition } from "./factor-library";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
let dbModule: typeof import("@workspace/db") | undefined;
let storeModule: typeof import("./c2-experiment-store") | undefined;
let fixtureSequence = 0;

async function modules() {
  dbModule ??= await import("@workspace/db");
  storeModule ??= await import("./c2-experiment-store");
  return { ...dbModule, ...storeModule };
}

after(async () => {
  if (dbModule) await dbModule.pool.end();
});

const dateAt = (index: number) => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);

const verificationFactor: FactorDefinition = {
  id: "c2_verification_momentum", name: "C2 verification momentum", description: "Deterministic verification fixture",
  family: "Test", enabled: true, status: "active", inputSeries: "adjusted close",
  calculationType: "momentum", formula: "P(t-lag)/P(t-lag-lookback)-1",
  direction: "higher_is_better", lookback: 5, lag: 0, normalization: "percentile_rank",
  winsorizationLower: 0, winsorizationUpper: 1, missingDataTreatment: "exclude",
  baseWeight: 1, regimeWeights: { riskOn: 1, neutral: 1, riskOff: 1 },
  activeRegimes: ["risk_on", "neutral", "risk_off"], dataSource: "C2 verification prices",
  benchmarkTicker: null, currentCoverage: 1, availabilityReason: null, version: "c2-verification-v1",
};

function makeSnapshot(csvContent: string): PreparedSnapshot {
  return prepareSnapshot({
    request: {
      representation: "alpha_streams", assetTickers: ["A", "B", "C"], factorIds: [],
      alphaDefinitions: (["A", "B", "C"] as const).map((ticker, index) => ({
        name: `C2 verification Alpha ${ticker}`, factorId: verificationFactor.id, assetTickers: [ticker],
        mapping: "single_asset_long_cash" as const, signalUnits: "oriented" as const,
        threshold: -100, grossFraction: [0.45, 0.7, 1][index],
        rebalanceFrequency: "monthly" as const, executionTiming: "next_close" as const,
        transactionCostBps: 0, slippageBps: 0, cashYieldAnnual: 0,
      })),
    },
    csvContent, factorVersion: verificationFactor.version, factors: [verificationFactor],
  });
}

function preparedFingerprint(snapshot: PreparedSnapshot, fingerprint: (value: unknown) => string): string {
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

async function makeDbFixture(options: { mismatchAllocationSnapshot?: boolean; validationStatus?: string; cashMax?: number } = {}) {
  const { db, allocationsTable, preparedInputsTable, fingerprint, hashDataset } = await (async () => {
    const database = await modules();
    const { fingerprint: fp } = await import("./prepared-inputs");
    const { hashDataset: hash } = await import("./run-snapshot");
    return { ...database, fingerprint: fp, hashDataset: hash };
  })();
  ++fixtureSequence;
  const rows = ["date,A,B,C"];
  const observationCount = 180;
  for (let index = 0; index < observationCount; index++) {
    const prices = [0, 1, 2].map(asset =>
      (100 + (index + 1) * (asset + 1) * 0.17 + Math.sin(index * (asset + 1)) * 2).toFixed(8));
    rows.push(`${dateAt(index)},${prices.join(",")}`);
  }
  const csvContent = rows.join("\n");
  const datasetHash = hashDataset(csvContent);
  const snapshot = makeSnapshot(csvContent);
  assert.equal(snapshot.dataset.sha256, datasetHash);
  const alphaIds = snapshot.candidates.map(candidate => candidate.candidateId) as [string, string, string];
  assert.deepEqual(snapshot.candidates.map(candidate => candidate.status), ["READY", "READY", "READY"]);
  const policyRow = (await db.insert(preparedInputsTable).values({
    representation: "alpha_streams",
    fingerprint: preparedFingerprint(snapshot, fingerprint),
    snapshot,
  }).returning())[0];
  assert.ok(policyRow);
  const validationSnapshot = structuredClone(snapshot);
  if (options.validationStatus) validationSnapshot.candidates[0].status = options.validationStatus as any;
  const validationRow = (await db.insert(preparedInputsTable).values({
    representation: "alpha_streams",
    fingerprint: preparedFingerprint(validationSnapshot, fingerprint),
    snapshot: validationSnapshot,
  }).returning())[0];
  assert.ok(validationRow);

  const allocationRequest: AllocationRequest = {
    preparedInputId: policyRow.id,
    candidateIds: [...alphaIds],
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
    constraints: { totalCash: { max: options.cashMax ?? 0.4 } },
  };
  const frozenSnapshot = structuredClone(snapshot);
  if (options.mismatchAllocationSnapshot)
    frozenSnapshot.candidates[0].lineage.datasetHash = "deliberately-mutated-frozen-b2-source";
  const frozenResult = optimizePreparedSnapshot(snapshot, allocationRequest);
  assert.equal(frozenResult.status, "SOLVED", frozenResult.reason ?? undefined);
  assert.ok(frozenResult.totalCash !== null && frozenResult.totalCash < 1);
  const frozenSnapshotHash = fingerprint(frozenSnapshot);
  const allocationEngineVersion = "b2-c2-persistence-test";
  const allocationFp = fingerprint({
    preparedInputId: policyRow.id,
    representation: "alpha_streams",
    engineVersion: allocationEngineVersion,
    request: allocationRequest,
    snapshotHash: frozenSnapshotHash,
    result: frozenResult,
  });
  const allocation = (await db.insert(allocationsTable).values({
    preparedInputId: policyRow.id,
    representation: "alpha_streams",
    fingerprint: allocationFp,
    frozenSnapshotHash,
    engineVersion: allocationEngineVersion,
    frozenRequest: allocationRequest,
    frozenSnapshot,
    frozenResult,
  }).returning())[0];
  assert.ok(allocation);

  const input: C2ExperimentInput = {
    allocationId: allocation.id,
    validationPreparedInputId: validationRow.id,
    c1ExperimentId: null,
    alphaIds: alphaIds.slice(0, 2),
    startDate: dateAt(55),
    endDate: dateAt(150),
    regimeSource: "frozen_b1_prefix",
    rollingWindow: 24,
    rollingStep: 12,
    contributionWindow: 300,
    contributionStep: 63,
    minRollingPaired: 10,
    minRegimePaired: 10,
    minSharpeObservations: 10,
    highCorrelationThreshold: 0.8,
    materialCorrelationGap: 0.3,
  };
  return {
    input,
    alphaIds,
    cleanup: async (experimentId?: number) => {
      const { c2ExperimentsTable, c1ExperimentsTable, validationRunsTable } = await modules();
      if (experimentId) await db.delete(c2ExperimentsTable).where(eq(c2ExperimentsTable.id, experimentId));
      const c1Rows = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.allocationId, allocation.id));
      const runIds = c1Rows.flatMap((row) => Array.isArray(row.childValidationRunIds)
        ? row.childValidationRunIds as number[] : []);
      if (c1Rows.length)
        await db.delete(c1ExperimentsTable).where(inArray(c1ExperimentsTable.id, c1Rows.map((row) => row.id)));
      if (runIds.length) await db.delete(validationRunsTable).where(inArray(validationRunsTable.id, runIds));
      await db.delete(allocationsTable).where(eq(allocationsTable.id, allocation.id));
      await db.delete(preparedInputsTable).where(inArray(preparedInputsTable.id, [policyRow.id, validationRow.id]));
    },
  };
}

function fixtureAssumptions(input: C2ExperimentInput, transactionCostBps = 0) {
  return {
    evaluationStartDate: input.startDate,
    evaluationEndDate: input.endDate,
    decisionCalendar: "monthly" as const,
    executionTiming: "next_close" as const,
    initialNav: 1,
    initialHoldings: {},
    initialCash: 1,
    transactionCostBps,
    slippageBps: 0,
    dailyCashYield: 0.0001,
  };
}

test("C2 immutable persistence creates, reloads, and replays from frozen source rows in PostgreSQL", {
  skip: !databaseAvailable,
}, async () => {
  await modules();
  const fixture = await makeDbFixture();
  let experimentId: number | undefined;
  try {
    const saved = await storeModule!.persistC2Experiment(fixture.input);
    if (!("experiment" in saved) || !saved.experiment)
      throw new Error("Expected persisted C2 experiment: " + ("error" in saved ? saved.error : "missing response"));
    experimentId = saved.experiment.id;
    const loaded = await storeModule!.getC2Experiment(experimentId);
    assert.ok(loaded);
    assert.equal(loaded.id, experimentId);
    assert.equal(loaded.manifestHash, saved.experiment.manifestHash);
    assert.equal(loaded.resultHash, saved.experiment.resultHash);
    assert.deepEqual(loaded.manifest, saved.experiment.manifest);
    assert.deepEqual(loaded.result, saved.experiment.result);

    const replay = await storeModule!.replayC2Experiment(experimentId);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
    assert.deepEqual(replay.differences, []);
    assert.ok(replay.maximumNumericDifference <= 1e-8);
  } finally {
    await fixture.cleanup(experimentId);
  }
});

test("C2 resolves one exact C1 child and plans/creates the missing selected-alpha dependency", {
  skip: !databaseAvailable,
}, async () => {
  const fixture = await makeDbFixture();
  let experimentId: number | undefined;
  try {
    const { persistC1Experiment, replayC1Experiment } = await import("./c1-experiment-store");
    const c1 = await persistC1Experiment({
      allocationId: fixture.input.allocationId,
      validationPreparedInputId: fixture.input.validationPreparedInputId,
      assumptions: fixtureAssumptions(fixture.input),
      mode: "single",
      exclusionSets: [[fixture.alphaIds[0]]],
    });
    if (!("experiment" in c1) || !c1.experiment)
      throw new Error("Could not persist the real C1 compatibility fixture: " + ("error" in c1 ? c1.error : "missing response"));
    if (c1.experiment.status !== "completed") {
      const { db, c1ExperimentsTable } = await modules();
      const [failed] = await db.select().from(c1ExperimentsTable)
        .where(eq(c1ExperimentsTable.id, c1.experiment.id));
      assert.fail(`C1 fixture failed: ${JSON.stringify({
        b1: fixture.input.validationPreparedInputId, b2: fixture.input.allocationId,
        c1: c1.experiment.id, alpha: fixture.alphaIds[0],
        children: failed?.childResultsJson, manifest: failed?.manifestJson,
      })}`);
    }
    const old = await persistC1Experiment({
      allocationId: fixture.input.allocationId,
      validationPreparedInputId: fixture.input.validationPreparedInputId,
      assumptions: fixtureAssumptions(fixture.input, 12),
      mode: "single", exclusionSets: [[fixture.alphaIds[1]]],
    });
    if (!("experiment" in old) || !old.experiment)
      throw new Error("Cost-mismatched historical C1 fixture failed to persist.");
    assert.equal(old.experiment.status, "completed");
    assert.equal((await replayC1Experiment(old.experiment.id))?.status, "pass");
    assert.notEqual(old.experiment.id, c1.experiment.id);

    const { planC2Dependencies, persistC2Experiment: persistC2 } = await modules();
    const planned = await planC2Dependencies({ ...fixture.input, c1ExperimentId: c1.experiment.id });
    if (!("plan" in planned) || !planned.plan)
      throw new Error("C2 dependency planning failed: " + ("error" in planned ? planned.error : "missing response"));
    assert.deepEqual(planned.plan.dependencies.map((item) => [item.alphaId, item.status, item.c1ExperimentId]), [
      [fixture.alphaIds[0], "REUSE", c1.experiment.id],
      [fixture.alphaIds[1], "WILL_CREATE", null],
    ], JSON.stringify({
      plan: planned.plan.dependencies, c1Replay: await replayC1Experiment(c1.experiment.id),
    }));
    assert.equal(planned.plan.reusedCount, 1);
    assert.equal(planned.plan.toCreateCount, 1);
    assert.equal(planned.plan.newPolicyCount, 2);

    const saved = await persistC2({ ...fixture.input, c1ExperimentId: c1.experiment.id });
    if (!("experiment" in saved) || !saved.experiment)
      throw new Error("C2 dependency orchestration failed: " + ("error" in saved ? saved.error : "missing response"));
    experimentId = saved.experiment.id;
    const sources = (saved.experiment.manifest as any).sources;
    assert.equal(sources.dependencyPlan[0].status, "REUSED");
    assert.equal(sources.dependencyPlan[0].c1ExperimentId, c1.experiment.id);
    assert.equal(sources.dependencyPlan[1].status, "CREATED");
    const createdC1Id = sources.dependencyPlan[1].c1ExperimentId;
    assert.ok(Number.isSafeInteger(createdC1Id));
    assert.notEqual(createdC1Id, old.experiment.id);
    assert.equal((sources.c1ByAlpha[fixture.alphaIds[1]] as any).manifest.assumptions.transactionCostBps, 0);
    assert.ok(sources.c1ByAlpha[fixture.alphaIds[0]]);
    assert.ok(sources.c1ByAlpha[fixture.alphaIds[1]]);
    const replay = await replayC1Experiment(createdC1Id);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
  } finally {
    await fixture.cleanup(experimentId);
  }
});

test("C2 R5 retained verification fixtures (run only with C2_SEED_R5=1)", {
  skip: !databaseAvailable || process.env.C2_SEED_R5 !== "1",
}, async () => {
  const fixture = await makeDbFixture();
  const { persistC1Experiment, replayC1Experiment } = await import("./c1-experiment-store");
  const create = async (alpha: string, cost: number) => {
    const saved = await persistC1Experiment({
      allocationId: fixture.input.allocationId,
      validationPreparedInputId: fixture.input.validationPreparedInputId,
      assumptions: fixtureAssumptions(fixture.input, cost),
      mode: "single", exclusionSets: [[alpha]],
    });
    if (!("experiment" in saved) || !saved.experiment || saved.experiment.status !== "completed")
      throw new Error(`Verification C1 ${alpha} at cost ${cost} did not complete: ${JSON.stringify(saved)}`);
    const replay = await replayC1Experiment(saved.experiment.id);
    assert.equal(replay?.status, "pass", replay?.differences.join("\n"));
    return saved.experiment.id;
  };
  const exactC1Id = await create(fixture.alphaIds[0], 0);
  const incompatibleC1Id = await create(fixture.alphaIds[1], 12);
  const planned = await storeModule!.planC2Dependencies({ ...fixture.input, c1ExperimentId: exactC1Id });
  assert.ok("plan" in planned && planned.plan);
  assert.deepEqual(planned.plan.dependencies.map(d => [d.status, d.c1ExperimentId]),
    [["REUSE", exactC1Id], ["WILL_CREATE", null]]);
  const descriptor = {
    namespace: `C2-verification-${fixture.input.allocationId}`,
    b1Id: fixture.input.validationPreparedInputId, b2Id: fixture.input.allocationId,
    alphaA: fixture.alphaIds[0], alphaB: fixture.alphaIds[1], alphaC: fixture.alphaIds[2],
    exactC1Id, incompatibleC1Id,
    startDate: fixture.input.startDate, endDate: fixture.input.endDate,
    settings: { rollingWindow: fixture.input.rollingWindow, rollingStep: fixture.input.rollingStep,
      contributionWindow: fixture.input.contributionWindow, contributionStep: fixture.input.contributionStep,
      minRollingPaired: fixture.input.minRollingPaired, minRegimePaired: fixture.input.minRegimePaired,
      minSharpeObservations: fixture.input.minSharpeObservations },
    plan: planned.plan.dependencies,
  };
  await writeFile("/tmp/c2-r5-fixture.json", JSON.stringify(descriptor, null, 2));
  assert.ok(exactC1Id !== incompatibleC1Id);
});

test("C2 freezes explicit B3 cost/date targets instead of reusing a different C1 template", {
  skip: !databaseAvailable,
}, async () => {
  const fixture = await makeDbFixture();
  try {
    const { persistC1Experiment, replayC1Experiment } = await import("./c1-experiment-store");
    const c1 = await persistC1Experiment({
      allocationId: fixture.input.allocationId,
      validationPreparedInputId: fixture.input.validationPreparedInputId,
      assumptions: fixtureAssumptions(fixture.input, 0),
      mode: "single",
      exclusionSets: [[fixture.alphaIds[0]]],
    });
    if (!("experiment" in c1) || !c1.experiment)
      throw new Error("Could not persist the cost-mismatch C1 fixture: " + ("error" in c1 ? c1.error : "missing response"));

    const targetInput = { ...fixture.input, assumptions: fixtureAssumptions(fixture.input, 12) };
    const planned = await storeModule!.planC2Dependencies(targetInput);
    if (!("plan" in planned) || !planned.plan)
      throw new Error("C2 explicit assumptions planning failed: " + ("error" in planned ? planned.error : "missing response"));
    assert.deepEqual(planned.plan.dependencies.map((item) => item.status), ["WILL_CREATE", "WILL_CREATE"]);
    assert.ok(planned.plan.dependencies.every((item) => item.c1ExperimentId === null));

    const wrongPeriod = {
      ...targetInput,
      assumptions: { ...targetInput.assumptions, evaluationStartDate: dateAt(2) },
    };
    const rejected = await storeModule!.planC2Dependencies(wrongPeriod);
    assert.ok("error" in rejected);
    if ("error" in rejected && rejected.error)
      assert.match(rejected.error, /must exactly match the C2 startDate and endDate/i);
  } finally {
    await fixture.cleanup();
  }
});

test("C2 preserves a genuine infeasible exclusion and reuses an independent successful sibling", {
  skip: !databaseAvailable,
}, async () => {
  const fixture = await makeDbFixture({ cashMax: 0.2 });
  let experimentId: number | undefined;
  try {
    const { persistC1Experiment, replayC1Experiment } = await import("./c1-experiment-store");
    const c1 = await persistC1Experiment({
      allocationId: fixture.input.allocationId,
      validationPreparedInputId: fixture.input.validationPreparedInputId,
      assumptions: fixtureAssumptions(fixture.input),
      mode: "single",
      exclusionSets: [[fixture.alphaIds[2]], [fixture.alphaIds[1]]],
    });
    if (!("experiment" in c1) || !c1.experiment)
      throw new Error("Could not persist the mixed-success C1 fixture: " + ("error" in c1 ? c1.error : "missing response"));
    const input = { ...fixture.input, alphaIds: [fixture.alphaIds[2], fixture.alphaIds[1]],
      c1ExperimentId: c1.experiment.id };
    const planned = await storeModule!.planC2Dependencies(input);
    if (!("plan" in planned) || !planned.plan)
      throw new Error("C2 partial-source planning failed: " + ("error" in planned ? planned.error : "missing response"));
    assert.deepEqual(planned.plan.dependencies.map((item) => item.status), ["UNAVAILABLE", "REUSE"],
      JSON.stringify({ c1Id: c1.experiment.id, dependencies: planned.plan.dependencies,
        c1Replay: await replayC1Experiment(c1.experiment.id) }));
    assert.equal(planned.plan.dependencies[0].c1ExperimentId, c1.experiment.id);
    assert.match(planned.plan.dependencies[0].reason ?? "", /B2 INFEASIBLE.*C1 experiment #/);
    assert.equal(planned.plan.dependencies[1].c1ExperimentId, c1.experiment.id);

    const saved = await storeModule!.persistC2Experiment(input);
    if (!("experiment" in saved) || !saved.experiment)
      throw new Error("C2 partial dependency persistence failed: " + ("error" in saved ? saved.error : "missing response"));
    experimentId = saved.experiment.id;
    const sources = saved.experiment.manifest as any;
    assert.ok(sources.sources.c1ByAlpha[fixture.alphaIds[1]]);
    assert.equal(sources.sources.c1ByAlpha[fixture.alphaIds[2]], undefined);
    assert.equal(sources.sources.dependencyPlan[0].status, "UNAVAILABLE");
    assert.match(sources.sources.dependencyPlan[0].reason, /B2 INFEASIBLE/);
    const replay = await storeModule!.replayC2Experiment(experimentId);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
  } finally {
    await fixture.cleanup(experimentId);
  }
});

test("C2 refuses mismatched B2 frozen snapshot and non-READY validation candidates", {
  skip: !databaseAvailable,
}, async () => {
  const mismatch = await makeDbFixture({ mismatchAllocationSnapshot: true });
  try {
    const result = await storeModule!.persistC2Experiment(mismatch.input);
    if (!("error" in result) || !result.error)
      throw new Error("Expected mismatched frozen-source request to be rejected.");
    assert.match(result.error, /B2 policy snapshot does not exactly match/i);
  } finally {
    await mismatch.cleanup();
  }

  const notReady = await makeDbFixture({ validationStatus: "INCOMPLETE" });
  try {
    const result = await storeModule!.persistC2Experiment(notReady.input);
    if (!("error" in result) || !result.error)
      throw new Error("Expected non-READY validation candidate to be rejected.");
    assert.match(result.error, /not READY/i);
  } finally {
    await notReady.cleanup();
  }
});