import { assertSupportPrimaryEnvironment } from './environment';
import { queryLogExplorer, getLogDetail } from '@/lib/observability/log-query';
import { searchSupportCode } from './code-search';
import { queryUserOperations, supportOperationErrorEvidence } from './operations';
import { queryCanvasAssets } from './canvas-assets';
import { queryCanvasGeneration } from './generation';
import { queryCanvasSupportLogs } from './canvas-logs';
import { traceSupportChain, type ChainSeed } from './chain';
import type { InvestigationScope } from './investigation-scope';
import { scrubSupportValue } from './redact';
import type { SupportJob } from './store';
import type { SupportCodeSource } from './runtime';
import { serviceForCodePath, supportInvestigationServiceId, supportServices } from './services';
import { queryProductionLabOperations } from './production-operations';
import { queryGatewayOperations } from './gateway-operations';
import { queryNativeSupportLogs } from './native-logs';
import { isNativeProduct, queryProductNative } from './product-native';

const idPattern = /^[A-Za-z0-9_.:-]{1,120}$/;
export function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && idPattern.test(value) ? value : undefined;
}
export function hasIdentifier(text: string, id: string) {
  return new RegExp(`(^|[^A-Za-z0-9_.:-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_.:-])`).test(text);
}
export function supportUserId(job: SupportJob): string | undefined {
  if (!job.chatId.startsWith('web:') || !job.openId.startsWith('web:')) return undefined;
  const id = job.openId.slice(4);
  if (job.userId && job.userId !== id) throw new Error('问题归属不一致');
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) ? id : undefined;
}
export function boundedEvidence(value: unknown, internalRead = false): Record<string, unknown> {
  const original = value as Record<string, unknown>;
  const safe = scrubSupportValue(value) as Record<string, unknown>;
  // Preserve the bounded top-level record list; redact each row before applying the size budget.
  // 保留有界顶层记录列表，逐行脱敏后再检查大小，避免50项数组限制提前丢失链路。
  if (Array.isArray(original.rows)) safe.rows = original.rows.slice(0, 200).map(row => scrubSupportValue(row));
  const outputTruncations: { path: string; originalCount: number; returnedCount: number }[] = [];
  function detectArrays(before: unknown, after: unknown, path: string) {
    if (outputTruncations.length >= 20) return;
    if (Array.isArray(before) && Array.isArray(after)) {
      if (after.length < before.length) outputTruncations.push({ path, originalCount: before.length, returnedCount: after.length });
      after.forEach((item, index) => detectArrays(before[index], item, `${path}[${index}]`));
    } else if (before && after && typeof before === 'object' && typeof after === 'object') {
      for (const [key, item] of Object.entries(after)) detectArrays((before as Record<string, unknown>)[key], item, path ? `${path}.${key}` : key);
    }
  }
  detectArrays(value, safe, '');
  const reasons = new Set(Array.isArray(safe.truncationReasons) ? safe.truncationReasons.filter((reason): reason is string => typeof reason === 'string') : []);
  if (outputTruncations.length) {
    safe.truncated = true;
    safe.incomplete = true;
    reasons.add('redaction_array_limit');
    safe.outputTruncations = [...(Array.isArray(safe.outputTruncations) ? safe.outputTruncations : []), ...outputTruncations].slice(0, 20);
  }
  if (reasons.size) safe.truncationReasons = [...reasons];
  if (internalRead || JSON.stringify(safe).length <= 26000) return safe;
  // Keep correlation identifiers and concrete failure evidence even when display rows are reduced.
  // 展示裁剪仍保留关联编号和具体失败证据，并明确说明此裁剪无法靠缓存详情补齐。
  const rows = Array.isArray(safe.rows) ? [...safe.rows].sort((a, b) => Number(Number(b.httpStatus) >= 400 || ['error', 'failed'].includes(b.level || b.status)) - Number(Number(a.httpStatus) >= 400 || ['error', 'failed'].includes(a.level || a.status))).slice(0, 5).map(row => {
    const { details, contextPreview, ...fields } = row as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 1200) : item]));
  }) : [];
  const { details, ...summary } = safe;
  reasons.add('output_size_limit');
  return { ...summary, rows, truncated: true, incomplete: true, truncationReasons: [...reasons],
    outputTruncations: [...(Array.isArray(safe.outputTruncations) ? safe.outputTruncations : []),
      { path: 'rows', originalCount: Array.isArray(original.rows) ? original.rows.length : 0, returnedCount: rows.length }].slice(0, 20),
    note: `${safe.note || ''} 返回展示已裁剪，不能据此宣称链路完整；缓存详情不保证恢复省略记录。`,
    ...(safe.matches ? { matches: (safe.matches as unknown[]).slice(0, 4) } : {}) };
}
export function createSupportTools(job: SupportJob, source: SupportCodeSource, _questions: string, investigation?: InvestigationScope) {
  const owner = supportUserId(job);
  const system = source.service ?? (job.context?.source === 'canvas' ? 'canvas' : 'repository');
  if (!supportInvestigationServiceId(system)) throw new Error('排查不包含已废弃主站模块');
  const contextProject = job.context?.source === system ? job.context.projectId : undefined;
  const accessibleLogs = new Map<string, Record<string, unknown>>();
  const fixedNow = new Date(job.context?.runtime?.capturedAt || Date.now());
  const explicitTime = ['reported', 'interpreted'].includes(investigation?.timeBasis || '');
  function dates(args: Record<string, unknown>, exact = false, chain = false) {
    const keepScope = !chain || isNativeProduct(system) || explicitTime;
    const fromInput = args.from ?? (keepScope ? investigation?.from : undefined);
    const toInput = args.to ?? (keepScope ? investigation?.to : undefined);
    if (!isNativeProduct(system) && exact && fromInput === undefined && toInput === undefined && system !== 'fg' && system !== 'production-lab') return {};
    const to = toInput === undefined ? fixedNow : new Date(String(toInput));
    const days = !isNativeProduct(system) && exact && fromInput === undefined && toInput === undefined ? 84 : 1;
    const from = fromInput === undefined ? new Date(to.getTime() - days * 86400000) : new Date(String(fromInput));
    const maxDays = !isNativeProduct(system) && exact && fromInput === undefined && toInput === undefined ? 84 : 7;
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > maxDays * 86400000) throw new Error('操作与日志查询时间范围无效');
    return { from: from.toISOString(), to: to.toISOString() };
  }
  function ids(args: Record<string, unknown>) {
    const result: Record<string, string> = {};
    for (const key of ['taskId', 'requestId', 'traceId', 'sessionId', 'projectId']) {
      if (args[key] === undefined) continue;
      const id = identifier(args[key]);
      if (!id) throw new Error('定位编号无效');
      result[key] = id;
    }
    return result;
  }
  function remember(result: Record<string, unknown>) {
    if (!Array.isArray(result.rows)) return;
    for (const row of result.rows as Record<string, unknown>[]) {
      if (typeof row.id === 'string') accessibleLogs.set(row.id, row);
    }
  }
  function scope(args: Record<string, unknown>, range: Record<string, unknown>, chain = false) {
    return { ...range, ...ids(args), projectId: identifier(args.projectId) || investigation?.projectId || contextProject,
      timeBasis: chain && !range.from && !range.to ? 'identifier' : (args.from && args.from !== investigation?.from) || (args.to && args.to !== investigation?.to) ? 'interpreted' : investigation?.timeBasis || 'recent' };
  }
  function identityRequired() {
    return { system, rows: [], incomplete: true, truncated: false, reason: 'authenticated_owner_required',
      note: '私有操作、日志、详情与链路取证需要受信网页登录账号；仅持有编号不授予读取权限。飞书未绑定时仍可提供源码帮助，请在网页使用本人账号取证。' };
  }
  async function read(tool: string, args: Record<string, unknown>, chain = false): Promise<Record<string, unknown>> {
    if (tool === 'code') {
      const result = await searchSupportCode({
        term: typeof args.term === 'string' ? args.term : undefined, path: typeof args.path === 'string' ? args.path : undefined,
        line: args.line === undefined ? undefined : Number(args.line), offset: args.offset === undefined ? undefined : Number(args.offset),
      }, source.revision, source.mode);
      return boundedEvidence({ ...result, system, matches: result.matches.map(match => ({ ...match, service: serviceForCodePath(match.path) })) });
    }
    if (tool === 'generation') {
      if (system !== 'canvas' || !owner) return { system, rows: [], incomplete: true, note: '生成内容核对仅允许已验证网页登录用户查询本人 Canvas 任务，不提供群聊或跨服务回退。' };
      if (!identifier(args.taskId)) throw new Error('生成内容核对需要精确任务编号');
      const filters = ids(args);
      const range = dates(args, true);
      const result = boundedEvidence(await queryCanvasGeneration({ userId: owner, taskId: filters.taskId,
        projectId: filters.projectId || investigation?.projectId || contextProject, ...range }));
      remember(result);
      return result;
    }
    if (tool === 'assets') {
      if (system !== 'canvas' || !owner) return { system, rows: [], incomplete: true, note: '素材快照需要选择 canvas 服务并验证网页登录身份。' };
      for (const key of ['projectId', 'assetId', 'versionId']) if (args[key] !== undefined && !identifier(args[key])) throw new Error('素材筛选编号无效');
      return boundedEvidence(await queryCanvasAssets({ userId: owner,
        projectId: identifier(args.projectId) || investigation?.projectId || contextProject,
        assetId: identifier(args.assetId), versionId: identifier(args.versionId),
        category: args.category as string | undefined, offset: args.offset as number | undefined,
        versionOffset: args.versionOffset as number | undefined }));
    }
    if (supportServices[system].data === 'browser' && ['operations', 'logs'].includes(tool)) {
      if (!owner) return identityRequired();
      return { system, rows: [], incomplete: true, applicable: false, requiredServices: supportServices[system].dependencies,
        note: '浏览器界面没有独立业务库或服务端原生日志。应分别查询 canvas / yingce-gateway 的业务数据及请求；它们不是浏览器日志。前端闪屏等渲染问题仍需浏览器异常或复现证据。' };
    }
    if (tool === 'operations') {
      if (!owner) return identityRequired();
      const filters = ids(args);
      const range = !isNativeProduct(system) && (filters.taskId || filters.requestId || filters.traceId) && args.from === undefined && args.to === undefined && ((chain && !explicitTime) || (!investigation?.from && !investigation?.to)) ? {} : dates(args, !!(filters.taskId || filters.requestId || filters.traceId), chain);
      const input = { userId: owner, projectId: filters.projectId || investigation?.projectId || contextProject,
        taskId: filters.taskId, sessionId: filters.sessionId, requestId: filters.requestId, traceId: filters.traceId, ...range };
      const adapter = supportServices[system].data;
      // Each query supplies its own selectors; page IDs must not leak into another service or chain hop.
      // 每次查询显式指定定位条件，页面编号不能混入其他服务或链路分支。
      if (args.provider !== undefined && (adapter !== 'gateway' || !['suno', 'volcengine'].includes(String(args.provider)))) throw new Error('该服务不支持指定的供应商筛选');
      const raw = adapter === 'production-lab' ? await queryProductionLabOperations(input)
        : adapter === 'gateway' ? await queryGatewayOperations({ ...input, service: typeof args.provider === 'string' ? args.provider : system })
        : adapter === 'product' && isNativeProduct(system) ? await queryProductNative({ ...input, service: system }, 'operations')
        : adapter === 'native' ? await queryNativeSupportLogs({ ...input, projectId: filters.projectId, service: system })
        : adapter === 'fg' || adapter === 'canvas' ? await queryUserOperations({ ...input,
          context: { source: adapter } })
        : { rows: [], incomplete: true, note: `${supportServices[system].label} 尚未接入可校验账号归属的原生操作数据；未查询，不回退其他服务冒充。` };
      const result = boundedEvidence({ ...raw, system }, chain);
      if (isNativeProduct(system)) result.requestedScope = scope(args, range, chain);
      else result.scope = { ...(result.scope as object || {}), ...scope(args, range, chain) };
      if (adapter === 'native') result.scope = { ...(result.scope as object), projectId: filters.projectId };
      remember(result);
      return result;
    }
    if (tool === 'logs') {
      if (!owner) return identityRequired();
      if (args.cursor !== undefined && (typeof args.cursor !== 'string' || !['fg', 'production-lab'].includes(system))) throw new Error('该服务不支持此日志分页参数');
      const filters = ids(args);
      const exact = !!(filters.taskId || filters.requestId || filters.traceId);
      const range = dates(args, exact, chain);
      if (system === 'canvas') {
        const input = { userId: owner,
          projectId: filters.projectId || investigation?.projectId || contextProject,
          taskId: filters.taskId, requestId: filters.requestId, traceId: filters.traceId, ...range };
        const [stored, native] = await Promise.all([queryCanvasSupportLogs(input), queryNativeSupportLogs({ ...input, projectId: filters.projectId, service: system })]);
        const nativeCoverage = native.coverage as { inboundHttp?: { available?: boolean } };
        const connected = nativeCoverage?.inboundHttp?.available === true;
        const result = boundedEvidence({ ...stored,
          rows: [...(Array.isArray(native.rows) ? native.rows : []), ...(Array.isArray(stored.rows) ? stored.rows : [])],
          incomplete: stored.incomplete === true || native.incomplete === true,
          truncated: stored.truncated === true || native.truncated === true,
          coverage: { ...(stored.coverage as object), inboundHttp: nativeCoverage.inboundHttp },
          nativeScope: native.scope, limitations: connected ? [] : [native.note], note: `${stored.note || ''} ${native.note || ''} 原生HTTP日志按本人及编号/时间筛选，不把页面项目当成日志已有的项目归属。` }, chain);
        result.scope = { ...(result.scope as object || {}), ...scope(args, range, chain), projectId: input.projectId };
        remember(result);
        return result;
      }
      if (system !== 'fg' && system !== 'production-lab') {
        const result = boundedEvidence(isNativeProduct(system)
          ? await queryProductNative({ service: system, userId: owner, ...filters, ...range }, 'logs')
          : await queryNativeSupportLogs({ service: system, userId: owner, ...filters, ...range }), chain);
        if (isNativeProduct(system)) result.requestedScope = scope(args, range, chain);
        else result.scope = { ...(result.scope as object || {}), ...scope(args, range, chain), projectId: filters.projectId };
        remember(result);
        return result;
      }
      // An explicit project boundary cannot be dropped just because FG logs cannot verify it.
      // FG日志无法核验项目归属时，不能静默丢弃明确要求的项目边界。
      if (filters.projectId) return { system, rows: [], incomplete: true, truncated: false, reason: 'unsupported_project_filter',
        scope: scope(args, range, chain), note: 'FG/Production Lab HTTP 日志没有可靠项目归属关联，未执行查询或忽略显式项目筛选。' };
      await assertSupportPrimaryEnvironment();
      const result = await queryLogExplorer({ ...range, taskId: filters.taskId, requestId: filters.requestId, traceId: filters.traceId,
        userId: owner, cursor: typeof args.cursor === 'string' ? args.cursor : undefined, routePrefix: system === 'production-lab' ? '/api/production-lab' : undefined,
        route: typeof args.route === 'string' ? args.route.slice(0, 200) : undefined,
        fullText: typeof args.term === 'string' ? args.term.slice(0, 120) : undefined, limit: 50 });
      const rows = result.rows.filter(row => system !== 'production-lab' || row.route === '/api/production-lab' || row.route?.startsWith('/api/production-lab/')).map(({ details, contextPreview, actorEmail, userId, ...row }) => {
        const message = supportOperationErrorEvidence(row.message);
        return { ...row, message: message.summary, errorExcerpt: message.errorExcerpt };
      });
      const evidence = boundedEvidence({ system, rows, summary: result.summary, scope: { ...scope(args, range, chain), projectId: undefined, route: result.applied.filters.route, routePrefix: system === 'production-lab' ? '/api/production-lab' : undefined },
        page: result.page, nextCursor: result.page.nextCursor, truncated: result.page.hasMore,
        truncationReasons: result.page.hasMore ? ['page_has_more'] : [], note: `${system === 'production-lab' ? 'Production Lab与FG同进程；仅查询真实 /api/production-lab 路由日志，不把其他FG接口当作本服务日志。' : 'FG日志限定当前授权账号；'}未按项目筛选。精确编号无指定时间时最多查询最近84天；没有用户归属的系统日志不会自动扩权读取。` }, chain);
      remember(evidence);
      return evidence;
    }
    if (tool === 'detail') {
      if (!owner) return identityRequired();
      const id = typeof args.id === 'string' ? args.id : '';
      const known = accessibleLogs.get(id);
      if (!known) throw new Error('仅可读取本轮已授权查询返回的详情');
      if (system !== 'fg' && system !== 'production-lab') return { ...known, system };
      await assertSupportPrimaryEnvironment();
      const detail = await getLogDetail(id);
      if (!detail || detail.userId !== owner) throw new Error('日志详情不可用或不属于当前用户');
      const { details, contextPreview, actorEmail, userId, ...row } = detail;
      const error = typeof details.error === 'object' && details.error !== null ? details.error as Record<string, unknown> : {};
      const diagnostic = supportOperationErrorEvidence(typeof details.error === 'string' ? details.error : error.message || details.reason || row.message);
      return boundedEvidence({ ...row, system, message: supportOperationErrorEvidence(row.message).summary,
        error: diagnostic.summary, errorExcerpt: diagnostic.errorExcerpt, errorCode: details.code || error.code });
    }
    throw new Error('不支持此调查工具');
  }
  return async (tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (args.service !== undefined && !supportInvestigationServiceId(args.service)) throw new Error('请求服务未知或属于已废弃主站模块');
    if (tool !== 'chain') return read(tool, args);
    if (!owner) return identityRequired();
    const filters = ids(args);
    const seeds = (['taskId', 'requestId', 'traceId'] as const).flatMap(key => filters[key] ? [{ key, value: filters[key] }] : []);
    if (seeds.length !== 1) throw new Error('链路查询每次仅接受一个任务、请求或链路编号；多个编号请分别独立查询');
    if (filters.sessionId) throw new Error('链路查询不支持 sessionId 筛选');
    const seed: ChainSeed = seeds[0];
    const range = dates(args, true, true);
    // Forward only explicit constraints; each reader normalizes its own default range once.
    // 只透传显式约束，各来源仅规范化一次默认范围，避免默认84天再次被当作显式7天窗口校验。
    const constraints = { ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(args.from !== undefined ? { from: args.from } : {}), ...(args.to !== undefined ? { to: args.to } : {}) };
    const result = await traceSupportChain(seed, (name, input) => read(name, { ...constraints, ...input }, true), system);
    const scopedRange = explicitTime || isNativeProduct(system) || args.from !== undefined || args.to !== undefined ? range : {};
    return boundedEvidence({ ...result, scope: { ...scope(args, scopedRange, true), root: seed } });
  };
}
