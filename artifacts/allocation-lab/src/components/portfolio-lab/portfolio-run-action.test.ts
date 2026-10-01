import assert from "node:assert/strict";
import test from "node:test";
import { registerRunAction } from "./portfolio-run-action.ts";

test("registering and unregistering a run action never invokes its run callback", () => {
  let runCount = 0;
  const registrations: (boolean | null)[] = [];
  const action = {
    run: () => { runCount += 1; },
    disabled: false,
    busy: false,
  };
  const cleanup = registerRunAction(() => next => registrations.push(next ? next === action : null), action);

  assert.deepEqual(registrations, [true]);
  assert.equal(runCount, 0);
  cleanup();
  assert.deepEqual(registrations, [true, null]);
  assert.equal(runCount, 0);
});