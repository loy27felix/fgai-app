export type TextModelProvider = 'wetoken';

export interface TextModel {
  id: string;
  label: string;
  provider: TextModelProvider;
  apiModel: string;
  supportsImages: boolean;
  thinkable?: boolean;
}

export const TEXT_MODELS: TextModel[] = [
  { id: 'gpt-5.6-luna-t1a', label: 'GPT-5.6 Luna T1A · 快速', provider: 'wetoken', apiModel: 'gpt-5.6-luna-t1a', supportsImages: true, thinkable: true },
  { id: 'gpt-5.6-terra-t1a', label: 'GPT-5.6 Terra T1A · 深度', provider: 'wetoken', apiModel: 'gpt-5.6-terra-t1a', supportsImages: true, thinkable: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · 均衡', provider: 'wetoken', apiModel: 'claude-sonnet-5', supportsImages: true, thinkable: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5 · 高级', provider: 'wetoken', apiModel: 'claude-opus-5', supportsImages: true, thinkable: true },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro · 中文', provider: 'wetoken', apiModel: 'deepseek-v4-pro', supportsImages: false, thinkable: true },
];

export const DEFAULT_TEXT_MODEL_ID = 'gpt-5.6-luna-t1a';

export function isTextModelId(id: unknown): id is string {
  return typeof id === 'string' && TEXT_MODELS.some((model) => model.id === id);
}

export function resolveTextModel(id?: string): TextModel {
  return TEXT_MODELS.find((model) => model.id === id) ?? TEXT_MODELS[0];
}
