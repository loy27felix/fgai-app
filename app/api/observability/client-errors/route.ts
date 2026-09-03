import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import {
  observationFingerprint,
  recordObservationError,
  type ObservationSeverity,
  type ObservationImpact,
} from '@/lib/observability/observability-events';
import { logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

const MAX_EVENTS_PER_WINDOW = 30;
const MAX_GLOBAL_EVENTS_PER_WINDOW = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const recentReports = new Map<string, number[]>();

type ClientErrorBody = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  route?: unknown;
  apiPath?: unknown;
  method?: unknown;
  httpStatus?: unknown;
  severity?: unknown;
  impact?: unknown;
  deploymentVersion?: unknown;
  systemVersion?: unknown;
  eventId?: unknown;
  metadata?: unknown;
};

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function allowedImpact(value: unknown): ObservationImpact {
  return value === 'none' || value === 'degraded' || value === 'blocked' || value === 'unknown'
    ? value
    : 'unknown';
}

function allowedSeverity(value: unknown, status: number | null): ObservationSeverity {
  if (value === 'info' || value === 'warning' || value === 'error' || value === 'critical') return value;
  return status && status >= 500 ? 'error' : 'warning';
}

function allowedStatus(value: unknown) {
  const status = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function allowReport(key: string, limit = MAX_EVENTS_PER_WINDOW) {
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
  const traceId = requestTraceId(request);
  // Bound anonymous traffic before touching session storage or PostgreSQL.
  // 在读取会话和 PostgreSQL 前限制匿名流量，避免公开观测入口争抢业务连接池。
  if (!allowReport('global', MAX_GLOBAL_EVENTS_PER_WINDOW)) return new NextResponse(null, { status: 204 });
  const source = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('user-agent')
    || 'anonymous';
  if (!allowReport(`source:${source.slice(0, 240)}`)) return new NextResponse(null, { status: 204 });

  let body: ClientErrorBody;
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    body = JSON.parse(raw) as ClientErrorBody;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const message = text(body.message, 1_000);
  if (!message) return new NextResponse(null, { status: 204 });
  const localClient = createClient();
  let user: { id: string } | null = null;
  try {
    const result = await localClient.auth.getUser();
    user = result.data.user ? { id: result.data.user.id } : null;
  } catch {
    // Client telemetry must remain anonymous when the session store is unavailable.
    // 会话存储异常时降级为匿名观测，不能让观测接口继续放大故障。
  }
  const service = text(body.apiPath, 240) ? 'browser-api' : 'browser';
  const route = text(body.route, 240);
  const apiPath = text(body.apiPath, 240);
  const status = allowedStatus(body.httpStatus);
  const fingerprint = observationFingerprint({
    source: 'frontend',
    service,
    code: text(body.name, 160),
    message,
    route: apiPath || route,
    httpStatus: status,
  });

  try {
    await recordObservationError({
      source: 'frontend',
      service,
      severity: allowedSeverity(body.severity, status),
      impact: allowedImpact(body.impact),
      fingerprint,
      code: text(body.name, 160) || null,
      message,
      stack: text(body.stack, 2_000) || null,
      traceId,
      userId: user?.id || null,
      route: route || apiPath || null,
      httpStatus: status,
      deploymentVersion: text(body.deploymentVersion, 160) || null,
      eventKey: text(body.eventId, 240) || null,
      metadata: {
        method: text(body.method, 16) || null,
        systemVersion: text(body.systemVersion, 80) || null,
        client: body.metadata || null,
      },
    });
  } catch (error) {
    logServerFailure('observability_client_error_write_failed', error);
  }
  return new NextResponse(null, { status: 204 });
}
