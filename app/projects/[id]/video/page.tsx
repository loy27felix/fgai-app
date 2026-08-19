import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/local/server";
import VideoWorkspace from "@/components/VideoWorkspace";
import type { Episode, Role, Scene } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VideoPage({ params }: { params: { id: string } }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");
  const projectId = params.id;
  const [{ data: project }, { data: member }] = await Promise.all([
    localClient.from("projects").select("id,name").eq("id", projectId).single(),
    localClient.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!project) redirect("/projects");
  if (!member) { return (<div className="min-h-screen grid place-items-center px-6 text-center"><div><h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2><Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link></div></div>); }
  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const { data: episodes } = await localClient.from("episodes").select("id, project_id, idx, title").eq("project_id", projectId).order("idx");
  const epIds = (episodes || []).map((e: any) => e.id);
  const { data: scenes } = epIds.length ? await localClient.from("scenes").select("id, episode_id, idx, title, setting").in("episode_id", epIds).order("idx") : { data: [] as Scene[] };
  const allScenes = (scenes || []) as Scene[]; const sceneIds = allScenes.map((s) => s.id);
  const { data: shots } = sceneIds.length ? await localClient.from("shots").select("id, scene_id, no, title, duration_s, keyframe_path, frame_path, video_prompt, video_url, roles").in("scene_id", sceneIds).order("no") : { data: [] as any[] };
  return <VideoWorkspace projectId={projectId} projectName={project.name} canEdit={canEdit} episodes={(episodes || []) as Episode[]} scenes={allScenes} shots={(shots || []) as any[]} />;
}
