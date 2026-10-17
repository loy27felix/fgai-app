import { describe, expect, test } from "bun:test";

import { buildCanvasOperations, repairPendingCanvasMutationRequest } from "@/services/user-data-sync";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function canvas(patch: Partial<CanvasProject> = {}): CanvasProject {
    return {
        id: "canvas",
        title: "自由画布 1",
        createdAt: "",
        updatedAt: "",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots" as CanvasProject["backgroundMode"],
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
        ...patch,
    };
}

describe("画布 operations 生成", () => {
    test("生成任务时间戳更新携带taskId身份前置条件", () => {
        const before = canvas({ nodes: [{ id: "video", type: "video", metadata: { taskId: "task-1", taskUpdatedAt: "2026-04-01T00:00:00Z" } }] as CanvasProject["nodes"] });
        const after = canvas({ nodes: [{ id: "video", type: "video", metadata: { taskId: "task-1", taskUpdatedAt: "2026-04-01T00:00:01Z" } }] as CanvasProject["nodes"] });
        expect(buildCanvasOperations(before, after)).toEqual([
            {
                type: "patch_node",
                id: "video",
                patch: { "metadata.taskUpdatedAt": "2026-04-01T00:00:01Z" },
                before: { "metadata.taskUpdatedAt": "2026-04-01T00:00:00Z", "metadata.taskId": "task-1" },
            },
        ]);
    });

    test("任务换绑和首次绑定保留真实旧任务基线", () => {
        const taskNode = (taskId: string | undefined, taskUpdatedAt: string | undefined) => ({ id: "video", type: "video", metadata: { taskId, taskUpdatedAt } }) as CanvasProject["nodes"][number];
        for (const [previousId, nextId] of [
            ["task-a", "task-b"],
            [undefined, "task-b"],
            ["task-a", undefined],
        ] as const) {
            const before = canvas({ nodes: [taskNode(previousId, "2026-04-01T00:00:00Z")] });
            const after = canvas({ nodes: [taskNode(nextId, nextId ? "2026-04-01T00:00:01Z" : undefined)] });
            const [operation] = buildCanvasOperations(before, after);
            expect(operation?.type).toBe("patch_node");
            if (operation?.type !== "patch_node") throw new Error("missing patch");
            expect(operation.before?.["metadata.taskId"]).toBe(previousId ?? null);
        }
    });

    test("同任务清空更新时间不新增人工任务fence", () => {
        const before = canvas({ nodes: [{ id: "video", type: "video", metadata: { taskId: "task-a", taskUpdatedAt: "2026-04-01T00:00:00Z" } }] as CanvasProject["nodes"] });
        const after = canvas({ nodes: [{ ...before.nodes[0]!, metadata: { taskId: "task-a" } }] });
        expect(buildCanvasOperations(before, after)).toEqual([{ type: "patch_node", id: "video", patch: { "metadata.taskUpdatedAt": null }, before: { "metadata.taskUpdatedAt": "2026-04-01T00:00:00Z" } }]);
    });

    test("没有taskId的普通metadata更新不增加任务前置条件", () => {
        const before = canvas({ nodes: [{ id: "video", type: "video", metadata: { prompt: "old" } }] as CanvasProject["nodes"] });
        const after = canvas({ nodes: [{ id: "video", type: "video", metadata: { prompt: "new" } }] as CanvasProject["nodes"] });
        expect(buildCanvasOperations(before, after)).toEqual([{ type: "patch_node", id: "video", patch: { "metadata.prompt": "new" }, before: { "metadata.prompt": "old" } }]);
    });

    test("上游 #744：失败的空 patch 从原快照恢复，未实际变化则丢弃", () => {
        const before = canvas({ nodes: [{ id: "image", type: "image", metadata: {} }] as never });
        const after = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: "/api/resources/generated/file" } }] as never });
        const request = { mutationId: "empty-patch", operations: [{ type: "patch_node", id: "image", patch: {}, before: {} }] } as never;
        const repaired = repairPendingCanvasMutationRequest(request, before, after);
        expect(repaired.mutationId).toBe("empty-patch");
        expect(repaired.operations).toEqual([{ type: "patch_node", id: "image", patch: { "metadata.content": "/api/resources/generated/file" }, before: { "metadata.content": null } }]);
        expect(repairPendingCanvasMutationRequest(request, before, before).operations).toEqual([]);
    });
    test("服务端省略空会话编号时不反复提交 null 到 null", () => {
        const remote = canvas();
        delete (remote as Partial<CanvasProject>).activeChatId;
        expect(buildCanvasOperations(remote, canvas({ activeChatId: null }))).toEqual([]);
        expect(buildCanvasOperations(canvas({ activeChatId: null }), remote)).toEqual([]);
    });
    test("节点缺省媒体和 null 不产生操作，但新增媒体和清空媒体保留", () => {
        const missing = canvas({ nodes: [{ id: "image", type: "image", metadata: {} }] as never });
        const empty = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: null } }] as never });
        const filled = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: "/api/resources/generated/file" } }] as never });
        expect(buildCanvasOperations(missing, empty)).toEqual([]);
        expect(buildCanvasOperations(empty, missing)).toEqual([]);
        expect(buildCanvasOperations(filled, missing)).toEqual([{ type: "patch_node", id: "image", patch: { "metadata.content": null }, before: { "metadata.content": "/api/resources/generated/file" } }]);
        expect(buildCanvasOperations(missing, filled)).toHaveLength(1);
    });
    test("清空已选会话仍然提交，不能当作空字段忽略", () => {
        expect(buildCanvasOperations(canvas({ activeChatId: "chat-1" }), canvas())).toEqual([{ type: "set_field", field: "activeChatId", beforeValue: "chat-1", value: null }]);
    });
    test("旧 journal 丢弃整笔空操作，混合编辑保留原请求用于幂等重放", () => {
        const request = { mutationId: "empty-chat", operations: [
            { type: "set_field", field: "activeChatId", beforeValue: null, value: null },
            { type: "set_field", field: "title", beforeValue: "旧标题", value: "新标题" },
        ] } as never;
        expect(repairPendingCanvasMutationRequest(request, canvas(), canvas())).toBe(request);
        expect(repairPendingCanvasMutationRequest({ mutationId: "noop", operations: [{ type: "set_field", field: "activeChatId", beforeValue: null, value: null }] }, canvas(), canvas()).operations).toEqual([]);
    });
    test("生图节点的 undefined 基线在 JSON 传输后保留为 null", () => {
        const before = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: undefined, storageKey: undefined } }] as never });
        const after = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: "/api/resources/generated/file", storageKey: "resource:generated" } }] as never });
        const operations = JSON.parse(JSON.stringify(buildCanvasOperations(before, after)));
        expect(operations[0].before).toEqual({ "metadata.content": null, "metadata.storageKey": null });
    });
    test("旧 journal 只用保存的节点基线补回缺失字段，不丢失生成结果", () => {
        const before = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: undefined, prompt: "original" } }] as never });
        const after = canvas({ nodes: [{ id: "image", type: "image", metadata: { content: "/api/resources/generated/file", prompt: "original" } }] as never });
        const request = { mutationId: "image-result", operations: [{ type: "patch_node", id: "image", patch: { "metadata.content": "/api/resources/generated/file" }, before: {} }] } as never;
        const repaired = repairPendingCanvasMutationRequest(request, before, after);
        expect(repaired.operations[0]).toEqual({ type: "patch_node", id: "image", patch: { "metadata.content": "/api/resources/generated/file" }, before: { "metadata.content": null } });
        expect(repaired.mutationId).toBe("image-result");
        expect(repairPendingCanvasMutationRequest(request, undefined, after)).toBe(request);
    });
    test("新画布只发 create_canvas，不追加会与创建字段冲突的 set_field", () => {
        const operations = buildCanvasOperations(undefined, canvas());
        expect(operations[0]?.type).toBe("create_canvas");
        expect(operations.some((operation) => operation.type === "set_field")).toBe(false);
    });

    test("已有画布改标题时带上 beforeValue", () => {
        const operations = buildCanvasOperations(canvas({ title: "旧" }), canvas({ title: "新" }));
        expect(operations).toEqual([{ type: "set_field", field: "title", value: "新", beforeValue: "旧" }]);
    });

    test("修复旧 journal：移除新画布中重复的 set_field，保留 mutationId", () => {
        const legacy = JSON.parse(
            JSON.stringify({
                mutationId: "m-1",
                operations: [
                    { type: "create_canvas", id: "canvas", patch: { title: "自由画布 1" } },
                    { type: "set_field", field: "title", value: "自由画布 1", beforeValue: undefined },
                ],
            }),
        );
        const repaired = repairPendingCanvasMutationRequest(legacy, undefined, canvas());
        expect(repaired.mutationId).toBe("m-1");
        expect(repaired.operations).toEqual([{ type: "create_canvas", id: "canvas", patch: { title: "自由画布 1" } }]);
    });

    test("修复旧 journal：移除空 projectId 到缺省值的语义 no-op", () => {
        const legacy = {
            mutationId: "m-3",
            operations: [
                { type: "create_node", node: { id: "node-1" } },
                { type: "set_field", field: "projectId", value: null, beforeValue: "" },
            ],
        } as never;
        const repaired = repairPendingCanvasMutationRequest(legacy, canvas({ projectId: "" }), canvas({ projectId: undefined }));
        expect(repaired.mutationId).toBe("m-3");
        expect(repaired.operations).toEqual([{ type: "create_node", node: { id: "node-1" } }]);
    });
    test("修复旧 journal：缺失的可选字段基线编码为 null", () => {
        const legacy = JSON.parse(JSON.stringify({ mutationId: "m-2", operations: [{ type: "set_field", field: "timeline", value: { tracks: [] }, beforeValue: undefined }] }));
        const repaired = repairPendingCanvasMutationRequest(legacy, canvas(), canvas());
        expect(repaired.operations).toEqual([{ type: "set_field", field: "timeline", value: { tracks: [] }, beforeValue: null }]);
    });
});
