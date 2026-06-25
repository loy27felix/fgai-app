import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import ProjectBoard from "@/components/ProjectBoard";
import type { Project, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [{ data: projects }, { data: members }, { data: requests }, { data: profiles }] =
    await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("project_members").select("project_id,user_id,role"),
      supabase.from("project_join_requests").select("id,project_id,user_id,status"),
      supabase.from("profiles").select("id,email,platform_role"),
    ]);

  const emailById = new Map((profiles || []).map((p) => [p.id, p.email as string]));
  const myProfile = (profiles || []).find((p) => p.id === user.id);
  const isAdmin = myProfile?.platform_role === "admin" || myProfile?.platform_role === "superadmin";

  const myRole: Record<string, Role> = {};
  const counts: Record<string, number> = {};
  const pending: Record<string, { requestId: string; user_id: string; email: string }[]> = {};
  const ownedIds = new Set((projects || []).filter((p) => p.created_by === user.id).map((p) => p.id));

  for (const m of members || []) {
    if (m.user_id === user.id) myRole[m.project_id] = m.role as Role;
    counts[m.project_id] = (counts[m.project_id] || 0) + 1;
  }
  const myApplied = new Set(
    (requests || []).filter((r) => r.user_id === user.id && r.status === "pending").map((r) => r.project_id)
  );
  for (const r of requests || []) {
    if (r.status === "pending" && ownedIds.has(r.project_id)) {
      (pending[r.project_id] ||= []).push({ requestId: r.id, user_id: r.user_id, email: emailById.get(r.user_id) || "未知用户" });
    }
  }

  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} admin={isAdmin} />
      <ProjectBoard
        projects={(projects || []) as Project[]}
        myRole={myRole}
        myApplied={Array.from(myApplied)}
        pending={pending}
        counts={counts}
        userId={user.id}
      />
    </div>
  );
}
