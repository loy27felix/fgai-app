import type { PoolClient } from 'pg';
import {
  normalizeSupportOperationScope,
  SUPPORT_CANVAS_OWNED_SCOPE,
  supportOperationErrorEvidence,
  supportCanvasUser,
  supportOperationScope,
  withSupportCanvasReadOnly,
  type SupportOperationScope,
} from './operations';
import { redactSupportText } from './redact';

type CanvasLogInput = {
  userId: string;
  projectId?: string;
  taskId?: string;
  requestId?: string;
  traceId?: string;
  from?: string;
  to?: string;
};
type Schema = Record<string, Set<string>>;
type LogRow = {
  id: string; source: string; taskId?: string; projectId?: string; requestId?: string;
  traceId?: string; providerRequestId?: string; occurredAt: Date | string;
  level?: string; errorCode?: string; status?: string; httpStatus?: number; error?: string; message?: string; event?: string;
};
const LIMIT = 100;
const HTTP_GAP = 'Canvas 数据库日志不含入站 HTTP AccessLog；入站记录由独立的原生JSON日志源核验，不能用 api_call_logs 上游调用审计替代。日志源未配置或历史缺失时不能补造记录。';
const TABLES = ['fg_accounts', 'users', 'projects', 'canvas_projects', 'tasks', 'task_logs', 'api_call_logs'];

async function readSchema(client: PoolClient): Promise<Schema> {
  const result = await client.query<{ table: string; column: string }>(`
    SELECT c.relname AS "table", a.attname AS "column"
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.oid IN (SELECT to_regclass(name) FROM unnest($1::text[]) AS name)
       AND a.attnum > 0 AND NOT a.attisdropped`, [TABLES]);
  const schema: Schema = {};
  for (const row of result.rows) (schema[row.table] ??= new Set()).add(row.column);
  return schema;
}

function missing(schema: Schema, table: string, columns: string[]) {
  return columns.filter((column) => !schema[table]?.has(column));
}

function safeId(value: unknown, max = 160): string | undefined {
  if (typeof value !== 'string' || !value || value.length > max || !/^[A-Za-z0-9._:-]+$/.test(value)) return undefined;
  return redactSupportText(value) === value ? value : undefined;
}

function safeEnum(value: unknown, allowed: string[]): string | undefined {
  return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}

function summarize(row: LogRow): Record<string, unknown> {
  const error = supportOperationErrorEvidence(row.error);
  const message = supportOperationErrorEvidence(row.message);
  const errorExcerpt = error.errorExcerpt ?? message.errorExcerpt;
  return {
    id: `${row.source}:${safeId(row.id) ?? '[redacted]'}`, source: row.source,
    taskId: safeId(row.taskId, 120), projectId: safeId(row.projectId, 120),
    requestId: safeId(row.requestId, 96), traceId: safeId(row.traceId, 96), providerRequestId: safeId(row.providerRequestId),
    occurredAt: new Date(row.occurredAt).toISOString(),
    level: safeEnum(row.level, ['debug', 'info', 'warn', 'warning', 'error', 'fatal']),
    status: safeEnum(row.status, ['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled', 'canceled', 'pending', 'completed']),
    ...(Number.isInteger(row.httpStatus) && row.httpStatus! >= 100 && row.httpStatus! <= 599 ? { httpStatus: row.httpStatus } : {}),
    ...(error.summary ? { error: error.summary } : {}),
    ...(message.summary ? { message: message.summary } : {}),
    ...(errorExcerpt ? { errorExcerpt } : {}),
    ...(row.errorCode ? { errorCode: safeId(row.errorCode, 80) } : {}),
    event: safeEnum(row.event, ['task_log', 'create', 'poll', 'cancel', 'download', 'offload', 'upload', 'query', 'request', 'api_call']),
  };
}

