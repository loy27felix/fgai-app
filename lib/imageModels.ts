// 图片模型 + 比例 + 尺寸换算（客户端共用）
export const IMG_MODELS = [
  { id: "gpt-image-2",        label: "gpt-image-2 · 中文佳/高保真" },
  { id: "gpt-image-2-vip",    label: "gpt-image-2-vip · 1–8K 高清" },
  { id: "gpt-image-2-c",      label: "gpt-image-2-c · 1K 性价比" },
  { id: "nano-banana-pro",    label: "nano-banana-pro · 锁脸/换装(强)" },
  { id: "nano-banana-2",      label: "nano-banana-2 · 一致性快出图(快)" },
  { id: "gemini-3-pro-image", label: "gemini-3-pro-image · 精修" },
];
export const RATIOS = [
  { key: "9:16", label: "9:16 竖屏(漫剧)" },
  { key: "1:1", label: "1:1 方图" },
  { key: "16:9", label: "16:9 横屏" },
  { key: "3:4", label: "3:4" },
  { key: "4:3", label: "4:3" },
  { key: "2:3", label: "2:3" },
  { key: "3:2", label: "3:2" },
];
// gpt-image 任意 16 倍数；gemini/nano-banana 只吃固定档位
const GPT_SIZES: Record<string, string> = { "1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536", "4:3": "1024x768", "3:4": "768x1024", "3:2": "1248x832", "2:3": "832x1248" };
const GEM_SIZES: Record<string, string> = { "1:1": "1024x1024", "16:9": "1344x768", "9:16": "768x1344", "4:3": "1152x896", "3:4": "896x1152", "3:2": "1216x832", "2:3": "832x1216" };
export function sizeFor(model: string, ratio: string) { const m = model.startsWith("gpt-image") ? GPT_SIZES : GEM_SIZES; return m[ratio] || "1024x1024"; }
