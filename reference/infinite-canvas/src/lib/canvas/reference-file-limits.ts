type ReferenceFile = Pick<File, "name" | "size" | "type">;

export const CREATOR_IMAGE_REFERENCE_MAX_COUNT = 8;
export const CREATOR_IMAGE_REFERENCE_MAX_BYTES = 7_000_000;
export const CREATOR_IMAGE_REFERENCE_TOTAL_MAX_BYTES = 28_000_000;
export const CREATOR_VIDEO_REFERENCE_MAX_IMAGE_BYTES = 7_000_000;
export const CREATOR_VIDEO_REFERENCE_MAX_VIDEO_BYTES = 200_000_000;
export const CREATOR_VIDEO_REFERENCE_MAX_AUDIO_BYTES = 15_000_000;
export const CREATOR_VIDEO_REFERENCE_TOTAL_MAX_BYTES = 200_000_000;

function labelForFile(file: ReferenceFile, fallback: string) {
    return file.name?.trim() || fallback;
}

function mb(bytes: number) {
    return (bytes / 1_000_000).toFixed(1).replace(/\.0$/, "");
}

function assertPositiveSize(file: ReferenceFile, fallback: string) {
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(`参考素材「${labelForFile(file, fallback)}」读取失败，请重新选择文件后再试`);
}

/**
 * Mirrors the creator image draft API validation in the browser. This runs
 * before a draft/upload begins so users get an actionable file-size message
 * rather than the old generic "图片任务参数无效" card.
 */
export function assertCreatorImageReferenceFiles(files: ReferenceFile[]) {
    if (files.length > CREATOR_IMAGE_REFERENCE_MAX_COUNT) {
        throw new Error(`参考图最多 ${CREATOR_IMAGE_REFERENCE_MAX_COUNT} 张，请移除 ${files.length - CREATOR_IMAGE_REFERENCE_MAX_COUNT} 张后重试`);
    }
    let total = 0;
    files.forEach((file, index) => {
        const name = labelForFile(file, `参考图 ${index + 1}`);
        assertPositiveSize(file, `参考图 ${index + 1}`);
        if (file.size > CREATOR_IMAGE_REFERENCE_MAX_BYTES) {
            throw new Error(`参考图「${name}」为 ${mb(file.size)}MB，单张不能超过 7MB。请压缩或更换图片后重试`);
        }
        total += file.size;
    });
    if (total > CREATOR_IMAGE_REFERENCE_TOTAL_MAX_BYTES) {
        throw new Error(`参考图总大小不能超过 28MB（当前 ${mb(total)}MB）。请减少图片数量或压缩后重试`);
    }
}

/** Same limits and wording as the video draft API, before any reference upload. */
export function assertCreatorVideoReferenceFiles(files: ReferenceFile[]) {
    let total = 0;
    files.forEach((file, index) => {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
        const prefix = kind === "video" ? "参考视频" : kind === "audio" ? "参考音频" : "参考图";
        const limit = kind === "video" ? CREATOR_VIDEO_REFERENCE_MAX_VIDEO_BYTES : kind === "audio" ? CREATOR_VIDEO_REFERENCE_MAX_AUDIO_BYTES : CREATOR_VIDEO_REFERENCE_MAX_IMAGE_BYTES;
        const limitLabel = kind === "video" ? "200MB" : kind === "audio" ? "15MB" : "7MB";
        const name = labelForFile(file, `${prefix} ${index + 1}`);
        assertPositiveSize(file, `${prefix} ${index + 1}`);
        if (file.size > limit) {
            const unit = kind === "image" ? "单张" : "单个";
            throw new Error(`${prefix}「${name}」为 ${mb(file.size)}MB，${unit}不能超过 ${limitLabel}。请压缩或更换素材后重试`);
        }
        total += file.size;
    });
    if (total > CREATOR_VIDEO_REFERENCE_TOTAL_MAX_BYTES) {
        throw new Error(`参考素材总大小为 ${mb(total)}MB，不能超过 200MB。请减少素材数量或压缩后重试`);
    }
}
