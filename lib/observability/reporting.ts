import { getDeploymentVersion } from '@/lib/version';
import { query, withTransaction } from '@/lib/local/db';
import type { PoolClient } from 'pg';
import { getUsdToCnyRate } from '@/lib/usage/fx';

export type ReportType = 'daily' | 'weekly' | 'monthly';
export type ReportRevision = { reportType: ReportType; periodStart: Date; periodEnd: Date; revision: number; isFinal: boolean };
export type ReportJobResult = { status: 'succeeded' | 'skipped' | 'failed'; reportRunId?: string; reportType: ReportType; revision: number; error?: string };

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Legacy chat rows and ledger rows were dual-written before this cutoff; only
// count the legacy table before it to prevent historical double counting.
// 迁移前聊天同时写入两张表；截止时间前才读取旧表，避免历史数据重复统计。
const LEGACY_USAGE_CUTOFF = '2026-07-15T10:56:12+08:00';
const REPORT_SCHEMA_VERSION = '1';
const STALE_RUNNING_MS = 30 * 60 * 1000;
const MAX_GENERATED_REPORTS_PER_RUN = 4;

type DateParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

function dateParts(date: Date): DateParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[formatted.weekday];
  return {
    year: Number(formatted.year),
    month: Number(formatted.month),
    day: Number(formatted.day),
    weekday: weekday ?? 0,
    hour: Number(formatted.hour),
    minute: Number(formatted.minute),
  };
}

function shanghaiDayStart(date: Date) {
  const parts = dateParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET_MS);
}

function shanghaiMonthStart(date: Date, monthOffset = 0) {
  const parts = dateParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1 + monthOffset, 1) - SHANGHAI_OFFSET_MS);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function previousWindow(type: ReportType, now: Date, distance: number): { start: Date; end: Date } {
  if (type === 'daily') {
    const end = addDays(shanghaiDayStart(now), -(distance - 1));
    return { start: addDays(end, -1), end };
  }
  if (type === 'weekly') {
    const today = shanghaiDayStart(now);
    const currentMonday = addDays(today, -(dateParts(now).weekday === 0 ? 6 : dateParts(now).weekday - 1));
    const end = addDays(currentMonday, -7 * (distance - 1));
    return { start: addDays(end, -7), end };
  }
  const end = shanghaiMonthStart(now, -(distance - 1));
  return { start: shanghaiMonthStart(now, -distance), end };
}

function minutesSinceMidnight(date: Date) {
  const parts = dateParts(date);
  return parts.hour * 60 + parts.minute;
}

function job(reportType: ReportType, window: { start: Date; end: Date }, revision: number, isFinal: boolean): ReportRevision {
  return { reportType, periodStart: window.start, periodEnd: window.end, revision, isFinal };
}

/** Returns catch-up jobs; missing periods are safe because claimReportRun is idempotent. */
export function getDueReportJobs(now = new Date()): ReportRevision[] {
  const parts = dateParts(now);
  const minute = minutesSinceMidnight(now);
  const jobs: ReportRevision[] = [];

  if (minute >= 15) {
    jobs.push(job('daily', previousWindow('daily', now, 1), 0, false));
    for (let distance = 2; distance <= 14; distance += 1) {
      jobs.push(job('daily', previousWindow('daily', now, distance), 1, true));
    }
  }

  const mondayOrLater = parts.weekday >= 1;
  if (mondayOrLater && minute >= 30) {
    jobs.push(job('weekly', previousWindow('weekly', now, 1), 0, false));
  }
  if (parts.weekday >= 3 && minute >= 30) {
    for (let distance = 1; distance <= 8; distance += 1) {
      jobs.push(job('weekly', previousWindow('weekly', now, distance), 1, true));
    }
  }

  if (parts.day >= 1 && minute >= 45) jobs.push(job('monthly', previousWindow('monthly', now, 1), 0, false));
  if (parts.day >= 3 && minute >= 45) {
    for (let distance = 1; distance <= 12; distance += 1) {
      jobs.push(job('monthly', previousWindow('monthly', now, distance), 1, true));
    }
  }
  return jobs;
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function fixed(value: unknown, digits = 6) {
  return Number(numberValue(value).toFixed(digits));
}

function errorMessage(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 1_000) : '';
}

