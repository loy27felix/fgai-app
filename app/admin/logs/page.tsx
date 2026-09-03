import { redirect } from 'next/navigation';
import { createClient } from '@/lib/local/server';
import PageShell from '@/components/studio/PageShell';
import ObservabilityLogExplorer from '@/components/ObservabilityLogExplorer';
import { queryLogExplorer } from '@/lib/observability/log-query';
import { logServerFailure } from '@/lib/observability/server-log';

export const dynamic = 'force-dynamic';

function valueOf(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
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

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000);
  let initialData = null;
  let initialError = '';
  try {
    initialData = await queryLogExplorer({
      from: valueOf(searchParams?.from) || from,
      to: valueOf(searchParams?.to) || to,
      query: valueOf(searchParams?.q),
      source: valueOf(searchParams?.source) || 'all',
      level: valueOf(searchParams?.level) || 'all',
      offset: 0,
      limit: 200,
    });
  } catch (error) {
    logServerFailure('observability_log_page_read_failed', error);
    initialError = '日志数据暂时不可用，请确认数据库迁移和观测事件写入已完成。';
  }

  return (
    <PageShell title="日志检索" email={user.email || ''}>
      <ObservabilityLogExplorer initialData={initialData} initialError={initialError} />
    </PageShell>
  );
}
