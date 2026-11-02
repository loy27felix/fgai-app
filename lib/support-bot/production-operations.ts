import { Pool, type PoolClient } from 'pg';
import {
  normalizeSupportOperationScope,
  supportOperationErrorEvidence,
  supportOperationScope,
  type SupportOperationScope,
} from './operations';
import { redactSupportText } from './redact';

export type ProductionLabOperationInput = {
  userId: string;
  projectId?: string;
  taskId?: string;
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
};

type OperationRow = {
  id: string;
  taskId: string | null;
  projectId: string;
  requestId: string;
  providerRequestId: string | null;
  status: string;
  kind: string;
  model: string | null;
  provider: string | null;
  error: string | null;
  occurredAt: Date | string;
  updatedAt: Date | string;
  source: string;
};
type MediaEvent = { jobId: string; event: string; occurredAt: Date | string; actorKind: 'user' | 'system' };
type CoverageState = 'not_queried' | 'queried' | 'schema_unavailable' | 'query_failed';
type Source = keyof typeof REQUIRED_COLUMNS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 10;
const EVENT_LIMIT = 20;
const REQUIRED_COLUMNS = {
  production_lab_state: ['id', 'document'],
  production_lab_media_jobs: ['id', 'owner_id', 'project_id', 'request_id', 'provider_request_id', 'status', 'kind', 'model', 'provider', 'error', 'created_at', 'updated_at'],
  production_lab_script_runs: ['actor_id', 'request_id', 'project_id', 'task_id', 'model_id', 'status', 'error', 'created_at', 'updated_at'],
  production_lab_media_job_events: ['job_id', 'actor_id', 'event', 'created_at'],
} as const;
const BASE_NOTE = '仅查询根应用 production-lab，不是 Yingce Canvas。账号直接使用 labActor.id（FG user.id），不按邮箱/姓名映射；操作 owner_id/actor_id 与项目 ownerId 必须同时等于当前用户，组共享/管理员可见性不授予额外权限。媒体事件只限已校验本人归属的任务，另包含 actor_id 为空的系统事件，并标明来源；不返回其他账号事件。多个编号按 AND 交集匹配，不自动扩大范围。taskId 仅匹配 media_jobs.id 或 script_runs.task_id；requestId 仅匹配各表 request_id，providerRequestId 仅作返回证据，不作为 requestId 的别名。时间按操作 updated_at、事件 created_at 的 [from,to) 筛选；不带定位编号时仅返回近期 failed/unknown 候选，不能认定为本次故障原因。未查询素材/画布正文；state.tasks 无操作人 ID、state.events.actor 仅为显示名，不能证明本人操作，均不作为操作证据。错误使用首行限长脱敏摘要，仅 errorExcerpt 是安全连续原文；状态快照和同号关联不单独证明故障原因。';

// Projects live inside the pilot JSON document, not a relational projects table.
// 项目保存在 pilot JSON 文档中，不存在可直接套用的 projects 关系表。
const OWNED_PROJECTS = `WITH owned_projects AS (
  SELECT p->>'id' AS id
    FROM public.production_lab_state s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.document->'projects') = 'array'
           THEN s.document->'projects' ELSE '[]'::jsonb END
    ) p
   WHERE s.id = 'pilot' AND p->>'ownerId' = $1
)`;
let pool: Pool | undefined;

function connectionString(): string | null {
  const url = process.env.SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL || process.env.PRODUCTION_LAB_DATABASE_URL;
  if (!url) return null;
  const identity = (value: string) => {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error('Invalid database URL');
    // URL options can override a PostgreSQL target; do not accept ambiguous targets.
    // URL 参数可能覆盖 PostgreSQL 目标，拒绝无法明确核验隔离性的配置。
    if (['host', 'hostaddr', 'port', 'database', 'dbname', 'service'].some((key) => parsed.searchParams.has(key))) throw new Error('Ambiguous database URL');
    return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}${decodeURIComponent(parsed.pathname)}`;
  };
  if (identity(url) === identity(process.env.DATABASE_URL || 'postgres://fg_studio:fg_studio@postgres:5432/fg_studio')) return null;
  return url;
}

async function withReadOnly<T>(url: string, read: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, statement_timeout: 3000, allowExitOnIdle: true });
    pool.on('error', () => undefined);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5000ms'");
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function safeIdentifier(value: unknown, max = 160): string | null {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9._:-]{1,${max}}$`).test(value) && redactSupportText(value) === value ? value : null;
}

