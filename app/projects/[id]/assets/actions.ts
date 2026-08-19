"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/local/server";

export async function createAsset(
  projectId: string,
  a: { name: string; type: string; source: string; storage_path?: string; external_url?: string; params?: any; description?: string; gen_prompt?: string; from_script?: boolean }
) {
  const sb = createClient();
  const { data, error } = await sb.from("assets").insert({
    project_id: projectId,
    name: a.name,
    type: a.type,
    source: a.source,
    storage_path: a.storage_path || null,
    external_url: a.external_url || null,
    params: a.params || {},
    description: a.description || null,
    gen_prompt: a.gen_prompt || null,
    from_script: a.from_script || false,
  }).select("id").single();
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/assets`);
  return { ok: true, id: data?.id as string };
}

export async function updateAsset(projectId: string, assetId: string, patch: Record<string, any>) {
  const sb = createClient();
  const { error } = await sb.from("assets").update(patch).eq("id", assetId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/assets`);
  return { ok: true };
}

export async function deleteAsset(projectId: string, assetId: string, storagePath?: string | null) {
  const sb = createClient();
  if (storagePath) await sb.storage.from("project-assets").remove([storagePath]);
  const { error } = await sb.from("assets").delete().eq("id", assetId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/assets`);
  return { ok: true };
}

export async function setLockRef(projectId: string, assetId: string, on: boolean, charName?: string | null) {
  const sb = createClient();
  const { error } = await sb.from("assets").update({ is_lock_ref: on, char_name: on ? (charName || null) : null }).eq("id", assetId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/assets`);
  return { ok: true };
}