async function claimReportRun(spec: ReportRevision) {
  const existing = await query<{ id: string; status: string; updated_at: string }>(
    `select id, status, updated_at
       from report_runs
      where report_type = $1 and period_start = $2 and period_end = $3 and revision = $4`,
    [spec.reportType, spec.periodStart.toISOString(), spec.periodEnd.toISOString(), spec.revision],
  );
  const current = existing.rows[0];
  if (current?.status === 'succeeded') return null;
  if (current?.status === 'running' && Date.now() - new Date(current.updated_at).getTime() < STALE_RUNNING_MS) return null;

  if (current) {
    const updated = await query<{ id: string }>(
      `update report_runs
          set status = 'running', is_final = $1, data_as_of = now(), error = null, updated_at = now()
        where id = $2
          and (status = 'failed' or updated_at < now() - interval '30 minutes')
      returning id`,
      [spec.isFinal, current.id],
    );
    return updated.rows[0]?.id || null;
  }

  const inserted = await query<{ id: string }>(
    `insert into report_runs
      (report_type, period_start, period_end, revision, status, is_final, data_as_of, schema_version)
     values ($1, $2, $3, $4, 'running', $5, now(), $6)
     on conflict (report_type, period_start, period_end, revision) do nothing
     returning id`,
    [spec.reportType, spec.periodStart.toISOString(), spec.periodEnd.toISOString(), spec.revision, spec.isFinal, REPORT_SCHEMA_VERSION],
  );
  return inserted.rows[0]?.id || null;
}

type AccountRow = {
  user_id: string;
  account_email: string;
  platform_role: string;
  activity_kind: 'ai' | 'session_only' | 'ai_and_session';
  audit_records: string | number;
  usage_calls: string | number;
  successful_calls: string | number;
  failed_calls: string | number;
  in_progress_calls: string | number;
  unknown_calls: string | number;
  input_tokens: string | number;
  output_tokens: string | number;
  total_tokens: string | number;
  image_count: string | number;
  video_seconds: string | number;
  duration_ms: string | number;
  confirmed_cost_usd: string | number;
  estimated_cost_usd: string | number;
  reserved_cost_usd: string | number;
  unknown_cost_calls: string | number;
  error_count: string | number;
};

