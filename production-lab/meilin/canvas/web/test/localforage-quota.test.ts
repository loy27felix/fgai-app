import { afterEach, expect, test } from "bun:test";
import localforage from "localforage";
import { localForageStorageForScope } from "../src/lib/localforage-storage";

const originalWindow = globalThis.window;
const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalRemove = localforage.removeItem;
afterEach(() => {
    Object.assign(localforage, { getItem: originalGet, setItem: originalSet, removeItem: originalRemove });
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

function harness() {
    const database = new Map<string, unknown>();
    const legacy = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
        getItem: (key: string) => legacy.get(key) ?? null,
        setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
        removeItem: (key: string) => legacy.delete(key),
    } } });
    localforage.getItem = (async (key: string) => database.get(key) ?? null) as typeof originalGet;
    localforage.setItem = (async (key: string, value: unknown) => { database.set(key, value); return value; }) as typeof originalSet;
    localforage.removeItem = (async (key: string) => { database.delete(key); }) as typeof originalRemove;
    return { database, legacy, storage: localForageStorageForScope("owner") };
}

test("大画布固定使用 IndexedDB，不写已满的 localStorage", async () => {
    const { database, storage } = harness();
    const value = "large canvas".repeat(50000);
    await storage.setItem("canvas", value);
    expect(database.get("canvas:user:owner")).toBe(value);
});

test("旧缓存逐键迁移，回读后才删除，仅处理当前账号", async () => {
    const { legacy, storage, database } = harness();
    legacy.set("yingce/app_state/canvas:user:owner", JSON.stringify("old canvas"));
    legacy.set("yingce/app_state/canvas:user:other", JSON.stringify("other canvas"));
    expect(await storage.getItem("canvas")).toBe("old canvas");
    expect(database.get("canvas:user:owner")).toBe("old canvas");
    expect(legacy.has("yingce/app_state/canvas:user:owner")).toBe(false);
    expect(legacy.has("yingce/app_state/canvas:user:other")).toBe(true);
});

test("磁盘满或回读失败时保留原缓存并报告未保存，恢复后可重试", async () => {
    const { legacy, storage } = harness();
    const key = "yingce/app_state/canvas:user:owner";
    legacy.set(key, JSON.stringify("only original"));
    localforage.setItem = (async () => { throw new DOMException("disk full", "QuotaExceededError"); }) as typeof originalSet;
    await expect(storage.getItem("canvas")).rejects.toThrow("未完成本地保存");
    expect(legacy.has(key)).toBe(true);
    localforage.setItem = (async (_key: string, value: unknown) => value) as typeof originalSet;
    await expect(storage.setItem("canvas", "new")).rejects.toThrow("未完成本地保存");
    expect(legacy.has(key)).toBe(true);
});
