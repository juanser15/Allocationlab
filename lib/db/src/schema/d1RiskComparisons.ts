import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { allocationsTable } from "./allocations";
import { validationRunsTable } from "./validationRuns";

// Controlled three-estimator comparisons are append-only, immutable audit records.
export const d1RiskComparisonsTable = pgTable("d1_risk_comparisons", {
  id: serial("id").primaryKey(),
  sampleAllocationId: integer("sample_allocation_id").notNull().references(() => allocationsTable.id),
  sampleValidationRunId: integer("sample_validation_run_id").notNull().references(() => validationRunsTable.id),
  diagonalShrinkageAllocationId: integer("diagonal_shrinkage_allocation_id").notNull().references(() => allocationsTable.id),
  diagonalShrinkageValidationRunId: integer("diagonal_shrinkage_validation_run_id").notNull().references(() => validationRunsTable.id),
  statisticalFactorAllocationId: integer("statistical_factor_allocation_id").notNull().references(() => allocationsTable.id),
  statisticalFactorValidationRunId: integer("statistical_factor_validation_run_id").notNull().references(() => validationRunsTable.id),
  manifestHash: text("manifest_hash").notNull(),
  resultHash: text("result_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("d1_risk_comparisons_manifest_hash_idx").on(table.manifestHash),
  index("d1_risk_comparisons_created_idx").on(table.createdAt, table.id),
]);

export type D1RiskComparison = typeof d1RiskComparisonsTable.$inferSelect;
export type InsertD1RiskComparison = typeof d1RiskComparisonsTable.$inferInsert;