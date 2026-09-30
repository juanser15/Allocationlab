import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  allocationsTable,
  db,
  preparedInputsTable,
  pool,
  validationJobsTable,
  validationRunsTable,
} from "@workspace/db";
import { CreateValidationRunBody } from "@workspace/api-zod";
import { and, count, eq } from "drizzle-orm";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import {
  computeB3ValidationRun,
  persistPreparedB3ValidationRun,
} from "./b3-validation-store";
import {
  executeValidationJob,
  errorForValidationJob,
} from "./validation-job-runner";
import {
  claimValidationJob,
  completeValidationJobWithRun,
  failValidationJob,
  getValidationJob,
  heartbeatValidationJob,
  listValidationJobs,
  submitValidationJob,
} from "./validation-job-store";
import { getValidationRun } from "./validation-run-store";
import {
  PREPARED_INPUT_ENGINE_VERSION,
  fingerprint,
  prepareSnapshot,
} from "./prepared-inputs";
import type { PreparedSnapshot } from "./prepared-inputs";

after(async () => {
  await pool.end();
});

const tickers = ["ASY_A", "ASY_B", "ASY_C", "ASY_D", "ASY_E"];

function dateAt(day: number): string {
  return new Date(Date.UTC(2024, 0, 2 + day)).toISOString().slice(0, 10);
}

function priceAt(day: number, asset: number): number {
  return Number((100 + (day + 1) * (asset + 1) * 0.17 +
    Math.sin(day * (asset + 1)) * 2).toFixed(8));
}

function syntheticSnapshot(): PreparedSnapshot {
  const closeLines = [`Date,${tickers.join(",")}`];
  const ohlcLines = ["Date,Ticker,Open,High,Low,Close"];
  for (let day = 0; day < 430; day++) {
    const date = dateAt(day);
    const closes = tickers.map((_, asset) => priceAt(day, asset));
    closeLines.push([date, ...closes].join(","));
    for (let asset = 0; asset < tickers.length; asset++) {
      const close = closes[asset];
      const open = Number((close * (1 + Math.sin(day * 0.11 + asset) * 0.004)).toFixed(8));
      const high = Number((Math.max(open, close) * 1.002).toFixed(8));
      const low = Number((Math.min(open, close) * 0.998).toFixed(8));
      ohlcLines.push([date, tickers[asset], open, high, low, close].join(","));
    }
  }
  return prepareSnapshot({
    request: { representation: "asset_returns", assetTickers: tickers, factorIds: [], alphaDefinitions: [] },
    csvContent: closeLines.join("\n"),
    ohlcCsvContent: ohlcLines.join("\n"),
    factorVersion: "async-job-test-factor-v1",
    factors: [],
  });
}

const jsonRoundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function preparedFingerprint(snapshot: PreparedSnapshot): string {
  return fingerprint(jsonRoundTrip({
    request: snapshot.request,
    datasetHash: snapshot.dataset.sha256,
    ohlcDatasetHash: snapshot.dataset.ohlcSha256 ?? null,
    factorVersion: snapshot.factorSet.version,
    engineVersion: PREPARED_INPUT_ENGINE_VERSION,
  }));
}

async function createFrozenB3Fixture(snapshot: PreparedSnapshot) {
  const [prepared] = await db.insert(preparedInputsTable).values({
    representation: snapshot.representation,
    fingerprint: preparedFingerprint(snapshot),
    snapshot: jsonRoundTrip(snapshot),
  }).returning();

  const request: AllocationRequest = {
    preparedInputId: prepared.id,
    candidateIds: snapshot.candidates.map((candidate) => candidate.candidateId),
    informationCutoff: dateAt(140),
    decisionTimestamp: dateAt(141),
    estimationWindow: 40,
    minObservations: 30,
    representation: "asset_returns",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { min: 0, max: 0.25 } },
  };
  const result = optimizePreparedSnapshot(snapshot, request);
  assert.equal(result.status, "SOLVED", result.reason);

  const frozenSnapshot = jsonRoundTrip(snapshot);
  const frozenRequest = jsonRoundTrip(request);
  const frozenResult = jsonRoundTrip(result);
  const engineVersion = "async-job-test-b2-v1";
  const frozenSnapshotHash = fingerprint(frozenSnapshot);
  const allocationFingerprint = fingerprint({
    preparedInputId: prepared.id,
    representation: snapshot.representation,
    engineVersion,
    request: frozenRequest,
    snapshotHash: frozenSnapshotHash,
    result: frozenResult,
  });
  const [allocation] = await db.insert(allocationsTable).values({
    preparedInputId: prepared.id,
    representation: snapshot.representation,
    fingerprint: allocationFingerprint,
    frozenSnapshotHash,
    engineVersion,
    frozenRequest,
    frozenSnapshot,
    frozenResult,
  }).returning();

  return { prepared, allocation, request };
}

