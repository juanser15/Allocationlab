import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { RunResult, ValidationRun, ValidationRunSummary } from "@workspace/api-zod";

const base = "http://localhost:8080/api";
const fixtureLabel = "A2.1 temporary acceptance fixture";
let strategySnapshotId: number | null = null;
let priceDataId: number | null = null;
let fixtureCsv: string | null = null;

function deterministicPrices(tickers: string[]): { csv: string; rowCount: number } {
  const lines = [`date,${tickers.join(",")}`];
  let index = 0;
  for (let day = Date.UTC(2008, 0, 1); day <= Date.UTC(2009, 5, 30); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    lines.push(`${date},${tickers.map((_, i) =>
      (100 + index * (0.018 + i * 0.001) +
        2.5 * Math.sin(index * (0.021 + i * 0.002) + i)).toFixed(8)).join(",")}`);
    index++;
  }
  return { csv: lines.join("\n"), rowCount: index };
}

function fixturePool() {
  const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
  const { Pool } = requireFromDb("pg") as { Pool: new (config: {
    connectionString: string | undefined; connectionTimeoutMillis: number;
  }) => {
    query: (sql: string, values?: unknown[]) => Promise<{
      rows: Array<{ id: number; value: string; updated_at: Date }>;
    }>;
    end: () => Promise<void>;
  } };
  return new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
}

async function api<T = unknown>(path: string, body?: object): Promise<T> {
  const response = await fetch(base + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }
    : { signal: AbortSignal.timeout(30_000) });
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
  const pool = fixturePool();
  try {
    const universeRow = (await pool.query("SELECT value FROM config WHERE key = $1", ["universe"])).rows[0];
    assert.ok(universeRow, "A2.1 requires an enabled ETF universe.");
    const universe = JSON.parse(universeRow.value) as {
      etfs: Array<{ ticker: string; enabled: boolean }>;
    };
    const tickers = [...new Set(universe.etfs.filter((etf) => etf.enabled).map((etf) => etf.ticker))].sort();
    assert.ok(tickers.length >= 8, "A2.1 fixture requires at least eight enabled ETFs.");
    const prices = deterministicPrices(tickers);
    fixtureCsv = prices.csv;
    const inserted = await pool.query(
      `INSERT INTO price_data (csv_content, tickers, start_date, end_date, row_count, uploaded_at)
       VALUES ($1, $2, $3, $4, $5,
         GREATEST(NOW(), COALESCE((SELECT MAX(uploaded_at) FROM price_data), NOW())) + INTERVAL '1 second')
       RETURNING id`,
      [prices.csv, JSON.stringify(tickers), "2008-01-01", "2009-06-30", prices.rowCount],
    );
    priceDataId = inserted.rows[0].id;
    const latest = (await pool.query(
      "SELECT id FROM price_data ORDER BY uploaded_at DESC, id DESC LIMIT 1",
    )).rows[0];
    assert.equal(latest.id, priceDataId, "The test dataset must be the exact source frozen by /run.");

    const previous = (await pool.query("SELECT value, updated_at FROM config WHERE key = $1",
      ["constraints"])).rows[0];
    // /run consumes persisted configuration. Restore the user's exact value and
    // timestamp immediately; the test session then retains an immutable snapshot.
    const feasible = JSON.stringify({
      cashMin: 0.1, cashMax: 0.2, minEtfWeight: 0.005, maxEtfWeight: 0.3,
      minInclusionThreshold: 0, targetActiveEtfs: 8, diversificationEnabled: true,
    });
    try {
      if (previous) await pool.query("UPDATE config SET value = $1 WHERE key = $2", [feasible, "constraints"]);
      else await pool.query("INSERT INTO config (key, value) VALUES ($1, $2)", ["constraints", feasible]);
      const session = await api<RunResult>("/run", { label: fixtureLabel });
      strategySnapshotId = session.sessionId;
      assert.ok(Number.isInteger(strategySnapshotId));
    } finally {
      if (previous) await pool.query("UPDATE config SET value = $1, updated_at = $2 WHERE key = $3",
        [previous.value, previous.updated_at, "constraints"]);
      else await pool.query("DELETE FROM config WHERE key = $1", ["constraints"]);
    }
  } finally {
    await pool.end();
  }
});

after(async () => {
  // Only the uniquely labeled fixtures created by this suite are removed.
  const pool = fixturePool();
  try {
    if (strategySnapshotId) {
      await pool.query("DELETE FROM validation_runs WHERE strategy_snapshot_id = $1", [strategySnapshotId]);
      await pool.query("DELETE FROM sessions WHERE id = $1 AND label = $2", [strategySnapshotId, fixtureLabel]);
    }
    if (priceDataId && fixtureCsv)
      await pool.query("DELETE FROM price_data WHERE id = $1 AND csv_content = $2", [priceDataId, fixtureCsv]);
  } finally {
    await pool.end();
  }
});

test("TEST 1 — multiple immutable validations of one Strategy Snapshot", async () => {
  const first = await api<ValidationRun>("/validation-runs", input(10));
  assert.equal(first.strategySnapshotId, strategySnapshotId);
  assert.ok(first.result.validationIdentity);
  assert.equal(first.result.validationIdentity.datasetId, priceDataId);
  assert.equal(first.result.dataStartDate, "2008-01-01");
  assert.equal(first.result.dataEndDate, "2009-06-30");
  assert.equal(first.assumptions.transactionCostBps, 10);
  const firstSaved = await api<ValidationRun>(`/validation-runs/${first.validationRunId}`);
  const second = await api<ValidationRun>("/validation-runs", input(35));
  assert.notEqual(first.validationRunId, second.validationRunId);
  assert.equal(second.strategySnapshotId, strategySnapshotId);
  assert.equal(first.datasetHash, second.datasetHash);
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
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }));
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