-- P0 Data & Workspace: additive tables only. Existing research evidence is untouched.
CREATE TABLE IF NOT EXISTS allocationlab_dataset_versions (
  dataset_id text PRIMARY KEY,
  dataset_name text NOT NULL,
  dataset_version integer NOT NULL CHECK (dataset_version > 0),
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL,
  payload_gzip bytea NOT NULL,
  source_draft_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_name, dataset_version)
);
CREATE TABLE IF NOT EXISTS allocationlab_dataset_drafts (
  draft_id text PRIMARY KEY,
  metadata jsonb NOT NULL,
  payload_gzip bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS allocationlab_workspace_state (
  workspace_id text PRIMARY KEY,
  active_dataset_id text NOT NULL REFERENCES allocationlab_dataset_versions(dataset_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS allocationlab_dataset_run_references (
  run_id text PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES allocationlab_dataset_versions(dataset_id) ON DELETE RESTRICT,
  dataset_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION allocationlab_reject_dataset_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable dataset evidence cannot be changed'; END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'allocationlab_dataset_version_immutable') THEN
    CREATE TRIGGER allocationlab_dataset_version_immutable BEFORE UPDATE OR DELETE ON allocationlab_dataset_versions FOR EACH ROW EXECUTE FUNCTION allocationlab_reject_dataset_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'allocationlab_dataset_reference_immutable') THEN
    CREATE TRIGGER allocationlab_dataset_reference_immutable BEFORE UPDATE OR DELETE ON allocationlab_dataset_run_references FOR EACH ROW EXECUTE FUNCTION allocationlab_reject_dataset_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'allocationlab_dataset_draft_immutable') THEN
    CREATE TRIGGER allocationlab_dataset_draft_immutable BEFORE UPDATE OR DELETE ON allocationlab_dataset_drafts FOR EACH ROW EXECUTE FUNCTION allocationlab_reject_dataset_mutation();
  END IF;
END $$;
