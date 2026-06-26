import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ShotWorkspace from "@/components/ShotWorkspace";
import type { BibleFields, Episode, Role, Scene } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShotsPage({ params }: { params: { id: string } }) {
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
    return (<div className="min-h-screen grid place-items-center px-6 text-center"><div><h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>);
  }
  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const bible = (project.story_bible || {}) as BibleFields;

  const { data: episodes } = await supabase.from("episodes").select("id, project_id, idx, title").eq("project_id", projectId).order("idx");
  const epIds = (episodes || []).map((e) => e.id);
  const { data: scenes } = epIds.length ? await supabase.from("scenes").select("id, episode_id, idx, title, setting").in("episode_id", epIds).order("idx") : { data: [] as Scene[] };
  const allScenes = (scenes || []) as Scene[];
  const sceneIds = allScenes.map((s) => s.id);

  const [{ data: shots }, { data: scripts }] = sceneIds.length
    ? await Promise.all([
        supabase.from("shots").select("id, scene_id, no, title, time_start, time_end, duration_s, script_beat, roles, frame_path, keyframe_path, storyboard_path, keyframe_prompt, storyboard_prompt, video_prompt, outputs").in("scene_id", sceneIds).order("no"),
        supabase.from("scripts").select("scene_id, body").in("scene_id", sceneIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];
  const scriptText = allScenes.map((s) => { const ep = (episodes || []).find((e) => e.id === s.episode_id); const body = (scripts || []).find((x: any) => x.scene_id === s.id)?.body || ""; return body ? `【第${ep?.idx || "?"}集·第${s.idx}场】\n${body}` : ""; }).filter(Boolean).join("\n\n").slice(0, 8000);

  return (
    <ShotWorkspace projectId={projectId} projectName={project.name} canEdit={canEdit} bible={bible}
      episodes={(episodes || []) as Episode[]} scenes={allScenes} shots={(shots || []) as any[]} scriptText={scriptText} />
  );
}
