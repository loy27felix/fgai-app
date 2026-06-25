"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Sb = ReturnType<typeof createClient>;
const rev = (p: string) => revalidatePath(`/projects/${p}/board`);

async function nextOrd(sb: Sb, table: "shots" | "subshots", col: string, parentId: string) {
  const { data } = await sb.from(table).select("ord").eq(col, parentId).order("ord", { ascending: false }).limit(1);
  return ((data?.[0]?.ord as number | undefined) ?? 0) + 1;
}

export async function addShot(projectId: string, sceneId: string) {
  const sb = createClient();
  const ord = await nextOrd(sb, "shots", "scene_id", sceneId);
  const { error } = await sb.from("shots").insert({ scene_id: sceneId, ord, no: `S${ord}`, duration_s: 4, video_method: "强把控分镜图", roles: [] });
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
export async function updateShot(projectId: string, shotId: string, patch: Record<string, any>) {
  const sb = createClient();
  const { error } = await sb.from("shots").update(patch).eq("id", shotId);
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
export async function delShot(projectId: string, shotId: string) {
  const sb = createClient();
  const { error } = await sb.from("shots").delete().eq("id", shotId);
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
export async function addSubshot(projectId: string, shotId: string) {
  const sb = createClient();
  const ord = await nextOrd(sb, "subshots", "shot_id", shotId);
  const { error } = await sb.from("subshots").insert({ shot_id: shotId, ord, size: "中景", movement: "固定" });
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
export async function updateSubshot(projectId: string, subshotId: string, patch: Record<string, any>) {
  const sb = createClient();
  const { error } = await sb.from("subshots").update(patch).eq("id", subshotId);
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
export async function delSubshot(projectId: string, subshotId: string) {
  const sb = createClient();
  const { error } = await sb.from("subshots").delete().eq("id", subshotId);
  if (error) return { error: error.message };
  rev(projectId); return { ok: true };
}
// AI 拆分镜：批量插入 shots + subshots
export async function insertShots(projectId: string, sceneId: string, shots: any[]) {
  const sb = createClient();
  let ord = await nextOrd(sb, "shots", "scene_id", sceneId);
  for (const s of shots) {
    const { data, error } = await sb.from("shots")
      .insert({ scene_id: sceneId, ord, no: s.no || `S${ord}`, duration_s: s.duration_s || 4, video_method: s.video_method || "强把控分镜图", roles: Array.isArray(s.roles) ? s.roles : [] })
      .select("id").single();
    if (error) return { error: error.message };
    const subs = (s.subshots || []).map((ss: any, i: number) => ({ shot_id: data.id, ord: i + 1, size: ss.size || null, movement: ss.movement || null, composition: ss.composition || null, action: ss.action || null }));
    if (subs.length) { const { error: e2 } = await sb.from("subshots").insert(subs); if (e2) return { error: e2.message }; }
    ord++;
  }
  rev(projectId); return { ok: true, count: shots.length };
}
