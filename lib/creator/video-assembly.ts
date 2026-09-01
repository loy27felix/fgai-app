import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SEGMENTS = 12;
const MAX_SEGMENT_BYTES = 420 * 1024 * 1024;

/** Keep the request boundary narrow before any database or FFmpeg work starts. */
export function normalizeAssemblyTaskIds(value: unknown) {
  const input = Array.isArray(value) ? value : [];
  const ids = input.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(item));
  return Array.from(new Set(ids)).slice(0, MAX_SEGMENTS);
}

export function assemblyStoragePath(userId: string, productionId: string, jobId: string) {
  return `${userId}/productions/${productionId}/assemblies/${jobId}.mp4`;
}

function concatLine(filePath: string) {
  // FFmpeg's concat demuxer accepts a single-quoted, escaped filesystem path.
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

function runFfmpeg(directory: string, concatFile: string, outputFile: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", concatFile,
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-movflags", "+faststart", outputFile,
    ], { cwd: directory, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    child.once("error", (error) => reject(new Error(`FFmpeg 无法启动：${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 拼接失败${stderr ? `：${stderr.trim()}` : ""}`));
    });
  });
}

/**
 * Re-encodes ordered provider segments into a delivery-safe MP4. Each input
 * is already access-checked by the route; temp files never become public.
 */
export async function assembleVideoSegments(segments: Buffer[]) {
  if (segments.length < 2) throw new Error("至少需要两段视频才能拼接");
  if (segments.length > MAX_SEGMENTS) throw new Error(`一次最多拼接 ${MAX_SEGMENTS} 段视频`);
  if (segments.some((segment) => !segment.byteLength || segment.byteLength > MAX_SEGMENT_BYTES)) {
    throw new Error("存在为空或超过 420MB 的视频段，无法进入拼接队列");
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "fg-video-assembly-"));
  try {
    const inputFiles = await Promise.all(segments.map(async (segment, index) => {
      const filePath = path.join(directory, `segment-${String(index + 1).padStart(2, "0")}.mp4`);
      await writeFile(filePath, segment);
      return filePath;
    }));
    const concatFile = path.join(directory, "inputs.txt");
    const outputFile = path.join(directory, "final.mp4");
    await writeFile(concatFile, `${inputFiles.map(concatLine).join("\n")}\n`, "utf8");
    await runFfmpeg(directory, concatFile, outputFile);
    return await readFile(outputFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
