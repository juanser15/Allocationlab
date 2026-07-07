import { Router, type IRouter } from "express";
import { db, priceDataTable } from "@workspace/db";
import {
  FetchLivePricesBody,
  FetchLivePricesResponse,
} from "@workspace/api-zod";
import { fetchLivePrices, buildCsvFromResults } from "../lib/yahoo";
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

  req.log.info({ tickers, lookbackDays }, "Starting Yahoo Finance live fetch");

  const fetchedAt = new Date().toISOString();
  const results = await fetchLivePrices(tickers, lookbackDays);

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

  // Persist to DB (same table as CSV uploads)
  await db.insert(priceDataTable).values({
    csvContent,
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
