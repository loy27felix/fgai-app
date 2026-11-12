import { beforeEach, expect, mock, test } from "bun:test";

let scope = "alpha";
const stores = new Map<string, Map<string, unknown>>();
let download: (key: string) => Promise<Blob> = async () => new Blob(["download"]);
mock.module("localforage", () => ({ default: { createInstance: ({ storeName }: {storeName:string}) => {
    const values = new Map<string, unknown>(); stores.set(storeName, values);
    return { getItem: async (key:string) => values.get(key) ?? null, setItem: async (key:string,value:unknown) => { values.set(key,value); return value; }, removeItem: async (key:string) => { values.delete(key); }, iterate: async (fn:(value:unknown)=>void) => values.forEach(fn) };
} } }));
mock.module("../../src/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
mock.module("../../src/services/api/resources", () => ({ getResourceBlob: (key:string) => download(key), resourceFileUrl:(id:string) => "/api/resources/"+id+"/file", resourceIdFromStorageKey:(key:string) => key.startsWith("resource:") ? key.slice(9) : "" }));
const revoked:string[] = [];
let sequence = 0;
Object.defineProperty(URL,"createObjectURL",{configurable:true,value:()=>"blob:test-"+(++sequence)});
Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:(url:string)=>revoked.push(url)});
const cache = await import("../../src/services/resource-blob-cache");
beforeEach(() => { scope="alpha"; cache.clearResourceBlobCache(); stores.forEach((s)=>s.clear()); revoked.length=0; });

test("an in-use URL survives release by another consumer; last release is idempotent", async () => {
    const stable = await cache.primeResourceBlobCache("resource:a",new Blob(["image"]));
    expect(stable).toBe("/api/resources/a/file");
    const first=cache.acquireCachedResourceObjectUrl("resource:a")!;
    const second=cache.acquireCachedResourceObjectUrl("resource:a")!;
    expect(first.url).toBe(second.url);
    first.release(); first.release(); expect(revoked).toHaveLength(0);
    second.release(); expect(revoked).toEqual([second.url]);
});
test("memory LRU eviction leaves a playing lease valid and disk copy reloadable", async () => {
    await cache.primeResourceBlobCache("resource:first",new Blob(["image"]));
    const playing=cache.acquireCachedResourceObjectUrl("resource:first")!;
    for(let i=0;i<130;i++) await cache.primeResourceBlobCache("resource:x"+i,new Blob(["x"]));
    expect(revoked).not.toContain(playing.url);
    playing.release();
    expect(cache.acquireCachedResourceObjectUrl("resource:first")).toBeNull();
    const loaded=await cache.loadCachedResourceObjectUrl("resource:first");
    expect(loaded?.url).toStartWith("blob:"); loaded?.release();
});
test("an oversized blob does not remain in the memory accelerator", async () => {
    await cache.primeResourceBlobCache("resource:large",new Blob([new Uint8Array(65*1024*1024)]));
    expect(cache.acquireCachedResourceObjectUrl("resource:large")).toBeNull();
});
test("late downloads from a previous account are discarded", async () => {
    let finish!: (blob:Blob)=>void;
    download=()=>new Promise((resolve)=>{finish=resolve;});
    const pending=cache.getCachedResourceBlob("resource:late");
    await Promise.resolve(); await Promise.resolve();
    scope="beta"; cache.clearResourceBlobCache(); finish(new Blob(["private alpha data"]));
    expect(await pending).toBeNull();
    expect(cache.acquireCachedResourceObjectUrl("resource:late")).toBeNull();
    expect(stores.get("resource_blobs")?.size).toBe(0);
});
