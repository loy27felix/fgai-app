import { Pool, type PoolClient } from 'pg';
import { withTransaction } from '@/lib/local/db';
import type { SupportContext } from './context';
import { redactSupportText } from './redact';

type OperationInput = {
  userId: string;
  context?: SupportContext;
  taskId?: string;
  projectId?: string;
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
};

export type SupportOperationScope = { userId: string; taskId?: string; sessionId?: string; projectId?: string; requestId?: string; traceId?: string; from: string | null; to: string | null };
type Scope = SupportOperationScope;
type OperationRow = {
  id: string; taskId: string | null; sessionId: string | null; projectId?: string | null;
  status: string; kind: string; model: string | null; provider: string | null;
  error: string | null; occurredAt: Date | string; updatedAt: Date | string;
  source: string; requestId?: string | null; traceId?: string | null; providerRequestId?: string | null; stage?: string; events?: Record<string, unknown>[];
};

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,120}$/;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,96}$/;
const QUERY_FAILED = '操作数据暂时无法查询；查询失败不代表本次反馈的故障原因。';
let canvasPool: Pool | undefined;

export function normalizeSupportOperationScope(input: OperationInput): Scope | null {
  if (!UUID.test(input.userId)) return null;
  const taskId = input.taskId ?? input.context?.taskId;
  const sessionId = input.sessionId ?? input.context?.sessionId;
  const projectId = input.projectId ?? input.context?.projectId;
  const { requestId, traceId } = input;
  if ([requestId, traceId].some((id) => id !== undefined && (typeof id !== 'string' || !CORRELATION_ID.test(id) || redactSupportText(id) !== id))) return null;
  if ([taskId, sessionId, projectId].some((id) => id !== undefined && (typeof id !== 'string' || !IDENTIFIER.test(id) || redactSupportText(id) !== id))) return null;
  if (input.context?.source !== undefined && !['fg', 'canvas'].includes(input.context.source)) return null;
  if ((taskId || requestId || traceId) && input.from === undefined && input.to === undefined) {
    return { userId: input.userId, taskId, sessionId, projectId, requestId, traceId, from: null, to: null };
  }
  if ([input.from, input.to].some((value) => value !== undefined && typeof value !== 'string')) return null;
  const to = input.to === undefined ? Date.now() : Date.parse(input.to);
  const from = input.from === undefined ? to - DAY_MS : Date.parse(input.from);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 7 * DAY_MS) return null;
  return { userId: input.userId, taskId, sessionId, projectId, requestId, traceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function supportOperationErrorEvidence(value: unknown): { summary: string | null; errorExcerpt?: string } {
  if (typeof value !== 'string' || !value.trim()) return { summary: null };
  const firstLine = value.split(/[\r\n\u2028\u2029]/, 1)[0].trim().slice(0, 2000);
  // Bodies are not evidence excerpts; retain only the bounded diagnostic prefix.
  // 正文不作为错误摘录，仅保留有长度上限的首行诊断前缀。
  let structured = false;
  if (/^[\[{]/.test(firstLine)) {
    try { structured = typeof JSON.parse(firstLine) === 'object'; } catch { /* Truncated bodies are handled below. / 截断正文由下方识别。 */ }
  }
  if (structured || /^(?:\{|\[\s*(?:[\[{"']|$))/.test(firstLine)) return { summary: '结构化错误正文已隐藏。' };
  const bodyAt = firstLine.search(/\b(?:prompt|payload|parameters|body|(?:request|response)(?:[_\s-]?body)?|input(?:[_\s-]?json)?|result(?:[_\s-]?json)?)\b["'\\\s]*(?:[:：=]|\s+[\[{])|(?:提示词|请求体|响应体|输入|输出)\s*[:：=]|\{|\[\s*[\[{"']|<(?:!doctype|html|body|script|pre|div)\b/i);
  const prefix = bodyAt < 0 ? firstLine : `${firstLine.slice(0, bodyAt)}[content redacted]`;
  let summary = redactSupportText(prefix)
    .replace(/(?:file:\/\/|[A-Za-z]:\\)[^\s"'<>，。；]+/g, '[path redacted]')
    .replace(/(^|[\s(`"'=：:])(?:~|\.{1,2})?\/[^\s"'<>，。；)]+/g, '$1[path redacted]')
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, (token) => {
      const counts = new Map<string, number>();
      for (const char of token) counts.set(char, (counts.get(char) ?? 0) + 1);
      const entropy = [...counts.values()].reduce((sum, count) => sum - count / token.length * Math.log2(count / token.length), 0);
      return token.length >= 96 || /^[a-f0-9]{24,}$/i.test(token) || entropy >= 3.4 ? '[opaque value redacted]' : token;
    })
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[address redacted]')
    .replace(/[\x00-\x1f\x7f]/g, '[control redacted]')
    .slice(0, 320).trim();
  if (!summary) summary = '错误首行正文已隐藏。';
  // Proof must be a contiguous, unchanged fragment, never a redaction placeholder.
  // 证明片段必须是原始内容的连续且未改写子串，不能将脱敏占位文字作为证据。
  const errorExcerpt = summary.split(/\[[^\]]*redacted[^\]]*\]/i)
    .map((part) => part.trim().replace(/^[\s"'`:,;]+|[\s"'`:,;]+$/g, '').slice(0, 160))
    .filter((part) => part.length >= 6 && /[A-Za-z\u4e00-\u9fff]/.test(part) && value.includes(part))
    .sort((a, b) => b.length - a.length)[0];
  return { summary, ...(errorExcerpt ? { errorExcerpt } : {}) };
}

export function summarizeSupportOperationError(value: unknown): string | null {
  return supportOperationErrorEvidence(value).summary;
}

export function supportOperationScope(scope: Scope) {
  return { from: scope.from, to: scope.to, taskId: scope.taskId ?? null, requestId: scope.requestId ?? null,
    traceId: scope.traceId ?? null, projectId: scope.projectId ?? null };
}

function summaryRows(rows: OperationRow[], events: Record<string, unknown>[]) {
  const eventOwners = new Set<string>();
  return rows.map((row) => {
    const rowEvents = row.taskId && !eventOwners.has(row.taskId)
      ? events.filter((event) => event.taskId === row.taskId).map((event) => {
        const evidence = supportOperationErrorEvidence(event.message);
        return {
          ...(typeof event.event === 'string' ? { event: redactSupportText(event.event).slice(0, 100) } : {}),
          ...(typeof event.status === 'string' ? { status: redactSupportText(event.status).slice(0, 40) } : {}),
          ...(typeof event.level === 'string' ? { level: redactSupportText(event.level).slice(0, 24) } : {}),
          ...(typeof event.requestId === 'string' && CORRELATION_ID.test(event.requestId) ? { requestId: redactSupportText(event.requestId) } : {}),
          ...(typeof event.traceId === 'string' && CORRELATION_ID.test(event.traceId) ? { traceId: redactSupportText(event.traceId) } : {}),
          ...(evidence.summary ? { message: evidence.summary } : {}),
          ...(evidence.errorExcerpt ? { errorExcerpt: evidence.errorExcerpt } : {}),
          occurredAt: new Date(event.occurredAt as string | Date).toISOString(),
        };
      }) : [];
    const evidence = supportOperationErrorEvidence(row.error);
    if (row.taskId) eventOwners.add(row.taskId);
    return {
      ...row,
      requestId: typeof row.requestId === 'string' && CORRELATION_ID.test(row.requestId) ? redactSupportText(row.requestId) : null,
      traceId: typeof row.traceId === 'string' && CORRELATION_ID.test(row.traceId) ? redactSupportText(row.traceId) : null,
      providerRequestId: typeof row.providerRequestId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(row.providerRequestId) ? redactSupportText(row.providerRequestId) : null,
      model: row.model ? redactSupportText(row.model).slice(0, 160) : null,
      provider: row.provider ? redactSupportText(row.provider).slice(0, 80) : null,
      error: evidence.summary,
      ...(evidence.errorExcerpt ? { errorExcerpt: evidence.errorExcerpt } : {}),
      occurredAt: new Date(row.occurredAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      events: rowEvents,
    };
  });
}

function evidenceNote(scope: Scope) {
  return scope.taskId || scope.sessionId || scope.projectId || scope.requestId || scope.traceId
    ? '仅返回当前用户拥有且符合指定范围的记录；空结果不会扩大查询范围。'
    : '仅为当前用户近期失败记录，尚未确认与本次反馈相关，不应直接认定为故障原因。';
}

async function creatorOperations(scope: Scope): Promise<Record<string, unknown>> {
  if (scope.requestId || scope.traceId) return { rows: [], note: 'FG creator 暂无已核实的 requestId/traceId 查询关联，未忽略筛选或扩大范围。' };
  if (scope.projectId) return { rows: [], note: '当前仅支持 creator 任务和会话；FG projectId 无可靠业务关联，未扩大到账号范围查询。' };
  if ((scope.taskId && !UUID.test(scope.taskId)) || (scope.sessionId && !UUID.test(scope.sessionId))) {
    return { rows: [], error: '任务或会话标识格式无效，未执行操作数据查询。' };
  }
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    const result = await client.query<OperationRow>(`
      SELECT t.id, t.id AS "taskId", t.session_id AS "sessionId", t.canvas_id AS "canvasId",
             t.status, t.kind, t.model, t.provider, left(t.error, 2000) AS error,
             t.created_at AS "occurredAt", t.updated_at AS "updatedAt", 'creator' AS source
        FROM creator_generation_tasks t
        JOIN creator_workspaces w ON w.id = t.workspace_id AND w.owner_id = $1
       WHERE t.user_id = $1
         AND ($2::uuid IS NULL OR t.id = $2)
         AND ($3::uuid IS NULL OR (t.session_id = $3 AND EXISTS (
           SELECT 1 FROM creator_sessions s WHERE s.id = $3 AND s.workspace_id = w.id
         )))
         AND ($4::timestamptz IS NULL OR t.updated_at >= $4)
         AND ($5::timestamptz IS NULL OR t.updated_at < $5)
         AND ($2::uuid IS NOT NULL OR $3::uuid IS NOT NULL OR t.status IN ('failed', 'expired'))
       ORDER BY t.updated_at DESC, t.id DESC LIMIT 10`,
    [scope.userId, scope.taskId ?? null, scope.sessionId ?? null, scope.from, scope.to]);
    const ids = result.rows.map((row) => row.id);
    const events = ids.length ? await client.query(`
      SELECT e.task_id AS "taskId", left(e.event, 100) AS event, left(e.status, 40) AS status, e.created_at AS "occurredAt"
        FROM creator_generation_task_events e
        JOIN creator_generation_tasks t ON t.id = e.task_id AND t.user_id = $1
        JOIN creator_workspaces w ON w.id = t.workspace_id AND w.owner_id = $1
       WHERE e.task_id = ANY($2::uuid[])
         AND ($3::timestamptz IS NULL OR e.created_at >= $3)
         AND ($4::timestamptz IS NULL OR e.created_at < $4)
       ORDER BY e.created_at DESC, e.id DESC LIMIT 20`, [scope.userId, ids, scope.from, scope.to]) : { rows: [] };
    return {
      rows: summaryRows(result.rows, events.rows), truncated: result.rows.length >= 10 || events.rows.length >= 20,
      note: `${evidenceNote(scope)} FG 当前查询 creator；Production Lab 独立业务库须选择 production-lab 服务另查，不能用主库结果代替。`,
    };
  });
}

export const SUPPORT_CANVAS_OWNED_SCOPE = `WITH owned_projects AS (
  SELECT id FROM projects WHERE user_id = $1 AND fg_deleted_at IS NULL
), owned_canvases AS (
  SELECT id, project_id FROM canvas_projects WHERE user_id = $1 AND deleted_at IS NULL
    AND (nullif(project_id, '') IS NULL OR project_id IN (SELECT id FROM owned_projects))
), owned_tasks AS (
  SELECT t.id, t.project_id FROM tasks t WHERE t.user_id = $1
    AND (nullif(t.project_id, '') IS NULL OR t.project_id IN (SELECT id FROM owned_projects)
      OR t.project_id IN (SELECT id FROM owned_canvases))
)`;

export async function supportCanvasUser(client: PoolClient, fgUserId: string): Promise<string | null> {
  const mapping = await client.query(`SELECT a.user_id FROM fg_accounts a
    JOIN users u ON u.id = a.user_id AND u.status = 'active' WHERE a.user_id = $1 LIMIT 1`, [fgUserId]);
  return mapping.rows[0]?.user_id ?? null;
}

export async function withSupportCanvasReadOnly<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.SUPPORT_BOT_CANVAS_DATABASE_URL;
  if (!connectionString) throw new Error('Canvas read-only source not configured');
  if (!canvasPool) {
    canvasPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000, statement_timeout: 3000 });
    canvasPool.on('error', () => undefined);
  }
  const client = await canvasPool.connect();
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

async function canvasOperations(client: PoolClient, scope: Scope): Promise<Record<string, unknown>> {
  const schema = (await client.query(`SELECT
    to_regclass('fg_accounts') IS NOT NULL AS accounts, to_regclass('users') IS NOT NULL AS users,
    to_regclass('tasks') IS NOT NULL AS tasks, to_regclass('projects') IS NOT NULL AS projects,
    to_regclass('canvas_projects') IS NOT NULL AS canvases, to_regclass('task_logs') IS NOT NULL AS logs,
    to_regclass('drama_jobs') IS NOT NULL AS jobs, to_regclass('drama_productions') IS NOT NULL AS productions`)).rows[0];
  if (!schema.accounts || !schema.users || !schema.tasks || !schema.projects || !schema.canvases) {
    return { rows: [], incomplete: true, note: 'Canvas 身份映射或任务数据表不可用，未查询操作记录，也未回退到 FG 主库。' };
  }
  const userId = await supportCanvasUser(client, scope.userId);
  if (!userId) return { rows: [], note: 'Canvas 未找到当前 FG 用户的 active 受信账号映射，未按相同 UUID 推断身份。' };
  const hasDrama = schema.jobs && schema.productions;
  const values = [userId, scope.taskId ?? null, scope.projectId ?? null, scope.from, scope.to, scope.requestId ?? null, scope.traceId ?? null];
  // Team visibility is deliberately narrower here: both task and project must be owned.
  // 诊断不复用团队共享权限：任务和关联项目必须同时属于当前用户。
  const ownedScope = SUPPORT_CANVAS_OWNED_SCOPE;
  const dramaRows = hasDrama ? `UNION ALL
    SELECT j.id, nullif(j.task_id, '') AS "taskId", NULL AS "sessionId", j.project_id AS "projectId",
           j.status, j.kind, NULL AS model, NULL AS provider, left(j.error, 2000) AS error,
           j.created_at AS "occurredAt", j.updated_at AS "updatedAt", 'canvas_drama_job' AS source, NULL AS stage,
           linked.request_id AS "requestId", linked.trace_id AS "traceId", linked.provider_request_id AS "providerRequestId"
      FROM drama_jobs j
      LEFT JOIN tasks linked ON linked.id = j.task_id AND linked.project_id = j.project_id
        AND linked.id IN (SELECT id FROM owned_tasks)
      JOIN drama_productions d ON d.project_id = j.project_id AND d.user_id = $1
     WHERE j.project_id IN (SELECT id FROM owned_projects)
       AND (nullif(j.task_id, '') IS NULL OR EXISTS (
         SELECT 1 FROM tasks t WHERE t.id = j.task_id AND t.user_id = $1 AND t.project_id = j.project_id
       ))
       AND ($2::text IS NULL OR j.id = $2 OR j.task_id = $2)
       AND ($3::text IS NULL OR j.project_id = $3)
       AND ($4::timestamptz IS NULL OR j.updated_at >= $4)
       AND ($5::timestamptz IS NULL OR j.updated_at < $5)
       AND ($6::text IS NULL OR linked.request_id = $6)
       AND ($7::text IS NULL OR linked.trace_id = $7)
       AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $6::text IS NOT NULL OR $7::text IS NOT NULL OR j.status = 'failed')` : '';
  const result = await client.query<OperationRow>(`${ownedScope}, operations AS (
    SELECT t.id, t.id AS "taskId", NULL AS "sessionId", t.project_id AS "projectId",
           t.status, t.type AS kind, t.model, t.provider, left(t.error, 2000) AS error,
           t.created_at AS "occurredAt", t.updated_at AS "updatedAt", 'canvas_task' AS source, t.stage,
           t.request_id AS "requestId", t.trace_id AS "traceId", t.provider_request_id AS "providerRequestId"
      FROM tasks t
     WHERE t.user_id = $1
       AND (nullif(t.project_id, '') IS NULL OR t.project_id IN (SELECT id FROM owned_projects)
         OR t.project_id IN (SELECT id FROM owned_canvases))
       AND ($2::text IS NULL OR t.id = $2)
       AND ($3::text IS NULL OR t.project_id = $3 OR t.project_id IN (SELECT id FROM owned_canvases WHERE project_id = $3))
       AND ($4::timestamptz IS NULL OR t.updated_at >= $4)
       AND ($5::timestamptz IS NULL OR t.updated_at < $5)
       AND ($6::text IS NULL OR t.request_id = $6)
       AND ($7::text IS NULL OR t.trace_id = $7)
       AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $6::text IS NOT NULL OR $7::text IS NOT NULL OR t.status IN ('failed', 'expired'))
    ${dramaRows}
  ) SELECT * FROM operations ORDER BY "updatedAt" DESC, id DESC LIMIT 10`, values);
  const taskIds = result.rows.flatMap((row) => row.taskId ? [row.taskId] : []);
  const events = schema.logs && taskIds.length ? await client.query(`${ownedScope}
    SELECT l.task_id AS "taskId", left(l.level, 24) AS level, left(l.message, 2000) AS message,
           l.request_id AS "requestId", l.trace_id AS "traceId", l.created_at AS "occurredAt"
      FROM task_logs l JOIN owned_tasks t ON t.id = l.task_id
     WHERE l.user_id = $1 AND l.task_id = ANY($2::text[])
       AND ($3::timestamptz IS NULL OR l.created_at >= $3)
       AND ($4::timestamptz IS NULL OR l.created_at < $4)
       AND ($5::text IS NULL OR l.request_id = $5)
       AND ($6::text IS NULL OR l.trace_id = $6)
     ORDER BY l.created_at DESC, l.id DESC LIMIT 20`, [userId, taskIds, scope.from, scope.to, scope.requestId ?? null, scope.traceId ?? null]) : { rows: [] };
  const projectIds = [...new Set(result.rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
  if (scope.projectId && !scope.taskId && !scope.requestId && !scope.traceId) projectIds.push(scope.projectId);
  const pipelines = schema.productions && projectIds.length ? await client.query(`${ownedScope}
    SELECT d.project_id AS "projectId", d.status, d.stage, left(d.pause_reason, 2000) AS "pauseReason", d.updated_at AS "updatedAt"
      FROM drama_productions d WHERE d.user_id = $1 AND d.project_id IN (SELECT id FROM owned_projects)
       AND (d.project_id = ANY($2::text[]) OR d.project_id IN (SELECT project_id FROM owned_canvases WHERE id = ANY($2::text[])))
       AND ($3::timestamptz IS NULL OR d.updated_at >= $3)
       AND ($4::timestamptz IS NULL OR d.updated_at < $4)
     ORDER BY d.updated_at DESC, d.project_id DESC LIMIT 10`, [userId, projectIds, scope.from, scope.to]) : { rows: [] };
  return {
    rows: summaryRows(result.rows, events.rows), truncated: result.rows.length >= 10 || events.rows.length >= 20,
    pipelines: pipelines.rows.map((row) => ({ ...row, pauseReason: summarizeSupportOperationError(row.pauseReason) })),
    note: `${evidenceNote(scope)} 多种 ID 条件按 AND 交集查询；最多 10 条操作、20 条事件和 10 条流水线快照，可能截断。 短剧流水线状态（含暂停）仅为快照，不代表故障。${hasDrama ? '' : ' 短剧任务表缺失，未查询该来源。'}${schema.logs ? '' : ' 任务日志表缺失，未查询事件。'}`,
  };
}

export async function queryUserOperations(input: OperationInput): Promise<Record<string, unknown>> {
  const scope = normalizeSupportOperationScope(input);
  const envelope = { system: input.context?.source === 'canvas' ? 'canvas' : 'fg', scope: scope ? supportOperationScope(scope) : null };
  try {
    if (!scope) return { ...envelope, rows: [], error: '用户、上下文或时间范围无效；近期查询默认 24 小时，最大 7 天。' };
    if (input.context?.source !== 'canvas') return { ...envelope, ...await creatorOperations(scope) };
    if (scope.sessionId) return { ...envelope, rows: [], incomplete: true, note: 'Canvas sessionId 暂无可靠业务关联，未扩大到账号范围查询。' };
    if (!process.env.SUPPORT_BOT_CANVAS_DATABASE_URL) return { ...envelope, rows: [], incomplete: true, note: 'Canvas 只读数据源未配置（SUPPORT_BOT_CANVAS_DATABASE_URL），操作数据不可查询。' };
    return { ...envelope, ...await withSupportCanvasReadOnly((client) => canvasOperations(client, scope)) };
  } catch (error) {
    if (input.context?.source === 'canvas' && error && typeof error === 'object' && 'code' in error && ['42P01', '42703'].includes(String(error.code))) {
      return { ...envelope, rows: [], incomplete: true, note: 'Canvas 操作数据表或必要字段不可用，未回退到 FG 主库；这不代表本次反馈的故障原因。' };
    }
    return { ...envelope, rows: [], error: QUERY_FAILED };
  }
}

export async function closeSupportOperationConnections() {
  const pool = canvasPool;
  canvasPool = undefined;
  await pool?.end();
}
