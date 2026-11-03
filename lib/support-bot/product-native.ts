import { assertSupportTarget, supportRuntimeEnvironment, SupportEnvironmentError } from './environment';
import { supportCanvasUser, withSupportCanvasReadOnly, supportOperationErrorEvidence } from './operations';
import { scrubSupportValue } from './redact';
import type { SupportServiceId } from './services';

const PRODUCTS = ['arcreel', 'opencreator', 'adcraft', 'meilin', 'suno'] as const;
export type NativeProduct = typeof PRODUCTS[number];
export function isNativeProduct(service: SupportServiceId): service is NativeProduct {
  return (PRODUCTS as readonly string[]).includes(service);
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const DAY = 86_400_000;
type Filters = { sessionId?: string; from?: string; to?: string; taskId?: string; requestId?: string; traceId?: string; projectId?: string };
type Payload = Record<string, unknown> & { service: string; build: Record<string, unknown>; scope?: Record<string, unknown> };

class ProductSourceError extends Error {}
function fail(reason: string): never { throw new ProductSourceError(reason); }
function range(input: Filters) {
  const end = input.to === undefined ? new Date() : new Date(input.to);
  const start = input.from === undefined ? new Date(end.getTime() - DAY) : new Date(input.from);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 7 * DAY) fail('native_product_time_range_invalid');
  return { start: start.toISOString(), end: end.toISOString() };
}

// The caller supplies an authenticated FG identity, never a destination, capability or instance name.
// 调用方只传服务端认证的 FG 身份；目标、凭据与实例映射均不能由工单或模型控制。
export async function readProductEndpoint(service: NativeProduct, kind: 'evidence' | 'version', userId?: string, filters: Filters = {}): Promise<Payload> {
  if (!userId || !UUID.test(userId)) fail('native_product_authenticated_actor_required');
  if (filters.sessionId !== undefined) fail('native_product_session_filter_unsupported');
  const base = process.env.SUPPORT_BOT_NATIVE_GATEWAY_URL;
  const token = process.env.SUPPORT_BOT_NATIVE_READ_TOKEN;
  if (!base || !token || token.length < 32) fail('native_product_relay_not_configured');
  const url = assertSupportTarget(base, 'runtime');
  if (url.pathname !== '/' && url.pathname !== '') fail('native_product_relay_url_invalid');
  const actorId = await withSupportCanvasReadOnly(client => supportCanvasUser(client, userId));
  if (!actorId) fail('native_product_active_actor_mapping_missing');
  url.pathname = `/internal/support/${service}/${kind}`;
  url.searchParams.set('actorId', actorId);
  const selectedRange = kind === 'evidence' ? range(filters) : undefined;
  if (selectedRange) for (const [key, value] of Object.entries(selectedRange)) url.searchParams.set(key, value);
  for (const key of ['taskId', 'requestId', 'traceId', 'projectId'] as const) {
    if (filters[key] === undefined) continue;
    if (!ID.test(filters[key]!)) fail('native_product_identifier_invalid');
    url.searchParams.set(key, filters[key]!);
  }
  if (kind === 'evidence') url.searchParams.set('limit', '50');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: controller.signal });
    const limit = kind === 'version' ? 16 * 1024 : 512 * 1024;
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      fail(response.status === 403 ? 'native_product_access_denied' : response.status === 503 ? 'native_product_instance_or_source_unavailable' : 'native_product_endpoint_unavailable');
    }
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); fail('native_product_response_too_large'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); fail('native_product_response_too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || data.service !== service || !data.build || data.build.environment !== supportRuntimeEnvironment()) fail('native_product_service_or_environment_mismatch');
    if (kind === 'evidence') {
      if (data.scope?.actorId !== actorId || !Array.isArray(data.records) || !Array.isArray(data.logs)
        || data.records.length > 50 || data.logs.length > 50 || typeof data.incomplete !== 'boolean' || typeof data.truncated !== 'boolean'
        || Date.parse(data.scope.start) !== Date.parse(selectedRange!.start) || Date.parse(data.scope.end) !== Date.parse(selectedRange!.end)) fail('native_product_scope_or_contract_mismatch');
      for (const key of ['taskId', 'requestId', 'traceId', 'projectId'] as const) {
        if (data.scope[key] !== filters[key]) fail('native_product_filter_contract_mismatch');
      }
    }
    if (kind === 'version' && ['arcreel', 'opencreator'].includes(service) && (data.actorId ?? data.scope?.actorId) !== actorId) fail('native_product_instance_mismatch');
    return data;
  } catch (error) {
    if (error instanceof ProductSourceError || error instanceof SupportEnvironmentError) throw error;
    fail(controller.signal.aborted ? 'native_product_request_timeout' : 'native_product_request_failed');
  } finally { clearTimeout(timer); }
}

