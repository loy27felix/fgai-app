import { getProjectUnitWorkspace, replaceProjectUnitShots, type ProjectAsset, type ProjectDetail } from "@/services/api/projects";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { completeStoryboardBatch, storyboardBatchInfo, storyboardBatchTasks } from "@/lib/chapter-storyboard-batches";
import { chapterStoryboardFromGenerationTasks, chapterTaskIdentity } from "./project-chapter-ai";
import { loadChapterStoryboardAssets, storyboardRowsToProjectShots } from "./chapter-storyboard-production";
import type { StoryboardRow } from "@/types/canvas";

export function latestChapterStoryboard(tasks: GenerationTask[], projectId: string, chapterId: string) {
    return tasks.filter(task => task.projectId === projectId && chapterTaskIdentity(task)?.chapterId === chapterId && chapterTaskIdentity(task)?.kind === "storyboard")
        .sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function chapterStoryboardWasImported(tasks: GenerationTask[], chapterId: string, detail: Pick<ProjectDetail,"shots"|"shotRevisions">) {
    if (!tasks.length) return false;
    const shots = detail.shots.filter(shot => shot.unitId === chapterId);
    if (!shots.length) return false;
    let batchId: string;
    try { batchId = storyboardBatchInfo(tasks[0])?.id || tasks[0].id; } catch { return false; }
    const importedTasks = new Set<string>();
    let sameBatch = true;
    const latestStart = Math.max(...tasks.map(task => Date.parse(task.createdAt)));
    for (const shot of shots) {
        const revision = detail.shotRevisions.find(item => item.id === shot.currentRevisionId);
        let beats: Array<Record<string,unknown>> = [];
        try { beats = JSON.parse(revision?.actionBeatsJson || "[]"); } catch { return false; }
        const source = Array.isArray(beats) && beats.find(beat => beat.type === "chapter_storyboard_import" && beat.expectedRows === shots.length);
        if (!source || typeof source.taskId !== "string") return false;
        if (source.batchId !== batchId) {
            sameBatch = false;
            // A collaborator may have imported a newer batch whose private tasks
            // are not in this account's task list. Never replay its older result.
            const sourceStart = Date.parse(typeof source.createdAt === "string" ? source.createdAt : shot.createdAt);
            if (!Number.isFinite(sourceStart) || sourceStart < latestStart) return false;
        }
        importedTasks.add(source.taskId);
    }
    return !sameBatch || tasks.every(task => importedTasks.has(task.id));
}

type Dependencies = {
    queryTask: typeof queryGenerationTask;
    workspace: typeof getProjectUnitWorkspace;
    assets: typeof loadChapterStoryboardAssets;
    replace: typeof replaceProjectUnitShots;
};
const dependencies: Dependencies = { queryTask: queryGenerationTask, workspace: getProjectUnitWorkspace, assets: loadChapterStoryboardAssets, replace: replaceProjectUnitShots };

/** A provider result is not imported until the normal write API and read-back both succeed. */
export async function importSavedChapterStoryboard(projectId: string, chapterId: string, tasks: GenerationTask[], review: (rows: StoryboardRow[], assets: ProjectAsset[]) => Promise<Record<number,string[]> | undefined>, expectedShotIds: string[] = [], deps: Dependencies = dependencies, resultEdits: Record<string,string> = {}, options: { reviewedDialogue?: boolean } = {}) {
    const latest = latestChapterStoryboard(tasks, projectId, chapterId);
    const batch = latest && storyboardBatchTasks(latest, tasks);
    if (!batch || batch.length !== (storyboardBatchInfo(latest!)?.count || 1)) throw new Error("本章分镜批次尚未全部返回，已完成结果保留");
    const full = (await Promise.all(batch.map(task => deps.queryTask(task.id)))).map(task => {
        if (task.projectId !== projectId || chapterTaskIdentity(task)?.chapterId !== chapterId) throw new Error("分镜草稿不属于当前章节");
        const edited = resultEdits[task.id];
        if (edited === undefined) return task;
        if (task.status !== "succeeded" && !(task.status === "failed" && task.textDraft?.trim())) throw new Error("本批任务尚未结束或没有已保存草稿，不能导入");
        return {...task,status:"succeeded" as const,resultJson:JSON.stringify({...JSON.parse(task.resultJson || "{}"),text:edited})};
    });
    if (!completeStoryboardBatch(full[0],full)) throw new Error("本章分镜批次尚未全部成功，已完成结果保留");
    const result = chapterStoryboardFromGenerationTasks(full, options);
    const workspace = await deps.workspace(projectId, chapterId);
    if (workspace.unit.id !== chapterId || workspace.shots.length !== expectedShotIds.length || workspace.shots.some(shot => !expectedShotIds.includes(shot.id))) throw new Error("本章分镜已发生变化，请重新核对后导入");
    const newestStart = Math.min(...full.map(task => Date.parse(task.createdAt)));
    if (Date.parse(workspace.unit.updatedAt) > newestStart) throw new Error("章节原文在这批任务提交后已修改，不能直接导入旧结果，请先核对原稿");
    const assets = await deps.assets(projectId);
    const choices = await review(result.rows, assets);
    const shots = storyboardRowsToProjectShots(result.rows, { assets } as Parameters<typeof storyboardRowsToProjectShots>[1], result.productionPlan, choices);
    if (Object.keys(resultEdits).length) for (const shot of shots) shot.revision.actionBeats = [...(shot.revision.actionBeats || []),{type:"storyboard_manual_result_edit",taskIds:Object.keys(resultEdits).filter(id=>batch.some(task=>task.id===id))}];
    if (options.reviewedDialogue) for (const shot of shots) shot.revision.actionBeats = [...(shot.revision.actionBeats || []),{type:"storyboard_dialogue_review",mode:"submitted-video-prompt",taskIds:batch.map(task=>task.id)}];
    const saved = await deps.replace(projectId, chapterId, shots, expectedShotIds);
    const verified = await deps.workspace(projectId, chapterId);
    if (saved.shots.length !== shots.length || verified.shots.length !== shots.length || saved.shots.some(shot => !verified.shots.some(item => item.id === shot.id && item.unitId === chapterId))) throw new Error("分镜已提交，但列表读取尚未确认，请刷新核对；不要重新生成");
    return verified;
}
