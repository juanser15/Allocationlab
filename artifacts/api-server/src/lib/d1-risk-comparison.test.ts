import assert from "node:assert/strict";
import test, { after } from "node:test";
import { allocationsTable, db, d1RiskComparisonsTable, pool, preparedInputsTable, validationRunsTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { optimizePreparedSnapshot, type AllocationRequest, type AllocationResult } from "./allocation-b2";
import { persistB3ValidationRun, replayB3ValidationRun } from "./b3-validation-store";
import { fingerprint } from "./prepared-inputs";
import {
  getD1RiskModelComparison, persistD1RiskModelComparison, replayD1RiskModelComparison,
  validateControlledRiskSources,
} from "./d1-risk-comparison";

const riskModels = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"] as const;

function sources(overrides: Record<string, any> = {}) {
  const commonRequest = {
    preparedInputId: 10,
    candidateIds: ["alpha-a", "alpha-b"],
    representation: "alpha_streams",
    informationCutoff: "2024-01-31",
    decisionTimestamp: "2024-02-01",
    estimationWindow: 60,
    minObservations: 30,
    expectedReturnShrinkage: 0.2,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0.0001,
    objective: { type: "minimum_variance", gamma: 1, eta: 0 },
    constraints: { totalCash: { max: 0.25 }, candidateBounds: { "alpha-a": { max: 0.7 } } },
  };
  const commonAssumptions = {
    evaluationStartDate: "2024-02-02", evaluationEndDate: "2024-03-29",
    decisionCalendar: "monthly", executionTiming: "next_close",
    initialNav: 1, initialCash: 1, initialHoldings: {},
    transactionCostBps: 5, slippageBps: 2, dailyCashYield: 0.0001,
  };
  const policySnapshot = { representation: "alpha_streams", snapshotId: "frozen-b1" };
  const validationSnapshot = { dataset: { sha256: "same-evaluation-data" } };
  return riskModels.map((riskType, index) => {
    const request = {
      ...commonRequest,
      riskModel: riskType === "STATISTICAL_FACTOR"
        ? { type: riskType, factorCount: 1, specificRiskFloorFraction: 1e-6 }
        : { type: riskType },
      covarianceDiagonalShrinkage: riskType === "DIAGONAL_SHRINKAGE" ? 0.2 : 0,
      ...((overrides as any)[riskType]?.request ?? {}),
    };
    const assumptions = {
      ...commonAssumptions, ...((overrides as any)[riskType]?.assumptions ?? {}),
    };
    return {
      slot: riskType,
      riskType,
      allocation: {
        id: index + 1,
        frozenRequest: request,
        frozenSnapshotHash: "same-b1-snapshot-hash",
        frozenResult: { model: { dates: ["2024-01-01", "2024-01-02"] } },
      },
      allocationResult: { status: "SOLVED", model: { dates: ["2024-01-01", "2024-01-02"] } },
      validationRun: { id: index + 1 },
      b3Envelope: { policySnapshot, validationSnapshot, assumptions, estimationDatePlan: null },
    };
  });
}

test("D1 T6 accepts exactly three estimators with identical non-risk-model assumptions", () => {
  assert.doesNotThrow(() => validateControlledRiskSources(sources() as any));
});

test("D1 T6 recognizes equivalent UTC decision instants and absent empty constraint groups", () => {
  const equivalent = sources() as any[];
  equivalent[2].allocation.frozenRequest.decisionTimestamp = "2024-02-01T00:00:00.000Z";
  equivalent[2].allocation.frozenRequest.constraints = {
    ...equivalent[2].allocation.frozenRequest.constraints,
    candidateBounds: { "alpha-a": { max: 0.7 } },
    assetBounds: {}, groupCaps: [], unsupported: [],
  };
  assert.doesNotThrow(() => validateControlledRiskSources(equivalent as any));
});

test("D1 T6 rejects changed costs, dates, expected-return assumptions, constraints, and objective", () => {
  const mismatches = [
    { DIAGONAL_SHRINKAGE: { assumptions: { transactionCostBps: 6 } } },
    { DIAGONAL_SHRINKAGE: { request: { informationCutoff: "2024-02-01" } } },
    { DIAGONAL_SHRINKAGE: { request: { expectedReturnShrinkage: 0.3 } } },
    { DIAGONAL_SHRINKAGE: { request: { constraints: { totalCash: { max: 0.4 } } } } },
    { DIAGONAL_SHRINKAGE: { request: { objective: { type: "minimum_variance", gamma: 2, eta: 0 } } } },
  ];
  for (const mismatch of mismatches)
    assert.throws(() => validateControlledRiskSources(sources(mismatch) as any), /Controlled comparison rejected/);
});

test("D1 controlled comparison requires the complete, non-duplicated estimator trio", () => {
  assert.throws(() => validateControlledRiskSources(sources().slice(0, 2) as any), /exactly one/);
  const mismatched = sources() as any[];
  mismatched[2].riskType = "SAMPLE";
  assert.throws(() => validateControlledRiskSources(mismatched as any), /exactly one/);
});

test("D1 comparison freezes three real B2/B3 estimators and replays all children", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const allocationRows = await db.select().from(allocationsTable).orderBy(desc(allocationsTable.id));
  let fixture: { allocation: typeof allocationsTable.$inferSelect; validation: typeof validationRunsTable.$inferSelect } | undefined;
  for (const allocation of allocationRows) {
    const request = allocation.frozenRequest as any;
    const result = allocation.frozenResult as any;
    if (allocation.representation !== "alpha_streams" || !Array.isArray(request?.candidateIds) ||
        request.candidateIds.length < 3 || result?.status !== "SOLVED") continue;
    const validationRows = await db.select().from(validationRunsTable)
      .where(eq(validationRunsTable.allocationId, allocation.id)).orderBy(desc(validationRunsTable.id));
    const validation = validationRows.find((row) => {
      const envelope = row.resultJson as any;
      return row.reconciliationStatus === "pass" && envelope?.kind === "b3" &&
        JSON.stringify(envelope.policyRequest) === JSON.stringify(request);
    });
    if (validation) {
      fixture = { allocation, validation };
      break;
    }
  }
  if (!fixture) {
    t.skip("No saved alpha-stream B2 policy with a matching successful B3 child is available.");
    return;
  }

  const createdAllocationIds: number[] = [];
  const createdValidationRunIds: number[] = [];
  let comparisonId: number | undefined;
  try {
    const base = fixture.allocation;
    const baseRequest = structuredClone(base.frozenRequest) as AllocationRequest;
    const snapshot = structuredClone(base.frozenSnapshot) as Parameters<typeof optimizePreparedSnapshot>[0];
    const policyRequest: AllocationRequest = {
      ...baseRequest,
      objective: { ...baseRequest.objective, eta: Math.max(baseRequest.objective.eta, 0.1) },
      riskModel: { type: "SAMPLE" },
      covarianceDiagonalShrinkage: 0,
    };
    const requests: Record<(typeof riskModels)[number], AllocationRequest> = {
      SAMPLE: { ...structuredClone(policyRequest), riskModel: { type: "SAMPLE" }, covarianceDiagonalShrinkage: 0 },
      DIAGONAL_SHRINKAGE: {
        ...structuredClone(policyRequest), riskModel: { type: "DIAGONAL_SHRINKAGE" },
        covarianceDiagonalShrinkage: 0.5,
      },
      STATISTICAL_FACTOR: {
        ...structuredClone(policyRequest),
        riskModel: { type: "STATISTICAL_FACTOR", factorCount: 1, specificRiskFloorFraction: 1e-6 },
        covarianceDiagonalShrinkage: 0,
      },
    };
    const ids: any = { allocationIds: {}, validationRunIds: {} };
    const envelope = fixture.validation.resultJson as any;
    for (const riskType of riskModels) {
      const request = requests[riskType];
      const result = optimizePreparedSnapshot(snapshot, request);
      assert.equal(result.status, "SOLVED", `${riskType} B2 failed: ${result.reason}`);
      const snapshotHash = fingerprint(snapshot);
      const engineVersion = `allocation-b2-api.1; ${result.solver.name}@${result.solver.version}`;
      const allocationFingerprint = fingerprint({
        preparedInputId: base.preparedInputId, representation: base.representation,
        engineVersion, request, snapshotHash, result,
      });
      const [allocation] = await db.insert(allocationsTable).values({
        preparedInputId: base.preparedInputId, representation: "alpha_streams",
        fingerprint: allocationFingerprint, frozenSnapshotHash: snapshotHash, engineVersion,
        frozenRequest: request, frozenSnapshot: snapshot, frozenResult: result,
      }).returning();
      createdAllocationIds.push(allocation.id);
      const persisted = await persistB3ValidationRun({
        allocationId: allocation.id,
        validationPreparedInputId: fixture.validation.validationPreparedInputId!,
        assumptions: envelope.assumptions,
      });
      assert.ok("run" in persisted && persisted.run, "B3 child must persist");
      assert.equal(persisted.run.reconciliationStatus, "pass");
      createdValidationRunIds.push(persisted.run.validationRunId);
      ids.allocationIds[riskType] = allocation.id;
      ids.validationRunIds[riskType] = persisted.run.validationRunId;
    }

    const comparison = await persistD1RiskModelComparison(ids);
    comparisonId = comparison.id;
    assert.equal(Object.keys((comparison.result as any).models).length, 3);
    assert.equal((comparison.result as any).pairwiseDistances.length, 3);
    const result = comparison.result as any;
    const savedAllocations = await db.select().from(allocationsTable)
      .where(inArray(allocationsTable.id, createdAllocationIds));
    for (const riskType of riskModels) {
      const modelResult = result.models[riskType];
      const allocation = savedAllocations.find((item) => item.id === ids.allocationIds[riskType])!;
      const solved = allocation.frozenResult as AllocationResult;
      const weights = (solved.model!.candidateIds).map((id) => solved.candidateWeights![id]);
      const covariance = solved.model!.sigma;
      const independentVariance = weights.reduce((sum, left, i) =>
        sum + left * weights.reduce((inner, right, j) => inner + right * covariance[i][j], 0), 0);
      assert.ok(Math.abs(modelResult.expectedDailyVolatility - Math.sqrt(independentVariance)) <= 1e-8,
        `${riskType} reported expected risk differs from its frozen covariance and weights`);
      assert.deepEqual(modelResult.candidateIds, solved.model!.candidateIds);
    }
    for (const pair of result.pairwiseDistances) {
      const left = result.models[pair.left], right = result.models[pair.right];
      const distance = (a: Record<string, number>, b: Record<string, number>) =>
        0.5 * [...new Set([...Object.keys(a), ...Object.keys(b)])]
          .reduce((sum, id) => sum + Math.abs((a[id] ?? 0) - (b[id] ?? 0)), 0);
      assert.ok(Math.abs(pair.alphaWeightDistance -
        distance(left.alphaWeights, right.alphaWeights)) <= 1e-8);
      assert.ok(Math.abs(pair.underlyingAssetWeightDistance -
        distance(left.underlyingAssetWeights, right.underlyingAssetWeights)) <= 1e-8);
      assert.ok(Math.abs(pair.expectedDailyVolatilityDifference -
        (left.expectedDailyVolatility - right.expectedDailyVolatility)) <= 1e-8);
    }
    assert.deepEqual((await getD1RiskModelComparison(comparisonId))?.manifestHash, comparison.manifestHash);
    for (const validationRunId of createdValidationRunIds) {
      const replay = await replayB3ValidationRun(validationRunId);
      assert.equal(replay?.status, "pass", replay?.differences.join("\n"));
    }
    const replay = await replayD1RiskModelComparison(comparisonId);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
    assert.deepEqual(replay.differences, []);
    assert.ok((replay.maximumNumericDifference ?? Infinity) <= 1e-8);
  } finally {
    if (comparisonId)
      await db.delete(d1RiskComparisonsTable).where(eq(d1RiskComparisonsTable.id, comparisonId));
    if (createdValidationRunIds.length)
      await db.delete(validationRunsTable).where(inArray(validationRunsTable.id, createdValidationRunIds));
    if (createdAllocationIds.length)
      await db.delete(allocationsTable).where(inArray(allocationsTable.id, createdAllocationIds));
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await pool.end();
});