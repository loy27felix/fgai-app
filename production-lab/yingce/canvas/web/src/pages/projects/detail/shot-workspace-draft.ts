import type { StateStorage } from "zustand/middleware";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { ShotRevisionInput } from "@/services/api/projects";

export type ShotEditorValues = Omit<ShotRevisionInput, "durationMs"> & { title: string; durationSeconds: number; actionBoardPrompt?: string };
export type ShotRewriteResult = { shotId: string; original: string; seconds: number; text: string; originalDialogue?: string; lockedDialogue?: string };
export type ShotWorkspaceDraft = {
    values?: ShotEditorValues;
    notes: string;
    direction: string;
    skillIds: string[];
    result?: ShotRewriteResult | null;
};
const emptyDraft = (): ShotWorkspaceDraft => ({ notes: "", direction: "", skillIds: [] });

/** Memory survives route changes; IndexedDB survives reloads. Writes are ordered per account and shot. */
export function createShotDraftStore(storageForScope: (scope: string) => StateStorage) {
    const cache = new Map<string, ShotWorkspaceDraft>();
    const tails = new Map<string, Promise<void>>();
    const rewriting = new Set<string>();
    const listeners = new Map<string, Set<() => void>>();
    const key = (project: string, shot: string) => `yingce:shot-draft:${project}:${shot}`;
    const identity = (scope: string, project: string, shot: string) => JSON.stringify([scope, project, shot]);
    const notify = (id: string) => { for (const listener of listeners.get(id) || []) listener(); };
    return {
        subscribe(scope: string, project: string, shot: string, listener: () => void) {
            const id = identity(scope, project, shot);
            const group = listeners.get(id) || new Set<() => void>();
            group.add(listener); listeners.set(id, group);
            return () => { group.delete(listener); if (!group.size) listeners.delete(id); };
        },
        isRewriting(scope: string, project: string, shot: string) { return rewriting.has(identity(scope, project, shot)); },
        beginRewrite(scope: string, project: string, shot: string) {
            const id = identity(scope, project, shot);
            if (rewriting.has(id)) return false;
            rewriting.add(id); notify(id); return true;
        },
        endRewrite(scope: string, project: string, shot: string) { const id = identity(scope, project, shot); rewriting.delete(id); notify(id); },
        peek(scope: string, project: string, shot: string) { return cache.get(identity(scope, project, shot)); },
        async read(scope: string, project: string, shot: string) {
            const id = identity(scope, project, shot);
            if (cache.has(id)) return structuredClone(cache.get(id)!);
            const raw = await storageForScope(scope).getItem(key(project, shot));
            // A keystroke or rewrite may have arrived while IndexedDB was reading.
            if (cache.has(id)) return structuredClone(cache.get(id)!);
            const saved: ShotWorkspaceDraft = raw ? JSON.parse(raw) : emptyDraft();
            if (!saved || typeof saved.notes !== "string" || !Array.isArray(saved.skillIds)) throw new Error("镜头本地草稿格式无效，原记录已保留");
            cache.set(id, saved);
            return structuredClone(saved);
        },
        update(scope: string, project: string, shot: string, patch: Partial<ShotWorkspaceDraft>) {
            const id = identity(scope, project, shot);
            const draft = structuredClone({ ...(cache.get(id) || emptyDraft()), ...patch });
            cache.set(id, draft);
            notify(id);
            return draft;
        },
        async persist(scope: string, project: string, shot: string) {
            const id = identity(scope, project, shot);
            const draft = cache.get(id);
            if (!draft || !scope || !project || !shot) return;
            const json = JSON.stringify(draft);
            const write = (tails.get(id) || Promise.resolve()).catch(() => undefined).then(() => storageForScope(scope).setItem(key(project, shot), json)).then(() => undefined);
            tails.set(id, write);
            try { await write; } finally { if (tails.get(id) === write) tails.delete(id); }
        },
    };
}
export const shotDraftStore = createShotDraftStore(localForageStorageForScope);

export function canApplyShotRewrite(result: ShotRewriteResult, shotId: string, values: Pick<ShotEditorValues, "videoPrompt" | "durationSeconds" | "dialogue">) {
    // Generated standalone reference lines may be refreshed independently of authored text.
    const authored = (text: string) => text.split(/\r?\n/)
        .filter(line => !/^【(?:角色参考|场景与道具参考)】\s*$/.test(line.trim()) && !/^[^：:\n]+[：:]\s*@\[asset:[^\]]+\]\s*$/.test(line.trim()))
        .join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return result.shotId === shotId && Number(result.seconds) === Number(values.durationSeconds)
        && (result.originalDialogue === undefined || result.originalDialogue === (values.dialogue || ""))
        && authored(result.original) === authored(values.videoPrompt || "");
}
