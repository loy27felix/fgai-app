type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: import("@/types/canvas").CanvasNodeData[];
    connections: import("@/types/canvas").CanvasConnection[];
    chatSessions: import("@/types/canvas").CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: "dots" | "lines" | "blank";
    showImageInfo: boolean;
    viewport: import("@/types/canvas").ViewportTransform;
};

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
