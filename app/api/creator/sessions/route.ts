import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

async function creatorContext() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => supabase.rpc('ensure_creator_workspace'),
    load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { supabase, user, workspace };
}

export async function GET(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const sessionId = new URL(req.url).searchParams.get('sessionId');
    const { data: sessions, error } = await context.supabase
      .from('creator_sessions')
      .select('*')
      .eq('workspace_id', context.workspace.id)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    let messages: unknown[] = [];
    if (sessionId) {
      const owned = (sessions || []).some((session) => session.id === sessionId);
      if (!owned) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
      const result = await context.supabase
        .from('creator_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (result.error) throw result.error;
      messages = result.data || [];
    }
    return NextResponse.json({ workspace: context.workspace, sessions: sessions || [], messages });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取会话失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const kind = ['chat', 'image', 'video'].includes(body.kind) ? body.kind : 'chat';
    const { data, error } = await context.supabase
      .from('creator_sessions')
      .insert({
        workspace_id: context.workspace.id,
        kind,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : '未命名对话',
        default_model: typeof body.model === 'string' ? body.model : 'gpt-5.6-luna',
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ session: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '创建会话失败' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (typeof body.id !== 'string') return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 });
    const changes: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) changes.title = body.title.trim().slice(0, 80);
    if (typeof body.model === 'string') changes.default_model = body.model;
    if (body.archived === true) changes.archived_at = new Date().toISOString();
    const { data, error } = await context.supabase
      .from('creator_sessions')
      .update(changes)
      .eq('id', body.id)
      .eq('workspace_id', context.workspace.id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新会话失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const sessionId = new URL(req.url).searchParams.get('sessionId');
    if (!sessionId) return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 });
    const { data, error } = await context.supabase
      .from('creator_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('workspace_id', context.workspace.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '删除会话失败' }, { status: 500 });
  }
}
