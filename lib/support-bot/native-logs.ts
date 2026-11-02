import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeSupportOperationScope, supportOperationScope, supportOperationErrorEvidence, supportCanvasUser, withSupportCanvasReadOnly } from './operations';
import type { SupportServiceId } from './services';

type Input = { service: SupportServiceId; userId: string; taskId?: string; requestId?: string; traceId?: string; projectId?: string; sessionId?: string; from?: string; to?: string };
type Source = { file?: string; container?: string };
const run = promisify(execFile);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 5000;
const id = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;

function configuredSource(service: SupportServiceId): Source | undefined {
  const config = JSON.parse(process.env.SUPPORT_BOT_NATIVE_LOG_SOURCES || '{}');
  const value = config?.[service];
  if (!value) return undefined;
  if (typeof value !== 'object' || !!value.file === !!value.container) throw new Error('Invalid native log source');
  if (value.file && (typeof value.file !== 'string' || !isAbsolute(value.file) || /[\0\r\n]/.test(value.file))) throw new Error('Invalid log path');
  if (value.container && (typeof value.container !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.container))) throw new Error('Invalid container');
  return value;
}

async function readSource(source: Source, from: string | null, to: string | null) {
  if (source.file) {
    const handle = await open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Not a regular log');
      const offset = Math.max(0, stat.size - MAX_BYTES);
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      if (offset) lines.shift();
      return { lines: lines.slice(-MAX_LINES), truncated: offset > 0 || lines.length > MAX_LINES, transport: 'file' };
    } finally { await handle.close(); }
  }
  // Container names come only from server configuration, never model or request arguments.
  // 容器只允许服务端配置，模型和用户参数均不能控制命令或日志源。
  const args = ['logs', '--timestamps', '--tail', String(MAX_LINES), ...(from ? ['--since', from] : []), ...(to ? ['--until', to] : []), source.container!];
  const { stdout, stderr } = await run('docker', args, { timeout: 5000, maxBuffer: MAX_BYTES, encoding: 'utf8' });
  const lines = `${stdout}\n${stderr}`.split('\n');
  return { lines, truncated: lines.filter(Boolean).length >= MAX_LINES, transport: 'docker' };
}

function parseLine(line: string): Record<string, unknown> | undefined {
  if (line.length > 64 * 1024) return undefined;
  const text = line.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+/, '');
  try {
    const parsed = JSON.parse(text);
    // Docker json-file envelopes may wrap a native JSON log; do not parse arbitrary prose.
    // Docker json-file可包裹原生日志，只解析结构化JSON，不从任意文本猜字段。
    return typeof parsed?.log === 'string' ? JSON.parse(parsed.log) : parsed;
  } catch { return undefined; }
}