function assumptions(endIndex = 390) {
  return {
    evaluationStartDate: dateAt(42),
    evaluationEndDate: dateAt(endIndex),
    decisionCalendar: "monthly" as const,
    executionTiming: "next_open" as const,
    initialNav: 100_000,
    initialHoldings: {},
    initialCash: 100_000,
    transactionCostBps: 10,
    slippageBps: 5,
    dailyCashYield: 0,
  };
}

async function executeOwnedJob(jobId: string, owner: string): Promise<void> {
  const now = new Date();
  const [claimed] = await db.update(validationJobsTable).set({
    status: "running",
    phase: "test_owned_execution",
    attempts: 1,
    leaseOwner: owner,
    leaseExpiresAt: new Date(now.getTime() + 30 * 60_000),
    startedAt: now,
    updatedAt: now,
  }).where(and(eq(validationJobsTable.id, jobId), eq(validationJobsTable.status, "queued"))).returning();

  if (!claimed) return;
  try {
    await executeValidationJob(claimed, owner);
  } catch (error) {
    await failValidationJob(jobId, owner, errorForValidationJob(error));
  }
}

async function waitForTerminalJob(jobId: string, timeoutMs = 10 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const job = await getValidationJob(jobId);
    assert.ok(job, `job ${jobId} disappeared`);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`job ${jobId} did not reach a terminal state within ${timeoutMs}ms`);
}

