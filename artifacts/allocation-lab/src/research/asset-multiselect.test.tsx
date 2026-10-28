import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetMultiselect, availableOptions, reconcileSelection, filterOptions, chipSummary } from "./asset-multiselect";

test("Options come exclusively from live capabilities, including unknown symbols", () => {
  assert.deepEqual(availableOptions(["SPY", "NEW_ASSET", "SPY", null, ""]), ["SPY", "NEW_ASSET"]);
  assert.deepEqual(availableOptions(undefined), []);
  assert.deepEqual(availableOptions({ etfs: ["SPY"] }), []);
});
test("Dataset changes preserve intersection without replacements; cleared stays cleared", () => {
  assert.deepEqual(reconcileSelection(["SPY", "GLD", "NEW_ASSET"], ["SPY", "SGOV"]), { kept: ["SPY"], removed: ["GLD", "NEW_ASSET"] });
  assert.deepEqual(reconcileSelection([], ["SPY", "SGOV"]), { kept: [], removed: [] });
});
test("Search matches names and tickers, case-insensitively; unknown names remain selectable", () => {
  const options = ["SPY", "NEW_ASSET", "XLK"];
  assert.deepEqual(filterOptions(options, " new_ "), ["NEW_ASSET"]);
  assert.deepEqual(filterOptions(options, "technology", { XLK: "Technology" }), ["XLK"]);
  assert.deepEqual(filterOptions(options, "missing"), []);
  assert.deepEqual(filterOptions(options, ""), options);
});
test("Closed selector never renders a universe grid or the full selected list", () => {
  const options = Array.from({ length: 150 }, (_, i) => `ASSET_${i}`);
  assert.deepEqual(chipSummary(options), { shown: options.slice(0, 4), more: 146 });
  const markup = renderToStaticMarkup(<AssetMultiselect options={options} value={options} onChange={() => {}} />);
  assert.match(markup, /150 of 150 selected/);
  assert.match(markup, /\+146 more/);
  assert.doesNotMatch(markup, /type="checkbox"|ASSET_149|role="dialog"/);
  assert.match(markup, /aria-expanded="false"/);
});
test("Loading and access errors disable selection instead of supplying a fallback universe", () => {
  const loading = renderToStaticMarkup(<AssetMultiselect options={[]} value={["SPY"]} onChange={() => {}} loading />);
  assert.match(loading, /Loading assets/);
  assert.match(loading, /disabled/);
  const error = renderToStaticMarkup(<AssetMultiselect options={[]} value={[]} onChange={() => {}} error="Unavailable" />);
  assert.match(error, /Assets unavailable/);
  assert.match(error, /disabled/);
});
