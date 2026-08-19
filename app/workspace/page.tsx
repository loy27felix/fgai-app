import { redirect } from "next/navigation";
import WorkspaceHub from "@/components/WorkspaceHub";
import { createClient } from "@/lib/local/server";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count: projectCount }] = await Promise.all([
    localClient.from("profiles").select("platform_role").eq("id", user.id).maybeSingle(),
    localClient.from("projects").select("id", { count: "exact", head: true }),
  ]);
  const isAdmin = profile?.platform_role === "admin" || profile?.platform_role === "superadmin";

  return <WorkspaceHub email={user.email || ""} isAdmin={isAdmin} projectCount={projectCount || 0} />;
}
