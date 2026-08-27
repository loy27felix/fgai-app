import { query } from '@/lib/local/db';
import {
  logServerEvent,
  logServerFailure,
  serialiseLogError,
  serialiseLogValue,
  type ServerLogLevel,
} from './server-log';

export type AuditEvent = {
  eventId?: string;
  occurredAt?: Date;
  traceId?: string | null;
  actorId?: string | null;
  workspaceId?: string | null;
  feature: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  stage: string;
  outcome: 'started' | 'succeeded' | 'failed' | 'rejected' | 'duplicate' | 'unknown';
  statusBefore?: string | null;
  statusAfter?: string | null;
  durationMs?: number | null;
  parameters?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: unknown;
  metadata?: Record<string, unknown>;
  level?: ServerLogLevel;
};

function json(value: unknown) {
  return JSON.stringify(serialiseLogValue(value));
}

/**
 * Writes one searchable business event to stdout and PostgreSQL.
 * 将同一事件同时写入实时日志和数据库，保证故障告警与历史溯源使用同一事件 ID。
 */
export async function recordAuditEvent(input: AuditEvent) {
  const eventId = input.eventId || crypto.randomUUID();
  const payload = {
    eventId,
    traceId: input.traceId || null,
    actorId: input.actorId || null,
    workspaceId: input.workspaceId || null,
    feature: input.feature,
    action: input.action,
    resourceType: input.resourceType || null,
    resourceId: input.resourceId || null,
    stage: input.stage,
    outcome: input.outcome,
    statusBefore: input.statusBefore || null,
    statusAfter: input.statusAfter || null,
    durationMs: input.durationMs ?? null,
    parameters: input.parameters || {},
    data: input.data || {},
    ...(input.error === undefined ? {} : { error: serialiseLogError(input.error) }),
    metadata: input.metadata || {},
  };

  logServerEvent(`${input.feature}_${input.action}`, payload, input.level || (input.outcome === 'failed' ? 'error' : 'info'));
  try {
    await query(
      `insert into audit_events
       (event_id, occurred_at, trace_id, actor_id, workspace_id, feature, action,
        resource_type, resource_id, stage, outcome, status_before, status_after,
        duration_ms, parameters, data, error, metadata)
       values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb)`,
      [
        eventId,
        input.occurredAt?.toISOString() || null,
        payload.traceId,
        payload.actorId,
        payload.workspaceId,
        payload.feature,
        payload.action,
        payload.resourceType,
        payload.resourceId,
        payload.stage,
        payload.outcome,
        payload.statusBefore,
        payload.statusAfter,
        payload.durationMs,
        json(payload.parameters),
        json(payload.data),
        json(payload.error || null),
        json(payload.metadata),
      ],
    );
  } catch (error) {
    logServerFailure('audit_event_persistence_failed', error, {
      eventId,
      feature: input.feature,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });
  }
  return eventId;
}
