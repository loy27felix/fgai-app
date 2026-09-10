/**
 * Media pricing used by the trusted usage ledger.
 *
 * A preflight estimate must never relabel a provider price in CNY as USD.
 * Seedance is the only media family whose billed token formula and this
 * workspace's effective settlement coefficient are currently verified.
 * Image models deliberately stay unpriced until their account-specific final
 * provider bill is available: public token ranges, fixed list prices, and
 * "start" prices do not prove the user's discounted settlement cost.
 */

export type MediaPrice = {
  estimatedCostUsd: number;
  snapshot: Record<string, string | number>;
};

const BILLING_SNAPSHOT_DATE = '2026-09-10';
const VOLCENGINE_SEEDANCE_PRICING_URL = 'https://docs.volcengine.com/docs/82379/1544106?lang=zh#02affcb8';
const WETOKEN_SEEDANCE_BILLING_SOURCE = 'Volcengine Seedance price formula, calibrated against Wetoken FGAI paid invoice on 2026-09-10';
const WETOKEN_MEDIA_BILLING_SOURCE = 'Wetoken model pricing supplied by workspace owner';

/**
 * The official 720p/16:9/30s no-video-input formula is ¥45.36. The same
 * task was charged $5.901746 in the active FGAI token group (including its
 * current 85% multiplier), so this is the workspace's current effective
 * CNY-to-Wetoken-USD rate. It is intentionally an explicit snapshot, not a
 * foreign-exchange rate: provider promotions can change it.
 */
const DEFAULT_WETOKEN_SEEDANCE_USD_PER_CNY = 5.901746 / 45.36;
const SEEDANCE_FRAME_RATE = 24;

/**
 * The effective price paid through Wetoken is account-contract specific; it
 * is not a foreign-exchange rate. A deployment can update it when its token
 * group or promotion changes without editing the audited token formula.
 *
 * `NEXT_PUBLIC_` is deliberate: the preflight badge runs in the browser too.
 * The server-only name remains useful for consumers that import this module
 * outside Next's browser bundle.
 */
function wetokenSeedanceUsdPerCny() {
  const configured = Number(
    process.env.NEXT_PUBLIC_WETOKEN_SEEDANCE_USD_PER_CNY
    || process.env.WETOKEN_SEEDANCE_USD_PER_CNY
    || '',
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_WETOKEN_SEEDANCE_USD_PER_CNY;
}

function snapshot(input: {
  model: string;
  unit: 'per_image' | 'per_generation';
  cost: number;
  resolution?: string;
  durationSeconds?: number;
  note: string;
  source?: string;
}): MediaPrice {
  return {
    estimatedCostUsd: input.cost,
    snapshot: {
      currency: 'USD',
      source: input.source || WETOKEN_MEDIA_BILLING_SOURCE,
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

/**
 * Image responses do not carry reliable generated-token totals and Wetoken's
 * public list price can differ from this account's effective token group.
 * Return null rather than reserve or display an invented per-image cost.
 */
export function estimateImagePrice(_model: string, _resolution: string): MediaPrice | null {
  return null;
}

type SeedanceTokenRate = {
  noVideoInput: number;
  videoInput: number;
};

type SeedanceCatalogItem = {
  minDuration: number;
  maxDuration: number;
  rateByResolution: Record<string, SeedanceTokenRate>;
};

const SEEDANCE_CATALOG: Record<string, SeedanceCatalogItem> = {
  'doubao-seedance-2-0': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      '480p': { noVideoInput: 46, videoInput: 28 },
      '720p': { noVideoInput: 46, videoInput: 28 },
      '1080p': { noVideoInput: 51, videoInput: 31 },
      '4k': { noVideoInput: 26, videoInput: 16 },
    },
  },
  'doubao-seedance-2-0-filter-off': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      '480p': { noVideoInput: 46, videoInput: 28 },
      '720p': { noVideoInput: 46, videoInput: 28 },
      '1080p': { noVideoInput: 51, videoInput: 31 },
      '4k': { noVideoInput: 26, videoInput: 16 },
    },
  },
  'doubao-seedance-2-0-fast': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      // Official list price × the active 75% promotion (valid through 2026-10-07).
      '480p': { noVideoInput: 37 * 0.75, videoInput: 22 * 0.75 },
      '720p': { noVideoInput: 37 * 0.75, videoInput: 22 * 0.75 },
    },
  },
  'doubao-seedance-2-0-fast-filter-off': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      '480p': { noVideoInput: 37 * 0.75, videoInput: 22 * 0.75 },
      '720p': { noVideoInput: 37 * 0.75, videoInput: 22 * 0.75 },
    },
  },
  'dreamina-seedance-2-0-mini': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      // Official list price × the active 40% promotion (valid through 2026-10-07).
      '480p': { noVideoInput: 23 * 0.4, videoInput: 14 * 0.4 },
      '720p': { noVideoInput: 23 * 0.4, videoInput: 14 * 0.4 },
    },
  },
  'dreamina-seedance-2-0-mini-filter-off': {
    minDuration: 4,
    maxDuration: 15,
    rateByResolution: {
      '480p': { noVideoInput: 23 * 0.4, videoInput: 14 * 0.4 },
      '720p': { noVideoInput: 23 * 0.4, videoInput: 14 * 0.4 },
    },
  },
  'dreamina-seedance-2-5': {
    minDuration: 4,
    maxDuration: 30,
    rateByResolution: {
      '480p': { noVideoInput: 70, videoInput: 42 },
      '720p': { noVideoInput: 70, videoInput: 42 },
    },
  },
  'dreamina-seedance-2-5-filter-off': {
    minDuration: 4,
    maxDuration: 30,
    rateByResolution: {
      '480p': { noVideoInput: 70, videoInput: 42 },
      '720p': { noVideoInput: 70, videoInput: 42 },
    },
  },
};

