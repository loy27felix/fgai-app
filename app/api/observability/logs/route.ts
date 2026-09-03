import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { LogQueryValidationError, queryLogExplorer } from '@/lib/observability/log-query';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { data: profile, error: profileError } = await localClient
    .from('profiles')
    .select('platform_role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return NextResponse.json({ error: '管理员身份读取失败' }, { status: 500 });
  if (profile?.platform_role !== 'admin' && profile?.platform_role !== 'superadmin') {
    return NextResponse.json({ error: '无权访问日志' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  try {
    const result = await queryLogExplorer({
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      query: params.get('q') || '',
      source: params.get('source') || 'all',
      level: params.get('level') || 'all',
      offset: params.get('offset') || '0',
      limit: params.get('limit') || '200',
      cursor: params.get('cursor') || null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LogQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logServerFailure('observability_log_query_failed', error);
    return NextResponse.json({ error: '日志查询失败，请确认数据库迁移已完成' }, { status: 500 });
  }
}
