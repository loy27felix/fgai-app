import { redirect } from 'next/navigation';
import { createClient } from '@/lib/local/server';
import LogExplorer from '@/components/logs/LogExplorer';
import { parseLogSearch } from '@/lib/observability/log-search-contract';
import { LogQueryValidationError, queryLogExplorer } from '@/lib/observability/log-query';
import { logServerFailure } from '@/lib/observability/server-log';
import PageShell from '@/components/studio/PageShell';

export const dynamic = 'force-dynamic';

function toQueryInput(search: ReturnType<typeof parseLogSearch>) {
  return {
    from: search.from,
    to: search.to,
    query: search.q,
    source: search.source,
    scope: search.scope,
    level: search.level,
    focus: search.focus,
    limit: search.limit,
    cursor: search.cursor,
    ...search.filters,
  };
}

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

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (typeof value === 'string') params.set(key, value);
  }
  const initialSearch = parseLogSearch(params);
  let initialSnapshot = null;
  let initialError = '';
  try {
    initialSnapshot = await queryLogExplorer(toQueryInput(initialSearch));
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
      <LogExplorer initialSnapshot={initialSnapshot} initialSearch={initialSearch} initialError={initialError} />
    </PageShell>
  );
}
