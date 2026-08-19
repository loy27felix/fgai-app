import { createAdminClient } from '@/lib/local/admin';
import { randomId } from '@/lib/utils';
import type { MediaPrice } from './pricing';

type TextUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | undefined;

export type TextLedgerEntry = {
  request_id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  creator_task_id: null;
  kind: 'text';
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  cost_source: 'estimated' | 'unknown';
  price_snapshot: Record<string, string | number>;
  duration_ms?: number;
  status: 'succeeded';
  possibly_charged: true;
};

export type ImageLedgerEntry = {
  request_id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  creator_task_id: string | null;
  kind: 'image';
  provider: string;
  model: string;
  image_count: number;
  resolution: string;
  reported_cost_usd?: number;
  estimated_cost_usd?: number;
  cost_source: 'reported' | 'estimated' | 'unknown';
  price_snapshot: Record<string, string | number>;
  duration_ms?: number;
  status: UsageLedgerStatus;
  possibly_charged: true;
};

export type VideoLedgerEntry = {
  request_id: string;
  provider_request_id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  creator_task_id: string | null;
  kind: 'video';
  provider: string;
  model: string;
  video_seconds: number;
  resolution: string;
  generate_audio: boolean;
  reported_cost_usd?: number;
  estimated_cost_usd?: number;
  cost_source: 'reported' | 'estimated' | 'unknown';
  price_snapshot: Record<string, string | number>;
  duration_ms?: number;
  status: 'submitted';
  possibly_charged: true;
};

const DEEPSEEK_PRICES = {
  'deepseek-flash': { input: 0.14, output: 0.28 },
  'deepseek-pro': { input: 0.435, output: 0.87 },
} as const;

function deepseekEstimate(model: string, inputTokens: number, outputTokens: number) {
  const price = DEEPSEEK_PRICES[model as keyof typeof DEEPSEEK_PRICES];
  if (!price) return null;
  const cost = Number(((inputTokens * price.input + outputTokens * price.output) / 1_000_000).toFixed(10));
  return {
    cost,
    snapshot: {
      currency: 'USD',
      unit: '1M tokens',
      input_per_million: price.input,
      output_per_million: price.output,
      assumption: 'cache_miss',
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
    },
  };
}

type LedgerUpsertOptions = { onConflict: 'request_id' };

type LedgerWriter = {
  upsert(
    row: TextLedgerEntry | ImageLedgerEntry | VideoLedgerEntry,
    options?: LedgerUpsertOptions,
  ): Promise<unknown>;
};

function tokenCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value! : 0;
}
type MediaLedgerPricing = {
  pricing?: MediaPrice | null;
  reportedCostUsd?: number;
};

function mediaCostFields(input: MediaLedgerPricing) {
  if (typeof input.reportedCostUsd === 'number' && Number.isFinite(input.reportedCostUsd)) {
    return {
      reported_cost_usd: Math.abs(input.reportedCostUsd),
      cost_source: 'reported' as const,
      price_snapshot: input.pricing?.snapshot || { currency: 'USD', source: 'provider_response' },
    };
  }
  if (input.pricing) {
    return {
      estimated_cost_usd: input.pricing.estimatedCostUsd,
      cost_source: 'estimated' as const,
      price_snapshot: input.pricing.snapshot,
    };
  }
  return { cost_source: 'unknown' as const, price_snapshot: {} };
}
export function buildTextLedgerEntry(input: {
  requestId?: string;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: string;
  model: string;
  usage: TextUsage;
  durationMs?: number;
}): TextLedgerEntry {
  const inputTokens = tokenCount(input.usage?.prompt_tokens);
  const outputTokens = tokenCount(input.usage?.completion_tokens);
  const estimate = input.provider === 'deepseek'
    ? deepseekEstimate(input.model, inputTokens, outputTokens)
    : null;
  return {
    request_id: input.requestId || randomId(),
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    creator_task_id: null,
    kind: 'text',
    provider: input.provider,
    model: input.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: tokenCount(input.usage?.total_tokens) || inputTokens + outputTokens,
    ...(estimate ? { estimated_cost_usd: estimate.cost } : {}),
    cost_source: estimate ? 'estimated' : 'unknown',
    price_snapshot: estimate?.snapshot || {},
    ...(Number.isFinite(input.durationMs) && (input.durationMs || 0) >= 0 ? { duration_ms: Math.floor(input.durationMs || 0) } : {}),
    status: 'succeeded',
    possibly_charged: true,
  };
}

export function buildImageLedgerEntry(input: {
  requestId?: string;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: string;
  model: string;
  resolution: string;
  pricing?: MediaPrice | null;
  reportedCostUsd?: number;
  durationMs?: number;
}): ImageLedgerEntry {
  return {
    request_id: input.requestId || randomId(),
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    creator_task_id: null,
    kind: 'image',
    provider: input.provider,
    model: input.model,
    image_count: 1,
    resolution: input.resolution,
    ...mediaCostFields(input),
    ...(Number.isFinite(input.durationMs) && (input.durationMs || 0) >= 0 ? { duration_ms: Math.floor(input.durationMs || 0) } : {}),
    status: 'succeeded',
    possibly_charged: true,
  };
}

