import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  allocationsTable, db, d2AllocationModeComparisonsTable, pool, validationRunsTable,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import { persistB3ValidationRun } from "./b3-validation-store";
import { fingerprint } from "./prepared-inputs";
import {
  getD2AllocationModeComparison,
  persistD2AllocationModeComparison,
  replayD2AllocationModeComparison,
  validateMatchingSources,
} from "./d2-allocation-mode-comparison";

function sources(overrides: Record<string, any> = {}) {
  const request = {
    preparedInputId: 1,
    representation: "alpha_streams",
    candidateIds: ["alpha-a", "alpha-b"],
    informationCutoff: "2024-01-31",
    decisionTimestamp: "2024-02-01",
    estimationWindow: 60,
    minObservations: 30,
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0.2,
    covarianceDiagonalShrinkage: 0,
    riskModel: { type: "SAMPLE" },
    dailyCashYield: 0.0001,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.1 },
    constraints: { candidateBounds: { "alpha-a": { min: 0, max: 1 } } },
  };
  const evaluationAssumptions = {
    evaluationStartDate: "2024-02-02",
    evaluationEndDate: "2024-03-29",
    decisionCalendar: "monthly",
    executionTiming: "next_close",
    initialNav: 1,
    initialCash: 1,
    initialHoldings: {},
    transactionCostBps: 5,
    slippageBps: 2,
    dailyCashYield: 0.0001,
  };
  return (["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"] as const).map((mode) => {
    const replacement = overrides[mode] ?? {};
    const modeRequest = {
      ...request,
      ...replacement.request,
      allocationMode: mode,
      ...(mode === "SIGNED_OVERLAY" ? {
        signedConstraints: { alphaBounds: { "alpha-a": { min: -0.4, max: 0.5 } }, grossAlphaMax: 1.5 },
        objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.05 },
      } : {}),
    };
    return {
      mode,
      allocation: {
        id: mode === "CAPITAL_LONG_ONLY" ? 11 : 12,
        frozenRequest: modeRequest,
        frozenSnapshot: { dataset: { sha256: replacement.datasetHash ?? "b1-data-hash" } },
      },
      allocationResult: {
        model: { dates: ["2023-12-01", "2023-12-04", "2023-12-05"] },
      },
      b3Envelope: {
        validationSnapshot: { dataset: { sha256: replacement.evaluationDatasetHash ?? "b3-data-hash" } },
        assumptions: { ...evaluationAssumptions, ...replacement.assumptions },
      },
    };
  });
}

test("D2 comparison accepts matched sources despite objective and constraint differences", () => {
  assert.doesNotThrow(() => validateMatchingSources(sources() as any));
});

test("D2 comparison requires the two distinct allocation modes", () => {
  const duplicate = sources() as any[];
  duplicate[1].mode = "CAPITAL_LONG_ONLY";
  assert.throws(() => validateMatchingSources(duplicate), /exactly one CAPITAL_LONG_ONLY run and one SIGNED_OVERLAY run/);
});

test("D2 comparison rejects changes to universe, source data, estimator, dates, risk model, and B3 costs", () => {
  const changes = [
    { SIGNED_OVERLAY: { request: { candidateIds: ["alpha-a", "alpha-c"] } } },
    { SIGNED_OVERLAY: { datasetHash: "different-b1-data" } },
    { SIGNED_OVERLAY: { request: { expectedReturnShrinkage: 0.3 } } },
    { SIGNED_OVERLAY: { request: { informationCutoff: "2024-02-01" } } },
    { SIGNED_OVERLAY: { request: { riskModel: { type: "DIAGONAL_SHRINKAGE" }, covarianceDiagonalShrinkage: 0.2 } } },
    { SIGNED_OVERLAY: { evaluationDatasetHash: "different-b3-data" } },
    { SIGNED_OVERLAY: { assumptions: { transactionCostBps: 6 } } },
    { SIGNED_OVERLAY: { assumptions: { evaluationEndDate: "2024-03-28" } } },
  ];
  for (const change of changes)
    assert.throws(() => validateMatchingSources(sources(change) as any), /D2 comparison rejected/);

  const changedEstimationPlan = sources() as any[];
  changedEstimationPlan[1].b3Envelope.estimationDatePlan = ["2023-12-02"];
  assert.throws(() => validateMatchingSources(changedEstimationPlan), /D2 comparison rejected/);
});

test("D2 B3 execution and cost assumptions must be an exact match", () => {
  const mismatched = sources() as any[];
  mismatched[1].b3Envelope.assumptions.slippageBps = 3;
  assert.throws(() => validateMatchingSources(mismatched), /execution\/cost assumptions/);
});