async function accountRows(spec: ReportRevision) {
  const result = await query<AccountRow>(
    `with usage_facts as (
       select user_id, kind, status, input_tokens, output_tokens, total_tokens,
              image_count, video_seconds, duration_ms, reported_cost_usd,
              estimated_cost_usd, cost_source
         from ai_usage_ledger
        where created_at >= $1 and created_at < $2
       union all
       select user_id, 'text', 'succeeded', input_tokens, completion_tokens, total_tokens,
              0, 0, 0, null, null, 'unknown'
         from ai_usage
        where user_id is not null
          and created_at >= $1 and created_at < $2
          and created_at < $3
     ), usage_rollup as (
       select user_id,
              count(*) as usage_calls,
              count(*) filter (where status = 'succeeded') as successful_calls,
              count(*) filter (where status = 'failed') as failed_calls,
              count(*) filter (where status in ('submitted', 'running', 'unknown')) as in_progress_calls,
              count(*) filter (where status = 'unknown') as unknown_calls,
              coalesce(sum(input_tokens), 0) as input_tokens,
              coalesce(sum(output_tokens), 0) as output_tokens,
              coalesce(sum(total_tokens), 0) as total_tokens,
              coalesce(sum(image_count), 0) as image_count,
              coalesce(sum(video_seconds), 0) as video_seconds,
              coalesce(sum(duration_ms), 0) as duration_ms,
              coalesce(sum(case when reported_cost_usd is not null then abs(reported_cost_usd) else 0 end), 0) as confirmed_cost_usd,
              coalesce(sum(case when reported_cost_usd is null then coalesce(abs(estimated_cost_usd), 0) else 0 end), 0) as estimated_cost_usd,
              coalesce(sum(case when status in ('submitted', 'running', 'unknown', 'succeeded') then coalesce(abs(reported_cost_usd), abs(estimated_cost_usd), 0) else 0 end), 0) as reserved_cost_usd,
              count(*) filter (where reported_cost_usd is null and estimated_cost_usd is null) as unknown_cost_calls
         from usage_facts
        group by user_id
     ), audit_rollup as (
       select actor_id as user_id, count(*) as audit_records
         from audit_events
        where actor_id is not null and occurred_at >= $1 and occurred_at < $2
        group by actor_id
     ), session_rollup as (
       select actor_id as user_id
         from audit_events
        where actor_id is not null and occurred_at >= $1 and occurred_at < $2
          and feature like 'creator_session%'
        group by actor_id
     ), error_rollup as (
       select user_id, count(*) as error_count
         from observability_error_events
        where user_id is not null and occurred_at >= $1 and occurred_at < $2
        group by user_id
       union all
       select actor_id, count(*)
         from audit_events
        where actor_id is not null and occurred_at >= $1 and occurred_at < $2
          and (outcome in ('failed', 'rejected', 'unknown') or (error is not null and error <> 'null'::jsonb))
        group by actor_id
     ), error_totals as (
       select user_id, sum(error_count) as error_count
         from error_rollup
        group by user_id
     ), active_users as (
       select user_id from usage_rollup
       union select user_id from audit_rollup
       union select user_id from error_totals
     )
     select active_users.user_id,
            coalesce(profiles.email, '[已删除账户]') as account_email,
            coalesce(profiles.platform_role, 'user') as platform_role,
            case when usage_rollup.user_id is null then 'session_only'
                 when session_rollup.user_id is not null then 'ai_and_session'
                 else 'ai' end as activity_kind,
            coalesce(audit_rollup.audit_records, 0) as audit_records,
            coalesce(usage_rollup.usage_calls, 0) as usage_calls,
            coalesce(usage_rollup.successful_calls, 0) as successful_calls,
            coalesce(usage_rollup.failed_calls, 0) as failed_calls,
            coalesce(usage_rollup.in_progress_calls, 0) as in_progress_calls,
            coalesce(usage_rollup.unknown_calls, 0) as unknown_calls,
            coalesce(usage_rollup.input_tokens, 0) as input_tokens,
            coalesce(usage_rollup.output_tokens, 0) as output_tokens,
            coalesce(usage_rollup.total_tokens, 0) as total_tokens,
            coalesce(usage_rollup.image_count, 0) as image_count,
            coalesce(usage_rollup.video_seconds, 0) as video_seconds,
            coalesce(usage_rollup.duration_ms, 0) as duration_ms,
            coalesce(usage_rollup.confirmed_cost_usd, 0) as confirmed_cost_usd,
            coalesce(usage_rollup.estimated_cost_usd, 0) as estimated_cost_usd,
            coalesce(usage_rollup.reserved_cost_usd, 0) as reserved_cost_usd,
            coalesce(usage_rollup.unknown_cost_calls, 0) as unknown_cost_calls,
            coalesce(error_totals.error_count, 0) as error_count
       from active_users
       left join profiles on profiles.id = active_users.user_id
       left join usage_rollup on usage_rollup.user_id = active_users.user_id
       left join audit_rollup on audit_rollup.user_id = active_users.user_id
       left join session_rollup on session_rollup.user_id = active_users.user_id
       left join error_totals on error_totals.user_id = active_users.user_id
      order by reserved_cost_usd desc, usage_calls desc, account_email asc`,
    [spec.periodStart.toISOString(), spec.periodEnd.toISOString(), LEGACY_USAGE_CUTOFF],
  );
  return result.rows;
}

type ErrorRow = {
  fingerprint: string;
  source: string;
  service: string;
  severity: string;
  impact: string;
  code: string | null;
  message: string;
  first_occurred_at: string | null;
  last_occurred_at: string | null;
  occurrences: string | number;
  affected_accounts: string | number;
  affected_requests: string | number;
  affected_tasks: string | number;
  sample_trace_id: string | null;
  affected_account_emails?: string[] | null;
  metadata?: unknown;
};

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function errorAccountEmails(row: Pick<ErrorRow, 'affected_account_emails' | 'metadata'>) {
  const direct = stringValues(row.affected_account_emails);
  if (direct.length) return direct;
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return [];
  return stringValues((row.metadata as Record<string, unknown>).affectedAccountEmails);
}

function errorGroupKey(row: Pick<ErrorRow, 'fingerprint' | 'source' | 'service' | 'severity' | 'impact'>) {
  return [row.fingerprint, row.source, row.service, row.severity, row.impact].join('\u001f');
}

