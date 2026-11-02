import type { PoolClient } from 'pg';
import {
  normalizeSupportOperationScope,
  supportCanvasUser,
  supportOperationErrorEvidence,
  supportOperationScope,
  SUPPORT_CANVAS_OWNED_SCOPE,
  withSupportCanvasReadOnly,
  type SupportOperationScope,
} from './operations';
import { redactSupportText } from './redact';

export type GatewayOperationInput = {
  userId: string;
  service?: string;
  projectId?: string;
  taskId?: string;
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
};

type Coverage = {
  table: string;
  status: 'queried' | 'unavailable' | 'unsupported_filter' | 'not_queried';
  note: string;
};
type GatewayRow = {
  source: string;
  id: string | null;
  taskId: string | null;
  projectId: string | null;
  status: string | null;
  taskStatus: string | null;
  operationId: string | null;
  reservationId: string | null;
  resourceId: string | null;
  clipId: string | null;
  workspaceId: string | null;
  dramaId: string | null;
  requestId: string | null;
  occurredAt: string | null;
  updatedAt: string | null;
  error: string | null;
  errorExcerpt?: string;
};
export type GatewayOperationsResult = {
  rows: GatewayRow[];
  scope: (ReturnType<typeof supportOperationScope> & { service: string }) | null;
  coverage: Coverage[];
  incomplete: boolean;
  truncated: boolean;
  note: string;
};
type Requirements = Record<string, string>;
type Source = {
  table: string;
  requirements: Requirements;
  from: string;
  owner: string;
  id: string;
  task?: string;
  project?: string;
  projectAliases?: string[];
  status?: string;
  taskStatus?: string;
  error?: string;
  created: string;
  updated?: string;
  identifiers?: Partial<Record<'operationId' | 'reservationId' | 'resourceId' | 'clipId' | 'workspaceId' | 'dramaId' | 'requestId', string>>;
  provider?: 'suno' | 'volcengine';
  model?: string;
  note: string;
};

const LIMIT = 30;
const SERVICES = ['yingce-gateway', 'suno', 'volcengine'];
const SPEECH_MODELS = ['seed-audio-1.0', 'seed-tts-2.0', 'volc.seedasr.auc', 'volc.speech.mt', 'volc.seedasr.sauc.duration'];
const OWNED: Requirements = {
  projects: 'id user_id fg_deleted_at',
  canvas_projects: 'id user_id project_id deleted_at',
  tasks: 'id user_id project_id',
};
const RESERVATIONS: Requirements = { ...OWNED, fg_budget_reservations: 'id user_id project_id task_id' };
const ownedProject = (column: string) => `(nullif(${column}, '') IS NULL OR ${column} IN (SELECT id FROM owned_projects) OR ${column} IN (SELECT id FROM owned_canvases))`;
const ownedTask = (column: string) => `(nullif(${column}, '') IS NULL OR ${column} IN (SELECT id FROM owned_tasks))`;
const ownedReservation = `r.user_id = $1 AND ${ownedProject('r.project_id')} AND ${ownedTask('r.task_id')}`;

