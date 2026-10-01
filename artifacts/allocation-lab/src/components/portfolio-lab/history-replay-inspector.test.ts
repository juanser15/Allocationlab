import assert from "node:assert/strict";
import test from "node:test";
import { replayTargetFor } from "./replay-target.ts";
import type { PortfolioHistoryEntry } from "./portfolio-history-state.ts";

const base: PortfolioHistoryEntry = { kind: "optimization", id: "1", createdAt: "2024-01-01", status: "frozen", representation: null, executionMode: null, replayAvailable: false, sessionId: 1, allocationId: null, validationRunId: null, jobId: null };
const b3 = { allocationId: 4, representation: "asset_returns" };
test("legacy optimization unavailable", () => assert.equal(replayTargetFor(base), null));
test("allocation maps to allocation replay", () => assert.deepEqual(replayTargetFor({ ...base, kind: "allocation", allocationId: 4 }), { type: "allocation", id: 4 }));
test("legacy validation 542 unavailable", () =>
  assert.equal(replayTargetFor({ ...base, kind: "validation", id: "542", validationRunId: 542 }), null));
test("B3 validation replays", () =>
  assert.deepEqual(replayTargetFor({ ...base, kind: "validation", validationRunId: 7, ...b3 }), { type: "validation", id: 7 }));
test("legacy job with sessionId request unavailable", () =>
  assert.equal(replayTargetFor({ ...base, kind: "job", jobId: "j", validationRunId: 3 }, 3, { sessionId: 1 }), null));
test("B3 job dereferences run id", () => {
  const j = { ...base, kind: "job" as const, jobId: "j", ...b3 };
  assert.equal(replayTargetFor(j), null);
  assert.deepEqual(replayTargetFor(j, 9, { allocationId: 4 }), { type: "validation", id: 9 });
});
