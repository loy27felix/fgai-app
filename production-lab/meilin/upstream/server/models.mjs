// Model catalog mirrored from FG Studio's official model list (gateway/fg-model-capabilities.mjs + canvas fg-model-names.ts).
// Capabilities are computed by FG's own function so limits stay identical to the production workbench.
import { capabilities } from './fg/fg-model-capabilities.mjs';
import {context,integrated} from './fg-context.mjs';

const SPECS = [
  // text
  { id: 'gpt-6.1-sol', label: 'GPT6.1 Sol · Trings 个人 Key', capability: 'text', protocol: 'openai', note: '默认主脑 · high 思考 · 先在个人设置填写 Key', default: true },
  { id: 'claude-sonnet-5-5-t3a', label: 'Claude Sonnet 5.5', capability: 'text', protocol: 'openai', note: '备选主脑' },
  { id: 'claude-opus-5-5-t3a', label: 'Claude Opus 5.5', capability: 'text', protocol: 'openai', note: '最强推理，较慢' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capability: 'text', protocol: 'openai', note: '中文长文本，不读图' },
  // image
  { id: 'gpt-image-2', label: 'GPT Image 2', capability: 'image', protocol: 'openai', default: true },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', capability: 'image', protocol: 'openai' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', capability: 'image', protocol: 'openai' },
  { id: 'dola-seedream-5-0-pro-260628', label: 'Seedream 5 Pro', capability: 'image', protocol: 'ark' },
  { id: 'seedream-5-0-lite-260128', label: 'Seedream 5 Lite', capability: 'image', protocol: 'ark' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image', capability: 'image', protocol: 'gemini' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', capability: 'image', protocol: 'gemini' },
  { id: 'wan2.7-image-pro', label: 'Wan 2.7 Image', capability: 'image', protocol: 'wan' },
  // video
  { id: 'dreamina-seedance-2-5-filter-off', label: 'SD2.5', capability: 'video', protocol: 'ark', default: true },
  { id: 'doubao-seedance-2-0-filter-off', label: 'SD2', capability: 'video', protocol: 'ark' },
  { id: 'doubao-seedance-2-0-fast-filter-off', label: 'SD2-fast', capability: 'video', protocol: 'ark' },
  { id: 'dreamina-seedance-2-0-mini-filter-off', label: 'SD2-mini', capability: 'video', protocol: 'ark' },
  { id: 'wan3.0-video', label: 'Wan 3.0', capability: 'video', protocol: 'fg-wetoken-wan3-video' },
  { id: 'MiniMax-H3', label: 'MiniMax H3', capability: 'video', protocol: 'minimax' },
  { id: 'happyhorse-1.1-r2v', label: 'HappyHorse 1.1 · 参考', capability: 'video', protocol: 'happyhorse' },
  { id: 'happyhorse-1.1-i2v', label: 'HappyHorse 1.1 · 图生', capability: 'video', protocol: 'happyhorse' },
  { id: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1 · 文生', capability: 'video', protocol: 'happyhorse' },
];

function describe(spec, cap) {
  if (spec.capability === 'image') {
    const im = cap.image;
    const tiers = [...new Set((im.size.presets || []).map((p) => p.tier))];
    const bits = [];
    bits.push(`最多 ${im.references.maxImages} 张参考图`);
    if (im.size.parameter === 'aspect_ratio') bits.push(`按比例出图 ${im.quality.values.join('/')}`);
    else if (tiers.length) bits.push(`${tiers.join('/')} 尺寸档`);
    else bits.push(`最大边 ${im.size.constraints?.maxSide || '按尺寸表'}`);
    if (im.references.maskSupported) bits.push('支持局部重绘');
    if (im.transparentBackground?.supported) bits.push('可透明背景');
    return bits.join(' · ');
  }
  if (spec.capability === 'video') {
    const v = cap.video;
    const d = v.duration.values;
    const bits = [`${d[0]}–${d[d.length - 1]} 秒`, v.resolutions.join('/')];
    if (v.references.maxImages) bits.push(`${v.references.maxImages} 张参考图`);
    if (v.references.maxVideos) bits.push(`${v.references.maxVideos} 段参考视频`);
    if (v.generateAudio.supported) bits.push('同步生成对白音频');
    const ops = { text_to_video: '文生', image_to_video: '图生', reference_to_video: '参考生' };
    bits.push(v.operations.map((o) => ops[o]).join('/'));
    return bits.join(' · ');
  }
  return spec.note || '';
}

