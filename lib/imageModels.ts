export type ImageProvider = 'gpt-image' | 'gemini';

export type ImageModelSpec = {
  id: string;
  label: string;
  provider: ImageProvider;
  experimental: boolean;
  maxReferences: number;
};

export const IMG_MODELS: ImageModelSpec[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2 · 中文与高保真', provider: 'gpt-image', experimental: false, maxReferences: 8 },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image · 精修', provider: 'gemini', experimental: false, maxReferences: 8 },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image · 实验', provider: 'gemini', experimental: true, maxReferences: 8 },
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image · 实验', provider: 'gemini', experimental: true, maxReferences: 8 },
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

export function sizeFor(model: string, ratio: string) {
  const sizes = getImageModel(model)?.provider === 'gpt-image' ? GPT_SIZES : GEMINI_SIZES;
  return sizes[ratio] || '1024x1024';
}