function safeLabel(value: string | null, max: number): string | null {
  if (!value) return null;
  const evidence = supportOperationErrorEvidence(value);
  return evidence.summary?.slice(0, max) ?? null;
}

function summarize(row: OperationRow, events: MediaEvent[]) {
  const evidence = supportOperationErrorEvidence(row.error);
  return {
    id: safeIdentifier(row.id), taskId: safeIdentifier(row.taskId), sessionId: null,
    projectId: safeIdentifier(row.projectId), requestId: safeIdentifier(row.requestId, 96),
    traceId: null, providerRequestId: safeIdentifier(row.providerRequestId),
    status: safeLabel(row.status, 40), kind: safeLabel(row.kind, 40),
    model: safeLabel(row.model, 160), provider: safeLabel(row.provider, 80),
    error: evidence.summary, ...(evidence.errorExcerpt ? { errorExcerpt: evidence.errorExcerpt } : {}),
    occurredAt: new Date(row.occurredAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
    source: row.source,
    events: events.filter((event) => row.source === 'production_lab_media_job' && event.jobId === row.id).map((event) => ({
      event: /^[a-z][a-z0-9_]{0,99}$/.test(event.event) ? event.event : '[event hidden]',
      occurredAt: new Date(event.occurredAt).toISOString(), actorKind: event.actorKind,
    })),
  };
}

export async function queryProductionLabOperations(input: ProductionLabOperationInput): Promise<Record<string, unknown>> {
  const scope = normalizeSupportOperationScope(input);
  const sources: Record<Source, CoverageState> = {
    production_lab_state: 'not_queried', production_lab_media_jobs: 'not_queried',
    production_lab_script_runs: 'not_queried', production_lab_media_job_events: 'not_queried',
  };
  const finish = (data: Record<string, unknown>, notes: string[] = []) => ({
    system: 'production-lab', service: 'production-lab',
    scope: scope ? { ...supportOperationScope(scope), sessionId: scope.sessionId ?? null } : null,
    rows: [], incomplete: false, truncated: false, ...data,
    coverage: {
      sources,
      projectOwnership: 'production_lab_state.document.projects[].ownerId = userId',
      traceId: { available: false, reason: '已核实表无 trace_id，未建立可靠映射。' },
      sessionId: { available: false, reason: '已核实表无 session_id，未建立可靠映射。' },
      manualOperations: { available: false, reason: 'state.tasks 无操作人 ID；state.events.actor 为显示名。' },
      inboundHttp: { available: false, reason: '这里只覆盖业务任务状态与本人任务的媒体事件，不包含 HTTP 请求/响应证据。' },
    },
    note: [BASE_NOTE, ...notes].join(' '),
  });
  if (!scope) return finish({ incomplete: true }, ['用户、编号或时间范围无效；默认 24 小时、最大 7 天，仅精确 taskId/requestId 且未提供时间时可不限时间，未执行查询。']);
  if (scope.traceId !== undefined || scope.sessionId !== undefined) return finish({ incomplete: true }, ['traceId/sessionId 暂无可靠业务映射；未忽略筛选，未执行查询或回退 FG 主库。']);
  if ([scope.projectId, scope.taskId].some((id) => id !== undefined && !UUID.test(id))) return finish({ incomplete: true }, ['production-lab 项目和任务仅支持 UUID；不支持的编号未被忽略，未执行查询。']);
  try {
    const url = connectionString();
    if (!url) return finish({ incomplete: true }, ['未配置独立数据源或目标与 FG 主库相同；需要 SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL 或 PRODUCTION_LAB_DATABASE_URL，不回退 FG 主库。']);
    return await withReadOnly(url, async (client) => {
      const columns = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [Object.keys(REQUIRED_COLUMNS)],
      );
      const hasColumn = (table: Source, column: string) => columns.rows.some((row) => row.table_name === table && row.column_name === column);
      for (const table of Object.keys(REQUIRED_COLUMNS) as Source[]) {
        if (!REQUIRED_COLUMNS[table].every((column) => hasColumn(table, column))) sources[table] = 'schema_unavailable';
      }
      if (sources.production_lab_state === 'schema_unavailable') return finish({ incomplete: true }, ['项目归属表或必要字段不可用，无法验证项目归属，未查询任务。']);
      const state = await client.query<{ valid: boolean }>(
        "SELECT jsonb_typeof(document->'projects') = 'array' AS valid FROM public.production_lab_state WHERE id = $1", ['pilot'],
      );
      if (state.rows[0]?.valid !== true) return finish({ incomplete: true }, ['pilot 项目文档缺失或结构不受支持，无法验证项目归属，未查询任务。']);
      sources.production_lab_state = 'queried';
      const result = await readOperations(client, scope, sources, hasColumn);
      return finish(result.data, result.notes);
    });
  } catch {
    // Connection/SQL errors may contain credentials or record values; never echo them.
    // 连接和 SQL 错误可能包含凭据或记录值，不将其原文作为业务故障证据。
    for (const table of Object.keys(sources) as Source[]) {
      if (sources[table] === 'queried') sources[table] = 'query_failed';
    }
    return finish({ incomplete: true }, ['独立数据源配置、连接或只读查询失败，未回退 FG 主库；查询失败不代表本次反馈的故障原因。']);
  }
}

