import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  ComposePreparedInputBody, ComposePreparedInputParams, ComposePreparedInputResponse,
  GetPreparedInputParams, GetPreparedInputResponse, ListPreparedInputsResponse,
  ListPreparedInputSummariesResponse, PrepareInputsBody, PrepareInputsResponse,
  ReplayPreparedInputParams, ReplayPreparedInputResponse,
} from "@workspace/api-zod";
import { db, preparedInputsTable, priceDataTable } from "@workspace/db";
import { getFactorSetSnapshot } from "../lib/factor-library";
import { hashDataset } from "../lib/run-snapshot";
import { preparedInputSummaryProjection } from "../lib/prepared-input-summary";
import {
  composePreparedSnapshot, fingerprint, prepareSnapshot, replayPreparedSnapshot, snapshotStatus,
  validatePreparedRequest, PREPARED_INPUT_ENGINE_VERSION, type PreparedRequest, type PreparedSnapshot,
} from "../lib/prepared-inputs";

const router: IRouter = Router();

function response(row: typeof preparedInputsTable.$inferSelect) {
  const snapshot = row.snapshot as PreparedSnapshot;
  return {
    preparedInputId: row.id,
    representation: snapshot.representation,
    status: snapshotStatus(snapshot),
    candidates: snapshot.candidates,
    snapshot,
    createdAt: row.createdAt,
  };
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

router.get("/prepared-input-summaries", async (_req, res): Promise<void> => {
  const rows = await db.select(preparedInputSummaryProjection).from(preparedInputsTable)
    .orderBy(desc(preparedInputsTable.createdAt), desc(preparedInputsTable.id));
  res.json(ListPreparedInputSummariesResponse.parse(rows));
});

router.get("/prepared-inputs", async (req, res): Promise<void> => {
  if (req.query.summary === "1") {
    const rows = await db.select({
      id: preparedInputsTable.id,
      representation: preparedInputsTable.representation,
      createdAt: preparedInputsTable.createdAt,
    }).from(preparedInputsTable).orderBy(desc(preparedInputsTable.createdAt), desc(preparedInputsTable.id));
    res.json(rows.map(row => ({
      preparedInputId: row.id,
      representation: row.representation,
      createdAt: row.createdAt,
    })));
    return;
  }
  const rows = await db.select().from(preparedInputsTable).orderBy(desc(preparedInputsTable.createdAt), desc(preparedInputsTable.id));
  res.json(ListPreparedInputsResponse.parse(rows.map(response)));
});

router.post("/prepared-inputs", async (req, res): Promise<void> => {
  const parsed = PrepareInputsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const request: PreparedRequest = {
    ...parsed.data,
    cutoffDate: parsed.data.cutoffDate?.toISOString().slice(0, 10),
    assetTickers: parsed.data.assetTickers.map((ticker) => ticker.trim().toUpperCase()),
  };
  const invalid = validatePreparedRequest(request);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const [dataset] = await db.select().from(priceDataTable).orderBy(desc(priceDataTable.uploadedAt), desc(priceDataTable.id)).limit(1);
  if (!dataset) {
    res.status(422).json({ error: "No persisted price dataset is available; no input results were fabricated." });
    return;
  }
  if (hashDataset(dataset.csvContent) === "" || !dataset.csvContent.trim()) {
    res.status(422).json({ error: "Persisted price dataset is empty or invalid." });
    return;
  }
  try {
    const factorSet = await getFactorSetSnapshot();
    const snapshot = prepareSnapshot({ request, csvContent: dataset.csvContent, factorVersion: factorSet.version,
      factors: factorSet.factors, datasetId: dataset.id, ohlcCsvContent: dataset.ohlcCsvContent });
    snapshot.dataset.tickers = JSON.parse(dataset.tickers) as string[];
    // Fingerprint the JSONB representation actually persisted. Optional
    // undefined request keys (such as cutoffDate) disappear in PostgreSQL.
    const fingerprintValue = fingerprint(JSON.parse(JSON.stringify({
      request: snapshot.request, datasetHash: snapshot.dataset.sha256,
      ohlcDatasetHash: snapshot.dataset.ohlcSha256 ?? null,
      factorVersion: snapshot.factorSet.version, engineVersion: PREPARED_INPUT_ENGINE_VERSION,
    })));
    const [saved] = await db.insert(preparedInputsTable).values({
      representation: request.representation, fingerprint: fingerprintValue, snapshot,
    }).returning();
    res.status(201).json(PrepareInputsResponse.parse(response(saved)));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Prepared input generation failed." });
  }
});

router.get("/prepared-inputs/:preparedInputId", async (req, res): Promise<void> => {
  const parsedParams = GetPreparedInputParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const [row] = await db.select().from(preparedInputsTable)
    .where(eq(preparedInputsTable.id, parsedParams.data.preparedInputId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Prepared input version not found." });
    return;
  }
  res.json(GetPreparedInputResponse.parse(response(row)));
});

router.post("/prepared-inputs/:preparedInputId/compose", async (req, res): Promise<void> => {
  const params = ComposePreparedInputParams.safeParse(req.params);
  const body = ComposePreparedInputBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const [row] = await db.select().from(preparedInputsTable).where(eq(preparedInputsTable.id, params.data.preparedInputId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Prepared input version not found." });
    return;
  }
  try {
    const composition = composePreparedSnapshot(row.snapshot as PreparedSnapshot, body.data.suppliedWeights);
    res.json(ComposePreparedInputResponse.parse(composition));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Composition is unsupported." });
  }
});

router.post("/prepared-inputs/:preparedInputId/replay", async (req, res): Promise<void> => {
  const params = ReplayPreparedInputParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(preparedInputsTable).where(eq(preparedInputsTable.id, params.data.preparedInputId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Prepared input version not found." });
    return;
  }
  const snapshot = row.snapshot as PreparedSnapshot;
  if (hashDataset(snapshot.dataset.csvContent) !== snapshot.dataset.sha256 ||
      (snapshot.dataset.ohlcCsvContent !== undefined &&
       (!snapshot.dataset.ohlcSha256 || hashDataset(snapshot.dataset.ohlcCsvContent) !== snapshot.dataset.ohlcSha256))) {
    res.json(ReplayPreparedInputResponse.parse({ preparedInputId: row.id, status: "fail",
      fingerprint: row.fingerprint, differences: ["frozen dataset hash mismatch"], replayedCandidates: [] }));
    return;
  }
  const replay = replayPreparedSnapshot(snapshot);
  res.json(ReplayPreparedInputResponse.parse({ preparedInputId: row.id, ...replay }));
});

export default router;