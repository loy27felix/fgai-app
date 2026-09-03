import { NextResponse } from "next/server";

import { assembleVideoSegments, assemblyStoragePath, normalizeAssemblyTaskIds } from "@/lib/creator/video-assembly";
import { ensureCreatorWorkspace } from "@/lib/creator/workspace";
import { createAdminClient } from "@/lib/local/admin";
import { createClient } from "@/lib/local/server";
import { localStorage, readLocalFile } from "@/lib/local/storage";
import { logServerFailure } from "@/lib/observability/server-log";

export const runtime = "nodejs";
export const maxDuration = 600;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jobPayload(row: unknown) {
  const value = asRecord(row);
  return {
    id: typeof value.id === "string" ? value.id : "",
    status: typeof value.status === "string" ? value.status : "failed",
    output: asRecord(value.output),
    error: typeof value.error === "string" ? value.error : null,
  };
}

async function assemblyContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc("ensure_creator_workspace"),
    load: async (id) => localClient.from("creator_workspaces").select("*").eq("id", id).single(),
  }, user.id);
  return { localClient, user, workspace };
}

/**
 * Creates a durable assembly-job row, then performs FFmpeg on the server.
 * The row is intentionally preserved when the request/process is interrupted
 * so the production history is truthful and can expose retry later.
 */
export async function POST(req: Request, { params }: { params: { productionId: string } }) {
  const context = await assemblyContext();
  if (!context) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { productionId } = params;
  const body = asRecord(await req.json().catch(() => ({})));
  const taskIds = normalizeAssemblyTaskIds(body.taskIds);
  if (taskIds.length < 2) return NextResponse.json({ error: "至少选择两段已完成的视频才能拼接" }, { status: 400 });

  let jobId = "";
  try {
    const productionResult = await context.localClient.from("creator_productions")
      .select("id,session_id,title").eq("id", productionId).eq("workspace_id", context.workspace.id).maybeSingle();
    if (productionResult.error) throw productionResult.error;
    const production = productionResult.data;
    if (!production) return NextResponse.json({ error: "制片项目不存在" }, { status: 404 });

    const tasksResult = await context.localClient.from("creator_generation_tasks")
      .select("id,output,status,kind,user_id")
      .eq("workspace_id", context.workspace.id)
      .eq("user_id", context.user.id)
      .eq("kind", "video")
      .in("id", taskIds);
    if (tasksResult.error) throw tasksResult.error;
    const tasks = (tasksResult.data || []) as Array<{ id: string; output: unknown; status: string }>;
    const taskById = new Map(tasks.map((item) => [item.id, item]));
    const storagePaths = taskIds.map((taskId) => {
      const task = taskById.get(taskId);
      const output = asRecord(task?.output);
      const storagePath = typeof output.video_storage_path === "string" ? output.video_storage_path : "";
      if (!task || task.status !== "succeeded" || !storagePath || !storagePath.startsWith(`${context.user.id}/`)) {
        throw new Error("存在未完成、失效或不属于当前账号的视频段");
      }
      return storagePath;
    });

    const created = await context.localClient.from("creator_video_assembly_jobs").insert({
      workspace_id: context.workspace.id,
      user_id: context.user.id,
      production_id: production.id,
      status: "queued",
      input: { task_ids: taskIds, storage_paths: storagePaths },
    }).select("*").single();
    if (created.error || !created.data) throw created.error || new Error("无法创建拼接任务");
    jobId = created.data.id;

    const startedAt = new Date().toISOString();
    await context.localClient.from("creator_video_assembly_jobs").update({ status: "running", started_at: startedAt, updated_at: startedAt }).eq("id", jobId).eq("workspace_id", context.workspace.id);
    await context.localClient.from("creator_productions").update({ status: "assembling", updated_at: startedAt }).eq("id", production.id).eq("workspace_id", context.workspace.id);

    const sourceBuffers = await Promise.all(storagePaths.map((storagePath) => readLocalFile("creator-assets", storagePath)));
    const outputBuffer = await assembleVideoSegments(sourceBuffers);
    const storagePath = assemblyStoragePath(context.user.id, production.id, jobId);
    const upload = await localStorage("creator-assets").upload(storagePath, outputBuffer, { upsert: true, contentType: "video/mp4" });
    if (upload.error) throw new Error(upload.error.message || "拼接视频保存失败");

    const assetRow = {
      workspace_id: context.workspace.id,
      session_id: production.session_id,
      kind: "video",
      source: "generation",
      name: `${production.title || "FG 制片"}-完整成片.mp4`.slice(0, 180),
      storage_path: storagePath,
      mime_type: "video/mp4",
      metadata: { production_id: production.id, assembly_job_id: jobId, source_task_ids: taskIds },
    };
    let asset = await context.localClient.from("creator_assets").insert(assetRow).select("id").maybeSingle();
    if (asset.error) {
      asset = await createAdminClient().from("creator_assets").insert(assetRow).select("id").maybeSingle();
    }
    if (asset.error) throw asset.error;

    const completedAt = new Date().toISOString();
    const output = { storage_path: storagePath, asset_id: asset.data?.id || null, task_ids: taskIds };
    const updated = await context.localClient.from("creator_video_assembly_jobs")
      .update({ status: "succeeded", output, error: null, completed_at: completedAt, updated_at: completedAt })
      .eq("id", jobId).eq("workspace_id", context.workspace.id).select("*").single();
    if (updated.error || !updated.data) throw updated.error || new Error("拼接结果记录失败");
    await context.localClient.from("creator_productions").update({ status: "succeeded", stage: "complete", updated_at: completedAt }).eq("id", production.id).eq("workspace_id", context.workspace.id);
    return NextResponse.json({ job: jobPayload(updated.data), contentUrl: `/api/creator/canvas-assets/content?path=${encodeURIComponent(storagePath)}` });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "服务端视频拼接失败";
    if (jobId) {
      const completedAt = new Date().toISOString();
      await context.localClient.from("creator_video_assembly_jobs").update({ status: "failed", error: detail.slice(0, 3000), completed_at: completedAt, updated_at: completedAt }).eq("id", jobId).eq("workspace_id", context.workspace.id);
      await context.localClient.from("creator_productions").update({ status: "failed", updated_at: completedAt }).eq("id", productionId).eq("workspace_id", context.workspace.id);
    }
    logServerFailure("creator_production_assembly", error, { productionId });
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
