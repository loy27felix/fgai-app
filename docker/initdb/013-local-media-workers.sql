begin;

-- Durable, user-scoped execution records for post-processing performed by a
-- user's own computer.  Workers never receive provider credentials or NAS
-- paths; they receive short-lived, lease-bound HTTP operations instead.
create table if not exists creator_media_workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null,
  platform text not null,
  architecture text not null,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'offline' check (status in ('online','offline','revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_media_worker_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists creator_media_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references creator_media_workers(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists creator_media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  operation text not null check (operation in ('video_super_resolution','watermark_removal','audio_separation','subtitle_removal','subject_removal')),
  status text not null default 'queued' check (status in ('queued','leased','processing','uploading','retryable','succeeded','failed','cancelled')),
  source_asset_id uuid not null references creator_assets(id) on delete restrict,
  mask_asset_id uuid references creator_assets(id) on delete restrict,
  output_asset_id uuid references creator_assets(id) on delete set null,
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  worker_id uuid references creator_media_workers(id) on delete set null,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  phase text,
  error_code text,
  error_message text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create table if not exists creator_media_processing_job_events (
  id bigserial primary key,
  job_id uuid not null references creator_media_processing_jobs(id) on delete cascade,
  event text not null,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists creator_media_worker_uploads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references creator_media_processing_jobs(id) on delete cascade,
  worker_id uuid not null references creator_media_workers(id) on delete cascade,
  temporary_path text not null,
  final_path text,
  expected_bytes bigint not null check (expected_bytes > 0 and expected_bytes <= 2147483648),
  expected_sha256 text,
  received_bytes bigint not null default 0 check (received_bytes >= 0),
  mime_type text not null,
  status text not null default 'uploading' check (status in ('uploading','verified','failed','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_media_workers_user_idx
  on creator_media_workers(user_id, status, created_at desc);
create index if not exists creator_media_worker_pairings_active_idx
  on creator_media_worker_pairings(user_id, expires_at)
  where consumed_at is null;
create index if not exists creator_media_worker_tokens_worker_idx
  on creator_media_worker_tokens(worker_id, revoked_at);
create index if not exists creator_media_processing_jobs_user_status_idx
  on creator_media_processing_jobs(user_id, status, created_at desc);
create index if not exists creator_media_processing_jobs_lease_idx
  on creator_media_processing_jobs(status, lease_expires_at);
create index if not exists creator_media_processing_jobs_worker_idx
  on creator_media_processing_jobs(worker_id, status);
create index if not exists creator_media_processing_job_events_job_idx
  on creator_media_processing_job_events(job_id, created_at desc);
create index if not exists creator_media_worker_uploads_job_idx
  on creator_media_worker_uploads(job_id, status, created_at desc);

create or replace function touch_creator_media_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists creator_media_workers_touch_updated_at on creator_media_workers;
create trigger creator_media_workers_touch_updated_at
before update on creator_media_workers
for each row execute function touch_creator_media_updated_at();

drop trigger if exists creator_media_processing_jobs_touch_updated_at on creator_media_processing_jobs;
create trigger creator_media_processing_jobs_touch_updated_at
before update on creator_media_processing_jobs
for each row execute function touch_creator_media_updated_at();

drop trigger if exists creator_media_worker_uploads_touch_updated_at on creator_media_worker_uploads;
create trigger creator_media_worker_uploads_touch_updated_at
before update on creator_media_worker_uploads
for each row execute function touch_creator_media_updated_at();

commit;

