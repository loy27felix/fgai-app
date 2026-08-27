import { NextResponse } from 'next/server';
import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from '@/lib/ai/catalog';
import { chatWithTextModel } from '@/lib/ai/text';
import { normalizeReasoningEffort } from '@/lib/ai/reasoning';
import { buildCreatorContextMessages, titleFromPrompt } from '@/lib/creator/chat';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { buildTextLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';
import { assertMonthlyBudgetAvailable, estimateTextBudgetUsd } from '@/lib/usage/budget';
import {
  attachTraceId,
  logServerEvent,
  logServerFailure,
  requestTraceId,
} from '@/lib/observability/server-log';
import { recordAuditEvent } from '@/lib/observability/audit-event';

export const runtime = 'nodejs';
export const maxDuration = 60;

type CreatorChatBody = {
  sessionId?: string;
  message?: string;
  model?: string;
  thinking?: boolean;
  reasoningEffort?: unknown;
  images?: string[];
  skill?: unknown;
};

function normalizeSkill(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const value = input as { name?: unknown; content?: unknown };
  if (typeof value.name !== 'string' || typeof value.content !== 'string') return null;
  const name = value.name.trim().slice(0, 80);
  const content = value.content.trim().slice(0, 30_000);
  return name && content ? { name, content } : null;
}

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) {
    logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'rejected', reason: 'unauthenticated' }, 'warn');
    return respond({ error: '未登录' }, { status: 401 });
  }

  let body: CreatorChatBody;
  try {
    body = await req.json();
  } catch (error) {
    logServerFailure('creator_chat', error, { traceId, feature: 'creator_chat', stage: 'rejected', actorId: user.id, reason: 'invalid_json' });
    return respond({ error: '请求体格式错误' }, { status: 400 });
  }

  const message = body.message?.trim() || '';
  const model = body.model || DEFAULT_TEXT_MODEL_ID;
  const skill = normalizeSkill(body.skill);
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);
  if (!body.sessionId || !message) {
    logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'rejected', actorId: user.id, reason: 'missing_session_or_message' }, 'warn');
    return respond({ error: '缺少会话或消息' }, { status: 400 });
  }
  if (!isTextModelId(model)) {
    logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'rejected', actorId: user.id, sessionId: body.sessionId, reason: 'unsupported_model' }, 'warn');
    return respond({ error: '不支持的模型' }, { status: 400 });
  }
  let imageBytes = 0;
  const images = (body.images || []).filter((item) => {
    if (typeof item !== 'string' || item.length > 2_000_000 || imageBytes + item.length > 4_000_000) return false;
    imageBytes += item.length;
    return true;
  }).slice(0, 4);
  logServerEvent('creator_chat', {
    traceId,
    feature: 'creator_chat',
    stage: 'received',
    actorId: user.id,
    sessionId: body.sessionId,
    model,
    messageCharacters: message.length,
    imageCount: images.length,
    skillEnabled: Boolean(skill),
    reasoningEffort,
  });
  await recordAuditEvent({
    traceId,
    actorId: user.id,
    feature: 'creator_chat',
    action: 'message',
    resourceType: 'creator_session',
    resourceId: body.sessionId,
    stage: 'received',
    outcome: 'started',
    parameters: { model, messageCharacters: message.length, imageCount: images.length, skillEnabled: Boolean(skill), reasoningEffort },
  });

  let session: { id: string; workspace_id: string; title: string } | null = null;
  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => localClient.rpc('ensure_creator_workspace'),
      load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
    }, user.id);
    const owned = await localClient
      .from('creator_sessions')
      .select('id,workspace_id,title')
      .eq('id', body.sessionId)
      .eq('workspace_id', workspace.id)
      .single();
    if (owned.error || !owned.data) {
      logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'rejected', actorId: user.id, workspaceId: workspace.id, sessionId: body.sessionId, reason: 'session_not_found' }, 'warn');
      return respond({ error: '会话不存在' }, { status: 404 });
    }
    const activeSession = owned.data;
    session = activeSession;

    const insertedUser = await localClient.from('creator_messages').insert({
      session_id: activeSession.id,
      role: 'user',
      content: { text: message, image_count: images.length },
      status: 'complete',
    });
    if (insertedUser.error) throw insertedUser.error;

    const history = await localClient
      .from('creator_messages')
      .select('role,content,status,created_at')
      .eq('session_id', activeSession.id)
      .order('created_at', { ascending: false })
      .limit(80);
    if (history.error) throw history.error;
    const messages = buildCreatorContextMessages((history.data || []).reverse(), {
      skill,
      reasoning: !!body.thinking || reasoningEffort !== "auto",
      reasoningEffort,
    });
    const budget = await assertMonthlyBudgetAvailable({
      userId: user.id,
      estimatedCostUsd: estimateTextBudgetUsd({
        model,
        inputText: JSON.stringify(messages),
        maxOutputTokens: 4000,
      }),
    });
    if (!budget.allowed) {
      logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'rejected', actorId: user.id, workspaceId: workspace.id, sessionId: activeSession.id, model, reason: budget.code || 'monthly_budget' }, 'warn');
      return respond({ error: budget.message, code: budget.code }, { status: 402 });
    }
    const startedAt = Date.now();
    logServerEvent('creator_chat', { traceId, feature: 'creator_chat', stage: 'provider_started', actorId: user.id, workspaceId: workspace.id, sessionId: activeSession.id, model });
    const { spec, result } = await chatWithTextModel({
      modelId: model,
      messages,
      images,
      thinking: !!body.thinking || reasoningEffort !== "auto",
      reasoningEffort,
      maxTokens: 4000,
    });

    const insertedAssistant = await localClient.from('creator_messages').insert({
      session_id: activeSession.id,
      role: 'assistant',
      content: { text: result.content, usage: result.usage || {} },
      status: 'complete',
    }).select('*').single();
    if (insertedAssistant.error) throw insertedAssistant.error;

    const update: Record<string, unknown> = { default_model: spec.id, updated_at: new Date().toISOString() };
    if (activeSession.title === '未命名对话') update.title = titleFromPrompt(message);
    await localClient.from('creator_sessions').update(update).eq('id', activeSession.id).eq('workspace_id', workspace.id);

    const ledgerRecorded = await recordUsageBestEffort(buildTextLedgerEntry({
      userId: user.id,
      workspaceId: workspace.id,
      provider: spec.provider,
      model: spec.id,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    }));

    logServerEvent('creator_chat', {
      traceId,
      feature: 'creator_chat',
      stage: 'completed',
      actorId: user.id,
      workspaceId: workspace.id,
      sessionId: activeSession.id,
      model: spec.id,
      durationMs: Date.now() - startedAt,
      usagePresent: Boolean(result.usage),
      ledgerRecorded,
    });
    await recordAuditEvent({
      traceId,
      actorId: user.id,
      workspaceId: workspace.id,
      feature: 'creator_chat',
      action: 'message',
      resourceType: 'creator_session',
      resourceId: activeSession.id,
      stage: 'completed',
      outcome: 'succeeded',
      durationMs: Date.now() - startedAt,
      parameters: { model: spec.id, messageCharacters: message.length, imageCount: images.length },
      data: { usagePresent: Boolean(result.usage), ledgerRecorded },
    });
    return respond({
      message: insertedAssistant.data,
      title: update.title || activeSession.title,
      model: spec.id,
      usage: result.usage,
    });
  } catch (error: unknown) {
    if (session) {
      await localClient.from('creator_messages').insert({
        session_id: session!.id,
        role: 'assistant',
        content: { text: '本次回复失败，请检查模型或稍后重试。' },
        status: 'failed',
      });
    }
    const detail = error instanceof Error ? error.message : 'AI 请求失败';
    logServerFailure('creator_chat', error, { traceId, feature: 'creator_chat', stage: 'failed', actorId: user.id, sessionId: body.sessionId, model });
    await recordAuditEvent({
      traceId,
      actorId: user.id,
      workspaceId: session?.workspace_id,
      feature: 'creator_chat',
      action: 'message',
      resourceType: 'creator_session',
      resourceId: session?.id || body.sessionId,
      stage: 'failed',
      outcome: 'failed',
      parameters: { model, messageCharacters: message.length, imageCount: images.length },
      error,
      level: 'error',
    });
    return respond({ error: detail }, { status: 500 });
  }
}
