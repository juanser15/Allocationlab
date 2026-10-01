import assert from "node:assert/strict";
import test from "node:test";
import {
  filterHistory, hasPendingJobs, findSelected, historyReplayAvailable, needsJobStatusFetch, parseSelection, planInspection,
  sortHistory, workingState, type PortfolioHistoryEntry,
} from "./portfolio-history-state.ts";

const e = (o: Partial<PortfolioHistoryEntry>): PortfolioHistoryEntry => ({
  kind: "validation", id: "1", createdAt: "2025-01-01T00:00:00Z", status: "completed",
  representation: "PRICE", executionMode: "next_close", replayAvailable: true,
  sessionId: null, allocationId: 4, validationRunId: 9, jobId: null, ...o,
});

test("validation inspect passes run id and never a run token", () => {
  const p = planInspection(e({}));
  assert.equal(p.inspectRunId, 9); assert.equal(p.b2Mode, true); assert.equal(p.tab, "backtest");
  assert.equal("runToken" in p, false);
});
test("job without run is inspected by job id only", () => {
  const entry = e({ kind: "job", status: "running", validationRunId: null, jobId: "j1" });
  const p = planInspection(entry);
  assert.equal(p.inspectRunId, null); assert.equal(p.inspectedJobId, "j1");
  assert.equal(needsJobStatusFetch(entry), true);
  assert.equal(needsJobStatusFetch(e({ jobId: "j1" })), false);
});
test("allocation inspect targets B2 allocation", () => {
  const p = planInspection(e({ kind: "allocation", validationRunId: null }));
  assert.equal(p.tab, "allocation"); assert.equal(p.inspectedAllocationId, 4);
  assert.equal(historyReplayAvailable(e({ kind: "allocation", replayAvailable: false })), true);
});
test("legacy optimization is summarised without touching working state", () => {
  const p = planInspection(e({ kind: "optimization", representation: null, allocationId: null, sessionId: 12 }));
  assert.equal(p.legacySessionSummaryId, 12); assert.equal(p.b2Mode, false); assert.equal(p.tab, "overview");
});
test("legacy validation pins session and run", () => {
  const p = planInspection(e({ representation: null, allocationId: null, sessionId: 12 }));
  assert.equal(p.pinnedSessionId, 12); assert.equal(p.pinnedLegacyRunId, 9); assert.equal(p.b2Mode, false);
});
test("filter, sort and selection restore", () => {
  const a = e({ id: "a", createdAt: "2025-01-01T00:00:00Z" });
  const b = e({ id: "b", kind: "job", createdAt: "2025-02-01T00:00:00Z" });
  assert.deepEqual(filterHistory([a, b], "job").map(x => x.id), ["b"]);
  assert.equal(sortHistory([a, b])[0].id, "b");
  const sel = parseSelection(JSON.stringify({ kind: "job", id: "b" }));
  assert.equal(findSelected([a, b], sel)?.id, "b");
  assert.equal(parseSelection("garbage"), null);
  assert.equal(findSelected([a], { kind: "job", id: "zz" }), null);
});
test("draft is distinct from restored historical inputs", () => {
  assert.equal(workingState(null, true), "draft");
  assert.equal(workingState(e({ status: "frozen", kind: "allocation" }), true), "frozen-inspected");
  assert.equal(workingState(e({ kind: "job", status: "failed" }), true), "job-inspected");
  assert.equal(workingState(null, false), "none");
});

test("polling only with pending jobs; stale selection preserved", () => {
  assert.equal(hasPendingJobs([e({ status: "running", kind: "job" })]), true);
  assert.equal(hasPendingJobs([e({})]), false);
  assert.equal(hasPendingJobs(undefined), false);
  const sel = { kind: "job" as const, id: "gone" };
  assert.equal(findSelected([e({})], sel), null);
  assert.deepEqual(sel, { kind: "job", id: "gone" });
});

import { effectiveInspectedRunId, jobIsPending, repinLegacyRun } from "./portfolio-history-state.ts";
test("legacy view never falls back to another run", () => {
  const legacyJob = planInspection(e({ kind: "job", representation: null, allocationId: null, sessionId: 3, validationRunId: null, jobId: "j", status: "running" }));
  assert.equal(effectiveInspectedRunId(legacyJob, null), null);
  assert.equal(effectiveInspectedRunId(legacyJob, 55), 55);
  assert.equal(effectiveInspectedRunId(null, 55), null);
  assert.equal(effectiveInspectedRunId(planInspection(e({})), 55), null);
});
test("repin keeps pinned session and drops job; pending detection", () => {
  const p = planInspection(e({ representation: null, allocationId: null, sessionId: 3 }));
  const q = repinLegacyRun(p, 77);
  assert.equal(q.pinnedLegacyRunId, 77); assert.equal(q.pinnedSessionId, 3); assert.equal(q.inspectedJobId, null);
  assert.equal(jobIsPending("running"), true); assert.equal(jobIsPending("completed"), false);
});
