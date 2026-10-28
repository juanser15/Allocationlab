import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Structured research records, not file blobs. Old filesystem evidence is untouched.
export const researchRunsTable = pgTable("allocationlab_research_runs", {
  runId: text("run_id").primaryKey(),
  record: jsonb("record").notNull(),
  spec: jsonb("spec").notNull(),
  specHash: text("spec_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const researchAttemptsTable = pgTable("allocationlab_research_attempts", {
  attemptId: text("attempt_id").primaryKey(),
  runId: text("run_id").notNull().references(() => researchRunsTable.runId, { onDelete: "restrict" }),
  view: jsonb("view").notNull(),
  result: jsonb("result"),
  resultHash: text("result_hash"),
  diagnostic: jsonb("diagnostic"),
});
export const researchReviewsTable = pgTable("allocationlab_research_reviews", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => researchRunsTable.runId, { onDelete: "restrict" }),
  attemptId: text("attempt_id").notNull().references(() => researchAttemptsTable.attemptId, { onDelete: "restrict" }),
  event: jsonb("event").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const researchLeasesTable = pgTable("allocationlab_research_leases", {
  name: text("name").primaryKey(),
  lease: jsonb("lease").notNull(),
});
export const insertResearchRunSchema = createInsertSchema(researchRunsTable);
export type ResearchRun = typeof researchRunsTable.$inferSelect;
