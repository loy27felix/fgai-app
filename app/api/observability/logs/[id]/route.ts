import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { getLogDetail } from '@/lib/observability/log-query';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
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

  try {
    const detail = await getLogDetail(decodeURIComponent(params.id));
    if (!detail) return NextResponse.json({ error: '日志不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    logServerFailure('observability_log_detail_failed', error, { logId: params.id });
    return NextResponse.json({ error: '日志详情读取失败' }, { status: 500 });
  }
}
