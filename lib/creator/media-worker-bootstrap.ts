import { readFile } from "node:fs/promises";
import { hashWorkerToken } from "@/lib/creator/media-worker-auth";
import { query } from "@/lib/local/db";

export type WorkerArtifactKind = "installer" | "runtime" | "model" | "ffmpeg";

export type WorkerArtifact = {
  id: string;
  kind: WorkerArtifactKind;
  bucket: string;
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
};

export type WorkerRelease = {
  platform: string;
  version: string;
  requiredDiskBytes: number;
  artifacts: WorkerArtifact[];
  runnerCommands: Record<string, string>;
  ffmpegDir: string;
  workerExecutable?: string;
};

export class WorkerBootstrapError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "WorkerBootstrapError";
    this.status = status;
    this.code = code;
  }
}

type RawManifest = { schemaVersion: 1; releases: Record<string, unknown> };

const ARTIFACT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const PLATFORM_ID = /^(?:windows|macos)-[A-Za-z0-9._-]+$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024 * 1024;

function text(value: unknown, field: string, max = 1024) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) {
    throw new WorkerBootstrapError(`Worker 发布清单字段 ${field} 无效`, "WORKER_MANIFEST_INVALID", 503);
  }
  return value.trim();
}

function safeStoragePath(value: unknown) {
  const result = text(value, "artifact.path", 1024);
  if (result.startsWith("/") || result.includes("\\") || result.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new WorkerBootstrapError("Worker 发布清单存储路径无效", "WORKER_MANIFEST_INVALID", 503);
  }
  return result;
}

function safeFileName(value: unknown) {
  const result = text(value, "artifact.fileName", 256);
  if (result.includes("/") || result.includes("\\") || result === "." || result === "..") {
    throw new WorkerBootstrapError("Worker 发布清单文件名无效", "WORKER_MANIFEST_INVALID", 503);
  }
  return result;
}