const SEEDANCE_DIMENSIONS: Record<string, Record<string, readonly [number, number]>> = {
  '480p': {
    '16:9': [864, 496], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [496, 864], '21:9': [992, 432],
  },
  '720p': {
    '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630],
  },
  '1080p': {
    '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946],
  },
  '4k': {
    '16:9': [3840, 2160], '4:3': [3328, 2496], '1:1': [2880, 2880], '3:4': [2496, 3328], '9:16': [2160, 3840], '21:9': [4412, 1892],
  },
};

/**
 * Returns a preflight price for the verified Seedance catalog.
 *
 * Seedance charges `(input video seconds + output seconds) × width × height
 * × fps / 1024` tokens. A node with a reference video cannot be priced
 * exactly until we also persist the source duration and provider minimum-token
 * table, so it deliberately returns `null` instead of inventing a number.
 */
export function estimateLedgerPrice(input: {
  kind: 'text' | 'image' | 'video';
  model: string;
  resolution?: string | null;
  videoSeconds?: number | null;
  ratio?: string | null;
  hasVideoReference?: boolean;
}): MediaPrice | null {
  if (input.kind === 'text') return null;
  if (input.kind === 'image') return estimateImagePrice(input.model, input.resolution || '');
  return estimateVideoPrice({
    model: input.model,
    duration: input.videoSeconds || 0,
    resolution: input.resolution || '',
    ratio: input.ratio || '16:9',
    hasVideoReference: input.hasVideoReference,
  });
}

export function estimateVideoPrice(input: {
  model: string;
  duration: number;
  resolution: string;
  ratio?: string;
  hasVideoReference?: boolean;
}): MediaPrice | null {
  const catalog = SEEDANCE_CATALOG[input.model];
  if (!catalog) return null;

  const duration = Math.floor(Number(input.duration));
  if (!Number.isFinite(duration) || duration < catalog.minDuration || duration > catalog.maxDuration) return null;
  // Input-video generation has an additional provider minimum-token table.
  // We do not have the input duration in this generic preflight API yet.
  if (input.hasVideoReference) return null;

  const resolution = normalizedResolution(input.resolution);
  const ratio = String(input.ratio || '16:9').trim();
  const dimensions = SEEDANCE_DIMENSIONS[resolution]?.[ratio];
  const tokenRateCny = catalog.rateByResolution[resolution]?.noVideoInput;
  if (!dimensions || !tokenRateCny) return null;

  const [width, height] = dimensions;
  const estimatedTokens = (duration * width * height * SEEDANCE_FRAME_RATE) / 1024;
  const costCny = (estimatedTokens * tokenRateCny) / 1_000_000;
  const usdPerCny = wetokenSeedanceUsdPerCny();
  const costUsd = Number((costCny * usdPerCny).toFixed(6));
  const tokenRateUsd = Number((tokenRateCny * usdPerCny).toFixed(9));
  return {
    estimatedCostUsd: costUsd,
    snapshot: {
      currency: 'USD',
      source: WETOKEN_SEEDANCE_BILLING_SOURCE,
      source_url: VOLCENGINE_SEEDANCE_PRICING_URL,
      captured_at: BILLING_SNAPSHOT_DATE,
      pricing_basis: 'seedance_token_formula',
      model: input.model,
      resolution: input.resolution,
      ratio,
      duration_seconds: duration,
      input_video: 0,
      output_width: width,
      output_height: height,
      output_fps: SEEDANCE_FRAME_RATE,
      estimated_tokens: Number(estimatedTokens.toFixed(6)),
      token_price_cny_per_million: tokenRateCny,
      token_price_usd_per_million: tokenRateUsd,
      effective_usd_per_cny: Number(usdPerCny.toFixed(12)),
      unit_cost_usd: costUsd,
      note: '按官方 Seedance token 公式、当前 FGAI 价格系数估算；任务完成后以 Wetoken 账单为准。',
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
