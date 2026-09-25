import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const allocationsTable = pgTable("allocations", {
  id: serial("id").primaryKey(),
  preparedInputId: integer("prepared_input_id").notNull(),
  representation: text("representation").notNull(),
  fingerprint: text("fingerprint").notNull(),
  frozenSnapshotHash: text("frozen_snapshot_hash").notNull(),
  engineVersion: text("engine_version").notNull(),
  frozenRequest: jsonb("frozen_request").notNull(),
  frozenSnapshot: jsonb("frozen_snapshot").notNull(),
  frozenResult: jsonb("frozen_result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("allocations_prepared_input_id_idx").on(table.preparedInputId),
  index("allocations_fingerprint_idx").on(table.fingerprint),
]);

export type Allocation = typeof allocationsTable.$inferSelect;
export type InsertAllocation = typeof allocationsTable.$inferInsert;