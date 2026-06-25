import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import StageNav from "@/components/StageNav";
import AssetLibrary from "@/components/AssetLibrary";
import type { Asset, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AssetsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const projectId = params.id;

  const [{ data: project }, { data: member }] = await Promise.all([
    supabase.from("projects").select("id,name").eq("id", projectId).single(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!project) redirect("/projects");

  if (!member) {
    return (
      <div className="min-h-screen">
        <TopBar email={user.email || ""} />
        <div className="mx-auto max-w-lg px-7 py-24 text-center">
          <h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2>
          <Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link>
        </div>
      </div>
    );
  }

  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const { data: assets } = await supabase
    .from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });

  const crumb = (
    <>
      <Link href="/projects" className="cursor-pointer">项目</Link>
      <span className="opacity-40">/</span>
      <b className="text-ink">{project.name}</b>
      <span className="opacity-40">/</span>
      <span>资产库</span>
    </>
  );

  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} />
      <StageNav projectId={projectId} current="assets" />
      <AssetLibrary projectId={projectId} canEdit={canEdit} assets={(assets || []) as Asset[]} />
    </div>
  );
}
