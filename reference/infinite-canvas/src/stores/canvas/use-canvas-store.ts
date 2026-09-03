import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/reference/infinite-canvas/src/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { DEFAULT_CANVAS_APPEARANCE, normalizeCanvasAppearance, type CanvasAppearance } from "@/reference/infinite-canvas/src/lib/canvas/canvas-appearance";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/reference/infinite-canvas/src/types/canvas";

export type CanvasProject = {
    id: string;
    cloudCanvasId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    appearance: CanvasAppearance;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    duplicateProject: (id: string, title?: string) => string | null;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "cloudCanvasId" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "appearance" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    cloudCanvasId: undefined,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    appearance: DEFAULT_CANVAS_APPEARANCE,
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            duplicateProject: (id, title) => {
                const source = get().projects.find((item) => item.id === id);
                if (!source) return null;
                const nodeIdMap = new Map(source.nodes.map((node) => [node.id, nanoid()]));
                const remapId = (value?: string | null) => (value && nodeIdMap.get(value)) || value || undefined;
                const remapText = (value?: string) => {
                    if (!value) return value;
                    let next = value;
                    nodeIdMap.forEach((nextId, previousId) => {
                        next = next.replaceAll(previousId, nextId);
                    });
                    return next;
                };
                const nodes = source.nodes.map((node) => ({
                    ...node,
                    id: nodeIdMap.get(node.id) || nanoid(),
                    title: `${node.title || "未命名节点"} 副本`,
                    position: { x: node.position.x + 48, y: node.position.y + 48 },
                    metadata: node.metadata
                        ? {
                              ...node.metadata,
                              composerContent: remapText(node.metadata.composerContent),
                              groupId: remapId(node.metadata.groupId),
                              batchRootId: remapId(node.metadata.batchRootId),
                              batchChildIds: node.metadata.batchChildIds?.map((childId) => remapId(childId) || childId),
                              primaryImageId: remapId(node.metadata.primaryImageId),
                          }
                        : undefined,
                }));
                const connections = source.connections.map((connection) => ({
                    ...connection,
                    id: nanoid(),
                    fromNodeId: nodeIdMap.get(connection.fromNodeId) || connection.fromNodeId,
                    toNodeId: nodeIdMap.get(connection.toNodeId) || connection.toNodeId,
                }));
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    ...source,
                    cloudCanvasId: undefined,
                    id: nanoid(),
                    title: title?.trim() || `${source.title || "未命名画布"} 副本`,
                    createdAt: now,
                    updatedAt: now,
                    nodes,
                    connections,
                    chatSessions: source.chatSessions.map((session) => ({ ...session, id: nanoid() })),
                    activeChatId: null,
                    appearance: normalizeCanvasAppearance(source.appearance),
                    viewport: { ...source.viewport },
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    appearance: normalizeCanvasAppearance(source.appearance),
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                const project = get().projects.find((item) => item.id === id);
                return project ? { ...project, appearance: normalizeCanvasAppearance(project.appearance) } : null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
