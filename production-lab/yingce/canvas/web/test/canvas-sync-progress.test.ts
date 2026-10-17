import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { reorderCanvasResourceConnections, buildNodeMentionReferences, applyCanvasConnectionPromptSync } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType } from "../src/types/canvas";

// Isolate transport/storage without leaking module mocks into other test suites.
// Sync, resource conversion, content comparison and progress use production code.
const dir = mkdtempSync(join(tmpdir(), "canvas-sync-progress-"));
const root = new URL("../src/", import.meta.url);
const stubPath = join(dir, "dependencies.ts");
const paths: Record<string, string> = {
    "@/lib/fg-entry-url": new URL("lib/fg-entry-url.ts", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "json-canonicalize": import.meta.resolve("json-canonicalize"),
    zustand: import.meta.resolve("zustand"),
    "@/services/api/resources": join(dir, "resources.ts"),
    "@/lib/canvas/canvas-content": join(dir, "content.ts"),
    "@/stores/use-sync-progress-store": join(dir, "progress.ts"),
    "./user-data-sync-media": join(dir, "media.ts"),
};
function copySource(source: string, name: string) {
    const code = readFileSync(new URL(source, root), "utf8");
    const imports = code.replace(/"(@\/[^\"]+|\.\/user-data-sync-media|json-canonicalize|zustand)"/g, (_, specifier: string) => JSON.stringify(paths[specifier] ?? stubPath));
    writeFileSync(join(dir, name), "const window = { setTimeout, clearTimeout, addEventListener: () => {} };\n" + imports);
}
writeFileSync(
    stubPath,
    `
import { createStore } from ${JSON.stringify(import.meta.resolve("zustand/vanilla"))};
export const fixture = { remote: undefined, writes: [], reads: 0, flushes: 0, beforeFlush: undefined, readHook: undefined, flushError: undefined, beforeWrite: undefined, data: new Map() };
export const useCanvasStore = createStore((set, get) => ({ projects: [], openProject: id => get().projects.find(project => project.id === id) }));
export const useAssetStore = createStore(() => ({ assets: [] }));
export const getActiveUserScope = () => "sync-test-user";
export const localForageStorageForScope = () => ({ getItem: async key => fixture.data.get(key) ?? null, setItem: async (key, value) => { fixture.data.set(key, value); }, removeItem: async key => { fixture.data.delete(key); } });
export async function flushCanvasStorePersistence() { fixture.flushes++; const hook = fixture.beforeFlush; fixture.beforeFlush = undefined; hook?.(); if (fixture.flushError) throw fixture.flushError; }
export const flushAssetStorePersistence = async () => {};
export const getGenerationAssetDefaults = () => undefined;
export const appQueryClient = { invalidateQueries: async () => {} };
export const repairMissingCanvasAssets = () => ({ createdAssets: 0, updatedProjects: 0 });
export class ApiError extends Error { retryable = false; }
export const apiBaseURL = "/api";
const unexpected = () => { throw new Error("unexpected dependency call"); };
export const http = { get: unexpected, post: unexpected, put: unexpected, patch: unexpected, delete: unexpected };
export async function applyRemoteCanvasOperations(id, request) {
    fixture.writes.push(structuredClone(request));
    fixture.beforeWrite?.(request);
    for (const operation of request.operations) {
        if (operation.type !== "set_field") throw new Error("unexpected operation");
        if (JSON.stringify(fixture.remote[operation.field] ?? null) !== JSON.stringify(operation.beforeValue ?? null)) throw new Error("invalid operation baseline");
        fixture.remote = { ...fixture.remote, [operation.field]: operation.value };
    }
    fixture.remote = { ...fixture.remote, revision: fixture.remote.revision + 1 };
    return { project: fixture.remote };
}
export async function getRemoteCanvasProject() { fixture.reads++; const hook = fixture.readHook; fixture.readHook = undefined; hook?.(); return { project: structuredClone(fixture.remote) }; }
export const deleteRemoteAssets = unexpected, deleteRemoteCanvasProject = unexpected, getRemoteAsset = unexpected, getRemoteAssetsByIds = unexpected, getRemoteUserDataSnapshot = unexpected, listRemoteAssetsPage = unexpected, upsertRemoteAsset = unexpected;
export const getImageBlob = unexpected, getMediaBlob = unexpected, parseAssetRecordList = unexpected, assetForRemoteSync = unexpected, canvasNodeToAsset = unexpected;
export const applyAgentCanvasPatch = unexpected, mergeAgentCanvasEditor = unexpected, mergeThreeWayValue = unexpected;
export const useCanvasHistoryStore = {};
`,
);
copySource("services/api/resources.ts", "resources.ts");
copySource("services/user-data-sync-media.ts", "media.ts");
copySource("lib/canvas/canvas-content.ts", "content.ts");
copySource("stores/use-sync-progress-store.ts", "progress.ts");
copySource("services/user-data-sync.ts", "sync.ts");
const sync: typeof import("@/services/user-data-sync") = await import(join(dir, "sync.ts"));
const { useSyncProgressStore }: typeof import("@/stores/use-sync-progress-store") = await import(join(dir, "progress.ts"));
const { fixture, useCanvasStore, ApiError } = await import(stubPath);
sync.installRemoteUserDataAutoSync();

const base = (): CanvasProject => ({
    id: "canvas",
    revision: 7,
    title: "Canvas",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    nodes: [{ id: "image", type: "image", title: "Image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey: "resource:image", assetId: "asset", content: "/api/resources/image/file" } }] as CanvasProject["nodes"],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});
function withCdnUrl(project = base()): CanvasProject {
    return { ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "https://cdn.example.com/image.png" } })) };
}
function live(): CanvasProject {
    return useCanvasStore.getState().openProject("canvas");
}
function edit(patch: Partial<CanvasProject>) {
    useCanvasStore.setState({ projects: [{ ...live(), ...patch }] });
}
beforeEach(async () => {
    sync.resetRemoteUserDataSync();
    fixture.remote = base();
    fixture.data.clear();
    fixture.writes = [];
    fixture.reads = fixture.flushes = 0;
    fixture.beforeFlush = fixture.readHook = fixture.flushError = fixture.beforeWrite = undefined;
    useCanvasStore.setState({ projects: [base()] });
    await sync.initializeRemoteUserDataSession("sync-test-user");
});
afterEach(() => sync.resetRemoteUserDataSync());

test("reference reordering produces durable connection updates and preserves prompt identities", () => {
    const a = { ...base().nodes[0], id: "a", type: CanvasNodeType.Image };
    const b = { ...a, id: "b" };
    const target = { ...a, id: "target", type: CanvasNodeType.Video, metadata: { composerContent: "@图片1是角色，@图片2是场景" } };
    const before = {
        ...base(),
        nodes: [a, b, target],
        connections: [
            { id: "a-edge", fromNodeId: "a", toNodeId: "target" },
            { id: "b-edge", fromNodeId: "b", toNodeId: "target" },
        ],
    };
    const connections = reorderCanvasResourceConnections("target", ["b", "a"], before.nodes, before.connections);
    const nodes = applyCanvasConnectionPromptSync(before.nodes, before.connections, before.nodes, connections);
    const operations = sync.buildCanvasOperations(before, { ...before, nodes, connections });
    const updates = operations.filter((operation) => operation.type === "update_connection");
    expect(updates).toHaveLength(2);
    const roundTrip = before.connections.map((edge) => updates.find((operation) => operation.id === edge.id)?.connection || edge);
    expect(roundTrip.map((edge) => edge.fromNodeId)).toEqual(["b", "a"]);
    expect(
        buildNodeMentionReferences(target, nodes, roundTrip)
            .filter((reference) => reference.active)
            .map((reference) => reference.nodeId),
    ).toEqual(["b", "a"]);
    expect(nodes.find((node) => node.id === "target")?.metadata?.composerContent).toBe("@图片2是角色，@图片1是场景");
});
afterAll(() => {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("unexpected fixture directory");
    rmSync(dir, { recursive: true, force: true });
});

describe("画布云端同步状态收尾", () => {
    test("资源地址差异产生空操作时结束同步，后续保存不再重复处理", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", total: 0, pendingChanges: 0, cloudRevision: 7 });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(false);
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(0);
        expect(fixture.reads).toBe(0);
        expect(fixture.flushes).toBe(1);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.flushes).toBe(1);
    });

    test("实际提交后采用云端资源地址，只保存一次并结束同步", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe("Renamed");
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(1);
        expect(fixture.reads).toBe(1);
        expect(fixture.flushes).toBe(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 8 });
    });

    test("空操作收尾期间的新编辑保留并继续提交", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.beforeFlush = () => edit({ title: "Edited during persistence" });
        const phases: string[] = [];
        const stop = useSyncProgressStore.subscribe((state) => phases.push(state.syncingProjects.canvas?.phase));
        try {
            await sync.saveRemoteUserDataNow("canvas");
        } finally {
            stop();
        }
        expect(phases).toContain("pending");
        expect(live().title).toBe("Edited during persistence");
        expect(fixture.remote.title).toBe(live().title);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("云端回读期间的视口更新保留", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        const viewport = { x: 40, y: 90, k: 2 };
        fixture.readHook = () => edit({ viewport });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().viewport).toEqual(viewport);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("空操作收尾的本地保存失败仍显示错误", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.flushError = new Error("local persistence failed");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("local persistence failed");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "error", pendingChanges: 1, errorKind: "local" });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(true);
    });

    test.each([false, true])("重放 journal 时保留后续编辑（有新编辑：%s）", async (newerEdit) => {
        sync.resetRemoteUserDataSync();
        const prepared = { ...base(), title: "Queued edit" };
        fixture.data.set(
            "yingce:canvas-mutation-journal",
            JSON.stringify([
                { projectId: "canvas", request: { mutationId: "pending-mutation", baseRevision: 7, operations: [{ type: "set_field", field: "title", value: prepared.title, beforeValue: "Canvas" }] }, baseline: base(), prepared, createdAt: "2026-01-01" },
            ]),
        );
        const title = newerEdit ? "Newer edit" : prepared.title;
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title })] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe(title);
        expect(fixture.remote.title).toBe(title);
        expect(fixture.writes).toHaveLength(newerEdit ? 2 : 1);
        expect(fixture.writes[0].mutationId).toBe("pending-mutation");
        expect(fixture.data.has("yingce:canvas-mutation-journal")).toBe(false);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });
});

