import assert from "node:assert/strict";
import test from "node:test";
import { readStartingSelection, writeStartingSelection, STARTING_SELECTION_KEY } from "./starting-selection-store.ts";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const book = { asOf: "2024-03-29", quantities: { SPY: 10 }, cash: 5, nav: 100 };

test("no key inherits undefined and nothing is written on read", () => {
  const s = mem();
  assert.equal(readStartingSelection(s), undefined);
  assert.equal(s.m.size, 0);
});
test("explicit ignore survives refresh", () => {
  const s = mem();
  writeStartingSelection(s, { mode: "ignore" });
  assert.deepEqual(readStartingSelection(s), { mode: "ignore" });
});
test("book mode and holdings preserved", () => {
  const s = mem();
  writeStartingSelection(s, { mode: "manual", holdings: book, sourceLabel: "typed" });
  assert.deepEqual(readStartingSelection(s), { mode: "manual", holdings: book, sourceLabel: "typed" });
});
test("malformed book fails closed without fallback", () => {
  const s = mem();
  s.setItem(STARTING_SELECTION_KEY, JSON.stringify({ v: 1, selection: { mode: "saved", holdings: { ...book, nav: -1 } } }));
  assert.deepEqual(readStartingSelection(s), { mode: "saved" });
});
test("garbage payload or unknown mode inherits", () => {
  const s = mem();
  s.setItem(STARTING_SELECTION_KEY, "{not json");
  assert.equal(readStartingSelection(s), undefined);
  s.setItem(STARTING_SELECTION_KEY, JSON.stringify({ v: 1, selection: { mode: "weird" } }));
  assert.equal(readStartingSelection(s), undefined);
});