test("PostgreSQL persists idempotent jobs, fenced leases, atomic runs, failures, and numerical parity", {
  timeout: 20 * 60_000,
}, async () => {
  const prefix = `async-job-test-${randomUUID()}`;
  const snapshot = syntheticSnapshot();
  const fixture = await createFrozenB3Fixture(snapshot);
  const request = CreateValidationRunBody.parse({
    allocationId: fixture.allocation.id,
    validationPreparedInputId: fixture.prepared.id,
    assumptions: assumptions(),
  }) as Extract<ReturnType<typeof CreateValidationRunBody.parse>, { allocationId: number }>;

  // This baseline is the existing synchronous B3 calculation against exactly
  // the same newly-created frozen inputs the asynchronous job will use.
  const synchronous = await computeB3ValidationRun(request);
  assert.ok(!("error" in synchronous), "synchronous B3 baseline must succeed");
  const synchronousResult = synchronous.resultJson.result;
  assert.ok(!("diagnostic" in synchronousResult), "synchronous B3 baseline must return a result");
  assert.equal(synchronousResult.status, "completed", JSON.stringify({
    status: synchronousResult.status,
    reason: synchronousResult.reason,
    decisions: synchronousResult.decisions.length,
  }));
  assert.ok(synchronousResult.dailyLedger.length > 300,
    "the successful parity fixture must cover more than 300 evaluation days");
  assert.equal(synchronous.reconciliationStatus, "pass");

  const requestKey = `${prefix}-successful-long-validation`;
  const submitted = await submitValidationJob(requestKey, request);
  assert.equal(submitted.conflict, false);
  assert.equal(submitted.job.status, "queued");
  const recovered = await getValidationJob(submitted.job.jobId);
  assert.ok(recovered);
  assert.equal(recovered.jobId, submitted.job.jobId, "a fresh read recovers the durable queued job");
  assert.equal((await listValidationJobs({ allocationId: fixture.allocation.id }))
    .some((job) => job.jobId === submitted.job.jobId), true, "the job is recoverable from its durable list");

  const duplicate = await submitValidationJob(requestKey, request);
  assert.equal(duplicate.job.jobId, submitted.job.jobId);
  assert.equal(duplicate.conflict, false);
  const conflicting = await submitValidationJob(requestKey, CreateValidationRunBody.parse({
    ...request,
    assumptions: { ...request.assumptions, transactionCostBps: request.assumptions.transactionCostBps + 1 },
  }));
  assert.equal(conflicting.job.jobId, submitted.job.jobId);
  assert.equal(conflicting.conflict, true, "reusing a key with different frozen inputs is rejected");

  // Run an explicit test-owned claimant if the API worker has not acquired the
  // job; if it has, simply reconnect to the same persisted status until done.
  const testOwner = `${prefix}-owner`;
  await executeOwnedJob(submitted.job.jobId, testOwner);
  const completed = await waitForTerminalJob(submitted.job.jobId);
  assert.equal(completed.status, "completed", completed.error?.message);
  assert.ok(completed.validationRunId);
  const saved = await getValidationRun(completed.validationRunId!);
  assert.ok(saved);
  assert.equal(saved.reconciliationStatus, "pass");
  assert.deepEqual(
    jsonRoundTrip(saved.result),
    jsonRoundTrip(synchronous.resultJson.result),
    "the asynchronous result must exactly match the existing synchronous calculation on the same frozen inputs",
  );

  const [linkedRuns] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.id, completed.validationRunId));
  assert.equal(linkedRuns.value, 1, "one completed job links to exactly one appended Validation Run");
  const afterReconnect = await getValidationJob(submitted.job.jobId);
  assert.equal(afterReconnect?.validationRunId, completed.validationRunId);
  const duplicateAfterCompletion = await submitValidationJob(requestKey, request);
  assert.equal(duplicateAfterCompletion.job.validationRunId, completed.validationRunId);
  assert.equal(duplicateAfterCompletion.job.status, "completed");
  const [runsAfterDuplicate] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.id, completed.validationRunId));
  assert.equal(runsAfterDuplicate.value, 1, "repeated submission must not append a duplicate run");

  // Inject a failure after the Validation Run insert but before job completion.
  // The transaction must roll back both sides and leave the lease claim intact.
  const rollbackOwner = `${prefix}-rollback-owner`;
  const rollbackNow = new Date();
  const rollbackJobId = randomUUID();
  const [rollbackClaimed] = await db.insert(validationJobsTable).values({
    id: rollbackJobId,
    idempotencyKey: `${prefix}-atomic-rollback`,
    requestHash: "test-only-atomic-rollback",
    request,
    frozenInputs: { kind: "b3", allocation: fixture.allocation, prepared: fixture.prepared },
    allocationId: fixture.allocation.id,
    status: "running",
    phase: "test_owned_rollback",
    attempts: 1,
    leaseOwner: rollbackOwner,
    leaseExpiresAt: new Date(rollbackNow.getTime() + 30 * 60_000),
    startedAt: rollbackNow,
    updatedAt: rollbackNow,
  }).returning();
  assert.ok(rollbackClaimed);
  const [beforeRollbackCount] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.validationInputHash, synchronous.validationInputHash));
  await assert.rejects(completeValidationJobWithRun(rollbackJobId, rollbackOwner, async (writer) => {
    const run = await persistPreparedB3ValidationRun(synchronous, writer);
    throw new Error(`intentional atomic rollback after inserting run ${run.run.validationRunId}`);
  }), /intentional atomic rollback/);
  const [afterRollbackCount] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.validationInputHash, synchronous.validationInputHash));
  assert.equal(afterRollbackCount.value, beforeRollbackCount.value, "the Validation Run insert rolls back with job completion");
  assert.equal((await getValidationJob(rollbackJobId))?.status, "running");
  await failValidationJob(rollbackJobId, rollbackOwner, {
    code: "TEST_FAILURE_PERSISTED",
    message: "This explicit test failure is saved after the atomic rollback.",
    httpStatus: 500,
  });
  const explicitlyFailed = await getValidationJob(rollbackJobId);
  assert.equal(explicitlyFailed?.status, "failed");
  assert.equal(explicitlyFailed?.error?.code, "TEST_FAILURE_PERSISTED");
  assert.match(explicitlyFailed?.error?.message ?? "", /explicit test failure/);

  // An expired lease is reclaimed, and a stale owner cannot heartbeat, persist,
  // or replace the result after the claim changes hands.
  const expiredAt = new Date(Date.now() - 60_000);
  const leaseJobId = randomUUID();
  const [expired] = await db.insert(validationJobsTable).values({
    id: leaseJobId,
    idempotencyKey: `${prefix}-lease-reclaim`,
    requestHash: "test-only-expired-lease",
    request,
    frozenInputs: { kind: "b3", allocation: fixture.allocation, prepared: fixture.prepared },
    allocationId: fixture.allocation.id,
    status: "running",
    phase: "interrupted",
    attempts: 1,
    leaseOwner: `${prefix}-stale-owner`,
    leaseExpiresAt: expiredAt,
    createdAt: new Date("2000-01-01T00:00:00.000Z"),
    startedAt: expiredAt,
    updatedAt: expiredAt,
  }).returning();
  assert.ok(expired);
  const reclaimOwner = `${prefix}-recovered-owner`;
  const reclaimed = await claimValidationJob(reclaimOwner);
  assert.equal(reclaimed?.id, leaseJobId);
  assert.equal(reclaimed?.attempts, 2);
  assert.equal(await heartbeatValidationJob(leaseJobId, `${prefix}-stale-owner`), false);
  const [runCountBeforeStaleCommit] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.validationInputHash, synchronous.validationInputHash));
  await assert.rejects(completeValidationJobWithRun(
    leaseJobId,
    `${prefix}-stale-owner`,
    async () => ({ validationRunId: -1 }),
  ), /lease was lost/);
  const [runCountAfterStaleCommit] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.validationInputHash, synchronous.validationInputHash));
  assert.equal(runCountAfterStaleCommit.value, runCountBeforeStaleCommit.value);
  await failValidationJob(leaseJobId, reclaimOwner, {
    code: "TEST_RECLAIMED_JOB_FAILED",
    message: "The reclaimed job records a useful terminal failure.",
    httpStatus: null,
  });
  assert.equal((await getValidationJob(leaseJobId))?.status, "failed");
  assert.equal((await getValidationJob(leaseJobId))?.error?.code, "TEST_RECLAIMED_JOB_FAILED");

  // Fixture records intentionally remain as isolated async-job-test evidence;
  // production/user snapshots and immutable Validation Runs are never edited
  // or deleted by this suite.
  assert.ok(rollbackClaimed.leaseOwner);
});

