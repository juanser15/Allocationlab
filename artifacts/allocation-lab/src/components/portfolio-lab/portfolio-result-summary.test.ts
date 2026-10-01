import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationSummaryState,
  isFailedAllocationOutcome,
  loadedPolicyMatches,
  pmPercent,
  pmValue,
  needsHistoricalJobPolling,
  portfolioStateLabel,
  replayAvailability,
  viewedValidationRunId,
} from "./portfolio-result-summary.ts";

test("validation waits for the exact selected frozen policy, never a stale policy", () => {
  assert.equal(loadedPolicyMatches(null, null), false);
  assert.equal(loadedPolicyMatches(10, null), false);
  assert.equal(loadedPolicyMatches(11, 10), false);
  assert.equal(loadedPolicyMatches(11, 11), true);
});

test("PM labels keep editable draft, immutable frozen, and job lifecycle states distinct", () => {
  assert.equal(portfolioStateLabel("draft"), "Draft");
  assert.equal(portfolioStateLabel("SOLVED"), "Completed");
  assert.equal(portfolioStateLabel("frozen"), "Frozen");
  assert.equal(portfolioStateLabel("queued"), "Queued");
  assert.equal(portfolioStateLabel("running"), "Running");
  assert.equal(portfolioStateLabel("completed"), "Completed");
  assert.equal(portfolioStateLabel("failed"), "Failed");
});

test("failed allocation solver outcomes remain distinct from their frozen inputs", () => {
  assert.equal(isFailedAllocationOutcome("FAILED"), true);
  assert.equal(isFailedAllocationOutcome("engine_mismatch"), true);
  assert.equal(allocationSummaryState("FAILED"), "failed");
  assert.equal(allocationSummaryState("SOLVED"), "frozen");
});

test("stored percentages retain tiny nonzero values and missing turnover remains unrecorded", () => {
  assert.equal(pmPercent(2.161677234203364e-8), "2.16168e-6%");
  assert.equal(pmPercent(0.125), "12.50%");
  assert.equal(pmPercent(null, "Not recorded"), "Not recorded");
});

test("saved PM metrics surface exact stored numbers without recalculation or zero fallbacks", () => {
  assert.equal(pmValue(0.0123456789), "0.0123456789");
  assert.equal(pmValue(0), "0");
  assert.equal(pmValue(null), "Not recorded");
  assert.equal(pmValue(undefined), "Not recorded");
});

test("replay availability never conflates inspecting a history row with replaying it", () => {
  assert.equal(replayAvailability({ domain: "legacy", status: "pass" }), "Not available for legacy runs");
  assert.equal(replayAvailability({ domain: "b3", status: "success" }), "Available · explicit action");
  assert.equal(replayAvailability({ domain: "b3", status: "failed" }), "Failed run · explicit Replay only");
});

test("an inspected pending/failed historical job with no linked run hides a separate completed run", () => {
  assert.equal(viewedValidationRunId({
    inspectRunId: null,
    inspectedJobId: "history-job",
    inspectedJob: { jobId: "history-job", validationRunId: null },
    selectedRunId: 543,
  }), null);
  assert.equal(viewedValidationRunId({
    inspectRunId: null,
    inspectedJobId: "history-job",
    inspectedJob: { jobId: "another-job", validationRunId: 531 },
    selectedRunId: 543,
  }), null);
  assert.equal(viewedValidationRunId({
    inspectRunId: 531,
    inspectedJobId: null,
    inspectedJob: null,
    selectedRunId: 543,
  }), 531);
});

test("read-only historical jobs are polled only while queued or running, and missing settings stay explicit", () => {
  assert.equal(needsHistoricalJobPolling("queued"), true);
  assert.equal(needsHistoricalJobPolling("running"), true);
  assert.equal(needsHistoricalJobPolling("completed"), false);
  assert.equal(needsHistoricalJobPolling("failed"), false);
  assert.equal(pmValue(undefined), "Not recorded");
  assert.equal(pmValue(null), "Not recorded");
});