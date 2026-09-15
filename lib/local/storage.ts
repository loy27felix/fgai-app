import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = () => path.resolve(process.env.NAS_MEDIA_PATH || "/data/media");
const readyFile = () => path.resolve(process.env.NAS_READY_FILE || path.join(root(), ".fg-studio-nas-ready"));
const publicBase = () => process.env.LOCAL_MEDIA_URL || "/api/local/storage/content";
const providerBase = () => process.env.PROVIDER_MEDIA_URL || publicBase();
export const NAS_UNAVAILABLE_CODE = "NAS_UNAVAILABLE";

class NasStorageUnavailableError extends Error {
  readonly code = NAS_UNAVAILABLE_CODE;

  constructor() {
    super("NAS 媒体存储当前不可用，请等待挂载恢复");
    this.name = "NasStorageUnavailableError";
  }
}

async function assertNasReady() {
  try {
    const marker = await stat(readyFile());
    if (!marker.isFile()) throw new Error("NAS ready marker is not a file");
  } catch {
    throw new NasStorageUnavailableError();
  }
}

function storageError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof NasStorageUnavailableError ? error.code : undefined,
  };
}

export function isNasUnavailableError(error: unknown) {
  return error instanceof NasStorageUnavailableError
    || (typeof error === "object" && error !== null && "code" in error && error.code === NAS_UNAVAILABLE_CODE);
}

function isSafeStorageSegment(segment: string) {
  return Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("\\") && !segment.includes("\0");
}

export function isSafeStoragePath(name: string) {
  return Boolean(name) && !name.startsWith("/") && name.split("/").every(isSafeStorageSegment);
}

function safePath(bucket: string, name: string) {
  // Reject traversal before path normalization; normalization would otherwise hide `..` segments.
  // 必须在路径规范化前拒绝穿越片段，否则 `..` 会被消解并绕过权限边界。
  if (!isSafeStorageSegment(bucket) || (name !== "." && !isSafeStoragePath(name))) throw new Error("非法媒体路径");
  return name === "." ? path.join(root(), bucket) : path.join(root(), bucket, ...name.split("/"));
}

function urlFor(bucket: string, name: string, base: string, expiresAt?: number) {
  const params = new URLSearchParams({ bucket, path: name });
  if (expiresAt) params.set("expires", String(expiresAt));
  return `${base}?${params.toString()}`;
}

function signedToken(bucket: string, name: string, expiresAt: number) {
  return createHash("sha256").update(`${bucket}:${name}:${expiresAt}:${process.env.SESSION_SECRET || "local"}`).digest("hex");
}

