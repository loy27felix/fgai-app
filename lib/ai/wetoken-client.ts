import { randomUUID } from "node:crypto";
import type { ChatResult } from "../deepseek";
import { providerReasoningEffort, type ReasoningEffort } from "./reasoning";
import { wetokenProviderDispatcher, type WetokenFetcher } from "./wetoken-transport";
import {
  fullLogPayload,
  logServerEvent,
  logServerFailure,
  redactProviderUrl,
  safeProviderHeaders,
} from "../observability/server-log";

export type OpenAITextPart = { type: "text"; text: string };
export type OpenAIImagePart = { type: "image_url"; image_url: { url: string } };
export type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string | Array<OpenAITextPart | OpenAIImagePart> };

export interface WetokenChatOptions {
  model: string;
  messages: OpenAIMessage[];
  reasoningEffort?: ReasoningEffort;
  jsonOutput?: boolean;
  maxTokens?: number;
  traceId?: string;
  taskId?: string;
  sessionId?: string;
}

type Fetcher = WetokenFetcher;

/**
 * Wetoken validates only the final user turn for this provider quirk. Put a
 * lowercase `json` token there instead of relying on system instructions.
 * Wetoken 只校验最后一个用户消息，因此必须把小写 `json` 放在该消息中。
 */
function messagesForJsonOutput(messages: OpenAIMessage[]) {
  const instruction = "\n\n仅返回一个有效的 json object，不要 Markdown。";
  const index = messages.map((message) => message.role).lastIndexOf("user");
  if (index < 0) return [...messages, { role: "user" as const, content: instruction.trim() }];
  return messages.map((message, messageIndex) => {
    if (messageIndex !== index) return message;
    if (typeof message.content === "string") return { ...message, content: `${message.content}${instruction}` };
    return { ...message, content: [...message.content, { type: "text" as const, text: instruction.trim() }] };
  });
}

export async function wetokenChat(options: WetokenChatOptions, dependencies: { fetcher?: Fetcher } = {}): Promise<ChatResult> {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error("缺少 WETOKEN_API_KEY 环境变量");
  const base = (process.env.WETOKEN_BASE_URL || "https://wetoken.ai/v1").replace(/\/$/, "");
  const messages = options.jsonOutput ? messagesForJsonOutput(options.messages) : options.messages;
  const body: Record<string, unknown> = { model: options.model, messages, stream: false, max_tokens: options.maxTokens ?? 2000 };
  const reasoningEffort = providerReasoningEffort(options.reasoningEffort, "wetoken");
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (options.jsonOutput) body.response_format = { type: "json_object" };
  const exchangeId = randomUUID();
  const requestUrl = `${base}/chat/completions`;
  const requestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    dispatcher: wetokenProviderDispatcher,
    signal: AbortSignal.timeout(55_000),
  };
  const baseLogFields = {
    traceId: options.traceId,
    taskId: options.taskId,
    sessionId: options.sessionId,
    provider: "wetoken",
    feature: "wetoken_chat",
    operation: "chat.completions",
    exchangeId,
  };
  const request = {
    method: requestInit.method,
    url: redactProviderUrl(requestUrl),
    headers: safeProviderHeaders(requestInit.headers),
    body: fullLogPayload(body),
  };
  logServerEvent("wetoken_chat_exchange", {
    ...baseLogFields,
    stage: "request_sent",
    request,
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await (dependencies.fetcher ?? fetch)(requestUrl, requestInit);
  } catch (error) {
    logServerFailure("wetoken_chat_exchange", error, {
      ...baseLogFields,
      stage: "transport_failed",
      durationMs: Date.now() - startedAt,
      request,
    });
    throw error;
  }

  let responseText = "";
  let responseBodyReadError: unknown;
  try {
    responseText = await response.text();
  } catch (error) {
    responseBodyReadError = error;
    logServerFailure("wetoken_chat_exchange", error, {
      ...baseLogFields,
      stage: "response_body_read_failed",
      durationMs: Date.now() - startedAt,
      responseStatus: response.status,
      responseHeaders: safeProviderHeaders(response.headers),
      request,
    });
  }

  let data: any = {};
  let responseBodyEncoding: "json" | "text" = "json";
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBodyEncoding = "text";
  }
  logServerEvent("wetoken_chat_exchange", {
    ...baseLogFields,
    stage: "response_received",
    durationMs: Date.now() - startedAt,
    responseStatus: response.status,
    responseStatusText: response.statusText,
    responseHeaders: safeProviderHeaders(response.headers),
    responseBodyEncoding,
    responseBody: fullLogPayload(data),
    ...(responseBodyEncoding === "text" ? { responseBodyText: fullLogPayload(responseText) } : {}),
    ...(responseBodyReadError ? { responseBodyReadFailed: true } : {}),
  }, response.ok ? "info" : "warn");

  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || response.statusText || "request failed").slice(0, 300);
    throw new Error(`Wetoken ${response.status}: ${message}`);
  }
  return { content: data?.choices?.[0]?.message?.content ?? "", usage: data?.usage };
}