test("D2 persists and replays matched saved capital and signed B2/B3 runs", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const savedAllocations = await db.select().from(allocationsTable).orderBy(desc(allocationsTable.id));
  let fixture: {
    allocation: typeof allocationsTable.$inferSelect;
    validation: typeof validationRunsTable.$inferSelect;
  } | undefined;
  for (const allocation of savedAllocations) {
    const request = allocation.frozenRequest as any;
    if (allocation.representation !== "alpha_streams" ||
        (request?.allocationMode !== undefined && request.allocationMode !== "CAPITAL_LONG_ONLY") ||
        !Array.isArray(request.candidateIds) || request.candidateIds.length < 1 ||
        (allocation.frozenResult as any)?.status !== "SOLVED") continue;
    const validationRuns = await db.select().from(validationRunsTable)
      .where(eq(validationRunsTable.allocationId, allocation.id))
      .orderBy(desc(validationRunsTable.id));
    const validation = validationRuns.find((row) => {
      const envelope = row.resultJson as any;
      return row.reconciliationStatus === "pass" && envelope?.kind === "b3" &&
        fingerprint(envelope.policyRequest) === fingerprint(allocation.frozenRequest);
    });
    if (validation) {
      fixture = { allocation, validation };
      break;
    }
  }
  if (!fixture) {
    t.skip("No saved CAPITAL_LONG_ONLY alpha-stream B2 run with a successful matching B3 child is available.");
    return;
  }

  const allocationIds: number[] = [];
  const validationRunIds: number[] = [];
  let comparisonId: number | undefined;
  try {
    const base = fixture.allocation;
    const baseRequest = structuredClone(base.frozenRequest) as AllocationRequest;
    const snapshot = structuredClone(base.frozenSnapshot) as Parameters<typeof optimizePreparedSnapshot>[0];
    const { signedConstraints: _signedConstraints, targetExcessReturn: _targetExcessReturn, ...capitalBase } =
      baseRequest as AllocationRequest & { signedConstraints?: unknown; targetExcessReturn?: unknown };
    const commonRequest = {
      ...capitalBase,
      allocationMode: "CAPITAL_LONG_ONLY" as const,
      riskModel: { type: "SAMPLE" as const },
      covarianceDiagonalShrinkage: 0,
    };
    const requests: Record<"CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY", AllocationRequest> = {
      CAPITAL_LONG_ONLY: commonRequest,
      SIGNED_OVERLAY: {
        ...structuredClone(commonRequest),
        allocationMode: "SIGNED_OVERLAY",
        objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.1 },
        constraints: {},
        signedConstraints: {
          alphaBounds: Object.fromEntries(commonRequest.candidateIds.map((candidateId) =>
            [candidateId, { min: -0.3, max: 0.3 }])),
          grossAlphaMax: Math.max(1, commonRequest.candidateIds.length * 0.3),
        },
      },
    };
    const ids = {
      allocationIds: {} as Record<"CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY", number>,
      validationRunIds: {} as Record<"CAPITAL_LONG_ONLY" | "SIGNED_OVERLAY", number>,
    };
    const savedEnvelope = fixture.validation.resultJson as any;
    for (const mode of ["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"] as const) {
      const request = requests[mode];
      const result = optimizePreparedSnapshot(snapshot, request);
      assert.equal(result.status, "SOLVED", `${mode} B2 failed: ${result.reason}`);
      const frozenSnapshotHash = fingerprint(snapshot);
      const engineVersion = `allocation-b2-api.1; ${result.solver.name}@${result.solver.version}`;
      const allocationFingerprint = fingerprint({
        preparedInputId: base.preparedInputId,
        representation: base.representation,
        engineVersion,
        request,
        snapshotHash: frozenSnapshotHash,
        result,
      });
      const [allocation] = await db.insert(allocationsTable).values({
        preparedInputId: base.preparedInputId,
        representation: "alpha_streams",
        fingerprint: allocationFingerprint,
        frozenSnapshotHash,
        engineVersion,
        frozenRequest: request,
        frozenSnapshot: snapshot,
        frozenResult: result,
      }).returning();
      allocationIds.push(allocation.id);
      ids.allocationIds[mode] = allocation.id;

      const persisted = await persistB3ValidationRun({
        allocationId: allocation.id,
        validationPreparedInputId: fixture.validation.validationPreparedInputId!,
        assumptions: savedEnvelope.assumptions,
      });
      assert.ok("run" in persisted && persisted.run, `${mode} B3 child failed to persist: ${"error" in persisted ? persisted.error : ""}`);
      assert.equal(persisted.run.reconciliationStatus, "pass");
      validationRunIds.push(persisted.run.validationRunId);
      ids.validationRunIds[mode] = persisted.run.validationRunId;
    }

    const comparison = await persistD2AllocationModeComparison(ids);
    comparisonId = comparison.id;
    assert.equal((comparison.result as any).comparisonClassification, "NON_CONTROLLED_ECONOMIC_COMPARISON");
    assert.match((comparison.result as any).semanticDifferences.interpretation, /does not declare a winner/);
    assert.ok((comparison.manifest as any).sourceIdentities.CAPITAL_LONG_ONLY);
    assert.ok((comparison.manifest as any).sourceIdentities.SIGNED_OVERLAY);
    assert.equal((await getD2AllocationModeComparison(comparisonId))?.manifestHash, comparison.manifestHash);

    const replay = await replayD2AllocationModeComparison(comparisonId);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
    assert.deepEqual(replay.differences, []);
    assert.ok(replay.maximumNumericDifference <= 1e-8);
  } finally {
    if (comparisonId)
      await db.delete(d2AllocationModeComparisonsTable)
        .where(eq(d2AllocationModeComparisonsTable.id, comparisonId));
    if (validationRunIds.length)
      await db.delete(validationRunsTable).where(inArray(validationRunsTable.id, validationRunIds));
    if (allocationIds.length)
      await db.delete(allocationsTable).where(inArray(allocationsTable.id, allocationIds));
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await pool.end();
});