function sourceFailure(error: unknown) {
  return error instanceof ProductSourceError || error instanceof SupportEnvironmentError ? error.message : 'native_product_mapping_or_query_failed';
}
function fixedText(value: unknown, limit = 120) { return typeof value === 'string' ? String(scrubSupportValue(value)).slice(0, limit) : undefined; }
function timestamp(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function rowProjection(value: unknown, service: NativeProduct, log: boolean, scope: Record<string, unknown>): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (log && (row.service !== service || row.actor_id !== scope.actorId || row.build_environment !== supportRuntimeEnvironment() || row.event !== 'support_http_request')) return null;
  const nativeId = row.id ?? row.request_id ?? row.requestId;
  if (typeof nativeId !== 'string' || !ID.test(nativeId)) return null;
  for (const [camel, snake] of [['taskId', 'task_id'], ['requestId', 'request_id'], ['traceId', 'trace_id'], ['projectId', 'project_id']]) {
    for (const key of [camel, snake]) if (row[key] != null && (typeof row[key] !== 'string' || !ID.test(row[key] as string))) return null;
    if (row[camel] != null && row[snake] != null && row[camel] !== row[snake]) return null;
  }
  if (log) {
    const status = row.http_status ?? row.status_code ?? row.status;
    if (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599
      || typeof (row.request_id ?? row.requestId) !== 'string'
      || typeof row.method !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(row.method)
      || typeof (row.route ?? row.path) !== 'string' || !/^\/[^?\x00-\x20]{0,199}$/.test(String(row.route ?? row.path))
      || typeof row.build_commit !== 'string' || !/^[a-f0-9]{7,40}$/i.test(row.build_commit)
      || typeof row.build_dirty !== 'boolean') return null;
    if (row.build_version != null && (typeof row.build_version !== 'string' || !/^[a-zA-Z0-9_.+-]{1,80}$/.test(row.build_version))) return null;
    if (row.build_time != null && !timestamp(row.build_time)) return null;
  }
  const id = nativeId;
  const inRange = (value: string | undefined) => !!value && Date.parse(value) >= Date.parse(String(scope.start)) && Date.parse(value) <= Date.parse(String(scope.end));
  const occurredAt = (log ? [timestamp(row.timestamp)] : [timestamp(row.updatedAt), timestamp(row.createdAt)]).find(inRange);
  if (!id || !occurredAt) return null;
  const identifiers = {
    taskId: fixedText(row.taskId ?? row.task_id ?? (!log && ['task', 'run', 'job', 'operation', 'generation'].includes(String(row.kind)) ? row.id : undefined)),
    projectId: fixedText(row.projectId ?? row.project_id), requestId: fixedText(row.requestId ?? row.request_id), traceId: fixedText(row.traceId ?? row.trace_id),
  };
  if (Object.entries(identifiers).some(([key, value]) => scope[key] !== undefined && value !== scope[key])) return null;
  const suppliedCode = row.errorCode ?? row.error_code;
  const code = typeof suppliedCode === 'string' && /^[A-Z][A-Z0-9_]{7,119}$/.test(suppliedCode) ? suppliedCode : undefined;
  const excerpt = supportOperationErrorEvidence(row.errorExcerpt).errorExcerpt;
  return { id: `${service}:${log ? 'http' : 'operation'}:${id}`, system: service, source: `${service}_native`,
    kind: fixedText(log ? row.event : row.kind), status: fixedText(row.status), occurredAt,
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    ...identifiers,
    httpStatus: log && Number.isInteger(row.http_status ?? row.status_code ?? row.status) ? Number(row.http_status ?? row.status_code ?? row.status) : undefined,
    method: log ? fixedText(row.method, 12) : undefined, route: log ? fixedText(row.route ?? row.path, 200) : undefined,
    buildCommit: log ? fixedText(row.build_commit) : undefined, buildEnvironment: log ? fixedText(row.build_environment, 20) : undefined,
    buildDirty: log && typeof row.build_dirty === 'boolean' ? row.build_dirty : undefined,
    errorCode: code,
    ...(excerpt ? { errorExcerpt: excerpt } : {}),
  };
}

