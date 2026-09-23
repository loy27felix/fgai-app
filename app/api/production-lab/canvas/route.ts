import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { readLab } from "@/lib/production-lab/store";
import { readProjectCanvas, saveProjectCanvas, validateCanvasGraph } from "@/lib/production-lab/canvas-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validScope(projectId: unknown, episode: unknown) {
  return typeof projectId === "string" && projectId.length > 0 && projectId.length <= 100
    && Number.isInteger(episode) && Number(episode) >= 1 && Number(episode) <= 200;
}

export async function GET(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");
  const episode = Number(params.get("episode"));
  if (!validScope(projectId, episode)) return NextResponse.json({ error: "项目或分集编号无效" }, { status: 400 });
  try {
    const state = await readLab();
    if (!state.projects.some((project) => project.id === projectId)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const row = await readProjectCanvas(projectId!, episode);
    return NextResponse.json({ graph: row?.document || null, version: Number(row?.version || 0), updatedAt: row?.updated_at || null });
  } catch {
    return NextResponse.json({ error: "项目画布暂不可读取；请检查第六板块独立数据库迁移" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 12000000) return NextResponse.json({ error: "画布数据过大" }, { status: 413 });
  let body: { projectId?: unknown; episode?: unknown; expectedVersion?: unknown; graph?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  if (!validScope(body.projectId, body.episode) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
    return NextResponse.json({ error: "项目、分集或版本编号无效" }, { status: 400 });
  }
  let graph;
  try { graph = validateCanvasGraph(body.graph); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "画布数据无效" }, { status: 400 }); }
  try {
    const state = await readLab();
    const project = state.projects.find((item) => item.id === body.projectId);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    if (project.ownerId !== actor.id && !actor.reviewer) return NextResponse.json({ error: "仅项目负责人或审核人可修改画布" }, { status: 403 });
    const saved = await saveProjectCanvas({ projectId: project.id, episode: Number(body.episode), expectedVersion: Number(body.expectedVersion), graph, actorId: actor.id });
    if ("conflict" in saved) return NextResponse.json({ error: "另一位同事已保存此分集画布。你的本机副本已保留，请先导出，再重新载入合并。", version: saved.version }, { status: 409 });
    return NextResponse.json({ version: Number(saved.version), updatedAt: saved.updated_at });
  } catch {
    return NextResponse.json({ error: "项目画布保存失败；请检查第六板块独立数据库迁移" }, { status: 503 });
  }
}
