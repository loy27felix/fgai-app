export type ImageProvider = 'gpt-image' | 'gemini' | 'volcengine-image';
export type ImageOutputSize = '1K' | '2K' | '4K';

export const IMAGE_OUTPUT_SIZES: ImageOutputSize[] = ['1K', '2K', '4K'];

export type ImageModelSpec = {
  id: string;
  label: string;
  provider: ImageProvider;
  experimental: boolean;
  maxReferences: number;
  /** Fixed output tiers the provider accepts; exact dimensions remain GPT-only. */
  outputSizes: ImageOutputSize[];
};

export const IMG_MODELS: ImageModelSpec[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2 · 中文与高保真', provider: 'gpt-image', experimental: false, maxReferences: 8, outputSizes: IMAGE_OUTPUT_SIZES },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image · 精修', provider: 'gemini', experimental: false, maxReferences: 8, outputSizes: IMAGE_OUTPUT_SIZES },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image · 实验', provider: 'gemini', experimental: true, maxReferences: 8, outputSizes: IMAGE_OUTPUT_SIZES },
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image · 实验', provider: 'gemini', experimental: true, maxReferences: 8, outputSizes: ['1K'] },
  // Wetoken documents a single `image` field for Seedream image-to-image.
  // Lite has no documented higher-resolution tier; Pro explicitly supports 4K.
  { id: 'seedream-5-0-lite-260128', label: 'Seedream 5.0 Lite · 轻量生图', provider: 'volcengine-image', experimental: false, maxReferences: 1, outputSizes: ['1K'] },
  { id: 'dola-seedream-5-0-pro-260628', label: 'Dola Seedream 5.0 Pro · 4K 专业', provider: 'volcengine-image', experimental: false, maxReferences: 1, outputSizes: IMAGE_OUTPUT_SIZES },
];

export const RATIOS = [
  { key: '9:16', label: '9:16 竖屏(漫剧)' },
  { key: '1:1', label: '1:1 方图' },
  { key: '16:9', label: '16:9 横屏' },
  { key: '3:4', label: '3:4' },
  { key: '4:3', label: '4:3' },
  { key: '2:3', label: '2:3' },
  { key: '3:2', label: '3:2' },
];

/**
 * Stable draft geometry for each UI output tier.  This is intentionally a
 * table instead of a formula: a saved 16:9 / 2K draft must create exactly the
 * same request after reload, and every model sees the same ratio geometry.
 */
const IMAGE_REQUEST_SIZE_TABLE: Record<ImageOutputSize, Record<string, string>> = {
  '1K': {
    '9:16': '768x1360', '1:1': '1024x1024', '16:9': '1360x768',
    '3:4': '880x1168', '4:3': '1168x880', '2:3': '832x1248', '3:2': '1248x832',
  },
  '2K': {
    '9:16': '1536x2720', '1:1': '2048x2048', '16:9': '2720x1536',
    '3:4': '1760x2352', '4:3': '2352x1760', '2:3': '1664x2496', '3:2': '2496x1664',
  },
  '4K': {
    '9:16': '2160x3840', '1:1': '2880x2880', '16:9': '3840x2160',
    '3:4': '2480x3312', '4:3': '3312x2480', '2:3': '2352x3520', '3:2': '3520x2352',
  },
};

/**
 * Image settings may hold either a named ratio or an exact `WIDTHxHEIGHT`
 * value. Creator drafts still need a named ratio for metadata and legacy
 * model routes, so derive it from the selected dimensions rather than
 * silently defaulting custom 2K/4K selections to a square image.
 */
export function ratioForImageSize(value: string) {
  const size = value.trim();
  if (RATIOS.some((item) => item.key === size)) return size;
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return '1:1';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1';
  const target = width / height;
  return RATIOS.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.key.split(':').map(Number);
    const [bestWidth, bestHeight] = best.split(':').map(Number);
    return Math.abs(Math.log(candidateWidth / candidateHeight / target))
      < Math.abs(Math.log(bestWidth / bestHeight / target))
      ? candidate.key
      : best;
  }, '1:1');
}

export function imageDraftGeometry(value: string) {
  const size = value.trim();
  return {
    ratio: ratioForImageSize(size),
    size: /^\d+x\d+$/i.test(size) ? size : undefined,
  };
}

const GPT_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1536x864', '9:16': '864x1536',
  '4:3': '1024x768', '3:4': '768x1024', '3:2': '1248x832', '2:3': '832x1248',
};
const GEMINI_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1344x768', '9:16': '768x1344',
  '4:3': '1152x896', '3:4': '896x1152', '3:2': '1216x832', '2:3': '832x1216',
};

export function getImageModel(model: string) {
  return IMG_MODELS.find((item) => item.id === model);
}

/**
 * Resolution tiers are provider/model capabilities, not aspect-ratio presets.
 * Unknown custom models deliberately expose the safe 1K tier instead of
 * promising a resolution their API may reject.
 */
export function imageOutputSizeOptionsFor(model: string): string[] {
  return [...(getImageModel(model)?.outputSizes || ['1K'])];
}

export function imageQualityForOutputSize(size: string) {
  if (size === '4K') return 'high';
  if (size === '2K') return 'medium';
  return 'low';
}

export function imageOutputSizeForQuality(quality: string | undefined): ImageOutputSize | undefined {
  const normalized = String(quality || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === '4k') return '4K';
  if (normalized === 'medium' || normalized === 'hd' || normalized === '2k') return '2K';
  if (normalized === 'low' || normalized === 'standard' || normalized === '1k') return '1K';
  return undefined;
}

/**
 * Convert a named aspect ratio plus the selected output tier to a fixed,
 * provider-neutral draft size. Gemini receives the inferred tier while GPT
 * Image 2 may use dimensions directly; both start from the same table.
 */
export function imageRequestSizeForModel(model: string, ratioOrSize: string, quality?: string) {
  const value = ratioOrSize.trim();
  if (/^\d+x\d+$/i.test(value)) return value;
  const ratio = RATIOS.find((item) => item.key === value)
    || (value.toLowerCase() === 'auto' ? RATIOS.find((item) => item.key === '1:1') : undefined);
  const requested = imageOutputSizeForQuality(quality);
  if (!ratio || !requested) return undefined;

  const supported = imageOutputSizeOptionsFor(model) as ImageOutputSize[];
  const tier = supported.includes(requested) ? requested : supported[0];
  return IMAGE_REQUEST_SIZE_TABLE[tier][ratio.key];
}

/** Infer Gemini's 1K/2K/4K tier from the Creator draft geometry. */
export function imageOutputSizeForDimensions(value: string): ImageOutputSize {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) return '1K';
  const edge = Math.max(Number(match[1]), Number(match[2]));
  return edge <= 1536 ? '1K' : edge <= 3072 ? '2K' : '4K';
}

/**
 * Exact width/height is a GPT Image 2 control. Gemini receives an aspect
 * ratio plus an inferred fixed 1K/2K/4K tier from the stored draft geometry.
 */
export function supportsExactImageSize(model: string) {
  return getImageModel(model)?.provider === 'gpt-image';
}

export function sizeFor(model: string, ratio: string) {
  const sizes = supportsExactImageSize(model) ? GPT_SIZES : GEMINI_SIZES;
  return sizes[ratio] || '1024x1024';
}