function parseArtifact(value: unknown): WorkerArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerBootstrapError("Worker 发布清单 artifact 无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const source = value as Record<string, unknown>;
  const id = text(source.id, "artifact.id", 128);
  const kind = text(source.kind, "artifact.kind", 32) as WorkerArtifactKind;
  if (!ARTIFACT_ID.test(id) || !["installer", "runtime", "model", "ffmpeg"].includes(kind)) {
    throw new WorkerBootstrapError("Worker 发布清单 artifact 无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const bytes = Number(source.bytes);
  const sha256 = text(source.sha256, "artifact.sha256", 64).toLowerCase();
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARTIFACT_BYTES || !SHA256.test(sha256)) {
    throw new WorkerBootstrapError("Worker 发布清单 artifact 校验信息无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const bucket = text(source.bucket, "artifact.bucket", 128);
  if (bucket.includes("/") || bucket.includes("\\") || bucket === "." || bucket === "..") {
    throw new WorkerBootstrapError("Worker 发布清单存储空间无效", "WORKER_MANIFEST_INVALID", 503);
  }
  return {
    id,
    kind,
    bucket,
    path: safeStoragePath(source.path),
    fileName: safeFileName(source.fileName),
    bytes,
    sha256,
  };
}

function parseRelease(platform: string, value: unknown): WorkerRelease {
  if (!PLATFORM_ID.test(platform) || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerBootstrapError("Worker 发布清单平台无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const source = value as Record<string, unknown>;
  const artifactsValue = source.artifacts;
  if (!Array.isArray(artifactsValue) || !artifactsValue.length) {
    throw new WorkerBootstrapError("Worker 发布清单没有 artifact", "WORKER_MANIFEST_INVALID", 503);
  }
  const artifacts = artifactsValue.map(parseArtifact);
  const ids = new Set(artifacts.map((artifact) => artifact.id));
  if (ids.size !== artifacts.length || !artifacts.some((artifact) => artifact.kind === "runtime")) {
    throw new WorkerBootstrapError("Worker 发布清单缺少唯一 runtime artifact", "WORKER_MANIFEST_INVALID", 503);
  }
  const requiredDiskBytes = Number(source.requiredDiskBytes);
  if (!Number.isSafeInteger(requiredDiskBytes) || requiredDiskBytes <= 0 || requiredDiskBytes > MAX_ARTIFACT_BYTES * 2) {
    throw new WorkerBootstrapError("Worker 发布清单磁盘需求无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const commandsValue = source.runnerCommands || {};
  if (!commandsValue || typeof commandsValue !== "object" || Array.isArray(commandsValue)) {
    throw new WorkerBootstrapError("Worker Runner 配置无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const runnerCommands: Record<string, string> = {};
  for (const [profile, command] of Object.entries(commandsValue)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(profile)) throw new WorkerBootstrapError("Worker Runner 配置无效", "WORKER_MANIFEST_INVALID", 503);
    const commandText = text(command, `runnerCommands.${profile}`, 2048);
    if (commandText.startsWith("/") || commandText.includes("\\") || commandText.split(" ").some((part) => part === "..")) {
      throw new WorkerBootstrapError("Worker Runner 路径无效", "WORKER_MANIFEST_INVALID", 503);
    }
    runnerCommands[profile] = commandText;
  }
  const ffmpegValue = source.ffmpegDir === undefined || source.ffmpegDir === "" ? "" : text(source.ffmpegDir, "ffmpegDir", 512);
  if (ffmpegValue.startsWith("/") || ffmpegValue.includes("\\") || ffmpegValue.split("/").includes("..")) {
    throw new WorkerBootstrapError("Worker FFmpeg 路径无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const workerExecutable = source.workerExecutable ? text(source.workerExecutable, "workerExecutable", 256) : "";
  if (workerExecutable && (workerExecutable.includes("..") || workerExecutable.startsWith("/") || workerExecutable.includes("\\"))) {
    throw new WorkerBootstrapError("Worker 启动路径无效", "WORKER_MANIFEST_INVALID", 503);
  }
  return {
    platform,
    version: text(source.version, "release.version", 128),
    requiredDiskBytes,
    artifacts,
    runnerCommands,
    ffmpegDir: ffmpegValue,
    ...(workerExecutable ? { workerExecutable } : {}),
  };
}

export async function loadWorkerReleaseManifest(): Promise<RawManifest> {
  const manifestPath = process.env.FG_WORKER_RELEASE_MANIFEST_PATH?.trim();
  if (!manifestPath) throw new WorkerBootstrapError("管理员尚未发布本地 Worker 安装包", "WORKER_RELEASE_UNAVAILABLE", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new WorkerBootstrapError("本地 Worker 发布清单暂时不可用", "WORKER_RELEASE_UNAVAILABLE", 503);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as Record<string, unknown>).schemaVersion !== 1) {
    throw new WorkerBootstrapError("本地 Worker 发布清单无效", "WORKER_MANIFEST_INVALID", 503);
  }
  const releases = (parsed as Record<string, unknown>).releases;
  if (!releases || typeof releases !== "object" || Array.isArray(releases)) {
    throw new WorkerBootstrapError("本地 Worker 发布清单无效", "WORKER_MANIFEST_INVALID", 503);
  }
  for (const [platform, value] of Object.entries(releases)) parseRelease(platform, value);
  return parsed as RawManifest;
}

export async function getWorkerRelease(platform: string) {
  const manifest = await loadWorkerReleaseManifest();
  if (!PLATFORM_ID.test(platform)) throw new WorkerBootstrapError("当前平台没有可用安装包", "WORKER_RELEASE_UNAVAILABLE", 404);
  const value = manifest.releases[platform];
  if (!value) throw new WorkerBootstrapError("当前平台没有可用安装包", "WORKER_RELEASE_UNAVAILABLE", 404);
  return parseRelease(platform, value);
}

export async function assertActivePairingCode(code: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) throw new WorkerBootstrapError("配对码无效或已过期", "PAIRING_CODE_INVALID", 400);
  const result = await query<{ id: string }>(
    `select id from creator_media_worker_pairings
     where code_hash = $1 and consumed_at is null and expires_at > now()
     limit 1`,
    [hashWorkerToken(code)],
  );
  if (!result.rowCount) throw new WorkerBootstrapError("配对码无效或已过期", "PAIRING_CODE_INVALID", 400);
}

export async function publicWorkerRelease(code: string, platform: string) {
  await assertActivePairingCode(code);
  const release = await getWorkerRelease(platform);
  return {
    schemaVersion: 1,
    platform: release.platform,
    version: release.version,
    requiredDiskBytes: release.requiredDiskBytes,
    artifacts: release.artifacts.map(({ id, kind, fileName, bytes, sha256 }) => ({
      id,
      kind,
      fileName,
      bytes,
      sha256,
      downloadPath: `/api/creator/worker/bootstrap/artifacts/${encodeURIComponent(id)}?platform=${encodeURIComponent(release.platform)}`,
    })),
    runnerCommands: release.runnerCommands,
    ffmpegDir: release.ffmpegDir,
    ...(release.workerExecutable ? { workerExecutable: release.workerExecutable } : {}),
  };
}

export async function resolveWorkerArtifact(code: string, platform: string, artifactId: string) {
  await assertActivePairingCode(code);
  const release = await getWorkerRelease(platform);
  const artifact = release.artifacts.find((item) => item.id === artifactId);
  if (!artifact) throw new WorkerBootstrapError("安装包 artifact 不存在", "WORKER_ARTIFACT_NOT_FOUND", 404);
  return artifact;
}
