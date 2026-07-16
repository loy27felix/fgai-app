import { getVideoModel } from "@/lib/ai/video-models";
import type { CreatorTaskStatus } from "./types";

export const MAX_CREATOR_VIDEO_IMAGE_REFERENCES = 9;
export const MAX_CREATOR_VIDEO_FILE_REFERENCES = 3;
export const MAX_CREATOR_VIDEO_TOTAL_REFERENCES = 15;
export const MAX_CREATOR_VIDEO_TOTAL_BYTES = 180_000_000;
export const MAX_CREATOR_VIDEO_IMAGE_BYTES = 7_000_000;
export const MAX_CREATOR_VIDEO_FILE_BYTES = 120_000_000;
export const MAX_CREATOR_VIDEO_AUDIO_BYTES = 24_000_000;

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]);
const RATIOS = new Set(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);

export type CreatorVideoSkill = { name: string; content: string };
export type VideoReferenceKind = "image" | "video" | "audio";
export type VideoReferenceRole = "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio";
export type VideoReferenceManifest = {
  name: string;
  mimeType: string;
  size: number;
  kind: VideoReferenceKind;
  role: VideoReferenceRole;
};
export type VideoDraftInput = {
  prompt: string;
  model: string;
  references: VideoReferenceManifest[];
  duration: number;
  ratio: string;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
  skill?: CreatorVideoSkill | null;
};

export function composeVideoGenerationPrompt(prompt: string, skill?: CreatorVideoSkill | null) {
  if (!skill) return prompt;
  return "Apply the video-directing Skill \"" + skill.name + "\" below.\n\n" + skill.content + "\n\nUser video request:\n" + prompt;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRoleForKind(kind: VideoReferenceKind, role: VideoReferenceRole) {
  if (kind === "image") return role === "first_frame" || role === "last_frame" || role === "reference_image";
  if (kind === "video") return role === "reference_video";
  return role === "reference_audio";
}

function maxBytesFor(kind: VideoReferenceKind) {
  if (kind === "image") return MAX_CREATOR_VIDEO_IMAGE_BYTES;
  if (kind === "audio") return MAX_CREATOR_VIDEO_AUDIO_BYTES;
  return MAX_CREATOR_VIDEO_FILE_BYTES;
}

function mimeAllowed(kind: VideoReferenceKind, mimeType: string) {
  if (kind === "image") return IMAGE_TYPES.has(mimeType);
  if (kind === "video") return VIDEO_TYPES.has(mimeType);
  return AUDIO_TYPES.has(mimeType);
}

export function validateVideoDraftInput(input: VideoDraftInput) {
  const prompt = input.prompt.trim().slice(0, 30_000);
  const skillName = typeof input.skill?.name === "string" ? input.skill.name.trim().slice(0, 80) : "";
  const skillContent = typeof input.skill?.content === "string" ? input.skill.content.trim().slice(0, 30_000) : "";
  const skill = skillName && skillContent ? { name: skillName, content: skillContent } : null;
  const effectivePrompt = composeVideoGenerationPrompt(prompt, skill);
  const model = getVideoModel(input.model);
  if (!model) throw new Error("不支持的视频模型");
  if (!prompt && input.references.length === 0) throw new Error("提示词和参考素材不能同时为空");
  if (input.duration !== -1 && (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15)) {
    throw new Error("视频时长必须为 4 到 15 秒，或使用自适应");
  }
  if (!RATIOS.has(input.ratio)) throw new Error("不支持的画幅");
  if (!model.resolutions.includes(input.resolution)) throw new Error("当前模型不支持这个清晰度");
  if (input.references.length > MAX_CREATOR_VIDEO_TOTAL_REFERENCES) throw new Error("参考素材最多 15 个");

  let total = 0;
  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  let firstFrameCount = 0;
  let lastFrameCount = 0;
  for (const reference of input.references) {
    if (!["image", "video", "audio"].includes(reference.kind)) throw new Error("参考素材类型无效");
    if (!isRoleForKind(reference.kind, reference.role)) throw new Error("参考素材角色无效");
    if (!mimeAllowed(reference.kind, reference.mimeType)) throw new Error("参考素材格式不受支持");
    if (!Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > maxBytesFor(reference.kind)) {
      throw new Error(reference.kind === "image" ? "单张参考图不能超过 7MB" : reference.kind === "video" ? "单个参考视频不能超过 120MB" : "单个参考音频不能超过 24MB");
    }
    total += reference.size;
    if (reference.kind === "image") {
      imageCount += 1;
      if (reference.role === "first_frame") firstFrameCount += 1;
      if (reference.role === "last_frame") lastFrameCount += 1;
    } else if (reference.kind === "video") {
      videoCount += 1;
    } else {
      audioCount += 1;
    }
  }
  if (imageCount > MAX_CREATOR_VIDEO_IMAGE_REFERENCES) throw new Error("参考图片最多 9 张");
  if (videoCount > MAX_CREATOR_VIDEO_FILE_REFERENCES) throw new Error("参考视频最多 3 个");
  if (audioCount > MAX_CREATOR_VIDEO_FILE_REFERENCES) throw new Error("参考音频最多 3 个");
  if (firstFrameCount > 1) throw new Error("首帧图片最多 1 张");
  if (lastFrameCount > 1) throw new Error("尾帧图片最多 1 张");
  if (total > MAX_CREATOR_VIDEO_TOTAL_BYTES) throw new Error("参考素材总大小不能超过 180MB");
  if (audioCount > 0 && imageCount === 0 && videoCount === 0) throw new Error("音频不能单独作为参考");
  return {
    prompt,
    effectivePrompt,
    skill,
    model: model.id,
    references: input.references,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    watermark: Boolean(input.watermark),
    generateAudio: Boolean(input.generateAudio),
  };
}

function isSafePathSegment(segment: string) {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\") && !segment.includes("\0");
}

function extensionFor(mimeType: string) {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
  };
  return map[mimeType] || "bin";
}