async function querySources(client: PoolClient, scope: SupportOperationScope) {
  const schema = await readSchema(client);
  const required: Record<string, string[]> = {
    fg_accounts: ['user_id'], users: ['id', 'status'], projects: ['id', 'user_id', 'fg_deleted_at'],
    canvas_projects: ['id', 'user_id', 'project_id', 'deleted_at'], tasks: ['id', 'user_id', 'project_id'],
  };
  const unavailable = Object.entries(required).filter(([table, columns]) => missing(schema, table, columns).length).map(([table]) => table);
  if (unavailable.length) return { rows: [], incomplete: true, note: `Canvas 身份映射或归属校验必要表/字段缺失：${unavailable.join('、')}；未查询日志，未回退 FG 主库。` };
  const userId = await supportCanvasUser(client, scope.userId);
  if (!userId) return { rows: [], incomplete: true, note: 'Canvas 未找到当前 FG 账号与 active users 的受信映射；未查询日志，未按相同 UUID 推断身份，未回退 FG 主库。' };
  const notes: string[] = [];
  const rows: LogRow[] = [];
  let incomplete = false;
  let truncated = false;
  const sourceCoverage: Record<string, string> = {};
  const sources = [
    { table: 'task_logs', alias: 'l', required: ['id', 'user_id', 'task_id', 'created_at', 'level', 'message'], time: 'created_at' },
    { table: 'api_call_logs', alias: 'a', required: ['id', 'user_id', 'task_id', 'created_at', 'status', 'status_code', 'error', 'request_kind'], time: 'created_at' },
  ];
  for (const source of sources) {
    const { table, alias } = source;
    const needed = [...source.required, ...(scope.requestId ? ['request_id'] : []), ...(scope.traceId ? ['trace_id'] : [])];
    const absent = missing(schema, table, needed);
    if (absent.length) {
      incomplete = true;
      sourceCoverage[table] = 'missing_table_or_required_columns';
      notes.push(`${table} 表或必要字段缺失（${absent.join('、')}），未查询该来源，未忽略筛选条件。`);
      continue;
    }
    const optional = (column: string, name: string) => schema[table].has(column) ? `${alias}.${column} AS "${name}"` : `NULL AS "${name}"`;
    const absentIds = ['request_id', 'trace_id', ...(table !== 'task_logs' ? ['provider_request_id'] : [])].filter((column) => !schema[table].has(column));
    if (absentIds.length) {
      incomplete = true;
      notes.push(`${table} 缺少 ${absentIds.join('、')}，对应链路标识不可用。`);
    }
    if (table === 'api_call_logs' && !schema[table].has('error_code')) {
      incomplete = true;
      notes.push('api_call_logs 缺少 error_code，错误码不可用。');
    }
    const projection = table === 'task_logs'
        ? `l.level, left(l.message, 2000) AS message, 'task_log' AS event`
        : `a.status, a.status_code AS "httpStatus", left(a.error, 2000) AS error, a.request_kind AS event, ${optional('error_code', 'errorCode')}`;
    const taskId = `${alias}.task_id`;
    const requestFilter = scope.requestId ? `AND ${alias}.request_id = $6` : 'AND $6::text IS NULL';
    const traceFilter = scope.traceId ? `AND ${alias}.trace_id = $7` : 'AND $7::text IS NULL';
    // AND is row-local: discovered IDs are not expanded inside this evidence reader.
    // ID 条件逐行取 AND 交集；已发现标识的链路展开由外部编排执行。
    try {
      await client.query('SAVEPOINT support_canvas_log_source');
      const result = await client.query<LogRow>(`${SUPPORT_CANVAS_OWNED_SCOPE}
        SELECT ${alias}.id, '${table}' AS source, ${taskId} AS "taskId", t.project_id AS "projectId",
               ${optional('request_id', 'requestId')}, ${optional('trace_id', 'traceId')},
               ${table === 'task_logs' ? 'NULL AS "providerRequestId"' : optional('provider_request_id', 'providerRequestId')},
               ${alias}.${source.time} AS "occurredAt", ${projection}
          FROM ${table} ${alias}
          LEFT JOIN owned_tasks t ON t.id = ${taskId}
         WHERE ${alias}.user_id = $1
           AND (nullif(${taskId}, '') IS NULL OR t.id IS NOT NULL)
           ${table === 'task_logs' ? 'AND t.id IS NOT NULL' : ''}
           AND ($2::text IS NULL OR ${taskId} = $2)
           AND ($3::text IS NULL OR t.project_id = $3 OR t.project_id IN (SELECT id FROM owned_canvases WHERE project_id = $3))
           AND ($4::timestamptz IS NULL OR ${alias}.${source.time} >= $4)
           AND ($5::timestamptz IS NULL OR ${alias}.${source.time} < $5)
           ${requestFilter} ${traceFilter}
         ORDER BY ${alias}.${source.time} DESC, ${alias}.id DESC LIMIT ${LIMIT + 1}`,
      [userId, scope.taskId ?? null, scope.projectId ?? null, scope.from, scope.to, scope.requestId ?? null, scope.traceId ?? null]);
      await client.query('RELEASE SAVEPOINT support_canvas_log_source');
      sourceCoverage[table] = 'queried';
      if (result.rows.length > LIMIT) {
        truncated = true;
        notes.push(`${table} 超过 ${LIMIT} 条，已截断；可缩小时间或 ID 范围。`);
      }
      rows.push(...result.rows.slice(0, LIMIT));
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT support_canvas_log_source');
      await client.query('RELEASE SAVEPOINT support_canvas_log_source');
      incomplete = true;
      sourceCoverage[table] = 'query_failed';
      notes.push(`${table} 只读查询失败，该来源未覆盖；保留其他已验证来源，未回退 FG 主库。`);
    }
  }
  rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || b.id.localeCompare(a.id));
  if (rows.length > LIMIT) {
    truncated = true;
    notes.push(`合并结果超过 ${LIMIT} 条，已截断。`);
  }
  return {
    rows: rows.slice(0, LIMIT).map(summarize), incomplete, truncated, sourceCoverage,
    note: `仅本人日志；关联任务及项目须同时本人所有，排除共享/管理员可见数据。多个 ID 按 AND 交集逐行匹配，不自动展开。tasks 仅用于归属校验，状态快照由 operations 提供；task_logs/api_call_logs 按 created_at，时间范围为 [from,to)。error/message 为首行限长脱敏摘要，仅 errorExcerpt 是安全连续原文；合成占位文字不可用于故障原文吻合判断；未返回原始路径、payload 或请求/响应正文。${notes.join(' ')}`,
  };
}

