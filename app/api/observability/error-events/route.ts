import { NextResponse } from 'next/server';
import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import {
  observationFingerprint,
  recordObservationError,
  type ObservationImpact,
  type ObservationSeverity,
  type ObservationSource,
} from '@/lib/observability/observability-events';

export const runtime = 'nodejs';

type ErrorBody = {
  occurredAt?: unknown;
  source?: unknown;
  service?: unknown;
  feature?: unknown;
  action?: unknown;
  severity?: unknown;
  impact?: unknown;
  code?: unknown;
  message?: unknown;
  traceId?: unknown;
  taskId?: unknown;
  route?: unknown;
  httpStatus?: unknown;
  deploymentVersion?: unknown;
  eventKey?: unknown;
};

const SOURCES = new Set<ObservationSource>(['frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data']);
const SEVERITIES = new Set<ObservationSeverity>(['info', 'warning', 'error', 'critical']);
const IMPACTS = new Set<ObservationImpact>(['none', 'degraded', 'blocked', 'unknown']);

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function enumValue<T extends string>(value: unknown, values: Set<T>, fallback: T) {
  return typeof value === 'string' && values.has(value as T) ? value as T : fallback;
}

function status(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function occurredAt(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let body: ErrorBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }
  const source = enumValue(body.source, SOURCES, 'app');
  const service = text(body.service, 80);
  const message = text(body.message, 1_000);
  if (!service || !message) return NextResponse.json({ error: 'service and message are required' }, { status: 400 });
  const route = text(body.route, 240);
  const httpStatus = status(body.httpStatus);
  try {
    await recordObservationError({
      occurredAt: occurredAt(body.occurredAt),
      source,
      service,
      feature: text(body.feature, 120) || null,
      action: text(body.action, 120) || null,
      severity: enumValue(body.severity, SEVERITIES, 'error'),
      impact: enumValue(body.impact, IMPACTS, 'unknown'),
      fingerprint: observationFingerprint({ source, service, code: text(body.code, 160), message, route, httpStatus }),
      code: text(body.code, 160) || null,
      message,
      traceId: text(body.traceId, 160) || null,
      taskId: text(body.taskId, 160) || null,
      route: route || null,
      httpStatus,
      deploymentVersion: text(body.deploymentVersion, 160) || null,
      eventKey: text(body.eventKey, 240) || null,
    });
  } catch (error) {
    console.error('[observability error event write failed]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'event persistence failed' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
