export type CanvasRequestKind = "video" | "image" | "mediaJob";

export const CANVAS_REQUEST_LIMITS = {
    total: 60,
    video: 6,
    image: 8,
    mediaJob: 16,
} as const;

type QueuedRequest = {
    kind: CanvasRequestKind;
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
};

class CanvasRequestPool {
    private activeTotal = 0;
    private activeByKind: Record<CanvasRequestKind, number> = { video: 0, image: 0, mediaJob: 0 };
    private queue: QueuedRequest[] = [];

    run<T>(kind: CanvasRequestKind, task: () => Promise<T>) {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ kind, task, resolve: (value) => resolve(value as T), reject });
            this.drain();
        });
    }

    private drain() {
        while (this.activeTotal < CANVAS_REQUEST_LIMITS.total) {
            const index = this.queue.findIndex((request) => this.activeByKind[request.kind] < CANVAS_REQUEST_LIMITS[request.kind]);
            if (index < 0) return;
            const request = this.queue.splice(index, 1)[0]!;
            this.activeTotal += 1;
            this.activeByKind[request.kind] += 1;
            void Promise.resolve()
                .then(request.task)
                .then(request.resolve, request.reject)
                .finally(() => {
                    this.activeTotal -= 1;
                    this.activeByKind[request.kind] -= 1;
                    this.drain();
                });
        }
    }
}

let browserPool: CanvasRequestPool | null = null;

/**
 * A canvas may restore hundreds of persisted nodes at once. Share one browser
 * scheduler so independent hydration paths cannot create a request burst.
 * 大画布恢复会同时触发多个独立链路；浏览器内共用总闸门，避免瞬时请求风暴。
 */
export function runCanvasRequest<T>(kind: CanvasRequestKind, task: () => Promise<T>) {
    if (typeof window === "undefined") return task();
    browserPool ??= new CanvasRequestPool();
    return browserPool.run(kind, task);
}
