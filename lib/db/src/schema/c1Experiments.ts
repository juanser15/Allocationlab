import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { allocationsTable } from "./allocations";
import { preparedInputsTable } from "./preparedInputs";

// The experiment manifest is immutable after insertion. Lifecycle fields are
// updated as each already-immutable child Validation Run completes.
export const c1ExperimentsTable = pgTable("c1_experiments", {
  id: serial("id").primaryKey(),
  allocationId: integer("allocation_id").notNull().references(() => allocationsTable.id),
  validationPreparedInputId: integer("validation_prepared_input_id").notNull()
    .references(() => preparedInputsTable.id),
  mode: text("mode").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  inputHash: text("input_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  childValidationRunIds: jsonb("child_validation_run_ids").notNull().default([]),
  childResultsJson: jsonb("child_results_json").notNull().default([]),
  summaryJson: jsonb("summary_json"),
  status: text("status").notNull(),
  plannedPolicyCount: integer("planned_policy_count").notNull(),
  actualPolicyCount: integer("actual_policy_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("c1_experiments_allocation_time_idx").on(table.allocationId, table.id),
  index("c1_experiments_input_hash_idx").on(table.inputHash),
]);

export type C1Experiment = typeof c1ExperimentsTable.$inferSelect;
export type InsertC1Experiment = typeof c1ExperimentsTable.$inferInsert;