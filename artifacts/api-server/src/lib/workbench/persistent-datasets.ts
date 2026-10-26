import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { pool } from "@workspace/db";
import { CalendarContractError } from "./calendar-v2";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";

export const PERSISTENT_DATA_BOUNDARY = { dataset_storage_classification: "PERSISTENT_POSTGRES_DATASET_STORAGE", workspace_storage_classification: "PERSISTENT_POSTGRES_WORKSPACE_STATE" } as const;

const MAX_PAYLOAD = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const identifier = /^(internal_[a-f0-9]{64}|yf_[a-f0-9]{32})$/;
const tickerPattern = /^[A-Z0-9.^=\-]{1,20}$/;
const isoDate = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const fail = (code: string, message: string, details: Record<string, unknown> = {}, status = 422): never => { throw new CalendarContractError(code, message, details, status); };
function object(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) return fail("INVALID_DATASET_REQUEST", "Unexpected dataset request fields.");
  return value as Record<string, any>;
}
export interface DatasetQuality {
  per_ticker: Array<{ ticker: string; observations: number; first: string | null; last: string | null; missing: number; coverage_percent: number }>;
  union_calendar_observations: number;
  complete_case_observations: number;
  duplicate_dates: number;
  invalid_nonpositive_prices: number;
  large_gaps: Array<{ ticker: string; from: string; to: string; calendar_days: number }>;
  successful_tickers: string[];
  failed_tickers: Array<{ ticker: string; error: string }>;
  warnings: string[];
}
export interface DatasetMetadata {
  dataset_id: string;
  dataset_name: string;
  dataset_version: number;
  source: "INTERNAL_SNAPSHOT" | "YAHOO_FINANCE";
  created_at: string;
  fetched_at: string;
  frequency: "DAILY";
  price_field: "ADJUSTED_CLOSE";
  adjustment_convention: string;
  requested_start: string;
  requested_end: string;
  requested_end_convention: "INCLUSIVE";
  actual_start: string;
  actual_end: string;
  tickers: string[];
  row_count: number;
  per_ticker_observations: Record<string, number>;
  missing_values: number;
  dataset_hash: string;
  raw_source_hash: string | null;
  pit_status: "VINTAGE_UNVERIFIED";
  qa_status: "PASS" | "WARNINGS";
  notes: string;
  storage_location: string;
  qa: DatasetQuality;
  refresh_of: string | null;
}
export interface DatasetRecord { metadata: DatasetMetadata; csv: string; }
export interface DatasetDraft { draft_id: string; metadata: DatasetMetadata; qa: DatasetQuality; }

