import { NextResponse } from "next/server";

import { buildSeedAudioRequest, isSeedAudioModel, SEED_AUDIO_ENDPOINT, seedAudioMimeType, normalizeSeedAudioFormat } from "@/lib/ai/seed-audio";
import { logServerEvent, logServerFailure, requestTraceId } from "@/lib/observability/server-log";
import { createClient } from "@/lib/local/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 330;

const PROVIDER_TIMEOUT_MS = 300_000;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function providerMessage(payload: Record<string, unknown>) {
  const nested = asRecord(payload.data);
  for (const value of [payload.message, payload.msg, payload.error, nested.message, nested.msg]) {
    if (typeof value === "string" && value.trim()) return value.trim();
    const error = asRecord(value);
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  }
  return "";
}

function userFacingProviderError(status: number, payload: Record<string, unknown>) {
  if (status === 401 || status === 403) return "Seed Audio 鉴权失败，请检查服务端 API Key 和模型权限";
  if (status === 429) return "Seed Audio 请求过于频繁或额度不足，请稍后重试";
  if (status === 408 || status === 504) return "Seed Audio 响应超时；请稍后查看生成记录，不要重复提交";
  const detail = providerMessage(payload);
  if (detail && /版权|安全|违规|敏感|copyright|safety|moderation|policy/i.test(detail)) return "音频提示词触发了供应商内容安全限制，请修改描述后重试";
  if (detail && /参数|parameter|invalid|unsupported|format|model/i.test(detail)) return "Seed Audio 参数或模型不受支持，请检查音频模型和格式设置";
  return status >= 500 ? "Seed Audio 服务暂时不可用，请稍后重试" : "Seed Audio 请求失败，请稍后重试";
}

function responsePayload(value: unknown) {
  const payload = asRecord(value);
  const data = asRecord(payload.data);
  return { payload, data };
}

function responseCode(payload: Record<string, unknown>, data: Record<string, unknown>) {
  const code = payload.code ?? data.code;
  if (code === undefined || code === null || code === "" || code === 0 || code === "0") return 0;
  const parsed = Number(code);
  return Number.isFinite(parsed) ? parsed : 1;
}

function base64Bytes(value: string) {
  const normalized = value.replace(/^data:audio\/[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const bytes = Buffer.from(normalized, "base64");
  return bytes.length ? bytes : null;
}

async function fetchProviderAudio(payload: Record<string, unknown>, apiKey: string, requestId: string) {
  const upstream = await fetch(SEED_AUDIO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Request-Id": requestId,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const raw = await upstream.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const { payload: responseBody, data } = responsePayload(parsed);
  if (!upstream.ok || responseCode(responseBody, data) !== 0) {
    const error = new Error(userFacingProviderError(upstream.status, responseBody));
    Object.assign(error, { status: upstream.status, providerMessage: providerMessage(responseBody) });
    throw error;
  }

  const audio = typeof responseBody.audio === "string" ? responseBody.audio : typeof data.audio === "string" ? data.audio : "";
  if (audio) {
    const bytes = base64Bytes(audio);
    if (!bytes || bytes.length > MAX_AUDIO_BYTES) throw new Error("Seed Audio 返回的音频为空或超出大小限制");
    return { bytes, mimeType: "", source: "base64" as const };
  }

  const url = typeof responseBody.url === "string" ? responseBody.url : typeof data.url === "string" ? data.url : "";
  if (!url || !/^https:\/\//i.test(url)) throw new Error("Seed Audio 未返回可用音频结果");
  const media = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!media.ok) throw new Error(`Seed Audio 结果读取失败（HTTP ${media.status}）`);
  const bytes = Buffer.from(await media.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Seed Audio 返回的音频为空或超出大小限制");
  return { bytes, mimeType: media.headers.get("content-type") || "", source: "url" as const };
}

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  try {
    const localClient = createClient();
    const { data: { user } } = await localClient.auth.getUser();
    if (!user) return response("请先登录", "UNAUTHENTICATED", 401);

    const apiKey = process.env.VOLCENGINE_SEED_AUDIO_API_KEY?.trim();
    if (!apiKey) return response("服务端尚未配置 Seed Audio API Key，请联系管理员", "SEED_AUDIO_NOT_CONFIGURED", 503);

    const body = asRecord(await req.json().catch(() => ({})));
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (model && !isSeedAudioModel(model)) return response("当前音频请求的模型不是 seed-audio-1.0", "UNSUPPORTED_AUDIO_MODEL", 400);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return response("请输入音频描述或文本", "PROMPT_REQUIRED", 400);
    if (prompt.length > MAX_PROMPT_LENGTH) return response(`音频描述不能超过 ${MAX_PROMPT_LENGTH} 个字符`, "PROMPT_TOO_LONG", 400);

    const format = normalizeSeedAudioFormat(typeof body.format === "string" ? body.format : "mp3");
    const payload = buildSeedAudioRequest({ prompt, format, instructions: typeof body.instructions === "string" ? body.instructions : "" });
    const providerRequestId = crypto.randomUUID();
    const result = await fetchProviderAudio(payload, apiKey, providerRequestId);
    const contentType = result.mimeType.startsWith("audio/") ? result.mimeType : seedAudioMimeType(format);
    logServerEvent("creator_seed_audio", { traceId, userId: user.id, model: payload.model, providerRequestId, source: result.source, bytes: result.bytes.length });
    return new NextResponse(result.bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "no-store",
        "X-Seed-Audio-Request-Id": providerRequestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed Audio 请求失败，请稍后重试";
    logServerFailure("creator_seed_audio_failed", error, { traceId });
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return response("Seed Audio 响应超时；请稍后查看生成记录，不要重复提交", "SEED_AUDIO_TIMEOUT", 504);
    return response(message, "SEED_AUDIO_FAILED", 502);
  }
}
