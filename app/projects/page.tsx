import { redirect } from "next/navigation";
import { createClient } from "@/lib/local/server";
import ProjectBoard from "@/components/ProjectBoard";
import type { Project, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const AV = ["#74f08e", "#9db4ff", "#ea8190", "#5ad2e6", "#ffc06a", "#c79bff"];
const ini = (e: string) => (e || "?").replace(/@.*/, "").slice(0, 2).toUpperCase();

export default async function ProjectsPage() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");

  const [{ data: projects }, { data: members }, { data: requests }, { data: profiles }, { data: eps }, { count: genCount }] =
    await Promise.all([
      localClient.from("projects").select("*").order("created_at", { ascending: false }),
      localClient.from("project_members").select("project_id,user_id,role"),
      localClient.from("project_join_requests").select("id,project_id,user_id,status"),
      localClient.from("profiles").select("id,email,platform_role"),
      localClient.from("episodes").select("project_id"),
      localClient.from("generations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);

  const emailById = new Map<string, string>((profiles || []).map((p: any): [string, string] => [String(p.id), String(p.email || "")]));
  const myProfile = (profiles || []).find((p: any) => p.id === user.id);
  const isAdmin = myProfile?.platform_role === "admin" || myProfile?.platform_role === "superadmin";

  const myRole: Record<string, Role> = {};
  const counts: Record<string, number> = {};
  const membersByProject: Record<string, { ini: string; bg: string }[]> = {};
  const pending: Record<string, { requestId: string; user_id: string; email: string }[]> = {};
  const ownedIds = new Set<string>((projects || []).filter((p: any) => p.created_by === user.id).map((p: any) => String(p.id)));

  for (const m of (members || []) as any[]) {
    const projectKey = String(m.project_id);
    if (m.user_id === user.id) myRole[projectKey] = m.role as Role;
    counts[projectKey] = (counts[projectKey] || 0) + 1;
    const arr = (membersByProject[projectKey] ||= []);
    if (arr.length < 4) arr.push({ ini: ini(emailById.get(String(m.user_id)) || ""), bg: AV[arr.length % AV.length] });
  }
  const epCount: Record<string, number> = {};
  for (const e of (eps || []) as any[]) epCount[e.project_id] = (epCount[e.project_id] || 0) + 1;

  const myApplied = new Set<string>((requests || []).filter((r: any) => r.user_id === user.id && r.status === "pending").map((r: any) => String(r.project_id)));
  for (const r of (requests || []) as any[]) {
    const projectKey = String(r.project_id);
    if (r.status === "pending" && ownedIds.has(projectKey)) {
      (pending[projectKey] ||= []).push({ requestId: r.id, user_id: String(r.user_id), email: emailById.get(String(r.user_id)) || "未知用户" });
    }
  }

  return (
    <ProjectBoard
      projects={(projects || []) as Project[]}
      myRole={myRole} myApplied={Array.from(myApplied)} pending={pending} counts={counts}
      membersByProject={membersByProject} epCount={epCount} genCount={genCount || 0}
      userId={user.id} userEmail={user.email || ""} isAdmin={isAdmin}
    />
  );
}
