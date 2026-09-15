import type {
  CreateMediaJobInput,
  MediaJobSpec,
  MediaOperation,
  TargetResolution,
  WorkerCapability,
  WorkerSupportContext,
} from "@/types/media-worker";

/** Profiles are deliberately allow-listed so a client cannot select an
 * arbitrary model name and make the Worker download/run unknown code. */
const OPERATION_PROFILES: Record<MediaOperation, readonly string[]> = {
  video_super_resolution: ["basicvsrpp-quality", "realesrgan-sequence-fallback"],
  watermark_removal: ["propainter-mask"],
  audio_separation: ["demucs-v4"],
  subtitle_removal: ["propainter-mask"],
  subject_removal: ["sam2-segmentation"],
};

const SUPER_RESOLUTION_TARGETS: readonly TargetResolution[] = ["1080p", "2k", "4k"];

/** Nominal 16:9 pixel counts used for capability admission. A queue can pass
 * an exact outputPixels value when the source aspect ratio is not 16:9. */
const TARGET_PIXELS: Record<TargetResolution, number> = {
  "720p": 1280 * 720,
  "1080p": 1920 * 1080,
  "2k": 2560 * 1440,
  "4k": 3840 * 2160,
};

export class MediaProcessingValidationError extends Error {
  readonly code = "INVALID_MEDIA_JOB";

  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingValidationError";
  }
}

function requiredText(value: unknown, label: string, maxLength?: number) {
  if (typeof value !== "string") throw new MediaProcessingValidationError(`${label}不能为空`);
  const trimmed = value.trim();
  if (!trimmed) throw new MediaProcessingValidationError(`${label}不能为空`);
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new MediaProcessingValidationError(`${label}不能超过 ${maxLength} 个字符`);
  }
  if (/[\u0000\r\n]/.test(trimmed)) throw new MediaProcessingValidationError(`${label}包含非法字符`);
  return trimmed;
}

function nullableText(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label);
}

function isMediaOperation(value: unknown): value is MediaOperation {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OPERATION_PROFILES, value);
}

function isTargetResolution(value: unknown): value is TargetResolution {
  return value === "720p" || value === "1080p" || value === "2k" || value === "4k";
}

export function supportedProfiles(operation: MediaOperation) {
  return [...OPERATION_PROFILES[operation]];
}

export function targetPixelCount(targetResolution: TargetResolution) {
  return TARGET_PIXELS[targetResolution];
}

/** Validate and normalize user input before it can reach the database. */
export function validateMediaJobInput(input: CreateMediaJobInput): MediaJobSpec {
  if (!input || typeof input !== "object") {
    throw new MediaProcessingValidationError("媒体任务参数无效");
  }

  if (!isMediaOperation(input.operation)) {
    throw new MediaProcessingValidationError("不支持的媒体处理操作");
  }

  const sourceAssetId = requiredText(input.sourceAssetId, "源素材");
  const maskAssetId = nullableText(input.maskAssetId, "遮罩素材");
  const modelProfile = requiredText(input.modelProfile, "模型配置", 128);
  const idempotencyKey = requiredText(input.idempotencyKey, "幂等键", 128);
  const targetResolution = input.targetResolution === undefined || input.targetResolution === null || (input.targetResolution as unknown) === ""
    ? null
    : input.targetResolution;

  if (targetResolution !== null && !isTargetResolution(targetResolution)) {
    throw new MediaProcessingValidationError("不支持的目标分辨率");
  }

  if (!OPERATION_PROFILES[input.operation].includes(modelProfile)) {
    throw new MediaProcessingValidationError(`操作 ${input.operation} 不支持模型配置 ${modelProfile}`);
  }

  if (input.operation === "video_super_resolution") {
    if (!targetResolution || !SUPER_RESOLUTION_TARGETS.includes(targetResolution)) {
      throw new MediaProcessingValidationError("视频超分目标分辨率只能选择 1080p、2k 或 4k");
    }
  } else if (targetResolution !== null) {
    throw new MediaProcessingValidationError("该媒体处理操作不接受目标分辨率");
  }

  if (input.operation === "watermark_removal" && !maskAssetId) {
    throw new MediaProcessingValidationError("去水印必须提供遮罩素材");
  }

  return {
    operation: input.operation,
    sourceAssetId,
    maskAssetId,
    targetResolution,
    modelProfile,
    idempotencyKey,
  };
}

/**
 * Check whether a Worker can accept a job. Empty/missing capability lists are
 * never treated as unlimited. The optional context is used by the queue when
 * it knows the actual source size or output geometry.
 */
export function workerSupportsJob(
  job: Pick<MediaJobSpec, "operation" | "modelProfile" | "targetResolution">,
  capability: WorkerCapability,
  context: WorkerSupportContext = {},
) {
  if (!capability || !Array.isArray(capability.operations) || !capability.operations.includes(job.operation)) return false;
  if (!Array.isArray(capability.modelProfiles) || !capability.modelProfiles.includes(job.modelProfile)) return false;
  if (!Array.isArray(capability.backends) || capability.backends.length === 0) return false;
  if (!Number.isFinite(capability.maxInputBytes) || capability.maxInputBytes <= 0) return false;
  if (!Number.isFinite(capability.maxOutputPixels) || capability.maxOutputPixels <= 0) return false;
  if (context.inputBytes !== undefined && (!Number.isFinite(context.inputBytes) || context.inputBytes < 0 || context.inputBytes > capability.maxInputBytes)) return false;

  if (job.operation === "video_super_resolution") {
    if (!job.targetResolution || !SUPER_RESOLUTION_TARGETS.includes(job.targetResolution)) return false;
    const outputPixels = context.outputPixels ?? targetPixelCount(job.targetResolution);
    if (!Number.isFinite(outputPixels) || outputPixels <= 0 || outputPixels > capability.maxOutputPixels) return false;
  }

  return true;
}
