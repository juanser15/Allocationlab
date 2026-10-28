/** Independent wall-clock and no-forward-progress safeguards. Injectable timers make deadlines testable without running models. */
export function executionWatchdog(
  budget: { execution_timeout_ms: number; stall_timeout_ms: number },
  expire: (code: "EXECUTION_TIMEOUT" | "EXECUTION_STALLED") => void,
  timers = { set: setTimeout, clear: clearTimeout },
) {
  let closed = false, completed = -1;
  let idle: ReturnType<typeof setTimeout>;
  const stop = () => {
    if (closed) return;
    closed = true;
    timers.clear(total);
    timers.clear(idle);
  };
  const fail = (code: "EXECUTION_TIMEOUT" | "EXECUTION_STALLED") => {
    if (closed) return;
    stop();
    expire(code);
  };
  const total = timers.set(() => fail("EXECUTION_TIMEOUT"), budget.execution_timeout_ms);
  const arm = () => {
    timers.clear(idle);
    idle = timers.set(() => fail("EXECUTION_STALLED"), budget.stall_timeout_ms);
  };
  arm();
  return {
    stop,
    advance(units: number) {
      if (closed || !Number.isFinite(units) || units <= completed) return;
      completed = units;
      arm();
    },
  };
}
