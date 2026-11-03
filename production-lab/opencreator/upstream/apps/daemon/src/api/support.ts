import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createSupportHttpLog, type SupportHttpLog } from './support-http-log.js';
import { normalizeDatabaseTimestamp } from '../storage/database.js';

const DAY = 86_400_000;
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const actorIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const querySchema = z.object({
  actorId: actorIdentifier,
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
  taskId: identifier.optional(),
  requestId: identifier.optional(),
  projectId: identifier.optional(),
  traceId: identifier.optional(),
  limit: z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number)
    .refine(value => value <= 100).optional()
}).strict();

type EvidenceRecord = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  taskId?: string;
  requestId?: string;
  errorCode?: string;
};

export function isNativeSupportRequest(url: string): boolean {
  const path = url.split('?')[0];
  return path === '/internal/support/evidence' || path === '/internal/support/version';
}

export async function registerNativeSupport(
  server: FastifyInstance,
  db: Database.Database,
  businessToken: string,
  dataDir: string
) {
  const actorValue = actorIdentifier.safeParse(process.env.FG_CREATOR_ACTOR);
  const actorId = actorValue.success ? actorValue.data : undefined;
  const token = process.env.SUPPORT_BOT_NATIVE_READ_TOKEN;
  const credentials = new Set([token, businessToken, process.env.FG_CREATOR_CAPABILITY].filter(Boolean));
  const enabled = actorId !== undefined && token !== undefined && token.trim().length >= 32
    && token === token.trim() && token !== businessToken
    && token !== process.env.FG_CREATOR_CAPABILITY;
  const metadata = (key: string) => {
    const value = process.env[key]?.trim();
    return value && !credentials.has(value) && /^[A-Za-z0-9_.:+-]{1,128}$/.test(value) ? value : 'unknown';
  };
  const dirty = process.env.OPENCREATOR_BUILD_DIRTY;
  const build = Object.freeze({
    commit: metadata('OPENCREATOR_BUILD_COMMIT'),
    version: metadata('OPENCREATOR_BUILD_VERSION'),
    buildTime: z.string().datetime({ offset: true }).safeParse(metadata('OPENCREATOR_BUILD_TIME')).success
      ? metadata('OPENCREATOR_BUILD_TIME') : 'unknown',
    environment: metadata('OPENCREATOR_BUILD_ENVIRONMENT'),
    dirty: dirty === 'true' ? true : dirty === 'false' ? false : 'unknown' as const
  });
  const logBuildAvailable = /^[a-f0-9]{7,40}$/i.test(build.commit) && typeof build.dirty === 'boolean';
  const httpLog = actorId ? await createSupportHttpLog(dataDir, actorId, credentials, logBuildAvailable) : undefined;
  server.addHook('onClose', async () => { await httpLog?.close(); });
  const requests = new WeakMap<FastifyRequest, { id: string; started: number; authenticated: boolean }>();

  const authorize = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const expected = Buffer.from(`Bearer ${token ?? ''}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (!enabled || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    if (request.method !== 'GET') {
      return reply.code(405).header('allow', 'GET').send({ error: { code: 'READ_ONLY' } });
    }
  };

  server.addHook('onRequest', async (request, reply) => {
    if (!actorId) return;
    const propagatedId = identifier.safeParse(request.headers['x-request-id']);
    const id = propagatedId.success && !credentials.has(propagatedId.data) ? propagatedId.data : randomUUID();
    requests.set(request, { id, started: performance.now(), authenticated: false });
    reply.header('x-request-id', id);
  });
  server.addHook('onResponse', async (request, reply) => {
    const context = requests.get(request);
    if (!context?.authenticated || !actorId || !logBuildAvailable
      || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return;
    const route = request.routeOptions.url ?? '[unmatched]';
    const params = (request.params ?? {}) as Record<string, unknown>;
    const safeId = (value: unknown) => {
      const parsed = identifier.safeParse(value);
      return parsed.success && !credentials.has(parsed.data) ? parsed.data : undefined;
    };
    const projectId = safeId(params.projectId ?? (route.startsWith('/projects/:id') ? params.id : undefined));
    const taskId = safeId(params.jobId ?? params.runId ?? ((route.startsWith('/runs/:id') || route.startsWith('/creator/jobs/:id')) ? params.id : undefined));
    const log: SupportHttpLog = {
      event: 'support_http_request', timestamp: new Date().toISOString(), service: 'opencreator',
      actor_id: actorId, request_id: context.id,
      method: request.method as SupportHttpLog['method'],
      route, http_status: reply.statusCode,
      duration_ms: Math.round(performance.now() - context.started),
      ...(projectId ? { project_id: projectId } : {}),
      ...(taskId ? { task_id: taskId } : {}),
      build_commit: build.commit, build_environment: build.environment, build_dirty: build.dirty as boolean,
      ...(build.buildTime !== 'unknown' ? { build_time: build.buildTime } : {})
    };
    await httpLog?.append(log);
    // Emit only this allowlist; never serialize URL, headers, bodies or errors.
    // 仅输出白名单字段，禁止序列化原始 URL、headers、body 或错误文本。
    process.stdout.write(`${JSON.stringify(log)}\n`);
  });

  server.get('/internal/support/version', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { service: 'opencreator', build, actorId };
  });
  server.get('/internal/support/evidence', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_SCOPE' } });
    const query = parsed.data;
    if (query.actorId !== actorId) return reply.code(403).send({ error: { code: 'ACTOR_MISMATCH' } });
    if (query.traceId) return reply.code(400).send({ error: { code: 'UNSUPPORTED_FILTER', field: 'traceId' } });
    if ([query.taskId, query.requestId, query.projectId].some(value => value && credentials.has(value))) {
      return reply.code(400).send({ error: { code: 'INVALID_SCOPE' } });
    }
    const end = query.end ? Date.parse(query.end) : Date.now();
    const start = query.start ? Date.parse(query.start) : end - DAY;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 7 * DAY) {
      return reply.code(400).send({ error: { code: 'INVALID_TIME_RANGE' } });
    }
    const limit = query.limit ?? 50;
    const scope = {
      actorId, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {})
    };
    let records: EvidenceRecord[] = [];
    let operationsAvailable = true;
    let recordsTruncated = false;
    try {
      // Fixed tables/columns on the daemon's own DB; no caller-selected SQL or paths.
      // 固定读取 daemon 自己的表和字段，不接受调用方 SQL 或路径。
      const rows = db.prepare(`
        SELECT * FROM (
          SELECT id, 'project' AS kind, status, created_at AS createdAt, updated_at AS updatedAt,
            id AS projectId, NULL AS taskId, NULL AS requestId, NULL AS errorCode FROM projects
          UNION ALL
          SELECT r.id, 'run', r.public_status, r.created_at, r.updated_at,
            t.project_id, r.id, NULL, r.error_code FROM runs r LEFT JOIN threads t ON t.id = r.thread_id
          UNION ALL
          SELECT id, 'creator_job', status, created_at, updated_at, project_id, id, NULL, NULL FROM creator_jobs
          UNION ALL
          SELECT s.id, 'creator_stage_run', s.status, s.created_at,
            COALESCE(s.finished_at, s.started_at, s.created_at), j.project_id, s.job_id, NULL, s.error_code
            FROM creator_stage_runs s JOIN creator_jobs j ON j.id = s.job_id
          UNION ALL
          SELECT p.id, 'provider_request', p.status, p.created_at, p.updated_at,
            j.project_id, COALESCE(p.remote_task_id, p.job_id), p.id, NULL
            FROM creator_provider_requests p JOIN creator_jobs j ON j.id = p.job_id
        ) WHERE julianday(updatedAt) BETWEEN julianday(@start) AND julianday(@end)
          AND (@projectId IS NULL OR projectId = @projectId)
          AND (@taskId IS NULL OR taskId = @taskId OR id = @taskId)
          AND (@requestId IS NULL OR requestId = @requestId)
        ORDER BY julianday(updatedAt) DESC, kind, id LIMIT @limit
      `).all({
        start: scope.start, end: scope.end, projectId: query.projectId ?? null,
        taskId: query.taskId ?? null, requestId: query.requestId ?? null, limit: limit + 1
      }) as Record<string, unknown>[];
      recordsTruncated = rows.length > limit;
      records = rows.slice(0, limit).map(row => {
        const record: EvidenceRecord = {
          id: identifier.parse(row.id), kind: String(row.kind),
          status: identifier.safeParse(row.status).success ? String(row.status) : 'unknown',
          createdAt: sqliteTimestamp(row.createdAt), updatedAt: sqliteTimestamp(row.updatedAt)
        };
        for (const key of ['projectId', 'taskId', 'requestId', 'errorCode'] as const) {
          const field = identifier.safeParse(row[key]);
          if (field.success && !credentials.has(field.data)) record[key] = field.data;
        }
        return record;
      });
    } catch {
      operationsAvailable = false;
      records = [];
    }
    const persisted = await httpLog!.read({ ...scope }, limit);
    return {
      service: 'opencreator', build, scope, records,
      logs: persisted.logs,
      coverage: {
        operations: {
          available: operationsAvailable,
          ...(operationsAvailable ? {} : { reason: 'NATIVE_DATABASE_UNREADABLE' }),
          sources: ['app.sqlite:projects', 'app.sqlite:runs', 'app.sqlite:creator_jobs',
            'app.sqlite:creator_stage_runs', 'app.sqlite:creator_provider_requests'],
          timeBasis: 'updatedAt (stage uses finishedAt/startedAt/createdAt)',
          requestId: 'provider_request.id; HTTP IDs only match inboundHttp',
          traceId: 'unsupported; traceId filter returns HTTP 400'
        },
        inboundHttp: {
          ...persisted.coverage,
          traceId: 'unsupported; traceId filter returns HTTP 400',
          authentication: 'business Bearer auth only; internal tool routes, probes and unauthenticated requests excluded',
          correlation: 'safe propagated x-request-id or daemon-generated response x-request-id; route parameter task/project IDs only'
        }
      },
      incomplete: !operationsAvailable || !persisted.coverage.windowComplete,
      truncated: recordsTruncated || persisted.truncated
    };
  });
  return {
    authorize,
    isReadCredential(request: FastifyRequest) {
      return Boolean(token) && request.headers.authorization === `Bearer ${token}`;
    },
    markAuthenticatedBusinessRequest(request: FastifyRequest) {
      const path = request.url.split('?')[0];
      if (!request.routeOptions.url || path?.startsWith('/internal/support/')
        || ['/healthz', '/health', '/version', '/api/version', '/.well-known/fg-runtime.json'].includes(path ?? '')) return;
      const context = requests.get(request);
      if (context) context.authenticated = true;
    }
  };
}

function sqliteTimestamp(value: unknown): string {
  return normalizeDatabaseTimestamp(z.string().parse(value));
}
