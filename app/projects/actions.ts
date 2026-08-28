"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/local/server";
import { logServerEvent, logServerFailure } from "@/lib/observability/server-log";
import { COVERS } from "@/lib/types";

async function requireProjectManager(projectId: string) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");

  const [{ data: project, error: projectError }, { data: profile, error: profileError }] = await Promise.all([
    localClient.from("projects").select("id,created_by,name").eq("id", projectId).single(),
    localClient.from("profiles").select("platform_role").eq("id", user.id).single(),
  ]);

  if (projectError || !project) {
    logServerFailure("project_action_authorization_failed", projectError || new Error("project_not_found"), { projectId, actorId: user.id });
    return { error: "项目不存在或已被删除" } as const;
  }
  if (profileError) {
    logServerFailure("project_action_profile_lookup_failed", profileError, { projectId, actorId: user.id });
    return { error: "无法验证当前权限，请稍后重试" } as const;
  }

  const isSuperadmin = profile?.platform_role === "superadmin";
  if (project.created_by !== user.id && !isSuperadmin) {
    logServerEvent("project_action_denied", { projectId, actorId: user.id, action: "manage", reason: "not_owner_or_superadmin" });
    return { error: "只有项目创建人或超级管理员可以执行此操作" } as const;
  }
  return { localClient, user, project, isSuperadmin } as const;
}

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
  if (error) {
    logServerFailure("project_create_failed", error, { actorId: user.id, name });
    throw new Error(error.message);
  }
  logServerEvent("project_created", { projectId: data.id, actorId: user.id, name });

  revalidatePath("/projects");
  redirect(`/projects/${data.id}/bible`);
}

export async function requestJoin(projectId: string) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  const { error } = await localClient.from("project_join_requests").insert({
    project_id: projectId,
    user_id: user.id,
    status: "pending",
  });
  if (error) {
    logServerFailure("project_join_request_failed", error, { projectId, actorId: user.id });
    return { error: error.message };
  }
  logServerEvent("project_join_requested", { projectId, actorId: user.id });
  revalidatePath("/projects");
  return { ok: true };
}

export async function approveJoin(requestId: string, projectId: string, applicantId: string) {
  const access = await requireProjectManager(projectId);
  if ("error" in access) return access;
  const { localClient, user } = access;
  const { data: request, error: requestError } = await localClient
    .from("project_join_requests")
    .select("id,project_id,user_id,status")
    .eq("id", requestId)
    .single();
  if (requestError || !request || request.project_id !== projectId || request.user_id !== applicantId || request.status !== "pending") {
    logServerFailure("project_join_approval_invalid_request", requestError || new Error("invalid_join_request"), { projectId, requestId, applicantId, actorId: user.id });
    return { error: "该加入申请已失效，请刷新后重试" };
  }
  const { error: decisionError } = await localClient
    .from("project_join_requests")
    .update({ status: "approved", decided_by: user.id })
    .eq("id", requestId)
    .eq("status", "pending");
  if (decisionError) {
    logServerFailure("project_join_approval_failed", decisionError, { projectId, requestId, applicantId, actorId: user.id });
    return { error: decisionError.message };
  }
  const { error: memberError } = await localClient
    .from("project_members")
    .insert({ project_id: projectId, user_id: applicantId, role: "editor" });
  if (memberError) {
    logServerFailure("project_member_insert_after_approval_failed", memberError, { projectId, requestId, applicantId, actorId: user.id });
    return { error: memberError.message };
  }
  logServerEvent("project_join_approved", { projectId, requestId, applicantId, actorId: user.id });
  revalidatePath("/projects");
  return { ok: true };
}

export async function rejectJoin(requestId: string, projectId: string, applicantId: string) {
  const access = await requireProjectManager(projectId);
  if ("error" in access) return access;
  const { localClient, user } = access;
  const { data: request, error: requestError } = await localClient
    .from("project_join_requests")
    .select("id,project_id,user_id,status")
    .eq("id", requestId)
    .single();
  if (requestError || !request || request.project_id !== projectId || request.user_id !== applicantId || request.status !== "pending") {
    logServerFailure("project_join_rejection_invalid_request", requestError || new Error("invalid_join_request"), { projectId, requestId, applicantId, actorId: user.id });
    return { error: "该加入申请已失效，请刷新后重试" };
  }
  const { error } = await localClient
    .from("project_join_requests")
    .update({ status: "rejected", decided_by: user.id })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) {
    logServerFailure("project_join_rejection_failed", error, { projectId, requestId, applicantId, actorId: user.id });
    return { error: error.message };
  }
  logServerEvent("project_join_rejected", { projectId, requestId, applicantId, actorId: user.id });
  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProject(projectId: string) {
  const access = await requireProjectManager(projectId);
  if ("error" in access) return access;
  const { localClient, user, project, isSuperadmin } = access;
  const { error } = await localClient.from("projects").delete().eq("id", projectId);
  if (error) {
    logServerFailure("project_delete_failed", error, { projectId, actorId: user.id, isSuperadmin });
    return { error: error.message };
  }
  logServerEvent("project_deleted", { projectId, projectName: project.name, actorId: user.id, isSuperadmin });
  revalidatePath("/projects");
  return { ok: true };
}

export async function signOut() {
  const localClient = createClient();
  await localClient.auth.signOut();
  redirect("/");
}
