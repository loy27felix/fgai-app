// A conservative transport target, not a claim about any provider's exact limit.
export const SHOT_REFERENCE_TOTAL_TARGET = 8 * 1024 * 1024;
export function shotReferenceByteTarget(count: number) {
    return Math.min(2 * 1024 * 1024, Math.floor(SHOT_REFERENCE_TOTAL_TARGET / Math.max(1, count)));
}
export function imageTransferDimensions(width: number, height: number, maxSide: number) {
    if (!(width > 0 && height > 0 && width * height <= 64_000_000)) throw new Error("参考图尺寸无效或超过 6400 万像素");
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
