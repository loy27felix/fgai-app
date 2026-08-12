-- Monthly usage budgets and timing metadata.
-- Amounts are stored in USD, while the UI may display/edit the equivalent CNY.

alter table public.ai_usage_ledger
  add column if not exists duration_ms bigint not null default 0;

create table if not exists public.ai_usage_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month_start date not null,
  limit_usd numeric(20,10) not null check (limit_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_start)
);

create index if not exists ai_usage_budgets_month_idx
  on public.ai_usage_budgets(month_start, user_id);

alter table public.ai_usage_budgets enable row level security;

drop policy if exists "usage budgets self read" on public.ai_usage_budgets;
create policy "usage budgets self read"
  on public.ai_usage_budgets for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "usage budgets admin write" on public.ai_usage_budgets;
create policy "usage budgets admin write"
  on public.ai_usage_budgets for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.touch_ai_usage_budget_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists ai_usage_budgets_touch_updated_at on public.ai_usage_budgets;
create trigger ai_usage_budgets_touch_updated_at
  before update on public.ai_usage_budgets
  for each row execute function public.touch_ai_usage_budget_updated_at();
