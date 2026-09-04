import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/local/auth';
import { fullLogPayload, logServerFailure, logServerEvent, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_WINDOW = 240;
const MAX_GLOBAL_EVENTS_PER_WINDOW = 600;
const RATE_WINDOW_MS = 60_000;
const recentReports = new Map<string, number[]>();
const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

type ClientExchangeBody = {
  eventId?: unknown;
  exchangeId?: unknown;
  traceId?: unknown;
  route?: unknown;
  method?: unknown;
  requestId?: unknown;
  httpStatus?: unknown;
  durationMs?: unknown;
  outcome?: unknown;
  pageRoute?: unknown;
  userAgent?: unknown;
  request?: unknown;
  response?: unknown;
  error?: unknown;
};

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function number(value: unknown, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function allowReport(key: string, limit: number) {
  const now = Date.now();
  const current = (recentReports.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (current.length >= limit) {
    recentReports.set(key, current);
    return false;
  }
  current.push(now);
  recentReports.set(key, current);
  if (recentReports.size > 1_000) {
    for (const [candidate, timestamps] of recentReports) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) recentReports.delete(candidate);
    }
  }
  return true;
}

export async function POST(request: Request) {
  const transportTraceId = requestTraceId(request);
  if (!allowReport('global', MAX_GLOBAL_EVENTS_PER_WINDOW)) return new NextResponse(null, { status: 204 });

  const source = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('user-agent')
    || 'anonymous';
  if (!allowReport(`source:${source.slice(0, 240)}`, MAX_EVENTS_PER_WINDOW)) return new NextResponse(null, { status: 204 });

  let body: ClientExchangeBody;
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    body = JSON.parse(raw) as ClientExchangeBody;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const bodyTraceId = text(body.traceId, 128);
  const traceId = TRACE_ID.test(bodyTraceId) ? bodyTraceId : transportTraceId;
  const route = text(body.route, 240);
  const method = text(body.method, 16).toUpperCase();
  if (!route || !method) return new NextResponse(null, { status: 204 });

  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch {
    // Telemetry remains usable as anonymous data when the session store is unavailable.
    // 会话存储异常时仍保留匿名交换记录，不能反向影响业务请求。
  }

  const httpStatus = number(body.httpStatus, 100, 599);
  const durationMs = number(body.durationMs, 0, 86_400_000);
  const hasError = body.error !== null && body.error !== undefined;
  const failed = hasError || (httpStatus !== null && httpStatus >= 400);
  const level = hasError || (httpStatus !== null && httpStatus >= 500)
    ? 'error'
    : failed ? 'warn' : 'info';
  const outcome = failed ? 'failed' : 'succeeded';
  const statusLabel = httpStatus === null ? 'network error' : String(httpStatus);

  try {
    logServerEvent('http_exchange_completed', {
      eventId: text(body.eventId, 160) || undefined,
      traceId,
      exchangeId: text(body.exchangeId, 160) || traceId,
      source: 'frontend',
      service: 'browser-api',
      route,
      method,
      requestId: text(body.requestId, 160) || undefined,
      userId: user?.id || undefined,
      actorEmail: user?.email || undefined,
      pageRoute: text(body.pageRoute, 240) || undefined,
      userAgent: text(body.userAgent, 500) || undefined,
      httpStatus: httpStatus ?? undefined,
      durationMs: durationMs ?? undefined,
      stage: 'completed',
      outcome,
      message: `HTTP ${method} ${route} → ${statusLabel}`,
      request: fullLogPayload(body.request ?? null),
      response: fullLogPayload(body.response ?? null),
      error: hasError ? fullLogPayload(body.error) : undefined,
      metadata: fullLogPayload({
        host: request.headers.get('host') || null,
        origin: request.headers.get('origin') || null,
        forwardedHost: request.headers.get('x-forwarded-host') || null,
        forwardedPort: request.headers.get('x-forwarded-port') || null,
        forwardedProto: request.headers.get('x-forwarded-proto') || null,
      }),
    }, level);
  } catch (error) {
    logServerFailure('observability_client_exchange_write_failed', error, { traceId, route, method });
  }
  return new NextResponse(null, { status: 204 });
}
