import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const decisionLogsTable = pgTable("decision_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().unique(),
  portfolioVersion: text("portfolio_version").notNull(),
  status: text("status").notNull().default("draft"),
  regimeLabel: text("regime_label").notNull(),
  regimeComposite: integer("regime_composite").notNull(),
  contentJson: jsonb("content_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
});

export type DecisionLogRow = typeof decisionLogsTable.$inferSelect;
export type InsertDecisionLogRow = typeof decisionLogsTable.$inferInsert;
