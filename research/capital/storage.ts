import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { canonical, hash } from "./spec";
export const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export function jsonSafe(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Nonfinite JSON/cache value");
  if (value === undefined || typeof value === "function" || typeof value === "bigint" || typeof value === "symbol") throw new Error("Non-JSON/cache value");
  if (Array.isArray(value)) { value.forEach(jsonSafe); return; }
  if (value && typeof value === "object") {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Cache state must be plain JSON data");
    Object.values(value).filter(v => v !== undefined).forEach(jsonSafe);
  }
}
export function immutable<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function atomicText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + `.tmp-${process.pid}`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); }
  catch (error) { if (existsSync(tmp)) unlinkSync(tmp); throw error; }
}
export function atomicJson(path: string, value: unknown) {
  jsonSafe(value); atomicText(path, JSON.stringify(value, null, 2) + "\n");
}
export function freezeJson(path: string, value: unknown) {
  if (existsSync(path)) { if (canonical(readJson(path)) !== canonical(value)) throw new Error(`Frozen artifact differs: ${path}`); }
  else atomicJson(path, value);
}
export class Cache {
  fits = 0; hits = 0; misses = 0;
  constructor(readonly root: string) {}
  get(parts: unknown, calculate: () => unknown): { key: string; value: any } {
    const key = hash(parts), path = `${this.root}/${key}.json`;
    if (existsSync(path)) {
      const found = readJson(path);
      jsonSafe(found.value);
      if (found.key !== key || canonical(found.parts) !== canonical(parts) || found.value_hash !== hash(found.value)) throw new Error("Cache identity/integrity mismatch");
      this.hits++; return { key, value: found.value };
    }
    this.misses++;
    const value = calculate(); jsonSafe(value); this.fits++;
    atomicJson(path, { key, parts, value, value_hash: hash(value) }); return { key, value };
  }
}
export function writeCsv(path: string, records: Record<string, unknown>[], headers?: string[]) {
  mkdirSync(dirname(path), { recursive: true });
  const keys = headers ?? [...new Set(records.flatMap(r => Object.keys(r)))];
  const cell = (v: unknown) => '"' + (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll('"', '""') + '"';
  atomicText(path, keys.map(cell).join(",") + "\r\n" + records.map(r => keys.map(k => cell(r[k])).join(",")).join("\r\n") + (records.length ? "\r\n" : ""));
}