async function errorRows(spec: ReportRevision) {
  const result = await query<ErrorRow>(
    `with raw_errors as (
       select occurred_at, source, service, severity, impact, fingerprint, code, message,
              user_id, request_id, task_id, trace_id
         from observability_error_events
        where occurred_at >= $1 and occurred_at < $2
       union all
       select occurred_at,
              case when feature like 'creator_video%' then 'provider'
                   when feature like '%usage%' then 'billing' else 'app' end,
              coalesce(feature, 'app'),
              case when outcome = 'rejected' then 'warning' else 'error' end,
              case when outcome = 'unknown' then 'unknown' else 'blocked' end,
              md5(concat_ws('|', 'audit', feature, action, stage, outcome, coalesce(error->>'message', ''))),
              nullif(error->>'code', ''),
              left(coalesce(nullif(error->>'message', ''), feature || ' ' || stage || ' ' || outcome), 1000),
              actor_id, trace_id,
              case when resource_type = 'creator_generation_task' then resource_id else null end,
              trace_id
         from audit_events
        where occurred_at >= $1 and occurred_at < $2
          and (outcome in ('failed', 'rejected', 'unknown') or (error is not null and error <> 'null'::jsonb))
       union all
       select coalesce(completed_at, updated_at, created_at), 'provider', 'generation_task', 'error',
              case when status = 'unknown' then 'unknown' else 'blocked' end,
              md5(concat_ws('|', 'task', model, status, coalesce(error, ''))),
              null, left(coalesce(nullif(error, ''), 'task status ' || status), 1000),
              user_id, null, id::text, null
         from creator_generation_tasks task
        where status in ('failed', 'unknown')
          and coalesce(completed_at, updated_at, created_at) >= $1
          and coalesce(completed_at, updated_at, created_at) < $2
          and not exists (
            select 1 from audit_events audit
             where audit.resource_id = task.id::text
               and audit.outcome in ('failed', 'rejected', 'unknown')
          )
       union all
       select observed_at, 'infra', service, 'error',
              case when service in ('app', 'postgres') then 'blocked' else 'degraded' end,
              md5(concat_ws('|', 'service', service, check_name, state)),
              state, left(message, 1000), null, null, null, null
         from observability_service_events
        where state = 'unhealthy' and observed_at >= $1 and observed_at < $2
     ), raw_errors_with_accounts as (
       select raw_errors.*,
              coalesce(nullif(profiles.email, ''), '[已删除账户]') as account_email
         from raw_errors
         left join profiles on profiles.id = raw_errors.user_id
     )
     select fingerprint, source, service, severity, impact, max(code) as code,
            max(message) as message, min(occurred_at) as first_occurred_at,
            max(occurred_at) as last_occurred_at, count(*) as occurrences,
            count(distinct user_id) as affected_accounts,
            array_agg(distinct account_email order by account_email)
              filter (where user_id is not null) as affected_account_emails,
            count(distinct coalesce(request_id, trace_id)) as affected_requests,
            count(distinct task_id) as affected_tasks,
            max(trace_id) as sample_trace_id
       from raw_errors_with_accounts
      group by fingerprint, source, service, severity, impact
      order by occurrences desc, last_occurred_at desc`,
    [spec.periodStart.toISOString(), spec.periodEnd.toISOString()],
  );
  return result.rows;
}

type ServiceRow = {
  service: string;
  check_count: string | number;
  healthy_checks: string | number;
  unhealthy_checks: string | number;
  incident_count: string | number;
  observed_seconds: string | number;
  unhealthy_seconds: string | number;
  availability_ratio: string | number | null;
  data_complete: boolean;
  first_observed_at: string | null;
  last_observed_at: string | null;
};

