import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readExecutionCapacity, researchExecutionBudget } from "../../artifacts/api-server/src/lib/workbench/execution-capacity";
import { executionWatchdog } from "../../artifacts/api-server/src/lib/workbench/execution-watchdog";
import { P0Service } from "../../artifacts/api-server/src/lib/workbench/p0-service";
import { P0_NAMESPACE } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { ExecutionProgress } from "../../artifacts/allocation-lab/src/research/execution-progress";

function clock() {
  let now = 0, sequence = 0;
  const jobs = new Map<number, { at: number; run: () => void }>();
  const timers = {
    set(run: () => void, delay: number) {
      const id = ++sequence;
      jobs.set(id, { at: now + delay, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear(id: ReturnType<typeof setTimeout>) { jobs.delete(id as unknown as number); },
  };
  return { timers, size: () => jobs.size, tick(ms: number) {
    const end = now + ms;
    while (true) {
      const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; jobs.delete(next[0]); next[1].run();
    }
    now = end;
  } };
}
test("Daily gets a bounded 30-minute budget; rebalance-only keeps its previous two-minute runtime", () => {
  const c = readExecutionCapacity({});
  assert.equal(researchExecutionBudget({}, c).execution_timeout_ms, 120000);
  assert.equal(researchExecutionBudget({ capital_signal_frequency: "REBALANCE_ONLY" }, c).execution_timeout_ms, 120000);
  assert.equal(researchExecutionBudget({ capital_signal_frequency: "DAILY" }, c).execution_timeout_ms, 1800000);
  assert.equal(researchExecutionBudget({ capital_signal_frequency: "DAILY" }, c).stall_timeout_ms, 120000);
  const custom = readExecutionCapacity({ WORKBENCH_DAILY_EXECUTION_TIMEOUT_MS: "900000" });
  assert.equal(researchExecutionBudget({ capital_signal_frequency: "DAILY" }, custom).execution_timeout_ms, 900000);
  assert.throws(() => readExecutionCapacity({ WORKBENCH_DAILY_EXECUTION_TIMEOUT_MS: "2147483648" }));
});
test("Forward progress survives the old two-minute cutoff; a truly stalled worker expires once", () => {
  const t = clock(), expired: string[] = [];
  const w = executionWatchdog({ execution_timeout_ms: 1800000, stall_timeout_ms: 120000 }, code => expired.push(code), t.timers);
  for (let i = 1; i <= 5; i++) { t.tick(60000); w.advance(i); }
  assert.deepEqual(expired, []);
  t.tick(120000);
  assert.deepEqual(expired, ["EXECUTION_STALLED"]);
  assert.equal(t.size(), 0);
  t.tick(1800000);
  assert.equal(expired.length, 1);
});
test("Heartbeats without completed work cannot extend the stall limit", () => {
  const t = clock(), expired: string[] = [];
  const w = executionWatchdog({ execution_timeout_ms: 1000, stall_timeout_ms: 100 }, code => expired.push(code), t.timers);
  w.advance(5); t.tick(90); w.advance(5); w.advance(4); w.advance(NaN); t.tick(10);
  assert.deepEqual(expired, ["EXECUTION_STALLED"]);
});
test("Continuous forward progress cannot extend the total runtime bound; cleanup disarms both timers", () => {
  const t = clock(), expired: string[] = [];
  const w = executionWatchdog({ execution_timeout_ms: 150, stall_timeout_ms: 70 }, code => expired.push(code), t.timers);
  for (let i = 1; i <= 3; i++) { t.tick(40); w.advance(i); }
  t.tick(30); assert.deepEqual(expired, ["EXECUTION_TIMEOUT"]); assert.equal(t.size(), 0);
  const clean = executionWatchdog({ execution_timeout_ms: 100, stall_timeout_ms: 10 }, () => assert.fail("Stopped watchdog fired"), t.timers);
  clean.stop(); t.tick(1000); assert.equal(t.size(), 0);
});
test("Failed progress survives a fresh service instance with no in-memory progress map", async () => {
  const failed = { status: "FAILED", safe_message: "Stopped at runtime bound.", error_class: "EXECUTION_TIMEOUT",
    runtime_progress: { status: "FAILED", completed_signals: 42, total_signals: 3500, percent_complete: 1.2,
      elapsed_ms: 1800000, estimated_remaining_ms: null, stage: "Refreshing daily capital signal" } };
  const attempt = { status: "FAILED", attempt: { execution_attempt_id: "TEST_ONLY", run_id: "TEST_ONLY" } };
  const store = {
    getRun: async () => ({ run: { storage_status: "DURABLE_RESEARCH" }, normalized_spec: { identity_namespace: P0_NAMESPACE }, latest_attempt: attempt,
      latest_status: "FAILED", latest_successful_attempt: null, attempt_history: [attempt] }),
    readAttemptResult: async () => failed,
  };
  const service = new (P0Service as any)(store);
  const record = await service.get("TEST_ONLY");
  assert.equal(record.progress.completed_signals, 42);
  assert.equal(record.progress.status, "FAILED");
  assert.equal(record.progress.estimated_remaining_ms, null);
});
test("Old failed attempts never render waiting or a running ETA when progress counters are absent", () => {
  const html = renderToStaticMarkup(<ExecutionProgress runId="TEST_ONLY" record={{
    latest_status: "FAILED", latest_result: { error_class: "EXECUTION_TIMEOUT", safe_message: "Time limit reached." },
  }} />);
  assert.match(html, /Stopped.*time limit reached/);
  assert.match(html, /not running/);
  assert.match(html, /did not save its progress counters/);
  assert.doesNotMatch(html, /Waiting|Checking execution|Estimated remaining/);
});
test("Running, failed-with-progress and completed states show truthful counters and timing", () => {
  const progress = { completed_signals: 200, total_signals: 3500, percent_complete: 6,
    current_signal_date: "2013-07-19", stage: "Refreshing daily capital signal", elapsed_ms: 180000, estimated_remaining_ms: 600000,
    execution_timeout_ms: 1800000, stall_timeout_ms: 120000 };
  const running = renderToStaticMarkup(<ExecutionProgress runId="TEST_ONLY" record={{ latest_status: "RUNNING", progress }} />);
  assert.match(running, /200 \/ 3500 daily capital signals/); assert.match(running, /2013-07-19/);
  assert.match(running, /Estimated remaining/); assert.match(running, /30m 0s/);
  const failed = renderToStaticMarkup(<ExecutionProgress runId="TEST_ONLY" record={{ latest_status: "FAILED", progress, latest_result: { safe_message: "Worker stalled." } }} />);
  assert.match(failed, /Execution stopped/); assert.doesNotMatch(failed, /Estimated remaining|Checking execution/);
  const done = renderToStaticMarkup(<ExecutionProgress runId="TEST_ONLY" record={{ latest_status: "SUCCESS", progress }} />);
  assert.match(done, /Completed and saved/); assert.doesNotMatch(done, /Estimated remaining|Waiting/);
});
