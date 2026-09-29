import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test, { after } from "node:test";
import { allocationsTable, db, pool, preparedInputsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./allocations";
import type { PreparedSnapshot } from "../lib/prepared-inputs";
import { fingerprint } from "../lib/prepared-inputs";
import { hashDataset } from "../lib/run-snapshot";
import { optimizePreparedSnapshot, type AllocationRequest } from "../lib/allocation-b2";
import { persistB3ValidationRun } from "../lib/b3-validation-store";

const routeCostAware = {
  costAmortizationDays: 20,
  turnoverPreferenceBps: 0,
  transactionCostBps: 5,
  slippageBps: 2,
  holdings: { asOf: "2024-01-08", quantities: { first: 2, second: 0 }, cash: 10, nav: 100 },
};

test("allocation route retires legacy costAware and validates simple rebalance settings", async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = `http://127.0.0.1:${address.port}`;
  const base = {
    preparedInputId: 1,
    candidateIds: ["first"],
    informationCutoff: "2024-01-08",
    decisionTimestamp: "2024-01-08",
    estimationWindow: 8,
    minObservations: 3,
    representation: "alpha_streams",
    returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0,
    covarianceDiagonalShrinkage: 0,
    dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
    constraints: {},
  };
  try {
    const cases = [
      { name: "legacy costAware L1 request", patch: { costAware: routeCostAware } },
      { name: "legacy costAware even with invalid settings", patch: {
        costAware: { ...routeCostAware, costAmortizationDays: 0, unexpected: true },
      } },
    ];
    for (const item of cases) {
      const response = await fetch(`${api}/allocations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, ...item.patch }),
      });
      const body = await response.json() as { error?: string };
      assert.equal(response.status, 422, `${item.name}: ${JSON.stringify(body)}`);
      assert.match(body.error ?? "", /costAware L1 method is retired/);
    }
    const regularized = { lambdaR: 1, holdings: {
      asOf: "2024-01-08", quantities: { first: 2 }, cash: 10, nav: 100,
    } };
    const invalidCases = [
      { name: "negative lambda", patch: { rebalanceRegularization: { lambdaR: -1 } } },
      { name: "missing positive-lambda holdings", patch: { rebalanceRegularization: { lambdaR: 1 } } },
      { name: "holdings cutoff mismatch", patch: { rebalanceRegularization: {
        ...regularized, holdings: { ...regularized.holdings, asOf: "2024-01-07" },
      } } },
      { name: "unsupported minimum-variance objective", patch: {
        objective: { type: "minimum_variance", gamma: 2, eta: 0.02 },
        rebalanceRegularization: regularized,
      } },
      { name: "legacy and simple methods stacked", patch: {
        costAware: routeCostAware, rebalanceRegularization: regularized,
      } },
    ];
    for (const item of invalidCases) {
      const response = await fetch(`${api}/allocations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, ...item.patch }),
      });
      const body = await response.json() as { error?: string };
      assert.equal(response.status, item.name.includes("stacked") ? 422 : 400,
        `${item.name}: ${JSON.stringify(body)}`);
      if (item.name.includes("stacked")) assert.match(body.error ?? "", /cannot be combined/);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

function dateAt(index: number): string {
  return new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
}

function makeSnapshot(): PreparedSnapshot {
  const firstReturns = [-1, 1, 0, -1, 1, 0, -1, 1].map((value) => 0.02 + value * 0.1);
  const secondReturns = [1, 1, -2, 1, 1, -2, 1, 1]
    .map((value) => 0.005 + value * 0.2);
  const datasetContent = [
    "date,A,B",
    ...Array.from({ length: 8 }, (_, i) => `${dateAt(i)},${100 + i},${200 + i}`),
  ].join("\n");
  const candidates = [
    { candidateId: "first", name: "First", returns: firstReturns, ticker: "A" },
    { candidateId: "second", name: "Second", returns: secondReturns, ticker: "B" },
  ].map(({ candidateId, name, returns, ticker }) => ({
    candidateId,
    canonicalFingerprint: candidateId,
    name,
    kind: "alpha_streams" as const,
    status: "READY" as const,
    reasons: [],
    assetTickers: [ticker],
    targetAssetExposures: { [ticker]: 1 },
    actualAssetExposures: { [ticker]: 1 },
    residualCash: 0,
    targetHistory: [{
      signalDate: dateAt(7), informationCutoff: dateAt(7), executionDate: dateAt(7),
      targetPositions: { [ticker]: 1 },
    }],
    signalSeries: [],
    returnSeries: [],
    ledger: returns.map((gross, i) => ({
      date: dateAt(i), beginningNav: 100, etfPnl: gross * 100, cashPnl: 0,
      netPnl: gross * 100, transactionCosts: 0, slippage: 0,
    })),
    lineage: { datasetHash: "route-d4-fixture", definition: { cashYieldAnnual: 0 } },
    diagnostics: {},
  }));

  return {
    schemaVersion: 1,
    engineVersion: "allocation-b1.0",
    a1EngineVersion: "a1",
    representation: "alpha_streams",
    dataset: {
      id: null,
      sha256: hashDataset(datasetContent),
      csvContent: datasetContent,
      startDate: dateAt(0),
      endDate: dateAt(7),
      tickers: ["A", "B"],
      priceConvention: "adjusted close",
    },
    factorSet: { version: "route-test", factors: [] },
    request: { representation: "alpha_streams", assetTickers: [], factorIds: [], alphaDefinitions: [] },
    coverage: {},
    candidates,
    dependence: {},
    suppliedWeights: {},
    createdAt: new Date().toISOString(),
  } as unknown as PreparedSnapshot;
}

test("allocation route freezes default factor dimension before D4 diagnostics and replays", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const snapshot = makeSnapshot();
  const [preparedRow] = await db.insert(preparedInputsTable).values({
    representation: "alpha_streams",
    fingerprint: fingerprint({ test: "D4 route replay", snapshot }),
    snapshot,
  }).returning();
  let allocationId: number | undefined;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = `http://127.0.0.1:${address.port}`;

  try {
    const createResponse = await fetch(`${api}/allocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preparedInputId: preparedRow.id,
        candidateIds: ["first", "second"],
        informationCutoff: dateAt(7),
        decisionTimestamp: dateAt(7),
        estimationWindow: 8,
        minObservations: 3,
        representation: "alpha_streams",
        returnConvention: "daily_decimal",
        expectedReturnShrinkage: 0,
        covarianceDiagonalShrinkage: 0,
        riskModel: { type: "STATISTICAL_FACTOR" },
        forecastModel: { type: "SAMPLE_MEAN" },
        robustness: { method: "ROBUST_MEAN_UNCERTAINTY", kappa: 0.03 },
        dailyCashYield: 0,
        objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
        constraints: { totalCash: { min: 0, max: 0 } },
      }),
    });
    const created = await createResponse.json() as {
      id?: number;
      request?: { riskModel?: { factorCount?: number; specificRiskFloorFraction?: number } };
      result?: { status?: string; robustness?: { diagnostics?: unknown } };
      error?: string;
    };
    assert.equal(createResponse.status, 201, created.error);
    assert.ok(created.id);
    allocationId = created.id;
    assert.equal(created.result?.status, "SOLVED");
    assert.equal(created.request?.riskModel?.factorCount, 1);
    assert.equal(typeof created.request?.riskModel?.specificRiskFloorFraction, "number");
    assert.ok(created.result?.robustness?.diagnostics);

    const replayResponse = await fetch(`${api}/allocations/${allocationId}/replay`, { method: "POST" });
    const replay = await replayResponse.json() as {
      status?: string;
      differences?: string[];
      maximumNumericDifference?: number;
      replayedResult?: unknown;
    };
    assert.equal(replayResponse.status, 200);
    assert.equal(replay.status, "pass", replay.differences?.join("; "));
    assert.ok(replay.maximumNumericDifference !== undefined);
    assert.ok(replay.maximumNumericDifference <= 1e-8);
    assert.ok(replay.replayedResult);

    // Requests predating D5 omit costAware entirely and retain the B2 engine
    // version/replay behavior.
    const legacyResponse = await fetch(`${api}/allocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preparedInputId: preparedRow.id,
        candidateIds: ["first", "second"],
        informationCutoff: dateAt(7),
        decisionTimestamp: dateAt(7),
        estimationWindow: 8,
        minObservations: 3,
        representation: "alpha_streams",
        returnConvention: "daily_decimal",
        expectedReturnShrinkage: 0,
        covarianceDiagonalShrinkage: 0,
        dailyCashYield: 0,
        objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
        constraints: { totalCash: { min: 0, max: 0 } },
      }),
    });
    const legacy = await legacyResponse.json() as { id?: number; engineVersion?: string; error?: string };
    assert.equal(legacyResponse.status, 201, legacy.error);
    assert.ok(legacy.id);
    assert.match(legacy.engineVersion ?? "", /^allocation-b2-api\.1;/);
    const legacyReplay = await fetch(`${api}/allocations/${legacy.id}/replay`, { method: "POST" });
    const legacyReplayBody = await legacyReplay.json() as { status?: string; differences?: string[] };
    assert.equal(legacyReplayBody.status, "pass", legacyReplayBody.differences?.join("; "));

    // Model a pre-retirement saved D5 allocation: old snapshots remain
    // replayable even though the create endpoint no longer accepts costAware.
    const oldCostAwareRequest = {
      preparedInputId: preparedRow.id,
      candidateIds: ["first", "second"],
      informationCutoff: dateAt(7),
      decisionTimestamp: dateAt(7),
      estimationWindow: 8,
      minObservations: 3,
      representation: "alpha_streams",
      returnConvention: "daily_decimal",
      expectedReturnShrinkage: 0,
      covarianceDiagonalShrinkage: 0,
      dailyCashYield: 0,
      objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
      constraints: { totalCash: { min: 0, max: 0 } },
      costAware: {
        costAmortizationDays: 20,
        turnoverPreferenceBps: 0,
        transactionCostBps: 5,
        slippageBps: 2,
        holdings: { asOf: dateAt(7), quantities: {}, cash: 100, nav: 100 },
      },
    } as AllocationRequest;
    const oldCostAwareResult = optimizePreparedSnapshot(snapshot, oldCostAwareRequest);
    assert.equal(oldCostAwareResult.status, "SOLVED");
    const oldCostAwareEvidence = oldCostAwareResult.costAware?.solverEvidence;
    assert.ok(oldCostAwareEvidence);
    const persistedOldCostAwareResult = JSON.parse(JSON.stringify(oldCostAwareResult));
    const oldCostAwareVersion = `allocation-d5-api.1; ${oldCostAwareResult.solver.name}@${oldCostAwareResult.solver.version}` +
      `; D5 cost-aware ${oldCostAwareEvidence.name}@${oldCostAwareEvidence.version}`;
    const oldCostAwareSnapshotHash = fingerprint(snapshot);
    const oldCostAwareFingerprint = fingerprint({
      preparedInputId: preparedRow.id,
      representation: "alpha_streams",
      engineVersion: oldCostAwareVersion,
      request: oldCostAwareRequest,
      snapshotHash: oldCostAwareSnapshotHash,
      result: persistedOldCostAwareResult,
    });
    const [oldCostAwareAllocation] = await db.insert(allocationsTable).values({
      preparedInputId: preparedRow.id,
      representation: "alpha_streams",
      fingerprint: oldCostAwareFingerprint,
      frozenSnapshotHash: oldCostAwareSnapshotHash,
      engineVersion: oldCostAwareVersion,
      frozenRequest: oldCostAwareRequest,
      frozenSnapshot: snapshot,
      frozenResult: persistedOldCostAwareResult,
    }).returning();
    const oldCostAwareReplayResponse = await fetch(
      `${api}/allocations/${oldCostAwareAllocation.id}/replay`, { method: "POST" });
    const oldCostAwareReplay = await oldCostAwareReplayResponse.json() as {
      status?: string; differences?: string[];
    };
    assert.equal(oldCostAwareReplay.status, "pass", oldCostAwareReplay.differences?.join("; "));
    const retiredB3Validation = await persistB3ValidationRun({
      allocationId: oldCostAwareAllocation.id,
      validationPreparedInputId: preparedRow.id,
      assumptions: {
        evaluationStartDate: dateAt(0),
        evaluationEndDate: dateAt(7),
        decisionCalendar: "monthly",
        executionTiming: "next_close",
        initialNav: 100,
        initialHoldings: {},
        initialCash: 100,
        transactionCostBps: 5,
        slippageBps: 2,
        dailyCashYield: 0,
      },
    });
    assert.ok("error" in retiredB3Validation);
    if ("error" in retiredB3Validation) {
      assert.equal(retiredB3Validation.status, 422);
      assert.match(retiredB3Validation.error, /costAware L1 method is retired/);
    }

    const noRegularizationHoldingsResponse = await fetch(`${api}/allocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preparedInputId: preparedRow.id,
        candidateIds: ["first", "second"],
        informationCutoff: dateAt(7),
        decisionTimestamp: dateAt(7),
        estimationWindow: 8,
        minObservations: 3,
        representation: "alpha_streams",
        returnConvention: "daily_decimal",
        expectedReturnShrinkage: 0,
        covarianceDiagonalShrinkage: 0,
        allocationMode: "SIGNED_OVERLAY",
        signedConstraints: { cash: { min: -0.2, max: -0.05 } },
        dailyCashYield: 0,
        objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
        constraints: {},
        rebalanceRegularization: { lambdaR: 0 },
      }),
    });
    const noRegularizationHoldings = await noRegularizationHoldingsResponse.json() as {
      id?: number; engineVersion?: string; request?: { rebalanceRegularization?: { lambdaR?: number; holdings?: unknown } };
      error?: string;
    };
    assert.equal(noRegularizationHoldingsResponse.status, 201, noRegularizationHoldings.error);
    assert.ok(noRegularizationHoldings.id);
    assert.equal(noRegularizationHoldings.request?.rebalanceRegularization?.lambdaR, 0);
    assert.equal(noRegularizationHoldings.request?.rebalanceRegularization?.holdings, undefined);
    assert.match(noRegularizationHoldings.engineVersion ?? "", /^allocation-b2-api\.1;/);

    const positiveRegularizationResponse = await fetch(`${api}/allocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preparedInputId: preparedRow.id,
        candidateIds: ["first", "second"],
        informationCutoff: dateAt(7),
        decisionTimestamp: dateAt(7),
        estimationWindow: 8,
        minObservations: 3,
        representation: "alpha_streams",
        returnConvention: "daily_decimal",
        expectedReturnShrinkage: 0,
        covarianceDiagonalShrinkage: 0,
        dailyCashYield: 0,
        objective: { type: "regularized_mean_variance", gamma: 2, eta: 0.02 },
        constraints: { totalCash: { min: 0, max: 0 } },
        rebalanceRegularization: {
          lambdaR: 0.05,
          holdings: { asOf: dateAt(7), quantities: {}, cash: 100, nav: 100 },
        },
      }),
    });
    const positiveRegularization = await positiveRegularizationResponse.json() as {
      id?: number; engineVersion?: string; result?: { status?: string; rebalanceRegularization?: {
        lambdaR?: number; referenceAssetWeights?: Record<string, number>; solverEvidence?: unknown;
      } }; error?: string;
    };
    assert.equal(positiveRegularizationResponse.status, 201, positiveRegularization.error);
    assert.ok(positiveRegularization.id);
    assert.match(positiveRegularization.engineVersion ?? "", /^allocation-d5-simple-api\.1;/);
    assert.equal(positiveRegularization.result?.status, "SOLVED");
    assert.equal(positiveRegularization.result?.rebalanceRegularization?.lambdaR, 0.05);
    assert.ok(positiveRegularization.result?.rebalanceRegularization?.referenceAssetWeights);
    assert.ok(positiveRegularization.result?.rebalanceRegularization?.solverEvidence);
    const regularizationReplayResponse = await fetch(
      `${api}/allocations/${positiveRegularization.id}/replay`, { method: "POST" });
    const regularizationReplay = await regularizationReplayResponse.json() as {
      status?: string; differences?: string[]; maximumNumericDifference?: number;
    };
    assert.equal(regularizationReplay.status, "pass", regularizationReplay.differences?.join("; "));
    assert.ok((regularizationReplay.maximumNumericDifference ?? Infinity) <= 1e-8);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    await db.delete(allocationsTable).where(eq(allocationsTable.preparedInputId, preparedRow.id));
    await db.delete(preparedInputsTable).where(eq(preparedInputsTable.id, preparedRow.id));
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await pool.end();
});