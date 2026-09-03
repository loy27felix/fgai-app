import { NextResponse } from 'next/server';
import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import { recordObservationService } from '@/lib/observability/observability-events';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

type MonitorBody = {
  host?: unknown;
  service?: unknown;
  checkName?: unknown;
  state?: unknown;
  previousState?: unknown;
  message?: unknown;
  durationMs?: unknown;
  deploymentVersion?: unknown;
  containerId?: unknown;
  eventKey?: unknown;
};

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function state(value: unknown) {
  return value === 'healthy' || value === 'unhealthy' || value === 'unknown' ? value : 'unknown';
}

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let body: MonitorBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }
  const service = text(body.service, 80);
  if (!service) return NextResponse.json({ error: 'service is required' }, { status: 400 });
  try {
    await recordObservationService({
      host: text(body.host, 120),
      service,
      checkName: text(body.checkName, 120) || 'health',
      state: state(body.state),
      previousState: text(body.previousState, 40) || null,
      message: text(body.message, 1_000),
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
      deploymentVersion: text(body.deploymentVersion, 160) || null,
      containerId: text(body.containerId, 160) || null,
      eventKey: text(body.eventKey, 240) || null,
    });
  } catch (error) {
    logServerFailure('observability_monitor_event_write_failed', error);
    return NextResponse.json({ error: 'event persistence failed' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
