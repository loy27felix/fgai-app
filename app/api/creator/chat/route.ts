import { NextResponse } from 'next/server';
import { TEXT_MODELS } from '@/lib/ai/catalog';
import { chatWithTextModel } from '@/lib/ai/text';
import { normalizeReasoningEffort } from '@/lib/ai/reasoning';
import { buildCreatorContextMessages, titleFromPrompt } from '@/lib/creator/chat';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';
import { buildTextLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';

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
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: CreatorChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const message = body.message?.trim() || '';
  const model = body.model || 'gpt-5.6-luna';
  const skill = normalizeSkill(body.skill);
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);
  if (!body.sessionId || !message) return NextResponse.json({ error: '缺少会话或消息' }, { status: 400 });
  if (!TEXT_MODELS.some((item) => item.id === model)) return NextResponse.json({ error: '不支持的模型' }, { status: 400 });
  let imageBytes = 0;
  const images = (body.images || []).filter((item) => {
    if (typeof item !== 'string' || item.length > 2_000_000 || imageBytes + item.length > 4_000_000) return false;
    imageBytes += item.length;
    return true;
  }).slice(0, 4);

  let session: { id: string; workspace_id: string; title: string } | null = null;
  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => supabase.rpc('ensure_creator_workspace'),
      load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
    }, user.id);
    const owned = await supabase
      .from('creator_sessions')
      .select('id,workspace_id,title')
      .eq('id', body.sessionId)
      .eq('workspace_id', workspace.id)
      .single();
    if (owned.error || !owned.data) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    session = owned.data;

    const insertedUser = await supabase.from('creator_messages').insert({
      session_id: session.id,
      role: 'user',
      content: { text: message, image_count: images.length },
      status: 'complete',
    });
    if (insertedUser.error) throw insertedUser.error;

    const history = await supabase
      .from('creator_messages')
      .select('role,content,status,created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(80);
    if (history.error) throw history.error;
    const messages = buildCreatorContextMessages((history.data || []).reverse(), {
      skill,
      reasoning: !!body.thinking || reasoningEffort !== "auto",
      reasoningEffort,
    });
    const { spec, result } = await chatWithTextModel({
      modelId: model,
      messages,
      images,
      thinking: !!body.thinking || reasoningEffort !== "auto",
      reasoningEffort,
      maxTokens: 4000,
    });

    const insertedAssistant = await supabase.from('creator_messages').insert({
      session_id: session.id,
      role: 'assistant',
      content: { text: result.content, usage: result.usage || {} },
      status: 'complete',
    }).select('*').single();
    if (insertedAssistant.error) throw insertedAssistant.error;

    const update: Record<string, unknown> = { default_model: spec.id, updated_at: new Date().toISOString() };
    if (session.title === '未命名对话') update.title = titleFromPrompt(message);
    await supabase.from('creator_sessions').update(update).eq('id', session.id).eq('workspace_id', workspace.id);

    await recordUsageBestEffort(buildTextLedgerEntry({
      userId: user.id,
      workspaceId: workspace.id,
      provider: spec.provider,
      model: spec.id,
      usage: result.usage,
    }));

    return NextResponse.json({
      message: insertedAssistant.data,
      title: update.title || session.title,
      model: spec.id,
      usage: result.usage,
    });
  } catch (error: unknown) {
    if (session) {
      await supabase.from('creator_messages').insert({
        session_id: session.id,
        role: 'assistant',
        content: { text: '本次回复失败，请检查模型或稍后重试。' },
        status: 'failed',
      });
    }
    const detail = error instanceof Error ? error.message : 'AI 请求失败';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