export const MODELS = SPECS.map((spec) => {
  const cap = capabilities(spec);
  return { ...spec, cap, summary: describe(spec, cap) };
});

export const getModels=()=>integrated?(context().models||[]):MODELS;
export const byId = (id) => getModels().find((m) => m.id === id);
export const defaultModel = (capability) => {
 const preferred={text:integrated&&context().personalGPTConfigured===false?'claude-sonnet-5-5-t3a':'gpt-6.1-sol',image:'gpt-image-2.5-sunburst',video:'dreamina-seedance-2-5-filter-off'}[capability];
 const list=getModels().filter(m=>m.capability===capability);return list.find(m=>m.id===preferred||m.id.endsWith('::'+preferred))?.id||list.find(m=>m.default)?.id||list[0]?.id;
};

// Parameter defaults for a model, used when the user switches model.
export function defaultParams(id, { aspect = '9:16' } = {}) {
  const m = byId(id);
  if (!m) return {};
  if (m.capability === 'image') {
    // Default to 16:9 for every image model, using each model's own size table.
    const im = m.cap.image;
    const quality = im.quality.supported ? (im.quality.values.includes('2K') ? '2K' : im.quality.values.includes('medium') ? 'medium' : im.quality.default) : undefined;
    if (im.size.parameter === 'aspect_ratio') return { size: im.size.values.includes('16:9') ? '16:9' : im.size.default, quality };
    const wide = (im.size.presets || []).find((p) => p.ratio === '16:9');
    const gptWide = ['1536x864', '2048x1152'].find((v) => im.size.values.includes(v));
    return { size: wide?.size || gptWide || im.size.default, quality };
  }
  if (m.capability === 'video') {
    const v = m.cap.video;
    const ratio = v.ratios.includes(aspect) ? aspect : v.defaultRatio;
    const lower = v.resolutions.map((r) => r.toLowerCase());
    const preview = v.resolutions[lower.indexOf('480p')] || v.resolutions[0];
    const final = v.resolutions[lower.indexOf('720p')] || v.resolutions[Math.min(1, v.resolutions.length - 1)];
    return { ratio, preview, final, generateAudio: v.generateAudio.supported ? true : undefined, operation: v.operations.includes('reference_to_video') ? 'reference_to_video' : v.operations[0] };
  }
  return {};
}

// Clamp a segment duration to what the selected video model accepts.
export function fitDuration(id, seconds) {
  const m = byId(id);
  const vals = m?.cap?.video?.duration?.values;
  if (!vals?.length) return seconds;
  if (vals.includes(seconds)) return seconds;
  return vals.reduce((best, v) => (Math.abs(v - seconds) < Math.abs(best - seconds) ? v : best), vals[0]);
}

// Segments are cut by story beats, 10–25 s each, inside what the selected video model can generate
// (e.g. SD2.5 / Wan 3.0 up to 30 s → 10–25 s; SD2 / MiniMax / HappyHorse up to 15 s → 10–15 s).
export const SEGMENT_MIN = 10;
export const SEGMENT_MAX = 25;
export function segmentRange(id) {
  const vals = byId(id)?.cap?.video?.duration?.values || [SEGMENT_MIN, SEGMENT_MAX];
  const max = Math.min(SEGMENT_MAX, Math.max(...vals));
  const min = Math.min(max, Math.max(SEGMENT_MIN, Math.min(...vals)));
  return { min, max };
}
export function planSeconds(id, seconds) {
  const { min, max } = segmentRange(id);
  return fitDuration(id, Math.max(min, Math.min(max, Math.round(Number(seconds) || min))));
}
export function maxRefs(id) {
  return byId(id)?.cap?.video?.references?.maxImages ?? 9;
}

export function publicCatalog() {
  return getModels().map(({ id, label, capability, note, summary, cap, default: d }) => ({ id, label, capability, note, summary, default: !!d, cap }));
}
