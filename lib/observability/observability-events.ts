import { createHash } from 'node:crypto';
import { query } from '@/lib/local/db';
import { redactServerLogText, serialiseLogValue } from './server-log';

export type ObservationSource = 'frontend' | 'app' | 'provider' | 'infra' | 'deploy' | 'billing' | 'data';
export type ObservationSeverity = 'info' | 'warning' | 'error' | 'critical';
export type ObservationImpact = 'none' | 'degraded' | 'blocked' | 'unknown';
export type ServiceState = 'healthy' | 'unhealthy' | 'unknown';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, limit = 500) {
  if (typeof value !== 'string') return '';
  return redactServerLogText(value).slice(0, limit);
}

function nullableText(value: unknown, limit = 500) {
  const valueText = text(value, limit);
  return valueText || null;
}

function nullableUuid(value: unknown) {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function safeMetadata(value: unknown) {
  const serialised = serialiseLogValue(value || {});
  return JSON.stringify(serialised);
}

export function observationFingerprint(input: {
  source: ObservationSource;
  service?: string;
  code?: string | null;
  message?: string;
  route?: string | null;
  httpStatus?: number | null;
}) {
  const source = [
    input.source,
    text(input.service, 80),
    text(input.code, 120),
    text(input.message, 300),
    text(input.route, 160),
    input.httpStatus || '',
  ].join('|').toLowerCase();
  return createHash('sha256').update(source).digest('hex').slice(0, 32);
}

export type ObservationErrorInput = {
  occurredAt?: Date;
  source: ObservationSource;
  service?: string;
  feature?: string | null;
  action?: string | null;
  severity?: ObservationSeverity;
  impact?: ObservationImpact;
  fingerprint?: string;
  code?: string | null;
  message?: string;
  stack?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  taskId?: string | null;
  userId?: string | null;
  route?: string | null;
  httpStatus?: number | null;
  deploymentVersion?: string | null;
  eventKey?: string | null;
  metadata?: unknown;
};

export async function recordObservationError(input: ObservationErrorInput) {
  // Use ingestion time when the producer omits a timestamp; observability rows are not nullable.
  // 生产端未提供时间时使用接收时间，不能向 NOT NULL 观测表写入 null。
  const occurredAt = input.occurredAt || new Date();
  const message = text(input.message, 1000);
  const fingerprint = text(input.fingerprint, 64) || observationFingerprint(input);
  const eventKey = nullableText(input.eventKey, 240);
  const result = await query(
    `insert into observability_error_events
      (occurred_at, source, service, feature, action, severity, impact, fingerprint,
       code, message, stack, trace_id, request_id, task_id, user_id, route,
       http_status, deployment_version, event_key, metadata)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20::jsonb)
     on conflict (event_key) do nothing
    returning id`,
    [
      occurredAt.toISOString(),
      input.source,
      text(input.service, 80),
      nullableText(input.feature, 120),
      nullableText(input.action, 120),
      input.severity || 'error',
      input.impact || 'unknown',
      fingerprint,
      nullableText(input.code, 160),
      message,
      nullableText(input.stack, 2000),
      nullableText(input.traceId, 160),
      nullableText(input.requestId, 160),
      nullableText(input.taskId, 160),
      nullableUuid(input.userId),
      nullableText(input.route, 240),
      typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) ? input.httpStatus : null,
      nullableText(input.deploymentVersion, 160),
      eventKey,
      safeMetadata(input.metadata),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export type ObservationServiceInput = {
  observedAt?: Date;
  host?: string;
  service: string;
  checkName?: string;
  state: ServiceState;
  previousState?: string | null;
  message?: string;
  durationMs?: number | null;
  deploymentVersion?: string | null;
  containerId?: string | null;
  eventKey?: string | null;
  metadata?: unknown;
};

export async function recordObservationService(input: ObservationServiceInput) {
  // Use ingestion time when the monitor omits a timestamp; health events must always be time-indexable.
  // 监控端未提供时间时使用接收时间，保证健康事件始终可以按时间索引。
  const observedAt = input.observedAt || new Date();
  const result = await query(
    `insert into observability_service_events
      (observed_at, host, service, check_name, state, previous_state, message,
       duration_ms, deployment_version, container_id, event_key, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    on conflict (event_key) do nothing
     returning id`,
    [
      observedAt.toISOString(),
      text(input.host, 120),
      text(input.service, 80),
      text(input.checkName, 120) || 'health',
      input.state,
      nullableText(input.previousState, 40),
      text(input.message, 1000),
      typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? Math.max(0, Math.floor(input.durationMs)) : null,
      nullableText(input.deploymentVersion, 160),
      nullableText(input.containerId, 160),
      nullableText(input.eventKey, 240),
      safeMetadata(input.metadata),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}
