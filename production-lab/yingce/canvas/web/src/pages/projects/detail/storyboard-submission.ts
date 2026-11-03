import { ApiError } from "@/services/api/request";
import { createGenerationTask, queryGenerationTask, listGenerationTasks, waitForGenerationTask, type CreateTaskInput, type GenerationTask } from "@/services/api/task-center";
import { backendProviderConfig } from "@/services/api/generation-task";
import { logicalModelIDForConfig, modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { splitStoryboardSource, storyboardBatchInfo, storyboardBatchTasks } from "@/lib/chapter-storyboard-batches";
import { originalEnglishDialogue } from "@/services/api/project-language";
import type { ProjectUnit } from "@/services/api/projects";
import { generateJSON, generateText } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

type SubmissionDependencies = { create: typeof createGenerationTask; wait: typeof waitForGenerationTask };
const defaultSubmission: SubmissionDependencies = { create: createGenerationTask, wait: waitForGenerationTask };

/** Keep admission below the account limit, without retrying an uncertain send. */
export async function submitStoryboardRequests(requests: CreateTaskInput[], onTask?: (task: GenerationTask) => void, deps: SubmissionDependencies = defaultSubmission) {
    const tasks: GenerationTask[] = [],
        pending = new Set<Promise<void>>();
    const observe = (task: GenerationTask) => {
        if (task.status !== "queued" && task.status !== "running") return;
        let wait: Promise<void>;
        wait = deps
            .wait(task.id, { initialTask: task, onTaskUpdate: onTask })
            .then(
                () => undefined,
                () => undefined,
            )
            .finally(() => pending.delete(wait));
        pending.add(wait);
    };
    for (const request of requests) {
        while (pending.size >= 3) await Promise.race(pending);
        let task: GenerationTask;
        try {
            task = await deps.create(request);
        } catch (error) {
            if (!(error instanceof ApiError) || error.reason !== "active_task_limit" || !pending.size) throw error;
            await Promise.race(pending);
            task = await deps.create(request);
        }
        tasks.push(task);
        onTask?.(task);
        observe(task);
    }
    return tasks;
}

function assignedSource(task: GenerationTask) {
    for (const line of task.prompt.split(/\r?\n/)) {
        try {
            const value = JSON.parse(line);
            if (typeof value.assignedSource === "string" && typeof value.sourceStart === "number" && typeof value.sourceEnd === "number") return { line, value };
        } catch {
            /* A prompt contains ordinary prose as well as the bounded source record. */
        }
    }
    throw Error("原批次缺少制作范围记录，不能猜测补交；已完成结果仍保留");
}

export function chapterSourceCandidates(html: string) {
    if (!/<[a-z][\s\S]*>/i.test(html)) return [html.trim()];
    const document = new DOMParser().parseFromString(html, "text/html");
    const blocks = [...document.body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,pre")].filter((node) => !node.querySelector("p,h1,h2,h3,h4,h5,h6,li,pre"));
    const text = (node: Element) => {
        const copy = node.cloneNode(true) as Element;
        copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        return copy.textContent || "";
    };
    const extensions = [StarterKit];
    const editorText = generateText(generateJSON(html, extensions), extensions).trim();
    return [...new Set([editorText, blocks.map(text).join("\n\n").trim(), blocks.map(text).join("\n").trim(), document.body.textContent?.trim() || ""])];
}

/** Rebuild only absent indices using the original prompt/asset snapshot. */
export function missingStoryboardRequests(tasks: GenerationTask[], unit: ProjectUnit, config: AiConfig) {
    if (!tasks.length) throw Error("未找到原批次任务，请刷新批次状态后再试");
    const selected = storyboardBatchTasks(tasks[0], tasks),
        info = storyboardBatchInfo(tasks[0]);
    if (!info || !selected.length) throw Error("没有完整的原批次标识，不能补交");
    if (selected.some((t) => t.projectId !== tasks[0].projectId || JSON.parse(t.inputJson || "{}").metadata?.chapterId !== unit.id)) throw Error("分镜批次不属于当前章节");
    if (Date.parse(unit.updatedAt) > Math.min(...selected.map((t) => Date.parse(t.createdAt)))) throw Error("章节原文在提交后已修改，请核对原稿；不能把新旧正文混在同一批次");
    const template = selected.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0],
        input = JSON.parse(template.inputJson || "{}"),
        metadata = input.metadata || {},
        record = assignedSource(template);
    const known = selected.filter((t) => !JSON.parse(t.inputJson || "{}").metadata?.storyboardRepairOf).map(assignedSource);
    const candidates = typeof metadata.storyboardSourceText === "string" ? [metadata.storyboardSourceText] : chapterSourceCandidates(unit.sourceText);
    let parts: ReturnType<typeof splitStoryboardSource> | undefined, source: string | undefined;
    candidateSearch: for (const candidate of candidates)
        for (const limit of [700, 1200]) {
            let partition: ReturnType<typeof splitStoryboardSource>;
            try { partition = splitStoryboardSource(candidate, limit); }
            catch { continue; } // Older 1200-character batches can exceed the newer 700-character bound.
            if (
                partition.length === info.count &&
                known.every(({ value }) => candidate.slice(value.sourceStart, value.sourceEnd) === value.assignedSource) &&
                selected.every((task) => {
                    const m = JSON.parse(task.inputJson || "{}").metadata;
                    const part = partition[Number(m.batchIndex) - 1];
                    return part && part.start === m.storyboardSourceRange?.start && part.end === m.storyboardSourceRange?.end;
                })
            ) {
                parts = partition;
                source = candidate;
                break candidateSearch;
            }
        }
    if (!parts || source === undefined) throw Error("原正文与已提交范围不能逐字对上，未补交，请先核对章节；已有结果保留");
    const model = selectableModelsByCapability(config, "text").find((value) => modelOptionName(value) === template.model);
    if (!model) throw Error("原分镜模型当前不可用，请先在模型设置恢复该模型后再补交");
    const routed = { ...config, model, textModel: model },
        existing = new Set(selected.map((t) => storyboardBatchInfo(t)!.index));
    return parts.flatMap((part, index) => {
        if (existing.has(index + 1)) return [];
        const cues = metadata.projectLanguagePolicy?.spoken === "en-original" ? originalEnglishDialogue(part.text) : undefined;
        let prompt = template.prompt
            .replace(record.line, JSON.stringify({ chapterId: unit.id, sourceStart: part.start, sourceEnd: part.end, assignedSource: part.text }))
            .replace(/【本批唯一制作范围 \d+\/\d+】/, `【本批唯一制作范围 ${index + 1}/${info.count}】`);
        if (cues)
            prompt = prompt.replace(
                /^【本批唯一允许演出的英文原句】.*$/m,
                `【本批唯一允许演出的英文原句】${JSON.stringify(cues.map(({ speaker, text }) => ({ speaker, text })))}。逐字、按说话人和先后顺序分配到 rows.dialogue。中文对照不配音，不自行写英文；空清单表示本批不安排对白。`,
            );
        const { storyboardRepairOf: _repair, storyboardRepairAttempt: _attempt, ...base } = metadata;
        return [
            {
                projectId: template.projectId,
                type: "canvas_text",
                operation: "storyboard",
                prompt,
                model,
                ...(logicalModelIDForConfig(routed) ? { logicalModelId: logicalModelIDForConfig(routed) } : {}),
                input: {
                    ...input,
                    mode: "text",
                    config: backendProviderConfig(routed, "text"),
                    metadata: {
                        ...base,
                        batchIndex: index + 1,
                        storyboardSourceText: source,
                        storyboardSourceRange: { start: part.start, end: part.end },
                        storyboardSubmissionKey: `${info.id}:${index + 1}`,
                        storyboardResumedFromTaskId: template.id,
                        ...(cues ? { originalEnglishDialogue: cues } : {}),
                    },
                },
            } satisfies CreateTaskInput,
        ];
    });
}

export async function resumeMissingStoryboardParts(projectId: string, unit: ProjectUnit, tasks: GenerationTask[], config: AiConfig, onTask?: (task: GenerationTask) => void) {
    if (!tasks.length) throw Error("未找到原批次任务，请刷新批次状态后再试");
    const latest = storyboardBatchTasks(tasks[0], await listGenerationTasks(1000, { projectId }));
    if (!latest.length) throw Error("原批次不在当前任务列表中，请先核对任务中心；未提交新任务");
    const full = await Promise.all(latest.map((t) => queryGenerationTask(t.id)));
    const requests = missingStoryboardRequests(full, unit, config);
    if (!requests.length) return [];
    return submitStoryboardRequests(requests, onTask);
}
