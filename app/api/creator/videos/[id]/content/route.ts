import { NextResponse } from 'next/server';
import { GET as getVideoTask } from '../route';
import { createAdminClient } from '@/lib/local/admin';
import { resolveInternalMediaUrl } from '@/lib/local/media-url';
import { logServerFailure } from '@/lib/observability/server-log';

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

  const payload = await taskResponse.json().catch(() => ({})) as {
    task?: { videoUrl?: unknown; output?: unknown };
  };
  const output = payload.task?.output && typeof payload.task.output === 'object' && !Array.isArray(payload.task.output)
    ? payload.task.output as Record<string, unknown>
    : {};
  const storagePath = typeof output.video_storage_path === 'string' ? output.video_storage_path : '';
  let videoUrl = '';
  if (storagePath) {
    try {
      const signed = await createAdminClient().storage.from('creator-assets').createSignedUrl(storagePath, 300);
      if (!signed.error && signed.data?.signedUrl) videoUrl = signed.data.signedUrl;
    } catch (error) {
      logServerFailure('creator_video_durable_asset_proxy', error, { taskId: params.id });
    }
  }
  if (!videoUrl && typeof payload.task?.videoUrl === 'string') videoUrl = payload.task.videoUrl;
  if (!videoUrl && typeof output.video_url === 'string') videoUrl = output.video_url;
  if (!videoUrl) return errorResponse('该任务暂无可播放视频', 'VIDEO_CONTENT_NOT_READY', 404);

  const range = req.headers.get('range');
  const candidates = Array.from(new Set([
    videoUrl,
    typeof payload.task?.videoUrl === 'string' ? payload.task.videoUrl : '',
    typeof output.video_url === 'string' ? output.video_url : '',
  ].filter(Boolean)));
  let upstream: Response | null = null;
  let sawInvalid = false;
  let sawUnavailable = false;
  let sawFetchError = false;
  for (const candidate of candidates) {
    try {
      const response = await fetch(resolveInternalMediaUrl(candidate), {
        redirect: 'follow',
        headers: range ? { range } : undefined,
      });
      if (!response.ok && response.status !== 206) {
        sawUnavailable = true;
        continue;
      }
      const responseType = response.headers.get('content-type') || '';
      if (responseType.includes('json') || responseType.startsWith('text/')) {
        sawInvalid = true;
        continue;
      }
      upstream = response;
      break;
    } catch (error) {
      sawFetchError = true;
      logServerFailure('creator_video_content_proxy', error, { taskId: params.id });
    }
  }
  if (!upstream) {
    if (sawInvalid) return errorResponse('供应商返回的不是视频文件', 'VIDEO_CONTENT_INVALID', 502);
    if (sawFetchError && !sawUnavailable) return errorResponse('视频文件读取失败，请稍后重试', 'VIDEO_CONTENT_FETCH_FAILED', 502);
    return errorResponse('视频文件已失效或供应商未返回文件', 'VIDEO_CONTENT_UNAVAILABLE', 502);
  }
  const upstreamType = upstream.headers.get('content-type') || '';
  const contentType = upstreamType && upstreamType !== 'application/octet-stream' ? upstreamType : 'video/mp4';

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
