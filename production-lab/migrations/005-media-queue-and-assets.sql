BEGIN;

CREATE TABLE IF NOT EXISTS production_lab_media_jobs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  project_id text NOT NULL,
  episode integer NOT NULL CHECK (episode BETWEEN 1 AND 200),
  node_id text,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitting', 'running', 'succeeded', 'failed', 'unknown')),
  provider text NOT NULL DEFAULT 'wetoken',
  provider_request_id text,
  request_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  model text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  estimated_cost_usd numeric(20,10),
  reported_cost_usd numeric(20,10),
  cost_source text NOT NULL DEFAULT 'unknown' CHECK (cost_source IN ('reported', 'estimated', 'unknown')),
  accounting_error text,
  lease_token text,
  lease_expires_at timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (owner_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_lab_media_provider_reference
  ON production_lab_media_jobs(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_lab_media_project_queue
  ON production_lab_media_jobs(project_id, episode, created_at DESC);
CREATE INDEX IF NOT EXISTS production_lab_media_claim_queue
  ON production_lab_media_jobs(status, next_poll_at, created_at);

CREATE TABLE IF NOT EXISTS production_lab_assets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  project_id text,
  episode integer CHECK (episode IS NULL OR episode BETWEEN 1 AND 200),
  scope text NOT NULL CHECK (scope IN ('official', 'story')),
  category text NOT NULL,
  name text NOT NULL,
  character_name text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  view_label text NOT NULL DEFAULT '',
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  media_job_id uuid REFERENCES production_lab_media_jobs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'official' AND project_id IS NULL) OR (scope = 'story' AND project_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS production_lab_assets_scope_style
  ON production_lab_assets(scope, style, created_at DESC);
CREATE INDEX IF NOT EXISTS production_lab_assets_project
  ON production_lab_assets(project_id, episode, created_at DESC);

CREATE TABLE IF NOT EXISTS production_lab_media_job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES production_lab_media_jobs(id) ON DELETE CASCADE,
  actor_id text,
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_lab_media_job_events_created
  ON production_lab_media_job_events(job_id, created_at);

COMMIT;
