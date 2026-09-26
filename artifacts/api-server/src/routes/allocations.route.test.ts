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