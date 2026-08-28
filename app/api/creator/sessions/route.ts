import { NextResponse } from 'next/server';
import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from '@/lib/ai/catalog';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { normalizeCreatorMessages, normalizeCreatorSessions } from '@/lib/creator/session-read';
import { createClient } from '@/lib/local/server';
import {
  attachTraceId,
  logServerEvent,
  logServerFailure,
  requestTraceId,
} from '@/lib/observability/server-log';
import { recordAuditEvent } from '@/lib/observability/audit-event';

export const runtime = 'nodejs';

async function creatorContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc('ensure_creator_workspace'),
    load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { localClient, user, workspace };
}

export async function GET(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  const searchParams = new URL(req.url).searchParams;
  const sessionId = searchParams.get('sessionId');
  const requestedKind = searchParams.get('kind');
  const kind = requestedKind === 'chat' || requestedKind === 'image' || requestedKind === 'video' ? requestedKind : null;
  try {
    const context = await creatorContext();
    if (!context) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'read', reason: 'unauthenticated', kind: kind || undefined }, 'warn');
      return respond({ error: '未登录' }, { status: 401 });
    }
    logServerEvent('creator_session', {
      traceId,
      feature: 'creator_session',
      stage: 'context_ready',
      action: 'read',
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      sessionId: sessionId || undefined,
      kind: kind || undefined,
    });
    // Keep this query deliberately column-minimal. Older local PostgreSQL
    // volumes may not yet have optional creator session columns, and selecting
    // or ordering by them turns a recoverable old schema into a blank history.
    const query = context.localClient
      .from('creator_sessions')
      .select('*')
      .eq('workspace_id', context.workspace.id);
    logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'sessions_query_started', action: 'read', actorId: context.user.id, workspaceId: context.workspace.id, kind: kind || undefined });
    const { data: rawSessions, error } = await query;
    if (error) throw error;
    const sessions = normalizeCreatorSessions(rawSessions || [], kind);
    logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'sessions_query_completed', action: 'read', actorId: context.user.id, workspaceId: context.workspace.id, kind: kind || undefined, rawSessionCount: (rawSessions || []).length, sessionCount: sessions.length, compatibilityRead: true });

    let messages: unknown[] = [];
    if (sessionId) {
      const owned = sessions.some((session) => session.id === sessionId);
      if (!owned) {
        logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'read', actorId: context.user.id, workspaceId: context.workspace.id, sessionId, kind: kind || undefined, reason: 'session_not_found' }, 'warn');
        return respond({ error: '会话不存在' }, { status: 404 });
      }
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'messages_query_started', action: 'read', actorId: context.user.id, workspaceId: context.workspace.id, sessionId });
      const result = await context.localClient
        .from('creator_messages')
        .select('*')
        .eq('session_id', sessionId);
      if (result.error) throw result.error;
      messages = normalizeCreatorMessages(result.data || []);
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'messages_query_completed', action: 'read', actorId: context.user.id, workspaceId: context.workspace.id, sessionId, messageCount: messages.length });
    }
    logServerEvent('creator_session', {
      traceId,
      feature: 'creator_session',
      stage: 'completed',
      action: 'read',
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      sessionId: sessionId || undefined,
      kind: kind || undefined,
      sessionCount: sessions.length,
      messageCount: messages.length,
    });
    await recordAuditEvent({
      traceId,
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      feature: 'creator_session',
      action: 'read',
      resourceType: 'creator_session',
      resourceId: sessionId,
      stage: 'completed',
      outcome: 'succeeded',
      parameters: { kind, sessionIdPresent: Boolean(sessionId) },
      data: { sessionCount: sessions.length, messageCount: messages.length },
    });
    return respond({ workspace: context.workspace, sessions, messages });
  } catch (error: unknown) {
    logServerFailure('creator_session', error, { traceId, feature: 'creator_session', stage: 'failed', action: 'read', sessionId: sessionId || undefined, kind: kind || undefined });
    await recordAuditEvent({ traceId, feature: 'creator_session', action: 'read', resourceType: 'creator_session', resourceId: sessionId, stage: 'failed', outcome: 'failed', parameters: { kind }, error, level: 'error' });
    return respond({ error: '读取会话失败，请重新读取。' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  try {
    const context = await creatorContext();
    if (!context) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'create', reason: 'unauthenticated' }, 'warn');
      return respond({ error: '未登录' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const kind = ['chat', 'image', 'video'].includes(body.kind) ? body.kind : 'chat';
    const { data, error } = await context.localClient
      .from('creator_sessions')
      .insert({
        workspace_id: context.workspace.id,
        kind,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : '未命名对话',
        default_model: kind === 'chat'
          ? (isTextModelId(body.model) ? body.model : DEFAULT_TEXT_MODEL_ID)
          : (typeof body.model === 'string' ? body.model : null),
      })
      .select('*')
      .single();
    if (error) throw error;
    logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'completed', action: 'create', actorId: context.user.id, workspaceId: context.workspace.id, sessionId: data.id, kind, model: data.default_model || undefined });
    await recordAuditEvent({
      traceId,
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      feature: 'creator_session',
      action: 'create',
      resourceType: 'creator_session',
      resourceId: data.id,
      stage: 'completed',
      outcome: 'succeeded',
      parameters: { kind, model: data.default_model },
    });
    return respond({ session: data }, { status: 201 });
  } catch (error: unknown) {
    logServerFailure('creator_session', error, { traceId, feature: 'creator_session', stage: 'failed', action: 'create' });
    await recordAuditEvent({ traceId, feature: 'creator_session', action: 'create', resourceType: 'creator_session', stage: 'failed', outcome: 'failed', error, level: 'error' });
    return respond({ error: error instanceof Error ? error.message : '创建会话失败' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  try {
    const context = await creatorContext();
    if (!context) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'update', reason: 'unauthenticated' }, 'warn');
      return respond({ error: '未登录' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    if (typeof body.id !== 'string') {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'update', actorId: context.user.id, reason: 'missing_session_id' }, 'warn');
      return respond({ error: '缺少会话 ID' }, { status: 400 });
    }
    const changes: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) changes.title = body.title.trim().slice(0, 80);
    if (typeof body.model === 'string') {
      if (!isTextModelId(body.model)) {
        logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'update', actorId: context.user.id, sessionId: body.id, reason: 'unsupported_model' }, 'warn');
        return respond({ error: '不支持的文本模型' }, { status: 400 });
      }
      changes.default_model = body.model;
    }
    if (body.archived === true) changes.archived_at = new Date().toISOString();
    const { data, error } = await context.localClient
      .from('creator_sessions')
      .update(changes)
      .eq('id', body.id)
      .eq('workspace_id', context.workspace.id)
      .select('*')
      .single();
    if (error) throw error;
    logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'completed', action: 'update', actorId: context.user.id, workspaceId: context.workspace.id, sessionId: data.id, changedFields: Object.keys(changes) });
    await recordAuditEvent({
      traceId,
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      feature: 'creator_session',
      action: 'update',
      resourceType: 'creator_session',
      resourceId: data.id,
      stage: 'completed',
      outcome: 'succeeded',
      parameters: { changedFields: Object.keys(changes) },
    });
    return respond({ session: data });
  } catch (error: unknown) {
    logServerFailure('creator_session', error, { traceId, feature: 'creator_session', stage: 'failed', action: 'update' });
    await recordAuditEvent({ traceId, feature: 'creator_session', action: 'update', resourceType: 'creator_session', stage: 'failed', outcome: 'failed', error, level: 'error' });
    return respond({ error: error instanceof Error ? error.message : '更新会话失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  try {
    const context = await creatorContext();
    if (!context) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'delete', reason: 'unauthenticated' }, 'warn');
      return respond({ error: '未登录' }, { status: 401 });
    }
    const sessionId = new URL(req.url).searchParams.get('sessionId');
    if (!sessionId) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'delete', actorId: context.user.id, reason: 'missing_session_id' }, 'warn');
      return respond({ error: '缺少会话 ID' }, { status: 400 });
    }
    const { data, error } = await context.localClient
      .from('creator_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('workspace_id', context.workspace.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'rejected', action: 'delete', actorId: context.user.id, workspaceId: context.workspace.id, sessionId, reason: 'session_not_found' }, 'warn');
      return respond({ error: '会话不存在' }, { status: 404 });
    }
    logServerEvent('creator_session', { traceId, feature: 'creator_session', stage: 'completed', action: 'delete', actorId: context.user.id, workspaceId: context.workspace.id, sessionId: data.id });
    await recordAuditEvent({
      traceId,
      actorId: context.user.id,
      workspaceId: context.workspace.id,
      feature: 'creator_session',
      action: 'delete',
      resourceType: 'creator_session',
      resourceId: data.id,
      stage: 'completed',
      outcome: 'succeeded',
    });
    return respond({ ok: true, id: data.id });
  } catch (error: unknown) {
    logServerFailure('creator_session', error, { traceId, feature: 'creator_session', stage: 'failed', action: 'delete' });
    await recordAuditEvent({ traceId, feature: 'creator_session', action: 'delete', resourceType: 'creator_session', stage: 'failed', outcome: 'failed', error, level: 'error' });
    return respond({ error: error instanceof Error ? error.message : '删除会话失败' }, { status: 500 });
  }
}
