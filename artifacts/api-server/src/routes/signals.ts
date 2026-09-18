import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetSignalsCatalogResponse,
  GetSignalsHistoryQueryParams,
  GetSignalsHistoryResponse,
  GetSignalsLatestQueryParams,
  GetSignalsLatestResponse,
} from "@workspace/api-zod";
import { loadSignalExport, type SignalObservation } from "../lib/signal-export";

const router: IRouter = Router();

function errorResponse(code: string, error: string) {
  return { code, error };
}

function tokenMatches(received: string, expected: string): boolean {
  const receivedDigest = createHash("sha256").update(received, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

const protectSignalExport: RequestHandler = (req, res, next): void => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  if (req.get("Origin") || req.get("Sec-Fetch-Mode")) {
    res.status(403).json(errorResponse("browser_access_forbidden", "Use this API only from a server-side BFF."));
    return;
  }

  const expected = process.env.SIGNAL_EXPORT_TOKEN;
  if (!expected) {
    res.status(503).json(errorResponse("integration_not_configured", "Signal export is not configured."));
    return;
  }

  const authorization = req.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match || !tokenMatches(match[1], expected)) {
    res.status(401).json(errorResponse("unauthorized", "Unauthorized."));
    return;
  }
  next();
};

router.use("/signals", protectSignalExport);

function parseDate(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = Date.parse(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function validateRawQuery(query: Record<string, unknown>): string | null {
  const allowed = new Set(["signalId", "asset", "dateFrom", "dateTo", "limit"]);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) return `unknown query parameter: ${key}`;
  }
  for (const key of ["signalId", "asset", "dateFrom", "dateTo", "limit"]) {
    if (Array.isArray(query[key])) return `${key} must appear only once`;
  }
  if (query.limit !== undefined && !/^\d+$/.test(String(query.limit))) {
    return "limit must be an integer";
  }
  const isoDateOrTimestamp = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;
  for (const key of ["dateFrom", "dateTo"]) {
    if (query[key] !== undefined && !isoDateOrTimestamp.test(String(query[key]))) {
      return `${key} must be an ISO date or RFC3339 timestamp`;
    }
  }
  return null;
}

function filterObservations(
  observations: SignalObservation[],
  filters: {
    signalId?: string;
    asset?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  },
  latest: boolean,
): { data: SignalObservation[]; truncated: boolean } | { error: string } {
  const from = parseDate(filters.dateFrom, false);
  const to = parseDate(filters.dateTo, true);
  if (Number.isNaN(from) || Number.isNaN(to)) return { error: "dateFrom and dateTo must be valid ISO dates or timestamps" };
  if (from !== null && to !== null && from > to) return { error: "dateFrom must be earlier than or equal to dateTo" };

  let data = observations.filter((observation) => {
    const timestamp = Date.parse(observation.asOf);
    return (
      (!filters.signalId || observation.signalId === filters.signalId) &&
      (!filters.asset || observation.asset === filters.asset.toUpperCase()) &&
      (from === null || timestamp >= from) &&
      (to === null || timestamp <= to)
    );
  });
  data.sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));

  if (latest) {
    const seen = new Set<string>();
    data = data.filter((observation) => {
      const key = `${observation.signalId}\u0000${observation.asset ?? ""}\u0000${observation.dimension ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const truncated = data.length > filters.limit;
  return { data: data.slice(0, filters.limit), truncated };
}

router.get("/signals/catalog", async (req, res): Promise<void> => {
  try {
    const exported = await loadSignalExport({ catalogOnly: true });
    res.json(GetSignalsCatalogResponse.parse({
      generatedAt: new Date().toISOString(),
      data: exported.catalog,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Signal catalog source unavailable");
    res.status(503).json(errorResponse("source_unavailable", "Persisted signal sources are unavailable."));
  }
});

async function handleSignals(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  latest: boolean,
): Promise<void> {
  const rawError = validateRawQuery(req.query);
  if (rawError) {
    res.status(400).json(errorResponse("invalid_filters", rawError));
    return;
  }
  const schema = latest ? GetSignalsLatestQueryParams : GetSignalsHistoryQueryParams;
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(errorResponse("invalid_filters", parsed.error.issues.map((issue) => issue.message).join("; ")));
    return;
  }

  try {
    const exported = await loadSignalExport({
      signalId: parsed.data.signalId,
      asset: parsed.data.asset,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      maxRecords: parsed.data.limit + 1,
    });
    if (parsed.data.signalId && !exported.catalog.some((entry) => entry.signalId === parsed.data.signalId)) {
      res.status(400).json(errorResponse("unknown_signal", "signalId is not present in the signal catalog."));
      return;
    }
    const filtered = filterObservations(
      [...exported.sessionObservations, ...exported.priceObservations],
      parsed.data,
      latest,
    );
    if ("error" in filtered) {
      res.status(400).json(errorResponse("invalid_filters", filtered.error));
      return;
    }
    const response = {
      generatedAt: new Date().toISOString(),
      data: filtered.data,
      count: filtered.data.length,
      truncated: filtered.truncated,
      filters: {
        signalId: parsed.data.signalId ?? null,
        asset: parsed.data.asset?.toUpperCase() ?? null,
        dateFrom: parsed.data.dateFrom ?? null,
        dateTo: parsed.data.dateTo ?? null,
        limit: parsed.data.limit,
      },
    };
    res.json((latest ? GetSignalsLatestResponse : GetSignalsHistoryResponse).parse(response));
  } catch (error) {
    req.log.error({ err: error }, "Persisted signal source unavailable");
    res.status(503).json(errorResponse("source_unavailable", "Persisted signal sources are unavailable."));
  }
}

router.get("/signals/latest", async (req, res): Promise<void> => {
  await handleSignals(req, res, true);
});

router.get("/signals/history", async (req, res): Promise<void> => {
  await handleSignals(req, res, false);
});

export default router;