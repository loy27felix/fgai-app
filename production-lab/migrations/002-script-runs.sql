-- Apply only to PRODUCTION_LAB_DATABASE_URL, never the original production DB.
CREATE TABLE IF NOT EXISTS production_lab_script_runs (
  actor_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  model_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','unknown')),
  skill_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
CREATE INDEX IF NOT EXISTS production_lab_script_runs_actor_created
ON production_lab_script_runs(actor_id, created_at DESC);
