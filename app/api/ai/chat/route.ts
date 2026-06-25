import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deepseekChat, type ChatMessage, type ChatMode } from "@/lib/deepseek";
import { relayChat } from "@/lib/relay";
import { resolveModel } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { messages?: ChatMessage[]; model?: string; mode?: ChatMode; thinking?: boolean; jsonOutput?: boolean; projectId?: string; images?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const messages = body.messages || [];
  if (!messages.length) return NextResponse.json({ error: "messages 为空" }, { status: 400 });

  // 优先用 model（新）；没有则回退到 mode（旧：flash/pro -> deepseek）
  const modelId = body.model || (body.mode === "pro" ? "deepseek-pro" : "deepseek-flash");
  const spec = resolveModel(modelId);
  const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];

  try {
    let result;
    if (images.length) {
      const vModel = spec.provider === "relay" ? spec.apiModel : "gpt-5.5";
      const vMsgs = messages.map((m, i) => (i === messages.length - 1 && m.role === "user")
        ? { role: "user", content: [{ type: "text", text: m.content }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))] }
        : m);
      result = await relayChat({ model: vModel, messages: vMsgs as any, jsonOutput: !!body.jsonOutput });
    } else if (spec.provider === "deepseek") {
      result = await deepseekChat({
        messages,
        mode: spec.id === "deepseek-pro" ? "pro" : "flash",
        thinking: !!body.thinking,
        jsonOutput: !!body.jsonOutput,
      });
    } else {
      result = await relayChat({ model: spec.apiModel, messages, jsonOutput: !!body.jsonOutput });
    }

    try {
      const u = result.usage;
      await supabase.from("ai_usage").insert({
        user_id: user.id,
        project_id: body.projectId ?? null,
        model: spec.id,
        prompt_tokens: u?.prompt_tokens ?? 0,
        completion_tokens: u?.completion_tokens ?? 0,
        total_tokens: u?.total_tokens ?? 0,
      });
    } catch {}

    return NextResponse.json({ content: result.content, usage: result.usage });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "AI 请求失败" }, { status: 500 });
  }
}
