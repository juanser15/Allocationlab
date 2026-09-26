import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { allocationsTable } from "./allocations";
import { validationRunsTable } from "./validationRuns";

// Append-only snapshots comparing economically distinct B2 allocation modes.
export const d2AllocationModeComparisonsTable = pgTable("d2_allocation_mode_comparisons", {
  id: serial("id").primaryKey(),
  capitalLongOnlyAllocationId: integer("capital_long_only_allocation_id").notNull()
    .references(() => allocationsTable.id),
  capitalLongOnlyValidationRunId: integer("capital_long_only_validation_run_id").notNull()
    .references(() => validationRunsTable.id),
  signedOverlayAllocationId: integer("signed_overlay_allocation_id").notNull()
    .references(() => allocationsTable.id),
  signedOverlayValidationRunId: integer("signed_overlay_validation_run_id").notNull()
    .references(() => validationRunsTable.id),
  manifestHash: text("manifest_hash").notNull(),
  resultHash: text("result_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("d2_allocation_mode_comparisons_manifest_hash_idx").on(table.manifestHash),
  index("d2_allocation_mode_comparisons_created_idx").on(table.createdAt, table.id),
]);

export const insertD2AllocationModeComparisonSchema = createInsertSchema(d2AllocationModeComparisonsTable)
  .omit({ id: true, createdAt: true });
export type InsertD2AllocationModeComparisonInput = z.infer<typeof insertD2AllocationModeComparisonSchema>;
export type D2AllocationModeComparison = typeof d2AllocationModeComparisonsTable.$inferSelect;
export type InsertD2AllocationModeComparison = typeof d2AllocationModeComparisonsTable.$inferInsert;