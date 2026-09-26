import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { allocationsTable } from "./allocations";
import { preparedInputsTable } from "./preparedInputs";

// C2 manifests and computed results are append-only evidence snapshots.
export const c2ExperimentsTable = pgTable("c2_experiments", {
  id: serial("id").primaryKey(),
  allocationId: integer("allocation_id").notNull().references(() => allocationsTable.id),
  validationPreparedInputId: integer("validation_prepared_input_id").notNull()
    .references(() => preparedInputsTable.id),
  c1ExperimentId: integer("c1_experiment_id"),
  manifestHash: text("manifest_hash").notNull(),
  inputHash: text("input_hash").notNull(),
  resultHash: text("result_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("c2_experiments_allocation_time_idx").on(table.allocationId, table.id),
  index("c2_experiments_input_hash_idx").on(table.inputHash),
  index("c2_experiments_c1_id_idx").on(table.c1ExperimentId),
]);

export type C2Experiment = typeof c2ExperimentsTable.$inferSelect;
export type InsertC2Experiment = typeof c2ExperimentsTable.$inferInsert;