async function serviceRows(spec: ReportRevision) {
  const result = await query<ServiceRow>(
    `with seed as (
       select distinct on (service) service, observed_at, state
         from observability_service_events
        where observed_at < $1
        order by service, observed_at desc
     ), scoped as (
       select service, observed_at, state from seed
       union all
       select service, observed_at, state
         from observability_service_events
        where observed_at >= $1 and observed_at < $2
     ), transitions as (
       select service, observed_at, state,
              lag(state) over (partition by service order by observed_at) as previous_state,
              lead(observed_at) over (partition by service order by observed_at) as next_observed_at
         from scoped
     ), intervals as (
       select service, observed_at, state, previous_state,
              greatest(observed_at, $1::timestamptz) as interval_start,
              least(coalesce(next_observed_at, $2::timestamptz), $2::timestamptz) as interval_end
         from transitions
        where observed_at < $2
     ), measured as (
       select *, extract(epoch from (interval_end - interval_start)) as seconds,
              interval_end - observed_at <= interval '90 seconds' as contiguous
         from intervals
        where interval_end > interval_start
     )
     select service,
            count(*) filter (where observed_at >= $1) as check_count,
            count(*) filter (where observed_at >= $1 and state = 'healthy') as healthy_checks,
            count(*) filter (where observed_at >= $1 and state = 'unhealthy') as unhealthy_checks,
            count(*) filter (where observed_at >= $1 and state = 'unhealthy' and coalesce(previous_state, 'healthy') <> 'unhealthy') as incident_count,
            coalesce(sum(seconds) filter (where contiguous), 0) as observed_seconds,
            coalesce(sum(seconds) filter (where contiguous and state = 'unhealthy'), 0) as unhealthy_seconds,
            case when sum(seconds) filter (where contiguous) > 0
                 then sum(seconds) filter (where contiguous and state = 'healthy') / sum(seconds) filter (where contiguous)
                 else null end as availability_ratio,
            coalesce(min(observed_at) filter (where observed_at >= $1) <= $1::timestamptz + interval '120 seconds', false)
              and coalesce(max(observed_at) filter (where observed_at >= $1) >= $2::timestamptz - interval '120 seconds', false) as data_complete,
            min(observed_at) filter (where observed_at >= $1) as first_observed_at,
            max(observed_at) filter (where observed_at >= $1) as last_observed_at
       from measured
      group by service
      order by service`,
    [spec.periodStart.toISOString(), spec.periodEnd.toISOString()],
  );
  return result.rows;
}

function accountSnapshot(row: AccountRow) {
  return {
    userId: row.user_id,
    accountEmail: row.account_email,
    platformRole: row.platform_role,
    activityKind: row.activity_kind,
    auditRecords: numberValue(row.audit_records),
    usageCalls: numberValue(row.usage_calls),
    successfulCalls: numberValue(row.successful_calls),
    failedCalls: numberValue(row.failed_calls),
    inProgressCalls: numberValue(row.in_progress_calls),
    unknownCalls: numberValue(row.unknown_calls),
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens),
    totalTokens: numberValue(row.total_tokens),
    imageCount: numberValue(row.image_count),
    videoSeconds: fixed(row.video_seconds, 3),
    durationMs: numberValue(row.duration_ms),
    confirmedCostUsd: fixed(row.confirmed_cost_usd, 10),
    estimatedCostUsd: fixed(row.estimated_cost_usd, 10),
    reservedCostUsd: fixed(row.reserved_cost_usd, 10),
    unknownCostCalls: numberValue(row.unknown_cost_calls),
    errorCount: numberValue(row.error_count),
  };
}

function reportSummary(spec: ReportRevision, accounts: ReturnType<typeof accountSnapshot>[], errors: ErrorRow[], services: ServiceRow[]) {
  const total = <T extends keyof ReturnType<typeof accountSnapshot>>(key: T) => accounts.reduce((sum, account) => sum + numberValue(account[key]), 0);
  const confirmedCostUsd = total('confirmedCostUsd');
  const estimatedCostUsd = total('estimatedCostUsd');
  const reservedCostUsd = total('reservedCostUsd');
  const rate = getUsdToCnyRate();
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportType: spec.reportType,
    revision: spec.revision,
    isFinal: spec.isFinal,
    timezone: 'Asia/Shanghai',
    periodStart: spec.periodStart.toISOString(),
    periodEnd: spec.periodEnd.toISOString(),
    dataAsOf: new Date().toISOString(),
    deploymentVersion: getDeploymentVersion(),
    accounts: {
      active: accounts.length,
      aiActive: accounts.filter((account) => account.activityKind !== 'session_only').length,
      sessionOnly: accounts.filter((account) => account.activityKind === 'session_only').length,
    },
    usage: {
      calls: total('usageCalls'),
      successfulCalls: total('successfulCalls'),
      failedCalls: total('failedCalls'),
      inProgressCalls: total('inProgressCalls'),
      inputTokens: total('inputTokens'),
      outputTokens: total('outputTokens'),
      totalTokens: total('totalTokens'),
      imageCount: total('imageCount'),
      videoSeconds: fixed(total('videoSeconds'), 3),
      durationMs: total('durationMs'),
    },
    costs: {
      confirmedUsd: fixed(confirmedCostUsd, 10),
      estimatedUsd: fixed(estimatedCostUsd, 10),
      reservedUsd: fixed(reservedCostUsd, 10),
      unknownCostCalls: total('unknownCostCalls'),
      cnyRate: rate,
      confirmedCny: fixed(confirmedCostUsd * rate, 6),
      estimatedCny: fixed(estimatedCostUsd * rate, 6),
      reservedCny: fixed(reservedCostUsd * rate, 6),
    },
    errors: {
      fingerprints: errors.length,
      occurrences: errors.reduce((sum, error) => sum + numberValue(error.occurrences), 0),
      affectedAccounts: accounts.filter((account) => account.errorCount > 0).length,
      blocked: errors.filter((error) => error.impact === 'blocked').length,
      degraded: errors.filter((error) => error.impact === 'degraded').length,
      unknown: errors.filter((error) => error.impact === 'unknown').length,
    },
    services: {
      monitored: services.length,
      complete: services.filter((service) => service.data_complete).length,
      incidents: services.reduce((sum, service) => sum + numberValue(service.incident_count), 0),
    },
  };
}

