import { NextResponse } from 'next/server';
import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import { processNextVideoTask } from '@/lib/creator/video-submission';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
// Keep the route window explicit so Next.js can recognise it in the build.
// 显式写入秒数，避免 Next.js 因表达式无法静态解析而回退到默认超时。
export const maxDuration = 14_400;

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    const task = await processNextVideoTask();
    return NextResponse.json({ ok: true, processed: Boolean(task), taskId: task?.taskId || null });
  } catch (error) {
    logServerFailure('creator_video_worker_endpoint', error, {
      feature: 'creator_video',
      stage: 'worker_endpoint_failed',
    });
    return NextResponse.json({ error: 'worker failed' }, { status: 503 });
  }
}
