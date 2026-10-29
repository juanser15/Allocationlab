import assert from "node:assert/strict";
import test from "node:test";
import { BacktestRangeIntent, backtestBoundsKey, currentBacktestBounds, executableDates, nextCalendarDay, requestCurrentPlan, researchDraftKey } from "./backtest-range";

const dates = { evaluation_start: "2022-01-03", evaluation_end_exclusive: "2026-10-01" };
test("Dataset defaults initialize once; refresh and navigation cannot reset dates", () => {
  const intent = new BacktestRangeIntent();
  const ticket = intent.enterDataset("A")!;
  assert.deepEqual(intent.resolve(ticket, dates), dates);
  assert.equal(intent.enterDataset("A"), null);
  intent.edit("evaluation_start");
  intent.edit("evaluation_end_exclusive");
  assert.equal(intent.enterDataset("A"), null);
});
test("A late default response cannot overwrite either manually edited calendar", () => {
  const intent = new BacktestRangeIntent();
  const ticket = intent.enterDataset("A")!;
  intent.edit("evaluation_start");
  assert.deepEqual(intent.resolve(ticket, dates), { evaluation_end_exclusive: dates.evaluation_end_exclusive });
  intent.edit("evaluation_end_exclusive");
  assert.deepEqual(intent.resolve(ticket, dates), {});
});
test("Dataset changes reset intent; old responses and out-of-order resets are discarded", () => {
  const intent = new BacktestRangeIntent();
  const old = intent.enterDataset("A")!;
  intent.edit("evaluation_start");
  const fresh = intent.enterDataset("B")!;
  assert.equal(intent.resolve(old, dates), null);
  assert.deepEqual(intent.resolve(fresh, dates), dates);
  const reset = intent.reset("B");
  assert.equal(intent.resolve(fresh, dates), null);
  assert.deepEqual(intent.resolve(reset, dates), dates);
});
test("Explicit full range replaces prior manual dates, but preserves edits made while it loads", () => {
  const intent = new BacktestRangeIntent();
  intent.enterDataset("A");
  intent.edit("evaluation_start");
  intent.edit("evaluation_end_exclusive");
  const ticket = intent.reset("A");
  assert.deepEqual(intent.resolve(ticket, dates), dates);
  intent.edit("evaluation_end_exclusive");
  assert.deepEqual(intent.resolve(ticket, dates), { evaluation_start: dates.evaluation_start });
});
test("Independent calendars do not overwrite one another", () => {
  const portfolio = new BacktestRangeIntent(), capital = new BacktestRangeIntent();
  const p = portfolio.enterDataset("A")!, c = capital.enterDataset("A")!;
  portfolio.edit("evaluation_start");
  assert.deepEqual(capital.resolve(c, dates), dates);
  assert.deepEqual(portfolio.resolve(p, dates), { evaluation_end_exclusive: dates.evaluation_end_exclusive });
});
test("Exclusive To includes the final observation; UTC month/year/leap transitions are exact", () => {
  assert.equal(nextCalendarDay("2026-09-30"), "2026-10-01");
  assert.equal(nextCalendarDay("2024-02-28"), "2024-02-29");
  assert.equal(nextCalendarDay("2024-02-29"), "2024-03-01");
  assert.equal(nextCalendarDay("2026-12-31"), "2027-01-01");
  assert.throws(() => nextCalendarDay("2026-02-30"));
});
test("Use server training/warmup bounds, not the first raw observation or today's date", () => {
  const caps = { dataset_id: "A", data_first_observation: "2020-01-02", data_last_observation: "2026-09-30" };
  const bounds = { dataset_id: "A", earliest_supported_evaluation_start: dates.evaluation_start, latest_supported_evaluation_end_exclusive: dates.evaluation_end_exclusive };
  assert.deepEqual(executableDates(bounds, caps), dates);
  assert.throws(() => executableDates({ ...bounds, dataset_id: "B" }, caps));
  assert.throws(() => executableDates({ ...bounds, earliest_supported_evaluation_start: "2026-09-30" }, caps));
  assert.throws(() => executableDates({ ...bounds, latest_supported_evaluation_end_exclusive: "2026-11-01" }, caps));
});

