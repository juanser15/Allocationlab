import { index, jsonb, pgTable, serial, timestamp, text } from "drizzle-orm/pg-core";

export const preparedInputsTable = pgTable("prepared_inputs", {
  id: serial("id").primaryKey(),
  representation: text("representation").notNull(),
  fingerprint: text("fingerprint").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("prepared_inputs_fingerprint_idx").on(table.fingerprint)]);

export type PreparedInput = typeof preparedInputsTable.$inferSelect;
export type InsertPreparedInput = typeof preparedInputsTable.$inferInsert;