import assert from "node:assert/strict";
import test, { after } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { C2ExperimentInput } from "@workspace/api-zod";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";
import type { AllocationRequest } from "./allocation-b2";

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

function buildCandidate(id: string, datasetHash: string, count: number, phase: number): PreparedCandidate {
  const returns = Array.from({ length: count - 1 }, (_, index) =>
    0.0004 + Math.sin(index * 1.39 + phase) * 0.0012 + Math.cos(index * 0.31) * 0.0002);
  const streamDates = returns.map((_, index) => dateAt(index + 1));
  return {
    candidateId: id,
    canonicalFingerprint: id,
    name: id,
    kind: "alpha_streams",
    status: "READY",
    reasons: [],
    factorId: "momentum",
    assetTickers: ["A"],
    mapping: "single_asset_long_cash",
    signalUnits: "oriented",
    targetAssetExposures: { A: 1 },
    actualAssetExposures: { A: 1 },
    targetHistory: streamDates.map((date, index) => ({
      signalDate: date,
      informationCutoff: dateAt(index),
      executionDate: date,
      targetPositions: { A: 1 },
    })),
    residualCash: 0,
    signalSeries: [],
    returnSeries: returns.map((value, index) => ({ date: streamDates[index], value })),
    ledger: returns.map((value, index) => ({
      date: streamDates[index],
      beginningNav: 1,
      netPnl: value,
      transactionCosts: 0.00001,
      grossReturn: value + 0.00001,
      externalTradedNotional: index / 1000,
      endingPositions: [{ ticker: "A", weight: 1 }],
    })),
    lineage: {
      datasetHash,
      definition: {
        name: id,
        factorId: "momentum",
        assetTickers: ["A"],
        mapping: "single_asset_long_cash",
        signalUnits: "oriented",
        threshold: 0.1 + phase,
        cashYieldAnnual: 0.025,
      },
    },
    diagnostics: { duplicateOf: null },
  } as unknown as PreparedCandidate;
}

function makeSnapshot(csvContent: string, datasetHash: string, count: number, candidateIds: [string, string]): PreparedSnapshot {
  return {
    schemaVersion: 1,
    engineVersion: "b1-c2-persistence-test",
    a1EngineVersion: "a1-c2-persistence-test",
    representation: "alpha_streams",
    dataset: {
      id: null,
      sha256: datasetHash,
      csvContent,
      startDate: dateAt(0),
      endDate: dateAt(count - 1),
      tickers: ["A", "B"],
      priceConvention: "test adjusted close",
    },
    factorSet: { version: "fixture-factor-set-1", factors: [] },
    request: {
      representation: "alpha_streams",
      assetTickers: ["A", "B"],
      factorIds: ["momentum"],
      alphaDefinitions: [],
    },
    coverage: {},
    candidates: [
      buildCandidate(candidateIds[0], datasetHash, count, 0),
      buildCandidate(candidateIds[1], datasetHash, count, 0.47),
    ],
    dependence: {},
    suppliedWeights: {},
    createdAt: "2020-01-01T00:00:00.000Z",
  };
}

function preparedFingerprint(snapshot: PreparedSnapshot, fingerprint: (value: unknown) => string): string {
  return fingerprint({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    factorVersion: snapshot.factorSet.version,
    engineVersion: snapshot.engineVersion,
  });
}

async function makeDbFixture(options: { mismatchAllocationSnapshot?: boolean; validationStatus?: string } = {}) {
  const { db, allocationsTable, preparedInputsTable, fingerprint, hashDataset } = await (async () => {
    const database = await modules();
    const { fingerprint: fp } = await import("./prepared-inputs");
    const { hashDataset: hash } = await import("./run-snapshot");
    return { ...database, fingerprint: fp, hashDataset: hash };
  })();
  const unique = ++fixtureSequence;
  const alphaIds: [string, string] = [`c2-db-${unique}-alpha-a`, `c2-db-${unique}-alpha-b`];
  const rows = ["date,A,B"];
  const observationCount = 110;
  for (let index = 0; index < observationCount; index++) {
    const a = 100 + index * 0.21 + Math.sin(index * 0.19) * 1.7;
    const b = 70 + index * 0.13 + Math.cos(index * 0.23) * 1.2;
    rows.push(`${dateAt(index)},${a.toFixed(8)},${b.toFixed(8)}`);
  }
  const csvContent = rows.join("\n");
  const datasetHash = hashDataset(csvContent);
  const snapshot = makeSnapshot(csvContent, datasetHash, observationCount, alphaIds);
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
    informationCutoff: dateAt(90),
    decisionTimestamp: dateAt(91),
    estimationWindow: 60,
    minObservations: 20,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0.0001,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: {},
  };
  const frozenSnapshot = structuredClone(snapshot);
  if (options.mismatchAllocationSnapshot)
    frozenSnapshot.candidates[0].lineage.datasetHash = "deliberately-mutated-frozen-b2-source";
  const frozenResult = {
    status: "SOLVED",
    candidateWeights: { [alphaIds[0]]: 0.5, [alphaIds[1]]: 0.5 },
    assetWeights: { A: 1 },
  };
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
    alphaIds: [...alphaIds],
    startDate: dateAt(1),
    endDate: dateAt(observationCount - 1),
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
      const { c2ExperimentsTable } = await modules();
      if (experimentId) await db.delete(c2ExperimentsTable).where(eq(c2ExperimentsTable.id, experimentId));
      await db.delete(allocationsTable).where(eq(allocationsTable.id, allocation.id));
      await db.delete(preparedInputsTable).where(inArray(preparedInputsTable.id, [policyRow.id, validationRow.id]));
    },
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