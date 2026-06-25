import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import StageNav from "@/components/StageNav";
import BgmWorkspace from "@/components/BgmWorkspace";
import type { BibleFields, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BgmPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const projectId = params.id;
  const [{ data: project }, { data: member }] = await Promise.all([
    supabase.from("projects").select("id,name,story_bible").eq("id", projectId).single(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!project) redirect("/projects");
  if (!member) {
    return (<div className="min-h-screen"><TopBar email={user.email || ""} /><div className="mx-auto max-w-lg px-7 py-24 text-center"><h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>);
  }
  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const bible = (project.story_bible || {}) as BibleFields;

  const crumb = (<><Link href="/projects" className="cursor-pointer">项目</Link><span className="opacity-40">/</span><b className="text-ink">{project.name}</b><span className="opacity-40">/</span><span>BGM</span></>);
  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} />
      <StageNav projectId={projectId} current="bgm" />
      <BgmWorkspace projectId={projectId} canEdit={canEdit} bible={bible} projectName={project.name} />
    </div>
  );
}
