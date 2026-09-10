import { getUsdToCnyRate } from './fx';

/**
 * One account-specific pricing catalog for the trusted usage ledger.
 *
 * Rules were read from the active WeToken account billing rules on 2026-09-10.
 * A provider-reported dollar charge always overrides this catalog. The catalog
 * is intentionally explicit: every model in the in-product catalog has a
 * preflight estimate.  Where a provider only finalizes a charge after submit,
 * the estimate is clearly labelled and is replaced by its reported usage or
 * charge as soon as it is available.
 */

export type MediaPrice = {
  estimatedCostUsd: number;
  snapshot: Record<string, string | number>;
};

const BILLING_SNAPSHOT_DATE = '2026-09-10';
const WETOKEN_BILLING_URL = 'https://wetoken.ai/billing-v2';
const VOLCENGINE_SEEDANCE_PRICING_URL = 'https://docs.volcengine.com/docs/82379/1544106?lang=zh#02affcb8';
const SEEDANCE_FRAME_RATE = 24;
const TOKEN_SCALE = 1_000_000;
// The verified Seedance 2.5 sample costs ¥45.36 at the Volcengine list
// formula, then receives the 85% WeToken model discount and settles at
// $5.901746. Keep the settlement conversion explicit rather than treating a
// Volcengine RMB rate as a USD rate.
const SEEDANCE_SETTLEMENT_USD_PER_CNY = 5.901746 / (45.36 * 0.85);

function rounded(value: number, decimals = 10) {
  return Number(value.toFixed(decimals));
}

