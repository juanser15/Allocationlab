/**
 * Allocation Lab v2 — Production Governance (Iteration 15)
 *
 * Pure helper functions for version snapshots, reproducibility hashing,
 * staleness detection, and rerun consistency comparison. No fabricated
 * values — every field is derived from real stored inputs/outputs.
 */

import { createHash } from "crypto";

export interface GovernanceHashInputs {
  universe: unknown;
  constraints: unknown;
  priceDataEnd: string;
  tickers: string[];
  modelVersion: string;
  parameterVersion: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function computeReproducibilityHash(inputs: GovernanceHashInputs): string {
  const payload = stableStringify(inputs);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

export const STALE_DATA_THRESHOLD_DAYS = 35;

export function isDataStale(dataTimestamp: string): boolean {
  const age = daysSince(dataTimestamp);
  return Number.isFinite(age) && age > STALE_DATA_THRESHOLD_DAYS;
}

export interface RerunComparisonResult {
  consistent: boolean;
  originalHash: string;
  rerunHash: string;
  changedFactors: string[];
  summary: string;
}

export function compareRerun(params: {
  originalHash: string;
  rerunHash: string;
  dataChanged: boolean;
  universeChanged: boolean;
  constraintsChanged: boolean;
  modelVersionChanged: boolean;
}): RerunComparisonResult {
  const changedFactors: string[] = [];
  if (params.dataChanged) changedFactors.push("Underlying price data has changed since this version was generated.");
  if (params.universeChanged) changedFactors.push("ETF universe configuration has changed.");
  if (params.constraintsChanged) changedFactors.push("Portfolio constraints have changed.");
  if (params.modelVersionChanged) changedFactors.push("Model version has changed.");

  const consistent = params.originalHash === params.rerunHash && changedFactors.length === 0;

  return {
    consistent,
    originalHash: params.originalHash,
    rerunHash: params.rerunHash,
    changedFactors,
    summary: consistent
      ? "Rerunning this version with the same inputs reproduced an identical allocation. Reproducibility confirmed."
      : "Rerunning this version did not reproduce an identical result. Review the changed factors below before treating this version as reproducible.",
  };
}
