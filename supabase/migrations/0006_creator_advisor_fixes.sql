drop policy if exists "usage ledger self read" on public.ai_usage_ledger;
drop policy if exists "usage ledger admin read" on public.ai_usage_ledger;
drop policy if exists "usage ledger authorized read" on public.ai_usage_ledger;

create policy "usage ledger authorized read"
  on public.ai_usage_ledger
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
  );
