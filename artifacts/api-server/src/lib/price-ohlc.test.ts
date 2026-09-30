import assert from "node:assert/strict";
import test from "node:test";
import { adjustedOhlcCloseCsv, attachAdjustedOhlcRows, parseAdjustedOhlcCsv } from "./price-ohlc";
import { adjustYahooHistoricalRow } from "./yahoo";

const longCsv = [
  "Date,Ticker,Open,High,Low,Close",
  "2024-01-02,ABC,9,11,8,10",
  "2024-01-03,ABC,,12,9,11",
].join("\n");

function closeRows(csv: string) {
  const [header, ...lines] = csv.split(/\r?\n/);
  const tickers = header.split(",").slice(1);
  return lines.map((line) => {
    const [date, ...prices] = line.split(",");
    return { date, prices: Object.fromEntries(tickers.flatMap((ticker, index) =>
      prices[index] === "" ? [] : [[ticker, Number(prices[index])]])) };
  });
}

test("parses adjusted long OHLC and leaves unavailable opens absent", () => {
  const parsed = parseAdjustedOhlcCsv(longCsv).get("ABC")!;
  assert.deepEqual(parsed.opens, { "2024-01-02": 9 });
  assert.deepEqual(parsed.closes, { "2024-01-02": 10, "2024-01-03": 11 });
});

test("attaches adjusted ranges to legacy close rows without replacing close prices", () => {
  const rows = closeRows(adjustedOhlcCloseCsv(longCsv));
  const attached = attachAdjustedOhlcRows(rows, longCsv) as typeof rows & Array<{
    opens?: Record<string, number>; highs?: Record<string, number>; lows?: Record<string, number>;
  }>;
  assert.equal(attached[0].prices.ABC, 10);
  assert.equal(attached[0].opens?.ABC, 9);
  assert.equal(attached[1].opens?.ABC, undefined);
  assert.equal(attached[1].highs?.ABC, 12);
});

test("rejects missing required values and adjusted close disagreement", () => {
  assert.throws(() => parseAdjustedOhlcCsv("Date,Ticker,Open,High,Low,Close\n2024-01-02,ABC,9,,8,10"),
    /missing or invalid High/);
  assert.throws(() => attachAdjustedOhlcRows(closeRows("Date,ABC\n2024-01-02,10.01"), longCsv),
    /disagrees with legacy close/);
});

test("rejects a legacy close observation whose adjusted OHLC companion is absent", () => {
  const rows = closeRows("Date,ABC\n2024-01-02,10\n2024-01-03,11");
  assert.throws(() => attachAdjustedOhlcRows(rows, [
    "Date,Ticker,Open,High,Low,Close",
    "2024-01-02,ABC,9,11,8,10",
  ].join("\n")), /companion is missing ABC on 2024-01-03/);
});

test("Yahoo ingestion rejects missing adjClose rather than falling back to raw close", () => {
  assert.throws(() => adjustYahooHistoricalRow({
    rawClose: 100, adjustedClose: undefined, open: 99, high: 101, low: 98,
  }), /raw-close fallback is not allowed/);
});