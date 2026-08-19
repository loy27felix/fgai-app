import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = () => path.resolve(process.env.NAS_MEDIA_PATH || "/data/media");
const publicBase = () => process.env.LOCAL_MEDIA_URL || "/api/local/storage/content";

function safePath(bucket: string, name: string) {
  const normalized = path.posix.normalize(`/${bucket}/${name}`).replace(/^\/+/, "");
  if (normalized.startsWith("..") || normalized.includes("/../")) throw new Error("非法媒体路径");
  return path.join(root(), normalized);
}

function urlFor(bucket: string, name: string, expires?: number) {
  const params = new URLSearchParams({ bucket, path: name });
  if (expires) params.set("expires", String(Math.floor(Date.now() / 1000) + expires));
  return `${publicBase()}?${params.toString()}`;
}

export class LocalStorageBucket {
  constructor(private readonly bucket: string) {}

  async upload(name: string, body: Blob | Buffer | Uint8Array, options?: { upsert?: boolean; contentType?: string }) {
    try {
      const destination = safePath(this.bucket, name);
      if (!options?.upsert) {
        try { await stat(destination); return { data: null, error: { message: "文件已存在" } }; } catch {}
      }
      await mkdir(path.dirname(destination), { recursive: true });
      const bytes = Buffer.isBuffer(body) ? body : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(await body.arrayBuffer());
      await writeFile(destination, bytes);
      return { data: { path: name }, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async download(name: string) {
    try { return { data: new Blob([await readFile(safePath(this.bucket, name))]), error: null }; }
    catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
  }

  async remove(names: string[]) {
    try { await Promise.all(names.map((name) => rm(safePath(this.bucket, name), { force: true }))); return { data: names.map((name) => ({ name })), error: null }; }
    catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
  }

  async list(prefix = "", options?: { limit?: number; offset?: number }) {
    const directory = safePath(this.bucket, prefix || ".");
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const offset = options?.offset || 0;
      const limit = options?.limit || 100;
      return { data: entries.slice(offset, offset + limit).map((entry) => ({ name: entry.name, id: entry.isFile() ? entry.name : null, metadata: null })), error: null };
    } catch (error) { return { data: [], error: { message: error instanceof Error ? error.message : String(error) } }; }
  }

  getPublicUrl(name: string) { return { data: { publicUrl: urlFor(this.bucket, name) } }; }
  async createSignedUrl(name: string, expiresIn: number) {
    const token = createHash("sha256").update(`${this.bucket}:${name}:${process.env.SESSION_SECRET || "local"}`).digest("hex");
    return { data: { signedUrl: `${urlFor(this.bucket, name, expiresIn)}&token=${token}` }, error: null };
  }
}

export function localStorage(bucket: string) { return new LocalStorageBucket(bucket); }

export async function readLocalFile(bucket: string, name: string) {
  return readFile(safePath(bucket, name));
}

export async function readLocalRange(bucket: string, name: string, start: number, end: number) {
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
  return (await stat(safePath(bucket, name))).size;
}
