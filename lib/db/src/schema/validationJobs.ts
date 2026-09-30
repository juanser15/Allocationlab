import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { allocationsTable } from "./allocations";
import { validationRunsTable } from "./validationRuns";

export const validationJobsTable = pgTable("validation_jobs", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  request: jsonb("request").notNull(),
  frozenInputs: jsonb("frozen_inputs").notNull(),
  sessionId: integer("session_id").references(() => sessionsTable.id),
  allocationId: integer("allocation_id").references(() => allocationsTable.id),
  status: text("status").notNull().default("queued"),
  phase: text("phase").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  validationRunId: integer("validation_run_id").unique().references(() => validationRunsTable.id),
  error: jsonb("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("validation_jobs_idempotency_key_uidx").on(table.idempotencyKey),
  index("validation_jobs_session_idx").on(table.sessionId, table.createdAt),
  index("validation_jobs_allocation_idx").on(table.allocationId, table.createdAt),
  index("validation_jobs_claim_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
]);

export const insertValidationJobSchema = createInsertSchema(validationJobsTable);
export type InsertValidationJob = typeof validationJobsTable.$inferInsert;
export type ValidationJob = typeof validationJobsTable.$inferSelect;