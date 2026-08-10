import { NextResponse } from 'next/server';
import { GET as getCanvasAssetUrl } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Proxy a private canvas asset on the app origin for reliable media playback. */
export async function GET(req: Request) {
  const signedResponse = await getCanvasAssetUrl(req);
  if (!signedResponse.ok) return signedResponse;
  const payload = await signedResponse.json().catch(() => ({})) as { signedUrl?: unknown };
  const signedUrl = typeof payload.signedUrl === 'string' ? payload.signedUrl : '';
  if (!signedUrl) return errorResponse('素材地址不存在', 'ASSET_URL_FAILED', 404);

  const range = req.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { redirect: 'follow', headers: range ? { range } : undefined });
  } catch (error) {
    console.error('[creator canvas asset content proxy]', error);
    return errorResponse('素材文件读取失败，请稍后重试', 'ASSET_CONTENT_FETCH_FAILED', 502);
  }
  if (!upstream.ok && upstream.status !== 206) return errorResponse('素材文件已失效或已删除', 'ASSET_CONTENT_UNAVAILABLE', 404);
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
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
