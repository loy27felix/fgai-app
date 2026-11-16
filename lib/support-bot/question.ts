import { chainSeeds, type ChainSeed } from './chain';
import { identifier, hasIdentifier } from './tools';
import { safeText } from './report';
import { supportInvestigationServiceId, type SupportServiceId } from './services';
import type { SupportJob } from './store';

export type SupportQuestionType = 'usage' | 'help' | 'generation' | 'incident';
export type SupportPlan = {
  intent: 'product' | 'incident'; questionType: SupportQuestionType;
  conversation: 'follow_up' | 'new_question'; resolvedQuestion: string; observations: string;
  target: SupportServiceId; services: SupportServiceId[]; searchTerms: string[];
  identifiers: Record<string, string>; locators: ChainSeed[];
  from?: string; to?: string; timeText?: string;
};

function textIdentifiers(text: string) {
  const rows: Record<string, string>[] = [];
  const excluded = new Set<string>();
  const labels = {
    taskId: '(?:task[_ -]?id|任务\\s*(?:ID|编号|号))',
    requestId: '(?:request[_ -]?id|请求\\s*(?:ID|编号|号))',
    traceId: '(?:trace[_ -]?id|(?:跟踪|追踪|链路)\\s*(?:ID|编号|号))',
  };
  for (const [key, label] of Object.entries(labels)) {
    const pattern = new RegExp(`${label}(?:\\s*[:：=]\\s*|\\s+)[\x60"']?([A-Za-z0-9_][A-Za-z0-9_.:-]{0,119})(?![A-Za-z0-9_.:-])`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(Math.max(0, (match.index || 0) - 12), match.index).trim();
      if (/(?:不是|不要查|忽略|之前的|旧的?|错误的?)\s*$/.test(prefix)) { excluded.add(match[1]); continue; }
      rows.push({ [key]: match[1] });
    }
  }
  return { locators: chainSeeds(rows).filter(seed => !excluded.has(seed.value)), excluded };
}

export function resolveSupportPlan(result: Record<string, unknown>, job: SupportJob, historyQuestions: string, hasImages: boolean): SupportPlan | undefined {
  const rawKind = result.questionType ?? result.intent;
  const questionType = rawKind === 'product' ? 'usage' : rawKind;
  if (!['usage', 'help', 'generation', 'incident'].includes(String(questionType))) return undefined;
  const searchTerms = Array.isArray(result.searchTerms) ? [...new Set(result.searchTerms
    .filter((term): term is string => typeof term === 'string' && !!term.trim() && term.length <= 120 && !/[\r\n\0]/.test(term))
    .map(term => term.trim()))].slice(0, 2) : [];
  if (!safeText(result.resolvedQuestion) || searchTerms.length < 2) return undefined;
  const conversation = result.conversation === 'new_question' || /^(?:换个问题|另一个问题|新问题|另外问|不说这个|先不说这个)/.test(job.text.trim()) ? 'new_question' : 'follow_up';
  const observations = conversation === 'new_question' && !job.images?.length ? '' : safeText(result.observations, 5000);
  const supplied = result.identifiers && typeof result.identifiers === 'object' ? result.identifiers as Record<string, unknown> : {};
  const identifiers: Record<string, string> = {};
  const extracted = textIdentifiers(job.text);
  const current = extracted.locators;
  for (const key of ['taskId', 'requestId', 'traceId', 'sessionId', 'projectId']) {
    const id = identifier(supplied[key]);
    if (!id || extracted.excluded.has(id)) continue;
    if (hasIdentifier(job.text, id)) identifiers[key] = id;
    else if (!current.length && (conversation === 'follow_up' && hasIdentifier(historyQuestions, id)
      || hasImages && job.chatId.startsWith('web:') && hasIdentifier(observations, id))) identifiers[key] = id;
  }
  const currentModelIds = chainSeeds([identifiers]).filter(seed => hasIdentifier(job.text, seed.value)
    && !current.some(labeled => labeled.value === seed.value));
  const explicit = chainSeeds([...current, ...currentModelIds].map(seed => ({ [seed.key]: seed.value })));
  // Current locators replace old conversation/page locators rather than becoming AND filters.
  // 当轮编号替换旧对话/页面编号，不把不同请求拼成 AND 条件。
  if (explicit.length) {
    for (const key of ['sessionId', 'projectId']) if (identifiers[key] && !hasIdentifier(job.text, identifiers[key])) delete identifiers[key];
    for (const key of ['taskId', 'requestId', 'traceId']) delete identifiers[key];
    for (const seed of explicit) identifiers[seed.key] ??= seed.value;
  }
  const plannedLocators = chainSeeds([identifiers]);
  const usePage = job.context?.source === 'canvas' && !explicit.length && !plannedLocators.length && (conversation === 'follow_up' || !historyQuestions);
  const locators = explicit.length ? explicit : chainSeeds([
    ...(plannedLocators.length ? [identifiers] : []),
    ...(usePage ? [job.context || {}] : []),
  ]).filter(seed => !extracted.excluded.has(seed.value));
  return {
    intent: questionType === 'usage' || questionType === 'help' ? 'product' : 'incident',
    questionType: questionType as SupportQuestionType, conversation,
    resolvedQuestion: safeText(result.resolvedQuestion, 4000), observations,
    target: supportInvestigationServiceId(result.target) ?? (job.context?.source === 'canvas' ? 'yingce-web' : 'repository'),
    services: Array.isArray(result.services) ? [...new Set(result.services.map(supportInvestigationServiceId).filter(id => id !== undefined))].slice(0, 2) : [],
    searchTerms, identifiers, locators,
    ...(typeof result.from === 'string' ? { from: result.from } : {}),
    ...(typeof result.to === 'string' ? { to: result.to } : {}),
    ...(typeof result.timeText === 'string' ? { timeText: result.timeText } : {}),
  };
}

export function scopedSupportJob(job: SupportJob, plan: SupportPlan, hasHistory: boolean): SupportJob {
  if (!job.context) return job;
  if (job.context.source !== 'canvas') {
    const { runtime, occurredFrom, occurredTo } = job.context;
    return { ...job, context: { source: job.context.source, runtime, occurredFrom, occurredTo } };
  }
  const samePageTask = plan.locators.some(seed => seed.key === 'taskId' && seed.value === job.context?.taskId);
  const newLocators = plan.locators.some(seed => hasIdentifier(job.text, seed.value));
  const changedSubject = plan.conversation === 'new_question' && hasHistory;
  const context = { ...job.context };
  for (const key of ['taskId', 'requestId', 'traceId'] as const) {
    if (!plan.locators.some(seed => seed.key === key && seed.value === context[key])) delete context[key];
  }
  const detachedLocators = plan.locators.length > 0 && !samePageTask && !plan.locators.some(seed => job.context?.[seed.key] === seed.value);
  if (changedSubject || newLocators && !samePageTask || detachedLocators) {
    delete context.projectId;
    delete context.sessionId;
    context.browserRequests = [];
  }
  return { ...job, context };
}
