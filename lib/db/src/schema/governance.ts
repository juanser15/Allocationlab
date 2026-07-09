import { pgTable, serial, integer, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const sessionGovernanceTable = pgTable("session_governance", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().unique(),
  dataTimestamp: text("data_timestamp").notNull(),
  priceSource: text("price_source").notNull(),
  universeJson: jsonb("universe_json").notNull(),
  constraintsJson: jsonb("constraints_json").notNull(),
  executionAssumptionsJson: jsonb("execution_assumptions_json").notNull(),
  benchmarkTicker: text("benchmark_ticker").notNull(),
  modelVersion: text("model_version").notNull(),
  parameterVersion: text("parameter_version").notNull(),
  reproducibilityHash: text("reproducibility_hash").notNull(),
  locked: boolean("locked").notNull().default(false),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const governanceAuditLogTable = pgTable("governance_audit_log", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id"),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SessionGovernanceRow = typeof sessionGovernanceTable.$inferSelect;
export type InsertSessionGovernanceRow = typeof sessionGovernanceTable.$inferInsert;
export type GovernanceAuditLogRow = typeof governanceAuditLogTable.$inferSelect;
export type InsertGovernanceAuditLogRow = typeof governanceAuditLogTable.$inferInsert;
