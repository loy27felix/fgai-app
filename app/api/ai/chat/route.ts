import { NextResponse } from 'next/server';
import { chatWithTextModel } from '@/lib/ai/text';
import type { ChatMessage, ChatMode } from '@/lib/deepseek';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ChatRequestBody = {
  messages?: ChatMessage[];
  model?: string;
  mode?: ChatMode;
  thinking?: boolean;
  jsonOutput?: boolean;
  projectId?: string;
  images?: string[];
};

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const messages = body.messages || [];
  if (!messages.length) {
    return NextResponse.json({ error: 'messages 为空' }, { status: 400 });
  }

  const modelId = body.model || (body.mode === 'pro' ? 'deepseek-pro' : 'deepseek-flash');
  const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];

  try {
    const { spec, result } = await chatWithTextModel({
      modelId,
      messages,
      images,
      thinking: !!body.thinking,
      jsonOutput: !!body.jsonOutput,
    });

    try {
      const usage = result.usage;
      await supabase.from('ai_usage').insert({
        user_id: user.id,
        project_id: body.projectId ?? null,
        model: spec.id,
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      });
    } catch {
      // Usage accounting must not hide a successful model response.
    }

    return NextResponse.json({ content: result.content, usage: result.usage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI 请求失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
