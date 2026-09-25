import { createHash } from "node:crypto";
import { db, validationRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { BacktestResult } from "@workspace/api-zod";
import { toB3ValidationRun } from "./b3-validation-store";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stable(entry)]));
  return value;
}

export function validationInputHash(identity: NonNullable<BacktestResult["validationIdentity"]>): string {
  // Include every consumed input. JSONB key order must not change the digest.
  return createHash("sha256").update(JSON.stringify(stable({
    strategySnapshotId: identity.optimizationRunId,
    datasetHash: identity.datasetHash,
    factorSetVersion: identity.factorSetVersion,
    factorSetSnapshot: identity.factorSetSnapshot,
    constraintsSnapshot: identity.constraintsSnapshot,
    universeSnapshot: identity.universeSnapshot,
    engineVersion: identity.engineVersion,
    validationAssumptions: identity.validationAssumptions,
  }))).digest("hex");
}

function reconciliationStatus(result: BacktestResult): "pass" | "fail" {
  const ledger = result.dailyLedger;
  if (!ledger.length || ledger.length !== result.tradingDays) return "fail";
  return ledger.every((entry, index) =>
    Math.abs(entry.beginningNav + entry.netPnl - entry.endingNav) <= 1e-8 &&
    Math.abs(entry.endingCash + entry.endingPositions.reduce((sum, p) => sum + p.marketValue, 0) - entry.endingNav) <= 1e-8 &&
    Math.abs(entry.endingNav - result.equityCurve[index + 1]?.portfolioIndex) <= 1e-8
  ) ? "pass" : "fail";
}

export async function persistValidationRun(result: BacktestResult) {
  const identity = result.validationIdentity;
  if (!result.hasSufficientData || !identity || result.snapshotStatus !== "ready" ||
      result.reproducibility.status !== "pass")
    throw new Error(result.insufficientReason ?? "Only completed validations of reproducible Strategy Snapshots can be saved.");
  const reconciliation = reconciliationStatus(result);
  if (reconciliation !== "pass") throw new Error("Ledger reconciliation failed; validation was not saved.");
  const [row] = await db.insert(validationRunsTable).values({
    strategySnapshotId: identity.optimizationRunId,
    datasetHash: identity.datasetHash,
    factorSetVersion: identity.factorSetVersion,
    engineVersion: identity.engineVersion,
    validatedAt: new Date(identity.validatedAt),
    assumptions: identity.validationAssumptions,
    resultJson: result,
    reconciliationStatus: reconciliation,
    reproducibilityStatus: result.reproducibility.status,
    validationInputHash: validationInputHash(identity),
  }).returning();
  return toValidationRun(row);
}

function toValidationRun(row: typeof validationRunsTable.$inferSelect) {
  return {
    validationRunId: row.id,
    strategySnapshotId: row.strategySnapshotId,
    datasetHash: row.datasetHash,
    factorSetVersion: row.factorSetVersion,
    engineVersion: row.engineVersion,
    validatedAt: row.validatedAt.toISOString(),
    assumptions: row.assumptions as NonNullable<BacktestResult["validationIdentity"]>["validationAssumptions"],
    reconciliationStatus: row.reconciliationStatus,
    reproducibilityStatus: row.reproducibilityStatus,
    validationInputHash: row.validationInputHash,
    result: row.resultJson as BacktestResult,
  };
}

export async function getValidationRun(id: number) {
  const [row] = await db.select().from(validationRunsTable).where(eq(validationRunsTable.id, id)).limit(1);
  return row ? row.allocationId !== null ? toB3ValidationRun(row) : toValidationRun(row) : null;
}

export async function listValidationRuns(strategySnapshotId: number) {
  const rows = await db.select().from(validationRunsTable)
    .where(eq(validationRunsTable.strategySnapshotId, strategySnapshotId))
    .orderBy(desc(validationRunsTable.id));
  return rows.map(({ id, strategySnapshotId, validatedAt, reproducibilityStatus }) => ({
    validationRunId: id, strategySnapshotId, validatedAt: validatedAt.toISOString(), reproducibilityStatus,
  }));
}