function projectBuild(build: Record<string, unknown>) {
  return {
    commit: typeof build.commit === 'string' && /^[a-f0-9]{7,40}$/i.test(build.commit) ? build.commit : undefined,
    version: typeof build.version === 'string' && /^[a-zA-Z0-9_.+-]{1,80}$/.test(build.version) ? build.version : undefined,
    environment: ['development', 'production'].includes(String(build.environment)) ? build.environment : undefined,
    buildTime: timestamp(build.buildTime), dirty: typeof build.dirty === 'boolean' ? build.dirty : undefined,
  };
}
function projectCoverage(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const parts = Object.fromEntries(['operations', 'inboundHttp'].map(key => {
    const part = input[key] && typeof input[key] === 'object' ? input[key] as Record<string, unknown> : {};
    const counters = Object.fromEntries(['scanLimit', 'byteLimit', 'bytesRead', 'scanned', 'legacyUnownedExcluded', 'unreadableFiles', 'linesRead'].flatMap(name =>
      Number.isSafeInteger(part[name]) && Number(part[name]) >= 0 ? [[name, part[name]]] : []));
    return [key, { available: part.available === true, ...counters, availableSince: timestamp(part.availableSince),
      historyComplete: typeof part.historyComplete === 'boolean' ? part.historyComplete : undefined,
      hasCoverageWarning: !!part.reason, scanTruncated: part.scanTruncated === true }];
  }));
  const correlation = input.recordCorrelation && typeof input.recordCorrelation === 'object' ? input.recordCorrelation as Record<string, unknown> : {};
  const recordCorrelation = Object.fromEntries(['taskId', 'requestId', 'traceId', 'projectId'].flatMap(key =>
    typeof correlation[key] === 'boolean' ? [[key, correlation[key]]] : []));
  return { ...parts, ...(Object.keys(recordCorrelation).length ? { recordCorrelation } : {}) };
}

export async function queryProductNative(input: Filters & { service: NativeProduct; userId: string }, kind: 'operations' | 'logs') {
  try {
    const data = await readProductEndpoint(input.service, 'evidence', input.userId, input);
    const selectedRange = data.scope!;
    const raw = (kind === 'logs' ? data.logs : data.records) as unknown[];
    const rows = raw.slice(0, 100).flatMap(row => { const safe = rowProjection(row, input.service, kind === 'logs', data.scope!); return safe ? [safe] : []; });
    // Never conceal a malformed response by presenting its remaining rows as complete evidence.
    // 不能静默丢弃异常记录后把剩余结果宣称为完整证据。
    const malformed = rows.length !== Math.min(raw.length, 100);
    return { system: input.service, rows, scope: { service: input.service, actorVerified: true, from: selectedRange.start, to: selectedRange.end,
      taskId: input.taskId, requestId: input.requestId, traceId: input.traceId, projectId: input.projectId },
      runtime: projectBuild(data.build), coverage: projectCoverage(data.coverage),
      incomplete: malformed || data.incomplete === true, truncated: raw.length > 100 || data.truncated === true,
      note: '来自目标产品原生只读接口，已核验 active 账号与实例范围。仅覆盖指定时间及该接口公开的持久化/原生日志，不能把网关回执或没有记录当成本次故障结论。' };
  } catch (error) {
    return { system: input.service, rows: [], incomplete: true, truncated: false, reason: sourceFailure(error),
      note: '目标产品原生数据未取得，不回退其他产品冒充；仍可查询源码回答功能问题。' };
  }
}

export async function probeProductNative(service: NativeProduct, userId?: string, filters: Filters = {}) {
  try {
    const data = await readProductEndpoint(service, 'evidence', userId, filters);
    const coverage = data.coverage as { operations?: { available?: boolean }; inboundHttp?: { available?: boolean } } | undefined;
    const records = data.records as unknown[], logs = data.logs as unknown[];
    const valid = records.every(row => rowProjection(row, service, false, data.scope!)) && logs.every(row => rowProjection(row, service, true, data.scope!));
    const complete = valid && data.incomplete === false && data.truncated === false
      && coverage?.operations?.available === true && coverage?.inboundHttp?.available === true && logs.length > 0;
    return { ready: complete, reason: !complete ? 'native_product_partial_coverage' : 'native_product_contract_and_actor_verified',
      recordCount: (data.records as unknown[]).length, logCount: (data.logs as unknown[]).length, evidenceIncomplete: data.incomplete === true, truncated: data.truncated === true, scope: { from: data.scope?.start, to: data.scope?.end },
      coverage: projectCoverage(data.coverage), note: '接口与归属预检不等同真实业务闭环验收。' };
  } catch (error) { return { ready: false, reason: sourceFailure(error) }; }
}
