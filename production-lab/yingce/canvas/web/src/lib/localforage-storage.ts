import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { isUserScopedPersistenceSuppressed, scopedStorageKey } from "@/lib/user-scope";

localforage.config({
    name: "yingce",
    storeName: "app_state",
});
// Handle driver selection even before the first read. Individual operations
// still reject if IndexedDB is unavailable; no localStorage fallback is allowed.
void localforage.setDriver([localforage.INDEXEDDB]).catch(() => undefined);

const legacyPrefix = "yingce/app_state/";
const pending = new Map<string, Promise<unknown>>();

function inKeyOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const run = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(operation);
    pending.set(key, run);
    const cleanup = () => { if (pending.get(key) === run) pending.delete(key); };
    void run.then(cleanup, cleanup);
    return run;
}

function storageError(cause: unknown) {
    return new Error("浏览器存储暂时不可用或磁盘空间不足，未完成本地保存。请释放磁盘空间后重试；不要清除浏览器数据。", { cause });
}

function legacyValue(key: string): string | null {
    const raw = window.localStorage.getItem(legacyPrefix + key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "string") throw new Error("旧画布缓存格式不正确，已保留原缓存");
    return value;
}

async function saveState(key: string, value: string) {
    await localforage.setItem(key, value);
    // Release only this key's legacy cache, after durable read-back succeeds.
    // A failed write/read must leave the original recoverable data intact.
    if (window.localStorage.getItem(legacyPrefix + key) === null) return;
    if (await localforage.getItem<string>(key) !== value) throw new Error("画布缓存回读失败");
    try { window.localStorage.removeItem(legacyPrefix + key); } catch { /* Cleanup can be retried on the next save. */ }
}

// localforage 需要 localStorage / indexedDB 等浏览器存储驱动；测试进程等环境可能只有 window 而无存储 API，
// 此时直接跳过读写，避免 localforage 内部回退并输出 "No available storage method found"。
function browserStorageAvailable(): boolean {
    if (typeof window === "undefined") return false;
    return typeof window.localStorage !== "undefined" || typeof window.indexedDB !== "undefined";
}

export function localForageStorageForScope(scope?: string): StateStorage {
    const keyFor = (name: string) => scopedStorageKey(name, scope);
    return {
        getItem: async (name) => {
            if (!browserStorageAvailable()) return null;
            const key = keyFor(name);
            return inKeyOrder(key, async () => {
                try {
                    const saved = await localforage.getItem<string>(key);
                    if (saved !== null) return saved;
                    const legacy = legacyValue(key);
                    if (legacy !== null && !isUserScopedPersistenceSuppressed()) await saveState(key, legacy);
                    return legacy;
                } catch (cause) { throw storageError(cause); }
            });
        },
        setItem: async (name, value) => {
            if (!browserStorageAvailable()) return;
            if (isUserScopedPersistenceSuppressed()) return;
            const key = keyFor(name);
            await inKeyOrder(key, async () => {
                try { await saveState(key, value); } catch (cause) { throw storageError(cause); }
            });
        },
        removeItem: async (name) => {
            if (!browserStorageAvailable()) return;
            if (isUserScopedPersistenceSuppressed()) return;
            const key = keyFor(name);
            await inKeyOrder(key, async () => {
                try {
                    await localforage.removeItem(key);
                    window.localStorage.removeItem(legacyPrefix + key);
                } catch (cause) { throw storageError(cause); }
            });
        },
    };
}

export const localForageStorage: StateStorage = localForageStorageForScope();

export async function localForageKeysForScope(scope: string): Promise<string[]> {
    if (!browserStorageAvailable()) return [];
    const suffix = `:user:${scope}`;
    const keys = new Set(await localforage.keys());
    for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(legacyPrefix)) keys.add(key.slice(legacyPrefix.length));
    }
    return [...keys].filter(key => key.endsWith(suffix)).map(key => key.slice(0, -suffix.length));
}