export function verifyLocalSignedUrl(bucket: string, name: string, expiresValue: string | null, token: string | null) {
  const expiresAt = Number(expiresValue);
  if (!isSafeStorageSegment(bucket) || !isSafeStoragePath(name)) return false;
  if (!token || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signedToken(bucket, name, expiresAt));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export class LocalStorageBucket {
  constructor(private readonly bucket: string) {}

  async upload(name: string, body: Blob | Buffer | Uint8Array, options?: { upsert?: boolean; contentType?: string }) {
    try {
      await assertNasReady();
      const destination = safePath(this.bucket, name);
      if (!options?.upsert) {
        try { await stat(destination); return { data: null, error: { message: "文件已存在" } }; } catch {}
      }
      await mkdir(path.dirname(destination), { recursive: true });
      const bytes = Buffer.isBuffer(body) ? body : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(await body.arrayBuffer());
      await writeFile(destination, bytes);
      return { data: { path: name }, error: null };
    } catch (error) {
      return { data: null, error: storageError(error) };
    }
  }

  async download(name: string) {
    try { await assertNasReady(); return { data: new Blob([await readFile(safePath(this.bucket, name))]), error: null }; }
    catch (error) { return { data: null, error: storageError(error) }; }
  }

  async remove(names: string[]) {
    try { await assertNasReady(); await Promise.all(names.map((name) => rm(safePath(this.bucket, name), { force: true }))); return { data: names.map((name) => ({ name })), error: null }; }
    catch (error) { return { data: null, error: storageError(error) }; }
  }

  /** Write one contiguous chunk to an existing or newly-created NAS object. */
  async writeChunk(name: string, start: number, body: Blob | Buffer | Uint8Array) {
    try {
      await assertNasReady();
      if (!Number.isSafeInteger(start) || start < 0) throw new Error("非法上传偏移");
      const destination = safePath(this.bucket, name);
      const bytes = Buffer.isBuffer(body) ? body : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(await body.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) throw new Error("上传分片不能超过 8MiB");
      await mkdir(path.dirname(destination), { recursive: true });
      let handle;
      try { handle = await open(destination, "r+"); }
      catch { handle = await open(destination, "w+"); }
      try {
        const current = (await handle.stat()).size;
        if (current !== start) throw new Error("上传分片必须连续");
        await handle.write(bytes, 0, bytes.length, start);
      } finally {
        await handle.close();
      }
      return { data: { path: name, receivedBytes: start + bytes.byteLength }, error: null };
    } catch (error) { return { data: null, error: storageError(error) }; }
  }

  /** Move a verified temporary object to its immutable server-derived path. */
  async move(source: string, destination: string) {
    try {
      await assertNasReady();
      const sourcePath = safePath(this.bucket, source);
      const destinationPath = safePath(this.bucket, destination);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await rename(sourcePath, destinationPath);
      return { data: { path: destination }, error: null };
    } catch (error) { return { data: null, error: storageError(error) }; }
  }

  async sha256(name: string) {
    try {
      await assertNasReady();
      const filePath = safePath(this.bucket, name);
      const hash = createHash("sha256");
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.once("error", reject);
        stream.once("end", () => resolve());
      });
      return { data: hash.digest("hex"), error: null };
    } catch (error) { return { data: null, error: storageError(error) }; }
  }

  async readPrefix(name: string, length = 32) {
    try {
      await assertNasReady();
      const size = Math.max(1, Math.min(1024, Math.floor(length)));
      const handle = await open(safePath(this.bucket, name), "r");
      try {
        const buffer = Buffer.alloc(size);
        const result = await handle.read(buffer, 0, size, 0);
        return { data: buffer.subarray(0, result.bytesRead), error: null };
      } finally {
        await handle.close();
      }
    } catch (error) { return { data: null, error: storageError(error) }; }
  }

  async list(prefix = "", options?: { limit?: number; offset?: number }) {
    const directory = safePath(this.bucket, prefix || ".");
    try {
      await assertNasReady();
      const entries = await readdir(directory, { withFileTypes: true });
      const offset = options?.offset || 0;
      const limit = options?.limit || 100;
      return { data: entries.slice(offset, offset + limit).map((entry) => ({ name: entry.name, id: entry.isFile() ? entry.name : null, metadata: null })), error: null };
    } catch (error) { return { data: [], error: storageError(error) }; }
  }

  getPublicUrl(name: string) { return { data: { publicUrl: urlFor(this.bucket, name, publicBase()) } }; }
  async createSignedUrl(name: string, expiresIn: number) {
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn));
    const token = signedToken(this.bucket, name, expiresAt);
    return { data: { signedUrl: `${urlFor(this.bucket, name, publicBase(), expiresAt)}&token=${token}` }, error: null };
  }

  async createProviderSignedUrl(name: string, expiresIn: number) {
    // Provider URLs must be publicly reachable; browser-facing stored assets stay on the LAN URL.
    // Provider 地址必须可被公网访问；页面展示的已存储资源继续使用局域网地址。
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresIn));
    const token = signedToken(this.bucket, name, expiresAt);
    return { data: { signedUrl: `${urlFor(this.bucket, name, providerBase(), expiresAt)}&token=${token}` }, error: null };
  }
}

export function localStorage(bucket: string) { return new LocalStorageBucket(bucket); }

export async function readLocalFile(bucket: string, name: string) {
  await assertNasReady();
  return readFile(safePath(bucket, name));
}

export async function readLocalRange(bucket: string, name: string, start: number, end: number) {
  await assertNasReady();
  const handle = await open(safePath(bucket, name), "r");
  try {
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

export async function localFileSize(bucket: string, name: string) {
  await assertNasReady();
  return (await stat(safePath(bucket, name))).size;
}
