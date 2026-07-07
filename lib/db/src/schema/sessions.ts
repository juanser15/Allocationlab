import { pgTable, serial, text, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  label: text("label"),
  activeEtfCount: integer("active_etf_count").notNull(),
  cashWeight: real("cash_weight").notNull(),
  regimeLabel: text("regime_label").notNull(),
  regimeComposite: real("regime_composite").notNull(),
  resultJson: jsonb("result_json").notNull(),
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;
