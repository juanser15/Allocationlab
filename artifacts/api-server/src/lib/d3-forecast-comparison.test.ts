import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  allocationsTable, d3ForecastComparisonsTable, db, pool, validationRunsTable,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { optimizePreparedSnapshot, type AllocationRequest } from "./allocation-b2";
import { persistB3ValidationRun } from "./b3-validation-store";
import { fingerprint } from "./prepared-inputs";
import {
  persistD3ForecastComparison, replayD3ForecastComparison, validateControlledForecastSources,
} from "./d3-forecast-comparison";

const TYPES = ["SAMPLE_MEAN", "SHRUNK_MEAN", "BAYESIAN_VIEWS"] as const;

function validationSources(overrides: Record<string, any> = {}) {
  const request = {
    representation: "alpha_streams",
    candidateIds: ["alpha-a", "alpha-b"],
    informationCutoff: "2024-01-31",
    decisionTimestamp: "2024-02-01",
    estimationWindow: 60,
    minObservations: 30,
    returnConvention: "daily_decimal",
    allocationMode: "CAPITAL_LONG_ONLY",
    riskModel: { type: "SAMPLE" },
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0.1 },
    constraints: { candidateBounds: { "alpha-a": { min: 0, max: 0.8 } } },
  };
  return TYPES.map((type, index) => {
    const change = overrides[type] ?? {};
    const frozenRequest = { ...request, ...change.request, forecastModel: { type } };
    return {
      type,
      allocation: {
        id: index + 1,
        frozenRequest,
        frozenSnapshotHash: change.snapshotHash ?? "same-frozen-b1",
      },
      allocationResult: { model: { dates: ["2023-12-01", "2023-12-04"] } },
      b3Envelope: change.b3Envelope,
    };
  });
}

test("D3 accepts three forecast identities while requiring every non-forecast input to match", () => {
  assert.doesNotThrow(() => validateControlledForecastSources(validationSources() as any));
  assert.throws(() => validateControlledForecastSources(
    validationSources({ SHRUNK_MEAN: { request: { objective: { type: "minimum_variance", gamma: 1, eta: 0 } } } }) as any),
  /must match exactly/);
  assert.throws(() => validateControlledForecastSources(
    validationSources({ BAYESIAN_VIEWS: { request: { candidateIds: ["alpha-b", "alpha-a"] } } }) as any),
  /must match exactly/);
});

test("D3 controlled comparison rejects legacy runs and partial B3 child sets", () => {
  const legacy = validationSources() as any[];
  delete legacy[0].allocation.frozenRequest.forecastModel;
  assert.throws(() => validateControlledForecastSources(legacy), /explicit matching forecastModel.type/);

  const partialB3 = validationSources() as any[];
  partialB3[0].b3Envelope = {};
  assert.throws(() => validateControlledForecastSources(partialB3), /all three/);
});

test("D3 controlled comparison requires identical B3 data and assumptions", () => {
  const sources = validationSources() as any[];
  for (const source of sources) source.b3Envelope = {
    validationSnapshot: { dataset: { sha256: "evaluation-data" } },
    assumptions: { evaluationStartDate: "2024-02-01", evaluationEndDate: "2024-03-01", transactionCostBps: 5 },
    estimationDatePlan: ["2024-02-01"],
  };
  assert.doesNotThrow(() => validateControlledForecastSources(sources));
  sources[2].b3Envelope.assumptions.transactionCostBps = 6;
  assert.throws(() => validateControlledForecastSources(sources), /B3 evaluation datasets/);
});

