/** Keep stalled network-file reads from consuming every libuv/DNS worker. */
export class NasReadLimiter {
  private active = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly concurrency = 2, private readonly timeoutMs = 10_000, private readonly maxPending = 32) {}

  run<T>(read: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let started = false;
      let expired = false;
      const unavailable = () => Object.assign(new Error("NAS 媒体读取等待超时，请稍后重试"), { code: "NAS_UNAVAILABLE" });
      const timer = setTimeout(() => {
        expired = true;
        if (!started) {
          const index = this.pending.indexOf(start);
          if (index >= 0) this.pending.splice(index, 1);
        }
        reject(unavailable());
      }, this.timeoutMs);
      const start = () => {
        if (expired) return;
        started = true;
        this.active++;
        Promise.resolve().then(read).then(resolve, reject).finally(() => {
          clearTimeout(timer);
          // A timeout does not cancel filesystem I/O. Retain its slot until
          // it actually settles, rather than starting unbounded replacements.
          this.active--;
          this.pending.shift()?.();
        });
      };
      if (this.active < this.concurrency) start();
      else if (this.pending.length < this.maxPending) this.pending.push(start);
      else {
        clearTimeout(timer);
        reject(unavailable());
      }
    });
  }
}

export const nasReadLimiter = new NasReadLimiter();
