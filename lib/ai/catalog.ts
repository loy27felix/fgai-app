export type TextModelProvider = 'deepseek' | 'wetoken';

export interface TextModel {
  id: string;
  label: string;
  provider: TextModelProvider;
  apiModel: string;
  supportsImages: boolean;
  thinkable?: boolean;
}

export const TEXT_MODELS: TextModel[] = [
  { id: 'deepseek-flash', label: 'DeepSeek v4-flash · 快', provider: 'deepseek', apiModel: 'deepseek-v4-flash', supportsImages: false, thinkable: true },
  { id: 'deepseek-pro', label: 'DeepSeek v4-pro · 强', provider: 'deepseek', apiModel: 'deepseek-v4-pro', supportsImages: false, thinkable: true },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna · 快速', provider: 'wetoken', apiModel: 'gpt-5.6-luna', supportsImages: true },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra · 均衡', provider: 'wetoken', apiModel: 'gpt-5.6-terra', supportsImages: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol · 高级推理', provider: 'wetoken', apiModel: 'gpt-5.6-sol', supportsImages: true },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'wetoken', apiModel: 'claude-opus-4-8', supportsImages: true },
];

export function resolveTextModel(id?: string): TextModel {
  return TEXT_MODELS.find((model) => model.id === id) ?? TEXT_MODELS[0];
}
