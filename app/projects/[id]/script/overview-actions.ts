"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/local/server";

export async function updateOverview(projectId: string, overview: any) {
  const sb = createClient();
  const { error } = await sb.from("projects").update({ overview }).eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}/script`);
  return { ok: true };
}
