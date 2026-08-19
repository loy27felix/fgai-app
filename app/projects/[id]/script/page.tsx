import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/local/server";
import ScriptWorkspace from "@/components/ScriptWorkspace";
import type { BibleFields, Episode, Role, Scene } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ScriptPage({ params }: { params: { id: string } }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect("/");

  const projectId = params.id;

  const [{ data: project }, { data: member }] = await Promise.all([
    localClient.from("projects").select("*").eq("id", projectId).single(),
    localClient.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
  ]);

  if (!project) redirect("/projects");

  if (!member) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h2 className="font-disp text-2xl font-semibold">你还不是该项目成员</h2>
          <p className="mt-3 text-[#616161] dark:text-white/55">请在项目列表里「申请加入」，待负责人审批通过后再进入。</p>
          <Link href="/projects" className="pill mt-6 inline-flex">← 返回项目列表</Link>
        </div>
      </div>
    );
  }

  const role = member.role as Role;
  const canEdit = role === "owner" || role === "editor";
  const bible = (project.story_bible || {}) as BibleFields;
  const overview = project.overview || {};

  // 集 → 场 树
  const { data: episodes } = await localClient
    .from("episodes").select("id, project_id, idx, title").eq("project_id", projectId).order("idx");
  const epIds = (episodes || []).map((e: any) => e.id);
  const { data: scenes } = epIds.length
    ? await localClient.from("scenes").select("id, episode_id, idx, title, setting").in("episode_id", epIds).order("idx")
    : { data: [] as Scene[] };

  const allScenes = (scenes || []) as Scene[];
  const sceneIds = allScenes.map((s) => s.id);

  // 全项目剧本正文（按场） + 分镜头
  const [{ data: scripts }, { data: shots }] = sceneIds.length
    ? await Promise.all([
        localClient.from("scripts").select("scene_id, body, current_version").in("scene_id", sceneIds),
        localClient.from("shots").select("id, scene_id, no, title, time_start, time_end, duration_s, script_beat, roles").in("scene_id", sceneIds).order("no"),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  return (
    <ScriptWorkspace
      projectId={projectId}
      projectName={project.name}
      canEdit={canEdit}
      bible={bible}
      overview={overview}
      episodes={(episodes || []) as Episode[]}
      scenes={allScenes}
      scripts={(scripts || []) as any[]}
      shots={(shots || []) as any[]}
    />
  );
}
