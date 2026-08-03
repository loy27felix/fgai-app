export type BrowserStorageStatus = {
    persisted: boolean;
    quota?: number;
    usage?: number;
};

let persistenceRequest: Promise<BrowserStorageStatus> | null = null;

/**
 * Ask the browser to keep this app's IndexedDB data when storage pressure is
 * high. This is best-effort: browsers may reject the request or may not
 * implement the StorageManager API. The app still works with ordinary
 * IndexedDB in that case.
 */
export function requestBrowserPersistence(): Promise<BrowserStorageStatus> {
    if (persistenceRequest) return persistenceRequest;
    persistenceRequest = (async () => {
        if (typeof window === "undefined" || !("storage" in navigator)) return { persisted: false };
        const storage = navigator.storage;
        let persisted = false;
        try {
            persisted = typeof storage.persisted === "function" ? await storage.persisted() : false;
            if (!persisted && typeof storage.persist === "function") persisted = await storage.persist();
        } catch {
            // A denied persistence request is not fatal; localForage still
            // keeps the normal browser-local path available.
        }
        try {
            const estimate = typeof storage.estimate === "function" ? await storage.estimate() : {};
            return { persisted, quota: estimate.quota, usage: estimate.usage };
        } catch {
            return { persisted };
        }
    })();
    return persistenceRequest;
}

export async function getBrowserStorageEstimate() {
    if (typeof window === "undefined" || !("storage" in navigator) || typeof navigator.storage.estimate !== "function") return null;
    try {
        return await navigator.storage.estimate();
    } catch {
        return null;
    }
}