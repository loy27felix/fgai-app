import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { hasSameOriginLabRequest } from "@/lib/production-lab/origin";
import { readLab } from "@/lib/production-lab/store";
import { createLabAsset, listLabAssets, PRODUCTION_LAB_ASSET_BUCKET, type LabAssetScope } from "@/lib/production-lab/media-store";
import { localStorage } from "@/lib/local/storage";
import { database } from "@/lib/production-lab/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav"]);
const allowedCategories = new Set(["角色设定", "场景", "道具", "风格参考", "镜头参考", "声音", "其他"]);

function extensionFor(mime: string) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav" } as Record<string, string>)[mime] || "bin";
}

function assetView(asset: { id: string; project_id: string | null; episode: number | null; scope: string; category: string; name: string; character_name: string; style: string; view_label: string; media_kind: string; mime_type: string; bytes: string | number; created_at: string }) {
  return { id: asset.id, projectId: asset.project_id, episode: asset.episode, scope: asset.scope, category: asset.category, name: asset.name, character: asset.character_name, style: asset.style, view: asset.view_label, kind: asset.media_kind, mimeType: asset.mime_type, bytes: Number(asset.bytes), createdAt: asset.created_at, url: "/api/production-lab/assets/" + encodeURIComponent(asset.id) + "/content" };
}

export async function GET(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const scopeValue = url.searchParams.get("scope");
  const scope = scopeValue === "official" || scopeValue === "story" ? scopeValue as LabAssetScope : null;
  try {
    if (projectId) {
      const state = await readLab();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return NextResponse.json({ error: "制作项目不存在" }, { status: 404 });
      if (project.ownerId !== actor.id && !actor.reviewer) return NextResponse.json({ error: "无权访问此制作项目" }, { status: 403 });
    }
    const assets = await listLabAssets({ projectId, scope, limit: 400 });
    return NextResponse.json({ assets: assets.map(assetView) });
  } catch {
    return NextResponse.json({ error: "团队素材库暂不可用；请确认第六板块数据库迁移" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (!hasSameOriginLabRequest(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "上传内容格式无效" }, { status: 400 }); }
  const scopeValue = String(form.get("scope") || "story");
  if (scopeValue !== "official" && scopeValue !== "story") return NextResponse.json({ error: "素材分类无效" }, { status: 400 });
  const scope = scopeValue as LabAssetScope;
  const projectId = scope === "story" ? String(form.get("projectId") || "") : null;
  const episodeValue = Number(form.get("episode"));
  const episode = scope === "story" && Number.isInteger(episodeValue) && episodeValue >= 1 && episodeValue <= 200 ? episodeValue : null;
  const categoryValue = String(form.get("category") || "角色设定");
  const category = allowedCategories.has(categoryValue) ? categoryValue : "其他";
  const character = String(form.get("character") || "").trim().slice(0, 120);
  const style = String(form.get("style") || "").trim().slice(0, 100);
  const view = String(form.get("view") || "").trim().slice(0, 100);
  if (!character) return NextResponse.json({ error: "请填写素材或角色名称" }, { status: 400 });
  if (scope === "story") {
    if (!projectId || projectId.length > 100 || !episode) return NextResponse.json({ error: "故事素材需要关联项目和分集" }, { status: 400 });
    try {
      const state = await readLab();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return NextResponse.json({ error: "制作项目不存在" }, { status: 404 });
      if (project.ownerId !== actor.id && !actor.reviewer) return NextResponse.json({ error: "无权编辑此制作项目" }, { status: 403 });
    } catch { return NextResponse.json({ error: "独立制作数据库暂不可用" }, { status: 503 }); }
  }
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (!files.length || files.length > 20 || totalBytes > MAX_TOTAL_BYTES || files.some((file) => file.size > MAX_FILE_BYTES || !allowedMimeTypes.has(file.type))) {
    return NextResponse.json({ error: "每次最多 20 个 PNG/JPEG/WebP、MP4/WebM、MP3/WAV 文件；单个不超过 20 MB，总量不超过 100 MB" }, { status: 400 });
  }

  const uploadedPaths: string[] = [];
  const insertedIds: string[] = [];
  try {
    const assets = [];
    for (const file of files) {
      const id = randomUUID();
      const path = "uploads/" + scope + "/" + id + "." + extensionFor(file.type);
      const upload = await localStorage(PRODUCTION_LAB_ASSET_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { upsert: false, contentType: file.type });
      if (upload.error) throw new Error("NAS 存储当前不可用，素材没有全部上传");
      uploadedPaths.push(path);
      const mediaKind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio";
      const asset = await createLabAsset({
        id, owner_id: actor.id, project_id: projectId, episode, scope, category,
        name: file.name.replace(/[\\/\u0000]/g, "_").trim().slice(0, 160) || character,
        character_name: character, style, view_label: view, media_kind: mediaKind,
        storage_path: path, mime_type: file.type, bytes: file.size, media_job_id: null,
        metadata: { source: "team_upload" },
      });
      insertedIds.push(id);
      assets.push(assetView(asset));
    }
    return NextResponse.json({ ok: true, assets }, { status: 201 });
  } catch (error) {
    if (insertedIds.length) await database().query("DELETE FROM production_lab_assets WHERE id=ANY($1::uuid[])", [insertedIds]).catch(() => undefined);
    if (uploadedPaths.length) await localStorage(PRODUCTION_LAB_ASSET_BUCKET).remove(uploadedPaths);
    return NextResponse.json({ error: error instanceof Error ? error.message : "素材上传失败" }, { status: 503 });
  }
}
