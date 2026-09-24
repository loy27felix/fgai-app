BEGIN;

CREATE TABLE IF NOT EXISTS production_lab_groups (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS production_lab_groups_active_name
  ON production_lab_groups (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS production_lab_group_memberships (
  id bigserial PRIMARY KEY,
  group_id text NOT NULL REFERENCES production_lab_groups(id),
  user_id text NOT NULL,
  group_name_snapshot text NOT NULL,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_by text,
  unassigned_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS production_lab_group_memberships_one_current_group
  ON production_lab_group_memberships (user_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS production_lab_group_memberships_history
  ON production_lab_group_memberships (user_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS production_lab_group_memberships_group_history
  ON production_lab_group_memberships (group_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS production_lab_admin_events (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  group_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_lab_admin_events_created
  ON production_lab_admin_events (created_at DESC);

ALTER TABLE production_lab_script_runs
  ADD COLUMN IF NOT EXISTS reported_cost_usd numeric(20,10),
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(20,10),
  ADD COLUMN IF NOT EXISTS cost_source text NOT NULL DEFAULT 'unknown'
    CHECK (cost_source IN ('reported', 'estimated', 'unknown')),
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS accounting_error text;

-- These are the two groups present in the recorded topic-selection meeting.
-- Membership is deliberately left unassigned for the superadmin to confirm.
INSERT INTO production_lab_groups (id, name, created_by)
VALUES ('meeting-group-1', '小组1', 'system'), ('meeting-group-2', '小组2', 'system')
ON CONFLICT DO NOTHING;

COMMIT;
