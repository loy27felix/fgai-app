/**
 * Media pricing used by the trusted usage ledger.
 *
 * The provider does not consistently return a billable amount in generation
 * responses, so the small catalog below intentionally contains only prices
 * observed in the owner's Wetoken billing export or prorated from an
 * observed anchor. Unknown model/resolution combinations stay unpriced.
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
 * Returns a price for the captured Seedance rows. The provider billing export
 * gave us two duration anchors (720p/6s and 4K/15s), so durations between the
 * supported 4–15 second range are prorated from the matching anchor. We keep
 * other models/resolutions unknown rather than pretending that they share the
 * same tariff; the supported duration extrapolation is marked as a local estimate.
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
  if (!Number.isFinite(duration) || duration < 4 || duration > 15) return null;

  const anchor =
    input.model === 'doubao-seedance-2-0' && resolution === '4k'
      ? { seconds: 15, cost: 11.696721, note: 'Observed 4K / 15s Seedance 2.0 charge.' }
      : resolution === '720p' && (input.model === 'doubao-seedance-2-0' || input.model === 'doubao-seedance-2-0-filter-off')
        ? { seconds: 6, cost: 0.913501, note: 'Observed 720p / 6s Seedance 2.0 charge.' }
        : null;
  if (!anchor) return null;

  // Preserve the observed row exactly; all other durations are clearly
  // labelled as a local proration so the ledger never presents it as a
  // provider-returned charge.
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
      derivation: 'linear_proration_from_observed_anchor',
      note: `按已观测的 ${input.resolution}/${anchor.seconds}s 账单锚点线性估算；实际扣费以 Wetoken 账单为准。`,
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