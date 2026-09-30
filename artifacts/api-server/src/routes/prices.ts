import { Router, type IRouter } from "express";
import { db, priceDataTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  GetPricesStatusResponse,
  UploadPricesBody,
  UploadPricesResponse,
} from "@workspace/api-zod";
import { parseCsv } from "../lib/calculator";
import { adjustedOhlcCloseCsv, attachAdjustedOhlcRows, parseAdjustedOhlcCsv } from "../lib/price-ohlc";

const router: IRouter = Router();

export async function getLatestPriceData() {
  const rows = await db
    .select()
    .from(priceDataTable)
    .orderBy(desc(priceDataTable.uploadedAt))
    .limit(1);
  return rows[0] ?? null;
}

function buildStatus(row: { tickers: string; startDate: string; endDate: string; rowCount: number } | null, missingTickers: string[] = []) {
  if (!row) {
    return {
      hasData: false,
      tickers: [],
      startDate: null,
      endDate: null,
      rowCount: 0,
      missingTickers,
      message: "No price data loaded. Please upload a CSV or enable live data.",
    };
  }
  const tickers = JSON.parse(row.tickers) as string[];
  return {
    hasData: true,
    tickers,
    startDate: row.startDate,
    endDate: row.endDate,
    rowCount: row.rowCount,
    missingTickers,
    message: `Price data loaded: ${tickers.length} tickers from ${row.startDate} to ${row.endDate} (${row.rowCount} rows).`,
  };
}

router.get("/prices/status", async (req, res): Promise<void> => {
  const latest = await getLatestPriceData();
  const status = buildStatus(latest);
  res.json(GetPricesStatusResponse.parse(status));
});

router.post("/prices/upload", async (req, res): Promise<void> => {
  const parsed = UploadPricesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let rows;
  let csvContent = parsed.data.csvContent;
  let ohlcCsvContent: string | undefined;
  try {
    const header = parsed.data.csvContent.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]
      .split(",").map((field) => field.trim().toLowerCase()).join(",");
    if (header === "date,ticker,open,high,low,close") {
      // Parse first for explicit row/field validation, then persist the companion unchanged.
      parseAdjustedOhlcCsv(parsed.data.csvContent);
      ohlcCsvContent = parsed.data.csvContent;
      csvContent = adjustedOhlcCloseCsv(parsed.data.csvContent);
    }
    rows = parseCsv(csvContent);
    if (ohlcCsvContent) attachAdjustedOhlcRows(rows, ohlcCsvContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "CSV parse error";
    req.log.warn({ err }, "CSV parse error");
    res.status(400).json({ error: msg });
    return;
  }

  if (rows.length < 21) {
    res.status(400).json({ error: "CSV must contain at least 21 rows of price data (needed for factor computation)." });
    return;
  }

  const allTickers = new Set<string>();
  for (const row of rows) {
    for (const ticker of Object.keys(row.prices)) {
      allTickers.add(ticker);
    }
  }

  const tickersList = Array.from(allTickers).sort();
  const startDate = rows[0].date;
  const endDate = rows[rows.length - 1].date;

  await db.insert(priceDataTable).values({
    csvContent,
    ...(ohlcCsvContent ? { ohlcCsvContent } : {}),
    tickers: JSON.stringify(tickersList),
    startDate,
    endDate,
    rowCount: rows.length,
  });

  const status = buildStatus({
    tickers: JSON.stringify(tickersList),
    startDate,
    endDate,
    rowCount: rows.length,
  });
  res.json(UploadPricesResponse.parse(status));
});

export default router;