async function readReportSnapshots(spec: ReportRevision) {
  // Keep live reads on the same query path as persisted reports so both views remain comparable.
  // 实时视图与持久化报表复用同一套查询，确保两者口径一致。
  const rawAccounts = await accountRows(spec);
  const errors = await errorRows(spec);
  const services = await serviceRows(spec);
  const accounts = rawAccounts.map(accountSnapshot);
  return { accounts, errors, services, summary: reportSummary(spec, accounts, errors, services) };
}

async function insertAccountSnapshots(client: PoolClient, reportRunId: string, rows: ReturnType<typeof accountSnapshot>[]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 23;
    values.push(
      reportRunId, row.userId, row.accountEmail, row.platformRole, row.activityKind, row.auditRecords,
      row.usageCalls, row.successfulCalls, row.failedCalls, row.inProgressCalls, row.unknownCalls,
      row.inputTokens, row.outputTokens, row.totalTokens, row.imageCount, row.videoSeconds, row.durationMs,
      row.confirmedCostUsd, row.estimatedCostUsd, row.reservedCostUsd, row.unknownCostCalls, row.errorCount, JSON.stringify({}),
    );
    return `(${Array.from({ length: 23 }, (_, field) => `$${offset + field + 1}`).join(', ')})`;
  });
  await client.query(
    `insert into report_account_summaries
      (report_run_id, user_id, account_email, platform_role, activity_kind, audit_records,
       usage_calls, successful_calls, failed_calls, in_progress_calls, unknown_calls,
       input_tokens, output_tokens, total_tokens, image_count, video_seconds, duration_ms,
       confirmed_cost_usd, estimated_cost_usd, reserved_cost_usd, unknown_cost_calls, error_count, metadata)
     values ${tuples.join(', ')}`,
    values,
  );
}

async function insertErrorSnapshots(client: PoolClient, reportRunId: string, rows: ErrorRow[]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 16;
    values.push(
      reportRunId, row.fingerprint, row.source, row.service, row.severity, row.impact, row.code,
      row.message, row.first_occurred_at, row.last_occurred_at, numberValue(row.occurrences),
      numberValue(row.affected_accounts), numberValue(row.affected_requests), numberValue(row.affected_tasks), row.sample_trace_id,
      JSON.stringify({ affectedAccountEmails: errorAccountEmails(row) }),
    );
    return `(${Array.from({ length: 16 }, (_, field) => `$${offset + field + 1}`).join(', ')})`;
  });
  await client.query(
    `insert into report_error_summaries
      (report_run_id, fingerprint, source, service, severity, impact, code, message,
       first_occurred_at, last_occurred_at, occurrences, affected_accounts,
       affected_requests, affected_tasks, sample_trace_id, metadata)
     values ${tuples.join(', ')}`,
    values,
  );
}

