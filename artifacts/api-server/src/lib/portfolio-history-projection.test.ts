import assert from "node:assert/strict";
import test from "node:test";
import {
  projectAllocationHistory,
  projectJobHistory,
  projectOptimizationHistory,
  projectValidationHistory,
  sortPortfolioHistory,
} from "./portfolio-history-projection";

test("projection preserves frozen-history identity and labels without requiring persisted result payloads", () => {
  const createdAt = new Date("2026-03-14T09:30:00.000Z");
  const entries = [
    projectOptimizationHistory({
      id: 531,
      createdAt,
      representation: null,
      executionMode: null,
    }),
    projectAllocationHistory({
      id: 305,
      createdAt,
      representation: "asset_returns",
      resultStatus: "SOLVED",
      executionMode: "CAPITAL_LONG_ONLY",
    }),
    projectValidationHistory({
      id: 543,
      createdAt,
      strategySnapshotId: null,
      allocationId: 305,
      reconciliationStatus: "pass",
      reproducibilityStatus: "pass",
      representation: "asset_returns",
      executionMode: "next_open",
    }),
  ];

  assert.deepEqual(entries.map(({ kind, id, status }) => ({ kind, id, status })), [
    { kind: "optimization", id: "531", status: "frozen" },
    { kind: "allocation", id: "305", status: "frozen" },
    { kind: "validation", id: "543", status: "completed" },
  ]);
  assert.equal(entries[0]!.representation, null, "missing legacy metadata stays explicitly unknown");
  assert.equal(entries[1]!.executionMode, "CAPITAL_LONG_ONLY");
  assert.equal(entries[2]!.executionMode, "next_open");
  assert.equal(entries[2]!.replayAvailable, true);
  assert.equal(entries[0]!.replayAvailable, false);
  assert.equal(entries[1]!.replayAvailable, true);
});

test("validation and solver failure labels come only from their existing persisted status fields", () => {
  const createdAt = "2026-04-01T12:00:00.000Z";
  const failedValidation = projectValidationHistory({
    id: 544,
    createdAt,
    strategySnapshotId: 531,
    allocationId: null,
    reconciliationStatus: "fail",
    reproducibilityStatus: "fail",
    representation: null,
    executionMode: null,
  });
  const failedAllocation = projectAllocationHistory({
    id: 306,
    createdAt,
    representation: "signals",
    resultStatus: "INFEASIBLE",
    executionMode: null,
  });
  assert.equal(failedValidation.status, "failed");
  assert.equal(failedValidation.replayAvailable, false);
  assert.equal(failedAllocation.status, "failed");
  assert.equal(failedAllocation.replayAvailable, true,
    "the existing frozen-allocation replay endpoint is available even when the saved solver result failed");
});

test("job projections distinguish persisted lifecycle states and expose replay only for linked B3 runs", () => {
  const createdAt = "2026-05-01T12:00:00.000Z";
  const states = ["queued", "running", "completed", "failed"] as const;
  const jobs = states.map((status) => projectJobHistory({
    id: `job-${status}`,
    createdAt,
    status,
    sessionId: null,
    allocationId: status === "completed" ? 305 : null,
    validationRunId: status === "completed" ? 543 : null,
    representation: status === "completed" ? "asset_returns" : null,
    executionMode: status === "completed" ? "next_open" : null,
  }));
  assert.deepEqual(jobs.map((job) => job.status), states);
  assert.equal(jobs.find((job) => job.status === "queued")!.replayAvailable, false);
  assert.equal(jobs.find((job) => job.status === "completed")!.replayAvailable, true);
  assert.throws(() => projectJobHistory({
    id: "job-invalid",
    createdAt,
    status: "waiting",
    sessionId: null,
    allocationId: null,
    validationRunId: null,
    representation: null,
    executionMode: null,
  }), /unknown validation job status/);
});

test("history merges and orders only compact projected rows newest-first", () => {
  const oldest = projectOptimizationHistory({
    id: 531,
    createdAt: "2026-01-01T00:00:00.000Z",
    representation: null,
    executionMode: null,
  });
  const newest = projectJobHistory({
    id: "job-current",
    createdAt: "2026-02-01T00:00:00.000Z",
    status: "running",
    sessionId: null,
    allocationId: null,
    validationRunId: null,
    representation: null,
    executionMode: null,
  });

  assert.deepEqual(sortPortfolioHistory([oldest, newest]), [newest, oldest]);
});