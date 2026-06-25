import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { slugType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const BASE = process.env.RELAY_BASE_URL || "https://api.gpt.ge/v1";
const KEY = process.env.RELAY_API_KEY;
const SHOT_FIELDS = ["frame_path", "keyframe_path"];
const TIMEOUT_MS = 55000;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!KEY) return NextResponse.json({ error: "服务端未配置 RELAY_API_KEY" }, { status: 500 });

  let body: { projectId?: string; type?: string; model?: string; size?: string; prompt?: string; refImage?: string; refType?: string; shotId?: string; shotField?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }
  const prompt = (body.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt 为空" }, { status: 400 });
  if (!body.projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  const model = body.model || "gpt-image-2";
  const size = body.size || "1024x1024";
  const type = body.type || "人物";
  const hasRef = !!body.refImage;
  const toShot = !!(body.shotId && body.shotField && SHOT_FIELDS.includes(body.shotField));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let gr: Response;
    if (hasRef) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("n", "1");
      const bytes = Buffer.from(body.refImage as string, "base64");
      form.append("image", new Blob([bytes], { type: body.refType || "image/png" }), "ref.png");
      gr = await fetch(`${BASE}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: ctrl.signal });
    } else {
      gr = await fetch(`${BASE}/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, n: 1, size }),
        signal: ctrl.signal,
      });
    }
    const gd = await gr.json().catch(() => ({}));
    if (!gr.ok) return NextResponse.json({ error: gd?.error?.message || `生图失败 (${gr.status})` }, { status: 502 });
    const item = gd?.data?.[0];
    let buf: Buffer | null = null;
    if (item?.b64_json) buf = Buffer.from(item.b64_json, "base64");
    else if (item?.url) { const ir = await fetch(item.url, { signal: ctrl.signal }); buf = Buffer.from(await ir.arrayBuffer()); }
    if (!buf) return NextResponse.json({ error: "生图返回为空" }, { status: 502 });

    const folder = toShot ? "board" : slugType(type);
    const path = `${body.projectId}/${folder}/${toShot ? `${body.shotId}-${body.shotField}` : "gen"}-${Date.now()}.png`;
    const up = await supabase.storage.from("project-assets").upload(path, buf, { contentType: "image/png", upsert: false });
    if (up.error) return NextResponse.json({ error: "存储失败：" + up.error.message }, { status: 500 });
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/project-assets/${path}`;

    if (toShot) {
      const { error: sErr } = await supabase.from("shots").update({ [body.shotField as string]: path }).eq("id", body.shotId as string);
      if (sErr) return NextResponse.json({ error: "写回镜头失败：" + sErr.message }, { status: 500 });
    } else {
      const { error: aErr } = await supabase.from("assets").insert({
        project_id: body.projectId, name: prompt.slice(0, 40), type, source: "generated",
        storage_path: path, params: { model, prompt, size, ref: hasRef },
      });
      if (aErr) return NextResponse.json({ error: "入库失败：" + aErr.message }, { status: 500 });
    }

    const kind = body.shotField === "keyframe_path" ? "keyframe" : body.shotField === "frame_path" ? "board" : (hasRef ? "image-edit" : "image");
    try { await supabase.from("generations").insert({ project_id: body.projectId, user_id: user.id, kind, model, key_owner: "company" }); } catch {}

    return NextResponse.json({ ok: true, path, url });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return NextResponse.json({ error: "生成超时（约 55 秒未返回）。换更快的模型（nano-banana-2 / gemini-3-pro-image）或缩短提示词再试；该模型若经常很慢，建议改用更快的模型。" }, { status: 504 });
    }
    return NextResponse.json({ error: err?.message || "生图异常" }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
