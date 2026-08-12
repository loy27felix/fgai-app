import { estimateLedgerPrice } from './pricing';

export type BillingState = 'confirmed' | 'estimated' | 'unpriced' | 'failed';

export type UsageReportingRow = {
  status?: string | null;
  kind?: string | null;
  model?: string | null;
  resolution?: string | null;
  video_seconds?: number | string | null;
  total_tokens?: number | string | null;
  image_count?: number | string | null;
  duration_ms?: number | string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  reported_cost_usd?: number | string | null;
  estimated_cost_usd?: number | string | null;
  cost_source?: string | null;
};

export type UsageSummary = {
  calls: number;
  chargeableCalls: number;
  failedCalls: number;
  totalTokens: number;
  images: number;
  videoSeconds: number;
  durationMs: number;
  confirmedCostUsd: number;
  estimatedCostUsd: number;
  quotaReservedUsd: number;
  unpricedCalls: number;
  projectIds: Set<string>;
};

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function moneyValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : null;
}

function eligibleForCatalogEstimate(row: UsageReportingRow) {
  return row.status !== 'failed'
    && moneyValue(row.reported_cost_usd) === null
    && moneyValue(row.estimated_cost_usd) === null;
}

/**
 * Add an on-screen estimate only when a historical row has no stored price and
 * the provider did not reject the task. This is deliberately presentation-only:
 * it never writes a guessed amount back to the trusted ledger.
 */
export function withEligibleCatalogEstimate<T extends UsageReportingRow>(row: T): T {
  if (!eligibleForCatalogEstimate(row)) return row;
  const kind = row.kind === 'image' || row.kind === 'video' ? row.kind : 'text';
  const estimate = estimateLedgerPrice({
    kind,
    model: String(row.model || ''),
    resolution: row.resolution,
    videoSeconds: numberValue(row.video_seconds),
  });
  if (!estimate) return row;
  return {
    ...row,
    estimated_cost_usd: estimate.estimatedCostUsd,
    cost_source: 'estimated',
  };
}

export function billingStateFor(row: Pick<UsageReportingRow, 'status' | 'reported_cost_usd' | 'estimated_cost_usd'>): BillingState {
  if (moneyValue(row.reported_cost_usd) !== null) return 'confirmed';
  if (row.status === 'failed') return 'failed';
  if (moneyValue(row.estimated_cost_usd) !== null) return 'estimated';
  return 'unpriced';
}

export function emptyUsageSummary(): UsageSummary {
  return {
    calls: 0,
    chargeableCalls: 0,
    failedCalls: 0,
    totalTokens: 0,
    images: 0,
    videoSeconds: 0,
    durationMs: 0,
    confirmedCostUsd: 0,
    estimatedCostUsd: 0,
    quotaReservedUsd: 0,
    unpricedCalls: 0,
    projectIds: new Set<string>(),
  };
}

export function addUsageToSummary(summary: UsageSummary, row: UsageReportingRow) {
  summary.calls += 1;
  summary.totalTokens += numberValue(row.total_tokens);
  summary.images += numberValue(row.image_count);
  summary.videoSeconds += numberValue(row.video_seconds);
  summary.durationMs += numberValue(row.duration_ms);
  const contextId = row.project_id || row.workspace_id;
  if (contextId) summary.projectIds.add(contextId);

  const state = billingStateFor(row);
  if (row.status === 'failed') summary.failedCalls += 1;
  else summary.chargeableCalls += 1;

  const reported = moneyValue(row.reported_cost_usd);
  const estimated = moneyValue(row.estimated_cost_usd);
  if (state === 'confirmed' && reported !== null) {
    summary.confirmedCostUsd += reported;
    summary.quotaReservedUsd += reported;
  } else if (state === 'estimated' && estimated !== null) {
    summary.estimatedCostUsd += estimated;
    summary.quotaReservedUsd += estimated;
  } else if (state === 'unpriced') {
    summary.unpricedCalls += 1;
  }
  return summary;
}

export function summarizeUsageRows(rows: UsageReportingRow[]): UsageSummary {
  return rows.reduce((summary, row) => addUsageToSummary(summary, row), emptyUsageSummary());
}
