import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCsv } from "../calculator";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";

type DatasetSource = "INTERNAL_CERTIFIED_SNAPSHOT" | "YAHOO_FINANCE_RESEARCH";

export interface ResearchDatasetMetadata {
  dataset_id: string;
  source: DatasetSource;
  fetched_at: string;
  requested_start: string;
  requested_end: string;
  interval: "1d";
  price_field: "adjusted_close";
  tickers: string[];
  successful_tickers: string[];
  failed_tickers: Array<{ ticker: string; error: string }>;
  observations: number;
  first_observation: string | null;
  last_observation: string | null;
  complete_observations: number;
  required_research_symbols: string[];
  missing_required_symbols: string[];
  activation_eligible: boolean;
  coverage: Array<{
    ticker: string;
    observations: number;
    first_observation: string | null;
    last_observation: string | null;
    missing_on_union_calendar: number;
  }>;
  sha256: string;
  note: string;
}

const DIR =
  process.env["WORKBENCH_DATASET_DIR"] ||
  resolve(tmpdir(), "allocationlab-research-datasets");
const ACTIVE_FILE = resolve(DIR, "active-dataset.json");
const ID_RE = /^yf_[0-9a-f]{64}$/;
const TICKER_RE = /^[A-Z0-9.^=\-]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureDir() {
  mkdirSync(DIR, { recursive: true });
}
function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATE_RE.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function nextDay(date: string) {
  return new Date(Date.parse(date + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
function epochSeconds(date: string) {
  return Math.floor(Date.parse(date + "T00:00:00Z") / 1000);
}
function csvPath(datasetId: string) {
  if (!ID_RE.test(datasetId)) throw new Error("Invalid research dataset id.");
  return resolve(DIR, datasetId + ".csv");
}
function metaPath(datasetId: string) {
  if (!ID_RE.test(datasetId)) throw new Error("Invalid research dataset id.");
  return resolve(DIR, datasetId + ".json");
}
export function requiredResearchSymbols(): string[] {
  const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const fixture = JSON.parse(
    readFileSync(
      resolve(root, "configs/capital-research/acceptance-traditional.json"),
      "utf8",
    ),
  ) as { reference_universe?: string[] };
  return [...new Set(fixture.reference_universe ?? [])].sort();
}
function normalizeTickers(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    throw new Error("Choose between 1 and 64 Yahoo Finance symbols.");
  const tickers = [
    ...new Set(
      value.map((x) => String(x).trim().toUpperCase()).filter(Boolean),
    ),
  ];
  if (!tickers.length || tickers.some((x) => !TICKER_RE.test(x)))
    throw new Error("Yahoo Finance symbols contain unsupported characters.");
  return tickers.sort();
}

async function fetchYahooTicker(
  ticker: string,
  start: string,
  end: string,
): Promise<Array<{ date: string; value: number }>> {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(ticker) +
    "?period1=" +
    epochSeconds(start) +
    "&period2=" +
    epochSeconds(nextDay(end)) +
    "&interval=1d&events=div%2Csplits&includeAdjustedClose=true";
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 AllocationLab/1.0 research-data-preview",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Yahoo Finance returned HTTP " + response.status + ".");
  const body = (await response.json()) as any;
  const error = body?.chart?.error;
  if (error)
    throw new Error(
      String(error.description || error.code || "Yahoo Finance error"),
    );
  const result = body?.chart?.result?.[0];
  const timestamps: number[] = Array.isArray(result?.timestamp)
    ? result.timestamp
    : [];
  const adjusted: Array<number | null> =
    result?.indicators?.adjclose?.[0]?.adjclose ??
    result?.indicators?.quote?.[0]?.close ??
    [];
  const points: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < Math.min(timestamps.length, adjusted.length); i++) {
    const value = Number(adjusted[i]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < start || date > end) continue;
    points.push({ date, value });
  }
  const unique = new Map(points.map((p) => [p.date, p.value]));
  return [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

export async function fetchYahooResearchDataset(value: unknown) {
  const input = value as {
    tickers?: unknown;
    start?: unknown;
    end?: unknown;
  };
  const tickers = normalizeTickers(input?.tickers);
  if (!validDate(input?.start) || !validDate(input?.end) || input.start > input.end)
    throw new Error("Choose valid From and To dates.");

  const byTicker = new Map<string, Array<{ date: string; value: number }>>();
  const failed: Array<{ ticker: string; error: string }> = [];

  // Keep concurrency deliberately modest; Yahoo is an external research source.
  for (let i = 0; i < tickers.length; i += 4) {
    const batch = tickers.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        try {
          return { ticker, points: await fetchYahooTicker(ticker, input.start!, input.end!) };
        } catch (error) {
          return {
            ticker,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    for (const result of results) {
      if ("points" in result) byTicker.set(result.ticker, result.points);
      else failed.push({ ticker: result.ticker, error: result.error });
    }
  }
  if (!byTicker.size)
    throw new Error("Yahoo Finance did not return usable observations.");

  const dates = [
    ...new Set(
      [...byTicker.values()].flatMap((points) => points.map((p) => p.date)),
    ),
  ].sort();
  const maps = new Map(
    [...byTicker].map(([ticker, points]) => [
      ticker,
      new Map(points.map((p) => [p.date, p.value])),
    ]),
  );
  const header = ["date", ...tickers].join(",");
  const lines = dates.map((date) =>
    [
      date,
      ...tickers.map((ticker) => {
        const value = maps.get(ticker)?.get(date);
        return value === undefined ? "" : String(value);
      }),
    ].join(","),
  );
  const csv = header + "\n" + lines.join("\n") + "\n";
  const required = requiredResearchSymbols();
  const missingRequired = required.filter((ticker) => !byTicker.has(ticker));
  const completeObservations = dates.filter((date) =>
    required.every((ticker) => maps.get(ticker)?.has(date)),
  ).length;
  const digest = hash(csv);
  const datasetId = "yf_" + hash(
    JSON.stringify({
      tickers,
      start: input.start,
      end: input.end,
      digest,
      price_field: "adjusted_close",
    }),
  );
  const metadata: ResearchDatasetMetadata = {
    dataset_id: datasetId,
    source: "YAHOO_FINANCE_RESEARCH",
    fetched_at: new Date().toISOString(),
    requested_start: input.start,
    requested_end: input.end,
    interval: "1d",
    price_field: "adjusted_close",
    tickers,
    successful_tickers: [...byTicker.keys()].sort(),
    failed_tickers: failed,
    observations: dates.length,
    first_observation: dates[0] ?? null,
    last_observation: dates.at(-1) ?? null,
    complete_observations: completeObservations,
    required_research_symbols: required,
    missing_required_symbols: missingRequired,
    activation_eligible:
      missingRequired.length === 0 && completeObservations >= 260,
    coverage: tickers.map((ticker) => {
      const points = byTicker.get(ticker) ?? [];
      return {
        ticker,
        observations: points.length,
        first_observation: points[0]?.date ?? null,
        last_observation: points.at(-1)?.date ?? null,
        missing_on_union_calendar: dates.length - points.length,
      };
    }),
    sha256: digest,
    note:
      "Yahoo Finance research snapshot. Adjusted-close data is not independently point-in-time certified and must not be represented as certified historical vendor data.",
  };
  ensureDir();
  writeFileSync(csvPath(datasetId), csv, "utf8");
  writeFileSync(metaPath(datasetId), JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

export function readResearchDataset(datasetId: string): ResearchDatasetMetadata {
  const path = metaPath(datasetId);
  if (!existsSync(path)) throw new Error("Research dataset was not found.");
  return JSON.parse(readFileSync(path, "utf8")) as ResearchDatasetMetadata;
}
export function readResearchDatasetCsv(datasetId: string) {
  const path = csvPath(datasetId);
  if (!existsSync(path)) throw new Error("Research dataset was not found.");
  return readFileSync(path, "utf8");
}
export function activateResearchDataset(datasetId: string) {
  const meta = readResearchDataset(datasetId);
  if (!meta.activation_eligible)
    throw new Error(
      "This Yahoo snapshot cannot become the active research dataset because the model-required information universe is incomplete or has too little complete history.",
    );
  ensureDir();
  writeFileSync(
    ACTIVE_FILE,
    JSON.stringify({ dataset_id: datasetId, activated_at: new Date().toISOString() }),
    "utf8",
  );
  return activeResearchDatasetStatus();
}
export function activateInternalDataset() {
  ensureDir();
  writeFileSync(
    ACTIVE_FILE,
    JSON.stringify({ dataset_id: "internal", activated_at: new Date().toISOString() }),
    "utf8",
  );
  return activeResearchDatasetStatus();
}
function activeId(): string {
  if (!existsSync(ACTIVE_FILE)) return "internal";
  try {
    const parsed = JSON.parse(readFileSync(ACTIVE_FILE, "utf8"));
    return typeof parsed.dataset_id === "string" ? parsed.dataset_id : "internal";
  } catch {
    return "internal";
  }
}
export function activeResearchDatasetStatus() {
  const id = activeId();
  if (id === "internal")
    return {
      dataset_id: "internal",
      source: "INTERNAL_CERTIFIED_SNAPSHOT" as const,
      active: true,
      required_research_symbols: requiredResearchSymbols(),
    };
  try {
    return { ...readResearchDataset(id), active: true };
  } catch {
    return {
      dataset_id: "internal",
      source: "INTERNAL_CERTIFIED_SNAPSHOT" as const,
      active: true,
      required_research_symbols: requiredResearchSymbols(),
      warning: "The prior temporary research dataset is unavailable after a restart.",
    };
  }
}
export function applyResearchDatasetOverride<T extends {
  rows: any[];
  fixture: any;
  snapshot: any;
  code_version: string;
}>(base: T): T {
  const status = activeResearchDatasetStatus();
  if (status.dataset_id === "internal") return base;
  const meta = status as ResearchDatasetMetadata & { active: true };
  const csv = readResearchDatasetCsv(meta.dataset_id);
  const rows = parseCsv(csv);
  if (!rows.length) return base;
  return {
    ...base,
    rows,
    fixture: {
      ...base.fixture,
      data_sha256: meta.sha256,
      data_csv: csvPath(meta.dataset_id),
      data_provenance:
        "Yahoo Finance research snapshot; adjusted close; not independently PIT-certified.",
    },
    snapshot: {
      path: "temporary://" + meta.dataset_id,
      sha256: meta.sha256,
      parsed_data_hash: hash(JSON.stringify(rows)),
      observations: rows.length,
      data_first_observation: rows[0].date,
      data_last_observation: rows.at(-1)!.date,
      source: meta.source,
      dataset_id: meta.dataset_id,
      fetched_at: meta.fetched_at,
      pit_certification: "UNVERIFIED",
    },
  } as T;
}
