import type { DataFetchEvent, DataFetchInput, DataFetchProgress } from "@workspace/api-client-react";
import { previewHeaders } from "./dataset-persistence";

export async function consumeFetchStream(
  response: Response,
  onProgress: (progress: DataFetchProgress) => void,
) {
  if (!response.ok) throw new Error(`Fetch request failed (HTTP ${response.status}).`);
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson"))
    throw new Error("Live fetch progress is unavailable. No automatic retry was started.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", draft: DataFetchEvent["draft"], terminal = false;
  const record = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as DataFetchEvent;
    if (terminal) throw new Error("Unexpected data after fetch completion.");
    if (event.type === "heartbeat") return;
    if (event.type === "error") throw new Error(event.error?.message ?? "Data fetch failed.");
    if (event.type === "result" && event.draft) { draft = event.draft; terminal = true; return; }
    const p = event.progress;
    if (event.type !== "progress" || !p || !["DOWNLOADING", "FINALIZING", "COMPLETE"].includes(p.phase) ||
        ![p.total, p.completed, p.successful, p.failed, p.remaining, p.elapsed_ms, p.percent].every(Number.isFinite) ||
        p.total < 1 || p.completed < 0 || p.completed > p.total || p.remaining !== p.total - p.completed ||
        p.successful + p.failed !== p.completed || p.percent < 0 || p.percent > 100 ||
        !Array.isArray(p.current_symbols) || !Array.isArray(p.failed_symbols))
      throw new Error("The server returned invalid fetch progress.");
    onProgress(p);
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        record(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      }
      if (pending.length > 1048576) throw new Error("Fetch progress record exceeded its size limit.");
      if (chunk.done) break;
    }
    if (pending.trim()) record(pending);
    if (!terminal || !draft) throw new Error("The fetch connection ended before a result was confirmed. No automatic retry was started.");
    return { draft };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchWithProgress(input: DataFetchInput, onProgress: (progress: DataFetchProgress) => void) {
  const response = await fetch("/api/workbench/library/fetch-stream", {
    method: "POST", headers: { ...previewHeaders(), "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(input),
  });
  return consumeFetchStream(response, onProgress);
}
