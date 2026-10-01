import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { asc } from "drizzle-orm";
import { db, preparedInputsTable } from "@workspace/db";
import router from "./prepared-inputs";

test("prepared-input picker GET is compact and a selected detail GET remains full and read-only", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const savedRows = await db.select({ id: preparedInputsTable.id }).from(preparedInputsTable)
    .orderBy(asc(preparedInputsTable.id));
  const saved = savedRows[0];
  if (!saved) {
    t.skip("No persisted prepared-input version is available for the read-only route test.");
    return;
  }

  const app = express();
  app.use(router);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const listResponse = await fetch(`${baseUrl}/prepared-input-summaries`);
    assert.equal(listResponse.status, 200);
    const summaries = await listResponse.json() as Array<Record<string, unknown>>;
    assert.equal(summaries.length, savedRows.length, "the summary endpoint must return one projection for every saved row");
    for (const item of summaries) {
      assert.deepEqual(Object.keys(item).sort(), [
        "candidateCount", "coverageEndDate", "coverageStartDate", "coverageStatus", "createdAt", "cutoffDate",
        "datasetHash", "datasetId", "observationCount", "preparedInputId", "representation", "technicalStatus",
      ].sort());
      assert.equal("snapshot" in item, false);
      assert.equal("candidates" in item, false);
      assert.equal("ledger" in item, false);
    }
    const summary = summaries.find((item) => item.preparedInputId === saved.id);
    assert.ok(summary, `Prepared input ${saved.id} should remain available in the unbounded saved list.`);

    const detailResponse = await fetch(`${baseUrl}/prepared-inputs/${saved.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as {
      preparedInputId: number;
      candidates: Array<Record<string, unknown>>;
      snapshot: { candidates: unknown[] };
    };
    assert.equal(detail.preparedInputId, saved.id);
    assert.equal(detail.candidates.length, detail.snapshot.candidates.length);
    assert.equal(detail.candidates.length, summary.candidateCount);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});