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
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const TICKER_TIMEOUT_MS = 20000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTickerWithTimeout(
  ticker: string,
  startDate: Date,
  endDate: Date,
  timeoutMs: number
): Promise<Record<string, number>> {
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
  for (const row of result) {
    if (!row.date) continue;
    const dateStr = (row.date instanceof Date ? row.date : new Date(row.date))
      .toISOString()
      .slice(0, 10);
    // Prefer adjClose, fall back to close
    const price = (row as { adjClose?: number }).adjClose ?? row.close;
    if (price != null && price > 0) {
      prices[dateStr] = Math.round(price * 10000) / 10000;
    }
  }

  return prices;
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
      const prices = await fetchTickerWithTimeout(ticker, startDate, endDate, TICKER_TIMEOUT_MS);
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
      return { ticker, success: true, rows, error: null, prices };
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
