import { expect, test, spyOn } from "bun:test";
import { missingStoryboardRequests, submitStoryboardRequests } from "@/pages/projects/detail/storyboard-submission";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import type { GenerationTask, CreateTaskInput } from "@/services/api/task-center";
import type { ProjectUnit } from "@/services/api/projects";
import { splitStoryboardSource } from "@/lib/chapter-storyboard-batches";
import { ApiError, http } from "@/services/api/request";
import { listGenerationTasks } from "@/services/api/task-center";
import { Window } from "happy-dom";
import { chapterSourceCandidates } from "@/pages/projects/detail/storyboard-submission";

const channel = createModelChannel({ id: "test", name: "test", baseUrl: "https://model.invalid", apiKey: "test-key", interfaceType: "openai", models: ["gpt-6.1-sol"] });
const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "gpt-6.1-sol"), textModel: encodeChannelModel(channel.id, "gpt-6.1-sol") };
function fixture() {
    const source = Array.from({ length: 85 }, (_, i) => `第${i}行动。角色沿同一通道前进，保持原有对白。`).join("\n\n"),
        parts = splitStoryboardSource(source),
        batch = "same-batch";
    const task = (index: number) =>
        ({
            id: `t${index}`,
            projectId: "project",
            type: "canvas_text",
            model: "gpt-6.1-sol",
            operation: "storyboard",
            status: "succeeded",
            createdAt: "2026-11-03T06:00:00Z",
            updatedAt: "2026-11-03T06:01:00Z",
            prompt: [
                "原技能与全部角色资产快照",
                `【本批唯一制作范围 ${index}/${parts.length}】`,
                JSON.stringify({ chapterId: "chapter", sourceStart: parts[index - 1].start, sourceEnd: parts[index - 1].end, assignedSource: parts[index - 1].text }),
                "全局导演规则",
            ].join("\n"),
            inputJson: JSON.stringify({
                mode: "text",
                metadata: {
                    source: "short-drama-chapter-storyboard",
                    chapterId: "chapter",
                    storyboardBatchId: batch,
                    batchIndex: index,
                    batchCount: parts.length,
                    storyboardSourceRange: { start: parts[index - 1].start, end: parts[index - 1].end },
                    storyboardSourceText: source,
                    dramaAssetIds: ["actor1"],
                    dramaProductionPlan: { seconds: 15 },
                },
            }),
        }) as GenerationTask;
    return { source, parts, task, unit: { id: "chapter", sourceText: source, updatedAt: "2026-11-03T05:00:00Z" } as ProjectUnit };
}
test("resume submits only missing indices, retaining the original batch, source and assets", () => {
    const f = fixture(),
        known = [f.task(1), f.task(2)],
        requests = missingStoryboardRequests(known, f.unit, config);
    expect(requests.length).toBe(f.parts.length - 2);
    for (const [i, request] of requests.entries()) {
        const m = request.input!.metadata as any;
        expect(m.batchIndex).toBe(i + 3);
        expect(m.storyboardBatchId).toBe("same-batch");
        expect(m.storyboardSubmissionKey).toBe(`same-batch:${i + 3}`);
        expect(m.dramaAssetIds).toEqual(["actor1"]);
        expect(request.prompt).toContain(JSON.stringify({ chapterId: "chapter", sourceStart: f.parts[i + 2].start, sourceEnd: f.parts[i + 2].end, assignedSource: f.parts[i + 2].text }));
        expect(request.prompt).toContain("原技能与全部角色资产快照");
        expect(request.prompt).toContain("全局导演规则");
    }
    expect(
        missingStoryboardRequests(
            f.parts.map((_, i) => f.task(i + 1)),
            f.unit,
            config,
        ),
    ).toEqual([]);
});
test("changed chapter and inconsistent saved ranges cannot be filled by guessing", () => {
    const f = fixture();
    expect(() => missingStoryboardRequests([f.task(1)], { ...f.unit, updatedAt: "2026-11-03T07:00:00Z" }, config)).toThrow("已修改");
    const bad = f.task(1),
        input = JSON.parse(bad.inputJson!);
    input.metadata.storyboardSourceText = "changed";
    bad.inputJson = JSON.stringify(input);
    expect(() => missingStoryboardRequests([bad], f.unit, config)).toThrow("逐字");
});
test("more than ten parts are queued through three slots instead of stopping at admission limit", async () => {
    let active = 0,
        maximum = 0;
    const created: string[] = [];
    const requests = Array.from({ length: 18 }, (_, i) => ({ prompt: `part${i}` }));
    const result = await submitStoryboardRequests(requests, undefined, {
        create: async (input) => {
            if (active >= 3) throw Error("admission overflow");
            active++;
            maximum = Math.max(active, maximum);
            created.push(input.prompt);
            return { id: input.prompt, status: "queued" } as GenerationTask;
        },
        wait: async (id) => {
            await new Promise((resolve) => setTimeout(resolve, 2));
            active--;
            return { id, status: "succeeded" } as GenerationTask;
        },
    });
    expect(result.length).toBe(18);
    expect(new Set(created).size).toBe(18);
    expect(maximum).toBe(3);
});
test("an uncertain HTTP submission is never blindly retried", async () => {
    let calls = 0;
    await expect(
        submitStoryboardRequests([{ prompt: "part" }], undefined, {
            create: async () => {
                calls++;
                throw new ApiError("connection lost", { status: 502 });
            },
            wait: async () => {
                throw Error("not called");
            },
        }),
    ).rejects.toThrow("connection lost");
    expect(calls).toBe(1);
});
test("the actual task API reader follows backend cursors beyond the first hundred", async () => {
    const pages: Array<Record<string, unknown>> = [];
    const mock = spyOn(http, "get").mockImplementation((async (_path: string, options: any) => {
        pages.push(options.params);
        return Array.from({ length: options.params.before ? 15 : 100 }, (_, i) => ({ id: `task${options.params.before ? 100 + i : i}`, projectId: "project", updatedAt: "2026-11-03T06:00:00Z" }));
    }) as typeof http.get);
    try {
        const tasks = await listGenerationTasks(1000, { projectId: "project" });
        expect(tasks.length).toBe(115);
        expect(pages).toEqual([
            { pageSize: 100, projectId: "project", activeOnly: undefined, before: undefined },
            { pageSize: 100, projectId: "project", activeOnly: undefined, before: "task99" },
        ]);
    } finally {
        mock.mockRestore();
    }
});
test("old HTML is serialized by the chapter editor, retaining empty paragraphs and hard breaks", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window"),
        parser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser"),
        window = new Window();
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: window.DOMParser });
    try {
        expect(chapterSourceCandidates("<p>Opening</p><p></p><p>Next<br>line</p><ul><li><p>Action</p></li></ul>")[0]).toBe("Opening\n\n\n\nNext\nline\n\n\n\n\n\nAction");
    } finally {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else Reflect.deleteProperty(globalThis, "window");
        if (parser) Object.defineProperty(globalThis, "DOMParser", parser);
        else Reflect.deleteProperty(globalThis, "DOMParser");
    }
});
