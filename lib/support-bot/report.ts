import { isSupportCodePath } from './code-search';
import { scrubSupportValue } from './redact';
import type { DiagnosisResult } from './store';
import type { SupportCodeSource } from './runtime';
import type { InvestigationScope } from './investigation-scope';
import { serviceForCodePath, supportServiceId, supportServices, type SupportServiceId } from './services';

export type SupportEvidence = { id: string; tool: string; result: Record<string, unknown> };
export type InvestigationAnswer = Record<string, unknown>;
export type InvestigationContext = {
  intent: 'product' | 'incident'; runtimeVerified: boolean; relatedIds: Set<string>; codeSource: SupportCodeSource; target: SupportServiceId;
  scope?: InvestigationScope;
  services?: SupportServiceId[];
};

export function safeText(value: unknown, limit = 1200): string {
  return typeof value === 'string' ? String(scrubSupportValue(value)).replace(/[<>]/g, '').trim().slice(0, limit) : '';
}
function strings(value: unknown, limit = 6): string[] {
  return Array.isArray(value) ? value.slice(0, limit).map(item => safeText(item, 600)).filter(Boolean) : [];
}
export function evidenceRows(entry: SupportEvidence): Record<string, unknown>[] {
  if (entry.tool === 'detail') return [entry.result];
  return Array.isArray(entry.result.rows) ? entry.result.rows.filter(row => row && typeof row === 'object') : [];
}
export function isAnomaly(row: Record<string, unknown>): boolean {
  return ['error', 'critical', 'fatal'].includes(String(row.level)) || Number(row.httpStatus) >= 400
    || ['failed', 'error', 'expired'].includes(String(row.taskStatus))
    || ['failed', 'rejected', 'unhealthy', 'error', 'cancelled', 'expired'].includes(String(row.status ?? row.outcome));
}
function isImplementationRead(entry: SupportEvidence): boolean {
  return entry.tool === 'code' && !entry.result.error && entry.result.read === true && Array.isArray(entry.result.matches)
    && entry.result.matches.some((match: { path?: string }) => typeof match.path === 'string' && isSupportCodePath(match.path)
      && !/\.(?:md|mdx|txt)$/i.test(match.path) && !/^(?:\.planning|docs|tests?|__tests__)\//.test(match.path)
      && !/(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(match.path));
}
function isLinked(row: Record<string, unknown>, ids: Set<string>) {
  return [row.id, row.taskId, row.requestId, row.traceId].some(id => typeof id === 'string' && ids.has(id));
}
function failureText(row: Record<string, unknown>) {
  return [row.errorExcerpt, row.error, row.reason, row.message, row.errorCode].map(value => safeText(value, 1500)).filter(Boolean).join('\n');
}

function assessEvidence(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext) {
  const refs = strings(answer.evidenceRefs, 20);
  const cited = evidence.filter(entry => refs.includes(entry.id) && !entry.result.error);
  const recordIds = strings(answer.recordIds, 20);
  const codeRead = cited.some(isImplementationRead);
  const matchedCode = cited.filter(entry => isImplementationRead(entry)
    && entry.result.revision === options.codeSource.revision && entry.result.mode === options.codeSource.mode
    && (!entry.result.system || entry.result.system === options.target)
    && (entry.result.matches as { path: string }[]).every(match => serviceForCodePath(match.path) === options.target));
  const linkedAnomaly = cited.some(entry => entry.result.system === options.target && evidenceRows(entry).some(row => recordIds.includes(String(row.id))
    && isAnomaly(row) && isLinked(row, options.relatedIds)));
  const proof = answer.causeProof && typeof answer.causeProof === 'object' ? answer.causeProof as Record<string, unknown> : {};
  const chain = cited.find(entry => entry.id === proof.chainRef && entry.tool === 'chain' && entry.result.system === options.target);
  const root = chain?.result.root as { key?: string; value?: string } | undefined;
  const row = chain && evidenceRows(chain).find(item => item.id === proof.recordId && recordIds.includes(String(item.id)) && isAnomaly(item));
  const errorExcerpt = safeText(proof.errorExcerpt, 400);
  const implementation = matchedCode.find(entry => entry.id === proof.codeRef);
  const codeExcerpt = safeText(proof.codeExcerpt, 1600);
  // A status code plus unrelated source is not a cause. Require a traversed request and literal error-to-code proof.
  // 状态码加任意源码不构成根因；必须展开真实请求链，并用错误原文与实现相互核对。
  const literalFailure = errorExcerpt.length >= 8 && safeText(row?.errorExcerpt, 2000).includes(errorExcerpt) && codeExcerpt.includes(errorExcerpt);
  // An error code is an observation, not proof that a particular source branch executed.
  // 错误码只能作为已观察事实，不能仅凭源码同名文本证明执行了某个错误分支。
  const causalChain = !!(chain && !chain.result.truncated && !chain.result.incomplete && root?.value && options.relatedIds.has(root.value) && row && row.recordType === 'log' && (row.requestId || row.traceId)
    && (!String(row.source).endsWith('_native') || (row.buildDirty === false && typeof row.buildCommit === 'string' && /^[a-f0-9]{7,40}$/i.test(row.buildCommit) && options.codeSource.revision.toLowerCase().startsWith(row.buildCommit.toLowerCase())))
    && root.key && row[root.key] === root.value
    && (root.key !== 'traceId' || new Set(evidenceRows(chain).filter(item => item.recordType === 'log' && isAnomaly(item)).map(item => item.requestId || item.taskId || item.id)).size === 1)
    && Array.isArray(chain.result.queries) && !chain.result.queries.some(query => query.error) && chain.result.queries.some(query => query.tool === 'logs' && Number(query.count) > 0)
    && literalFailure
    && implementation && Array.isArray(implementation.result.matches)
    && implementation.result.matches.some(match => typeof match.excerpt === 'string' && safeText(match.excerpt, 5000).includes(codeExcerpt)));
  return { cited, codeRead, linkedAnomaly, causalChain, canConfirm: options.runtimeVerified && matchedCode.length > 0 && (options.intent === 'product' || causalChain) };
}

function assertsConfirmedCause(answer: InvestigationAnswer): boolean {
  const text = [safeText(answer.summary), safeText(answer.cause), ...strings(answer.solutions)].join('\n');
  const assertion = /(?:已(?:经)?(?:确认|核实|证实|查明|定位)|确定)[^，。；;\n!?！？]{0,16}(?:根因|故障原因)|(?:根因|故障原因)[^，。；;\n!?！？]{0,8}(?:已(?:经)?(?:确认|核实|证实|查明|定位)|确定|就是)/g;
  return Array.from(text.matchAll(assertion)).some(match => !/(?:尚未|未能|无法|不能|不可|没有|未|不)/.test(match[0])
    && !/(?:尚未|未能|无法|不能|不可|没有|未|不)[^，。；;\n]{0,6}$/.test(text.slice(Math.max(0, match.index! - 12), match.index)));
}

export function validateInvestigationAnswer(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): string | undefined {
  if (!safeText(answer.summary) || !safeText(answer.cause) || !strings(answer.solutions).length) return '必须返回 summary、cause 和非空 solutions。';
  if (!['confirmed', 'likely', 'needs_info'].includes(String(answer.certainty))) return 'certainty 必须是 confirmed、likely 或 needs_info。';
  if (options.intent === 'incident' && answer.certainty === 'likely') return '故障不接受 likely 或猜测性解释；继续查实际时间段/任务/请求/trace链路，未定位就用 needs_info，仅列已查事实与缺失信息，不给推测原因或推测修复。';
  const refs = strings(answer.evidenceRefs, 20);
  if (refs.some(ref => !evidence.some(entry => entry.id === ref && !entry.result.error))) return 'evidenceRefs 包含不存在或失败的证据。';
  const code = evidence.filter(entry => entry.tool === 'code' && Array.isArray(entry.result.matches) && entry.result.matches.length);
  if (code.length && !code.some(entry => refs.includes(entry.id) && isImplementationRead(entry))) return '不能只凭搜索命中或文档回答；须用 code 的 path+line 读取相关业务实现并引用，needs_info 也不例外。';
  const ids = strings(answer.recordIds, 20);
  if (ids.some(id => !evidence.some(entry => refs.includes(entry.id) && evidenceRows(entry).some(row => row.id === id)))) return 'recordIds 必须来自引用证据中实际返回的记录。';
  const assessment = assessEvidence(answer, evidence, options);
  if (!assessment.canConfirm && (answer.certainty === 'confirmed' || assertsConfirmedCause(answer))) {
    return options.intent === 'incident'
      ? '故障尚未核实：必须有与用户定位编号关联的 chain、真实失败请求、错误原文与对应运行实现吻合的 causeProof，且版本已核验。状态码/失败任务加任意源码不够。请继续取证或返回 needs_info；不能写更像是/可能原因/推测解决方案。'
      : '尚未满足运行版本一致及实现读取要求；请说明源码依据及限制，不能声称已核实运行行为。';
  }
  if (options.intent === 'incident' && answer.certainty === 'confirmed'
    && /更像是|推测|大概|似乎|应该是|可能[^。\n]{0,20}(?:导致|原因|触发)/.test([answer.summary, answer.cause].join('\n'))) return '已核实故障答复不能包含推测性原因。';
  return undefined;
}

function rowDescription(row: Record<string, unknown>): string {
  const parts = [safeText(row.id, 120), row.source ? `来源 ${safeText(row.source, 80)}` : '', row.occurredAt ? safeText(String(row.occurredAt), 60) : '',
    row.buildCommit ? `事件运行commit=${safeText(row.buildCommit, 40)}${row.buildDirty === true ? '（dirty）' : row.buildDirty === false ? '' : '（clean状态未知）'}` : '',
    row.route ? safeText(row.route, 200) : '', row.httpStatus ? `HTTP ${row.httpStatus}` : safeText(row.status ?? row.outcome ?? row.level ?? row.event, 80),
    ...['taskId', 'requestId', 'traceId'].flatMap(key => row[key] ? [`${key}=${safeText(row[key], 120)}`] : [])];
  const error = failureText(row).replace(/\s+/g, ' ').slice(0, 360);
  return `${parts.filter(Boolean).join(' · ')}${error ? `\n记录摘要：${error}` : ''}`;
}
export function evidenceDescription(entry: SupportEvidence): string {
  if (entry.result.error) return `${entry.id} ${entry.tool}：${safeText(entry.result.error, 160)}`;
  if (entry.tool === 'runtime') return `${entry.id} 运行环境：${safeText(entry.result.description, 350) || '已采集，版本是否匹配见限制说明'}`;
  if (entry.tool === 'code') {
    const matches = Array.isArray(entry.result.matches) ? entry.result.matches : [];
    const match = matches.find(item => item && typeof item.path === 'string' && isSupportCodePath(item.path) && Number.isInteger(item.line));
    return match ? `${entry.id} ${supportServices[serviceForCodePath(match.path)].label} ${entry.result.read ? '已读取实现' : '搜索命中'}：${match.path}:${match.line}（${entry.result.mode === 'working-tree' ? '开发工作树' : String(entry.result.revision || '').slice(0, 12)}）`
      : `${entry.id} 源码：本次检索未命中，不能据此断言功能不存在`;
  }
  const rows = evidenceRows(entry);
  const row = rows.find(isAnomaly) || rows[0];
  return row ? `${entry.id} ${entry.tool === 'operations' ? '操作记录' : entry.tool === 'chain' ? '请求链路' : '日志'}：${rowDescription(row)}`
    : `${entry.id} ${entry.tool === 'operations' ? '操作记录' : '日志'}：${safeText(entry.result.note, 220) || '限定范围内无匹配记录'}`;
}
function rangeDescription(scope?: InvestigationScope) {
  if (!scope) return '本次未取得明确的故障发生时间范围。';
  if (!scope.from || !scope.to) return '按任务/请求/链路编号定位；各数据源查询时限见取证记录。';
  const title = scope.timeBasis === 'reported' ? '用户选择的发生时间段' : scope.timeBasis === 'interpreted' ? `按用户时间描述“${safeText(scope.timeText, 120)}”解析的候选窗口（待确认）` : '最近24小时候选窗口（不是已确认的故障时间）';
  return `${title}：${scope.from} 至 ${scope.to}${scope.projectId ? `；项目 ${scope.projectId}` : ''}。`;
}
const evidenceGap = /未配置|未接入|缺失|缺表|不可用(?!于)|未找到|未执行|未覆盖|不支持|无可靠关联|失败|暂不|暂无/;

function buildUnresolvedIncident(evidence: SupportEvidence[], options: InvestigationContext): DiagnosisResult {
  const actual = evidence.filter(entry => supportServiceId(entry.result.system) && (options.services || [options.target]).includes(entry.result.system as SupportServiceId));
  const records = new Map<string, { entry: SupportEvidence; row: Record<string, unknown> }>();
  for (const entry of actual) for (const row of evidenceRows(entry)) if (isAnomaly(row)) records.set(`${entry.result.system}:${row.source || row.recordType || entry.tool}:${row.id}`, { entry, row });
  const failures = [...records.values()].sort((a, b) => Number(isLinked(b.row, options.relatedIds)) - Number(isLinked(a.row, options.relatedIds))).slice(0, 4);
  const facts = failures.map(({ entry, row }) => `${entry.id} [${entry.result.system}] ${isLinked(row, options.relatedIds) || (entry.tool === 'chain' && options.relatedIds.has(String((entry.result.root as { value?: string })?.value))) ? '编号关联的异常记录' : '候选异常，尚未确认属于本次反馈'}：${rowDescription(row)}`);
  if (!facts.length) facts.push('在本次已查询的范围内，未取得可关联的异常请求记录；这不代表问题未发生。');
  const gaps = [!options.runtimeVerified ? '实际运行版本尚未与所读实现核验一致，不能确认运行根因。' : '',
    '尚未完成“本次失败请求 → 关联链路/具体错误 → 对应运行实现”的因果核对，暂不提供原因判断或修复结论。'];
  const sourceGaps: string[] = [];
  for (const entry of actual) {
    if (Array.isArray(entry.result.coverage)) {
      const skipped = entry.result.coverage.filter(item => item && item.status !== 'queried');
      for (const status of new Set(skipped.map(item => item.status))) {
        const sources = skipped.filter(item => item.status === status);
        sourceGaps.push(`${supportServices[entry.result.system as SupportServiceId].label}：${safeText(sources.map(item => item.table).join(', '), 200)} 未覆盖；${safeText(sources[0]?.note, 240)}`);
      }
    }
    if (entry.result.error) gaps.push(safeText(entry.result.error, 240));
    const coverage = entry.result.coverage as { inboundHttp?: { available?: boolean } } | undefined;
    if (coverage?.inboundHttp?.available === false) gaps.push(`${supportServices[entry.result.system as SupportServiceId].label} 本次查询未取得可验证的原生 HTTP 日志。${safeText(entry.result.note, 350)} 这不等于该服务未接入，也不能证明本次请求经过它。`);
    if (entry.result.note && (entry.result.incomplete || (!evidenceRows(entry).length && evidenceGap.test(String(entry.result.note))))) {
      const note = String(entry.result.note).split(/[。；]/).filter(part => evidenceGap.test(part)).slice(-3).join('；');
      if (note) gaps.push(safeText(note, 300));
    }
    if (entry.result.truncated) gaps.push(entry.tool === 'code' ? `${entry.id} 源码检索/读取有截断，未返回的片段不属于已核对依据。` : `${entry.id} 结果有截断，不能视为完整链路。`);
    if (Array.isArray(entry.result.queries)) for (const query of entry.result.queries) {
      if (query.error) gaps.push(safeText(query.error, 200));
      if (query.incomplete && query.note) gaps.push(safeText(String(query.note).split(/[。；]/).filter(part => evidenceGap.test(part)).slice(-2).join('；'), 250));
    }
  }
  const next = !options.relatedIds.size
    ? options.scope?.timeBasis === 'reported' || options.scope?.timeBasis === 'interpreted'
      ? '请确认上面的时间范围及候选请求是否对应本次异常；若不对应，请补充任务ID或失败请求的 requestId/traceId，继续定位原链路。'
      : '请在“发生时间段”选择异常发生的起止时间，或提供任务ID / requestId / traceId 任一项；助手将按该范围查真实请求，不把最近24小时的任意错误当成本次故障。'
    : '已按提供的编号展开可访问链路；缺失的数据源或版本证据需开发补齐后继续核对，无需重复提供相同编号。';
  const runtimes = [...new Map(evidence.filter(entry => entry.tool === 'runtime').map(entry => [entry.result.requestedSource, entry])).values()];
  const queried = actual.filter(entry => ['operations', 'logs'].includes(entry.tool)).map(entry => {
    const scope = entry.result.scope as Record<string, unknown> | undefined;
    if (!scope) return '';
    const ids = ['projectId', 'taskId', 'requestId', 'traceId'].flatMap(key => scope[key] ? [`${key}=${safeText(scope[key], 120)}`] : []);
    return `${entry.id} [${entry.result.system}] ${entry.tool}：${scope.from ? safeText(scope.from, 40) : '精确编号，不限起点'} 至 ${scope.to ? safeText(scope.to, 40) : '查询时刻'}${ids.length ? `；${ids.join('，')}` : ''}`;
  }).filter(Boolean).slice(0, 8);
  const code = evidence.filter(isImplementationRead).slice(-3);
  const browser = evidence.filter(entry => entry.tool === 'browser').flatMap(evidenceRows).slice(0, 3);
  const reply = [
    '结论（未定位根因）\n尚未取得足以确认本次问题原因的完整运行证据。本次不根据界面现象或代码机制猜测原因。',
    `查询范围\n${rangeDescription(options.scope)}${queried.length ? `\n${queried.join("\n")}` : ""}`,
    browser.length ? `浏览器失败请求线索（尚未用服务端日志核实）\n${browser.map(rowDescription).join('\n\n')}` : '',
    `实际查到的记录\n${facts.join('\n\n')}`,
    runtimes.length ? `逐服务运行环境\n${runtimes.map(evidenceDescription).join('\n')}` : '',
    code.length ? `已核对源码（不等于本次故障原因）\n${code.map(evidenceDescription).join('\n')}` : '',
    `取证缺口\n${[...new Set([...gaps, ...sourceGaps].filter(Boolean))].slice(0, 8).join('\n')}`,
    `继续定位\n${next}\n排查期间不需要重新付费生成、删除素材或修改业务数据。`,
  ].filter(Boolean).join('\n\n');
  return { userReply: reply, internalSummary: reply, needsDeveloper: true, module: 'unknown', evidence, guidanceOnly: false };
}

export function buildInvestigationResult(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): DiagnosisResult {
  const rejected = validateInvestigationAnswer(answer, evidence, options);
  const assessment = assessEvidence(answer, evidence, options);
  // Even "needs_info" prose can hide guesses. Unresolved incidents render only server-observed facts.
  // needs_info正文也可能夹带猜测；未定位故障只渲染程序取得的事实，不发布模型原因和修复建议。
  if (options.intent === 'incident' && (rejected || answer.certainty !== 'confirmed' || !assessment.canConfirm)) return buildUnresolvedIncident(evidence, options);
  if (rejected) answer = {
    certainty: 'needs_info', summary: '尚未完成符合证据要求的功能核对，不能据此断言功能不支持。',
    cause: '已有查询结果保留，尚需读取并核对相关实现。', solutions: ['保留当前问题供开发继续核对，无需重复付费生成或删除素材。'],
    limitations: ['助手答复未通过证据校验。'], evidenceRefs: evidence.filter(entry => !entry.result.error).map(entry => entry.id), needsDeveloper: true,
  };
  const { cited, codeRead, canConfirm } = assessEvidence(answer, evidence, options);
  const certainty = answer.certainty === 'confirmed' && canConfirm ? 'confirmed' : answer.certainty === 'needs_info' || !codeRead ? 'needs_info' : 'likely';
  const limitations = strings(answer.limitations);
  if (!options.runtimeVerified) limitations.unshift('尚未核对目标业务实际运行版本与检索源码一致；源码结论仅供参考。');
  const summary = safeText(answer.summary, 1800), cause = safeText(answer.cause);
  const status = certainty === 'confirmed' ? '已核实' : certainty === 'likely' ? '源码功能依据，运行行为待核实' : '尚不能确认';
  const shown = [...evidence.filter(entry => entry.tool === 'runtime'), ...cited.filter(entry => entry.tool !== 'runtime')].slice(0, 8);
  const reply = [`结论（${status}）\n${summary}`, `原因 / 功能依据\n${cause}`, `如何解决\n${strings(answer.solutions).map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    options.intent === 'incident' ? `查询范围\n${rangeDescription(options.scope)}` : '',
    `核对证据\n${shown.map(evidenceDescription).join('\n') || '本次未获得可核实证据。'}`,
    limitations.length ? `未核实 / 数据范围\n${[...new Set(limitations)].slice(0, 8).join('\n')}` : '',
    strings(answer.missingInfo, 4).length ? `还需补充\n${strings(answer.missingInfo, 4).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { userReply: reply, internalSummary: safeText(answer.internalSummary, 4000) || `${summary}\n${cause}`,
    needsDeveloper: answer.needsDeveloper === true, module: safeText(answer.module, 80) || 'unknown', evidence, guidanceOnly: options.intent === 'product' };
}
