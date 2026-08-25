import { NextResponse } from 'next/server';
import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from '@/lib/ai/catalog';
import { chatWithTextModel } from '@/lib/ai/text';
import { normalizeReasoningEffort } from '@/lib/ai/reasoning';
import type { ChatMessage } from '@/lib/deepseek';
import { createClient } from '@/lib/local/server';
import { buildTextLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';
import { assertMonthlyBudgetAvailable, estimateTextBudgetUsd } from '@/lib/usage/budget';
import {
  attachTraceId,
  logServerEvent,
  logServerFailure,
  requestTraceId,
} from '@/lib/observability/server-log';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ChatRequestBody = {
  messages?: ChatMessage[];
  model?: string;
  thinking?: boolean;
  reasoningEffort?: unknown;
  jsonOutput?: boolean;
  projectId?: string;
  images?: string[];
};

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) {
    logServerEvent('ai_chat', { traceId, feature: 'ai_chat', stage: 'rejected', reason: 'unauthenticated' }, 'warn');
    return respond({ error: '未登录' }, { status: 401 });
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch (error) {
    logServerFailure('ai_chat', error, { traceId, feature: 'ai_chat', stage: 'rejected', actorId: user.id, reason: 'invalid_json' });
    return respond({ error: '请求体格式错误' }, { status: 400 });
  }

  const messages = body.messages || [];
  if (!messages.length) {
    logServerEvent('ai_chat', { traceId, feature: 'ai_chat', stage: 'rejected', actorId: user.id, reason: 'empty_messages' }, 'warn');
    return respond({ error: 'messages 为空' }, { status: 400 });
  }

  const modelId = body.model || DEFAULT_TEXT_MODEL_ID;
  if (!isTextModelId(modelId)) {
    logServerEvent('ai_chat', { traceId, feature: 'ai_chat', stage: 'rejected', actorId: user.id, reason: 'unsupported_model' }, 'warn');
    return respond({ error: '不支持的文本模型' }, { status: 400 });
  }
  const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);
  logServerEvent('ai_chat', {
    traceId,
    feature: 'ai_chat',
    stage: 'received',
    actorId: user.id,
    model: modelId,
    messageCount: messages.length,
    imageCount: images.length,
    reasoningEffort,
  });

  try {
    const budget = await assertMonthlyBudgetAvailable({
      userId: user.id,
      estimatedCostUsd: estimateTextBudgetUsd({
        model: modelId,
        inputText: JSON.stringify(messages),
        maxOutputTokens: 4000,
      }),
    });
    if (!budget.allowed) {
      logServerEvent('ai_chat', { traceId, feature: 'ai_chat', stage: 'rejected', actorId: user.id, model: modelId, reason: budget.code || 'monthly_budget' }, 'warn');
      return respond({ error: budget.message, code: budget.code }, { status: 402 });
    }
    const startedAt = Date.now();
    logServerEvent('ai_chat', { traceId, feature: 'ai_chat', stage: 'provider_started', actorId: user.id, model: modelId });
    const { spec, result } = await chatWithTextModel({
      modelId,
      messages,
      images,
      thinking: !!body.thinking || reasoningEffort !== "auto",
      reasoningEffort,
      jsonOutput: !!body.jsonOutput,
    });

    try {
      const usage = result.usage;
      await localClient.from('ai_usage').insert({
        user_id: user.id,
        project_id: body.projectId ?? null,
        model: spec.id,
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      });
    } catch (error) {
      // Usage accounting must not hide a successful model response.
      logServerFailure('ai_chat', error, { traceId, feature: 'ai_chat', stage: 'usage_write_failed', actorId: user.id, model: spec.id });
    }

    const ledgerRecorded = await recordUsageBestEffort(buildTextLedgerEntry({
      userId: user.id,
      projectId: body.projectId ?? null,
      provider: spec.provider,
      model: spec.id,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    }));

    logServerEvent('ai_chat', {
      traceId,
      feature: 'ai_chat',
      stage: 'completed',
      actorId: user.id,
      model: spec.id,
      durationMs: Date.now() - startedAt,
      usagePresent: Boolean(result.usage),
      ledgerRecorded,
    });
    return respond({ content: result.content, usage: result.usage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI 请求失败';
    logServerFailure('ai_chat', error, { traceId, feature: 'ai_chat', stage: 'failed', actorId: user.id, model: modelId });
    return respond({ error: message }, { status: 500 });
  }
}
