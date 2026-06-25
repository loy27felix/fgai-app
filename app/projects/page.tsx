import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProjectBoard from "@/components/ProjectBoard";
import type { Project, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const AV = ["#74f08e", "#9db4ff", "#ea8190", "#5ad2e6", "#ffc06a", "#c79bff"];
const ini = (e: string) => (e || "?").replace(/@.*/, "").slice(0, 2).toUpperCase();

export default async function ProjectsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [{ data: projects }, { data: members }, { data: requests }, { data: profiles }, { data: eps }, { count: genCount }] =
    await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("project_members").select("project_id,user_id,role"),
      supabase.from("project_join_requests").select("id,project_id,user_id,status"),
      supabase.from("profiles").select("id,email,platform_role"),
      supabase.from("episodes").select("project_id"),
      supabase.from("generations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);

  const emailById = new Map((profiles || []).map((p) => [p.id, p.email as string]));
  const myProfile = (profiles || []).find((p) => p.id === user.id);
  const isAdmin = myProfile?.platform_role === "admin" || myProfile?.platform_role === "superadmin";

  const myRole: Record<string, Role> = {};
  const counts: Record<string, number> = {};
  const membersByProject: Record<string, { ini: string; bg: string }[]> = {};
  const pending: Record<string, { requestId: string; user_id: string; email: string }[]> = {};
  const ownedIds = new Set((projects || []).filter((p) => p.created_by === user.id).map((p) => p.id));

  for (const m of members || []) {
    if (m.user_id === user.id) myRole[m.project_id] = m.role as Role;
    counts[m.project_id] = (counts[m.project_id] || 0) + 1;
    const arr = (membersByProject[m.project_id] ||= []);
    if (arr.length < 4) arr.push({ ini: ini(emailById.get(m.user_id) || ""), bg: AV[arr.length % AV.length] });
  }
  const epCount: Record<string, number> = {};
  for (const e of eps || []) epCount[e.project_id] = (epCount[e.project_id] || 0) + 1;

  const myApplied = new Set((requests || []).filter((r) => r.user_id === user.id && r.status === "pending").map((r) => r.project_id));
  for (const r of requests || []) {
    if (r.status === "pending" && ownedIds.has(r.project_id)) {
      (pending[r.project_id] ||= []).push({ requestId: r.id, user_id: r.user_id, email: emailById.get(r.user_id) || "未知用户" });
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
