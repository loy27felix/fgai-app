import type { RelatedUserIssues } from './known-issues';
import { isSupportCodePath } from './code-search';
import { OMITTED_VOICE_NOTICE } from './generation';
import { scrubSupportValue } from './redact';
import type { DiagnosisResult } from './store';
import type { SupportCodeSource } from './runtime';
import type { InvestigationScope } from './investigation-scope';
import { serviceForCodePath, supportServiceId, supportServices, type SupportServiceId } from './services';

export type SupportEvidence = { id: string; tool: string; result: Record<string, unknown>; status?: 'completed' | 'failed' };
export type InvestigationAnswer = Record<string, unknown>;
export type InvestigationContext = {
  intent: 'product' | 'incident'; runtimeVerified: boolean; relatedIds: Set<string>; codeSource: SupportCodeSource; target: SupportServiceId;
  scope?: InvestigationScope;
  services?: SupportServiceId[];
  generationTaskIds?: string[];
  questionType?: 'usage' | 'help' | 'generation' | 'incident';
  collectionGaps?: string[];
  relatedUserIssues?: RelatedUserIssues;
  incompleteReason?: 'answer_validation' | 'model_response' | 'tool_budget';
};

export function isEvidenceFailure(entry: SupportEvidence): boolean {
  if (entry.status) return entry.status === 'failed';
  // A retrieved log's business error is evidence, not a failed tool call.
  // 已取回日志中的业务错误是证据，不是工具执行失败。
  return !!entry.result.error && !(entry.tool === 'detail' && typeof entry.result.id === 'string');
}