export async function queryCanvasSupportLogs(input: CanvasLogInput): Promise<Record<string, unknown>> {
  const scope = normalizeSupportOperationScope({ ...input, context: { source: 'canvas' } });
  const envelope = { system: 'canvas', scope: scope ? supportOperationScope(scope) : { from: null, to: null, taskId: null, requestId: null, traceId: null, projectId: null } };
  const finish = (result: Record<string, unknown>) => {
    const { sourceCoverage, ...data } = result;
    return {
      ...envelope, truncated: false, incomplete: false, ...data,
      coverage: { inboundHttp: { available: false, reason: HTTP_GAP }, sources: sourceCoverage ?? {} },
      limitations: [HTTP_GAP],
      note: `${HTTP_GAP} ${typeof result.note === 'string' ? result.note : ''}`.trim(),
    };
  };
  if (!scope) return finish({ rows: [], incomplete: true, note: '用户、标识或时间范围无效；默认 24 小时、最大 7 天；仅精确 taskId/requestId/traceId 且未提供时间时可不限时间。' });
  if (!process.env.SUPPORT_BOT_CANVAS_DATABASE_URL) return finish({ rows: [], incomplete: true, note: 'Canvas 只读数据源未配置（SUPPORT_BOT_CANVAS_DATABASE_URL），未查询且未回退 FG 主库。' });
  try {
    return finish(await withSupportCanvasReadOnly((client) => querySources(client, scope)));
  } catch (error) {
    const schemaError = error && typeof error === 'object' && 'code' in error && ['42P01', '42703'].includes(String(error.code));
    return finish({ rows: [], incomplete: true, note: schemaError
      ? 'Canvas 日志表或必要字段不可用，未回退 FG 主库。'
      : 'Canvas 原生只读日志查询失败，未回退 FG 主库；这不代表用户反馈的故障原因。' });
  }
}
