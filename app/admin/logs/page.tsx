import { redirect } from 'next/navigation';
import { createClient } from '@/lib/local/server';
import PageShell from '@/components/studio/PageShell';
import ObservabilityLogExplorer, { type LogExplorerInitialFilters } from '@/components/ObservabilityLogExplorer';
import { LogQueryValidationError, normalizeLogQuery, queryLogExplorer } from '@/lib/observability/log-query';
import { logServerFailure } from '@/lib/observability/server-log';

export const dynamic = 'force-dynamic';

function valueOf(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

const STRUCTURED_LOG_QUERY_KEYS = [
  'service', 'event', 'route', 'outcome', 'traceId', 'requestId', 'taskId', 'userId', 'actorEmail',
  'httpStatus', 'httpStatusGte', 'httpStatusLte', 'durationMs', 'durationMsGte', 'durationMsLte',
] as const;

export default async function LogsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect('/');

  const { data: profile } = await localClient
    .from('profiles')
    .select('platform_role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.platform_role !== 'admin' && profile?.platform_role !== 'superadmin') redirect('/admin');

  const to = new Date();
  const from = new Date(to.getTime() - 15 * 60 * 1_000);
  let initialFrom = from.toISOString();
  let initialTo = to.toISOString();
  try {
    const normalizedRange = normalizeLogQuery({
      from: valueOf(searchParams?.from) || from,
      to: valueOf(searchParams?.to) || to,
    });
    initialFrom = normalizedRange.from.toISOString();
    initialTo = normalizedRange.to.toISOString();
  } catch {
    // Keep the retry controls usable when the URL time range itself is invalid.
    // URL 时间范围无效时仍使用默认范围，保证管理员可以直接修正其他条件后重试。
  }
  const initialQuery = valueOf(searchParams?.q);
  const structuredFilters = Object.fromEntries(STRUCTURED_LOG_QUERY_KEYS.flatMap((key) => {
    const value = valueOf(searchParams?.[key]);
    return value ? [[key, value]] : [];
  })) as LogExplorerInitialFilters;
  let initialData = null;
  let initialError = '';
  try {
    initialData = await queryLogExplorer({
      from: valueOf(searchParams?.from) || initialFrom,
      to: valueOf(searchParams?.to) || initialTo,
      query: initialQuery,
      source: valueOf(searchParams?.source) || 'all',
      level: valueOf(searchParams?.level) || 'all',
      offset: 0,
      limit: 50,
      ...structuredFilters,
    });
  } catch (error) {
    if (error instanceof LogQueryValidationError) {
      initialError = error.message;
    } else {
      logServerFailure('observability_log_page_read_failed', error);
      initialError = '日志数据暂时不可用，请确认数据库迁移和观测事件写入已完成。';
    }
  }

  return (
    <PageShell title="日志检索" email={user.email || ''} mainClassName="observability-page-main">
      <ObservabilityLogExplorer initialData={initialData} initialError={initialError} initialFrom={initialFrom} initialTo={initialTo} initialQuery={initialQuery} initialFilters={structuredFilters} />
    </PageShell>
  );
}
