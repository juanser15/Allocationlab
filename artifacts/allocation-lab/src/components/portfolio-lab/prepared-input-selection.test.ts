import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSelectionOptions,
  groupSelectionOptions,
  PREPARED_REPRESENTATIONS,
  representationFields,
  updateBulkSelection,
  type SelectionOption,
} from "./prepared-input-selection.ts";

const options: SelectionOption[] = [
  { id: "AAA", label: "Alpha Asset", group: "Technology" },
  { id: "BBB", label: "Beta Asset", group: "Financials" },
  { id: "CCC", label: "Gamma Asset" },
];

test("bulk selection applies only to the explicitly targeted visible options", () => {
  assert.deepEqual(updateBulkSelection(["BBB"], ["AAA", "CCC"], "select"), ["BBB", "AAA", "CCC"]);
  assert.deepEqual(updateBulkSelection(["AAA", "BBB", "CCC"], ["BBB"], "clear"), ["AAA", "CCC"]);
  assert.deepEqual(updateBulkSelection(["AAA", "BBB"], ["AAA", "BBB", "CCC"], "select"), ["AAA", "BBB", "CCC"]);
});

test("selection grouping uses provided sector groups and labels unavailable groups", () => {
  assert.deepEqual(groupSelectionOptions(options, true).map(group => [group.label, group.options.map(option => option.id)]), [
    ["Financials", ["BBB"]],
    ["Sector unavailable / not in Universe", ["CCC"]],
    ["Technology", ["AAA"]],
  ]);
  assert.deepEqual(groupSelectionOptions(options, false), [{ label: "", options }]);
});

test("search and selected filters only derive visible options and never mutate selection", () => {
  const selected = ["BBB"];
  const visible = filterSelectionOptions(options, "alpha", "all", selected);
  assert.deepEqual(visible.map(option => option.id), ["AAA"]);
  assert.deepEqual(filterSelectionOptions(options, "", "selected", selected).map(option => option.id), ["BBB"]);
  assert.deepEqual(filterSelectionOptions(options, "", "unselected", selected).map(option => option.id), ["AAA", "CCC"]);
  assert.deepEqual(selected, ["BBB"]);
});

test("representation controls remain separated without changing request enum identities", () => {
  assert.deepEqual(representationFields("asset_returns"), { assets: true, factors: false, alphaDefinitions: false });
  assert.deepEqual(representationFields("signals"), { assets: true, factors: true, alphaDefinitions: false });
  assert.deepEqual(representationFields("alpha_streams"), { assets: true, factors: true, alphaDefinitions: true });
  assert.deepEqual(PREPARED_REPRESENTATIONS.map(option => option.value), ["asset_returns", "alpha_streams", "signals"]);
});