/** Strict normalized format: ordered dates, explicit missing cells, no fill/interpolation. */
export function inspectDatasetCsv(csv: string, sourceIssues: Partial<DatasetQuality> = {}): DatasetQuality {
  if (!csv || Buffer.byteLength(csv) > MAX_PAYLOAD) return fail("INVALID_DATASET_PAYLOAD", "Dataset payload is empty or exceeds 32 MiB.");
  const lines = csv.trimEnd().split(/\r?\n/), header = lines.shift()!.split(","), tickers = header.slice(1);
  if (header[0].toLowerCase() !== "date" || !tickers.length || tickers.length > 64 || new Set(tickers).size !== tickers.length || tickers.some(t => !tickerPattern.test(t))) return fail("INVALID_DATASET_PAYLOAD", "Dataset requires a date column and unique supported symbols.");
  const observations = new Map(tickers.map(t => [t, [] as string[]]));
  let previous = "", complete = 0;
  for (const line of lines) {
    const [date, ...cells] = line.split(",");
    if (!isoDate(date) || date <= previous || cells.length !== tickers.length) return fail("INVALID_DATASET_PAYLOAD", "Dataset dates must be unique and ordered; every row must match its header.");
    previous = date;
    let all = true;
    cells.forEach((value, i) => {
      if (value === "") { all = false; return; }
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) return fail("INVALID_DATASET_PAYLOAD", "Normalized prices must be positive and finite; unavailable observations remain empty.");
      observations.get(tickers[i])!.push(date);
    });
    if (all) complete++;
  }
  if (!lines.length) return fail("INVALID_DATASET_PAYLOAD", "Dataset has no observations.");
  const gaps: DatasetQuality["large_gaps"] = [];
  const per = tickers.map(ticker => {
    const dates = observations.get(ticker)!;
    for (let i = 1; i < dates.length; i++) { const days = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000; if (days > 7) gaps.push({ ticker, from: dates[i - 1], to: dates[i], calendar_days: days }); }
    return { ticker, observations: dates.length, first: dates[0] ?? null, last: dates.at(-1) ?? null, missing: lines.length - dates.length, coverage_percent: 100 * dates.length / lines.length };
  });
  const warnings = [...(sourceIssues.warnings ?? [])];
  if (per.some(p => p.missing)) warnings.push("Missing observations remain missing; no forward fill or interpolation was applied.");
  if (gaps.length) warnings.push("Gaps longer than seven calendar days are listed; exchange holidays are not inferred.");
  if (sourceIssues.duplicate_dates) warnings.push("Identical duplicate source observations were explicitly deduplicated; conflicting duplicates reject the symbol.");
  if (sourceIssues.invalid_nonpositive_prices) warnings.push("Invalid or nonpositive source prices were excluded and counted.");
  return { per_ticker: per, union_calendar_observations: lines.length, complete_case_observations: complete, duplicate_dates: sourceIssues.duplicate_dates ?? 0, invalid_nonpositive_prices: sourceIssues.invalid_nonpositive_prices ?? 0, large_gaps: gaps, successful_tickers: per.filter(p => p.observations).map(p => p.ticker), failed_tickers: sourceIssues.failed_tickers ?? [], warnings };
}
function metadata(csv: string, input: { source: DatasetMetadata["source"]; requested_start: string; requested_end: string; fetched_at: string; raw_source_hash: string | null }, qa: DatasetQuality): DatasetMetadata {
  const dates = csv.trimEnd().split(/\r?\n/).slice(1).map(line => line.split(",")[0]);
  return { dataset_id: "UNSAVED", dataset_name: `Yahoo Daily — ${input.requested_start} to ${input.requested_end}`, dataset_version: 0, ...input, created_at: input.fetched_at, frequency: "DAILY", price_field: "ADJUSTED_CLOSE", adjustment_convention: input.source === "YAHOO_FINANCE" ? "Yahoo provider adjusted close; provider historical revisions are not independently vintage verified" : "Committed adjusted-close reference snapshot; historical vintages not independently verified", requested_end_convention: "INCLUSIVE", actual_start: dates[0], actual_end: dates.at(-1)!, tickers: qa.per_ticker.map(p => p.ticker), row_count: dates.length, per_ticker_observations: Object.fromEntries(qa.per_ticker.map(p => [p.ticker, p.observations])), missing_values: qa.per_ticker.reduce((sum, p) => sum + p.missing, 0), dataset_hash: hash(csv), pit_status: "VINTAGE_UNVERIFIED", qa_status: qa.warnings.length || qa.failed_tickers.length ? "WARNINGS" : "PASS", notes: "Research data. Historical data vintages have not been independently certified.", storage_location: "POSTGRES_GZIP", qa, refresh_of: null };
}
function decode(row: any): DatasetRecord {
  let csv: string;
  try { csv = gunzipSync(row.payload_gzip, { maxOutputLength: MAX_PAYLOAD }).toString("utf8"); } catch { return fail("DATASET_UNAVAILABLE", "The exact persisted dataset could not be decoded. No replacement was used.", {}, 409); }
  const meta = row.metadata as DatasetMetadata;
  if (hash(csv) !== meta.dataset_hash || (row.dataset_hash && row.dataset_hash !== meta.dataset_hash)) return fail("DATASET_UNAVAILABLE", "The exact persisted dataset failed its integrity check. No replacement was used.", {}, 409);
  inspectDatasetCsv(csv);
  return { metadata: meta, csv };
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) throw new Error("SOURCE_EMPTY");
  const reader = response.body.getReader(); const parts: Buffer[] = []; let bytes = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_SOURCE_BYTES) throw new Error("SOURCE_TOO_LARGE"); parts.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString("utf8");
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fetchYahooChart(
  ticker: string,
  start: string,
  end: string,
  transport: typeof fetch,
  deadline: AbortSignal,
): Promise<Response> {
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let lastStatus = 0;
  for (let round = 0; round < 2; round++) {
    for (const host of hosts) {
      const url = new URL("https://" + host + "/v8/finance/chart/" + encodeURIComponent(ticker));
      url.search = new URLSearchParams({
        period1: String(Date.parse(start) / 1000),
        period2: String(Date.parse(end) / 1000 + 86400),
        interval: "1d",
        events: "div,splits",
        includeAdjustedClose: "true",
      }).toString();
      const response = await transport(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]),
        redirect: "error",
      });
      if (response.ok) return response;
      lastStatus = response.status;
      await response.body?.cancel().catch(() => {});
      if (![403, 429, 500, 502, 503, 504].includes(response.status))
        throw new Error("SOURCE_HTTP_" + response.status);
    }
    if (round === 0) await sleep(450);
  }
  throw new Error("SOURCE_HTTP_" + lastStatus);
}
/** Injectable transport is for local contract tests only. Production always uses fixed Yahoo HTTPS URLs. */
export async function ingestYahoo(value: unknown, transport: typeof fetch = fetch): Promise<{ csv: string; metadata: DatasetMetadata }> {
  const input = object(value, ["tickers", "start", "end", "frequency", "price_field"]);
  if (!Array.isArray(input.tickers) || !input.tickers.length || input.tickers.length > 64 || input.tickers.some((t: unknown) => typeof t !== "string")) return fail("INVALID_DATASET_REQUEST", "Choose 1–64 ticker symbols.");
  const tickers = [...new Set<string>(input.tickers.map((t: string) => t.trim().toUpperCase()))].sort();
  if (tickers.some(t => !tickerPattern.test(t)) || !isoDate(input.start) || !isoDate(input.end) || input.start > input.end) return fail("INVALID_DATASET_REQUEST", "Choose valid ticker symbols and ordered From/To dates.");
  if ((input.frequency ?? "DAILY") !== "DAILY" || (input.price_field ?? "ADJUSTED_CLOSE") !== "ADJUSTED_CLOSE") return fail("INVALID_DATASET_REQUEST", "This version supports daily adjusted close only.");
  const today = new Date().toISOString().slice(0, 10);
  if (input.end > today) return fail("INVALID_DATASET_REQUEST", "The requested download end cannot be in the future.");
  const fetched = new Date().toISOString(), deadline = AbortSignal.timeout(60000);
  const observedCalendar = new Set<string>();
  const points = new Map<string, Map<string, number>>(), rawHashes: Record<string, string> = {}, failed: DatasetQuality["failed_tickers"] = [];
  let duplicates = 0, invalid = 0, totalBytes = 0;
  for (let offset = 0; offset < tickers.length; offset += 2) {
    await Promise.all(tickers.slice(offset, offset + 2).map(async ticker => {
      try {
        const response = await fetchYahooChart(ticker, input.start, input.end, transport, deadline);
        const text = await boundedText(response); totalBytes += Buffer.byteLength(text); if (totalBytes > MAX_TOTAL_SOURCE_BYTES) throw new Error("SOURCE_BATCH_TOO_LARGE");
        rawHashes[ticker] = hash(text); const body = JSON.parse(text), result = body?.chart?.result?.[0];
        if (body?.chart?.error || !result) throw new Error("SOURCE_SYMBOL_UNAVAILABLE");
        if (result.meta?.currency !== "USD") throw new Error("SOURCE_CURRENCY_NOT_USD");
        const timestamps = result.timestamp, adjusted = result.indicators?.adjclose?.[0]?.adjclose;
        if (!Array.isArray(timestamps) || !Array.isArray(adjusted) || timestamps.length !== adjusted.length) throw new Error("SOURCE_ADJUSTED_CLOSE_UNAVAILABLE");
        const map = new Map<string, number>();
        for (let i = 0; i < timestamps.length; i++) {
          if (!Number.isFinite(timestamps[i])) throw new Error("SOURCE_INVALID_DATE");
          const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
          if (date < input.start || date > input.end || date >= today) continue;
          observedCalendar.add(date);
          const price = adjusted[i]; if (price == null) continue;
          if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) { invalid++; continue; }
          if (map.has(date)) { duplicates++; if (map.get(date) !== price) throw new Error("SOURCE_CONFLICTING_DUPLICATE"); }
          map.set(date, price);
        }
        if (!map.size) throw new Error("SOURCE_NO_OBSERVATIONS"); points.set(ticker, map);
      } catch (error) {
        const code = error instanceof Error && /^SOURCE_[A-Z0-9_]+$/.test(error.message) ? error.message : "SOURCE_FETCH_UNAVAILABLE";
        failed.push({ ticker, error: code });
      }
    }));
    if (offset + 2 < tickers.length) await sleep(120);
  }
  if (!points.size) return fail("YAHOO_DATA_FETCH_FAILED", "Yahoo Finance returned no usable daily adjusted-close observations. No dataset was saved or activated.", { failed_tickers: failed }, 502);
  const dates = [...observedCalendar].sort();
  const csv = ["date," + tickers.join(","), ...dates.map(date => [date, ...tickers.map(t => points.get(t)?.get(date) ?? "")].join(","))].join("\n") + "\n";
  const qa = inspectDatasetCsv(csv, { duplicate_dates: duplicates, invalid_nonpositive_prices: invalid, failed_tickers: failed.sort((a, b) => a.ticker.localeCompare(b.ticker)), warnings: ["Yahoo Finance research data: historical vintages are unverified."] });
  return { csv, metadata: metadata(csv, { source: "YAHOO_FINANCE", requested_start: input.start, requested_end: input.end, fetched_at: fetched, raw_source_hash: hash(JSON.stringify(Object.fromEntries(Object.entries(rawHashes).sort()))) }, qa) };
}

