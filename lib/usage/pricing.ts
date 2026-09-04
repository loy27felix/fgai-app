/**
 * Media pricing used by the trusted usage ledger.
 *
 * The provider does not consistently return a billable amount in generation
 * responses, so the catalog uses the provider's published price examples
 * supplied by the workspace owner. Image prices are fixed output prices where
 * Wetoken publishes one. Video prices are a transparent linear estimate from
 * the published five-second example, not a provider bill.
 */

export type MediaPrice = {
  estimatedCostUsd: number;
  snapshot: Record<string, string | number>;
};

const BILLING_SNAPSHOT_DATE = '2026-08-13';
const BILLING_SOURCE = 'Wetoken model pricing supplied by workspace owner';

function snapshot(input: {
  model: string;
  unit: 'per_image' | 'per_generation';
  cost: number;
  resolution?: string;
  durationSeconds?: number;
  note: string;
}): MediaPrice {
  return {
    estimatedCostUsd: input.cost,
    snapshot: {
      currency: 'USD',
      source: BILLING_SOURCE,
      captured_at: BILLING_SNAPSHOT_DATE,
      pricing_basis: input.unit,
      model: input.model,
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.durationSeconds !== undefined ? { duration_seconds: input.durationSeconds } : {}),
      unit_cost_usd: input.cost,
      note: input.note,
    },
  };
}

