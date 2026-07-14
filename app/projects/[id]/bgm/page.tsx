import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import BgmWorkspace from "@/components/BgmWorkspace";
import type { BibleFields, Episode, Role, Scene } from "@/lib/types";

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
  if (!member) { return (<div className="min-h-screen grid place-items-center px-6 text-center"><div><h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>); }
  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const bible = (project.story_bible || {}) as BibleFields;
  const { data: episodes } = await supabase.from('episodes').select('id,project_id,idx,title').eq('project_id', projectId).order('idx');
  const episodeIds = (episodes || []).map((episode) => episode.id);
  const { data: scenes } = episodeIds.length
    ? await supabase.from('scenes').select('id,episode_id,idx,title,setting').in('episode_id', episodeIds).order('idx')
    : { data: [] as any[] };
  const sceneIds = (scenes || []).map((scene) => scene.id);
  const { data: shots } = sceneIds.length
    ? await supabase.from('shots').select('id,scene_id,no,title,duration_s,script_beat,video_prompt').in('scene_id', sceneIds).order('no')
    : { data: [] as any[] };
  return <BgmWorkspace projectId={projectId} projectName={project.name} canEdit={canEdit} bible={bible} episodes={(episodes || []) as Episode[]} scenes={(scenes || []) as Scene[]} shots={shots || []} />;
}