export function safeText(value: unknown, limit = 1200): string {
  return typeof value === 'string' ? String(scrubSupportValue(value)).replace(/[<>]/g, '').trim().slice(0, limit) : '';
}
function strings(value: unknown, limit = 6): string[] {
  return Array.isArray(value) ? value.slice(0, limit).map(item => safeText(item, 600)).filter(Boolean) : [];
}
// Keep evidence checks and technical details separate from the customer's explanation.
// 技术取证与用户说明分开：简化展示，不降低核验要求，也不丢弃内部记录。
function userFacingAnswer(answer: InvestigationAnswer, options: InvestigationContext, certainty: string): string {
  const summary = safeText(answer.summary, 1800);
  const cause = safeText(answer.cause);
  const steps = strings(answer.solutions);
  const missing = strings(answer.missingInfo, 12);
  const notes = strings(answer.limitations, 12);
  if (options.intent === 'incident' && certainty === 'likely') notes.push('这只是目前的判断，具体原因还没确认。');
  if (options.intent === 'incident' && certainty === 'needs_info' && !/没查清|还没确认|暂时不能确定原因/.test(`${summary} ${cause}`)) {
    notes.push('这次的具体原因还没查清。');
  }
  if (options.collectionGaps?.length) notes.push('还有一些相关记录暂时没查到，以上只说明目前能确认的情况。');
  else if (options.intent === 'product' && !options.runtimeVerified) notes.push('这些用法是否完全适用于你当前的页面，还需要确认。');
  return [
    summary,
    cause && cause !== summary ? `${certainty === 'likely' && options.intent === 'incident' ? '可能的原因（还没确认）' : '具体来说'}：${cause}` : '',
    steps.length ? `你可以这样做：\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : '',
    notes.length ? `注意：${[...new Set(notes)].join('；')}` : '',
    missing.length ? `还需要你补充：\n${missing.map(item => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
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
export function isImplementationRead(entry: SupportEvidence): boolean {
  return entry.tool === 'code' && !isEvidenceFailure(entry) && entry.result.read === true && Array.isArray(entry.result.matches)
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

type UpstreamFailure = { entry: SupportEvidence; row: Record<string, unknown>; error: string };

export function upstreamFailureEvidence(evidence: SupportEvidence[], options: Pick<InvestigationContext, 'target' | 'relatedIds'>): UpstreamFailure[] {
  const failures = new Map<string, UpstreamFailure>();
  const services: readonly SupportServiceId[] = supportServices[options.target].data === 'browser'
    ? supportServices[options.target].dependencies : [options.target];
  for (const entry of evidence) {
    if (isEvidenceFailure(entry) || !services.includes(entry.result.system as SupportServiceId) || !['logs', 'detail', 'chain'].includes(entry.tool)) continue;
    for (const row of evidenceRows(entry)) {
      const error = safeText(row.errorExcerpt, 1200);
      if (row.source !== 'api_call_logs' || row.recordType === 'operation' || !isLinked(row, options.relatedIds)
        || !(Number(row.httpStatus) >= 400 || ['failed', 'error', 'rejected'].includes(String(row.status)))
        || typeof row.id !== 'string' || !row.id || error.length < 8
        || /^(?:HTTP\s*)?(?:[1-5]\d{2}[\s:.-]*)?(?:Conflict|Bad Request|Internal Server Error|Unknown Error|Request Failed|请求失败|未知错误|服务器错误)?[.!。！\s]*$/i.test(error)) continue;
      const previous = failures.get(row.id);
      if (!previous || previous.error.length < error.length) failures.set(row.id, { entry, row, error });
    }
  }
  return [...failures.values()];
}

type GenerationFinding = { entry: SupportEvidence; row: Record<string, unknown> };

export function generationFindingEvidence(evidence: SupportEvidence[], relatedIds: Set<string>): GenerationFinding[] {
  return evidence.filter(entry => entry.tool === 'generation' && entry.result.system === 'canvas' && !isEvidenceFailure(entry)
    && !entry.result.incomplete && !entry.result.truncated).flatMap(entry => evidenceRows(entry).filter(row =>
    row.recordType === 'generation_finding' && row.kind === 'character_voice_sample_omitted' && row.findingVerified === true
    && row.boundary === 'reference_submission' && row.omissionNotice === OMITTED_VOICE_NOTICE
    && typeof row.sampleResourceId === 'string' && !!row.speakingCue && isLinked(row, relatedIds)).map(row => ({ entry, row })));
}

function generationInputs(evidence: SupportEvidence[], options: InvestigationContext) {
  const inputs = evidence.filter(entry => entry.tool === 'generation' && entry.result.system === 'canvas' && !isEvidenceFailure(entry))
    .flatMap(entry => evidenceRows(entry).filter(row => row.source === 'canvas_generation_submission' && typeof row.taskId === 'string'
      && (options.generationTaskIds?.includes(row.taskId) || isLinked(row, options.relatedIds))).map(row => ({ entry, row })));
  return [...new Map(inputs.map(input => [input.row.taskId, input])).values()];
}
function validateGenerationReview(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): string | undefined {
  if (options.intent !== 'incident') return undefined;
  const partial = answer.certainty === 'needs_info';
  const inputs = generationInputs(evidence, options);
  const required = new Set([...(options.generationTaskIds || []), ...inputs.map(({ row }) => String(row.taskId))]);
  const reviews = Array.isArray(answer.generationReview) ? answer.generationReview : [];
  const refs = strings(answer.evidenceRefs, 48);
  for (const taskId of required) {
    const input = inputs.find(({ row }) => row.taskId === taskId);
    if ((!input || input.row.inputFactsAvailable !== true) && partial) continue;
    if (!input || input.row.inputFactsAvailable !== true) return `生成任务 ${taskId} 尚未取得可读取的历史输入；不能只凭接口报错得出结论。继续 generation 或用 needs_info 说明已知事实及读取失败原因。`;
    if (!partial && (input.row.referencesTruncated || input.entry.result.truncated)) return `生成任务 ${taskId} 的素材清单已截断；未核对完整前不能给完整归因，请用 needs_info 说明已知部分和缺口。`;
    const review = reviews.find(item => item && item.taskId === taskId && item.inputRef === input.entry.id);
    if (!review || !refs.includes(input.entry.id) || !Array.isArray(review.checks)) return `生成任务 ${taskId} 必须提供 generationReview，引用 ${input.entry.id}，逐项核对 instructions、references、settings、response，不能只复述接口错误。`;
    const implementationChecks = Array.isArray(input.entry.result.implementationChecks) ? input.entry.result.implementationChecks : [];
    for (const expected of partial ? [] : implementationChecks) {
      if (!evidence.some(entry => refs.includes(entry.id) && isImplementationRead(entry) && entry.result.system === 'canvas'
        && (entry.result.matches as { path: string }[]).some(match => match.path === expected.path))) return `生成任务 ${taskId} 尚未实际读取并引用对应实现 ${expected.path}。搜索命中不是源码核对；无法读取时使用 needs_info，不把接口拒绝当成最终归因。`;
    }
    for (const aspect of ['instructions', 'references', 'settings', 'response']) {
      const check = review.checks.find((item: Record<string, unknown>) => item && item.aspect === aspect);
      const checkRefs = strings(check?.evidenceRefs, 12);
      if (!check || safeText(check.result, 800).length < 8 || !checkRefs.length
        || checkRefs.some(ref => !refs.includes(ref) || !evidence.some(entry => entry.id === ref && !isEvidenceFailure(entry)))) return `生成任务 ${taskId} 缺少 ${aspect} 的具体对照结果及有效证据引用。`;
      if (aspect === 'response') {
        if (!evidence.some(entry => checkRefs.includes(entry.id) && ['generation', 'detail', 'logs', 'chain'].includes(entry.tool)
          && evidenceRows(entry).some(row => row.taskId === taskId && ['api_call_logs', 'canvas_generation_audit'].includes(String(row.source))))) {
          if (partial && checkRefs.includes(input.entry.id)) continue;
          return `生成任务 ${taskId} 的 response 必须引用本任务的实际调用审计或接口回执，不能用其他任务或状态码代替。`;
        }
      } else if (!checkRefs.includes(input.entry.id) || !partial && !evidence.some(entry => checkRefs.includes(entry.id)
        && isImplementationRead(entry) && entry.result.system === 'canvas')) return `生成任务 ${taskId} 的 ${aspect} 必须同时引用本任务输入和实际读取的对应实现。`;
    }
  }
  return undefined;
}
function generationFacts(evidence: SupportEvidence[], options: InvestigationContext, answer?: InvestigationAnswer): string {
  const sections = generationInputs(evidence, options).map(({ entry, row }) => {
    const rows = evidenceRows(entry);
    const references = rows.filter(item => item.recordType === 'generation_reference' && item.taskId === row.taskId);
    const counts = row.referenceCounts && typeof row.referenceCounts === 'object' ? row.referenceCounts as Record<string, unknown> : {};
    const media = references.map(item => {
      const snapshot = item.resourceSnapshot && typeof item.resourceSnapshot === 'object' ? item.resourceSnapshot as Record<string, unknown> : {};
      const size = Number(item.storedBytes || snapshot.bytes);
      const bytes = Number.isSafeInteger(size) && size > 0
        ? `${size.toLocaleString('en-US')} bytes（${(size / 1048576).toFixed(2)} MiB，${item.storedBytes ? '历史输入登记' : '当前资源登记'}）` : '大小未取得';
      const currentDifference = item.storedBytes && snapshot.bytes && Number(item.storedBytes) !== Number(snapshot.bytes)
        ? `；当前资源登记 ${Number(snapshot.bytes)} bytes，与历史输入不同` : '';
      return `${item.kind === 'image' ? '图片' : item.kind === 'audio' ? '音频' : item.kind === 'mask' ? '遮罩' : '视频'} ${item.index}：${item.origin === 'project_style_reference' ? '项目画风参考' : '任务参考素材'}${item.label ? ` · ${safeText(item.label, 100)}` : ''}；${bytes}${currentDifference}${item.resourceId ? `；resourceId=${safeText(item.resourceId, 120)}` : ''}`;
    });
    const audit = rows.filter(item => item.recordType === 'generation_call' && item.taskId === row.taskId).map(item => [
      `${safeText(item.id, 160)}：${safeText(item.status, 40)}${item.httpStatus ? `，HTTP ${Number(item.httpStatus)}` : ''}${item.recordingIssue ? `；${safeText(item.recordingIssue, 200)}` : ''}${item.errorExcerpt ? `；${safeText(item.errorExcerpt, 600)}` : ''}`,
      item.requestSettings ? `请求审计中的白名单设置：${safeText(JSON.stringify(item.requestSettings), 1200)}` : '',
      item.requestInstructionExcerpt ? `请求审计中的文字摘录：${safeText(item.requestInstructionExcerpt, 800)}` : '',
      Array.isArray(item.requestReferences) ? `请求审计中的素材摘要：${safeText(JSON.stringify(item.requestReferences), 2400)}${item.requestReferencesTruncated ? '（已截断）' : ''}` : '',
    ].filter(Boolean).join('\n'));
    const review = Array.isArray(answer?.generationReview) ? answer.generationReview.find(item => item?.taskId === row.taskId && item.inputRef === entry.id) : undefined;
    const checks = Array.isArray(review?.checks) ? review.checks.slice(0, 4).map((check: Record<string, unknown>) =>
      `${({ instructions: '提示词', references: '参考素材', settings: '模型与设置', response: '接口回执' } as Record<string, string>)[String(check.aspect)] || '核对'}：${safeText(check.result, 600)}`) : [];
    return [
      `${entry.id} 任务 ${safeText(row.taskId, 120)}：${row.inputFactsAvailable ? `历史输入包含图片 ${counts.referenceImages ?? '未知'} 张、音频 ${counts.referenceAudios ?? '未知'} 个、视频 ${counts.referenceVideos ?? '未知'} 个。` : '历史输入尚未取得，不能认定无素材。'}`,
      row.settings ? `已保存的模型与设置：${safeText(JSON.stringify(row.settings), 1200)}` : '',
      row.instructionExcerpt ? `已保存的提示词摘录${row.instructionsTruncated ? '（已截断）' : ''}：${safeText(row.instructionExcerpt, 1200)}` : '',
      row.systemInstructionExcerpt ? `已保存的系统指令摘录：${safeText(row.systemInstructionExcerpt, 800)}` : '',
      row.storedInstructionsMatch === false ? `任务提示词与输入内提示词记录不一致，需核对实际采用的版本。输入内文字摘录：${safeText(row.inputInstructionExcerpt, 800)}` : '',
      media.join('\n'), entry.result.resourceMetadataIssue ? safeText(entry.result.resourceMetadataIssue, 300) : '', row.referencesTruncated || entry.result.truncated ? '素材清单或调用记录已截断，尚未逐项核对完整。' : '', audit.join('\n'),
      checks.length ? `逐项对照结果\n${checks.join('\n')}` : '输入与实现的逐项分析尚未完成，以上仅列出已查记录。',
      '证据边界：以上为任务历史输入及标注的资源元数据，不等于已恢复完整最终请求；未读取物理文件，不把登记大小或数值吻合当成已核实的最终发送字节。',
    ].filter(Boolean).join('\n');
  });
  return sections.length ? `生成任务输入与逐项核对\n${sections.join('\n\n')}` : '';
}

function parameterDetails(evidence: SupportEvidence[], options: InvestigationContext) {
  return evidence.filter(entry => entry.tool === 'detail' && !isEvidenceFailure(entry) && entry.result.parameterCoverage === 'queried'
    && (isLinked(entry.result, options.relatedIds) || options.generationTaskIds?.includes(String(entry.result.taskId))));
}
function validateParameterReview(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): string | undefined {
  if (options.intent !== 'incident') return;
  const details = parameterDetails(evidence, options);
  const reviews = Array.isArray(answer.parameterReview) ? answer.parameterReview : [];
  const refs = strings(answer.evidenceRefs, 48);
  for (const recordId of new Set(details.map(entry => entry.result.id))) {
    const review = reviews.find(item => item && item.recordId === recordId);
    const detailRefs = strings(review?.evidenceRefs, 12);
    if (!review || !['request', 'response', 'finding'].every(key => safeText(review[key], 800).length >= 8)
      || !detailRefs.length || detailRefs.some(ref => !refs.includes(ref) || !details.some(entry => entry.id === ref && entry.result.id === recordId))) {
      return `记录 ${recordId} 已取得参数详情，必须在 parameterReview 中引用本记录 detail，分别说明输入/请求、响应/结果、差异和缺失；不能只复述状态或上游错误。`;
    }
    const codeRefs = strings(review.codeRefs, 12);
    if (codeRefs.some(ref => !refs.includes(ref) || !evidence.some(entry => entry.id === ref && isImplementationRead(entry)))
      || answer.certainty !== 'needs_info' && !codeRefs.length) return `记录 ${recordId} 的参数分析须引用实际读取的实现；源码不可用时使用 needs_info 保留已有事实。`;
  }
}
function parameterFacts(evidence: SupportEvidence[], options: InvestigationContext, answer?: InvestigationAnswer): string {
  const details = parameterDetails(evidence, options);
  const reviews = Array.isArray(answer?.parameterReview) ? answer.parameterReview : [];
  const facts = [...new Set(details.map(entry => entry.result.id))].map(recordId => {
    const entries = details.filter(entry => entry.result.id === recordId);
    const review = reviews.find(item => item && item.recordId === recordId);
    const prefix = `${entries.map(entry => entry.id).join('/')} 记录 ${safeText(recordId, 160)}`;
    if (review) return `${prefix}\n输入/请求：${safeText(review.request, 800)}\n响应/结果：${safeText(review.response, 800)}\n对照结果：${safeText(review.finding, 800)}`;
    const exchange = entries[0].result.exchange as Record<string, { state?: string; truncated?: boolean; fields?: Record<string, unknown>[] }>;
    const coverage = Object.entries(exchange || {}).map(([side, part]) => {
      const fields = (part.fields || []).filter(field => Object.hasOwn(field, 'value')).slice(0, 6)
        .map(field => `${safeText(field.path, 160)}=${safeText(JSON.stringify(field.value), 180)}`).join('；');
      return `${side}：${part.state === 'available' ? `已读取脱敏参数${fields ? `（${fields}）` : ''}` : '未取得可解析参数'}${part.truncated ? '（该页有裁剪）' : ''}`;
    }).join('；');
    return `${prefix}：${coverage}。参数与代码的对照分析尚未通过校验，不据此确认原因。`;
  });
  return facts.length ? `实际参数与实现对照\n${facts.join('\n\n')}` : '';
}

function groundedSolutionSteps(answer: InvestigationAnswer, evidence: SupportEvidence[], relatedIds: Set<string>): string[] {
  const refs = strings(answer.evidenceRefs, 48);
  const solutions = strings(answer.solutions);
  const proofs = Array.isArray(answer.solutionProofs) ? answer.solutionProofs.slice(0, 6) : [];
  return solutions.filter((step, index) => proofs.some(proof => {
    if (!proof || typeof proof !== 'object' || proof.index !== index || !['read_only', 'workaround', 'developer'].includes(proof.kind)) return false;
    if (/重新生成|重跑|删除|清空|重置|覆盖|停用|sudo|\b(?:ssh|curl|kill|SQL)\b/i.test(step)) return false;
    const code = evidence.find(entry => entry.id === proof.codeRef && refs.includes(entry.id) && isImplementationRead(entry));
    const excerpt = safeText(proof.codeExcerpt, 1600);
    const runtime = code && evidence.find(entry => entry.tool === 'runtime' && !isEvidenceFailure(entry)
      && entry.result.requestedSource === code.result.system && entry.result.status === 'verified'
      && entry.result.revision === code.result.revision && entry.result.mode === code.result.mode);
    const context = evidence.find(entry => entry.id === proof.evidenceRef && refs.includes(entry.id) && !isEvidenceFailure(entry)
      && evidenceRows(entry).some(row => row.id === proof.recordId && isLinked(row, relatedIds)));
    return !!(runtime && context && code && excerpt.length >= 16 && (code.result.matches as { excerpt: string }[])
      .some(match => safeText(match.excerpt, 5000).includes(excerpt)));
  }));
}

function assessEvidence(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext) {
  const refs = strings(answer.evidenceRefs, 48);
  const cited = evidence.filter(entry => refs.includes(entry.id) && !isEvidenceFailure(entry));
  const recordIds = strings(answer.recordIds, 48);
  const codeRead = cited.some(isImplementationRead);
  const matchedCode = cited.filter(entry => isImplementationRead(entry)
    && entry.result.revision === options.codeSource.revision && entry.result.mode === options.codeSource.mode
    && (!entry.result.system || entry.result.system === options.target)
    && (entry.result.matches as { path: string }[]).every(match => serviceForCodePath(match.path) === options.target));
  const linkedRecord = cited.some(entry => entry.result.system === options.target && ['operations', 'logs', 'detail', 'chain', 'generation'].includes(entry.tool)
    && evidenceRows(entry).some(row => recordIds.includes(String(row.id)) && isLinked(row, options.relatedIds)));
  const linkedAnomaly = cited.some(entry => entry.result.system === options.target && evidenceRows(entry).some(row => recordIds.includes(String(row.id))
    && isAnomaly(row) && isLinked(row, options.relatedIds)));
  const proof = answer.causeProof && typeof answer.causeProof === 'object' ? answer.causeProof as Record<string, unknown> : {};
  const chain = cited.find(entry => entry.id === proof.chainRef && entry.tool === 'chain' && entry.result.system === options.target);
  const root = chain?.result.root as { key?: string; value?: string } | undefined;
  const row = chain && evidenceRows(chain).find(item => item.id === proof.recordId && recordIds.includes(String(item.id)) && isAnomaly(item));
  const errorExcerpt = safeText(proof.errorExcerpt, 1200);
  const observedFailure = upstreamFailureEvidence(cited.filter(entry => entry.id === proof.evidenceRef), options).find(failure => failure.row.id === proof.recordId && recordIds.includes(String(failure.row.id))
    && errorExcerpt.length >= 8 && failure.error.includes(errorExcerpt));
  const observationExcerpt = safeText(proof.observationExcerpt, 600);
  const observedGeneration = generationFindingEvidence(cited.filter(entry => entry.id === proof.evidenceRef), options.relatedIds)
    .find(finding => finding.row.id === proof.recordId && recordIds.includes(String(finding.row.id)) && observationExcerpt.length >= 8
      && [finding.row.message, finding.row.instructionExcerpt].some(value => safeText(value, 1200).includes(observationExcerpt)));
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
  return { cited, codeRead, linkedRecord, linkedAnomaly, causalChain, observedFailure, observedGeneration, canConfirm: options.runtimeVerified && matchedCode.length > 0 && (options.intent === 'product' || causalChain) };
}

function assertsConfirmedCause(answer: InvestigationAnswer): boolean {
  const text = [safeText(answer.summary), safeText(answer.cause), ...strings(answer.solutions)].join('\n');
  const assertion = /(?:已(?:经)?(?:确认|核实|证实|查明|定位)|确定)[^，。；;\n!?！？]{0,16}(?:根因|故障原因)|(?:根因|故障原因)[^，。；;\n!?！？]{0,8}(?:已(?:经)?(?:确认|核实|证实|查明|定位)|确定|就是)/g;
  return Array.from(text.matchAll(assertion)).some(match => !/(?:尚未|未能|无法|不能|不可|没有|未|不)/.test(match[0])
    && !/(?:尚未|未能|无法|不能|不可|没有|未|不)[^，。；;\n]{0,6}$/.test(text.slice(Math.max(0, match.index! - 12), match.index)));
}

export function validateInvestigationAnswer(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): string | undefined {
  if (!safeText(answer.summary) || !safeText(answer.cause) || !strings(answer.solutions).length) return '必须返回 summary、cause 和非空 solutions。';
  if (!['confirmed', 'observed', 'likely', 'needs_info'].includes(String(answer.certainty))) return 'certainty 必须是 confirmed、observed、likely 或 needs_info。';
  const refs = strings(answer.evidenceRefs, 48);
  if (refs.some(ref => !evidence.some(entry => entry.id === ref && !isEvidenceFailure(entry)))) return 'evidenceRefs 包含不存在或失败的证据。';
  const ids = strings(answer.recordIds, 48);
  if (ids.some(id => !evidence.some(entry => refs.includes(entry.id) && evidenceRows(entry).some(row => row.id === id)))) return 'recordIds 必须来自引用证据中实际返回的记录。';
  if (answer.certainty === 'confirmed' && options.collectionGaps?.length) return '必需取证仍有缺口，不能确认完整根因：' + options.collectionGaps.join('；');
  const assessment = assessEvidence(answer, evidence, options);
  const generationIssue = validateGenerationReview(answer, evidence, options);
  if (generationIssue) return generationIssue;
  const parameterIssue = validateParameterReview(answer, evidence, options);
  if (parameterIssue) return parameterIssue;
  if (options.intent === 'incident' && answer.certainty === 'likely' && !assessment.linkedRecord) return 'likely 必须引用同一业务服务、本次编号关联的实际记录，并在 recordIds 中列出；没有相关证据时仍应充分说明已查事实，用 needs_info，不凭截图或无关候选猜测。';
  if (options.intent === 'incident' && ['likely', 'needs_info'].includes(String(answer.certainty)) && assertsConfirmedCause(answer)) return '未核实的分析不能宣称已确认内部根因；请区分已知事实、待验证分析与具体缺口。';
  if (options.intent === 'incident' && ['confirmed', 'observed'].includes(String(answer.certainty))
    && /更像是|推测|大概|似乎|应该是|可能[^。\n]{0,20}(?:导致|原因|触发)/.test([answer.summary, answer.cause].join('\n'))) return '已核实故障或接口错误的答复不能包含推测性原因。';
  if (answer.certainty === 'observed') {
    if (options.intent !== 'incident' || (!assessment.observedFailure && !assessment.observedGeneration)) return 'observed 必须引用本次编号关联的明确上游错误，或 generation 返回的已核实提交异常；causeProof 提供 evidenceRef、recordId 及 errorExcerpt / observationExcerpt 连续原文至少8字，不接受状态码、用户转述或无关候选。';
    if (assertsConfirmedCause(answer)) return 'observed 只确认上游明示错误或已核实的生成提交异常，不能宣称已定位平台内部代码根因。请区分记录事实与未核实的内部归因。';
    return undefined;
  }
  const code = evidence.filter(entry => entry.tool === 'code' && Array.isArray(entry.result.matches) && entry.result.matches.length);
  if ((options.intent === 'product' || answer.certainty === 'confirmed') && code.length && !code.some(entry => refs.includes(entry.id) && isImplementationRead(entry))) return '不能只凭搜索命中或文档回答；须用 code 的 path+line 读取相关业务实现并引用。已有本次上游明确拒绝日志时可改用 observed，无需源码匹配。';
  if (!assessment.canConfirm && (answer.certainty === 'confirmed' || assertsConfirmedCause(answer))) {
    return options.intent === 'incident'
      ? '故障尚未核实（平台内部根因）：confirmed 必须有本次完整链路、真实错误与匹配运行实现的 causeProof，且版本已核验。若已有本次 api_call_logs 的明确拒绝原因，请用 observed 引用该条日志解释错误与其明示的处理要求；不必等待源码。否则继续取证或返回 needs_info。'
      : '尚未满足运行版本一致及实现读取要求；请说明源码依据及限制，不能声称已核实运行行为。';
  }
  return undefined;
}

function rowDescription(row: Record<string, unknown>): string {
  const parts = [safeText(row.id, 120), row.source ? `来源 ${safeText(row.source, 80)}` : '', row.occurredAt ? safeText(String(row.occurredAt), 60) : '',
    row.buildCommit ? `事件运行commit=${safeText(row.buildCommit, 40)}${row.buildDirty === true ? '（dirty）' : row.buildDirty === false ? '' : '（clean状态未知）'}` : '',
    row.route ? safeText(row.route, 200) : '', row.httpStatus ? `HTTP ${row.httpStatus}` : safeText(row.status ?? row.taskStatus ?? row.outcome ?? row.level ?? row.event, 80),
    ...['taskId', 'requestId', 'traceId', 'providerRequestId', 'submissionLogId'].flatMap(key => row[key] ? [`${key}=${safeText(row[key], 120)}`] : [])];
  const error = safeText(row.errorExcerpt, 1200) || failureText(row).replace(/\s+/g, ' ').slice(0, 600);
  const submission = row.source === 'canvas_generation_submission' ? [
    row.submissionVerified === false ? '最终请求尚未核对完整；已读取的历史输入独立可用' : '',
    row.model ? `模型 ${safeText(row.model, 100)}` : '', row.duration !== undefined ? `时长 ${safeText(String(row.duration), 40)}` : '',
    row.generateAudio !== undefined ? `生成音频 ${row.generateAudio === true ? '开启' : row.generateAudio === false ? '关闭' : '未知'}` : '',
    row.audioCount !== undefined ? `实际参考音频 ${Number(row.audioCount)} 个` : '',
    Array.isArray(row.characterVoices) ? `角色样音：${safeText(JSON.stringify(row.characterVoices), 1600)}` : '',
    Array.isArray(row.submittedReferences) ? `实际参考素材：${safeText(JSON.stringify(row.submittedReferences), 2000)}` : '',
  ].filter(Boolean).join('；') : '';
  const finding = row.recordType === 'generation_finding' ? [row.speakingCue ? `对白依据：${safeText(row.speakingCue, 600)}` : '',
    row.instructionExcerpt ? `提交标记：${safeText(row.instructionExcerpt, 600)}` : ''].filter(Boolean).join('\n') : '';
  return `${parts.filter(Boolean).join(' · ')}${error ? `\n错误 / 记录原文：${error}` : ''}${submission ? `\n提交核对：${submission}。任务状态不代表成片质量已验收。` : ''}${finding ? `\n${finding}` : ''}`;
}
function investigationRecords(evidence: SupportEvidence[], options: InvestigationContext) {
  const records = new Map<string, { entry: SupportEvidence; row: Record<string, unknown> }>();
  for (const entry of evidence) {
    if (isEvidenceFailure(entry) || !(options.services || [options.target]).includes(entry.result.system as SupportServiceId)
      || !['operations', 'logs', 'detail', 'chain', 'generation'].includes(entry.tool)) continue;
    for (const row of evidenceRows(entry)) {
      if (!isAnomaly(row) && !isLinked(row, options.relatedIds)) continue;
      const key = `${entry.result.system}:${row.source || row.recordType || entry.tool}:${row.id}`;
      const previous = records.get(key);
      if (!previous || failureText(row).length > failureText(previous.row).length) records.set(key, { entry, row });
    }
  }
  return [...records.values()].sort((a, b) => Number(isLinked(b.row, options.relatedIds)) - Number(isLinked(a.row, options.relatedIds))
    || Number(isAnomaly(b.row)) - Number(isAnomaly(a.row)));
}
function recordFacts(records: ReturnType<typeof investigationRecords>, ids: Set<string>): string[] {
  const facts = records.slice(0, 12).map(({ entry, row }) => `${entry.id} [${entry.result.system}] ${isLinked(row, ids)
    ? '编号关联记录' : '候选异常，尚未确认属于本次反馈'}：${rowDescription(row)}`);
  if (records.length > 12) facts.push(`另有 ${records.length - 12} 条已查记录未逐条展开；以上优先列编号关联记录及异常。`);
  return facts;
}
function answerBoundaries(answer?: InvestigationAnswer): string {
  if (!answer) return '';
  return [answer.certainty !== 'observed' && answer.certainty !== 'confirmed'
    ? `${answer.certainty === 'likely' ? '补充分析（尚未确认，不作为根因）' : '补充已知情况与调查边界'}\n${safeText(answer.summary, 1800)}\n${safeText(answer.cause)}` : '',
  strings(answer.limitations, 12).length ? `未核实部分\n${strings(answer.limitations, 12).join('\n')}` : '',
  strings(answer.missingInfo, 12).length ? `仍需核对\n${strings(answer.missingInfo, 12).join('\n')}` : ''].filter(Boolean).join('\n\n');
}
function assetSnapshotDescription(row: Record<string, unknown>): string {
  const representations = Array.isArray(row.representations) ? row.representations : [];
  const unavailable = representations.filter(item => item.resourceVisible === false).length;
  return `素材 ${safeText(row.assetTitle, 120) || safeText(row.assetId, 120)}（assetId=${safeText(row.assetId, 120)}）：`
    + `主版本记录${row.primaryVersionPresent ? '存在' : '缺失或未设置'}，版本 ${row.versionNumber ?? '无'}${row.isPrimary ? '（当前主版本）' : ''}，图片/媒体绑定 ${Number(row.representationCount) || 0}，`
    + `服装绑定 ${Number(row.costumeCount) || 0}，分镜引用 ${Number(row.shotReferenceCount) || 0}；`
    + `本次返回绑定中资源记录缺失或不可见 ${unavailable}。快照时间 ${safeText(String(row.snapshotAt), 60)}。`
    + '这不是历史变更记录，不证明何时丢失或物理文件已删除。';
}
export function evidenceDescription(entry: SupportEvidence): string {
  if (isEvidenceFailure(entry)) return `${entry.id} ${entry.tool}：${safeText(entry.result.error, 160)}`;
  if (entry.tool === 'runtime') return `${entry.id} 运行环境：${safeText(entry.result.description, 350) || '已采集，版本是否匹配见限制说明'}`;
  if (entry.tool === 'code') {
    const matches = Array.isArray(entry.result.matches) ? entry.result.matches : [];
    const match = matches.find(item => item && typeof item.path === 'string' && isSupportCodePath(item.path) && Number.isInteger(item.line));
    return match ? `${entry.id} ${supportServices[serviceForCodePath(match.path)].label} ${entry.result.read ? '已读取实现' : '搜索命中'}：${match.path}:${match.line}（${entry.result.mode === 'working-tree' ? '开发工作树' : String(entry.result.revision || '').slice(0, 12)}）`
      : `${entry.id} 源码：本次检索未命中，不能据此断言功能不存在`;
  }
  const rows = evidenceRows(entry);
  if (entry.tool === 'generation') {
    const finding = rows.find(row => row.recordType === 'generation_finding');
    if (rows[0]?.inputFactsAvailable) {
      const counts = rows[0].referenceCounts as Record<string, unknown>;
      return `${entry.id} 已读取任务输入：参考图片 ${counts.referenceImages ?? '未知'} 张、音频 ${counts.referenceAudios ?? '未知'} 个、视频 ${counts.referenceVideos ?? '未知'} 个；提示词与模型设置已分别保留。${entry.result.incomplete ? '最终请求仍有缺口，不等于任务输入不可读。' : ''}`;
    }
    if (entry.result.incomplete || entry.result.truncated) return `${entry.id} 生成提交尚未完整核对：${safeText(entry.result.note, 350) || '不能据此确认样音是否发送。'}`;
    return finding ? `${entry.id} 生成提交核对：${safeText(finding.message, 500)}`
      : `${entry.id} 生成提交核对：${rows.length ? `任务状态 ${safeText(rows[0].status, 40)}；实际参考音频 ${rows[0].audioCount ?? '未知'} 个；状态成功不代表成片质量达标。` : safeText(entry.result.note, 300)}`;
  }
  if (entry.tool === 'detail' && entry.result.parameterCoverage) return `${entry.id} 参数详情：${safeText(entry.result.id, 160)}；${entry.result.parameterCoverage === 'queried' ? `已读取授权记录的脱敏输入/请求及结果/响应${entry.result.incomplete ? '，仍有缺失或分页，不能称完整报文' : ''}` : '仅有元数据，当前来源未提供请求/响应参数'}`;
  if (entry.tool === 'assets') return `${entry.id} 素材当前快照：${rows.length ? assetSnapshotDescription(rows[0]) : safeText(entry.result.note, 350)}`;
  const row = rows.find(isAnomaly) || rows[0];
  return row ? `${entry.id} ${entry.tool === 'operations' ? '操作记录' : entry.tool === 'chain' ? '请求链路' : '日志'}：${rowDescription(row)}`
    : `${entry.id} ${entry.tool === 'operations' ? '操作记录' : '日志'}：${safeText(entry.result.note, 220) || '限定范围内无匹配记录'}`;
}
function rangeDescription(scope?: InvestigationScope) {
  if (!scope) return '本次未取得明确的故障发生时间范围。';
  if (!scope.from || !scope.to) return '按任务/请求/链路编号定位；各数据源查询时限见取证记录。';
  const title = scope.timeBasis === 'reported' ? '用户选择的发生时间段' : scope.timeBasis === 'interpreted' ? `按用户时间描述“${safeText(scope.timeText, 120)}”解析的候选窗口（待确认）` : '最近24小时候选窗口（不是已确认的故障时间）';
  return `${title}${scope.timeZone ? `（${scope.timeZone}）` : ''}：${scope.from} 至 ${scope.to}${scope.projectId ? `；项目 ${scope.projectId}` : ''}。`;
}
const evidenceGap = /扫描上限|范围尚未读完|截断|未配置|未接入|缺失|缺表|不可用(?!于)|未找到|未执行|未覆盖|不支持|无可靠关联|失败|暂不|暂无/;

function buildUnresolvedIncident(evidence: SupportEvidence[], options: InvestigationContext): DiagnosisResult {
  const actual = evidence.filter(entry => supportServiceId(entry.result.system) && (options.services || [options.target]).includes(entry.result.system as SupportServiceId));
  const records = investigationRecords(evidence, options);
  const facts = recordFacts(records, options.relatedIds);
  if (!facts.length) facts.push('在本次已查询的范围内，未取得可关联的异常请求记录；这不代表问题未发生。');
  const assetEvidence = actual.filter(entry => entry.tool === 'assets');
  const targetedAssets = new Set(assetEvidence.flatMap(entry => {
    const scope = entry.result.scope as Record<string, unknown> | undefined;
    return typeof scope?.assetId === 'string' ? [scope.assetId] : [];
  }));
  const snapshots = [...new Map(assetEvidence.flatMap(entry => evidenceRows(entry)
    .filter(row => row.source === 'canvas_asset_snapshot').map(row => [`${row.assetId}:${row.versionId}`, { entry, row }] as const))).values()];
  snapshots.sort((a, b) => Number(targetedAssets.has(String(b.row.assetId))) - Number(targetedAssets.has(String(a.row.assetId)))
    || Number(b.row.isPrimary) - Number(a.row.isPrimary) || Number(a.row.representationCount) - Number(b.row.representationCount));
  const snapshotFacts = snapshots.slice(0, 4).map(({ entry, row }) => {
    // Pair versions from the same query only; current bindings never establish historical deletion or its cause.
    // 只对照同一次查询中的版本；当前绑定不证明历史删除行为或变化原因。
    const otherVersions = row.isPrimary && Number(row.representationCount) === 0 ? snapshots.filter(item => item.entry.id === entry.id
      && item.row.assetId === row.assetId && item.row.versionId !== row.versionId && Number(item.row.representationCount) > 0).slice(0, 3) : [];
    const comparison = otherVersions.map(item => `版本 ${item.row.versionNumber}（versionId=${safeText(item.row.versionId, 120)}）有 ${Number(item.row.representationCount)} 个图片/媒体绑定`).join('；');
    return `${entry.id} [canvas] ${assetSnapshotDescription(row)}${comparison ? `\n同次查询中该素材其他版本：${comparison}。这只说明不同版本当前绑定不同，不证明图片何时消失，也不证明物理文件可读。` : ''}`;
  });
  const gaps = [!options.runtimeVerified ? '实际运行版本尚未与所读实现核验一致，不能确认运行根因。' : '',
    '内部实现的因果关系尚未全部核实；这只限制最终根因确认，不影响说明已经取得的任务记录、错误及相关实现依据。'];
  const sourceGaps: string[] = [];
  for (const entry of actual) {
    if (entry.result.applicable === false) continue;
    if (Array.isArray(entry.result.coverage)) {
      const skipped = entry.result.coverage.filter(item => item && item.status !== 'queried');
      for (const status of new Set(skipped.map(item => item.status))) {
        const sources = skipped.filter(item => item.status === status);
        sourceGaps.push(`${supportServices[entry.result.system as SupportServiceId].label}：${safeText(sources.map(item => item.table).join(', '), 200)} 未覆盖；${safeText(sources[0]?.note, 240)}`);
      }
    }
    if (isEvidenceFailure(entry)) gaps.push(safeText(entry.result.error, 240));
    const coverage = entry.result.coverage as { inboundHttp?: { available?: boolean } } | undefined;
    if (coverage?.inboundHttp?.available === false) gaps.push(`${supportServices[entry.result.system as SupportServiceId].label} 本次查询未取得可验证的原生 HTTP 日志。${safeText(entry.result.note, 350)} 这不等于该服务未接入，也不能证明本次请求经过它。`);
    if (entry.result.note && (entry.result.incomplete || (!evidenceRows(entry).length && evidenceGap.test(String(entry.result.note))))) {
      const note = String(entry.result.note).split(/[。；]/).filter(part => evidenceGap.test(part) && !part.includes('日志源未配置或历史缺失时不能补造记录')).slice(-3).join('；');
      if (note) gaps.push(safeText(note, 300));
    }
    if (entry.result.truncated) gaps.push(entry.tool === 'code' ? `${entry.id} 源码检索/读取有截断，未返回的片段不属于已核对依据。` : `${entry.id} 结果有截断，不能视为完整链路。`);
    if (Array.isArray(entry.result.queries)) for (const query of entry.result.queries) {
      if (query.error) gaps.push(safeText(query.error, 200));
      if (query.incomplete && query.note) gaps.push(safeText(String(query.note).split(/[。；]/).filter(part => evidenceGap.test(part) && !part.includes('日志源未配置或历史缺失时不能补造记录')).slice(-2).join('；'), 250));
    }
  }
  const missingAssetAccess = actual.some(entry => entry.tool === 'assets' && Array.isArray(entry.result.missingSources) && entry.result.missingSources.length);
  const next = missingAssetAccess
    ? '素材数据源缺少只读授权，需管理员补齐上面列出的表权限后继续查询；这不是用户填写信息的问题，无需重新提交相同编号。'
    : snapshots.length
    ? '已查到素材当前状态，但尚未证明变化原因。请确认本次异常对应的角色/素材名称或 assetId，继续核对该素材各版本、图片绑定和关联生成请求；这些快照不能代替昨天的历史状态。'
    : !options.relatedIds.size
    ? options.scope?.timeBasis === 'reported' || options.scope?.timeBasis === 'interpreted'
      ? '请确认上面的时间范围及候选请求是否对应本次异常；若不对应，请补充任务ID或失败请求的 requestId/traceId，继续定位原链路。'
      : '请在“发生时间段”选择异常发生的起止时间，或提供任务ID / requestId / traceId 任一项；助手将按该范围查真实请求，不把最近24小时的任意错误当成本次故障。'
    : '已按提供的编号展开可访问链路；缺失的数据源或版本证据需开发补齐后继续核对，无需重复提供相同编号。';
  const runtimes = [...new Map(evidence.filter(entry => entry.tool === 'runtime').map(entry => [entry.result.requestedSource, entry])).values()];
  const boundaries = [...new Set(actual.filter(entry => entry.result.applicable === false).map(entry => safeText(entry.result.note, 400)))];
  const queried = actual.filter(entry => ['operations', 'logs'].includes(entry.tool)).map(entry => {
    const scope = entry.result.scope as Record<string, unknown> | undefined;
    if (!scope) return '';
    const ids = ['projectId', 'taskId', 'requestId', 'traceId'].flatMap(key => scope[key] ? [`${key}=${safeText(scope[key], 120)}`] : []);
    return `${entry.id} [${entry.result.system}] ${entry.tool}：${scope.from ? safeText(scope.from, 40) : '精确编号，不限起点'} 至 ${scope.to ? safeText(scope.to, 40) : '查询时刻'}${ids.length ? `；${ids.join('，')}` : ''}`;
  }).filter(Boolean).slice(0, 8);
  const code = evidence.filter(isImplementationRead).slice(-3);
  const browser = evidence.filter(entry => entry.tool === 'browser').flatMap(evidenceRows).slice(0, 3);
  const internalSummary = [
    '调查状态（内部根因待核实）\n以下为本次已取得的事实和具体缺口；尚未完成最终归因不代表没有可解释的信息。',
    `查询范围\n${rangeDescription(options.scope)}${queried.length ? `\n${queried.join("\n")}` : ""}`,
    browser.length ? `浏览器失败请求线索（尚未用服务端日志核实）\n${browser.map(rowDescription).join('\n\n')}` : '',
    `实际查到的记录\n${facts.join('\n\n')}`,
    generationFacts(evidence, options),
    snapshotFacts.length ? `素材与绑定当前状态\n${snapshotFacts.join('\n\n')}` : '',
    runtimes.length ? `逐服务运行环境\n${runtimes.map(evidenceDescription).join('\n')}` : '',
    code.length ? `已核对源码（不等于本次故障原因）\n${code.map(evidenceDescription).join('\n')}` : '',
    boundaries.length ? `浏览器取证边界\n${boundaries.join('\n')}` : '',
    `取证缺口\n${[...new Set([...gaps, ...sourceGaps].filter(Boolean))].slice(0, 8).join('\n')}`,
    `继续定位\n${next}\n排查期间不需要重新付费生成、删除素材或修改业务数据。`,
  ].filter(Boolean).join('\n\n');
  const assistantIssue = options.incompleteReason === 'answer_validation' ? '助手本次答复未通过证据校验，已保留调查记录。'
    : options.incompleteReason === 'model_response' ? '助手本次模型分析未完成，已保留调查记录。'
    : options.incompleteReason === 'tool_budget' ? '本次调查已达到工具或步骤上限，已保留调查记录。' : '';
  const linked = records.filter(({ row }) => isLinked(row, options.relatedIds));
  const summary = linked.some(({ row }) => isAnomaly(row))
    ? '查到了这次操作的异常记录，但还没查清具体原因。现在还不能判断是你的操作出了问题。'
    : linked.length || generationInputs(evidence, options).length
    ? '已找到这次任务的记录，但还没查清问题出在哪一步。'
    : snapshots.length ? '已查到素材现在的情况，但还没查清它为什么会变成这样。'
    : '目前还没查到能对应这次问题的记录，暂时不能确定原因。这不代表你遇到的问题不存在。';
  const currentAssets = snapshots.filter(({ row }) => row.isPrimary).slice(0, 2).map(({ row }) => {
    const title = safeText(row.assetTitle, 100) || '这个素材';
    const count = Number(row.representationCount) || 0;
    return count ? `“${title}”当前版本有 ${count} 个图片或视频记录，还没确认这些文件是否能打开。`
      : `“${title}”当前版本没有关联的图片或视频记录，但这不代表文件已被删除。`;
  });
  const needsAdmin = missingAssetAccess || sourceGaps.length > 0 || options.relatedIds.size > 0 || targetedAssets.size > 0;
  const missingInfo = needsAdmin ? [] : snapshots.length ? ['请告诉我具体是哪个角色或素材遇到了问题。']
    : options.scope?.timeBasis === 'reported' || options.scope?.timeBasis === 'interpreted'
    ? ['请补充出问题的任务编号；如果没有，说明是哪个项目或素材。']
    : ['请补充大致发生时间，或在“定位信息”里填一个任务编号。'];
  const reply = userFacingAnswer({ summary, cause: currentAssets.join(' '),
    solutions: [needsAdmin ? '需要管理员或技术人员继续查看，已经提供的信息不用重复发送。' : '先保留当前任务和素材，补充下面的信息后再继续查。',
      '不用为了排查重新付费生成，也先不要删除或重置素材。'], missingInfo,
  }, options, 'needs_info');
  return { userReply: reply, internalSummary: `${internalSummary}${assistantIssue ? `\n\n${assistantIssue}` : ''}`,
    needsDeveloper: true, module: options.target, evidence, guidanceOnly: false };
}

function buildObservedGeneration(findings: GenerationFinding[], evidence: SupportEvidence[], options: InvestigationContext, answer?: InvestigationAnswer): DiagnosisResult {
  const unique = [...new Map(findings.map(finding => [finding.row.id, finding])).values()].slice(0, 12);
  const facts = unique.map(({ entry, row }) => `${entry.id} ${safeText(row.message, 600)}\n样本编号：${safeText(row.sampleResourceId, 120)}；实际创建调用：${safeText(row.submissionLogId, 160)}。`);
  const sources = evidence.filter(entry => isImplementationRead(entry) && entry.result.system === 'yingce-web')
    .flatMap(entry => (entry.result.matches as { path: string; line: number; excerpt: string }[])
      .filter(match => match.excerpt.includes(OMITTED_VOICE_NOTICE)).map(match => {
        const verified = evidence.some(runtime => runtime.tool === 'runtime' && runtime.result.requestedSource === entry.result.system
          && runtime.result.status === 'verified' && runtime.result.revision === entry.result.revision && runtime.result.mode === entry.result.mode);
        const anchor = evidence.filter(search => search.tool === 'code' && !isEvidenceFailure(search) && search.result.read !== true
          && search.result.revision === entry.result.revision && search.result.mode === entry.result.mode)
          .flatMap(search => Array.isArray(search.result.matches) ? search.result.matches : [])
          .find(found => found.path === match.path && Number.isInteger(found.line) && typeof found.excerpt === 'string' && found.excerpt.includes(OMITTED_VOICE_NOTICE));
        const line = anchor?.line ?? match.line;
        return `${entry.id} ${match.path}:${line}（${verified ? '已核对运行版本' : '仅源码参考，尚未与运行版本核验'}）`;
      })).slice(0, 2);
  const steps = answer ? groundedSolutionSteps(answer, evidence, options.relatedIds) : [];
  const unresolved = buildUnresolvedIncident(evidence, options);
  const report = [
    '结论（已定位生成输入异常）\n任务绑定了角色样音、也写有该角色的具名对白，但最终供应商请求没有包含该样音，并出现“未指定对白”的相反标记；任务“成功”不能排除这个输入冲突。',
    `实际查到\n${facts.join('\n\n')}`,
    generationFacts(evidence, options, answer),
    `本次任务记录\n${recordFacts(investigationRecords(evidence, options), options.relatedIds).join('\n\n')}`,
    answerBoundaries(options.incompleteReason ? undefined : answer),
    `问题环节\n参考音频编排 / 生成请求组装。${sources.length ? `\n对应删样音标记的实现：\n${sources.join('\n')}` : '尚未完成该环节对应运行源码的核对。'}`,
    `如何处理\n${[...steps, '请开发先核对该任务的对白识别、样音绑定与参考音频编排，再给出处理方案；现有记录不支持把问题归咎于用户未写对白，也不足以要求用户重传或先改写提示词。',
      '保留原任务和以上样本、创建调用编号用于修复验收，不自动重新付费生成；已生成的视频不会随配置修改而改变。'].map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    '确认范围：以上确认的是参考样音未发送及提交内容冲突，不证明最终旁白音色、口型或其他成片问题的全部原因；媒体效果仍需另行核对。',
  ].join('\n\n');
  const reply = userFacingAnswer({
    summary: '查到一个具体问题：这个任务选用了角色参考声音，但实际生成时没有带上。页面显示“成功”，也不代表声音一定符合预期。',
    cause: '生成时还出现了“未指定对白”的相反记录。这不等于你没写对白，也还不能解释成片里的所有问题。',
    solutions: steps.length ? steps : ['这个问题需要技术人员处理，先保留原任务。'],
    limitations: ['不用为了排查重新付费生成或删除素材；修正设置不会自动改变已经生成的视频，成片效果还需要另外检查。'],
  }, options, 'observed');
  return { ...unresolved, userReply: reply, needsDeveloper: true, module: sources.length ? 'yingce-web' : 'canvas',
    internalSummary: `${report}\n\n${unresolved.internalSummary}` };
}

function buildObservedIncident(failures: UpstreamFailure[], evidence: SupportEvidence[], options: InvestigationContext, answer?: InvestigationAnswer): DiagnosisResult {
  const distinct = new Map<string, UpstreamFailure>();
  for (const failure of failures) if (!distinct.has(failure.error)) distinct.set(failure.error, failure);
  const shown = [...distinct.values()].slice(0, 12);
  const facts = shown.map(({ entry, row, error }) => `${entry.id} [${entry.result.system}] ${safeText(row.taskId || row.requestId || row.traceId, 120)}${row.errorCode ? ` · ${safeText(row.errorCode, 80)}` : ''}\n${error}`);
  if (distinct.size > shown.length) facts.push(`另有 ${distinct.size - shown.length} 条不同的上游错误未逐条展开。`);
  const constraints = [...new Set(shown.flatMap(({ error }) => [...error.matchAll(/[`"']([A-Za-z][A-Za-z0-9_.-]{0,63})[`"']\s+must be\s+[`"']([A-Za-z0-9_.-]{1,64})[`"']/gi)]
    .map(match => `本次调用的接口明确要求参数 ${match[1]} 必须为 ${match[2]}；该要求不能直接套用到其他任务类型。`)))];
  const solutions = [...new Set([...constraints, ...(answer ? strings(answer.solutions) : []),
    ...(answer?.certainty === 'observed' ? [] : ['按本次错误核对预期任务类型与提交参数；要求与目标不一致或页面无法调整时，由开发检查模型路由与请求组装，不盲目改模式或重复付费生成。'])])];
  const unresolved = buildUnresolvedIncident(evidence, options);
  const report = [
    `结论（${generationInputs(evidence, options).some(({ row }) => row.inputFactsAvailable === true) ? '已取得生成任务输入与接口回执' : '已核实上游拒绝原因'}）\n${answer?.certainty === 'observed' ? safeText(answer.summary, 1800) : '已查到与本次编号关联的上游拒绝记录，接口返回的具体原因如下。'}`,
    answer?.certainty === 'observed' ? `原因\n${safeText(answer.cause)}` : '',
    generationFacts(evidence, options, answer),
    `接口错误证据\n${facts.join('\n\n')}`,
    answerBoundaries(answer),
    `${answer && ['likely', 'needs_info'].includes(String(answer.certainty)) ? '核对建议（待验证，不代表修复承诺）' : '如何处理'}\n${solutions.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    '确认范围：接口报错、历史输入、当前资源登记和源码机制属于不同层次的证据；没有完整发送记录时，不能把接口计量、登记大小或源码机制直接当成最终传输与内部根因的证明。',
  ].filter(Boolean).join('\n\n');
  const reply = userFacingAnswer(answer || {
    summary: '处理这次操作的服务没有接受请求。已查到它返回的提示，但还没确认该在哪里调整。',
    cause: `服务提示：${shown.slice(0, 2).map(({ error }) => safeText(error, 500)).join('；')}`,
    solutions: ['如果页面没有提示中提到的设置，请让管理员或技术人员协助处理。', '先保留当前任务，不要反复重试付费生成。'],
    limitations: ['这能说明生成服务为什么拒绝请求，还不能确定问题是在哪一步造成的。'],
  }, options, answer ? String(answer.certainty) : 'observed');
  return { ...unresolved, userReply: reply, needsDeveloper: answer ? answer.needsDeveloper === true : true,
    internalSummary: `${report}\n\n${answer ? safeText(answer.internalSummary, 4000) : ''}\n\n${unresolved.internalSummary}` };
}

function buildEvidenceResult(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): DiagnosisResult {
  const rejected = validateInvestigationAnswer(answer, evidence, options);
  const assessment = assessEvidence(answer, evidence, options);
  // An upstream rejection is independently observable even when implementation attribution is unavailable.
  // 上游拒绝事实可独立核实，不能因内部源码归因缺失而丢弃；无证据的模型正文仍不发布。
  if (options.intent === 'incident') {
    const findings = generationFindingEvidence(evidence, options.relatedIds);
    if (findings.length && (rejected || answer.certainty !== 'confirmed' || !assessment.canConfirm)) {
      return buildObservedGeneration(findings, evidence, options, !rejected ? answer : undefined);
    }
    if (!rejected && answer.certainty === 'observed' && assessment.observedFailure) return buildObservedIncident(upstreamFailureEvidence(evidence, options), evidence, options, answer);
    if (rejected || answer.certainty !== 'confirmed' || !assessment.canConfirm) {
      const failures = upstreamFailureEvidence(evidence, options);
      if (failures.length) return buildObservedIncident(failures, evidence, options, !rejected ? answer : undefined);
      const hasUsefulEvidence = assessment.cited.some(entry => isImplementationRead(entry) || evidenceRows(entry).length > 0);
      if (rejected || options.incompleteReason || !hasUsefulEvidence) return buildUnresolvedIncident(evidence, options);
    }
  }
  if (rejected) answer = {
    certainty: 'needs_info', summary: '这个功能的用法还没查清，暂时不能确定该怎么操作，也不能据此判断它不支持。',
    cause: '已有查询记录已保留，需要技术人员继续查看。', solutions: ['先保留当前内容，不用为排查重新付费生成或删除素材。'],
    limitations: [], evidenceRefs: evidence.filter(entry => !isEvidenceFailure(entry)).map(entry => entry.id), needsDeveloper: true,
  };
  const { cited, codeRead, canConfirm } = assessEvidence(answer, evidence, options);
  const certainty = answer.certainty === 'confirmed' && canConfirm ? 'confirmed'
    : answer.certainty === 'likely' && (options.intent === 'incident' || codeRead) ? 'likely' : 'needs_info';
  const limitations = strings(answer.limitations, 12);
  if (!options.runtimeVerified) limitations.unshift('尚未核对目标业务实际运行版本与检索源码一致；源码结论仅供参考。');
  const summary = safeText(answer.summary, 1800), cause = safeText(answer.cause);
  const status = certainty === 'confirmed' ? '已核实' : certainty === 'likely'
    ? options.intent === 'incident' ? '基于本次证据的初步分析，尚未确认根因' : '源码功能依据，运行行为待核实' : '已知情况与待核实项';
  const shown = [...evidence.filter(entry => entry.tool === 'runtime'), ...cited.filter(entry => entry.tool !== 'runtime')].slice(0, 20);
  const facts = options.intent === 'incident' ? recordFacts(investigationRecords(evidence, options), options.relatedIds) : [];
  const report = [`结论（${status}）\n${summary}`, facts.length ? `已核实的查询事实（不等于根因）\n${facts.join('\n\n')}` : '',
    `${options.intent === 'incident' && certainty !== 'confirmed' ? certainty === 'likely' ? '待验证分析（不是已确认原因）' : '已知依据与调查边界' : '原因 / 功能依据'}\n${cause}`,
    `${options.intent === 'incident' && certainty !== 'confirmed' ? '处理 / 核对建议（尚未验证的步骤不代表修复承诺）' : '如何解决'}\n${strings(answer.solutions).map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    options.intent === 'incident' ? `查询范围\n${rangeDescription(options.scope)}` : '',
    generationFacts(evidence, options, answer),
    `核对证据\n${shown.map(evidenceDescription).join('\n') || '本次未获得可核实证据。'}`,
    limitations.length ? `未核实 / 数据范围\n${[...new Set(limitations)].join('\n')}` : '',
    strings(answer.missingInfo, 12).length ? `还需补充\n${strings(answer.missingInfo, 12).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { userReply: userFacingAnswer(answer, options, certainty), internalSummary: [safeText(answer.internalSummary, 4000), report].filter(Boolean).join('\n\n'),
    needsDeveloper: answer.needsDeveloper === true || options.intent === 'incident' && certainty !== 'confirmed', module: safeText(answer.module, 80) || 'unknown', evidence, guidanceOnly: options.intent === 'product' };
}

export function buildInvestigationResult(answer: InvestigationAnswer, evidence: SupportEvidence[], options: InvestigationContext): DiagnosisResult {
  const result = buildEvidenceResult(answer, evidence, options);
  const gaps = [...new Set(options.collectionGaps || [])].map(gap => safeText(gap, 350));
  const parameters = parameterFacts(evidence, options, validateInvestigationAnswer(answer, evidence, options) ? undefined : answer);
  if (options.relatedUserIssues) {
    const history = options.relatedUserIssues;
    const matches = history.matches.map(issue => `- ${issue.id} ${safeText(issue.title, 160)}（${history.source}:${issue.line}）${issue.status ? `；状态：${safeText(issue.status, 300)}` : ''}`);
    result.internalSummary += `\n\n历史相似问题（仅供调查参考，不是本次证据）\n${history.source}：${history.status}\n${safeText(history.note, 400)}${matches.length ? `\n${matches.join('\n')}` : ''}`;
  }
  if (parameters) result.internalSummary += `\n\n${parameters}`;
  if (gaps.length) result.internalSummary += `\n\n取证覆盖缺口（不等于业务原因）\n${gaps.map(gap => `- ${gap}`).join('\n')}`;
  if (options.questionType) result.internalSummary = `问题分类：${options.questionType}\n${gaps.length ? `取证缺口：${gaps.join('；')}\n` : ''}${result.internalSummary}`;
  return result;
}