async function insertServiceSnapshots(client: PoolClient, reportRunId: string, rows: ServiceRow[]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 13;
    values.push(
      reportRunId, row.service, numberValue(row.check_count), numberValue(row.healthy_checks), numberValue(row.unhealthy_checks),
      numberValue(row.incident_count), fixed(row.observed_seconds, 3), fixed(row.unhealthy_seconds, 3),
      row.availability_ratio === null ? null : fixed(row.availability_ratio, 9), row.data_complete,
      row.first_observed_at, row.last_observed_at, JSON.stringify({}),
    );
    return `(${Array.from({ length: 13 }, (_, field) => `$${offset + field + 1}`).join(', ')})`;
  });
  await client.query(
    `insert into report_service_summaries
      (report_run_id, service, check_count, healthy_checks, unhealthy_checks, incident_count,
       observed_seconds, unhealthy_seconds, availability_ratio, data_complete,
       first_observed_at, last_observed_at, metadata)
     values ${tuples.join(', ')}`,
    values,
  );
}

export async function generateReport(spec: ReportRevision): Promise<ReportJobResult> {
  const reportRunId = await claimReportRun(spec);
  if (!reportRunId) return { status: 'skipped', reportType: spec.reportType, revision: spec.revision };

  try {
    // Run report reads sequentially so catch-up work consumes at most one shared
    // PostgreSQL connection while interactive creation requests are active.
    // 报表读取串行执行，补算期间最多占用一个共享连接，避免与在线创作请求争抢连接池。
    const { accounts, errors, services, summary } = await readReportSnapshots(spec);
    // Publish all report snapshots and the succeeded marker atomically so readers
    // can never observe a partially regenerated report.
    // 三类报表快照与成功状态必须原子发布，读取端不能看到半份重算结果。
    await withTransaction(async (client) => {
      await client.query('delete from report_account_summaries where report_run_id = $1', [reportRunId]);
      await client.query('delete from report_error_summaries where report_run_id = $1', [reportRunId]);
      await client.query('delete from report_service_summaries where report_run_id = $1', [reportRunId]);
      await insertAccountSnapshots(client, reportRunId, accounts);
      await insertErrorSnapshots(client, reportRunId, errors);
      await insertServiceSnapshots(client, reportRunId, services);
      await client.query(
        `update report_runs
            set status = 'succeeded', summary = $1::jsonb, data_as_of = now(), updated_at = now()
          where id = $2`,
        [JSON.stringify(summary), reportRunId],
      );
    });
    return { status: 'succeeded', reportRunId, reportType: spec.reportType, revision: spec.revision };
  } catch (error) {
    const message = errorMessage(error instanceof Error ? error.message : error);
    await query(
      `update report_runs set status = 'failed', error = $1, updated_at = now() where id = $2`,
      [message || 'report generation failed', reportRunId],
    ).catch(() => undefined);
    return { status: 'failed', reportRunId, reportType: spec.reportType, revision: spec.revision, error: message || 'report generation failed' };
  }
}

export async function generateDueReports(now = new Date()) {
  const results: ReportJobResult[] = [];
  let generated = 0;
  for (const spec of getDueReportJobs(now)) {
    const result = await generateReport(spec);
    results.push(result);
    if (result.status !== 'skipped') generated += 1;
    // Keep catch-up work bounded so a missed scheduler window cannot overload
    // PostgreSQL or compete with active creative requests.
    // 限制单轮补算数量，避免调度中断后一次性抢占数据库和创作请求资源。
    if (generated >= MAX_GENERATED_REPORTS_PER_RUN) break;
  }
  return results;
}

