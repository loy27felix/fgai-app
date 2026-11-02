import { NextResponse } from 'next/server';
import { supportBotEnabled, verifyWorkerToken } from '@/lib/support-bot/feishu';
import { runSupportBotOnce } from '@/lib/support-bot/worker';

export const runtime = 'nodejs';
export const maxDuration = 900;
export async function POST(request: Request) {
  if (!verifyWorkerToken(request.headers.get('authorization') || '')) return NextResponse.json({ error: '未授权' }, { status: 401 });
  if (!supportBotEnabled()) return NextResponse.json({ error: '自助排查尚未启用' }, { status: 503 });
  try { return NextResponse.json(await runSupportBotOnce()); }
  catch { return NextResponse.json({ error: '诊断暂时失败，任务将自动重试' }, { status: 503 }); }
}
