import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  heartbeatDisposition, isCurrentValidationWorkerLease, terminateChildAfterTimeout,
  type ValidationWorkerLease,
} from "./validation-job-supervisor-control";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (signal === "SIGKILL") {
      this.signalCode = signal;
      this.emit("exit", null, signal);
    }
    return true;
  }
}

function lease(child: ChildProcess, jobId: string, owner: string, generation: number): ValidationWorkerLease {
  return { child, jobId, owner, generation };
}

test("an old heartbeat continuation cannot be mistaken for the current worker generation", () => {
  const oldChild = new FakeChild() as unknown as ChildProcess;
  const currentChild = new FakeChild() as unknown as ChildProcess;
  const oldLease = lease(oldChild, "job-a", "owner-a", 1);
  const nextJob = lease(oldChild, "job-b", "owner-a", 2);
  const nextWorker = lease(currentChild, "job-a", "owner-b", 3);

  assert.equal(isCurrentValidationWorkerLease(oldLease, oldLease, oldChild, 1), true);
  assert.equal(isCurrentValidationWorkerLease(nextJob, oldLease, oldChild, 2), false);
  assert.equal(isCurrentValidationWorkerLease(nextWorker, oldLease, currentChild, 3), false);
});

test("a false heartbeat caused by a terminal job retires its lease without killing the child", () => {
  assert.equal(heartbeatDisposition("terminal"), "retire");
  assert.equal(heartbeatDisposition("lost"), "terminate");
});

test("termination escalates to SIGKILL when a stuck worker ignores SIGTERM", async () => {
  const worker = new FakeChild();

  await terminateChildAfterTimeout(worker as unknown as ChildProcess, 5);

  assert.deepEqual(worker.signals, ["SIGTERM", "SIGKILL"]);
});