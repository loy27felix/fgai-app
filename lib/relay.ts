// OpenAI 兼容中转站的 Chat Completions 封装（仅服务端）
import type { ChatMessage, ChatResult } from "@/lib/deepseek";

const BASE = process.env.RELAY_BASE_URL || "https://api.gpt.ge/v1";
const KEY = process.env.RELAY_API_KEY;

export async function relayChat(opts: {
  model: string;
  messages: any[];
  jsonOutput?: boolean;
  maxTokens?: number;
}): Promise<ChatResult> {
  if (!KEY) throw new Error("缺少 RELAY_API_KEY 环境变量");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 2000,
  };
  if (opts.jsonOutput) body.response_format = { type: "json_object" };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`中转站 ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();
  return { content: data?.choices?.[0]?.message?.content ?? "", usage: data?.usage };
}
