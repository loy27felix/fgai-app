import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { createAdminClient } from '@/lib/local/admin';
import { logServerEvent, logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Proxy a private canvas asset on the app origin for reliable media playback. */
export async function GET(req: Request) {
  const traceId = requestTraceId(req);
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) {
    logServerEvent('creator_canvas_asset_content', { traceId, feature: 'creator_canvas_asset_content', stage: 'unauthenticated' }, 'warn');
    return errorResponse('请先登录', 'UNAUTHENTICATED', 401);
  }
  const path = new URL(req.url).searchParams.get('path') || '';
  if (!path || path.includes('..') || path.split('/')[0] !== user.id) {
    logServerEvent('creator_canvas_asset_content', { traceId, feature: 'creator_canvas_asset_content', stage: 'invalid_path' }, 'warn');
    return errorResponse('素材路径无效', 'INVALID_PATH', 400);
  }
  let signedUrl = '';
  const userSigned = await localClient.storage.from('creator-assets').createSignedUrl(path, 300);
  if (!userSigned.error && userSigned.data?.signedUrl) signedUrl = userSigned.data.signedUrl;
  if (!signedUrl) {
    try {
      const adminSigned = await createAdminClient().storage.from('creator-assets').createSignedUrl(path, 300);
      if (!adminSigned.error && adminSigned.data?.signedUrl) signedUrl = adminSigned.data.signedUrl;
    } catch (error) {
      console.error('[creator canvas asset admin url]', error);
      logServerFailure('creator_canvas_asset_content_admin_url_failed', error, { traceId, feature: 'creator_canvas_asset_content', stage: 'admin_signed_url', storagePath: path });
    }
  }
  if (!signedUrl) {
    logServerEvent('creator_canvas_asset_content', { traceId, feature: 'creator_canvas_asset_content', stage: 'signed_url_missing', storagePath: path }, 'warn');
    return errorResponse('素材地址不存在', 'ASSET_URL_FAILED', 404);
  }

  const range = req.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { redirect: 'follow', headers: range ? { range } : undefined });
  } catch (error) {
    console.error('[creator canvas asset content proxy]', error);
    logServerFailure('creator_canvas_asset_content_fetch_failed', error, { traceId, feature: 'creator_canvas_asset_content', stage: 'upstream_fetch', storagePath: path, hasRange: Boolean(range) });
    return errorResponse('素材文件读取失败，请稍后重试', 'ASSET_CONTENT_FETCH_FAILED', 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    logServerEvent('creator_canvas_asset_content', { traceId, feature: 'creator_canvas_asset_content', stage: 'upstream_unavailable', storagePath: path, upstreamStatus: upstream.status, hasRange: Boolean(range) }, 'warn');
    return errorResponse('素材文件已失效或已删除', 'ASSET_CONTENT_UNAVAILABLE', 404);
  }
  const upstreamType = upstream.headers.get('content-type') || '';
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const extensionType = extension === 'mp4' ? 'video/mp4' : extension === 'webm' ? 'video/webm' : extension === 'mov' ? 'video/quicktime' : extension === 'mp3' ? 'audio/mpeg' : extension === 'wav' ? 'audio/wav' : extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : '';
  const contentType = upstreamType && upstreamType !== 'application/octet-stream' ? upstreamType : extensionType || upstreamType || 'application/octet-stream';
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', 'inline');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=300');
  for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
