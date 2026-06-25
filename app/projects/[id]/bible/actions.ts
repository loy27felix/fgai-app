"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BibleFields } from "@/lib/types";

export async function saveBible(projectId: string, fields: BibleFields) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "未登录" };

  const { error } = await supabase
    .from("projects")
    .update({ story_bible: fields })
    .eq("id", projectId);

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/bible`);
  return { ok: true };
}

export async function toggleLock(projectId: string, locked: boolean) {
  const supabase = createClient();
  const { error } = await supabase.from("projects").update({ style_locked: locked }).eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/bible`);
  return { ok: true };
}
