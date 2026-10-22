import { researchApi } from "./coordinated-ui";

const KEY = "allocationlab.yahoo.active-snapshot.v1";
const tokenHeader = (): Record<string, string> => {
  const token = sessionStorage.getItem("allocationlab.workbench.preview-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function fetchDatasetCsv(datasetId: string) {
  const response = await fetch(
    "/api/workbench/coordinated/data/" +
      encodeURIComponent(datasetId) +
      ".csv",
    { headers: tokenHeader() },
  );
  if (!response.ok) throw new Error("CSV download failed.");
  return response.text();
}

export async function rememberYahooSnapshot(metadata: any) {
  const csv = await fetchDatasetCsv(metadata.dataset_id);
  localStorage.setItem(KEY, JSON.stringify({ metadata, csv }));
}

export function forgetYahooSnapshot() {
  localStorage.removeItem(KEY);
}

export async function restoreRememberedYahooDataset() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  let saved: any;
  try {
    saved = JSON.parse(raw);
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
  if (
    !saved?.metadata?.dataset_id ||
    saved.metadata.source !== "YAHOO_FINANCE_RESEARCH" ||
    typeof saved.csv !== "string"
  ) {
    localStorage.removeItem(KEY);
    return null;
  }
  const status = await researchApi("/data");
  if (status.active_dataset?.dataset_id === saved.metadata.dataset_id)
    return status.active_dataset;
  const restored = await researchApi("/data/restore", saved);
  return restored.active_dataset ?? null;
}