function normalizedResolution(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function snapshot(input: {
  model: string;
  cost: number;
  basis: string;
  note: string;
  values?: Record<string, string | number | undefined>;
  source?: string;
  sourceUrl?: string;
}): MediaPrice {
  return {
    estimatedCostUsd: rounded(input.cost),
    snapshot: Object.fromEntries(Object.entries({
      currency: 'USD',
      source: input.source || 'WeToken account billing rules',
      source_url: input.sourceUrl || WETOKEN_BILLING_URL,
      captured_at: BILLING_SNAPSHOT_DATE,
      pricing_version: 'wetoken-account-2026-09-10',
      pricing_basis: input.basis,
      model: input.model,
      unit_cost_usd: rounded(input.cost),
      note: input.note,
      ...input.values,
    }).filter(([, value]) => value !== undefined)) as Record<string, string | number>,
  };
}

function imageDimensions(value: string): readonly [number, number] | null {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? [width, height]
    : null;
}

function imageOutputTier(value: string): '1K' | '2K' | '4K' {
  const normalized = value.trim().toUpperCase();
  if (normalized === '4K') return '4K';
  if (normalized === '2K') return '2K';
  const dimensions = imageDimensions(value);
  if (!dimensions) return '1K';
  const edge = Math.max(...dimensions);
  return edge > 3072 ? '4K' : edge > 1536 ? '2K' : '1K';
}

function approximateTextTokens(prompt: string | undefined) {
  return Math.max(1, Math.ceil((prompt || '').trim().length / 4));
}

/**
 * WeToken's preflight request does not expose source-image tokenization. Use
 * the documented 1024-square medium image-token baseline until the response
 * supplies its actual modality split. This keeps every supported model priced
 * before submit without mislabelling the estimate as a settled invoice.
 */
const DEFAULT_REFERENCE_IMAGE_TOKENS = 1_056;

function gptOutputTokenEstimate(resolution: string) {
  const dimensions = imageDimensions(resolution);
  const [width, height] = dimensions || [1024, 1024];
  const tier = imageOutputTier(resolution);
  const squareTokens = tier === '1K' ? 272 : tier === '2K' ? 1_056 : 4_160;
  return Math.max(1, Math.round(squareTokens * width * height / (1024 * 1024)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nestedNumber(value: unknown, keys: string[]): number | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = Number(record[key]);
    if (Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  for (const key of ['usage', 'usage_metadata', 'usageMetadata', 'data', 'result']) {
    const result = nestedNumber(record[key], keys);
    if (result !== undefined) return result;
  }
  return undefined;
}

function usageTokens(value: unknown) {
  return {
    input: nestedNumber(value, ['prompt_tokens', 'input_tokens', 'promptTokenCount', 'prompt_token_count']),
    output: nestedNumber(value, ['completion_tokens', 'output_tokens', 'candidatesTokenCount', 'candidates_token_count']),
    cached: nestedNumber(value, ['cached_tokens', 'cached_input_tokens', 'cachedTokenCount']),
  };
}

function nestedPathNumber(value: unknown, path: string[]): number | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const next = path.reduce<unknown>((current, key) => asRecord(current)?.[key], record);
  const candidate = Number(next);
  if (Number.isFinite(candidate) && candidate >= 0) return candidate;
  for (const key of ['usage', 'usage_metadata', 'usageMetadata', 'data', 'result']) {
    const result = nestedPathNumber(record[key], path);
    if (result !== undefined) return result;
  }
  return undefined;
}

export type ImagePriceOptions = {
  referenceCount?: number;
  prompt?: string;
};

const GEMINI_IMAGE_RULES = {
  'gemini-3-pro-image-preview': {
    multiplier: 0.7,
    outputByTier: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
    inputPerMillion: 2,
  },
  'gemini-3.1-flash-image-preview': {
    multiplier: 0.7,
    outputByTier: { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
    inputPerMillion: 0.5,
  },
} as const;

const GEMINI_FLASH_LITE_IMAGE_BASELINE_USD = 0.02396;

/**
 * Every currently supported image model gets a concrete preflight estimate.
 * Usage-dependent models use their published token price plus conservative
 * input/output token baselines; settlement replaces the baseline as soon as
 * WeToken returns usage or a reported charge.
 */
export function estimateImagePrice(model: string, resolution: string, options: ImagePriceOptions = {}): MediaPrice | null {
  const references = Math.max(0, Math.floor(options.referenceCount || 0));
  const promptTokens = approximateTextTokens(options.prompt);
  if (model === 'seedream-5-0-lite-260128') {
    return snapshot({
      model,
      cost: 0.035 * 0.95,
      basis: 'per_image',
      note: 'Seedream 5.0 Lite：$0.035/张 × 当前账户 95% 折扣。',
      values: { account_multiplier: 0.95, raw_per_image_usd: 0.035, reference_images: references },
    });
  }
  if (model === 'dola-seedream-5-0-pro-260628') {
    const dimensions = imageDimensions(resolution);
    if (!dimensions) return null;
    const pixels = dimensions[0] * dimensions[1];
    const outputCost = pixels >= 2_360_000 ? 0.09 : 0.045;
    const cost = outputCost + references * 0.003;
    return snapshot({
      model,
      cost,
      basis: 'per_image_plus_reference',
      note: 'Dola Seedream 5.0 Pro：输出按 236 万像素分档，参考图按张计费。',
      values: {
        output_width: dimensions[0], output_height: dimensions[1], output_pixels: pixels,
        output_per_image_usd: outputCost, reference_images: references,
        reference_per_image_usd: 0.003, account_multiplier: 1,
      },
    });
  }
  if (model === 'gpt-image-2') {
    const outputTokens = gptOutputTokenEstimate(resolution);
    const referenceTokens = references * DEFAULT_REFERENCE_IMAGE_TOKENS;
    const rawCost = (
      promptTokens * 5
      + referenceTokens * 8
      + outputTokens * 30
    ) / TOKEN_SCALE;
    return snapshot({
      model,
      cost: rawCost * 0.6,
      basis: 'expected_text_image_and_output_tokens',
      note: 'GPT Image 2 使用当前尺寸对应的输出 Token 与参考图 Token 基线预估；完成后按供应商返回的模态 Token 重算。',
      values: {
        account_multiplier: 0.6, prompt_tokens_estimated: promptTokens,
        reference_images: references, reference_image_tokens_estimated: referenceTokens,
        output_tokens_estimated: outputTokens, raw_text_input_per_million_usd: 5,
        raw_image_input_per_million_usd: 8, raw_image_output_per_million_usd: 30,
      },
    });
  }
  if (model === 'gemini-3.1-flash-lite-image') {
    const referenceInput = references * DEFAULT_REFERENCE_IMAGE_TOKENS;
    const inputCost = (promptTokens + referenceInput) * 0.25 / TOKEN_SCALE * 0.7;
    return snapshot({
      model,
      cost: GEMINI_FLASH_LITE_IMAGE_BASELINE_USD + inputCost,
      basis: 'observed_image_baseline_plus_input_tokens',
      note: 'Gemini Flash Lite Image 按账户历史图像出图基线及当前输入 Token 估算；完成后以账单为准。',
      values: {
        account_multiplier: 0.7, observed_output_baseline_usd: GEMINI_FLASH_LITE_IMAGE_BASELINE_USD,
        prompt_tokens_estimated: promptTokens, reference_images: references,
        reference_image_tokens_estimated: referenceInput, raw_input_per_million_usd: 0.25,
      },
    });
  }
  const gemini = GEMINI_IMAGE_RULES[model as keyof typeof GEMINI_IMAGE_RULES];
  if (!gemini) return null;
  const tier = imageOutputTier(resolution);
  // Gemini bills text and image input at the same documented input rate.
  // This baseline becomes the returned promptTokenCount after submit.
  const referenceInput = references * DEFAULT_REFERENCE_IMAGE_TOKENS;
  const rawOutput = gemini.outputByTier[tier];
  const rawInput = (promptTokens + referenceInput) * gemini.inputPerMillion / TOKEN_SCALE;
  return snapshot({
    model,
    cost: (rawOutput + rawInput) * gemini.multiplier,
    basis: 'image_output_plus_prompt_input',
    note: 'Gemini 图像输出按清晰度分档；提交后会以返回的实际输入 Token 重新核算。',
    values: {
      output_tier: tier, account_multiplier: gemini.multiplier,
      raw_output_per_image_usd: rawOutput, raw_input_per_million_usd: gemini.inputPerMillion,
      prompt_tokens_estimated: promptTokens, reference_images: references,
      reference_image_tokens_estimated: referenceInput,
    },
  });
}

/** Recalculate an image request after the provider returns its usage. */
export function estimateImageUsagePrice(input: {
  model: string;
  resolution: string;
  prompt?: string;
  referenceCount?: number;
  usage?: unknown;
}): MediaPrice | null {
  const baseline = estimateImagePrice(input.model, input.resolution, {
    prompt: input.prompt,
    referenceCount: input.referenceCount,
  });
  if (input.model === 'seedream-5-0-lite-260128' || input.model === 'dola-seedream-5-0-pro-260628') return baseline;

  const references = Math.max(0, Math.floor(input.referenceCount || 0));
  const tokens = usageTokens(input.usage);
  const gemini = GEMINI_IMAGE_RULES[input.model as keyof typeof GEMINI_IMAGE_RULES];
  if (gemini && tokens.input !== undefined) {
    const tier = imageOutputTier(input.resolution);
    const rawOutput = gemini.outputByTier[tier];
    return snapshot({
      model: input.model,
      cost: (rawOutput + tokens.input * gemini.inputPerMillion / TOKEN_SCALE) * gemini.multiplier,
      basis: 'image_output_plus_reported_input',
      note: 'Gemini 图像输出分档价 + 供应商返回的实际输入 Token；最终以 WeToken 账单为准。',
      values: {
        output_tier: tier, account_multiplier: gemini.multiplier,
        raw_output_per_image_usd: rawOutput, raw_input_per_million_usd: gemini.inputPerMillion,
        prompt_tokens_reported: tokens.input, reference_images: references,
      },
    });
  }
  if (input.model === 'gemini-3.1-flash-lite-image' && tokens.input !== undefined) {
    const rawCost = tokens.input * 0.25 / TOKEN_SCALE;
    return snapshot({
      model: input.model,
      cost: GEMINI_FLASH_LITE_IMAGE_BASELINE_USD + rawCost * 0.7,
      basis: 'observed_image_baseline_plus_reported_input',
      note: 'Gemini Flash Lite Image 使用图像出图基线 + 供应商返回的实际输入 Token；最终以 WeToken 账单为准。',
      values: {
        account_multiplier: 0.7, observed_output_baseline_usd: GEMINI_FLASH_LITE_IMAGE_BASELINE_USD,
        prompt_tokens_reported: tokens.input, raw_input_per_million_usd: 0.25,
        reference_images: references,
      },
    });
  }
  if (input.model === 'gpt-image-2' && tokens.output !== undefined) {
    const reportedTextInput = nestedPathNumber(input.usage, ['input_tokens_details', 'text_tokens']);
    const textInput = reportedTextInput ?? tokens.input ?? approximateTextTokens(input.prompt);
    const reportedImageInput = nestedPathNumber(input.usage, ['input_tokens_details', 'image_tokens']);
    // Legacy responses expose one prompt-token total without a modality split.
    // In that shape the total is treated as text and known references use the
    // same preflight image baseline, rather than accidentally charging the
    // text total a second time as image input.
    const derivedImageInput = reportedTextInput === undefined ? 0 : Math.max(0, (tokens.input || 0) - textInput);
    const imageInput = reportedImageInput ?? (derivedImageInput || references * DEFAULT_REFERENCE_IMAGE_TOKENS);
    const rawCost = (textInput * 5 + imageInput * 8 + tokens.output * 30) / TOKEN_SCALE;
    return snapshot({
      model: input.model,
      cost: rawCost * 0.6,
      basis: 'reported_text_and_image_output_tokens',
      note: 'GPT Image 2 使用供应商返回的文本、参考图和输出 Token；最终以 WeToken 账单为准。',
      values: {
        account_multiplier: 0.6, text_input_tokens_reported: textInput,
        image_input_tokens_reported: imageInput, output_tokens_reported: tokens.output,
        raw_text_input_per_million_usd: 5, raw_image_input_per_million_usd: 8,
        raw_image_output_per_million_usd: 30, reference_images: references,
      },
    });
  }
  return baseline;
}

type SeedanceTokenRate = { noVideoInput: number; videoInput: number };
type SeedanceCatalogItem = {
  minDuration: number;
  maxDuration: number;
  multiplier: number;
  rateByResolution: Record<string, SeedanceTokenRate>;
};

const SEEDANCE_CATALOG: Record<string, SeedanceCatalogItem> = {
  'doubao-seedance-2-0': { minDuration: 4, maxDuration: 15, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 46, videoInput: 28 }, '720p': { noVideoInput: 46, videoInput: 28 }, '1080p': { noVideoInput: 51, videoInput: 31 }, '4k': { noVideoInput: 26, videoInput: 16 },
  } },
  'doubao-seedance-2-0-filter-off': { minDuration: 4, maxDuration: 15, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 46, videoInput: 28 }, '720p': { noVideoInput: 46, videoInput: 28 }, '1080p': { noVideoInput: 51, videoInput: 31 }, '4k': { noVideoInput: 26, videoInput: 16 },
  } },
  'doubao-seedance-2-0-fast': { minDuration: 4, maxDuration: 15, multiplier: 1, rateByResolution: {
    '480p': { noVideoInput: 37, videoInput: 22 }, '720p': { noVideoInput: 37, videoInput: 22 },
  } },
  'doubao-seedance-2-0-fast-filter-off': { minDuration: 4, maxDuration: 15, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 37, videoInput: 22 }, '720p': { noVideoInput: 37, videoInput: 22 },
  } },
  'dreamina-seedance-2-0-mini': { minDuration: 4, maxDuration: 15, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 23, videoInput: 14 }, '720p': { noVideoInput: 23, videoInput: 14 },
  } },
  'dreamina-seedance-2-0-mini-filter-off': { minDuration: 4, maxDuration: 15, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 23, videoInput: 14 }, '720p': { noVideoInput: 23, videoInput: 14 },
  } },
  // Volcengine list price in CNY/M tokens. The final dollar sample validates
  // this path after the WeToken account multiplier and settlement conversion.
  'dreamina-seedance-2-5': { minDuration: 4, maxDuration: 30, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 70, videoInput: 42 }, '720p': { noVideoInput: 70, videoInput: 42 },
  } },
  'dreamina-seedance-2-5-filter-off': { minDuration: 4, maxDuration: 30, multiplier: 0.85, rateByResolution: {
    '480p': { noVideoInput: 70, videoInput: 42 }, '720p': { noVideoInput: 70, videoInput: 42 },
  } },
};

