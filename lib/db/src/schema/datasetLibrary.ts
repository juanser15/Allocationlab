// Keep additive runtime migration 0003 visible to schema-aware deployment tools.
// Dataset bytes are explicitly required to live in PostgreSQL for this project.
import { sql } from "drizzle-orm";
import { check, customType, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const datasetVersionsTable = pgTable("allocationlab_dataset_versions", {
  datasetId: text("dataset_id").primaryKey(),
  datasetName: text("dataset_name").notNull(),
  datasetVersion: integer("dataset_version").notNull(),
  datasetHash: text("dataset_hash").notNull(),
  metadata: jsonb("metadata").notNull(),
  payloadGzip: bytea("payload_gzip").notNull(),
  sourceDraftId: text("source_draft_id").unique("allocationlab_dataset_versions_source_draft_id_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("allocationlab_dataset_versions_dataset_name_dataset_version_key").on(t.datasetName, t.datasetVersion),
  check("allocationlab_dataset_versions_dataset_version_check", sql`${t.datasetVersion} > 0`),
  check("allocationlab_dataset_versions_dataset_hash_check", sql`${t.datasetHash} ~ '^[a-f0-9]{64}$'`),
]);
export const datasetDraftsTable = pgTable("allocationlab_dataset_drafts", {
  draftId: text("draft_id").primaryKey(),
  metadata: jsonb("metadata").notNull(),
  payloadGzip: bytea("payload_gzip").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const workspaceStateTable = pgTable("allocationlab_workspace_state", {
  workspaceId: text("workspace_id").primaryKey(),
  activeDatasetId: text("active_dataset_id").notNull().references(() => datasetVersionsTable.datasetId, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const datasetRunReferencesTable = pgTable("allocationlab_dataset_run_references", {
  runId: text("run_id").primaryKey(),
  datasetId: text("dataset_id").notNull().references(() => datasetVersionsTable.datasetId, { onDelete: "restrict" }),
  datasetHash: text("dataset_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
