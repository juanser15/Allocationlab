import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "../lib/db/src/index";
import { DurableResearchStore } from "../artifacts/api-server/src/lib/workbench/durable-research-store";

const evidence = JSON.parse(await readFile("generated-artifacts/quality-validation/api-evidence.json", "utf8"));
const root = await mkdtemp(join(tmpdir(), "quality-empty-history-"));
const onId = evidence.runs.on.run_id, attemptId = evidence.runs.on.attempt;
try {
  const store = await DurableResearchStore.open();
  const archival = await store.archiveLegacy();
  const fresh = await DurableResearchStore.open({ legacyRoot: root });
  const run = await fresh.getRun(onId);
  const ref = { runId: onId, executionAttemptId: attemptId };
  const result: any = await fresh.readResult(ref);
  assert.equal(run.latest_status, "SUCCESS");
  assert.equal(result.quality_gate_evidence.enabled, true);
  assert.equal(result.validation_evidence.accounting.passed, true);
  assert.equal((await fresh.reviews(onId)).state, "CALCULATED");
  // Reviews and concurrency/state assertions are rolled back, not investment approvals.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const db = {
      query: (...args: any[]) => (client.query as any)(...args),
      connect: async () => ({ query: (...args: any[]) => (client.query as any)(...args), release() {} }),
    };
    const testStore = await DurableResearchStore.open({ legacyRoot: root, database: db as any });
    const review = { execution_attempt_id: attemptId, actor: "Functional validation — transaction rolled back", note: "Test of evidence binding; not a live investment approval." };
    await assert.rejects(() => testStore.review(onId, { ...review, decision: "APPROVED" }), (e: any) => e.code === "APPROVAL_BLOCKED");
    assert.equal((await testStore.review(onId, { ...review, decision: "REVIEWED" })).state, "REVIEWED");
    const approved = await testStore.review(onId, { ...review, decision: "APPROVED" });
    assert.equal(approved.state, "APPROVED");
    assert.equal(approved.events.length, 2);
    assert.equal(approved.events[0].result_hash, approved.events[1].result_hash);
    await assert.rejects(() => testStore.completeSuccess(ref, { altered: true }), /terminal attempt/);
    await assert.rejects(() => testStore.ensureRun(onId, { altered: true }), /different frozen/);
    const next = await testStore.createAttempt(onId);
    await assert.rejects(() => testStore.review(onId, { ...review, decision: "APPROVED" }), (e: any) => e.code === "STALE_REVIEW");
    const lease = await testStore.acquireExecutionLease({ runId: onId, executionAttemptId: next.attempt.execution_attempt_id }, 5000);
    assert.equal(lease.acquired, true);
    assert.equal((await testStore.acquireExecutionLease(ref, 5000)).acquired, false);
    await testStore.releaseExecutionLease(lease.lease.token);
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.equal((await fresh.reviews(onId)).state, "CALCULATED");
  assert.equal((await fresh.getRun(onId)).latest_status, "SUCCESS");
  await writeFile("generated-artifacts/quality-validation/storage-evidence.json", JSON.stringify({
    archive: archival, empty_filesystem_recovery: true, result_hash_verified: true, terminal_immutability: true,
    declared_review_bound_to_result_hash: true, premature_approval_blocked: true, stale_attempt_review_blocked: true,
    exclusive_execution_lease: true, test_approval_rolled_back: true,
  }, null, 2));
  console.log("PASS: PostgreSQL recovery without historical filesystem, frozen integrity, review states, stale review rejection, execution lease. Test approvals rolled back.");
} finally { await pool.end(); }
