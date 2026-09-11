begin;

-- Historical provider lines can be owned explicitly without ever guessing from
-- model, price or time. A user allocation writes a normal usage-ledger row;
-- a company allocation remains visible in the invoice reconciliation only.
alter table if exists wetoken_fee_log_exceptions
  add column if not exists assignment_kind text not null default 'pending',
  add column if not exists assigned_user_id uuid references app_users(id) on delete set null,
  add column if not exists assigned_usage_kind text,
  add column if not exists assigned_by uuid references app_users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assignment_note text not null default '',
  add column if not exists assignment_ledger_id uuid references ai_usage_ledger(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wetoken_fee_log_exceptions_assignment_kind_check'
  ) then
    alter table wetoken_fee_log_exceptions
      add constraint wetoken_fee_log_exceptions_assignment_kind_check
      check (assignment_kind in ('pending', 'user', 'company'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wetoken_fee_log_exceptions_assigned_usage_kind_check'
  ) then
    alter table wetoken_fee_log_exceptions
      add constraint wetoken_fee_log_exceptions_assigned_usage_kind_check
      check (assigned_usage_kind is null or assigned_usage_kind in ('text', 'image', 'video'));
  end if;
end $$;

create index if not exists wetoken_fee_log_exceptions_assignment_idx
  on wetoken_fee_log_exceptions(month_start, assignment_kind, occurred_at desc);

create index if not exists wetoken_fee_log_exceptions_assigned_user_idx
  on wetoken_fee_log_exceptions(assigned_user_id, occurred_at desc)
  where assigned_user_id is not null;

commit;