test("D3 saves and replays a database-backed trio of frozen B2/B3 sources", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const allocations = await db.select().from(allocationsTable).orderBy(desc(allocationsTable.id));
  let fixture: {
    allocation: typeof allocationsTable.$inferSelect;
    validation: typeof validationRunsTable.$inferSelect;
  } | undefined;
  for (const allocation of allocations) {
    const request = allocation.frozenRequest as any;
    const result = allocation.frozenResult as any;
    if (allocation.representation !== "alpha_streams" || !Array.isArray(request?.candidateIds) ||
        request.candidateIds.length < 2 || result?.status !== "SOLVED") continue;
    const children = await db.select().from(validationRunsTable)
      .where(eq(validationRunsTable.allocationId, allocation.id)).orderBy(desc(validationRunsTable.id));
    const validation = children.find((row) => {
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

  const allocationIds: number[] = [];
  const validationRunIds: number[] = [];
  const comparisonIds: number[] = [];
  try {
    const base = fixture.allocation;
    const baseRequest = structuredClone(base.frozenRequest) as AllocationRequest & Record<string, any>;
    const snapshot = structuredClone(base.frozenSnapshot) as Parameters<typeof optimizePreparedSnapshot>[0];
    const ids: {
      allocationIds: Record<(typeof TYPES)[number], number>;
      validationRunIds: Record<(typeof TYPES)[number], number>;
    } = { allocationIds: {} as any, validationRunIds: {} as any };
    const envelope = fixture.validation.resultJson as any;
    for (const type of TYPES) {
      const forecastModel = type === "SAMPLE_MEAN"
        ? { type: "SAMPLE_MEAN" as const }
        : type === "SHRUNK_MEAN"
          ? { type: "SHRUNK_MEAN" as const, shrinkage: 0.35 }
          : {
            type: "BAYESIAN_VIEWS" as const,
            priorMean: { source: "SAMPLE_PRIOR" as const },
            priorUncertainty: { type: "TAU_SIGMA" as const, tau: 0.02 },
            views: [{
              type: "ABSOLUTE" as const,
              candidateId: baseRequest.candidateIds[0],
              q: 0.0001,
              variance: 0.0001,
              effectiveTimestamp: "1900-01-01",
              availabilityTimestamp: "1900-01-01",
            }],
          };
      const request = { ...structuredClone(baseRequest), forecastModel };
      const result = optimizePreparedSnapshot(snapshot, request);
      assert.equal(result.status, "SOLVED", `${type} frozen B2 replay fixture did not solve`);
      const frozenSnapshotHash = fingerprint(snapshot);
      const engineVersion = `allocation-b2-api.1; ${result.solver.name}@${result.solver.version}`;
      const allocationFingerprint = fingerprint({
        preparedInputId: base.preparedInputId, representation: base.representation,
        engineVersion, request, snapshotHash: frozenSnapshotHash, result,
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
      const persisted = await persistB3ValidationRun({
        allocationId: allocation.id,
        validationPreparedInputId: fixture.validation.validationPreparedInputId!,
        assumptions: envelope.assumptions,
      });
      assert.ok("run" in persisted && persisted.run,
        `${type} B3 child did not persist: ${"error" in persisted ? persisted.error : ""}`);
      assert.equal(persisted.run.reconciliationStatus, "pass");
      validationRunIds.push(persisted.run.validationRunId);
      ids.allocationIds[type] = allocation.id;
      ids.validationRunIds[type] = persisted.run.validationRunId;
    }

    const saved = await persistD3ForecastComparison(ids);
    comparisonIds.push(saved.id);
    const forecasts = (saved.result as any).forecasts;
    assert.deepEqual(Object.keys(forecasts).sort(), [...TYPES].sort());
    assert.equal((saved.manifest as any).classification, "CONTROLLED_FORECAST_ESTIMATOR_COMPARISON");
    assert.equal((saved.result as any).comparisonClassification, "CONTROLLED_FORECAST_ESTIMATOR_COMPARISON");
    assert.ok(!("winner" in (saved.result as any)) && !("ranking" in (saved.result as any)));
    for (const type of TYPES) {
      assert.equal(forecasts[type].forecastModel.type, type);
      assert.deepEqual(forecasts[type].candidateIds, baseRequest.candidateIds);
      assert.ok("muHat" in forecasts[type]);
      assert.ok("V_mu" in forecasts[type]);
      assert.ok("expectedReturn" in forecasts[type]);
      assert.ok("expectedRisk" in forecasts[type]);
      assert.ok("grossExposure" in forecasts[type]);
      assert.ok("netExposure" in forecasts[type]);
      assert.ok(forecasts[type].realizedMetrics);
    }
    const replay = await replayD3ForecastComparison(saved.id);
    assert.ok(replay);
    assert.equal(replay.status, "pass", replay.differences.join("\n"));
    assert.deepEqual(replay.differences, []);
    assert.ok(replay.maximumNumericDifference <= 1e-8);

    const withoutB3 = await persistD3ForecastComparison({ allocationIds: ids.allocationIds });
    comparisonIds.push(withoutB3.id);
    assert.ok(Object.values((withoutB3.result as any).forecasts)
      .every((forecast: any) => forecast.validationRunId === null && forecast.realizedMetrics === null));
    const b2OnlyReplay = await replayD3ForecastComparison(withoutB3.id);
    assert.equal(b2OnlyReplay?.status, "pass", b2OnlyReplay?.differences.join("\n"));
    assert.ok((b2OnlyReplay?.maximumNumericDifference ?? Infinity) <= 1e-8);
  } finally {
    if (comparisonIds.length)
      await db.delete(d3ForecastComparisonsTable).where(inArray(d3ForecastComparisonsTable.id, comparisonIds));
    if (validationRunIds.length)
      await db.delete(validationRunsTable).where(inArray(validationRunsTable.id, validationRunIds));
    if (allocationIds.length)
      await db.delete(allocationsTable).where(inArray(allocationsTable.id, allocationIds));
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await pool.end();
});