import localforage from "localforage";

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

/** Return log payloads so browser media cleanup never removes a generated result
 * that is still reachable from the local generation history. */
export async function readGenerationLogStorageSnapshot() {
    const values: unknown[] = [];
    await Promise.all([
        imageLogStore.iterate<unknown, void>((value) => {
            values.push(value);
        }),
        videoLogStore.iterate<unknown, void>((value) => {
            values.push(value);
        }),
    ]);
    return values;
}