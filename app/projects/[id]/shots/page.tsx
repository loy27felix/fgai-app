import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import StageNav from "@/components/StageNav";
import ShotWorkspace from "@/components/ShotWorkspace";
import type { BibleFields, Episode, Role, Scene } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShotsPage({ params, searchParams }: { params: { id: string }; searchParams: { scene?: string; shot?: string } }) {
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

  const { data: episodes } = await supabase.from("episodes").select("id, project_id, idx, title").eq("project_id", projectId).order("idx");
  const epIds = (episodes || []).map((e) => e.id);
  const { data: scenes } = epIds.length
    ? await supabase.from("scenes").select("id, episode_id, idx, title, setting").in("episode_id", epIds).order("idx")
    : { data: [] as Scene[] };
  const allScenes = (scenes || []) as Scene[];
  const selectedSceneId = (searchParams.scene && allScenes.find((s) => s.id === searchParams.scene)?.id) || allScenes[0]?.id || null;

  let shots: any[] = [];
  let subshots: any[] = [];
  if (selectedSceneId) {
    const { data: sh } = await supabase.from("shots").select("*").eq("scene_id", selectedSceneId).order("ord");
    shots = sh || [];
    const ids = shots.map((x) => x.id);
    if (ids.length) { const { data: ss } = await supabase.from("subshots").select("*").in("shot_id", ids).order("ord"); subshots = ss || []; }
  }
  const selectedShotId = (searchParams.shot && shots.find((s) => s.id === searchParams.shot)?.id) || shots[0]?.id || null;

  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const { data: refRows } = await supabase.from("assets").select("char_name,storage_path,external_url").eq("project_id", projectId).eq("is_lock_ref", true);
  const lockRefs = (refRows || []).filter((r) => r.char_name).map((r) => ({ char_name: r.char_name as string, url: (r.external_url as string) || `${SB}/storage/v1/object/public/project-assets/${r.storage_path}` }));

  const crumb = (<><Link href="/projects" className="cursor-pointer">项目</Link><span className="opacity-40">/</span><b className="text-ink">{project.name}</b><span className="opacity-40">/</span><span>逐镜头</span></>);

  return (
    <div className="min-h-screen">
      <TopBar email={user.email || ""} crumb={crumb} />
      <StageNav projectId={projectId} current="shots" />
      <ShotWorkspace projectId={projectId} canEdit={canEdit} bible={bible}
        episodes={(episodes || []) as Episode[]} scenes={allScenes} selectedSceneId={selectedSceneId}
        shots={shots} subshots={subshots} selectedShotId={selectedShotId} lockRefs={lockRefs} />
    </div>
  );
}