function normalizedResolution(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function imageTier(resolution: string) {
  const value = normalizedResolution(resolution);
  if (value.includes('0.5k') || value.includes('512')) return '0.5k';
  if (value.includes('4k') || value.includes('4096')) return '4k';
  if (value.includes('2k') || value.includes('2048')) return '2k';
  return '1k';
}

/** Returns the published fixed image output price or its documented example. */
export function estimateImagePrice(model: string, resolution: string): MediaPrice | null {
  const tier = imageTier(resolution);
  const knownPrices: Record<string, number | undefined> = {
    'gemini-3-pro-image-preview': tier === '4k' ? 0.24 : 0.134,
    'gemini-3.1-flash-image-preview': ({ '0.5k': 0.045, '1k': 0.067, '2k': 0.101, '4k': 0.151 } as Record<string, number>)[tier],
    // These providers publish token rates rather than a flat per-image fee.
    // We use the first documented cost example as the initial job estimate.
    'gemini-3.1-flash-lite-image': 0.01525,
    'gpt-image-2': 0.02,
  };
  const cost = knownPrices[model];
  if (cost === undefined) return null;
  return snapshot({
    model,
    unit: 'per_image',
    cost,
    resolution,
    note: model === 'gemini-3-pro-image-preview' || model === 'gemini-3.1-flash-image-preview'
      ? `Wetoken published ${tier.toUpperCase()} image output price.`
      : 'Wetoken published token-price example used as the initial per-image estimate.',
  });
}

/**
 * Returns a price for the supported video catalog. Wetoken publishes the
 * example as a five-second generation, therefore selected durations are
 * linearly prorated and clearly stored as estimates. The browser never calls
 * this a provider-confirmed charge.
 */
export function estimateLedgerPrice(input: {
  kind: 'text' | 'image' | 'video';
  model: string;
  resolution?: string | null;
  videoSeconds?: number | null;
}): MediaPrice | null {
  if (input.kind === 'text') return null;
  if (input.kind === 'image') return estimateImagePrice(input.model, input.resolution || '');
  return estimateVideoPrice({
    model: input.model,
    duration: input.videoSeconds || 0,
    resolution: input.resolution || '',
  });
}

export function estimateVideoPrice(input: {
  model: string;
  duration: number;
  resolution: string;
}): MediaPrice | null {
  const resolution = normalizedResolution(input.resolution);
  const duration = Math.floor(Number(input.duration));
  const isSeedance25 = input.model === 'dreamina-seedance-2-5' || input.model === 'dreamina-seedance-2-5-filter-off';
  const happyHorse = new Set(['happyhorse-1.1-i2v', 'happyhorse-1.1-r2v', 'happyhorse-1.1-t2v']);
  const maxDuration = isSeedance25 ? 30 : 15;
  const minDuration = happyHorse.has(input.model) ? 3 : 4;
  if (!Number.isFinite(duration) || duration < minDuration || duration > maxDuration) return null;

  const normal = new Set(['doubao-seedance-2-0', 'doubao-seedance-2-0-filter-off']);
  const fast = new Set(['doubao-seedance-2-0-fast', 'doubao-seedance-2-0-fast-filter-off']);
  const mini = new Set(['dreamina-seedance-2-0-mini', 'dreamina-seedance-2-0-mini-filter-off']);
  const reference720 = normal.has(input.model) ? 4.97
    : fast.has(input.model) ? 4
      : mini.has(input.model) ? (4.97 * 3.5) / 7
        : isSeedance25 ? (4.97 * 10.7) / 7
          : happyHorse.has(input.model) ? 0.14 * 5
          : null;
  if (reference720 === null) return null;

  // Published 480p examples are explicit for normal and fast. Mini and 2.5
  // are derived from the same 720p sample using their published token ratio.
  const resolutionRatio: Record<string, number> = {
    '480p': normal.has(input.model) ? 2.31 / 4.97 : fast.has(input.model) ? 1.86 / 4 : 2.31 / 4.97,
    '720p': 1,
    '1080p': happyHorse.has(input.model) ? 0.18 / 0.14 : normal.has(input.model) ? 7.7 / 7 : Number.NaN,
    '4k': normal.has(input.model) ? 4 / 7 : Number.NaN,
  };
  const ratio = resolutionRatio[resolution];
  const costAtFiveSeconds = Number.isFinite(ratio) ? Number((reference720 * ratio).toFixed(6)) : null;
  const anchor = costAtFiveSeconds === null
    ? null
    : { seconds: 5, cost: costAtFiveSeconds, note: happyHorse.has(input.model) ? 'Wetoken published HappyHorse per-second price; selected duration is calculated linearly.' : 'Wetoken published five-second Seedance price example; selected duration is prorated locally.' };
  if (!anchor) return null;

  if (duration === anchor.seconds) {
    return snapshot({
      model: input.model,
      unit: 'per_generation',
      cost: anchor.cost,
      resolution: input.resolution,
      durationSeconds: duration,
      note: anchor.note,
    });
  }

  const cost = Number(((anchor.cost / anchor.seconds) * duration).toFixed(6));
  return {
    estimatedCostUsd: cost,
    snapshot: {
      currency: 'USD',
      source: BILLING_SOURCE,
      captured_at: BILLING_SNAPSHOT_DATE,
      pricing_basis: 'per_generation',
      model: input.model,
      resolution: input.resolution,
      duration_seconds: duration,
      unit_cost_usd: cost,
      anchor_duration_seconds: anchor.seconds,
      anchor_cost_usd: anchor.cost,
      derivation: 'linear_proration_from_published_five_second_example',
      note: `按 Wetoken 公布的 ${input.resolution}/${anchor.seconds}s 示例线性估算；实际扣费以 Wetoken 账单为准。`,
    },
  };
}

function numericMoney(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
}

/**
 * Best-effort extraction for providers that return a billable amount. The
 * amount is preferred over a local estimate when present. Provider billing
 * APIs sometimes expose charges as negative debits, hence Math.abs above.
 */
export function extractReportedCostUsd(value: unknown): number | undefined {
  const visited = new Set<object>();
  const costKeys = ['cost_usd', 'total_cost_usd', 'amount_usd', 'costUsd', 'totalCostUsd', 'cost'];
  const nestedKeys = ['usage', 'billing', 'pricing', 'meta', 'metadata', 'data', 'task'];

  function visit(current: unknown, depth: number): number | undefined {
    if (depth > 4 || current === null || typeof current !== 'object') return undefined;
    if (visited.has(current as object)) return undefined;
    visited.add(current as object);
    const record = current as Record<string, unknown>;
    for (const key of costKeys) {
      const candidate = numericMoney(record[key]);
      if (candidate !== undefined) return candidate;
    }
    for (const key of nestedKeys) {
      const result = visit(record[key], depth + 1);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  return visit(value, 0);
}
