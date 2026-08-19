import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/local/server";
import AssetLibrary from "@/components/AssetLibrary";
import type { Asset, BibleFields, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AssetsPage({ params }: { params: { id: string } }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  const projectId = params.id;

  const [{ data: project }, { data: member }] = await Promise.all([
    localClient.from("projects").select("id,name,story_bible").eq("id", projectId).single(),
    localClient.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!project) redirect("/projects");

  if (!member) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2>
          <Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link>
        </div>
      </div>
    );
  }

  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const bible = (project.story_bible || {}) as BibleFields;

  const { data: assets } = await localClient
    .from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });

  // 拼一份剧本文本（供"从剧本拆解资产"与资产顾问记忆）
  const { data: eps } = await localClient.from("episodes").select("id,idx,title").eq("project_id", projectId).order("idx");
  const epIds = (eps || []).map((e: any) => e.id);
  const { data: scs } = epIds.length ? await localClient.from("scenes").select("id,episode_id,idx,title,setting").in("episode_id", epIds) : { data: [] as any[] };
  const scIds = (scs || []).map((s: any) => s.id);
  const { data: scripts } = scIds.length ? await localClient.from("scripts").select("scene_id,body").in("scene_id", scIds) : { data: [] as any[] };
  const scriptText = (scs || []).map((s: any) => {
    const ep = (eps || []).find((e: any) => e.id === s.episode_id);
    const body = (scripts || []).find((x: any) => x.scene_id === s.id)?.body || "";
    return body ? `【第${ep?.idx || "?"}集 · 第${s.idx}场 ${s.title || ""}${s.setting ? " · " + s.setting : ""}】\n${body}` : "";
  }).filter(Boolean).join("\n\n").slice(0, 12000);

  return (
    <AssetLibrary projectId={projectId} projectName={project.name} canEdit={canEdit} bible={bible} assets={(assets || []) as Asset[]} scriptText={scriptText} />
  );
}
