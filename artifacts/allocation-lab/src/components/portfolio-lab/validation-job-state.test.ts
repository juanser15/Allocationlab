import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRestoreValidationRun,
  mayApplyValidationJobError,
  mayApplyValidationJobResponse,
  validationJobRecoveryAction,
  type ValidationJobRequestIdentity,
  type PersistedJobRequest,
} from "./validation-job-state.ts";

const pending = (): PersistedJobRequest<{ assumptions: { timing: string } }> => ({
  idempotencyKey: "same-key",
  request: { assumptions: { timing: "next_open" } },
  job: null,
  submissionError: null,
});

test("an uncertain submission is resubmitted with the original idempotency key and request", () => {
  assert.deepEqual(validationJobRecoveryAction(pending(), null), {
    type: "submit",
    idempotencyKey: "same-key",
    request: { assumptions: { timing: "next_open" } },
  });
});

test("a persisted job identifier is recovered with GET rather than another POST", () => {
  const stored = { ...pending(), job: { jobId: "job-1", status: "running" as const, validationRunId: null, updatedAt: "2026-01-01T00:00:00Z" } };
  assert.deepEqual(validationJobRecoveryAction(stored, null), { type: "get", jobId: "job-1" });
});

test("a terminal job is fetched once after reload, then stays idle until reconnect", () => {
  const stored = { ...pending(), job: { jobId: "job-done", status: "completed" as const, validationRunId: 481, updatedAt: "2026-01-01T00:00:00Z" } };
  assert.deepEqual(validationJobRecoveryAction(stored, null), { type: "get", jobId: "job-done" });
  assert.deepEqual(validationJobRecoveryAction(stored, "job-done"), { type: "idle" });
  assert.deepEqual(validationJobRecoveryAction(stored, "job-done", true), { type: "get", jobId: "job-done" });
});

test("reloaded completed or failed jobs restore their same linked Validation Run only once", () => {
  const completed = { jobId: "done", status: "completed" as const, validationRunId: 481, updatedAt: "2026-01-01T00:00:00Z" };
  const failedWithSavedRun = { jobId: "failed", status: "failed" as const, validationRunId: 482, updatedAt: "2026-01-01T00:00:00Z" };
  assert.equal(shouldRestoreValidationRun(completed, null), true);
  assert.equal(shouldRestoreValidationRun(completed, "done"), false);
  assert.equal(shouldRestoreValidationRun(failedWithSavedRun, null), true);
});

test("offline recovery leaves a known job key intact and later reconnect uses GET", () => {
  const stored = { ...pending(), job: { jobId: "reconnect", status: "queued" as const, validationRunId: null, updatedAt: "2026-01-01T00:00:00Z" } };
  const actionWhileOffline = validationJobRecoveryAction(stored, null);
  const actionAfterReconnect = validationJobRecoveryAction(stored, null, true);
  assert.deepEqual(actionWhileOffline, { type: "get", jobId: "reconnect" });
  assert.deepEqual(actionAfterReconnect, { type: "get", jobId: "reconnect" });
  assert.equal(stored.idempotencyKey, "same-key");
});

test("late terminal responses cannot overwrite a newer explicit run", () => {
  const capture: ValidationJobRequestIdentity = {
    storageKey: "scope-a",
    generation: 4,
    idempotencyKey: "same-key",
    jobId: "old-job",
  };
  const current = {
    ...pending(),
    idempotencyKey: "new-key",
    job: { jobId: "new-job", status: "running" as const, validationRunId: null, updatedAt: "2026-01-01T00:02:00Z" },
  };
  const oldResponse = { jobId: "old-job", status: "completed" as const, validationRunId: 41, updatedAt: "2026-01-01T00:03:00Z" };
  assert.equal(mayApplyValidationJobResponse(capture, "scope-a", 4, current, oldResponse), false);
  assert.equal(mayApplyValidationJobError(capture, "scope-a", 4, current), false);
});

test("late responses are discarded when their tab generation or storage scope is stale", () => {
  const capture: ValidationJobRequestIdentity = {
    storageKey: "scope-a",
    generation: 4,
    idempotencyKey: "same-key",
    jobId: "job-1",
  };
  const current = { ...pending(), job: { jobId: "job-1", status: "running" as const, validationRunId: null, updatedAt: "2026-01-01T00:02:00Z" } };
  const response = { ...current.job, status: "completed" as const, validationRunId: 8, updatedAt: "2026-01-01T00:03:00Z" };
  assert.equal(mayApplyValidationJobResponse(capture, "scope-a", 5, current, response), false);
  assert.equal(mayApplyValidationJobResponse(capture, "scope-b", 4, current, response), false);
});

test("older same-job responses do not roll back a newer update from another tab", () => {
  const capture: ValidationJobRequestIdentity = {
    storageKey: "scope-a",
    generation: 4,
    idempotencyKey: "same-key",
    jobId: "job-1",
  };
  const current = { ...pending(), job: { jobId: "job-1", status: "completed" as const, validationRunId: 8, updatedAt: "2026-01-01T00:03:00Z" } };
  const stale = { ...current.job, status: "running" as const, validationRunId: null, updatedAt: "2026-01-01T00:02:00Z" };
  assert.equal(mayApplyValidationJobResponse(capture, "scope-a", 4, current, stale), false);
});