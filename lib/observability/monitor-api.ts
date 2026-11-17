import { hasObservabilitySecret } from '@/lib/observability/internal-auth';
import { recordObservationService } from '@/lib/observability/observability-events';
import { logServerFailure } from '@/lib/observability/server-log';

type MonitorBody = {
  observedAt?: unknown;
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
  metadata?: unknown;
};

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function state(value: unknown) {
  return value === 'healthy' || value === 'unhealthy' || value === 'unknown' ? value : 'unknown';
}

function parseObservedAt(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  if (!hasObservabilitySecret(request)) return Response.json({ error: 'not found' }, { status: 404 });
  // New host scripts must wait for ingestion that preserves heartbeat metadata and invalidates late reports.
  // 主机脚本必须等待支持异常心跳标记和迟到报表失效的新接口，防止部署期间静默丢失语义。
  return Response.json({ monitorHeartbeatProtocol: 1 }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!hasObservabilitySecret(request)) return Response.json({ error: 'not found' }, { status: 404 });
  let body: MonitorBody;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return Response.json({ error: 'invalid event' }, { status: 400 });
    }
    body = value as MonitorBody;
  } catch {
    return Response.json({ error: 'invalid event' }, { status: 400 });
  }
  let observedAt: Date | undefined = undefined;
  if (body.observedAt !== undefined) {
    const parsedObservedAt = parseObservedAt(body.observedAt);
    if (!parsedObservedAt) {
      return Response.json({ error: 'observedAt must be a valid timestamp' }, { status: 400 });
    }
    observedAt = parsedObservedAt;
  }
  const service = text(body.service, 80);
  if (!service) return Response.json({ error: 'service is required' }, { status: 400 });
  const currentState = state(body.state);
  const previousState = text(body.previousState, 40) || null;
  const metadata = body.metadata;
  // Only repeated tunnel failures may be hidden from logs; retain their availability samples.
  // 仅标记隧道相关的重复异常，保留可用率采样；不透传任意客户端 metadata。
  const monitorHeartbeat = (service === 'tunnel' || service === 'public-media')
    && currentState === 'unhealthy'
    && previousState === currentState
    && typeof metadata === 'object'
    && metadata !== null
    && 'monitorHeartbeat' in metadata
    && metadata.monitorHeartbeat === true;
  try {
    await recordObservationService({
      observedAt,
      host: text(body.host, 120),
      service,
      checkName: text(body.checkName, 120) || 'health',
      state: currentState,
      previousState,
      message: text(body.message, 1_000),
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
      deploymentVersion: text(body.deploymentVersion, 160) || null,
      containerId: text(body.containerId, 160) || null,
      eventKey: text(body.eventKey, 240) || null,
      metadata: monitorHeartbeat ? { monitorHeartbeat: true } : undefined,
    });
  } catch (error) {
    logServerFailure('observability_monitor_event_write_failed', error);
    return Response.json({ error: 'event persistence failed' }, { status: 503 });
  }
  return Response.json({ ok: true });
}
