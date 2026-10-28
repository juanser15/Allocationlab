import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ingestYahoo } from "../../../api-server/src/lib/workbench/persistent-datasets";
import { consumeFetchStream } from "./fetch-progress-stream";
import { DataFetchProgressView } from "./data-fetch-progress";
import type { DataFetchProgress } from "@workspace/api-client-react";

const input = { tickers: ["SPY", "MISSING"], start: "2024-01-02", end: "2024-01-04", frequency: "DAILY", price_field: "ADJUSTED_CLOSE" };
const wire = () => new Response(JSON.stringify({ chart: { result: [{
  meta: { currency: "USD" },
  timestamp: ["2024-01-02", "2024-01-03", "2024-01-04"].map(d => Date.parse(d) / 1000),
  indicators: { adjclose: [{ adjclose: [100, 101, 102] }] },
}] } }));
const p: DataFetchProgress = {
  phase: "DOWNLOADING", total: 2, completed: 1, successful: 1, failed: 0, remaining: 1,
  current_symbols: ["SGOV"], failed_symbols: [], elapsed_ms: 2000, estimated_remaining_ms: 2000, percent: 50, message: "Downloading SGOV",
};
function stream(records: unknown[], fragmented = false) {
  const bytes = new TextEncoder().encode(records.map(r => JSON.stringify(r)).join("\n") + "\n");
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += fragmented ? 3 : bytes.length)
        controller.enqueue(bytes.slice(i, i + (fragmented ? 3 : bytes.length)));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
test("Provider progress counts real success/failure, is monotonic and never claims draft persistence", async () => {
  const events: DataFetchProgress[] = [];
  const record = await ingestYahoo(input, async url => String(url).includes("/MISSING?") ? new Response("", { status: 404 }) : wire(), event => events.push(event));
  assert.equal(events[0].completed, 0);
  const last = events.at(-1)!;
  assert.equal(last.completed, 2);
  assert.equal(last.successful, 1);
  assert.equal(last.failed, 1);
  assert.equal(last.remaining, 0);
  assert.deepEqual(last.failed_symbols, ["MISSING"]);
  assert.ok(events.every((event, i) => event.percent < 100 && event.phase === "DOWNLOADING" && (!i || event.completed >= events[i - 1].completed)));
  assert.ok(events.some(event => event.current_symbols.includes("SPY")));
  assert.equal(record.metadata.source, "YAHOO_FINANCE");
});
test("All-provider failures report processed counts but cannot produce success", async () => {
  const events: DataFetchProgress[] = [];
  await assert.rejects(() => ingestYahoo({ ...input, tickers: ["MISSING"] }, async () => new Response("", { status: 404 }), event => events.push(event)),
    (error: any) => error.code === "YAHOO_DATA_FETCH_FAILED");
  assert.equal(events.at(-1)!.failed, 1);
  assert.equal(events.at(-1)!.percent, 99);
});
test("Stream parser handles fragmented UTF-8, heartbeats and a real terminal result", async () => {
  const progress: DataFetchProgress[] = [];
  const result = await consumeFetchStream(stream([
    { type: "heartbeat" }, { type: "progress", progress: { ...p, message: "Coverage — adjusted" } },
    { type: "result", draft: { draft_id: "test-draft-only" } },
  ], true), event => progress.push(event));
  assert.equal(progress[0].message, "Coverage — adjusted");
  assert.equal(result.draft.draft_id, "test-draft-only");
});
test("HTTP 200 terminal error remains a failure; disconnected/invalid streams never fabricate results", async () => {
  await assert.rejects(() => consumeFetchStream(stream([{ type: "error", error: { code: "YAHOO_DATA_FETCH_FAILED", message: "Yahoo unavailable" } }]), () => {}), /Yahoo unavailable/);
  await assert.rejects(() => consumeFetchStream(stream([{ type: "progress", progress: p }]), () => {}), /before a result was confirmed/);
  await assert.rejects(() => consumeFetchStream(stream([{ type: "progress", progress: { ...p, remaining: 100 } }]), () => {}), /invalid fetch progress/);
  await assert.rejects(() => consumeFetchStream(new Response("proxy error", { status: 502 }), () => {}), /HTTP 502/);
});
test("A complete progress update without the result is not a confirmed completion", async () => {
  await assert.rejects(() => consumeFetchStream(stream([{ type: "progress", progress: { ...p, phase: "COMPLETE", completed: 2, successful: 2, remaining: 0, percent: 100 } }]), () => {}), /before a result was confirmed/);
});
test("Progress card exposes counts and approximate ETA; interrupted fetch does not display complete", () => {
  const startedAt = Date.now() - 2000;
  const active = renderToStaticMarkup(<DataFetchProgressView progress={p} status="RUNNING" startedAt={startedAt} total={2} />);
  assert.match(active, /1 \/ 2/);
  assert.match(active, /Estimated remaining/);
  assert.match(active, /~[23]s/);
  const failed = renderToStaticMarkup(<DataFetchProgressView progress={{ ...p, percent: 100 }} status="FAILED" startedAt={startedAt} total={2} />);
  assert.match(failed, /Fetch not completed/);
  assert.match(failed, /99%/);
  assert.doesNotMatch(failed, />Fetch complete</);
});
