begin;

-- WeToken's CSV exports `Time` as an Asia/Shanghai wall-clock value without
-- an offset. The first importer stored that value as UTC in a timestamptz,
-- which made the browser display each historical record eight hours late.
-- Mark normalized rows so this data correction remains idempotent.
update wetoken_fee_log_exceptions
set
  occurred_at = occurred_at - interval '8 hours',
  details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
    'occurred_at_timezone', 'Asia/Shanghai',
    'occurred_at_normalized_by', '011-wetoken-fee-timezone-and-company-backfill'
  ),
  updated_at = now()
where occurred_at is not null
  and coalesce(details ->> 'occurred_at_timezone', '') <> 'Asia/Shanghai';

-- Approved one-time disposition for the 1,194 historical September lines with
-- no local task ownership. These remain fully visible in reconciliation, but
-- are explicitly company/shared cost and are never charged to an arbitrary
-- user. Constraining the backfill to this settled billing month prevents a
-- later import from silently receiving a historical-company decision.
update wetoken_fee_log_exceptions
set
  assignment_kind = 'company',
  assigned_user_id = null,
  assigned_usage_kind = null,
  assigned_by = null,
  assigned_at = now(),
  assignment_ledger_id = null,
  assignment_note = '历史遗留费用：无本地 Reference ID 归属，按管理员决定统一归入公司 / 共享成本',
  updated_at = now()
where month_start = date '2026-09-01'
  and assignment_kind = 'pending';

commit;
