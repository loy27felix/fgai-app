-- Run manually against a NEW pilot database only. Never added to old initdb/migrator.
BEGIN;
CREATE TABLE IF NOT EXISTS production_lab_state (
  id text PRIMARY KEY CHECK (id = 'pilot'),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
