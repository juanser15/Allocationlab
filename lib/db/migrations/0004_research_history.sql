-- Development additive migration. Production schema is applied by Publish, not startup.
CREATE TABLE IF NOT EXISTS allocationlab_research_runs (
 run_id text PRIMARY KEY, record jsonb NOT NULL, spec jsonb NOT NULL,
 spec_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS allocationlab_research_attempts (
 attempt_id text PRIMARY KEY, run_id text NOT NULL REFERENCES allocationlab_research_runs(run_id) ON DELETE RESTRICT,
 view jsonb NOT NULL, result jsonb, result_hash text, diagnostic jsonb
);
CREATE TABLE IF NOT EXISTS allocationlab_research_reviews (
 id text PRIMARY KEY, run_id text NOT NULL REFERENCES allocationlab_research_runs(run_id) ON DELETE RESTRICT,
 attempt_id text NOT NULL REFERENCES allocationlab_research_attempts(attempt_id) ON DELETE RESTRICT,
 event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS allocationlab_research_leases (name text PRIMARY KEY, lease jsonb NOT NULL);
