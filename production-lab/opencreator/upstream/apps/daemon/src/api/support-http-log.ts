import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const FILE_BYTES = 512 * 1024;
const ARCHIVES = 3;
const READ_BYTES = 2 * 1024 * 1024;
const READ_LINES = 5000;
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const actor = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const timestamp = z.string().datetime();
const logSchema = z.object({
  event: z.literal('support_http_request'), timestamp, service: z.literal('opencreator'),
  actor_id: actor, request_id: id,
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  route: z.string().max(256).regex(/^\/[^\s?#]*$/),
  http_status: z.number().int().min(100).max(599), duration_ms: z.number().int().nonnegative(),
  project_id: id.optional(), task_id: id.optional(),
  build_commit: z.string().regex(/^[a-f0-9]{7,40}$/i),
  build_environment: z.string().regex(/^[A-Za-z0-9_.:+-]{1,128}$/),
  build_dirty: z.boolean(), build_time: z.string().datetime({ offset: true }).optional()
});
export type SupportHttpLog = z.infer<typeof logSchema>;
const gapSchema = z.object({
  start: timestamp, end: timestamp,
  reason: z.enum(['DAEMON_NOT_RUNNING', 'UNCLEAN_SHUTDOWN'])
});
const stateSchema = z.object({
  format: z.literal(1), actorId: actor, retainedFrom: timestamp, checkpoint: timestamp,
  closed: z.boolean(), rotating: z.boolean().default(false), archives: z.number().int().min(0).max(ARCHIVES),
  gaps: z.array(gapSchema).max(64)
}).strict();
type State = z.infer<typeof stateSchema>;
type Window = { start: string; end: string; projectId?: string; taskId?: string; requestId?: string };

/** Instance-owned files only; serialize writes, rotation and reads on one queue.
 *  仅使用实例固定目录；追加、轮转与读取共用串行队列，避免读取半次轮转。 */
export async function createSupportHttpLog(
  dataDir: string, actorId: string, credentials: Set<string | undefined>, buildMetadataAvailable: boolean
) {
  const directory = join(dataDir, 'logs', 'support-http', actorId);
  const file = (index: number) => join(directory, index === 0 ? 'http.ndjson' : `http.${index}.ndjson`);
  const stateFile = join(directory, 'coverage.json');
  const initializedAt = new Date().toISOString();
  let state: State = {
    format: 1, actorId, retainedFrom: initializedAt, checkpoint: initializedAt,
    closed: false, rotating: false, archives: 0, gaps: []
  };
  let failure: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const safeLog = (value: unknown): SupportHttpLog | undefined => {
    const parsed = logSchema.safeParse(value);
    if (!parsed.success || parsed.data.actor_id !== actorId
      || Object.values(parsed.data).some(field => typeof field === 'string' && credentials.has(field))) return;
    return parsed.data;
  };
  const regularFile = async (name: string, flags: number) => {
    const handle = await fs.open(name, flags | constants.O_NOFOLLOW, 0o600);
    try {
      if (!(await handle.stat()).isFile()) throw new Error('not a regular log file');
      return handle;
    } catch (error) { await handle.close(); throw error; }
  };
  const save = async () => {
    // Atomic replacement prevents torn coverage metadata after a process crash.
    // 原子替换避免进程崩溃留下半份覆盖元数据。
    const temp = `${stateFile}.tmp`;
    const handle = await regularFile(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, stateFile);
  };
  const compactGaps = () => {
    state.gaps = state.gaps.filter(gap => gap.end >= state.retainedFrom);
    if (state.gaps.length > 64) {
      state.retainedFrom = state.gaps[state.gaps.length - 65]!.end;
      state.gaps = state.gaps.slice(-64);
    }
  };
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('invalid log directory');
    await fs.chmod(directory, 0o700);
    const now = new Date().toISOString();
    let previous: State | undefined;
    try {
      const handle = await regularFile(stateFile, constants.O_RDONLY);
      try {
        if ((await handle.stat()).size > 64 * 1024) throw new Error('oversized coverage metadata');
        previous = stateSchema.parse(JSON.parse(await handle.readFile('utf8')));
      } finally { await handle.close(); }
      if (previous.actorId !== actorId || previous.checkpoint > now) throw new Error('invalid coverage metadata');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    state = previous ?? state;
    const recoveringRotation = previous?.rotating === true;
    if (recoveringRotation) {
      // Interrupted rename sequences cannot certify old retention boundaries.
      // 轮转 rename 被中断时不能证明旧历史边界，仅从本次恢复起声明完整。
      state.retainedFrom = now;
      let archives = 0;
      for (let index = 1; index <= ARCHIVES; index++) {
        try {
          const handle = await regularFile(file(index), constants.O_RDONLY);
          await handle.close();
          archives++;
          if (archives !== index) await fs.rename(file(index), file(archives));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      state.archives = archives;
      state.rotating = false;
    }
    if (previous && !recoveringRotation) {
      for (let index = 0; index <= state.archives; index++) {
        const handle = await regularFile(file(index), constants.O_RDONLY);
        await handle.close();
      }
      if (state.checkpoint < now) state.gaps.push({
        start: state.checkpoint, end: now, reason: state.closed ? 'DAEMON_NOT_RUNNING' : 'UNCLEAN_SHUTDOWN'
      });
    }
    const handle = await regularFile(file(0), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
    await handle.chmod(0o600);
    await handle.close();
    state.checkpoint = now;
    state.closed = false;
    compactGaps();
    await save();
  } catch { failure = 'HTTP_LOG_INITIALIZATION_FAILED'; }
  if (!failure && !buildMetadataAvailable) failure = 'HTTP_LOG_BUILD_METADATA_UNAVAILABLE';

  return {
    append(log: SupportHttpLog) {
      return serial(async () => {
        if (failure) return;
        try {
          const safe = safeLog(log);
          if (!safe) throw new Error('invalid HTTP log');
          const line = `${JSON.stringify(safe)}\n`;
          if ((await fs.stat(file(0))).size + Buffer.byteLength(line) > FILE_BYTES) {
            state.rotating = true;
            await save();
            if (state.archives === ARCHIVES) {
              const removed = await fs.stat(file(ARCHIVES));
              // mtime is a conservative upper bound of the evicted completion time.
              // mtime 保守界定被淘汰记录的完成时间，不虚报保留历史。
              state.retainedFrom = new Date(Math.max(Date.parse(state.retainedFrom), Math.ceil(removed.mtimeMs) + 1)).toISOString();
              await fs.unlink(file(ARCHIVES));
            }
            for (let index = Math.min(state.archives, ARCHIVES - 1); index >= 1; index--) {
              await fs.rename(file(index), file(index + 1));
            }
            await fs.rename(file(0), file(1));
            state.archives = Math.min(ARCHIVES, state.archives + 1);
          }
          const handle = await regularFile(file(0), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
          try { await handle.writeFile(line); await handle.datasync(); } finally { await handle.close(); }
          // Never checkpoint past queued, not-yet-durable completions.
          // 覆盖水位不能越过队列中尚未持久化的完成事件。
          state.checkpoint = safe.timestamp;
          state.rotating = false;
          compactGaps();
          await save();
        } catch { failure = 'HTTP_LOG_WRITE_FAILED'; }
      });
    },
    read(window: Window, limit: number) {
      const requestedAt = new Date().toISOString();
      return serial(async () => {
        const reasons = new Set<string>();
        if (failure) reasons.add(failure);
        let bytes = 0;
        let lines = 0;
        let budgetExceeded = false;
        let readFailed = false;
        let matches = 0;
        let selected: SupportHttpLog[] = [];
        if (!failure) {
          try { state.checkpoint = requestedAt; await save(); }
          catch { failure = 'HTTP_LOG_WRITE_FAILED'; reasons.add(failure); }
        }
        for (let index = 0; index <= state.archives; index++) {
          let handle;
          try {
            handle = await regularFile(file(index), constants.O_RDONLY);
            const size = (await handle.stat()).size;
            const take = Math.min(size, READ_BYTES - bytes);
            if (take < size) budgetExceeded = true;
            const buffer = Buffer.alloc(take);
            let read = 0;
            while (read < take) {
              const chunk = await handle.read(buffer, read, take - read, size - take + read);
              if (chunk.bytesRead === 0) throw new Error('short log read');
              read += chunk.bytesRead;
            }
            bytes += read;
            let end = buffer.length;
            if (end && buffer[end - 1] !== 10) { readFailed = true; reasons.add('HTTP_LOG_CORRUPT'); }
            if (end && buffer[end - 1] === 10) end--;
            while (end > 0) {
              if (lines >= READ_LINES) { budgetExceeded = true; break; }
              const newline = buffer.lastIndexOf(10, end - 1);
              if (newline < 0 && take < size) break;
              const text = buffer.subarray(newline + 1, end).toString('utf8');
              end = Math.max(0, newline);
              lines++;
              let log;
              try { log = safeLog(JSON.parse(text)); } catch { /* Invalid lines never escape the allowlist. / 损坏行绝不透出。 */ }
              if (!log) { readFailed = true; reasons.add('HTTP_LOG_CORRUPT'); continue; }
              if (log.timestamp < window.start || log.timestamp > window.end
                || (window.projectId && log.project_id !== window.projectId)
                || (window.taskId && log.task_id !== window.taskId)
                || (window.requestId && log.request_id !== window.requestId)) continue;
              matches++;
              selected.push(log);
              selected.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
              selected = selected.slice(0, limit);
            }
            if (budgetExceeded) break;
          } catch { readFailed = true; reasons.add('HTTP_LOG_UNREADABLE'); }
          finally {
            try { await handle?.close(); }
            catch { readFailed = true; reasons.add('HTTP_LOG_UNREADABLE'); }
          }
        }
        if (budgetExceeded) reasons.add('HTTP_LOG_READ_BUDGET_EXCEEDED');
        const retainedFrom = state.retainedFrom;
        const gaps = state.gaps.filter(gap => gap.start <= window.end && gap.end >= window.start);
        if (!retainedFrom || window.start < retainedFrom) reasons.add('HTTP_LOG_HISTORY_INSUFFICIENT');
        if (window.end > state.checkpoint) reasons.add('HTTP_LOG_WINDOW_NOT_ELAPSED');
        if (gaps.length) reasons.add('HTTP_LOG_COVERAGE_GAP');
        const windowComplete = reasons.size === 0;
        return {
          logs: selected,
          truncated: matches > limit || budgetExceeded,
          coverage: {
            available: !failure && !readFailed, persistent: true,
            ...(reasons.size ? { reason: [...reasons][0], reasons: [...reasons] } : {}),
            retention: '512KiB x 4 files (3 rotated archives); read <=2MiB / 5000 lines per request',
            retainedFrom: retainedFrom ?? null, checkpoint: state.checkpoint,
            windowComplete, gaps, scannedBytes: bytes, scannedLines: lines
          }
        };
      });
    },
    close() {
      return serial(async () => {
        if (failure) return;
        try { state.closed = true; state.checkpoint = new Date().toISOString(); await save(); }
        catch { failure = 'HTTP_LOG_WRITE_FAILED'; }
      });
    }
  };
}
