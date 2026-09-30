import type { PriceRow } from "./calculator";

export const ADJUSTED_OHLC_CONVENTION =
  "fully adjusted OHLC; raw Open/High/Low/Close multiplied by adjClose/rawClose; four-decimal rounding";

export interface AdjustedOhlcByTicker {
  opens: Record<string, number>;
  highs: Record<string, number>;
  lows: Record<string, number>;
  closes: Record<string, number>;
}

function parsePositive(value: string | undefined, label: string, allowMissing = false): number | undefined {
  if ((value === undefined || value.trim() === "") && allowMissing) return undefined;
  const parsed = value === undefined || value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`Adjusted OHLC CSV has a missing or invalid ${label}.`);
  return parsed;
}

/** Parses long-form, fully adjusted OHLC data keyed by ticker then date. */
export function parseAdjustedOhlcCsv(csv: string): Map<string, AdjustedOhlcByTicker> {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) throw new Error("Adjusted OHLC CSV is empty.");
  const header = lines[0].split(",").map((field) => field.trim().toLowerCase());
  if (header.join(",") !== "date,ticker,open,high,low,close")
    throw new Error("Adjusted OHLC CSV must have columns Date,Ticker,Open,High,Low,Close in that order.");

  const result = new Map<string, AdjustedOhlcByTicker>();
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index++) {
    const fields = lines[index].split(",");
    if (fields.length !== 6) throw new Error(`Adjusted OHLC CSV row ${index + 1} must contain six fields.`);
    const [date, rawTicker] = fields;
    const ticker = rawTicker.trim().toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !ticker)
      throw new Error(`Adjusted OHLC CSV row ${index + 1} has an invalid date or ticker.`);
    const key = `${ticker}\u0000${date.trim()}`;
    if (seen.has(key)) throw new Error(`Adjusted OHLC CSV contains duplicate ${ticker} data for ${date}.`);
    seen.add(key);
    const open = parsePositive(fields[2], `Open for ${ticker} on ${date}`, true);
    const high = parsePositive(fields[3], `High for ${ticker} on ${date}`)!;
    const low = parsePositive(fields[4], `Low for ${ticker} on ${date}`)!;
    const close = parsePositive(fields[5], `Close for ${ticker} on ${date}`)!;
    if (high < low || close > high + 0.0001 || close < low - 0.0001 ||
        (open !== undefined && (open > high + 0.0001 || open < low - 0.0001)))
      throw new Error(`Adjusted OHLC CSV has inconsistent adjusted prices for ${ticker} on ${date}.`);
    let tickerRows = result.get(ticker);
    if (!tickerRows) {
      tickerRows = { opens: {}, highs: {}, lows: {}, closes: {} };
      result.set(ticker, tickerRows);
    }
    const day = date.trim();
    if (open !== undefined) tickerRows.opens[day] = open;
    tickerRows.highs[day] = high;
    tickerRows.lows[day] = low;
    tickerRows.closes[day] = close;
  }
  if (!seen.size) throw new Error("Adjusted OHLC CSV contains no price rows.");
  return result;
}

/** Adds parsed adjusted OHLC values to close-only rows without changing prices. */
export function attachAdjustedOhlcRows(rows: PriceRow[], csv: string): PriceRow[] {
  const adjusted = parseAdjustedOhlcCsv(csv);
  for (const row of rows) {
    for (const [rawTicker, price] of Object.entries(row.prices)) {
      if (price === undefined) continue;
      const ticker = rawTicker.toUpperCase();
      const close = adjusted.get(ticker)?.closes[row.date];
      if (close === undefined)
        throw new Error(`Adjusted OHLC companion is missing ${ticker} on ${row.date}; mixed-scale prices are not allowed.`);
      if (!Number.isFinite(price) || Math.abs(price - close) > 0.0001)
        throw new Error(`Adjusted OHLC Close for ${ticker} on ${row.date} disagrees with legacy close price.`);
    }
  }
  for (const [ticker, fields] of adjusted) {
    for (const [date, close] of Object.entries(fields.closes)) {
      const row = rows.find((candidate) => candidate.date === date);
      if (!row || !Number.isFinite(row.prices[ticker]))
        throw new Error(`Adjusted OHLC ${ticker} on ${date} has no matching legacy adjusted-close row.`);
      if (Math.abs(row.prices[ticker] - close) > 0.0001)
        throw new Error(`Adjusted OHLC Close for ${ticker} on ${date} disagrees with legacy close price.`);
    }
  }
  return rows.map((row) => {
    const open: Record<string, number> = {}, high: Record<string, number> = {};
    const low: Record<string, number> = {};
    for (const [ticker, fields] of adjusted) {
      if (fields.opens[row.date] !== undefined) open[ticker] = fields.opens[row.date];
      if (fields.highs[row.date] !== undefined) high[ticker] = fields.highs[row.date];
      if (fields.lows[row.date] !== undefined) low[ticker] = fields.lows[row.date];
    }
    return { ...row, opens: open, highs: high, lows: low } as PriceRow;
  });
}

/** Turns long-form adjusted OHLC into the legacy wide adjusted-close CSV. */
export function adjustedOhlcCloseCsv(csv: string): string {
  const parsed = parseAdjustedOhlcCsv(csv);
  const tickers = [...parsed.keys()].sort();
  const dates = [...new Set(tickers.flatMap((ticker) => Object.keys(parsed.get(ticker)!.closes)))].sort();
  const lines = [["Date", ...tickers].join(",")];
  for (const date of dates) {
    const prices = tickers.map((ticker) => parsed.get(ticker)!.closes[date]);
    if (prices.some((price) => price !== undefined))
      lines.push([date, ...prices.map((price) => price === undefined ? "" : String(price))].join(","));
  }
  return lines.join("\n");
}