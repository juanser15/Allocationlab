import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";

type TraceContext = { id: string; started: number };
const storage = new AsyncLocalStorage<TraceContext>();
// Bundled production code runs from dist/index.mjs; source runs from src/lib.
let artifactDir = dirname(fileURLToPath(import.meta.url));
while (basename(artifactDir) !== "api-server" && dirname(artifactDir) !== artifactDir)
  artifactDir = dirname(artifactDir);
export const D6_TRACE_FILE = process.env.D6_TRACE_FILE ?? resolve(artifactDir, "../../reports/d6-evidence/validation-trace.jsonl");

export function d6TraceContext(): TraceContext {
  return { id: randomUUID(), started: performance.now() };
}

export function withD6Trace<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function d6Trace(stage: string, metadata: Record<string, string | number | boolean | null> = {}): void {
  const context = storage.getStore();
  if (!context) return;
  try {
    mkdirSync(dirname(D6_TRACE_FILE), { recursive: true });
    appendFileSync(D6_TRACE_FILE, JSON.stringify({
      traceId: context.id, pid: process.pid, timestamp: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - context.started), stage, ...metadata,
    }) + "\n");
  } catch (error) {
    // Evidence failures must not change a validation result, but must be visible to operators.
    console.error("D6 trace append failed:", error);
  }
}

export function d6Error(error: unknown): Record<string, string> {
  return { errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error) };
}

export function d6Span<T>(stage: string, fn: () => T, metadata: Record<string, string | number | boolean | null> = {}): T {
  d6Trace(`${stage}.start`, metadata);
  const started = performance.now();
  try {
    const value = fn();
    d6Trace(`${stage}.end`, { ...metadata, durationMs: Math.round(performance.now() - started) });
    return value;
  } catch (error) {
    d6Trace(`${stage}.exception`, { ...metadata, durationMs: Math.round(performance.now() - started), ...d6Error(error) });
    throw error;
  }
}