import type { ChatMessage, ChatResult } from "../deepseek";
import { resolveTextModel, type TextModel } from "./catalog";
import { wetokenChat, type OpenAIMessage } from "./wetoken-client";
import type { ReasoningEffort } from "./reasoning";

export interface TextChatOptions {
  modelId?: string;
  messages: ChatMessage[];
  images?: string[];
  thinking?: boolean;
  reasoningEffort?: ReasoningEffort;
  jsonOutput?: boolean;
  maxTokens?: number;
  traceId?: string;
  taskId?: string;
  sessionId?: string;
}

type TextDependencies = { wetoken?: typeof wetokenChat };

export async function chatWithTextModel(options: TextChatOptions, dependencies: TextDependencies = {}): Promise<{ spec: TextModel; result: ChatResult }> {
  const spec = resolveTextModel(options.modelId);
  const images = (options.images ?? []).filter(Boolean);
  if (images.length > 0 && !spec.supportsImages) throw new Error("当前模型不支持图片输入，请选择支持视觉输入的 Claude 或 GPT 模型");

  const messages: OpenAIMessage[] = options.messages.map((message) => ({ ...message }));
  if (images.length > 0) {
    let finalUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === "user") { finalUserIndex = index; break; }
    if (finalUserIndex < 0) throw new Error("图片输入缺少 user 消息");
    const finalUser = messages[finalUserIndex];
    const text = typeof finalUser.content === "string" ? finalUser.content : "";
    messages[finalUserIndex] = { role: "user", content: [{ type: "text", text }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] };
  }
  const result = await (dependencies.wetoken ?? wetokenChat)({
    model: spec.apiModel,
    messages,
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    jsonOutput: options.jsonOutput,
    maxTokens: options.maxTokens,
    ...(options.traceId ? { traceId: options.traceId } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  });
  return { spec, result };
}
