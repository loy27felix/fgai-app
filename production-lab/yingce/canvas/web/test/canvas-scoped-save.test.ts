import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";
import { apiClient } from "@/services/api/request";
import { initializeRemoteUserDataSession, resetRemoteUserDataSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { canvasContentHash } from "@/lib/canvas/canvas-content";

const adapter = apiClient.defaults.adapter;
const getItem = localforage.getItem, setItem = localforage.setItem, removeItem = localforage.removeItem;
let windowDescriptor: PropertyDescriptor | undefined;
const canvas = (id: string): CanvasProject => ({ id, title: id, nodes: [], connections: [], chatSessions: [], activeChatId: null, previsScenes: [], revision: 1, createdAt: "2026-10-12", updatedAt: "2026-10-12", viewport: { x: 0, y: 0, k: 1 } } as CanvasProject);

beforeEach(async () => {
    windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const data = new Map<string, unknown>();
    localforage.getItem = (async (key: string) => data.get(key) ?? null) as typeof getItem;
    localforage.setItem = (async (key: string, value: unknown) => { data.set(key, value); return value; }) as typeof setItem;
    localforage.removeItem = async (key: string) => { data.delete(key); };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } });
    useCanvasStore.setState({ projects: [canvas("current"), canvas("other")] });
    useAssetStore.setState({ assets: [] });
    for (const project of useCanvasStore.getState().projects) project.remoteContentHash = await canvasContentHash(project);
    await initializeRemoteUserDataSession("scoped-test-user");
});
afterEach(() => {
    apiClient.defaults.adapter = adapter;
    resetRemoteUserDataSync();
    useCanvasStore.setState({ projects: [] });
    useAssetStore.setState({ assets: [] });
    localforage.getItem = getItem; localforage.setItem = setItem; localforage.removeItem = removeItem;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete (globalThis as { window?: unknown }).window;
});

test("Agent preflight saves only its canvas, ignoring unrelated broken media and assets", async () => {
    useCanvasStore.setState({ projects: [canvas("current"), { ...canvas("other"), title: "dirty", nodes: [{ id: "broken", type: "image", metadata: { content: "/api/resources/missing/file", storageKey: "resource:missing", assetId: "broken-asset" } }] as never }] });
    useAssetStore.setState({ assets: [{ id: "broken-asset", kind: "image", title: "broken", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { storageKey: "resource:missing", dataUrl: "/api/resources/missing/file", width: 100, height: 100, bytes: 10, mimeType: "image/png" } } as Asset] });
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => { requests.push(config.url || ""); throw new Error("unrelated resource unavailable"); };
    await saveRemoteUserDataNow("current");
    expect(requests).toEqual([]);
    expect(useCanvasStore.getState().projects.find((item) => item.id === "other")?.title).toBe("dirty");
});

test("scoped save waits for a failed other save then performs its own save", async () => {
    useCanvasStore.setState({ projects: [canvas("current"), { ...canvas("other"), title: "dirty" }] });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { started = resolve; });
    apiClient.defaults.adapter = async () => { started(); await gate; throw new Error("other canvas refused"); };
    const other = saveRemoteUserDataNow("other").catch((error) => error.message);
    await reached;
    const current = saveRemoteUserDataNow("current");
    release();
    expect(await other).toBe("other canvas refused");
    await current;
    expect(useCanvasStore.getState().projects.find((item) => item.id === "current")?.revision).toBe(1);
});
