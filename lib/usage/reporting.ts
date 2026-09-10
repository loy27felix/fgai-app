import { estimateLedgerPrice } from './pricing';

export type BillingState = 'confirmed' | 'estimated' | 'unpriced' | 'failed';

export type UsageReportingRow = {
  status?: string | null;
  kind?: string | null;
  model?: string | null;
  resolution?: string | null;
  video_seconds?: number | string | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  total_tokens?: number | string | null;
  image_count?: number | string | null;
  duration_ms?: number | string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  reported_cost_usd?: number | string | null;
  estimated_cost_usd?: number | string | null;
  cost_source?: string | null;
  /** Media estimates can only be refreshed when original parameters exist. */
  price_snapshot?: Record<string, unknown> | null;
};

export type UsageSummary = {
  calls: number;
  chargeableCalls: number;
  failedCalls: number;
  successfulCalls: number;
  totalTokens: number;
  images: number;
  videoSeconds: number;
  durationMs: number;
  successfulImages: number;
  successfulVideoSeconds: number;
  successfulDurationMs: number;
  successfulCostUsd: number;
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

function snapshotString(row: UsageReportingRow, key: string) {
  const value = row.price_snapshot && typeof row.price_snapshot === 'object'
    ? row.price_snapshot[key]
    : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function snapshotNumber(row: UsageReportingRow, key: string) {
  const value = row.price_snapshot && typeof row.price_snapshot === 'object'
    ? row.price_snapshot[key]
    : undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function hasCurrentPricingSnapshot(row: UsageReportingRow) {
  return snapshotString(row, 'pricing_version') === 'wetoken-account-2026-09-10';
}

function snapshotHasVideoInput(row: UsageReportingRow) {
  const value = row.price_snapshot && typeof row.price_snapshot === 'object'
    ? row.price_snapshot.input_video
    : undefined;
  return value === true || (typeof value === 'number' && value > 0) || value === 'true' || value === '1';
}

/**
 * Refresh ledger estimates using the current verified catalog.
 * Provider-reported charges always win.  Historical media rows without a
 * complete Seedance parameter snapshot become unpriced instead of carrying a
 * legacy guess; this is presentation-only and never overwrites the ledger.
 */
export function withEligibleCatalogEstimate<T extends UsageReportingRow>(row: T): T {
  if (row.status === 'failed' || moneyValue(row.reported_cost_usd) !== null) return row;
  const kind = row.kind === 'image' || row.kind === 'video' ? row.kind : 'text';
  if (kind === 'text') {
    const estimate = estimateLedgerPrice({
      kind,
      model: String(row.model || ''),
      inputTokens: numberValue(row.input_tokens),
      outputTokens: numberValue(row.output_tokens),
    });
    return estimate
      ? { ...row, estimated_cost_usd: estimate.estimatedCostUsd, cost_source: 'estimated' }
      : row;
  }

  // The video dimensions are part of Seedance's token formula. Do not invent
  // a 16:9 default for legacy entries that never saved their ratio. Image
  // reference count likewise must be persisted before re-pricing a task.
  const ratio = snapshotString(row, 'ratio');
  const imageReferenceCount = snapshotNumber(row, 'reference_images');
  const estimate = kind === 'video' && ratio
    ? estimateLedgerPrice({
      kind,
      model: String(row.model || ''),
      resolution: row.resolution,
      videoSeconds: numberValue(row.video_seconds),
      ratio,
      hasVideoReference: snapshotHasVideoInput(row),
      imageReferenceCount,
    })
    : kind === 'image' && hasCurrentPricingSnapshot(row)
      ? estimateLedgerPrice({
        kind,
        model: String(row.model || ''),
        resolution: row.resolution,
        imageReferenceCount,
      })
    : null;
  if (estimate) {
    return { ...row, estimated_cost_usd: estimate.estimatedCostUsd, cost_source: 'estimated' };
  }

  // Unsupported combinations remain awaiting reconciliation instead of
  // carrying a legacy guess. This is presentation-only and never rewrites the
  // source ledger.
  if (moneyValue(row.estimated_cost_usd) !== null || row.cost_source === 'estimated') {
    return { ...row, estimated_cost_usd: null, cost_source: 'unknown' };
  }
  return row;
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
    successfulCalls: 0,
    totalTokens: 0,
    images: 0,
    videoSeconds: 0,
    durationMs: 0,
    successfulImages: 0,
    successfulVideoSeconds: 0,
    successfulDurationMs: 0,
    successfulCostUsd: 0,
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

  // The simple accounting view deliberately only charges successful work.
  // Submitted work can still reserve quota in the server-side guard above,
  // but it is not displayed as spend until the provider marks it successful.
  if (row.status === 'succeeded') {
    summary.successfulCalls += 1;
    summary.successfulImages += numberValue(row.image_count);
    summary.successfulVideoSeconds += numberValue(row.video_seconds);
    summary.successfulDurationMs += numberValue(row.duration_ms);
    if (reported !== null) summary.successfulCostUsd += reported;
    else if (estimated !== null) summary.successfulCostUsd += estimated;
  }
  return summary;
}

export function summarizeUsageRows(rows: UsageReportingRow[]): UsageSummary {
  return rows.reduce((summary, row) => addUsageToSummary(summary, row), emptyUsageSummary());
}
