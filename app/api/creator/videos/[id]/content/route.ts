import { NextResponse } from 'next/server';
import { GET as getVideoTask } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type RouteContext = { params: { id: string } };

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Proxy a recovered video through the authenticated app origin.
 * Provider and signed-storage URLs are intentionally not exposed to the
 * canvas as the primary source: they can expire or reject browser requests.
 */
export async function GET(req: Request, { params }: RouteContext) {
  const taskResponse = await getVideoTask(req, { params });
  if (!taskResponse.ok) return taskResponse;

  const payload = await taskResponse.json().catch(() => ({})) as { task?: { videoUrl?: unknown; mimeType?: unknown } };
  const videoUrl = typeof payload.task?.videoUrl === 'string' ? payload.task.videoUrl : '';
  if (!videoUrl) return errorResponse('该任务暂无可播放视频', 'VIDEO_CONTENT_NOT_READY', 404);

  const range = req.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(videoUrl, {
      redirect: 'follow',
      headers: range ? { range } : undefined,
    });
  } catch (error) {
    console.error('[creator video content proxy]', error);
    return errorResponse('视频文件读取失败，请稍后重试', 'VIDEO_CONTENT_FETCH_FAILED', 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('视频文件已失效或供应商未返回文件', 'VIDEO_CONTENT_UNAVAILABLE', 502);
  }
  const contentType = upstream.headers.get('content-type') || 'video/mp4';
  if (contentType.includes('json')) return errorResponse('供应商返回的不是视频文件', 'VIDEO_CONTENT_INVALID', 502);

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', 'inline; filename="recovered-video.mp4"');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=300');
  for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
