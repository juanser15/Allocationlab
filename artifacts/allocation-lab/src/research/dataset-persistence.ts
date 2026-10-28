import { z } from "zod";

const coverageSchema = z.object({
  ticker: z.string(), observations: z.number(), first: z.string().nullable(),
  last: z.string().nullable(), missing: z.number(), coverage_percent: z.number(),
}).passthrough();
export const datasetQualitySchema = z.object({
  per_ticker: z.array(coverageSchema), union_calendar_observations: z.number(),
  complete_case_observations: z.number(), duplicate_dates: z.number(),
  invalid_nonpositive_prices: z.number(), large_gaps: z.array(z.unknown()),
  successful_tickers: z.array(z.string()), failed_tickers: z.array(z.unknown()),
  warnings: z.array(z.string()),
}).passthrough();
export const datasetMetadataSchema = z.object({
  dataset_id: z.string().min(1), dataset_name: z.string(), dataset_version: z.number().int().positive(),
  source: z.enum(["INTERNAL_SNAPSHOT", "YAHOO_FINANCE"]), frequency: z.literal("DAILY"),
  price_field: z.literal("ADJUSTED_CLOSE"), actual_start: z.string(), actual_end: z.string(),
  requested_start: z.string(), requested_end: z.string(), tickers: z.array(z.string()),
  row_count: z.number(), dataset_hash: z.string(), qa_status: z.string(), pit_status: z.string(),
  created_at: z.string(), fetched_at: z.string(), qa: datasetQualitySchema,
}).passthrough();
export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>;
export type DatasetQuality = z.infer<typeof datasetQualitySchema>;
export const workspaceSchema = z.object({
  workspace: z.object({ workspace_id: z.string(), active_dataset_id: z.string(), updated_at: z.string() }),
  active_dataset: datasetMetadataSchema,
});
export type WorkspaceDataset = z.infer<typeof workspaceSchema>;

export const sourceLabel = (source: string) => source === "YAHOO_FINANCE" ? "Yahoo Finance" : source === "INTERNAL_SNAPSHOT" ? "Internal Snapshot" : source;
export function previewHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export async function libraryApi(path: string, body?: unknown, method?: "POST" | "PUT") {
  const response = await fetch("/api/workbench/library" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { ...previewHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message ?? "The dataset request could not be completed."), { status: response.status, code: value.error?.code, details: value.error?.details });
  return value;
}
export async function readWorkspaceDataset(): Promise<WorkspaceDataset> {
  return workspaceSchema.parse(await libraryApi("/workspace"));
}
export async function readDatasetLibrary(): Promise<DatasetMetadata[]> {
  return z.object({ datasets: z.array(datasetMetadataSchema) }).parse(await libraryApi("")).datasets;
}
export async function setWorkspaceDataset(datasetId: string) {
  return workspaceSchema.parse(await libraryApi("/workspace", { dataset_id: datasetId }, "PUT"));
}
export async function fetchDatasetCsv(datasetId: string) {
  const response = await fetch("/api/workbench/library/datasets/" + encodeURIComponent(datasetId) + "/csv", { headers: previewHeaders() });
  if (!response.ok) throw new Error("This saved dataset could not be downloaded. Its data has not been substituted.");
  return response.text();
}
