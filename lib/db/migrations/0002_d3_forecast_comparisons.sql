CREATE TABLE IF NOT EXISTS "d3_forecast_comparisons" (
  "id" serial PRIMARY KEY NOT NULL,
  "sample_mean_allocation_id" integer NOT NULL REFERENCES "allocations"("id"),
  "sample_mean_validation_run_id" integer REFERENCES "validation_runs"("id"),
  "shrunk_mean_allocation_id" integer NOT NULL REFERENCES "allocations"("id"),
  "shrunk_mean_validation_run_id" integer REFERENCES "validation_runs"("id"),
  "bayesian_views_allocation_id" integer NOT NULL REFERENCES "allocations"("id"),
  "bayesian_views_validation_run_id" integer REFERENCES "validation_runs"("id"),
  "manifest_hash" text NOT NULL,
  "result_hash" text NOT NULL,
  "manifest_json" jsonb NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "d3_forecast_comparisons_manifest_hash_idx"
  ON "d3_forecast_comparisons" ("manifest_hash");
CREATE INDEX IF NOT EXISTS "d3_forecast_comparisons_created_idx"
  ON "d3_forecast_comparisons" ("created_at", "id");