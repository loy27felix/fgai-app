import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import StageNav from "@/components/StageNav";
import BibleWorkspace from "@/components/BibleWorkspace";
import type { BibleFields, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BiblePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const projectId = params.id;

  const [{ data: project }, { data: member }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);

  if (!project) redirect("/projects");

  if (!member) {
    return (
      <div className="min-h-screen">
        <TopBar email={user.email || ""} />
        <div className="mx-auto max-w-lg px-7 py-24 text-center">
          <h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2>
          <p className="mt-3 text-[#616161]">请在项目列表里「申请加入」，待负责人审批通过后再进入。</p>
          <Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link>
        </div>
      </div>
    );
  }

  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const fields = (project.story_bible || {}) as BibleFields;

  const crumb = (
    <>
      <Link href="/projects" className="cursor-pointer">项目</Link>
      <span className="opacity-40">/</span>
      <b className="text-ink">{project.name}</b>
    </>
  );

  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} />
      <StageNav projectId={projectId} current="bible" />
      <BibleWorkspace
        projectId={projectId}
        projectName={project.name}
        emoji={fields._emoji || "🎬"}
        locked={!!project.style_locked}
        canEdit={canEdit}
        initialFields={fields}
      />
    </div>
  );
}