export class PersistentDatasetStore {
  private initializing?: Promise<void>;
  constructor(private readonly database: typeof pool = pool) {}
  private async query(sql: string, values?: unknown[]) {
    try { return await this.database.query(sql, values); }
    catch { return fail("DATASET_UNAVAILABLE", "Persistent dataset storage is unavailable. No dataset was substituted.", {}, 503); }
  }
  async initialize(): Promise<void> {
    if (!this.initializing) this.initializing = this.bootstrap().catch(error => { this.initializing = undefined; throw new CalendarContractError("DATASET_UNAVAILABLE", "Persistent dataset storage is unavailable. No internal snapshot was substituted.", {}, 503); });
    return this.initializing;
  }
  private async bootstrap() {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(670102026)");
      const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
      await client.query(readFileSync(resolve(root, "lib/db/migrations/0003_persistent_dataset_library.sql"), "utf8"));
      const fixture = JSON.parse(readFileSync(resolve(root, "configs/capital-research/acceptance-traditional.json"), "utf8"));
      const csv = readFileSync(resolve(root, fixture.data_csv), "utf8");
      if(hash(csv)!==fixture.data_sha256)throw new Error("Committed reference dataset integrity failure");
      const qa = inspectDatasetCsv(csv), dates = csv.trimEnd().split(/\r?\n/).slice(1).map(row => row.split(",")[0]), now = new Date().toISOString();
      const meta = metadata(csv, { source: "INTERNAL_SNAPSHOT", requested_start: dates[0], requested_end: dates.at(-1)!, fetched_at: now, raw_source_hash: hash(csv) }, qa);
      meta.dataset_id = "internal_" + meta.dataset_hash; meta.dataset_name = "Internal Reference Snapshot"; meta.dataset_version = 1; meta.storage_location = "postgres:allocationlab_dataset_versions/" + meta.dataset_id;
      await client.query("INSERT INTO allocationlab_dataset_versions(dataset_id,dataset_name,dataset_version,dataset_hash,metadata,payload_gzip) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dataset_id) DO NOTHING", [meta.dataset_id, meta.dataset_name, 1, meta.dataset_hash, JSON.stringify(meta), gzipSync(csv)]);
      await client.query("INSERT INTO allocationlab_workspace_state(workspace_id,active_dataset_id) VALUES('default',$1) ON CONFLICT(workspace_id) DO NOTHING", [meta.dataset_id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async list(): Promise<DatasetMetadata[]> {
    await this.initialize(); const result = await this.query("SELECT metadata FROM allocationlab_dataset_versions ORDER BY created_at DESC,dataset_id"); return result.rows.map(row => row.metadata);
  }
  async read(id: string): Promise<DatasetRecord> {
    await this.initialize(); if (!identifier.test(id)) return fail("DATASET_UNAVAILABLE", "The requested immutable dataset does not exist. No internal snapshot was substituted.", {}, 409);
    const result = await this.query("SELECT metadata,dataset_hash,payload_gzip FROM allocationlab_dataset_versions WHERE dataset_id=$1", [id]);
    if (!result.rowCount) return fail("DATASET_UNAVAILABLE", "The requested immutable dataset is unavailable. No replacement dataset was used.", { dataset_id: id }, 409);
    return decode(result.rows[0]);
  }
  get(id: string) { return this.read(id); }
  async workspace(workspaceId = "default") {
    await this.initialize(); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId)) return fail("INVALID_WORKSPACE", "Invalid workspace identifier.");
    const result = await this.query("SELECT workspace_id,active_dataset_id,updated_at FROM allocationlab_workspace_state WHERE workspace_id=$1", [workspaceId]);
    if (!result.rowCount) return fail("WORKSPACE_UNAVAILABLE", "The requested workspace has no configured dataset.", {}, 404);
    const row = result.rows[0], { metadata: active } = await this.read(row.active_dataset_id);
    return { workspace_id: row.workspace_id as string, active_dataset_id: row.active_dataset_id as string, updated_at: new Date(row.updated_at).toISOString(), active_dataset: active };
  }
  async activate(id: string, workspaceId = "default") {
    await this.read(id); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId)) return fail("INVALID_WORKSPACE", "Invalid workspace identifier.");
    await this.query("INSERT INTO allocationlab_workspace_state(workspace_id,active_dataset_id) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET active_dataset_id=EXCLUDED.active_dataset_id,updated_at=now()", [workspaceId, id]);
    return this.workspace(workspaceId);
  }
  async fetchYahoo(input: unknown): Promise<DatasetDraft> {
    await this.initialize(); const record = await ingestYahoo(input); return this.storeDraft(record);
  }
  /** Persist a provider-produced draft. Kept separate to test storage with explicitly labelled transport fixtures. */
  async storeDraft(record: DatasetRecord): Promise<DatasetDraft> {
    await this.initialize(); const qa = inspectDatasetCsv(record.csv, record.metadata.qa);
    if (record.metadata.source !== "YAHOO_FINANCE" || hash(record.csv) !== record.metadata.dataset_hash) return fail("INVALID_DATASET_PAYLOAD", "Draft identity does not match the normalized source payload.");
    const draftId = "draft_" + randomUUID().replaceAll("-", "");
    await this.query("INSERT INTO allocationlab_dataset_drafts(draft_id,metadata,payload_gzip) VALUES($1,$2,$3)", [draftId, JSON.stringify(record.metadata), gzipSync(record.csv)]);
    return { draft_id: draftId, metadata: record.metadata, qa };
  }
  async saveDraft(value: unknown): Promise<DatasetMetadata> {
    await this.initialize(); const input = object(value, ["draft_id", "dataset_name", "notes", "refresh_of"]);
    if (typeof input.draft_id !== "string" || !/^draft_[a-f0-9]{32}$/.test(input.draft_id) || typeof input.dataset_name !== "string" || input.dataset_name.trim().length < 1 || input.dataset_name.trim().length > 120 || /[\x00-\x1f]/.test(input.dataset_name) || (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 2000))) return fail("INVALID_DATASET_REQUEST", "Choose a valid fetched draft and a dataset name of 1–120 characters.");
    const name = input.dataset_name.trim(); const client = await this.database.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [name]);
      const prior = await client.query("SELECT metadata FROM allocationlab_dataset_versions WHERE source_draft_id=$1", [input.draft_id]);
      if (prior.rowCount) { if (prior.rows[0].metadata.dataset_name !== name) return fail("DATASET_ALREADY_SAVED", "This fetched draft was already saved under another name.", {}, 409); await client.query("COMMIT"); return prior.rows[0].metadata as DatasetMetadata; }
      const draft = await client.query("SELECT metadata,payload_gzip FROM allocationlab_dataset_drafts WHERE draft_id=$1", [input.draft_id]);
      if (!draft.rowCount) return fail("DATASET_DRAFT_UNAVAILABLE", "Fetch data before saving this dataset.", {}, 404);
      const record = decode(draft.rows[0]);
      if (input.refresh_of !== undefined) {
        const previous = await client.query("SELECT metadata FROM allocationlab_dataset_versions WHERE dataset_id=$1", [input.refresh_of]);
        if (!previous.rowCount || previous.rows[0].metadata.dataset_name !== name || previous.rows[0].metadata.source !== "YAHOO_FINANCE") return fail("INVALID_DATASET_REFRESH", "Refresh must retain the existing Yahoo dataset name.");
      }
      const version = await client.query("SELECT COALESCE(MAX(dataset_version),0)+1 AS version FROM allocationlab_dataset_versions WHERE dataset_name=$1", [name]);
      const id = "yf_" + randomUUID().replaceAll("-", ""), meta: DatasetMetadata = { ...record.metadata, dataset_id: id, dataset_name: name, dataset_version: Number(version.rows[0].version), created_at: new Date().toISOString(), notes: input.notes ?? record.metadata.notes, storage_location: "postgres:allocationlab_dataset_versions/" + id, refresh_of: input.refresh_of ?? null };
      await client.query("INSERT INTO allocationlab_dataset_versions(dataset_id,dataset_name,dataset_version,dataset_hash,metadata,payload_gzip,source_draft_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, name, meta.dataset_version, meta.dataset_hash, JSON.stringify(meta), gzipSync(record.csv), input.draft_id]);
      await client.query("COMMIT"); return meta;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async reference(datasetId: string, runId: string) {
    const { metadata: meta } = await this.read(datasetId);
    if (!/^rr_[a-f0-9]{64}$/.test(runId)) return fail("INVALID_RUN_REFERENCE", "Run reference is invalid.");
    const inserted = await this.query("INSERT INTO allocationlab_dataset_run_references(run_id,dataset_id,dataset_hash) VALUES($1,$2,$3) ON CONFLICT(run_id) DO NOTHING", [runId, datasetId, meta.dataset_hash]);
    if (!inserted.rowCount) { const existing = await this.query("SELECT dataset_id,dataset_hash FROM allocationlab_dataset_run_references WHERE run_id=$1", [runId]); if (existing.rows[0]?.dataset_id !== datasetId || existing.rows[0]?.dataset_hash !== meta.dataset_hash) return fail("DATASET_RUN_IDENTITY_CONFLICT", "This immutable run already references a different dataset.", {}, 409); }
  }
}
export const persistentDatasetStore = new PersistentDatasetStore();
