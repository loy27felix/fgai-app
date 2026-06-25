// 文本模型清单（客户端/服务端共用，纯数据）
export type Provider = "deepseek" | "relay";
export interface TextModel {
  id: string;
  label: string;
  provider: Provider;
  apiModel: string;   // 实际请求用的 model 名
  thinkable?: boolean; // 是否支持「思考」开关（仅 deepseek）
}

// relay 的 apiModel 名以中转站「模型兼容性」页为准，若报 model 不存在，改这里即可。
export const TEXT_MODELS: TextModel[] = [
  { id: "deepseek-flash",         label: "DeepSeek v4-flash · 快",   provider: "deepseek", apiModel: "deepseek-v4-flash", thinkable: true },
  { id: "deepseek-pro",           label: "DeepSeek v4-pro · 强",     provider: "deepseek", apiModel: "deepseek-v4-pro",   thinkable: true },
  { id: "gpt-5.5",                label: "GPT-5.5 · OpenAI 前沿",    provider: "relay",    apiModel: "gpt-5.5" },
  { id: "claude-opus-4-8",        label: "Claude Opus 4.8",          provider: "relay",    apiModel: "claude-opus-4-8" },
  { id: "claude-opus-4-8-thinking", label: "Claude Opus 4.8 · 深度思考", provider: "relay", apiModel: "claude-opus-4-8-thinking" },
  { id: "glm-5.2",                label: "GLM-5.2 · 智谱旗舰",       provider: "relay",    apiModel: "glm-5.2" },
];

export function resolveModel(id?: string): TextModel {
  if (id) {
    const hit = TEXT_MODELS.find((m) => m.id === id);
    if (hit) return hit;
  }
  return TEXT_MODELS[0];
}
