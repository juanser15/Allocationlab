import assert from "node:assert/strict";
import test from "node:test";
import { resolveTopAction, sameAction, storeAction } from "./pm-shell-ui.ts";

const noop = () => undefined;
test("resolve never runs and disables while inspecting", () => {
  let calls = 0;
  const run = () => { calls++; };
  const r = resolveTopAction({ registered: { run, disabled: false, busy: false }, fallback: noop, fallbackDisabled: false, fallbackBusy: false, inspecting: true, b2Mode: true });
  assert.equal(calls, 0);
  assert.equal(r.disabled, true);
});
test("B2 without registry is disabled and never uses legacy handler", () => {
  const fb = () => undefined;
  const r = resolveTopAction({ registered: null, fallback: fb, fallbackDisabled: false, fallbackBusy: false, inspecting: false, b2Mode: true });
  assert.notEqual(r.run, fb);
  assert.equal(r.disabled, true);
});
test("legacy mode falls back to legacy handler", () => {
  const fb = () => undefined;
  const r = resolveTopAction({ registered: null, fallback: fb, fallbackDisabled: false, fallbackBusy: false, inspecting: false, b2Mode: false });
  assert.equal(r.run, fb);
  assert.equal(r.disabled, false);
});
test("storeAction wraps; sameAction compares fields", () => {
  const a = { run: noop, disabled: false, busy: false };
  assert.equal(storeAction(a)(), a);
  assert.ok(sameAction(a, { ...a }));
});
