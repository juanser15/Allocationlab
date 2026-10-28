import assert from "node:assert/strict";
import test from "node:test";
import { BacktestRangeIntent, executableDates, nextCalendarDay } from "./backtest-range";

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
