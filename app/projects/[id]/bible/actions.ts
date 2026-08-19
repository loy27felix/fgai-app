"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/local/server";
import type { BibleFields } from "@/lib/types";

export async function saveBible(projectId: string, fields: BibleFields) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return { error: "未登录" };

  const { error } = await localClient
    .from("projects")
    .update({ story_bible: fields })
    .eq("id", projectId);

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/bible`);
  return { ok: true };
}

export async function toggleLock(projectId: string, locked: boolean) {
  const localClient = createClient();
  const { error } = await localClient.from("projects").update({ style_locked: locked }).eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/bible`);
  return { ok: true };
}
