import type { GenerationTask } from "@/services/api/task-center";

// Bound the source assigned to each response, not the detail in a video Prompt.
// Offsets refer to the original string, so no dialogue or punctuation is lost.
export function splitStoryboardSource(source: string, limit = 1200) {
    const parts: Array<{ start: number; end: number; text: string }> = [];
    let start = 0;
    while (start < source.length) {
        let end = Math.min(source.length, start + limit);
        if (end < source.length) {
            const minimum = start + Math.floor(limit / 2);
            const paragraph = source.lastIndexOf("\n", end - 1);
            if (paragraph >= minimum) end = paragraph + 1;
            else {
                const sentence = [...source.slice(minimum, end).matchAll(/[。！？.!?][”’"']?(?:\s|$)/g)].at(-1);
                if (sentence) end = minimum + sentence.index! + sentence[0].length;
            }
            if (/[\uD800-\uDBFF]/.test(source[end - 1])) end--;
        }
        parts.push({ start, end, text: source.slice(start, end) });
        start = end;
    }
    if (parts.length > 24) throw new Error("本章正文过长，请先拆分为较短章节；尚未提交生成任务");
    return parts;
}

export function storyboardBatchInfo(task: GenerationTask) {
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(task.inputJson || "{}").metadata || {}; } catch { /* List entries use safe context. */ }
    const id = task.clientContext?.storyboardBatchId || metadata.storyboardBatchId;
    if (!id) return null;
    const index = Number(task.clientContext?.batchIndex ?? metadata.batchIndex);
    const count = Number(task.clientContext?.batchCount ?? metadata.batchCount);
    if (typeof id !== "string" || !Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > 24 || index < 1 || index > count) throw new Error("分镜批次记录损坏，未导入分镜");
    return { id, index, count };
}

// A completed child is never a completed chapter. The newest attempt for every
// index must succeed before a single atomic project replacement is allowed.
export function completeStoryboardBatch(task: GenerationTask, tasks: GenerationTask[]) {
    let batch: ReturnType<typeof storyboardBatchInfo>;
    try { batch = storyboardBatchInfo(task); } catch { return null; }
    if (!batch) return [task];
    const selected = new Map<number, GenerationTask>();
    for (const item of [...tasks, task].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        let info: ReturnType<typeof storyboardBatchInfo>;
        try { info = storyboardBatchInfo(item); } catch { continue; }
        if (!info || info.id !== batch.id || info.count !== batch.count || item.projectId !== task.projectId) continue;
        const chapter = item.clientContext?.chapterId || JSON.parse(item.inputJson || "{}").metadata?.chapterId;
        const ownChapter = task.clientContext?.chapterId || JSON.parse(task.inputJson || "{}").metadata?.chapterId;
        if (!chapter || chapter !== ownChapter) return null;
        if (!selected.has(info.index)) selected.set(info.index, item);
    }
    if (selected.size !== batch.count || [...selected.values()].some(item => item.status !== "succeeded")) return null;
    return [...selected].sort(([a], [b]) => a - b).map(([, item]) => item);
}
