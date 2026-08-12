import { createAdminClient } from '@/lib/supabase/admin';

export const MONTHLY_BUDGET_EXCEEDED = 'MONTHLY_BUDGET_EXCEEDED';
export const MONTHLY_BUDGET_PRICE_UNKNOWN = 'MONTHLY_BUDGET_PRICE_UNKNOWN';

const TEXT_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'deepseek-flash': { input: 0.14, output: 0.28 },
  'deepseek-pro': { input: 0.27, output: 1.1 },
};

export type MonthlyUsageSummary = {
  monthStart: string;
  limitUsd: number | null;
  usedUsd: number;
  remainingUsd: number | null;
  calls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  videoSeconds: number;
  projects: number;
  durationMs: number;
  unknownCostCalls: number;
};

type UsageRow = {
  workspace_id?: string | null;
  project_id?: string | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  total_tokens?: number | string | null;
  image_count?: number | string | null;
  video_seconds?: number | string | null;
  duration_ms?: number | string | null;
  reported_cost_usd?: number | string | null;
  estimated_cost_usd?: number | string | null;
  cost_source?: string | null;
};

type BudgetRow = { limit_usd?: number | string | null } | null;

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function shanghaiYearMonth(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('无法确定当前账期');
  return { year: Number(year), month: Number(month) };
}

/** Monthly quotas follow the Asia/Shanghai calendar month shown to the team. */
export function monthStartKey(date = new Date()) {
  const { year, month } = shanghaiYearMonth(date);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function nextMonthStart(date = new Date()) {
  const { year, month } = shanghaiYearMonth(date);
  return new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000);
}

export function monthStartDate(date = new Date()) {
  const { year, month } = shanghaiYearMonth(date);
  return new Date(Date.UTC(year, month - 1, 1) - 8 * 60 * 60 * 1000);
}
/**
 * Conservative preflight estimate for text calls. Wetoken models without a
 * published price intentionally return null so a configured quota cannot be
 * bypassed by an unknown-priced request.
 */
export function estimateTextBudgetUsd(input: {
  model: string;
  inputText?: string;
  inputTokens?: number;
  maxOutputTokens?: number;
}) {
  const price = TEXT_PRICE_PER_MILLION[input.model];
  if (!price) return null;
  const inputTokens = Number.isFinite(input.inputTokens)
    ? Math.max(1, Math.ceil(input.inputTokens as number))
    : Math.max(1, Math.ceil((input.inputText || '').length / 4));
  const outputTokens = Math.max(1, Math.ceil(input.maxOutputTokens ?? 4000));
  return Number(((inputTokens * price.input + outputTokens * price.output) / 1_000_000).toFixed(10));
}

function monthEndIso(date = new Date()) {
  return nextMonthStart(date).toISOString();
}

function rowCost(row: UsageRow) {
  const cost = row.reported_cost_usd ?? row.estimated_cost_usd;
  return cost === null || cost === undefined ? null : numberValue(cost);
}

export async function getMonthlyUsageSummary(userId: string, date = new Date()): Promise<MonthlyUsageSummary> {
  const admin = createAdminClient();
  const monthStart = monthStartKey(date);
  const [budgetResult, usageResult] = await Promise.all([
    admin.from('ai_usage_budgets').select('limit_usd').eq('user_id', userId).eq('month_start', monthStart).maybeSingle(),
    admin.from('ai_usage_ledger')
      .select('workspace_id,project_id,input_tokens,output_tokens,total_tokens,image_count,video_seconds,duration_ms,reported_cost_usd,estimated_cost_usd,cost_source,status')
      .eq('user_id', userId)
      .gte('created_at', monthStartDate(date).toISOString())
      .lt('created_at', monthEndIso(date))
      .in('status', ['submitted', 'succeeded', 'unknown']),
  ]);
  if (budgetResult.error) throw budgetResult.error;
  if (usageResult.error) throw usageResult.error;

  const rows = (usageResult.data || []) as UsageRow[];
  const projects = new Set<string>();
  const summary = rows.reduce((value, row) => {
    const contextId = row.project_id || row.workspace_id;
    if (contextId) projects.add(contextId);
    value.calls += 1;
    value.inputTokens += numberValue(row.input_tokens);
    value.outputTokens += numberValue(row.output_tokens);
    value.totalTokens += numberValue(row.total_tokens);
    value.images += numberValue(row.image_count);
    value.videoSeconds += numberValue(row.video_seconds);
    value.durationMs += numberValue(row.duration_ms);
    const cost = rowCost(row);
    if (cost === null) value.unknownCostCalls += 1;
    else value.usedUsd += Math.abs(cost);
    return value;
  }, { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, images: 0, videoSeconds: 0, projects: 0, durationMs: 0, usedUsd: 0, unknownCostCalls: 0 });
  summary.projects = projects.size;
  const budget = budgetResult.data as BudgetRow;
  const limitUsd = budget?.limit_usd === null || budget?.limit_usd === undefined ? null : Math.max(0, numberValue(budget.limit_usd));
  return {
    monthStart,
    limitUsd,
    usedUsd: Number(summary.usedUsd.toFixed(10)),
    remainingUsd: limitUsd === null ? null : Number(Math.max(0, limitUsd - summary.usedUsd).toFixed(10)),
    calls: summary.calls,
    totalTokens: summary.totalTokens,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    images: summary.images,
    videoSeconds: summary.videoSeconds,
    projects: summary.projects,
    durationMs: summary.durationMs,
    unknownCostCalls: summary.unknownCostCalls,
  };
}

export async function assertMonthlyBudgetAvailable(input: {
  userId: string;
  estimatedCostUsd: number | null | undefined;
}) {
  const summary = await getMonthlyUsageSummary(input.userId);
  if (summary.limitUsd === null) return { allowed: true as const, summary };
  if (input.estimatedCostUsd === null || input.estimatedCostUsd === undefined || !Number.isFinite(input.estimatedCostUsd)) {
    return {
      allowed: false as const,
      code: MONTHLY_BUDGET_PRICE_UNKNOWN,
      message: '当前模型或参数没有可确认的价格，已启用月度额度后暂不能调用，请联系管理员配置价格。',
      summary,
    };
  }
  const requested = Math.max(0, input.estimatedCostUsd);
  if (summary.usedUsd + requested > summary.limitUsd + 1e-9) {
    return {
      allowed: false as const,
      code: MONTHLY_BUDGET_EXCEEDED,
      message: `已达到本月额度（已用 $${summary.usedUsd.toFixed(6)} / $${summary.limitUsd.toFixed(6)}），本次预计 $${requested.toFixed(6)}。`,
      summary,
    };
  }
  return { allowed: true as const, summary };
}