// Gateway uses the Canvas database, but server.mjs creates users/fg_accounts from the authenticated FG UUID.
// Gateway 使用 Canvas 数据库，但 server.mjs 按已认证的 FG UUID 建立 users/fg_accounts，必须先验证 active 映射。
const SOURCES: Source[] = [
  {
    table: 'fg_music_jobs', requirements: { fg_music_jobs: 'id owner_id operation_id status clip_id resource_id created_at updated_at' },
    from: 'fg_music_jobs j', owner: 'j.owner_id = $1', id: 'j.id', task: 'j.id::text', status: 'j.status',
    created: 'j.created_at', updated: 'j.updated_at', provider: 'suno',
    identifiers: { operationId: 'j.operation_id', clipId: 'j.clip_id', resourceId: 'j.resource_id' },
    note: '音乐队列仅查 owner_id，不复用 reviewer 权限；无 project/request/trace/error 字段，不读取 brief。',
  },
  {
    table: 'fg_speech_jobs', requirements: { ...RESERVATIONS, fg_speech_jobs: 'id owner_id operation_id reservation_id resource_id status error_code created_at updated_at' },
    from: 'fg_speech_jobs j LEFT JOIN fg_budget_reservations r ON r.id = j.reservation_id',
    owner: `j.owner_id = $1 AND (j.reservation_id IS NULL OR (${ownedReservation}))`,
    id: 'j.id', task: 'j.id::text', project: 'r.project_id', status: 'j.status', error: 'j.error_code',
    created: 'j.created_at', updated: 'j.updated_at', provider: 'volcengine',
    identifiers: { operationId: 'j.operation_id', reservationId: 'j.reservation_id', resourceId: 'j.resource_id' },
    note: '异步转写、翻译、流式语音；仅本人任务且关联预算/项目/原生任务亦属本人。不读取 result；job.id 是供应商调用编号，不冒充 gateway request/trace。',
  },
  {
    table: 'fg_speech_usage', requirements: { ...RESERVATIONS, fg_speech_usage: 'reservation_id request_id model status error_code created_at' },
    from: 'fg_speech_usage u JOIN fg_budget_reservations r ON r.id = u.reservation_id',
    owner: ownedReservation, id: 'u.reservation_id', task: 'r.task_id', project: 'r.project_id', status: 'u.status', error: 'u.error_code',
    created: 'u.created_at', model: 'u.model', identifiers: { reservationId: 'u.reservation_id', requestId: 'u.request_id' },
    note: '语音合成、流式语音及 Suno 音频调用回执；requestId 仅精确匹配实际 request_id。不读取 usage，表无 updated_at。',
  },
  {
    table: 'fg_creator_jobs', requirements: { ...OWNED, tasks: `${OWNED.tasks} model status`, fg_creator_jobs: 'id owner_id task_id status created_at' },
    from: 'fg_creator_jobs j LEFT JOIN tasks t ON t.id = j.task_id',
    owner: `j.owner_id = $1 AND ${ownedTask('j.task_id')}`, id: 'j.id', task: 'j.task_id', project: 't.project_id',
    status: 'j.status', taskStatus: 't.status', created: 'j.created_at', model: 't.model',
    note: 'Creator/Arcreel 共用的持久化提交记录；仅通过实际 task_id 关联本人任务/项目，未绑定任务不猜工作区。status 是提交状态，taskStatus 为关联任务快照；无 updated_at。',
  },
  {
    table: 'fg_adcraft_jobs', requirements: {
      ...OWNED, tasks: `${OWNED.tasks} model status`, fg_adcraft_jobs: 'id workspace_id actor_id task_id status error created_at',
      fg_adcraft_workspaces: 'id owner_id native_project_id',
    },
    from: 'fg_adcraft_jobs j JOIN fg_adcraft_workspaces w ON w.id = j.workspace_id LEFT JOIN tasks t ON t.id = j.task_id',
    owner: `j.actor_id = $1 AND w.owner_id = $1 AND w.native_project_id IN (SELECT id FROM owned_projects)
      AND ${ownedTask('j.task_id')} AND (j.task_id IS NULL OR t.project_id = w.native_project_id)`,
    id: 'j.id', task: 'j.task_id', project: 'w.native_project_id', projectAliases: ['w.id::text'], status: 'j.status',
    taskStatus: 't.status', error: 'j.error', created: 'j.created_at', model: 't.model', identifiers: { workspaceId: 'w.id' },
    note: '广告提交记录同时要求 actor、workspace owner 和 native project 属于本人；projectId 可为 workspace UUID 或 native project ID。无 updated_at，status 非执行终态。',
  },
  {
    table: 'fg_meilin_calls', requirements: {
      ...OWNED, tasks: `${OWNED.tasks} model status`, fg_meilin_calls: 'operation_id actor_id drama_id task_id created_at',
      fg_meilin_projects: 'drama_id owner_id native_project_id',
    },
    from: 'fg_meilin_calls j JOIN fg_meilin_projects w ON w.drama_id = j.drama_id AND w.owner_id = j.actor_id LEFT JOIN tasks t ON t.id = j.task_id',
    owner: `j.actor_id = $1 AND w.native_project_id IN (SELECT id FROM owned_projects)
      AND ${ownedTask('j.task_id')} AND (j.task_id IS NULL OR t.project_id = w.native_project_id)`,
    id: 'j.operation_id', task: 'j.task_id', project: 'w.native_project_id', projectAliases: ['j.drama_id::text'],
    taskStatus: 't.status', created: 'j.created_at', model: 't.model', identifiers: { operationId: 'j.operation_id', dramaId: 'j.drama_id' },
    note: '美林 gateway 登记记录，仅本人 actor 和本人映射项目；projectId 可为 drama UUID 或 native project ID。不读取 metadata；无 status/error/updated_at，taskStatus 仅为关联任务快照。',
  },
  {
    table: 'fg_budget_reservations', requirements: { ...RESERVATIONS, fg_budget_reservations: `${RESERVATIONS.fg_budget_reservations} model created_at` },
    from: 'fg_budget_reservations r', owner: ownedReservation, id: 'r.id', task: 'r.task_id', project: 'r.project_id',
    created: 'r.created_at', model: 'r.model', identifiers: { reservationId: 'r.id' },
    note: '预算预留不是执行结果，无 status/error/updated_at；只返回关联编号与创建时间，不读取金额或推断是否已收费。',
  },
];

