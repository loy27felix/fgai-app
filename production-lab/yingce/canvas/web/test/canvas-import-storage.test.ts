import { expect, test } from 'bun:test';
import { persistImportedCanvasMedia } from '../src/services/canvas-import-storage';
import type { RemoteResource } from '../src/services/api/resources';
import { CanvasNodeType, type CanvasNodeData } from '../src/types/canvas';
import { ApiError } from '../src/services/api/request';

function node(id: string, type: CanvasNodeType, content: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content } };
}

function ready(id = 'nas-file'): RemoteResource {
    return { id, userId: 'owner', kind: 'image', status: 'ready', provider: 'local', endpoint: '', bucket: '', objectKey: id, publicUrl: '', mimeType: 'image/png', size: 1234, createdAt: '', updatedAt: '' };
}

test('external canvas media is archived once and every copy refers to the NAS resource', async () => {
    const calls: Array<{ url: string; kind: string; key?: string }> = [];
    const source = [node('first', CanvasNodeType.Image, 'https://files.tapnow.media/a.png'), node('second', CanvasNodeType.Image, 'https://files.tapnow.media/a.png')];
    const archive = async (url: string, kind: string, options: { idempotencyKey?: string } = {}) => {
        calls.push({ url, kind, key: options.idempotencyKey });
        return ready();
    };
    const imported = await persistImportedCanvasMedia(source, archive);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toMatch(/^canvas-import:[a-f0-9]{64}$/);
    expect(imported.map(n => n.metadata?.storageKey)).toEqual(['resource:nas-file', 'resource:nas-file']);
    expect(imported[0].metadata?.content).toContain('/resources/nas-file/file');
    expect(source[0].metadata?.storageKey).toBeUndefined();
    await persistImportedCanvasMedia([source[0]], archive);
    expect(calls[1].key).toBe(calls[0].key);
});

test('text, empty placeholders and already archived resources do not create media downloads', async () => {
    const saved = node('saved', CanvasNodeType.Image, '/api/resources/saved/file');
    saved.metadata!.storageKey = 'resource:saved';
    const source = [node('text', CanvasNodeType.Text, '剧本正文'), node('empty', CanvasNodeType.Video, ''), saved];
    let calls = 0;
    expect(await persistImportedCanvasMedia(source, async () => { calls++; return ready(); })).toEqual(source);
    expect(calls).toBe(0);
});

test('failed or pending archive aborts before imported nodes are submitted and keeps source intact', async () => {
    const source = [node('video', CanvasNodeType.Video, 'https://files.tapnow.media/a.mp4')];
    await expect(persistImportedCanvasMedia(source, async () => { throw new Error('下载失败'); })).rejects.toThrow('导入未提交');
    await expect(persistImportedCanvasMedia(source, async () => ({ ...ready(), status: 'pending' }))).rejects.toThrow('未完成服务器保存');
    expect(source[0].metadata?.content).toBe('https://files.tapnow.media/a.mp4');
    expect(source[0].metadata?.storageKey).toBeUndefined();
});

test('upload throttling respects Retry-After and resumes the same idempotent media request', async () => {
    const delays: number[] = [];
    const keys: Array<string | undefined> = [];
    let calls = 0;
    const imported = await persistImportedCanvasMedia([node('image', CanvasNodeType.Image, 'https://files.tapnow.media/a.png')], async (_url, _kind, meta) => {
        keys.push(meta?.idempotencyKey);
        if (++calls === 1) throw new ApiError('限流', { status: 429, reason: 'rate_limited', retryAfterMs: 15000 });
        return ready();
    }, { wait: async milliseconds => { delays.push(milliseconds); } });
    expect(delays).toEqual([15100]);
    expect(keys[1]).toBe(keys[0]);
    expect(imported[0].metadata?.storageKey).toBe('resource:nas-file');
});

test('persistent throttling stops after a bounded retry budget', async () => {
    let calls = 0;
    await expect(persistImportedCanvasMedia([node('image', CanvasNodeType.Image, 'https://files.tapnow.media/a.png')], async () => {
        calls++;
        throw new ApiError('限流', { status: 429, reason: 'rate_limited', retryAfterMs: 15000 });
    }, { wait: async () => {} })).rejects.toThrow('导入未提交');
    expect(calls).toBe(3);
});
