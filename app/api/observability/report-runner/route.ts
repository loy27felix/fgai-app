import { NextResponse } from 'next/server';
import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import { generateDueReports } from '@/lib/observability/reporting';

export const runtime = 'nodejs';

async function notify(results: Awaited<ReturnType<typeof generateDueReports>>) {
  const webhook = process.env.FG_REPORT_WEBHOOK_URL;
  if (!webhook) return;
  const delivered = results.filter((result) => result.status === 'succeeded');
  const failed = results.filter((result) => result.status === 'failed');
  if (!delivered.length && !failed.length) return;
  const message = [
    `FG Studio 报表任务：成功 ${delivered.length}，失败 ${failed.length}`,
    ...delivered.slice(0, 8).map((result) => `${result.reportType} revision=${result.revision} 已生成`),
    ...failed.slice(0, 4).map((result) => `${result.reportType} revision=${result.revision} 失败（详见管理员报表）`),
  ].join('\n');
  const type = process.env.FG_REPORT_WEBHOOK_TYPE || 'generic';
  const escaped = JSON.stringify(message);
  const payload = type === 'feishu'
    ? JSON.stringify({ msg_type: 'text', content: { text: message } })
    : type === 'wecom'
      ? JSON.stringify({ msgtype: 'text', text: { content: message } })
      : JSON.stringify({ text: message });
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`webhook returned HTTP ${response.status}`);
  } catch (error) {
    // Notification failure must not turn a successful report run into a retry.
    // 通知失败不能把已成功的报表变成失败任务，避免重复生成和重复通知。
    console.error('[observability report notification failed]', escaped, error instanceof Error ? error.message : String(error));
  }
}

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    const results = await generateDueReports();
    await notify(results);
    const failed = results.filter((result) => result.status === 'failed');
    return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 500 : 200 });
  } catch (error) {
    console.error('[observability report runner failed]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: 'report runner failed' }, { status: 500 });
  }
}
