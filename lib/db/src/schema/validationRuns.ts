import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sessionsTable } from "./sessions";
import { allocationsTable } from "./allocations";
import { preparedInputsTable } from "./preparedInputs";

// Append-only: there are deliberately no application update/delete operations.
export const validationRunsTable = pgTable("validation_runs", {
  id: serial("id").primaryKey(),
  strategySnapshotId: integer("strategy_snapshot_id").references(() => sessionsTable.id),
  allocationId: integer("allocation_id").references(() => allocationsTable.id),
  validationPreparedInputId: integer("validation_prepared_input_id").references(() => preparedInputsTable.id),
  datasetHash: text("dataset_hash").notNull(),
  factorSetVersion: text("factor_set_version").notNull(),
  engineVersion: text("engine_version").notNull(),
  validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
  assumptions: jsonb("assumptions").notNull(),
  resultJson: jsonb("result_json").notNull(),
  reconciliationStatus: text("reconciliation_status").notNull(),
  reproducibilityStatus: text("reproducibility_status").notNull(),
  validationInputHash: text("validation_input_hash").notNull(),
}, (t) => [
  index("validation_runs_strategy_time_idx").on(t.strategySnapshotId, t.id),
  index("validation_runs_allocation_time_idx").on(t.allocationId, t.id),
]);

export const insertValidationRunSchema = createInsertSchema(validationRunsTable);
export type ValidationRun = typeof validationRunsTable.$inferSelect;
export type InsertValidationRun = typeof validationRunsTable.$inferInsert;