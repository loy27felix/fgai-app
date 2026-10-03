import { importResourceFromUrl, resourceFileUrl, resourceStorageKey } from './api/resources';
import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';
import { ApiError } from './api/request';

export type CanvasImportProgress = { completed: number; total: number; waitSeconds?: number };
type ImportOptions = { onProgress?: (progress: CanvasImportProgress) => void; wait?: (milliseconds: number) => Promise<void> };

// Archive external media before committing the imported layout, so expiring
// third-party links never become the only copy of a saved canvas.
export async function persistImportedCanvasMedia(nodes: CanvasNodeData[], archive = importResourceFromUrl, options: ImportOptions = {}): Promise<CanvasNodeData[]> {
    const resources = new Map<string, Awaited<ReturnType<typeof archive>>>();
    const result: CanvasNodeData[] = [];
    const report = (waitSeconds?: number) => options.onProgress?.({ completed: result.length, total: nodes.length, waitSeconds });
    const wait = options.wait || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    report();
    for (const node of nodes) {
        const kind = node.type === CanvasNodeType.Image ? 'image' : node.type === CanvasNodeType.Video ? 'video' : node.type === CanvasNodeType.Audio ? 'audio' : undefined;
        const url = node.metadata?.content;
        if (!kind || !url || node.metadata?.storageKey?.startsWith('resource:')) {
            result.push(node);
            report();
            continue;
        }
        try {
            if (!url.startsWith('https://')) throw new Error('外部素材必须使用 HTTPS');
            const identity = `${kind}:${url}`;
            let resource = resources.get(identity);
            if (!resource) {
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
                const key = 'canvas-import:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
                for (let attempt = 0; ; attempt++) {
                    try {
                        resource = await archive(url, kind, {width:node.metadata?.naturalWidth,height:node.metadata?.naturalHeight,durationMs:node.metadata?.durationMs,idempotencyKey:key});
                        break;
                    } catch (error) {
                        if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 2 || (error.retryAfterMs ?? 0) > 60_000) throw error;
                        const delay = Math.max(1000, error.retryAfterMs ?? 1000 * 2 ** attempt) + 100;
                        report(Math.ceil(delay / 1000));
                        await wait(delay);
                        report();
                    }
                }
                if (resource.status !== 'ready') throw new Error('素材还未完成服务器保存');
                resources.set(identity, resource);
            }
            result.push({...node, metadata:{...node.metadata,storageKey:resourceStorageKey(resource.id),content:resource.publicUrl || resourceFileUrl(resource.id),mimeType:resource.mimeType,bytes:resource.size}});
            report();
        } catch (error) {
            throw new Error(`“${node.title || '外部素材'}”尚未保存到 NAS，导入未提交：${error instanceof Error ? error.message : '保存失败'}`);
        }
    }
    return result;
}
