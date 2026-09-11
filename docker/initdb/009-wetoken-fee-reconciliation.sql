begin;

-- Keep the most recent WeToken CSV settlement visible after a page refresh.
-- Exact line items still settle to ai_usage_ledger; this snapshot accounts for
-- every imported charge, including historical entries without a local owner.
create table if not exists wetoken_fee_log_imports (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  source_file_name text not null default '',
  imported_by uuid not null references app_users(id) on delete restrict,
  imported_count integer not null check (imported_count >= 0),
  imported_cost_usd numeric(20,10) not null check (imported_cost_usd >= 0),
  ledger_matched_count integer not null default 0 check (ledger_matched_count >= 0),
  ledger_matched_cost_usd numeric(20,10) not null default 0 check (ledger_matched_cost_usd >= 0),
  creator_recovered_count integer not null default 0 check (creator_recovered_count >= 0),
  creator_recovered_cost_usd numeric(20,10) not null default 0 check (creator_recovered_cost_usd >= 0),
  project_recovered_count integer not null default 0 check (project_recovered_count >= 0),
  project_recovered_cost_usd numeric(20,10) not null default 0 check (project_recovered_cost_usd >= 0),
  unallocated_count integer not null default 0 check (unallocated_count >= 0),
  unallocated_cost_usd numeric(20,10) not null default 0 check (unallocated_cost_usd >= 0),
  ambiguous_count integer not null default 0 check (ambiguous_count >= 0),
  ambiguous_cost_usd numeric(20,10) not null default 0 check (ambiguous_cost_usd >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wetoken_fee_log_imports_month_created_idx
  on wetoken_fee_log_imports(month_start, created_at desc);

-- Exceptions are first-class accounting records, not a count hidden in the
-- import toast. They are overwritten only for the same provider Reference ID
-- when a later import can resolve that charge to a local user/task.
create table if not exists wetoken_fee_log_exceptions (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  reference_id text not null unique,
  model text not null default '',
  occurred_at timestamptz,
  actual_cost_usd numeric(20,10) not null check (actual_cost_usd >= 0),
  classification text not null check (classification in ('unallocated_historical', 'ambiguous')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wetoken_fee_log_exceptions_month_idx
  on wetoken_fee_log_exceptions(month_start, classification, actual_cost_usd desc);

commit;
