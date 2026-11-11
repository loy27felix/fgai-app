import { generationErrorMessage } from "@/lib/generation-error";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";

function chapterOf(task: GenerationTask) {
    if (task.clientContext?.chapterId) return task.clientContext.chapterId;
    try { return JSON.parse(task.inputJson || "{}").metadata?.chapterId; }
    catch { return undefined; }
}

function failureMessage(task: GenerationTask) {
    if (task.status === "cancelled") return "任务已取消，已保存结果仍保留。";
    const diagnostic = (task as GenerationTask & {diagnostic?: {safeMessage?: string}}).diagnostic?.safeMessage || "";
    if (/stream error:.*INTERNAL_ERROR|received from peer|http2.*stream.*(?:reset|error)/i.test(`${task.error || ""} ${diagnostic}`)) {
        return "模型服务的响应连接中断，未收到完整结果。请先核对已保存结果，再决定是否重试失败批次。";
    }
    return task.error ? generationErrorMessage(new Error(task.error)) : "任务失败，尚未读到具体原因，请在任务中心查看诊断。";
}

/** Lists intentionally omit errors. Read only this chapter's failed details through the owner-checked API. */
export async function readStoryboardBatchFailureMessages(
    projectId: string, chapterId: string, tasks: GenerationTask[], signal?: AbortSignal,
    readTask: typeof queryGenerationTask = queryGenerationTask,
) {
    const selected = [...new Map(tasks.filter(task => task.projectId === projectId && chapterOf(task) === chapterId && ["failed", "cancelled"].includes(task.status)).map(task => [task.id, task])).values()].slice(0, 24);
    const outcomes = await Promise.allSettled(selected.map(async task => {
        const full = await readTask(task.id, {signal});
        if (full.id !== task.id || full.projectId !== projectId || chapterOf(full) !== chapterId) return [task.id, "任务归属不一致，请在任务中心核对。"] as const;
        return [task.id, ["failed", "cancelled"].includes(full.status) ? failureMessage(full) : "任务状态已变化，请刷新批次状态。"] as const;
    }));
    return Object.fromEntries(outcomes.map((outcome, index) => outcome.status === "fulfilled" ? outcome.value : [selected[index].id, "失败原因暂时读取失败，请稍后刷新或打开任务中心。"]));
}
