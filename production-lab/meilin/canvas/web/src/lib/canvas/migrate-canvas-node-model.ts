import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** Retain FG specialized editors and unknown plugin nodes. */
export function migrateCanvasNodeModel<T extends { nodes: CanvasNodeData[] }>(document: T): T {
    if (!document.nodes.some((node) => node.type === CanvasNodeType.Markdown)) return document;
    const migrated = {...document, nodes:document.nodes.map((node) => node.type === CanvasNodeType.Markdown ? {...node,type:CanvasNodeType.Text,metadata:{...node.metadata,textFormat:"markdown" as const}} : node)};
    delete (migrated as Record<string, unknown>).remoteContentHash;
    return migrated;
}
