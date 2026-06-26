import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GenCanvas from "@/components/studio/GenCanvas";

export const dynamic = "force-dynamic";

export default async function ShotCanvasPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const projectId = params.id;
  const [{ data: project }, { data: member }] = await Promise.all([
    supabase.from("projects").select("id,name").eq("id", projectId).single(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!project) redirect("/projects");
  if (!member) redirect(`/projects/${projectId}/shots`);
  return <GenCanvas projectId={projectId} projectName={project.name} scope="shots" refKey="main" assetType="场景" stageKey="shots" backHref={`/projects/${projectId}/shots`} />;
}
