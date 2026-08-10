import type { ChatResult } from "../deepseek";
import { providerReasoningEffort, type ReasoningEffort } from "./reasoning";

export type OpenAITextPart = { type: "text"; text: string };
export type OpenAIImagePart = { type: "image_url"; image_url: { url: string } };
export type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string | Array<OpenAITextPart | OpenAIImagePart> };

export interface WetokenChatOptions {
  model: string;
  messages: OpenAIMessage[];
  reasoningEffort?: ReasoningEffort;
  jsonOutput?: boolean;
  maxTokens?: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function wetokenChat(options: WetokenChatOptions, dependencies: { fetcher?: Fetcher } = {}): Promise<ChatResult> {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error("缺少 WETOKEN_API_KEY 环境变量");
  const base = (process.env.WETOKEN_BASE_URL || "https://wetoken.ai/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = { model: options.model, messages: options.messages, stream: false, max_tokens: options.maxTokens ?? 2000 };
  const reasoningEffort = providerReasoningEffort(options.reasoningEffort, "wetoken");
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (options.jsonOutput) body.response_format = { type: "json_object" };
  const response = await (dependencies.fetcher ?? fetch)(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || response.statusText || "request failed").slice(0, 300);
    throw new Error(`Wetoken ${response.status}: ${message}`);
  }
  return { content: data?.choices?.[0]?.message?.content ?? "", usage: data?.usage };
}
