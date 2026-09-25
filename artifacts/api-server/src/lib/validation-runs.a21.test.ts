import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { RunResult, ValidationRun, ValidationRunSummary } from "@workspace/api-zod";

const base = "http://localhost:8080/api";
const fixtureLabel = "A2.1 temporary acceptance fixture";
let strategySnapshotId: number | null = null;

async function api<T = unknown>(path: string, body?: object): Promise<T> {
  const response = await fetch(base + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const result = await response.json() as T;
  assert.ok(response.ok, `${path} returned ${response.status}: ${JSON.stringify(result).slice(0, 600)}`);
  return result;
}

const input = (transactionCostBps: number) => ({
  sessionId: strategySnapshotId,
  benchmark: "none",
  endDate: "2009-05-01",
  warmupDays: 60,
  executionTiming: "next_close",
  rebalanceFrequency: "monthly",
  transactionCostBps,
  slippageBps: 5,
  maxTurnoverPerRebalance: 1,
  cashYieldAnnual: 0,
});

before(async () => {
  const session = await api<RunResult>("/run", { label: fixtureLabel });
  strategySnapshotId = session.sessionId;
  assert.ok(Number.isInteger(strategySnapshotId));
});

after(async () => {
  if (!strategySnapshotId) return;
  // Only the uniquely labeled fixtures created by this suite are removed.
  const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
  const { Pool } = requireFromDb("pg") as { Pool: new (config: { connectionString: string | undefined }) => {
    query: (sql: string, values: unknown[]) => Promise<unknown>;
    end: () => Promise<void>;
  } };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("DELETE FROM validation_runs WHERE strategy_snapshot_id = $1", [strategySnapshotId]);
    await pool.query("DELETE FROM sessions WHERE id = $1 AND label = $2", [strategySnapshotId, fixtureLabel]);
  } finally {
    await pool.end();
  }
});

test("TEST 1 — multiple immutable validations of one Strategy Snapshot", async () => {
  const first = await api<ValidationRun>("/validation-runs", input(10));
  assert.equal(first.strategySnapshotId, strategySnapshotId);
  assert.equal(first.assumptions.transactionCostBps, 10);
  const firstSaved = await api<ValidationRun>(`/validation-runs/${first.validationRunId}`);
  const second = await api<ValidationRun>("/validation-runs", input(35));
  assert.notEqual(first.validationRunId, second.validationRunId);
  assert.equal(second.strategySnapshotId, strategySnapshotId);
  assert.equal(second.assumptions.transactionCostBps, 35);
  assert.notEqual(first.validationInputHash, second.validationInputHash);
  assert.notDeepEqual(first.result, second.result, "changed costs must produce separately retained financial results");
  assert.deepEqual(await api<ValidationRun>(`/validation-runs/${first.validationRunId}`), firstSaved);
  assert.deepEqual(firstSaved, first);
  assert.deepEqual(await api<ValidationRun>(`/validation-runs/${second.validationRunId}`), second);
  const summaries = await api<ValidationRunSummary[]>(`/validation-runs?sessionId=${strategySnapshotId}`);
  assert.ok(summaries.some((r: { validationRunId: number }) => r.validationRunId === first.validationRunId));
  assert.ok(summaries.some((r: { validationRunId: number }) => r.validationRunId === second.validationRunId));
});

test("TEST 2 — persisted Validation Run survives reloaded application state", async () => {
  const created = await api<ValidationRun>("/validation-runs", input(17));
  const byNewClient = JSON.parse(execFileSync(process.execPath, [
    "-e", `fetch(${JSON.stringify(`${base}/validation-runs/${created.validationRunId}`)})
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(data => process.stdout.write(JSON.stringify(data)))
      .catch(e => { console.error(e); process.exitCode = 1; });`,
  ], { encoding: "utf8" }));
  assert.equal(byNewClient.validationRunId, created.validationRunId);
  assert.equal(byNewClient.strategySnapshotId, created.strategySnapshotId);
  assert.deepEqual(byNewClient.assumptions, created.assumptions);
  assert.equal(byNewClient.datasetHash, created.datasetHash);
  assert.deepEqual(byNewClient.result.validationIdentity, created.result.validationIdentity);
  assert.equal(byNewClient.validationInputHash, created.validationInputHash);
  assert.equal(byNewClient.reconciliationStatus, "pass");
  for (const field of ["cumulativeReturn", "annualizedReturn", "sharpeRatio", "maxDrawdown"] as const) {
    const a = byNewClient.result[field], b = created.result[field];
    if (a === null || b === null) assert.equal(a, b);
    else assert.ok(Math.abs(a - b) <= 1e-8, `${field}: ${a} != ${b}`);
  }
  assert.deepEqual(byNewClient.result.equityCurve, created.result.equityCurve);
});