/**
 * Yahoo Finance price fetcher with retry and timeout logic.
 * Uses yahoo-finance2 v3 for adjusted close prices.
 */

import YahooFinance from "yahoo-finance2";
import { logger } from "./logger";

const yahooFinance = new YahooFinance();

export interface TickerFetchResult {
  ticker: string;
  success: boolean;
  rows: number;
  error: string | null;
  prices?: Record<string, number>; // date -> adjusted close
  ohlc?: Record<string, { open?: number; high: number; low: number; close: number }>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const TICKER_TIMEOUT_MS = 20000;

export interface AdjustedYahooRow {
  rawClose: number | null | undefined;
  adjustedClose: number | null | undefined;
  open?: number | null;
  high?: number | null;
  low?: number | null;
}

export function adjustYahooHistoricalRow(row: AdjustedYahooRow): {
  close: number;
  ohlc: { open?: number; high: number; low: number; close: number };
} {
  if (row.rawClose == null || !Number.isFinite(row.rawClose) || row.rawClose <= 0)
    throw new Error("Yahoo Finance row has no valid raw close; the adjusted OHLC factor cannot be computed.");
  if (row.adjustedClose == null || !Number.isFinite(row.adjustedClose) || row.adjustedClose <= 0)
    throw new Error("Yahoo Finance row has no valid adjClose; raw-close fallback is not allowed for new ingestion.");
  const factor = row.adjustedClose / row.rawClose;
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("Yahoo Finance row has an invalid adjClose/rawClose adjustment factor.");
  const high = row.high == null ? NaN : row.high * factor;
  const low = row.low == null ? NaN : row.low * factor;
  if (!Number.isFinite(high) || high <= 0 || !Number.isFinite(low) || low <= 0)
    throw new Error("Yahoo Finance row has a missing or invalid raw High/Low; adjusted OHLC cannot be persisted.");
  const close = Math.round(row.adjustedClose * 10000) / 10000;
  const open = row.open != null && Number.isFinite(row.open) && row.open > 0
    ? Math.round(row.open * factor * 10000) / 10000 : undefined;
  return {
    close,
    ohlc: {
      ...(open === undefined ? {} : { open }),
      high: Math.round(high * 10000) / 10000,
      low: Math.round(low * 10000) / 10000,
      close,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTickerWithTimeout(
  ticker: string,
  startDate: Date,
  endDate: Date,
  timeoutMs: number
): Promise<{ prices: Record<string, number>; ohlc: TickerFetchResult["ohlc"] }> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
  );

  const fetchPromise = yahooFinance.historical(ticker, {
    period1: startDate,
    period2: endDate,
    interval: "1d" as const,
    events: "history" as const,
    includeAdjustedClose: true,
  });

  const result = await Promise.race([fetchPromise, timeoutPromise]);

  const prices: Record<string, number> = {};
  const ohlc: NonNullable<TickerFetchResult["ohlc"]> = {};
  for (const row of result) {
    if (!row.date) continue;
    const dateStr = (row.date instanceof Date ? row.date : new Date(row.date))
      .toISOString()
      .slice(0, 10);
    const yahooRow = row as { adjClose?: number | null; open?: number | null; high?: number | null; low?: number | null };
    const adjusted = adjustYahooHistoricalRow({
      rawClose: row.close, adjustedClose: yahooRow.adjClose,
      open: yahooRow.open, high: yahooRow.high, low: yahooRow.low,
    });
    prices[dateStr] = adjusted.close;
    ohlc[dateStr] = adjusted.ohlc;
  }

  return { prices, ohlc };
}

async function fetchTickerWithRetry(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<TickerFetchResult> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.debug({ ticker, attempt }, "Fetching Yahoo Finance data");
      const fetched = await fetchTickerWithTimeout(ticker, startDate, endDate, TICKER_TIMEOUT_MS);
      const { prices } = fetched;
      const rows = Object.keys(prices).length;

      if (rows === 0) {
        lastError = "Yahoo Finance returned no price rows for this ticker";
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return { ticker, success: false, rows: 0, error: lastError };
      }

      logger.info({ ticker, rows }, "Price data fetched successfully");
      return { ticker, success: true, rows, error: null, prices, ohlc: fetched.ohlc };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg.includes("Not Found") || msg.includes("404")
        ? `Ticker "${ticker}" not found on Yahoo Finance`
        : msg.includes("Timeout")
        ? `Request timed out after ${TICKER_TIMEOUT_MS / 1000}s`
        : `Yahoo Finance error: ${msg}`;

      logger.warn({ ticker, attempt, error: lastError }, "Yahoo Finance fetch attempt failed");

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return { ticker, success: false, rows: 0, error: lastError };
}

export async function fetchLivePrices(
  tickers: string[],
  lookbackDays = 400,
  explicitStartDate?: Date,
  explicitEndDate?: Date
): Promise<TickerFetchResult[]> {
  const endDate = explicitEndDate ?? new Date();
  const startDate = explicitStartDate ?? (() => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - lookbackDays);
    return d;
  })();

  const results: TickerFetchResult[] = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const result = await fetchTickerWithRetry(ticker, startDate, endDate);
    results.push(result);
    // Brief pause between tickers to avoid Yahoo rate limiting
    if (i < tickers.length - 1) {
      await sleep(350);
    }
  }

  return results;
}

export function buildCsvFromResults(results: TickerFetchResult[]): string {
  const successful = results.filter((r) => r.success && r.prices);
  if (successful.length === 0) return "";

  // Collect all dates across all successful tickers
  const allDates = new Set<string>();
  for (const r of successful) {
    for (const date of Object.keys(r.prices!)) {
      allDates.add(date);
    }
  }

  const sortedDates = Array.from(allDates).sort();
  const tickers = successful.map((r) => r.ticker);

  const lines: string[] = [];
  lines.push(["Date", ...tickers].join(","));

  for (const date of sortedDates) {
    const row: string[] = [date];
    let hasAny = false;
    for (const r of successful) {
      const price = r.prices![date];
      if (price != null) {
        row.push(String(price));
        hasAny = true;
      } else {
        row.push("");
      }
    }
    if (hasAny) {
      lines.push(row.join(","));
    }
  }

  return lines.join("\n");
}

export function buildAdjustedOhlcCsvFromResults(results: TickerFetchResult[]): string {
  const successful = results.filter((result) => result.success && result.ohlc);
  const tickers = successful.map((result) => result.ticker).sort();
  const dates = [...new Set(successful.flatMap((result) => Object.keys(result.ohlc!)))].sort();
  if (!tickers.length || !dates.length) return "";
  const lines = ["Date,Ticker,Open,High,Low,Close"];
  for (const date of dates) {
    for (const result of successful) {
      const values = result.ohlc![date];
      if (!values) continue;
      lines.push([date, result.ticker, values.open === undefined ? "" : String(values.open),
        String(values.high), String(values.low), String(values.close)].join(","));
    }
  }
  return lines.join("\n");
}
