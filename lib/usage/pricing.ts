/**
 * Media pricing used by the trusted usage ledger.
 *
 * The provider does not consistently return a billable amount in generation
 * responses, so the small catalog below intentionally contains only prices
 * that have been observed in the owner's Wetoken billing export. Unknown
 * combinations stay unpriced instead of being guessed.
 */

export type MediaPrice = {
  estimatedCostUsd: number;
  snapshot: Record<string, string | number>;
};

const BILLING_SNAPSHOT_DATE = '2026-07-31';
const BILLING_SOURCE = 'Wetoken billing screenshot supplied by project owner';

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

/** Returns a price only for a captured, known image combination. */
export function estimateImagePrice(model: string, resolution: string): MediaPrice | null {
  if (model !== 'gpt-image-2') return null;
  return snapshot({
    model,
    unit: 'per_image',
    cost: 0.015,
    resolution,
    note: 'Observed one gpt-image-2 image charge; verify if provider changes size-based pricing.',
  });
}

/**
 * Returns a price only for the two Seedance billing rows supplied by the
 * owner. This deliberately leaves other duration/resolution/model pairs as
 * pending rather than extrapolating a provider price.
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
  if (input.model === 'doubao-seedance-2-0' && input.duration === 15 && resolution === '4k') {
    return snapshot({
      model: input.model,
      unit: 'per_generation',
      cost: 11.696721,
      resolution: input.resolution,
      durationSeconds: input.duration,
      note: 'Observed 4K / 15s Seedance 2.0 charge.',
    });
  }
  if (
    input.duration === 6
    && resolution === '720p'
    && (input.model === 'doubao-seedance-2-0' || input.model === 'doubao-seedance-2-0-filter-off')
  ) {
    return snapshot({
      model: input.model,
      unit: 'per_generation',
      cost: 0.913501,
      resolution: input.resolution,
      durationSeconds: input.duration,
      note: 'Observed 720p / 6s Seedance 2.0 charge.',
    });
  }
  return null;
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
