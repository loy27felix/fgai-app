import type { AppContext } from './app-context.ts';
import { readSceneDocument } from './scenes/sequence-project.ts';

export const fgEmbedded = new URLSearchParams(location.search).get('fg') === '1' && parent !== window;
export let fgCloudReady = !fgEmbedded;
export function markFGCloudReady() { fgCloudReady = true; }
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'fg-director-desk-result') return;
    const item = pending.get(event.data.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(event.data.id);
    if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result);
});
export function fgRequest<T = unknown>(method: string, payload?: unknown): Promise<T> {
    if (!fgEmbedded) return Promise.reject(new Error('请从 FG 画布打开导演台'));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => { pending.delete(id); reject(new Error('云端未确认保存，请保持导演台打开并重试')); }, 180000);
        pending.set(id, { resolve: value => resolve(value as T), reject, timer });
        parent.postMessage({channel: 'fg-director-desk', id, method, payload}, location.origin);
    });
}
export async function fgDeliver(blob: Blob, name: string) { return fgRequest('output', {blob, name}); }

export function mountFGDirector(ctx: AppContext) {
    if (!fgEmbedded) return;
    document.body.classList.add('fg-embedded');
    const brand = document.querySelector('.brand strong'); if (brand) brand.textContent = 'FG 3D 导演台';
    const logo = document.querySelector('.logo'); if (logo) logo.textContent = 'FG';
    // Desktop-only AI/MCP must not offer browser key settings or an unavailable service.
    document.querySelectorAll<HTMLElement>('[data-act^="ai-"], [data-act="updates"], #timeline-to-ai, #ai-toggle, #ai-changes-toggle, #update-toggle, [data-setting="updates"]').forEach(el => el.hidden = true);
    const actions = document.querySelector('.header-actions')!;
    const send = document.createElement('button'); send.className = 'tool-button'; send.textContent = '交给制作 Agent';
    actions.prepend(send);
    send.onclick = () => {
        void ctx.saveProject().then(saved => { if (saved) return fgRequest('agent-context', {summary: sceneSummary(ctx)}); }).catch(error => ctx.toast(error.message, true));
    };
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== 'fg-director-desk-command') return;
        if (event.data.command === 'save') void ctx.saveProject();
        if (event.data.command === 'close') void ctx.saveProject().then(saved => { if (saved) return fgRequest('close'); }).catch(error => ctx.toast(error.message,true));
        if (event.data.command === 'snapshot') void ctx.snapshot();
        if (event.data.command === 'export') ctx.exportDialog();
        if (event.data.command === 'prompt') void ctx.saveProject().then(saved => { if (saved) return fgRequest('output', {name: ctx.project.name + '-调度说明.txt', blob: new Blob([sceneSummary(ctx)], {type: 'text/plain'})}); }).catch(error => ctx.toast(error.message,true));
    });
    // Loading belongs to this canvas scene; never read the standalone app's IndexedDB recovery.
    document.querySelector('#save-status')!.textContent = '工程随画布保存到 NAS';
}
function sceneSummary(ctx: AppContext) {
    const document = readSceneDocument(ctx.scenes.document());
    const p = ctx.project;
    const prompt = p.production?.promptMode === 'text-only' ? p.production.textOnlyPrompt : p.production?.promptText;
    return [`3D 白模预演：${document.name} / ${p.name}`, `画幅 ${p.aspect}，${p.duration} 秒，${p.fps} fps`,
        '根据以下走位与运镜制作视频，白模仅用于构图和调度，最终画风使用故事的角色与场景资产。',
        ...p.entities.map(e => `${e.kind} / ${e.name}：位置 ${JSON.stringify(e.position)}；旋转 ${JSON.stringify(e.rotation)}${e.path ? '；走位 '+JSON.stringify(e.path) : ''}${e.camera ? '；摄影机 '+JSON.stringify(e.camera) : ''}`),
        `切镜：${JSON.stringify(p.cuts)}`, prompt || ''].join('\n');
}