export async function queryNativeSupportLogs(input: Input): Promise<Record<string, unknown>> {
  const scope = normalizeSupportOperationScope(input);
  const envelope = { system: input.service, rows: [] as Record<string, unknown>[], scope: scope ? supportOperationScope(scope) : {},
    coverage: { inboundHttp: { available: false } }, incomplete: true, truncated: false };
  if (!scope) return { ...envelope, note: '原生日志查询身份、编号或时间范围无效，未执行。' };
  if (scope.projectId) return { ...envelope, note: '原生HTTP/Agent日志未记录已校验的项目归属，不支持项目筛选；未忽略此条件或扩大范围。可使用本人请求编号或时间范围查询。' };
  try {
    const source = configuredSource(input.service);
    if (!source) return { ...envelope, note: `${input.service} 未配置原生 JSON 日志源 SUPPORT_BOT_NATIVE_LOG_SOURCES；未回退其他服务日志。` };
    let owner = input.userId;
    if (input.service === 'canvas' || input.service === 'yingce-agent') {
      const mapped = await withSupportCanvasReadOnly(client => supportCanvasUser(client, input.userId));
      if (!mapped) return { ...envelope, note: '未找到 active 原生账号映射，未读取或扩大日志范围。' };
      owner = mapped;
    }
    const data = await readSource(source, scope.from, scope.to);
    let recognized = 0;
    let legacy = 0;
    const rows: Record<string, unknown>[] = [];
    for (const line of data.lines) {
      const record = parseLine(line);
      if (!record || typeof record !== 'object') continue;
      if (record.service !== input.service || !['support_http_request', 'support_agent_run'].includes(String(record.event))) continue;
      recognized++;
      const actor = input.service === 'canvas' || input.service === 'yingce-agent' ? record.user_id : record.fg_user_id;
      if (!id(actor)) { legacy++; continue; }
      if (actor !== owner) continue;
      const occurredAt = typeof record.time === 'string' ? record.time : record.timestamp;
      const time = typeof occurredAt === 'string' ? Date.parse(occurredAt) : NaN;
      if (!Number.isFinite(time) || (scope.from && time < Date.parse(scope.from)) || (scope.to && time >= Date.parse(scope.to))) continue;
      const taskId = id(record.task_id), requestId = id(record.request_id), traceId = id(record.trace_id), projectId = id(record.project_id);
      if ((scope.taskId && scope.taskId !== taskId) || (scope.requestId && scope.requestId !== requestId) || (scope.traceId && scope.traceId !== traceId) || (scope.projectId && scope.projectId !== projectId)) continue;
      if (scope.sessionId && scope.sessionId !== id(record.session_id)) continue;
      const error = supportOperationErrorEvidence(record.error || record.error_code);
      const route = typeof record.route === 'string' ? record.route : record.path;
      rows.push({ id: `native:${input.service}:${createHash('sha256').update(line).digest('hex').slice(0, 24)}`,
        source: `${input.service}_native`, occurredAt: new Date(time).toISOString(), taskId, requestId, traceId, projectId,
        buildCommit: typeof record.build_commit === 'string' && /^[a-f0-9]{7,40}$/i.test(record.build_commit) ? record.build_commit.toLowerCase() : undefined,
        buildVersion: typeof record.build_version === 'string' && /^[\w.+-]{1,100}$/.test(record.build_version) ? record.build_version : undefined,
        buildDirty: typeof record.build_dirty === 'boolean' ? record.build_dirty : undefined,
        runId: id(record.run_id), sessionId: id(record.session_id),
        event: record.event, method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(String(record.method)) ? record.method : undefined,
        errorCode: id(record.error_code),
        route: typeof route === 'string' && /^\/[A-Za-z0-9/_:.*-]*$/.test(route) ? route.slice(0, 250) : undefined,
        httpStatus: Number.isInteger(record.status) && Number(record.status) >= 100 && Number(record.status) <= 599 ? record.status : undefined,
        status: ['failed', 'completed', 'cancelled'].includes(String(record.outcome)) ? record.outcome : undefined,
        level: ['debug', 'info', 'warn', 'error', 'fatal'].includes(String(record.level).toLowerCase()) ? String(record.level).toLowerCase() : undefined,
        ...(error.summary ? { error: error.summary } : {}), ...(error.errorExcerpt ? { errorExcerpt: error.errorExcerpt } : {}) });
    }
    const sorted = [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    return { ...envelope, rows: sorted.slice(0, 100), incomplete: recognized === 0, truncated: data.truncated || sorted.length > 100,
      coverage: { inboundHttp: { available: recognized > 0 }, source: data.transport, formatVerified: recognized > 0, unownedRecordsIgnored: legacy > 0 },
      note: recognized ? `已读取 ${input.service} 自身结构化日志，仅返回受信鉴权身份匹配的记录。最多读取2MiB或5000行，返回100条；轮转、采集级别或截断可能缺失历史，未提供请求/响应正文。${input.service === 'canvas' ? 'Canvas成功GET等请求只在debug级别采集；未查到不能证明未发生。' : ''}` : '日志源可读，但未发现带服务标识的新格式原生日志；历史未采集记录不能补回，未把普通输出猜成请求证据。' };
  } catch { return { ...envelope, note: `${input.service} 原生日志源配置、只读连接或读取失败；未返回路径、连接凭据或原始进程输出。` }; }
}
