begin;

-- A provider Reference ID is the only durable join key to the WeToken fee CSV.
-- Keep historical duplicate rows untouched for auditability, but prevent any
-- new insert/update from attaching the same provider charge to two ledgers.
create or replace function prevent_duplicate_wetoken_provider_reference()
returns trigger
language plpgsql
as $$
declare
  normalized_reference text;
begin
  if new.provider <> 'wetoken' then
    return new;
  end if;

  normalized_reference := nullif(btrim(new.provider_request_id), '');
  if normalized_reference is null then
    return new;
  end if;

  -- Serialize writes for the same provider/reference pair so two concurrent
  -- confirmations cannot both pass the existence check below.
  perform pg_advisory_xact_lock(hashtextextended('wetoken:' || normalized_reference, 0));
  new.provider_request_id := normalized_reference;

  if exists (
    select 1
    from ai_usage_ledger ledger
    where ledger.provider = 'wetoken'
      and nullif(btrim(ledger.provider_request_id), '') = normalized_reference
      and ledger.id <> new.id
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'ai_usage_ledger_wetoken_provider_reference_key',
      message = 'WeToken Reference ID 已绑定其他账本，已阻止重复记账';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_usage_ledger_wetoken_provider_reference_guard on ai_usage_ledger;
create trigger ai_usage_ledger_wetoken_provider_reference_guard
before insert or update of provider, provider_request_id on ai_usage_ledger
for each row execute function prevent_duplicate_wetoken_provider_reference();

commit;