export function buildCreatorImageLedgerEntry(input: {
  requestId: string;
  userId: string;
  workspaceId: string;
  creatorTaskId: string;
  model: string;
  resolution: string;
  pricing?: MediaPrice | null;
  reportedCostUsd?: number;
  durationMs?: number;
}): ImageLedgerEntry {
  return {
    request_id: input.requestId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
    project_id: null,
    creator_task_id: input.creatorTaskId,
    kind: 'image',
    provider: 'wetoken',
    model: input.model,
    image_count: 1,
    resolution: input.resolution,
    ...mediaCostFields(input),
    ...(Number.isFinite(input.durationMs) && (input.durationMs || 0) >= 0 ? { duration_ms: Math.floor(input.durationMs || 0) } : {}),
    status: 'submitted',
    possibly_charged: true,
  };
}

export function buildVideoLedgerEntry(input: {
  requestId: string;
  providerRequestId: string;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: string;
  model: string;
  duration: number;
  resolution: string;
  generateAudio: boolean;
  creatorTaskId?: string | null;
  pricing?: MediaPrice | null;
  reportedCostUsd?: number;
  durationMs?: number;
}): VideoLedgerEntry {
  return {
    request_id: input.requestId,
    provider_request_id: input.providerRequestId,
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    creator_task_id: input.creatorTaskId ?? null,
    kind: 'video',
    provider: input.provider,
    model: input.model,
    video_seconds: input.duration > 0 ? input.duration : 0,
    resolution: input.resolution,
    generate_audio: input.generateAudio,
    ...mediaCostFields(input),
    ...(Number.isFinite(input.durationMs) && (input.durationMs || 0) >= 0 ? { duration_ms: Math.floor(input.durationMs || 0) } : {}),
    status: 'submitted',
    possibly_charged: true,
  };
}
export type UsageLedgerStatus = 'submitted' | 'succeeded' | 'failed' | 'unknown';

export function normalizeVideoLedgerStatus(status: string): UsageLedgerStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'expired') return 'failed';
  if (status === 'queued' || status === 'running') return 'submitted';
  return 'unknown';
}

export async function updateVideoUsageBestEffort(input: {
  requestId: string;
  providerStatus: string;
  completedAt?: string | null;
  reportedCostUsd?: number;
  priceSnapshot?: Record<string, string | number>;
}): Promise<boolean> {
  try {
    const values: Record<string, unknown> = {
      status: normalizeVideoLedgerStatus(input.providerStatus),
      completed_at: input.completedAt ?? null,
    };
    if (typeof input.reportedCostUsd === 'number' && Number.isFinite(input.reportedCostUsd)) {
      values.reported_cost_usd = Math.abs(input.reportedCostUsd);
      values.cost_source = 'reported';
      values.price_snapshot = input.priceSnapshot || { currency: 'USD', source: 'provider_response' };
    }
    const result = await createAdminClient()
      .from('ai_usage_ledger')
      .update(values)
      .eq('request_id', input.requestId);
    return !result.error;
  } catch {
    return false;
  }
}

type ImageStatusWriter = {
  update(values: object, requestId: string): Promise<unknown>;
};

function hasLedgerError(result: unknown): boolean {
  if (result === null || typeof result !== 'object' || !('error' in result)) {
    return false;
  }
  const error = (result as { error?: unknown }).error;
  return error !== null && error !== undefined;
}

function hasUpdatedLedgerRow(result: unknown, requestId: string): boolean {
  if (result === null || typeof result !== 'object') return false;
  const payload = result as { error?: unknown; data?: unknown };
  if (payload.error !== null && payload.error !== undefined) return false;
  if (payload.data === null || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    return false;
  }
  return (payload.data as { request_id?: unknown }).request_id === requestId;
}

export async function recordUsageRequired(
  row: ImageLedgerEntry | VideoLedgerEntry,
  dependency?: LedgerWriter,
): Promise<void> {
  const options: LedgerUpsertOptions = { onConflict: 'request_id' };
  const result = dependency
    ? await dependency.upsert(row, options)
    : await createAdminClient()
      .from('ai_usage_ledger')
      .upsert(row, options);
  if (hasLedgerError(result)) {
    throw new Error('\u7528\u91cf\u8bb0\u5f55\u5199\u5165\u5931\u8d25');
  }
}

export async function updateImageUsageStatus(input: {
  requestId: string;
  status: UsageLedgerStatus;
  completedAt?: string | null;
  reportedCostUsd?: number;
  priceSnapshot?: Record<string, string | number>;
}, dependency?: ImageStatusWriter): Promise<boolean> {
  const values: Record<string, unknown> = {
    status: input.status,
    completed_at: input.completedAt ?? null,
  };
  if (typeof input.reportedCostUsd === 'number' && Number.isFinite(input.reportedCostUsd)) {
    values.reported_cost_usd = Math.abs(input.reportedCostUsd);
    values.cost_source = 'reported';
    values.price_snapshot = input.priceSnapshot || { currency: 'USD', source: 'provider_response' };
  }
  try {
    const result = dependency
      ? await dependency.update(values, input.requestId)
      : await createAdminClient()
        .from('ai_usage_ledger')
        .update(values)
        .eq('request_id', input.requestId)
        .select('request_id')
        .maybeSingle();
    return hasUpdatedLedgerRow(result, input.requestId);
  } catch {
    return false;
  }
}


export async function recordUsageBestEffort(
  row: TextLedgerEntry | ImageLedgerEntry | VideoLedgerEntry,
  dependency?: LedgerWriter,
): Promise<boolean> {
  try {
    const result = dependency
      ? await dependency.upsert(row)
      : await createAdminClient()
        .from('ai_usage_ledger')
        .upsert(row, { onConflict: 'request_id' });
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
