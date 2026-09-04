import { NextResponse } from 'next/server';
import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function optionalText(value: unknown, limit: number) {
  return text(value, limit) || undefined;
}

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'event too large' }, { status: 413 });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'event too large' }, { status: 413 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const path = text(body.path, 240);
    const method = text(body.method, 16).toUpperCase();
    if (!path || !method) return NextResponse.json({ error: 'path and method are required' }, { status: 400 });

    logServerEvent('http_request_received', {
      traceId: optionalText(body.traceId, 160),
      method,
      path,
      host: optionalText(body.host, 240),
      origin: optionalText(body.origin, 240),
      forwardedHost: optionalText(body.forwardedHost, 240),
      forwardedPort: optionalText(body.forwardedPort, 32),
      forwardedProto: optionalText(body.forwardedProto, 32),
      requestId: optionalText(body.requestId, 160),
      nextAction: optionalText(body.nextAction, 160),
      contentType: optionalText(body.contentType, 160),
      userAgent: optionalText(body.userAgent, 500),
      cfRay: optionalText(body.cfRay, 160),
      source: 'app',
      service: 'http',
    });
  } catch (error) {
    logServerFailure('observability_request_event_failed', error, { route: '/api/observability/request-events' });
  }
  return new NextResponse(null, { status: 204 });
}