async function readOperations(
  client: PoolClient, scope: SupportOperationScope, sources: Record<Source, CoverageState>,
  hasColumn: (table: Source, column: string) => boolean,
) {
  const notes: string[] = [];
  let incomplete = false;
  let truncated = false;
  const rows: OperationRow[] = [];
  const params = [scope.userId, scope.taskId ?? null, scope.projectId ?? null, scope.requestId ?? null, scope.from, scope.to, LIMIT + 1];
  const querySource = async <T extends Record<string, unknown>>(table: Source, sql: string, values: unknown[]): Promise<T[]> => {
    if (sources[table] === 'schema_unavailable') {
      incomplete = true;
      notes.push(`${table} 或必要字段不可用，未覆盖该来源。`);
      return [];
    }
    await client.query('SAVEPOINT support_production_source');
    try {
      const result = await client.query<T>(sql, values);
      await client.query('RELEASE SAVEPOINT support_production_source');
      sources[table] = 'queried';
      return result.rows;
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT support_production_source');
      await client.query('RELEASE SAVEPOINT support_production_source');
      sources[table] = 'query_failed';
      incomplete = true;
      notes.push(`${table} 只读查询失败，该来源未覆盖；其他已验证来源不受影响。`);
      return [];
    }
  };
  rows.push(...await querySource<OperationRow>('production_lab_media_jobs', `${OWNED_PROJECTS}
    SELECT j.id::text AS id, j.id::text AS "taskId", j.project_id AS "projectId", j.request_id AS "requestId",
           j.provider_request_id AS "providerRequestId", j.status, j.kind, j.model, j.provider,
           left(j.error, 2000) AS error, j.created_at AS "occurredAt", j.updated_at AS "updatedAt",
           'production_lab_media_job' AS source
      FROM public.production_lab_media_jobs j
     WHERE j.owner_id = $1 AND j.project_id IN (SELECT id FROM owned_projects)
       AND ($2::text IS NULL OR j.id = $2::uuid)
       AND ($3::text IS NULL OR j.project_id = $3)
       AND ($4::text IS NULL OR j.request_id = $4)
       AND ($5::timestamptz IS NULL OR j.updated_at >= $5)
       AND ($6::timestamptz IS NULL OR j.updated_at < $6)
       AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $4::text IS NOT NULL OR j.status IN ('failed', 'unknown'))
     ORDER BY j.updated_at DESC, j.id DESC LIMIT $7`, params));
  const providerRequestId = hasColumn('production_lab_script_runs', 'provider_request_id');
  if (!providerRequestId && sources.production_lab_script_runs !== 'schema_unavailable') {
    incomplete = true;
    notes.push('script_runs.provider_request_id 不可用，供应商请求关联未覆盖。');
  }
  rows.push(...await querySource<OperationRow>('production_lab_script_runs', `${OWNED_PROJECTS}
    SELECT r.request_id AS id, r.task_id AS "taskId", r.project_id AS "projectId", r.request_id AS "requestId",
           ${providerRequestId ? 'r.provider_request_id' : 'NULL::text'} AS "providerRequestId",
           r.status, 'script' AS kind, r.model_id AS model, NULL::text AS provider,
           left(r.error, 2000) AS error, r.created_at AS "occurredAt", r.updated_at AS "updatedAt",
           'production_lab_script_run' AS source
      FROM public.production_lab_script_runs r
     WHERE r.actor_id = $1 AND r.project_id IN (SELECT id FROM owned_projects)
       AND ($2::text IS NULL OR r.task_id = $2)
       AND ($3::text IS NULL OR r.project_id = $3)
       AND ($4::text IS NULL OR r.request_id = $4)
       AND ($5::timestamptz IS NULL OR r.updated_at >= $5)
       AND ($6::timestamptz IS NULL OR r.updated_at < $6)
       AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $4::text IS NOT NULL OR r.status IN ('failed', 'unknown'))
     ORDER BY r.updated_at DESC, r.request_id DESC LIMIT $7`, params));
  rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.source.localeCompare(b.source) || b.id.localeCompare(a.id));
  truncated = rows.length > LIMIT;
  const selected = rows.slice(0, LIMIT);
  const mediaIds = selected.filter((row) => row.source === 'production_lab_media_job').map((row) => row.id);
  let events: MediaEvent[] = [];
  if (mediaIds.length || sources.production_lab_media_job_events === 'schema_unavailable') {
    events = await querySource<MediaEvent>('production_lab_media_job_events', `
      SELECT e.job_id::text AS "jobId", e.event, e.created_at AS "occurredAt",
             CASE WHEN e.actor_id IS NULL THEN 'system' ELSE 'user' END AS "actorKind"
        FROM public.production_lab_media_job_events e
       WHERE (e.actor_id = $1 OR e.actor_id IS NULL) AND e.job_id = ANY($2::uuid[])
         AND ($3::timestamptz IS NULL OR e.created_at >= $3)
         AND ($4::timestamptz IS NULL OR e.created_at < $4)
       ORDER BY e.created_at DESC, e.job_id DESC, e.event LIMIT $5`, [scope.userId, mediaIds, scope.from, scope.to, EVENT_LIMIT + 1]);
  }
  truncated ||= events.length > EVENT_LIMIT;
  if ((scope.taskId || scope.projectId || scope.requestId) && !selected.length) {
    incomplete = true;
    notes.push('指定编号交集下没有可验证归属的操作；可能编号类型不支持、无匹配、缺失项目映射或超出本人范围，不能据此推断不存在任务或放宽筛选。');
  }
  if (truncated) notes.push(`最多返回 ${LIMIT} 条操作、${EVENT_LIMIT} 条本人任务媒体事件，结果已截断。`);
  return { data: { rows: selected.map((row) => summarize(row, events.slice(0, EVENT_LIMIT))), incomplete, truncated }, notes };
}

export async function closeProductionLabOperationConnections(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}