test("a pre-claimed invalid frozen-input job persists the worker's computation failure", {
  timeout: 2 * 60_000,
}, async () => {
  const prefix = `async-job-test-failure-${randomUUID()}`;
  const fixture = await createFrozenB3Fixture(syntheticSnapshot());
  const request = CreateValidationRunBody.parse({
    allocationId: fixture.allocation.id,
    validationPreparedInputId: fixture.prepared.id,
    assumptions: assumptions(),
  }) as Extract<ReturnType<typeof CreateValidationRunBody.parse>, { allocationId: number }>;

  const damagedSnapshot = jsonRoundTrip(fixture.prepared.snapshot) as PreparedSnapshot;
  damagedSnapshot.dataset.sha256 = `${damagedSnapshot.dataset.sha256}-tampered`;
  const [damagedPrepared] = await db.insert(preparedInputsTable).values({
    representation: damagedSnapshot.representation,
    fingerprint: fixture.prepared.fingerprint,
    snapshot: damagedSnapshot,
  }).returning();
  const damagedRequest = CreateValidationRunBody.parse({
    ...request,
    validationPreparedInputId: damagedPrepared.id,
  });
  const jobId = randomUUID();
  const owner = `${prefix}-test-worker`;
  const now = new Date();
  const [job] = await db.insert(validationJobsTable).values({
    id: jobId,
    idempotencyKey: `${prefix}-preclaimed`,
    requestHash: fingerprint(damagedRequest),
    request: damagedRequest,
    frozenInputs: {
      kind: "b3",
      allocation: fixture.allocation,
      prepared: damagedPrepared,
    },
    allocationId: fixture.allocation.id,
    status: "running",
    phase: "test_owned_execution",
    attempts: 1,
    leaseOwner: owner,
    leaseExpiresAt: new Date(now.getTime() + 30 * 60_000),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  }).returning();

  // Match the worker's error path while retaining explicit ownership of this
  // running fixture, so the live supervisor cannot claim a queued test job.
  try {
    await executeValidationJob(job, owner);
  } catch (error) {
    await failValidationJob(jobId, owner, errorForValidationJob(error));
  }

  const persisted = await getValidationJob(jobId);
  assert.equal(persisted?.status, "failed");
  assert.equal(persisted?.error?.code, "B3_VALIDATION_REJECTED");
  assert.match(persisted?.error?.message ?? "", /prepared-input fingerprint mismatch/i);
  assert.equal(persisted?.error?.httpStatus, 409);
  assert.equal(persisted?.validationRunId, null);
  const [runsForFixture] = await db.select({ value: count() }).from(validationRunsTable)
    .where(eq(validationRunsTable.allocationId, fixture.allocation.id));
  assert.equal(runsForFixture.value, 0, "frozen-input rejection must not persist a Validation Run");
});