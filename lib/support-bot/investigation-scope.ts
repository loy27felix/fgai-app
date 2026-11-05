import { supportTimeRange, type SupportContext } from './context';

export type InvestigationScope = {
  from?: string;
  to?: string;
  timeBasis: 'reported' | 'interpreted' | 'recent' | 'identifier';
  timeText?: string;
  timeZone?: string;
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
  const captured = Date.parse(context?.runtime?.capturedAt || '');
  const now = Number.isFinite(captured) ? captured : Date.now();
  const proposed = supportTimeRange(plan.from, plan.to);
  // Do not mix post-submission activity into a model-interpreted incident window.
  // 模型解释的窗口止于本次反馈时间，避免把用户提交后的活动混入原问题取证。
  const interpreted = proposed && supportTimeRange(proposed.from, new Date(Math.min(Date.parse(proposed.to), now)).toISOString());
  // A model-proposed window is not user-confirmed; retain its literal provenance.
  // 模型解释的时间不是用户确认时间，必须保留原文，不能把候选时间当故障事实。
  if (interpreted && plan.timeText && questions.includes(plan.timeText) && /\d|刚才|刚刚|今天|昨天|前天/.test(plan.timeText)) {
    return { ...base, ...interpreted, timeBasis: 'interpreted', timeText: plan.timeText.slice(0, 120) };
  }
  // Relative calendar days use the product's business timezone, not the worker machine's timezone.
  // 相对日期按产品业务时区解释并保留为候选窗口，不依赖 worker 机器时区，也不当作已确认故障时间。
  const relativeDays = questions.match(/前天|昨天|今天/g);
  if (relativeDays?.length) {
    const offsets = relativeDays.map(day => day === '前天' ? 2 : day === '昨天' ? 1 : 0);
    const date = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    const from = midnight - Math.max(...offsets) * 86400000;
    const to = Math.min(now, midnight + (1 - Math.min(...offsets)) * 86400000);
    if (from < to) return { ...base, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      timeBasis: 'interpreted', timeText: [...new Set(relativeDays)].join('、'), timeZone: 'Asia/Shanghai' };
  }
  if (hasExactId) return { ...base, timeBasis: 'identifier' };
  return { ...base, from: new Date(now - 86400000).toISOString(), to: new Date(now).toISOString(), timeBasis: 'recent' };
}
