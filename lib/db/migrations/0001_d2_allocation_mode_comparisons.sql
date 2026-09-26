CREATE TABLE IF NOT EXISTS "d2_allocation_mode_comparisons" (
  "id" serial PRIMARY KEY NOT NULL,
  "capital_long_only_allocation_id" integer NOT NULL REFERENCES "allocations"("id"),
  "capital_long_only_validation_run_id" integer NOT NULL REFERENCES "validation_runs"("id"),
  "signed_overlay_allocation_id" integer NOT NULL REFERENCES "allocations"("id"),
  "signed_overlay_validation_run_id" integer NOT NULL REFERENCES "validation_runs"("id"),
  "manifest_hash" text NOT NULL,
  "result_hash" text NOT NULL,
  "manifest_json" jsonb NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "d2_allocation_mode_comparisons_manifest_hash_idx"
  ON "d2_allocation_mode_comparisons" ("manifest_hash");
CREATE INDEX IF NOT EXISTS "d2_allocation_mode_comparisons_created_idx"
  ON "d2_allocation_mode_comparisons" ("created_at", "id");