-- Apply only to PRODUCTION_LAB_DATABASE_URL, never the original production DB.
ALTER TABLE production_lab_script_runs
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS task_id text,
  ADD COLUMN IF NOT EXISTS episode integer;

CREATE INDEX IF NOT EXISTS production_lab_script_runs_project_created
ON production_lab_script_runs(project_id, created_at DESC)
WHERE project_id IS NOT NULL;
