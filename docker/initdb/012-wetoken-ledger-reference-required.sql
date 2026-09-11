begin;

-- A WeToken invoice can be assigned only by the provider's exact Reference
-- ID. Keep submitted/unknown rows valid for uncertain provider outcomes, but
-- reject every future successful settlement that failed to persist that ID.
-- NOT VALID preserves historical rows for explicit reconciliation while
-- enforcing the invariant for all new inserts and updates.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_usage_ledger_wetoken_succeeded_reference_check'
  ) then
    alter table ai_usage_ledger
      add constraint ai_usage_ledger_wetoken_succeeded_reference_check
      check (
        provider <> 'wetoken'
        or status <> 'succeeded'
        or nullif(btrim(provider_request_id), '') is not null
      ) not valid;
  end if;
end $$;

commit;
