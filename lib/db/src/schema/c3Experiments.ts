import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { allocationsTable } from "./allocations";
import { preparedInputsTable } from "./preparedInputs";
import { c2ExperimentsTable } from "./c2Experiments";

// C3 manifests, child B3 references, and results are append-only evidence.
export const c3ExperimentsTable = pgTable("c3_experiments", {
  id: serial("id").primaryKey(),
  allocationId: integer("allocation_id").notNull().references(() => allocationsTable.id),
  validationPreparedInputId: integer("validation_prepared_input_id").notNull()
    .references(() => preparedInputsTable.id),
  c2ExperimentId: integer("c2_experiment_id").notNull().references(() => c2ExperimentsTable.id),
  manifestHash: text("manifest_hash").notNull(),
  inputHash: text("input_hash").notNull(),
  resultHash: text("result_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  childValidationRunIds: jsonb("child_validation_run_ids").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("c3_experiments_allocation_time_idx").on(table.allocationId, table.id),
  index("c3_experiments_input_hash_idx").on(table.inputHash),
  index("c3_experiments_c2_id_idx").on(table.c2ExperimentId),
]);

export type C3Experiment = typeof c3ExperimentsTable.$inferSelect;
export type InsertC3Experiment = typeof c3ExperimentsTable.$inferInsert;