import { createHash, randomUUID } from "node:crypto";
import {
  type NormalizedResearchRunSpec,
  RESEARCH_RUN_SPEC_VERSION,
  STORAGE_CLASSIFICATION,
  type ResearchRunSpec,
  normalizeResearchRunSpec,
} from "./contracts";

export const RUN_ID_PATTERN = /^rr_[0-9a-f]{64}$/;
export const EXECUTION_ATTEMPT_ID_PATTERN = /^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const IDENTITY_EXCLUDED_FIELDS = new Set([
  "$schema",
  "contract_version",
  "run_id",
  "created_at",
  "requested_by",
  "storage_policy",
]);

/**
 * Canonical JSON required by the Phase A contract: object keys sorted by the
 * JavaScript default UTF-16 ordering, arrays preserved, finite JSON numbers
 * emitted without rounding, and negative zero normalized to zero.
 */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();

  const visit = (item: unknown, path: string): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must contain only finite numbers`);
      return Object.is(item, -0) ? "0" : JSON.stringify(item);
    }
    if (typeof item === "undefined") throw new TypeError(`${path} contains prohibited undefined`);
    if (typeof item !== "object") throw new TypeError(`${path} contains a non-JSON value`);

    if (active.has(item)) throw new TypeError(`${path} contains a circular reference`);
    active.add(item);
    try {
      if (Array.isArray(item)) {
        const values: string[] = [];
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(item, index)) {
            throw new TypeError(`${path}[${index}] is a sparse array entry`);
          }
          values.push(visit(item[index], `${path}[${index}]`));
        }
        return `[${values.join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only plain JSON objects`);
      }
      if (Object.getOwnPropertySymbols(item).length) {
        throw new TypeError(`${path} contains unsupported symbol keys`);
      }
      const record = item as Record<string, unknown>;
      const entries = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key], `${path}.${key}`)}`);
      return `{${entries.join(",")}}`;
    } finally {
      active.delete(item);
    }
  };

  return visit(value, "$");
}

/** Returns the exact normalized fields that affect financial run identity. */
export function researchRunIdentityPayload(
  spec: NormalizedResearchRunSpec | ResearchRunSpec | Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (!IDENTITY_EXCLUDED_FIELDS.has(key)) payload[key] = value;
  }
  return payload;
}

export function calculateRunId(
  spec: NormalizedResearchRunSpec | ResearchRunSpec | Record<string, unknown>,
): `rr_${string}` {
  const digest = createHash("sha256").update(canonicalJson(researchRunIdentityPayload(spec)), "utf8").digest("hex");
  return `rr_${digest}`;
}

export const runIdForSpec = calculateRunId;

export interface CreateResearchRunSpecOptions {
  createdAt?: string;
}

const normalizeTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("created_at must be a valid RFC 3339 timestamp");
  return parsed.toISOString();
};

/** Validates, expands, identifies, and envelopes a Phase B1 request. */
export function createResearchRunSpec(value: unknown, options: CreateResearchRunSpecOptions = {}): ResearchRunSpec {
  const normalized = normalizeResearchRunSpec(value);
  const runId = calculateRunId(normalized);
  const createdAt = normalizeTimestamp(options.createdAt ?? new Date().toISOString());
  return {
    ...normalized,
    contract_version: RESEARCH_RUN_SPEC_VERSION,
    run_id: runId,
    created_at: createdAt,
    requested_by: "WORKBENCH_API_CLIENT",
    storage_policy: {
      kind: STORAGE_CLASSIFICATION,
      durability: "NOT_GUARANTEED",
      root_source: "SERVER_CONFIGURED",
      attempt_policy: "IMMUTABLE_APPEND_ONLY",
    },
  };
}

export function createExecutionAttemptId(): `ea_${string}` {
  return `ea_${randomUUID()}`;
}

export const isRunId = (value: unknown): value is `rr_${string}` =>
  typeof value === "string" && RUN_ID_PATTERN.test(value);

export const isExecutionAttemptId = (value: unknown): value is `ea_${string}` =>
  typeof value === "string" && EXECUTION_ATTEMPT_ID_PATTERN.test(value);