const SEEDANCE_DIMENSIONS: Record<string, Record<string, readonly [number, number]>> = {
  '480p': { '16:9': [864, 496], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [496, 864], '21:9': [992, 432] },
  '720p': { '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946] },
  '4k': { '16:9': [3840, 2160], '4:3': [3328, 2496], '1:1': [2880, 2880], '3:4': [2496, 3328], '9:16': [2160, 3840], '21:9': [4412, 1892] },
};

export function estimateLedgerPrice(input: {
  kind: 'text' | 'image' | 'video';
  model: string;
  resolution?: string | null;
  videoSeconds?: number | null;
  ratio?: string | null;
  hasVideoReference?: boolean;
  imageReferenceCount?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  videoReferenceSeconds?: number | null;
}): MediaPrice | null {
  if (input.kind === 'text') return estimateTextPrice({
    model: input.model, inputTokens: input.inputTokens, outputTokens: input.outputTokens,
  });
  if (input.kind === 'image') return estimateImagePrice(input.model, input.resolution || '', {
    referenceCount: input.imageReferenceCount,
  });
  return estimateVideoPrice({
    model: input.model, duration: input.videoSeconds || 0, resolution: input.resolution || '',
    ratio: input.ratio || '16:9', hasVideoReference: input.hasVideoReference,
    imageReferenceCount: input.imageReferenceCount,
    videoReferenceSeconds: input.videoReferenceSeconds ?? undefined,
  });
}

export function estimateVideoPrice(input: {
  model: string;
  duration: number;
  resolution: string;
  ratio?: string;
  hasVideoReference?: boolean;
  imageReferenceCount?: number;
  /** Sum of known reference-video durations. Missing legacy metadata is 0. */
  videoReferenceSeconds?: number;
}): MediaPrice | null {
  const duration = Math.floor(Number(input.duration));
  const resolution = normalizedResolution(input.resolution);
  const imageReferences = Math.max(0, Math.floor(input.imageReferenceCount || 0));
  const videoReferenceSeconds = Math.max(0, Number(input.videoReferenceSeconds) || 0);

  if (input.model.startsWith('happyhorse-1.1-')) {
    if (duration < 3 || duration > 15) return null;
    const raw = resolution === '720p' ? 0.14 : resolution === '1080p' ? 0.18 : null;
    if (raw === null) return null;
    return snapshot({
      model: input.model, cost: raw * 0.45, basis: 'per_generation',
      note: 'HappyHorse 1.1 按次、按分辨率计费。',
      values: { resolution, raw_per_generation_usd: raw, account_multiplier: 0.45, duration_seconds: duration, reference_images: imageReferences },
    });
  }
  if (input.model === 'MiniMax-H3') {
    if (duration < 4 || duration > 15) return null;
    const perSecond = resolution === '768p' ? 0.08 : resolution === '2k' ? 0.13 : null;
    if (perSecond === null) return null;
    const referenceExtra = Math.max(0, imageReferences - 5) * 0.04;
    return snapshot({
      model: input.model, cost: (duration + videoReferenceSeconds) * perSecond + referenceExtra, basis: 'per_second_with_reference_video_plus_extra_reference',
      note: 'MiniMax H3 按输出与参考视频秒数计费；超过 5 张参考图的部分按张计费。缺失旧视频时长时仅按输出秒数预估。',
      values: { resolution, duration_seconds: duration, reference_video_seconds: videoReferenceSeconds, output_per_second_usd: perSecond, reference_images: imageReferences, extra_reference_cost_usd: referenceExtra, account_multiplier: 1 },
    });
  }

  const catalog = SEEDANCE_CATALOG[input.model];
  if (!catalog || duration < catalog.minDuration || duration > catalog.maxDuration) return null;
  const ratio = String(input.ratio || '16:9').trim();
  const dimensions = SEEDANCE_DIMENSIONS[resolution]?.[ratio];
  const usesVideoInputRate = Boolean(input.hasVideoReference);
  const rawRateCny = catalog.rateByResolution[resolution]?.[usesVideoInputRate ? 'videoInput' : 'noVideoInput'];
  if (!dimensions || rawRateCny === undefined) return null;
  const [width, height] = dimensions;
  const estimatedTokens = duration * width * height * SEEDANCE_FRAME_RATE / 1024;
  const costCny = estimatedTokens * rawRateCny / TOKEN_SCALE;
  const cost = costCny * catalog.multiplier * SEEDANCE_SETTLEMENT_USD_PER_CNY;
  return snapshot({
    model: input.model, cost, basis: 'seedance_output_token_formula',
    note: 'Seedance 按火山官方人民币 token 公式、参考视频档位、当前 WeToken 模型折扣和结算汇率估算；前台统一显示人民币。',
    source: 'Volcengine Seedance official RMB pricing + WeToken account discount',
    sourceUrl: VOLCENGINE_SEEDANCE_PRICING_URL,
    values: {
      resolution, ratio, duration_seconds: duration, input_video: usesVideoInputRate ? 1 : 0, reference_video_seconds: videoReferenceSeconds, reference_images: imageReferences,
      output_width: width, output_height: height, output_fps: SEEDANCE_FRAME_RATE,
      estimated_tokens: rounded(estimatedTokens, 6), raw_token_price_cny_per_million: rawRateCny,
      account_multiplier: catalog.multiplier,
      pre_discount_settlement_usd_per_cny: rounded(SEEDANCE_SETTLEMENT_USD_PER_CNY, 12),
      raw_cost_cny: rounded(costCny, 6),
    },
  });
}

type TextRule = {
  multiplier: number;
  input: number;
  output: number;
  cachedInput: number;
  longInput?: { threshold: number; input: number; output: number; cachedInput: number };
};

const TEXT_RULES: Record<string, TextRule> = {
  'gpt-5.6-luna-t1a': { multiplier: 1, input: 0.2, output: 1.2, cachedInput: 0.02, longInput: { threshold: 200_000, input: 0.4, output: 1.8, cachedInput: 0.04 } },
  'gpt-5.6-terra-t1a': { multiplier: 1, input: 2, output: 12, cachedInput: 0.2, longInput: { threshold: 200_000, input: 4, output: 18, cachedInput: 0.4 } },
  'claude-sonnet-5': { multiplier: 0.75, input: 2, output: 10, cachedInput: 0.2 },
  'claude-opus-5': { multiplier: 0.75, input: 5, output: 25, cachedInput: 0.5 },
  'deepseek-v4-pro': { multiplier: 1, input: 2.4, output: 4.8, cachedInput: 0.2 },
};

export function estimateTextPrice(input: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
}): MediaPrice | null {
  const rule = TEXT_RULES[input.model];
  if (!rule) return null;
  const totalInput = Math.max(0, Math.floor(Number(input.inputTokens) || 0));
  const output = Math.max(0, Math.floor(Number(input.outputTokens) || 0));
  const cached = Math.min(totalInput, Math.max(0, Math.floor(Number(input.cachedInputTokens) || 0)));
  const rates = rule.longInput && totalInput > rule.longInput.threshold ? rule.longInput : rule;
  const rawCost = ((totalInput - cached) * rates.input + cached * rates.cachedInput + output * rates.output) / TOKEN_SCALE;
  return snapshot({
    model: input.model, cost: rawCost * rule.multiplier, basis: 'reported_text_tokens',
    note: '按 WeToken 返回的输入、缓存输入和输出 Token 计费；实际账单优先。',
    values: {
      input_tokens: totalInput, cached_input_tokens: cached, output_tokens: output,
      raw_input_per_million_usd: rates.input, raw_cached_input_per_million_usd: rates.cachedInput,
      raw_output_per_million_usd: rates.output, account_multiplier: rule.multiplier,
      ...(rule.longInput ? { rate_tier: totalInput > rule.longInput.threshold ? 'over_200k_input' : 'up_to_200k_input' } : {}),
    },
  });
}

