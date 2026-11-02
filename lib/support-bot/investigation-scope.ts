import { supportTimeRange, type SupportContext } from './context';

export type InvestigationScope = {
  from?: string;
  to?: string;
  timeBasis: 'reported' | 'interpreted' | 'recent' | 'identifier';
  timeText?: string;
  projectId?: string;
};

export function resolveInvestigationScope(
  context: SupportContext | undefined,
  plan: { from?: string; to?: string; timeText?: string },
  questions: string,
  hasExactId: boolean,
): InvestigationScope {
  const explicit = supportTimeRange(context?.occurredFrom, context?.occurredTo);
  const base = { projectId: context?.projectId };
  if (explicit) return { ...base, ...explicit, timeBasis: 'reported' };
  const interpreted = supportTimeRange(plan.from, plan.to);
  // A model-proposed window is not user-confirmed; retain its literal provenance.
  // 模型解释的时间不是用户确认时间，必须保留原文，不能把候选时间当故障事实。
  if (interpreted && plan.timeText && questions.includes(plan.timeText) && /\d|刚才|刚刚|今天|昨天|前天/.test(plan.timeText)) {
    return { ...base, ...interpreted, timeBasis: 'interpreted', timeText: plan.timeText.slice(0, 120) };
  }
  if (hasExactId) return { ...base, timeBasis: 'identifier' };
  const capturedAt = Date.parse(context?.runtime?.capturedAt || '');
  const to = Number.isFinite(capturedAt) ? capturedAt : Date.now();
  return { ...base, from: new Date(to - 86400000).toISOString(), to: new Date(to).toISOString(), timeBasis: 'recent' };
}