test("a definitely rejected orphan-media journal is not replayed forever after the media is repaired", async () => {
    sync.resetRemoteUserDataSync();
    const oldTimeline = { fps: 30, clips: [{ id: "clip", directMedia: { kind: "video", storageKey: "resource:clip-video", content: "/api/resources/clip-video/file" } }] };
    const fixedTimeline = { ...oldTimeline, clips: oldTimeline.clips.map((clip) => ({ ...clip, directMedia: { ...clip.directMedia, assetId: "registered-video" } })) };
    const prepared = { ...base(), timeline: oldTimeline };
    fixture.data.set(
        "yingce:canvas-mutation-journal",
        JSON.stringify([{ projectId: "canvas", request: { mutationId: "rejected-orphan", baseRevision: 7, operations: [{ type: "set_field", field: "timeline", value: oldTimeline }] }, baseline: base(), prepared, createdAt: "2026-10-16" }]),
    );
    fixture.beforeWrite = (request) => {
        if (request.operations.some((operation) => operation.field === "timeline" && operation.value?.clips.some((clip) => !clip.directMedia?.assetId))) {
            const failure = new ApiError("画布媒体尚未进入素材库，请等待同步完成后重试");
            failure.status = 400;
            throw failure;
        }
    };
    useCanvasStore.setState({ projects: [{ ...base(), timeline: fixedTimeline }] });
    await sync.initializeRemoteUserDataSession("sync-test-user");
    await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("画布媒体尚未进入素材库");
    await sync.saveRemoteUserDataNow("canvas");
    expect(fixture.writes).toHaveLength(2);
    expect(fixture.writes[1].mutationId).not.toBe("rejected-orphan");
    expect(fixture.remote.timeline.clips[0].directMedia.assetId).toBe("registered-video");
});

test("an unknown network outcome retains the exact journal mutation ID for safe retry", async () => {
    edit({ title: "Unsure network save" });
    fixture.beforeWrite = () => {
        throw new Error("network disconnected");
    };
    await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("network disconnected");
    const mutationId = fixture.writes[0].mutationId;
    fixture.beforeWrite = undefined;
    await sync.saveRemoteUserDataNow("canvas");
    expect(fixture.writes[1].mutationId).toBe(mutationId);
    expect(fixture.remote.title).toBe("Unsure network save");
});