function numericMoney(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value.replace(/[$¥￥,\s]|CNY|RMB/gi, ''));
  return Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
}

/** Best-effort extraction for provider responses carrying a dollar charge. */
export function extractReportedCostUsd(value: unknown): number | undefined {
  const visited = new Set<object>();
  const costKeys = ['cost_usd', 'total_cost_usd', 'amount_usd', 'costUsd', 'totalCostUsd'];
  const cnyCostKeys = ['cost_cny', 'total_cost_cny', 'amount_cny', 'costCny', 'totalCostCny'];
  const nestedKeys = ['usage', 'billing', 'pricing', 'meta', 'metadata', 'data', 'task'];
  function visit(current: unknown, depth: number): number | undefined {
    if (depth > 4 || current === null || typeof current !== 'object' || visited.has(current as object)) return undefined;
    visited.add(current as object);
    const record = current as Record<string, unknown>;
    for (const key of costKeys) {
      const candidate = numericMoney(record[key]);
      if (candidate !== undefined) return candidate;
    }
    // Keep USD internally because that is how ledger columns reconcile
    // provider responses. Explicit CNY amounts are nevertheless actual
    // charges, so normalize them by the same display settlement rate rather
    // than discarding a concrete RMB bill and retaining only a preflight
    // estimate. The UI converts the stored amount back to RMB.
    for (const key of cnyCostKeys) {
      const candidate = numericMoney(record[key]);
      if (candidate !== undefined) return candidate / getUsdToCnyRate();
    }
    const currency = typeof record.currency === 'string' ? record.currency.trim().toUpperCase() : '';
    const genericCost = record.cost;
    if (currency === 'CNY' || currency === 'RMB') {
      const candidate = numericMoney(genericCost);
      if (candidate !== undefined) return candidate / getUsdToCnyRate();
    }
    if (currency === 'USD' || (typeof genericCost === 'string' && genericCost.trim().startsWith('$'))) {
      const candidate = numericMoney(genericCost);
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
