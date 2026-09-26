import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { allocationsTable } from "./allocations";
import { validationRunsTable } from "./validationRuns";

// Append-only frozen snapshots comparing controlled D3 forecast estimators.
export const d3ForecastComparisonsTable = pgTable("d3_forecast_comparisons", {
  id: serial("id").primaryKey(),
  sampleMeanAllocationId: integer("sample_mean_allocation_id").notNull().references(() => allocationsTable.id),
  sampleMeanValidationRunId: integer("sample_mean_validation_run_id").references(() => validationRunsTable.id),
  shrunkMeanAllocationId: integer("shrunk_mean_allocation_id").notNull().references(() => allocationsTable.id),
  shrunkMeanValidationRunId: integer("shrunk_mean_validation_run_id").references(() => validationRunsTable.id),
  bayesianViewsAllocationId: integer("bayesian_views_allocation_id").notNull().references(() => allocationsTable.id),
  bayesianViewsValidationRunId: integer("bayesian_views_validation_run_id").references(() => validationRunsTable.id),
  manifestHash: text("manifest_hash").notNull(),
  resultHash: text("result_hash").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("d3_forecast_comparisons_manifest_hash_idx").on(table.manifestHash),
  index("d3_forecast_comparisons_created_idx").on(table.createdAt, table.id),
]);

export type D3ForecastComparison = typeof d3ForecastComparisonsTable.$inferSelect;
export type InsertD3ForecastComparison = typeof d3ForecastComparisonsTable.$inferInsert;