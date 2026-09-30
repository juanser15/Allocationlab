import { Router, type IRouter } from "express";
import { db, priceDataTable } from "@workspace/db";
import {
  FetchLivePricesBody,
  FetchLivePricesResponse,
} from "@workspace/api-zod";
import { fetchLivePrices, buildCsvFromResults, buildAdjustedOhlcCsvFromResults } from "../lib/yahoo";
import { attachAdjustedOhlcRows } from "../lib/price-ohlc";
import { parseCsv } from "../lib/calculator";
import { getUniverseConfig } from "./universe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/prices/live", async (req, res): Promise<void> => {
  const parsed = FetchLivePricesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const lookbackDays = parsed.data.lookbackDays ?? 400;
  const explicitStartDate = parsed.data.startDate ? new Date(parsed.data.startDate) : undefined;
  const explicitEndDate = parsed.data.endDate ? new Date(parsed.data.endDate) : undefined;

  // Determine which tickers to fetch
  let tickers: string[];
  if (parsed.data.tickers && parsed.data.tickers.length > 0) {
    tickers = parsed.data.tickers;
  } else {
    const universe = await getUniverseConfig();
    tickers = (universe.etfs as Array<{ ticker: string; enabled: boolean }>)
      .filter((e) => e.enabled)
      .map((e) => e.ticker);
  }

  if (tickers.length === 0) {
    res.status(400).json({ error: "No tickers to fetch. Enable at least one ETF in your universe." });
    return;
  }

  if (explicitStartDate && isNaN(explicitStartDate.getTime())) {
    res.status(400).json({ error: "Invalid startDate." });
    return;
  }
  if (explicitEndDate && isNaN(explicitEndDate.getTime())) {
    res.status(400).json({ error: "Invalid endDate." });
    return;
  }
  if (explicitStartDate && explicitEndDate && explicitStartDate >= explicitEndDate) {
    res.status(400).json({ error: "startDate must be before endDate." });
    return;
  }

  req.log.info({ tickers, lookbackDays, explicitStartDate, explicitEndDate }, "Starting Yahoo Finance live fetch");

  const fetchedAt = new Date().toISOString();
  const results = await fetchLivePrices(tickers, lookbackDays, explicitStartDate, explicitEndDate);

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const succeededPayload = succeeded.map((r) => ({
    ticker: r.ticker,
    success: true,
    rows: r.rows,
    error: null,
  }));

  const failedPayload = failed.map((r) => ({
    ticker: r.ticker,
    success: false,
    rows: 0,
    error: r.error,
  }));

  if (succeeded.length === 0) {
    const response = {
      succeeded: succeededPayload,
      failed: failedPayload,
      totalRows: 0,
      startDate: null,
      endDate: null,
      savedToDb: false,
      message: `All ${failed.length} ticker(s) failed to download. Check your internet connection or try again later.`,
      fetchedAt,
    };
    res.status(503).json(FetchLivePricesResponse.parse(response));
    return;
  }

  // Build CSV from all successful results
  const csvContent = buildCsvFromResults(results);
  const ohlcCsvContent = buildAdjustedOhlcCsvFromResults(results);

  // Compute date range from the CSV
  const lines = csvContent.split("\n").filter((l) => l.trim() && !l.startsWith("Date"));
  const dates = lines.map((l) => l.split(",")[0]).filter(Boolean).sort();
  const startDate = dates[0] ?? null;
  const endDate = dates[dates.length - 1] ?? null;
  const rowCount = lines.length;

  if (rowCount < 21) {
    const response = {
      succeeded: succeededPayload,
      failed: failedPayload,
      totalRows: rowCount,
      startDate,
      endDate,
      savedToDb: false,
      message: `Only ${rowCount} rows downloaded — need at least 21 for factor computation. Try a longer lookback period.`,
      fetchedAt,
    };
    res.status(503).json(FetchLivePricesResponse.parse(response));
    return;
  }

  // Validate the companion against the exact legacy CSV before persisting either value.
  if (ohlcCsvContent) attachAdjustedOhlcRows(parseCsv(csvContent), ohlcCsvContent);

  // Persist to DB (same table as CSV uploads)
  await db.insert(priceDataTable).values({
    csvContent,
    ...(ohlcCsvContent ? { ohlcCsvContent } : {}),
    tickers: JSON.stringify(succeeded.map((r) => r.ticker).sort()),
    startDate: startDate!,
    endDate: endDate!,
    rowCount,
  });

  logger.info(
    { succeeded: succeeded.length, failed: failed.length, rowCount, startDate, endDate },
    "Live price fetch complete"
  );

  let message: string;
  if (failed.length === 0) {
    message = `Successfully downloaded ${succeeded.length} tickers (${rowCount} rows, ${startDate} to ${endDate}).`;
  } else {
    const failedNames = failed.map((f) => f.ticker).join(", ");
    message = `Downloaded ${succeeded.length}/${tickers.length} tickers (${rowCount} rows). Skipped: ${failedNames}.`;
  }

  const response = {
    succeeded: succeededPayload,
    failed: failedPayload,
    totalRows: rowCount,
    startDate,
    endDate,
    savedToDb: true,
    message,
    fetchedAt,
  };

  res.json(FetchLivePricesResponse.parse(response));
});

export default router;