const caps = { dataset_id: "A", dataset_version: 1, dataset_hash: "SYNTHETIC", data_first_observation: "2010-10-01", data_last_observation: "2026-09-30" };
const earlyDesign = { dataset_id: "A", evaluation_start: "2012-10-01", evaluation_end_exclusive: "2026-10-01", etfs: ["SPY"], regime_model: "HMM", training_window_months: 24, forecast: { model: "HISTORICAL_MEAN" } };
const laterDesign = { ...earlyDesign, etfs: ["SPY", "LATE_TEST_ONLY"] };
test("Same-dataset asset/model/training/forecast changes invalidate cached executable metadata, not selected dates", () => {
  const before = JSON.stringify(earlyDesign), key = backtestBoundsKey(earlyDesign, caps);
  for (const change of [laterDesign, { ...earlyDesign, training_window_months: 36 }, { ...earlyDesign, regime_model: "TREND_VOL" }, { ...earlyDesign, forecast: { model: "SIGNAL_RIDGE" } }]) {
    assert.notEqual(backtestBoundsKey(change, caps), key);
  }
  assert.equal(backtestBoundsKey({ ...earlyDesign, evaluation_start: "2013-03-01" }, caps), key);
  assert.notEqual(backtestBoundsKey(earlyDesign, { ...caps, dataset_hash: "REPLACEMENT_TEST_ONLY" }), key);
  assert.equal(JSON.stringify(earlyDesign), before);
  assert.equal(researchDraftKey({ a: 1, b: 2 }), researchDraftKey({ b: 2, a: 1 }));
});
test("A 2012 cached range is hidden before refresh when the selected universe needs a 2020 start", () => {
  const oldKey = backtestBoundsKey(earlyDesign, caps), newKey = backtestBoundsKey(laterDesign, caps);
  const old = { context: oldKey, busy: false, error: "", bounds: { earliest_supported_evaluation_start: "2012-10-01" } };
  assert.deepEqual(currentBacktestBounds(old, newKey, true), { context: newKey, busy: true, error: "", bounds: null });
  assert.equal(currentBacktestBounds({ ...old, error: "old failure" }, newKey, true).error, "");
  const fresh = { context: newKey, busy: false, error: "", bounds: { earliest_supported_evaluation_start: "2020-06-19" } };
  assert.equal(currentBacktestBounds(fresh, newKey, true).bounds, fresh.bounds);
  assert.equal(currentBacktestBounds(fresh, newKey, false).bounds, null);
  assert.equal(laterDesign.evaluation_start, "2012-10-01");
});
test("Metadata-only refresh cannot apply bounds, and old same-dataset responses lose the request race", async () => {
  const intent = new BacktestRangeIntent();
  const old = intent.observe("A", backtestBoundsKey(earlyDesign, caps))!;
  const fresh = intent.observe("A", backtestBoundsKey(laterDesign, caps))!;
  const proposed = { evaluation_start: "2020-06-19", evaluation_end_exclusive: "2026-10-01" };
  assert.deepEqual(intent.resolve(fresh, proposed, laterDesign), {});
  await Promise.resolve();
  assert.equal(intent.resolve(old, dates, earlyDesign), null);
  assert.equal(intent.isCurrent(old), false);
  assert.equal(intent.observe("A", backtestBoundsKey(laterDesign, caps)), null);
  assert.equal(laterDesign.evaluation_start, "2012-10-01");
});
test("Dataset refresh preserves populated user dates; only explicit current full-range action may replace them", () => {
  const intent = new BacktestRangeIntent();
  const first = intent.observe("A", "A/current")!;
  assert.deepEqual(intent.resolve(first, dates, { evaluation_start: "", evaluation_end_exclusive: "" }), dates);
  const changed = intent.observe("B", "B/current")!;
  assert.deepEqual(intent.resolve(changed, dates, earlyDesign), {});
  const requested = intent.reset("B", "B/current");
  intent.edit("evaluation_end_exclusive");
  assert.deepEqual(intent.resolve(requested, dates, earlyDesign), { evaluation_start: dates.evaluation_start });
  const obsoleteReset = intent.reset("B", "B/old");
  intent.observe("B", "B/new");
  assert.equal(intent.resolve(obsoleteReset, dates, earlyDesign), null);
});

test("Delayed plan coverage failure from an edited design cannot overwrite current feedback or submit a run", async () => {
  const submitted = { ...earlyDesign }, before = JSON.stringify(submitted);
  let current = true, reject!: (reason: unknown) => void, submissions = 0;
  const pending = requestCurrentPlan(submitted, () => new Promise((_resolve, fail) => { reject = fail; }), () => current)
    .then(() => { submissions++; });
  current = false;
  const oldFailure = Object.assign(new Error("OLD_REQUEST_DATA_COVERAGE: requires 2020-06-19"), { category: "DATA_COVERAGE", suggestedAction: "Change the old request date" });
  reject(oldFailure);
  await assert.rejects(pending, (error: any) => /design changed/.test(error.message) && !/OLD_REQUEST|2020-06-19/.test(error.message) && error.category === undefined);
  assert.equal(submissions, 0);
  assert.equal(JSON.stringify(submitted), before);
  await assert.rejects(requestCurrentPlan(submitted, async () => { throw oldFailure; }, () => true), error => error === oldFailure);
});
test("Delayed successful plans are fenced too; current plans must preserve exact user dates", async () => {
  let current = true, resolve!: (value: any) => void;
  const pending = requestCurrentPlan(earlyDesign, () => new Promise(done => { resolve = done; }), () => current);
  current = false;
  resolve({ normalized_request: { ...earlyDesign } });
  await assert.rejects(pending, /design changed/);
  const valid = { normalized_request: { ...earlyDesign } };
  assert.equal(await requestCurrentPlan(earlyDesign, async () => valid, () => true), valid);
  await assert.rejects(requestCurrentPlan(earlyDesign, async () => ({ normalized_request: { ...earlyDesign, evaluation_start: "2020-06-19" } }), () => true), /planner changed the requested dates/);
});