function sourceQuery(source: Source, service: string): string {
  const text = (expression?: string) => expression ? `(${expression})::text` : 'NULL::text';
  const columns = {
    source: `'${source.table}'`, id: text(source.id), taskId: text(source.task), projectId: text(source.project),
    status: text(source.status), taskStatus: text(source.taskStatus),
    ...Object.fromEntries(['operationId', 'reservationId', 'resourceId', 'clipId', 'workspaceId', 'dramaId', 'requestId']
      .map((key) => [key, text(source.identifiers?.[key as keyof NonNullable<Source['identifiers']>])])),
    error: source.error ? `left(${source.error}, 2000)` : 'NULL::text',
    occurredAt: source.created, updatedAt: source.updated ?? 'NULL::timestamptz',
  };
  const projects = source.project ? [source.project, ...(source.projectAliases ?? [])] : [];
  const projectFilter = projects.length ? projects.map((expression) => `${expression} = $3`).join(' OR ') : 'FALSE';
  const providerFilter = service === 'yingce-gateway' || source.provider ? 'TRUE'
    : service === 'suno' ? `${source.model} = 'suno-company-music'`
      : `${source.model} IN (${SPEECH_MODELS.map((model) => `'${model}'`).join(', ')})`;
  const time = source.updated ?? source.created;
  return `(SELECT ${Object.entries(columns).map(([key, value]) => `${value} AS "${key}"`).join(', ')}
    FROM ${source.from} WHERE ${source.owner}
      AND ($2::text IS NULL OR ${text(source.id)} = $2${source.task ? ` OR ${text(source.task)} = $2` : ''})
      AND ($3::text IS NULL OR ${projectFilter}${source.project ? ` OR ${source.project} IN (SELECT id FROM owned_canvases WHERE project_id = $3)` : ''})
      AND ($4::timestamptz IS NULL OR ${time} >= $4)
      AND ($5::timestamptz IS NULL OR ${time} < $5)
      AND ($6::text IS NULL OR ${text(source.identifiers?.requestId)} = $6)
      AND ${providerFilter}
    ORDER BY ${time} DESC, ${source.id} DESC LIMIT ${LIMIT + 1})`;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) && redactSupportText(value) === value ? value : null;
}
function safeStatus(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}
function timestamp(value: unknown): string | null {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function safeRow(row: Record<string, unknown>): GatewayRow {
  const evidence = supportOperationErrorEvidence(row.error);
  return {
    source: String(row.source), id: safeIdentifier(row.id), taskId: safeIdentifier(row.taskId), projectId: safeIdentifier(row.projectId),
    status: safeStatus(row.status), taskStatus: safeStatus(row.taskStatus), operationId: safeIdentifier(row.operationId),
    reservationId: safeIdentifier(row.reservationId), resourceId: safeIdentifier(row.resourceId), clipId: safeIdentifier(row.clipId),
    workspaceId: safeIdentifier(row.workspaceId), dramaId: safeIdentifier(row.dramaId), requestId: safeIdentifier(row.requestId),
    occurredAt: timestamp(row.occurredAt), updatedAt: timestamp(row.updatedAt), error: evidence.summary,
    ...(evidence.errorExcerpt ? { errorExcerpt: evidence.errorExcerpt } : {}),
  };
}

async function readOperations(client: PoolClient, scope: SupportOperationScope, service: string, sources: Source[]): Promise<Pick<GatewayOperationsResult, 'rows' | 'coverage' | 'incomplete' | 'truncated' | 'note'>> {
  const tables = [...new Set(['users', 'fg_accounts', ...sources.flatMap((source) => Object.keys(source.requirements))])];
  const schema = await client.query<{ table_name: string; column_name: string }>(`
    SELECT wanted.table_name, a.attname AS column_name
      FROM unnest($1::text[]) AS wanted(table_name)
      JOIN pg_attribute a ON a.attrelid = to_regclass(wanted.table_name) AND a.attnum > 0 AND NOT a.attisdropped`, [tables]);
  const columns = new Map<string, Set<string>>();
  for (const row of schema.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name)!.add(row.column_name);
  }
  const missing = (requirements: Requirements) => Object.entries(requirements).flatMap(([table, fields]) =>
    fields.split(' ').filter((column) => !columns.get(table)?.has(column)).map((column) => `${table}.${column}`));
  const identityMissing = missing({ users: 'id status', fg_accounts: 'user_id' });
  const userId = identityMissing.length ? null : await supportCanvasUser(client, scope.userId);
  if (!userId) {
    const note = identityMissing.length ? `身份映射表/字段不可用：${identityMissing.join(', ')}。`
      : '未找到当前 FG 用户的 active 受信账号映射，不按相同 UUID 推断身份。';
    return { rows: [], incomplete: true, truncated: false, coverage: sources.map((source) => ({ table: source.table, status: 'unavailable', note })), note };
  }
  const available: Source[] = [];
  const coverage: Coverage[] = sources.map((source) => {
    const unsupported = [scope.projectId && !source.project ? 'projectId' : '', scope.requestId && !source.identifiers?.requestId ? 'requestId' : ''].filter(Boolean);
    if (unsupported.length) return { table: source.table, status: 'unsupported_filter', note: `${unsupported.join('/')} 无可靠关联，未忽略条件或查询该表。 ${source.note}` };
    const absent = missing(source.requirements);
    if (absent.length) return { table: source.table, status: 'unavailable', note: `缺表或必要字段：${absent.join(', ')}。 ${source.note}` };
    available.push(source);
    return { table: source.table, status: 'queried', note: source.note };
  });
  const needsOwnedScope = available.some((source) => source.requirements.projects);
  const values = [userId, scope.taskId ?? null, scope.projectId ?? null, scope.from, scope.to, scope.requestId ?? null];
  const result = available.length ? await client.query(`
    ${needsOwnedScope ? `${SUPPORT_CANVAS_OWNED_SCOPE},` : 'WITH'} gateway_operations AS (
      ${available.map((source) => sourceQuery(source, service)).join('\nUNION ALL\n')}
    ) SELECT * FROM gateway_operations ORDER BY coalesce("updatedAt", "occurredAt") DESC, source, id DESC LIMIT ${LIMIT + 1}`, values) : { rows: [] };
  return {
    rows: result.rows.slice(0, LIMIT).map(safeRow), coverage, incomplete: coverage.some((item) => item.status !== 'queried'),
    truncated: result.rows.length > LIMIT,
    note: '仅查询 gateway 持久化记录，不独立列举 Canvas tasks；任务表仅核验本人归属/已存关联及任务状态。所有指定 ID 和时间条件取 AND 交集，taskId 精确匹配记录主键或其 task_id。时间按该表 updated_at（无此列则 created_at），默认近 24 小时，最多 7 天；有精确编号且未传时间则不限时间。缺少项目关联的记录不按项目推断；供应商筛选仅依据已核实的固定渠道或模型，未绑定模型的提交不推断供应商。预算、提交状态和关联任务状态不等同执行终态；近期记录不代表反馈根因。最多 30 条，多表可能出现同一操作的不同阶段。',
  };
}