export type ReportRunRecord = {
  id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  revision: number;
  status: 'running' | 'succeeded' | 'failed';
  is_final: boolean;
  data_as_of: string;
  schema_version: string;
  summary: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function getLiveTodayReport(now = new Date()) {
  const spec = job('daily', { start: shanghaiDayStart(now), end: now }, 0, false);
  const { accounts, errors, services, summary } = await readReportSnapshots(spec);
  const dataAsOf = summary.dataAsOf;
  const run: ReportRunRecord = {
    id: 'live-today',
    report_type: 'daily',
    period_start: spec.periodStart.toISOString(),
    period_end: spec.periodEnd.toISOString(),
    revision: 0,
    status: 'succeeded',
    is_final: false,
    data_as_of: dataAsOf,
    schema_version: REPORT_SCHEMA_VERSION,
    summary,
    error: null,
    created_at: dataAsOf,
    updated_at: dataAsOf,
  };
  // This synthetic run is read-only and never enters report_runs or scheduler history.
  // 该临时快照只读生成，不写入 report_runs，也不会污染调度历史。
  return { run, accounts, errors, services };
}

export type ReportRunFilters = {
  search?: string;
};

export async function listReportRuns(limit = 30, filters: ReportRunFilters = {}) {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const values: Array<string | number> = [];
  const conditions: string[] = [];
  // Filter on PostgreSQL before applying the display limit so old reports stay searchable.
  // 先由 PostgreSQL 筛选再应用展示上限，避免历史版本过多时前端无法检索。
  const search = filters.search?.trim().slice(0, 80);
  if (search) {
    const searchPattern = "%" + search + "%";
    const normalizedPattern = "%" + search.replace(/[\/-]/g, ".") + "%";
    values.push(searchPattern, normalizedPattern);
    const rawIndex = values.length - 1;
    const normalizedIndex = values.length;
    conditions.push([
      "      (",
      "        period_start::text ilike $" + rawIndex,
      "        or period_end::text ilike $" + rawIndex,
      "        or to_char(period_start at time zone 'Asia/Shanghai', 'YYYY.MM.DD HH24:MI') ilike $" + normalizedIndex,
      "        or to_char(period_end at time zone 'Asia/Shanghai', 'YYYY.MM.DD HH24:MI') ilike $" + normalizedIndex,
      "        or revision::text ilike $" + rawIndex,
      "        or ('r' || revision::text) ilike $" + rawIndex,
      "        or report_type::text ilike $" + rawIndex,
      "        or (case report_type when 'daily' then '日报' when 'weekly' then '周报' when 'monthly' then '月报' end) ilike $" + rawIndex,
      "        or status::text ilike $" + rawIndex,
      "        or (case when status = 'running' then '生成中 running' when status = 'failed' then '失败待重试 failed' when is_final then '最终版 final' else '临时版 draft' end) ilike $" + rawIndex,
      "      )",
    ].join("\n"));
  }
  values.push(safeLimit);
  const limitIndex = values.length;
  const reportSql = [
    "select id, report_type, period_start, period_end, revision, status, is_final,",
    "       data_as_of, schema_version, summary, error, created_at, updated_at",
    "  from report_runs",
    conditions.length ? " where " + conditions.join(" and ") : "",
    " order by period_start desc, report_type asc, revision desc",
    " limit $" + limitIndex,
  ].filter(Boolean).join("\n");
  const result = await query<ReportRunRecord>(reportSql, values);
  return result.rows;
}

export async function getReportDetails(reportRunId: string) {
  const runSql = [
    "select id, report_type, period_start, period_end, revision, status, is_final,",
    "       data_as_of, schema_version, summary, error, created_at, updated_at",
    "  from report_runs where id = $1",
  ].join("\n");
  const run = await query<ReportRunRecord>(runSql, [reportRunId]);
  if (!run.rows[0]) return null;
  const [accountSnapshotResult, errorSnapshotResult, services] = await Promise.all([
    query<AccountRow>("select * from report_account_summaries where report_run_id = $1 order by reserved_cost_usd desc, usage_calls desc, account_email", [reportRunId]),
    query<ErrorRow>("select * from report_error_summaries where report_run_id = $1 order by occurrences desc, last_occurred_at desc", [reportRunId]),
    query("select * from report_service_summaries where report_run_id = $1 order by service", [reportRunId]),
  ]);
  const accounts = accountSnapshotResult.rows.map(accountSnapshot);
  let errors = errorSnapshotResult.rows;
  const reportRun = run.rows[0];
  const needsAccountLookup = errors.some((row) => numberValue(row.affected_accounts) > 0 && errorAccountEmails(row).length === 0);
  if (needsAccountLookup) {
    const currentErrorRows = await errorRows({
      reportType: reportRun.report_type,
      periodStart: new Date(reportRun.period_start),
      periodEnd: new Date(reportRun.period_end),
      revision: reportRun.revision,
      isFinal: reportRun.is_final,
    });
    const accountEmailsByError = new Map(currentErrorRows.map((row) => [errorGroupKey(row), errorAccountEmails(row)]));
    errors = errors.map((row) => {
      if (numberValue(row.affected_accounts) === 0 || errorAccountEmails(row).length > 0) return row;
      const emails = accountEmailsByError.get(errorGroupKey(row)) || [];
      return emails.length ? { ...row, affected_account_emails: emails } : row;
    });
  }
  return { run: reportRun, accounts, errors, services: services.rows };
}
