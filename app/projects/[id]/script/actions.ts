"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Sb = ReturnType<typeof createClient>;

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/script`);
}

// 取同级下一个 idx（max+1，从 1 起）
async function nextIdx(sb: Sb, table: "episodes" | "scenes", col: string, parentId: string) {
  const { data } = await sb.from(table).select("idx").eq(col, parentId).order("idx", { ascending: false }).limit(1);
  return ((data?.[0]?.idx as number | undefined) ?? 0) + 1;
}

// ── 集 ──
export async function addEpisode(projectId: string, title?: string) {
  const sb = createClient();
  const idx = await nextIdx(sb, "episodes", "project_id", projectId);
  const { data, error } = await sb
    .from("episodes")
    .insert({ project_id: projectId, idx, title: title?.trim() || `第 ${idx} 集` })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id as string };
}

export async function renameEpisode(projectId: string, episodeId: string, title: string) {
  const sb = createClient();
  const { error } = await sb.from("episodes").update({ title: title.trim() }).eq("id", episodeId);
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteEpisode(projectId: string, episodeId: string) {
  const sb = createClient();
  const { error } = await sb.from("episodes").delete().eq("id", episodeId); // 级联删 scenes/scripts/versions
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// ── 场 ──
export async function addScene(projectId: string, episodeId: string, title?: string, setting?: string) {
  const sb = createClient();
  const idx = await nextIdx(sb, "scenes", "episode_id", episodeId);
  const { data, error } = await sb
    .from("scenes")
    .insert({ episode_id: episodeId, idx, title: title?.trim() || `第 ${idx} 场`, setting: setting?.trim() || null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id as string };
}

export async function updateScene(projectId: string, sceneId: string, patch: { title?: string; setting?: string }) {
  const sb = createClient();
  const fields: Record<string, string | null> = {};
  if (patch.title !== undefined) fields.title = patch.title.trim();
  if (patch.setting !== undefined) fields.setting = patch.setting.trim() || null;
  const { error } = await sb.from("scenes").update(fields).eq("id", sceneId);
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteScene(projectId: string, sceneId: string) {
  const sb = createClient();
  const { error } = await sb.from("scenes").delete().eq("id", sceneId);
  if (error) return { error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// ── 剧本正文：保存 = 更新正文 + 落一条版本快照 ──
export async function saveScript(
  projectId: string,
  sceneId: string,
  body: string,
  source: "manual" | "ai" | "upload" = "manual"
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "未登录" };

  // 找该场已有的 script 行
  const { data: existing } = await sb
    .from("scripts")
    .select("id, current_version")
    .eq("scene_id", sceneId)
    .maybeSingle();

  let scriptId: string;
  let version: number;

  if (!existing) {
    version = 1;
    const { data: ins, error } = await sb
      .from("scripts")
      .insert({ scene_id: sceneId, body, source, current_version: 1 })
      .select("id")
      .single();
    if (error) return { error: error.message };
    scriptId = ins.id as string;
  } else {
    scriptId = existing.id as string;
    version = ((existing.current_version as number | null) ?? 0) + 1;
    const { error } = await sb
      .from("scripts")
      .update({ body, source, current_version: version, updated_at: new Date().toISOString() })
      .eq("id", scriptId);
    if (error) return { error: error.message };
  }

  const { error: vErr } = await sb
    .from("script_versions")
    .insert({ script_id: scriptId, version, body, author: user.id, source });
  if (vErr) return { error: vErr.message };

  revalidate(projectId);
  return { ok: true, scriptId, version };
}

// ── 回滚到某个历史版本：把其正文写回当前，并新增一条版本（不销毁历史）──
export async function rollbackScript(projectId: string, scriptId: string, versionId: string) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "未登录" };

  const { data: target, error: tErr } = await sb
    .from("script_versions")
    .select("body, version")
    .eq("id", versionId)
    .single();
  if (tErr) return { error: tErr.message };

  const { data: script } = await sb.from("scripts").select("current_version").eq("id", scriptId).single();
  const newVersion = ((script?.current_version as number | null) ?? 0) + 1;
  const body = (target.body as string | null) ?? "";

  const { error: uErr } = await sb
    .from("scripts")
    .update({ body, source: "rollback", current_version: newVersion, updated_at: new Date().toISOString() })
    .eq("id", scriptId);
  if (uErr) return { error: uErr.message };

  const { error: vErr } = await sb
    .from("script_versions")
    .insert({ script_id: scriptId, version: newVersion, body, author: user.id, source: "rollback" });
  if (vErr) return { error: vErr.message };

  revalidate(projectId);
  return { ok: true, version: newVersion, body };
}
