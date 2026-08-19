"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/local/server";
import { COVERS } from "@/lib/types";

export async function createProject(formData: FormData) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");

  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const summary = String(formData.get("summary") || "").trim() || null;
  const emoji = String(formData.get("emoji") || "🎬").trim() || "🎬";
  const cover = COVERS[Math.floor(Math.random() * COVERS.length)];

  const { data, error } = await localClient
    .from("projects")
    .insert({ name, summary, cover, created_by: user.id, story_bible: { _emoji: emoji } })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  redirect(`/projects/${data.id}/bible`);
}

export async function requestJoin(projectId: string) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  await localClient.from("project_join_requests").insert({
    project_id: projectId,
    user_id: user.id,
    status: "pending",
  });
  revalidatePath("/projects");
}

export async function approveJoin(requestId: string, projectId: string, applicantId: string) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  await localClient
    .from("project_join_requests")
    .update({ status: "approved", decided_by: user.id })
    .eq("id", requestId);
  await localClient
    .from("project_members")
    .insert({ project_id: projectId, user_id: applicantId, role: "editor" });
  revalidatePath("/projects");
}

export async function deleteProject(projectId: string) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  const { error } = await localClient.from("projects").delete().eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}

export async function signOut() {
  const localClient = createClient();
  await localClient.auth.signOut();
  redirect("/");
}
