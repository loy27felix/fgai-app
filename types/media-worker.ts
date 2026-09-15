/**
 * Shared contracts for durable, user-local media processing jobs.
 *
 * The browser, server queue and Python worker all use the same vocabulary.
 * Keep provider credentials and local filesystem paths out of these types.
 */

export type MediaOperation =
  | "video_super_resolution"
  | "watermark_removal"
  | "audio_separation"
  | "subtitle_removal"
  | "subject_removal";

export type MediaJobStatus =
  | "queued"
  | "leased"
  | "processing"
  | "uploading"
  | "retryable"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkerBackend = "cuda" | "mps" | "cpu";

export type TargetResolution = "720p" | "1080p" | "2k" | "4k";

export type MediaJobSpec = {
  operation: MediaOperation;
  sourceAssetId: string;
  maskAssetId: string | null;
  targetResolution: TargetResolution | null;
  modelProfile: string;
  idempotencyKey: string;
};

export type WorkerCapability = {
  operations: MediaOperation[];
  backends: WorkerBackend[];
  modelProfiles: string[];
  maxInputBytes: number;
  maxOutputPixels: number;
};

export type CreateMediaJobInput = {
  operation: MediaOperation;
  sourceAssetId: string;
  maskAssetId?: string | null;
  targetResolution?: TargetResolution | null;
  modelProfile: string;
  idempotencyKey: string;
};

export type WorkerSupportContext = {
  /** The source asset size. If supplied, it is checked against maxInputBytes. */
  inputBytes?: number;
  /** Optional exact output pixel count when the source aspect ratio is known. */
  outputPixels?: number;
};