export async function queryGatewayOperations(input: GatewayOperationInput): Promise<GatewayOperationsResult> {
  // Validate times first: the shared identifier-only normalizer intentionally skips its time parser.
  // 先验证时间类型：共用规范化函数的纯编号分支会跳过时间解析，不能静默丢掉无效筛选。
  const validTimes = [input.from, input.to].every((value) => value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value))));
  const service = input.service ?? 'yingce-gateway';
  const scope = validTimes ? normalizeSupportOperationScope(input) : null;
  const envelope: GatewayOperationsResult = {
    rows: [], scope: scope ? { ...supportOperationScope(scope), service: SERVICES.includes(service) ? service : '[unsupported]' } : null,
    coverage: [], incomplete: true, truncated: false, note: '',
  };
  if (!scope) return { ...envelope, note: '用户、编号或时间范围无效；未查询。近期默认 24 小时，时间窗口最多 7 天。' };
  if (!SERVICES.includes(service)) return { ...envelope, note: '不支持的 service；仅支持 yingce-gateway/suno/volcengine，未忽略筛选或扩大查询。' };
  const sources = SOURCES.filter((source) => service === 'yingce-gateway' || !source.provider || source.provider === service);
  const notQueried = (note: string): GatewayOperationsResult => ({ ...envelope, note, coverage: sources.map((source) => ({ table: source.table, status: 'not_queried', note })) });
  if (scope.traceId) return notQueried('这些 gateway 表没有已核实的 traceId 关联；未忽略 traceId，也未扫描账号记录或关联其他任务。');
  if (scope.sessionId) return notQueried('这些 gateway 表没有已核实的 sessionId 关联；未忽略 sessionId，也未扩大到账号范围查询。');
  if (!process.env.SUPPORT_BOT_CANVAS_DATABASE_URL) return notQueried('未配置 SUPPORT_BOT_CANVAS_DATABASE_URL，gateway 操作数据不可查询；未回退 FG 主库。');
  try {
    return { ...envelope, ...await withSupportCanvasReadOnly((client) => readOperations(client, scope, service, sources)) };
  } catch (error) {
    const schemaError = error && typeof error === 'object' && 'code' in error && ['42P01', '42703'].includes(String(error.code));
    return notQueried(schemaError
      ? 'gateway 表或必要字段不可用，未回退 FG 主库或猜测关联。'
      : 'gateway 只读查询暂时失败，未返回连接信息或原始错误；查询失败不代表反馈故障原因。');
  }
}