export function referencePathFor(userId: string, taskId: string, index: number, mimeType: string) {
  return userId + "/video-tasks/" + taskId + "/references/" + String(index + 1).padStart(2, "0") + "." + extensionFor(mimeType);
}

export function assertOwnedReferencePath(path: string, userId: string, taskId: string) {
  const parts = path.split("/");
  const owned = parts.length === 5
    && parts[0] === userId
    && parts[1] === "video-tasks"
    && parts[2] === taskId
    && parts[3] === "references"
    && isSafePathSegment(parts[0])
    && isSafePathSegment(parts[2])
    && isSafePathSegment(parts[4]);
  if (!owned) throw new Error("参考素材不属于当前任务");
}

export function validateCompletedReferencePaths(paths: unknown, manifest: VideoReferenceManifest[], userId: string, taskId: string) {
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) throw new Error("参考素材上传路径无效");
  if (paths.length !== manifest.length) throw new Error("参考素材数量与草稿不一致");
  return paths.map((path, index) => {
    assertOwnedReferencePath(path, userId, taskId);
    const expected = referencePathFor(userId, taskId, index, manifest[index].mimeType);
    if (path !== expected) throw new Error("参考素材上传路径不匹配");
    return path;
  });
}

export function normalizeVideoIdempotencyKey(value: unknown) {
  if (typeof value !== "string") throw new Error("idempotency key is required");
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("invalid idempotency key");
  }
  return normalized;
}

export function scopedVideoIdempotencyKey(userId: string, workspaceId: string, key: string) {
  return "creator-video:" + workspaceId + ":" + userId + ":" + key;
}

function storedReferences(value: unknown): VideoReferenceManifest[] {
  if (!Array.isArray(value)) throw new Error("stored reference manifest is invalid");
  return value.map((entry) => {
    const record = asRecord(entry);
    if (typeof record.name !== "string" || typeof record.mimeType !== "string" || typeof record.size !== "number" || typeof record.kind !== "string" || typeof record.role !== "string") {
      throw new Error("stored reference manifest is invalid");
    }
    return { name: record.name, mimeType: record.mimeType, size: record.size, kind: record.kind as VideoReferenceKind, role: record.role as VideoReferenceRole };
  });
}

export function validateStoredVideoDraftRequest(model: unknown, request: unknown) {
  const value = asRecord(request);
  if (
    typeof model !== "string"
    || typeof value.prompt !== "string"
    || typeof value.effective_prompt !== "string"
    || typeof value.duration !== "number"
    || typeof value.ratio !== "string"
    || typeof value.resolution !== "string"
    || typeof value.watermark !== "boolean"
    || typeof value.generate_audio !== "boolean"
  ) throw new Error("stored video draft is invalid");
  const skillRecord = value.skill === null ? null : asRecord(value.skill);
  const skill = skillRecord && typeof skillRecord.name === "string" && typeof skillRecord.content === "string"
    ? { name: skillRecord.name, content: skillRecord.content }
    : null;
  const validated = validateVideoDraftInput({
    prompt: value.prompt,
    model,
    references: storedReferences(value.reference_manifest),
    duration: value.duration,
    ratio: value.ratio,
    resolution: value.resolution,
    watermark: value.watermark,
    generateAudio: value.generate_audio,
    skill,
  });
  if (
    validated.effectivePrompt !== value.effective_prompt
    || validated.prompt !== value.prompt
    || validated.duration !== value.duration
    || validated.ratio !== value.ratio
    || validated.resolution !== value.resolution
    || validated.watermark !== value.watermark
    || validated.generateAudio !== value.generate_audio
  ) throw new Error("stored video draft snapshot is invalid");
  return validated;
}

export function isCreatorVideoTerminal(status: CreatorTaskStatus) {
  return status === "succeeded" || status === "failed" || status === "expired";
}

export function videoTaskPrefix(userId: string, taskId: string) {
  if (!isSafePathSegment(userId) || !isSafePathSegment(taskId)) throw new Error("invalid task prefix");
  return userId + "/video-tasks/" + taskId;
}
