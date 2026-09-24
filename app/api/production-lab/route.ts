import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { hasSameOriginLabRequest } from "@/lib/production-lab/origin";
import { database, readLab, changeLab } from "@/lib/production-lab/store";
import type { Command } from "@/lib/production-lab/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "新板块未开放或当前账号不在试用名单" }, { status: 403 });
  try {
    const [state, groups] = await Promise.all([
      readLab(),
      database().query<{ id: string; name: string }>("SELECT id,name FROM production_lab_groups WHERE archived_at IS NULL ORDER BY created_at,id"),
    ]);
    return NextResponse.json({ state, actor, groups: groups.rows });
  }
  catch { return NextResponse.json({ error: "试用数据库尚未配置或不可用，请按新板块部署说明初始化" }, { status: 503 }); }
}
export async function POST(req: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (!hasSameOriginLabRequest(req)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const raw = await req.text();
  if (raw.length > 100000) return NextResponse.json({ error: "请求过大" }, { status: 413 });
  try {
    const body = JSON.parse(raw);
    if (!Number.isSafeInteger(body.revision) || !body.command || typeof body.command.type !== "string") throw new Error("请求格式无效");
    return NextResponse.json({ state: await changeLab(body.command as Command, actor, body.revision) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    // Only domain errors are user-facing; database details stay on the server.
    const safe = /^(请|仅|只有|项目|剧本|本批|第 |交付|其他同事|每批|制作|不支持|试用版|请求|退回|只能)/.test(message);
    return NextResponse.json({ error: safe ? message : "保存失败，请检查独立试用数据库" }, { status: message.startsWith("其他同事") ? 409 : 400 });
  }
}
