import type { CharacterRepresentation } from "@/services/api/projects";

export const COSTUME_TIMELINE_KIND = "character_costume_timeline";
export type CostumeSegment = { startMs: number; endMs: number; role: string; resourceId: string };
export type ShotCostumeTimeline = { kind: typeof COSTUME_TIMELINE_KIND; assetId: string; assetVersionId: string; segments: CostumeSegment[] };

export function shotCostumeTimelines(json = "[]"): ShotCostumeTimeline[] {
    let beats: unknown;
    try { beats = JSON.parse(json || "[]"); } catch {
        if (json.includes(COSTUME_TIMELINE_KIND)) throw new Error("镜头内换装记录格式无效，请重新设置");
        return [];
    }
    if (!Array.isArray(beats)) {
        if (json.includes(COSTUME_TIMELINE_KIND)) throw new Error("镜头内换装记录格式无效，请重新设置");
        return [];
    }
    const plans = beats.filter(beat => beat?.kind === COSTUME_TIMELINE_KIND);
    if (plans.some(plan=>!plan.assetId || !plan.assetVersionId || !Array.isArray(plan.segments) || plan.segments.some((segment:unknown)=>!segment || typeof segment!=="object"))) throw new Error("镜头内换装记录不完整，请重新设置");
    return plans;
}

export function replaceShotCostumeTimeline(json: string | undefined, assetId: string, timeline?: ShotCostumeTimeline) {
    const beats: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(beats)) throw new Error("镜头节拍格式无效，请重新保存镜头");
    return JSON.stringify([...beats.filter(beat => !(beat?.kind === COSTUME_TIMELINE_KIND && beat.assetId === assetId)), ...(timeline ? [timeline] : [])]);
}

export function costumeImage(representations: CharacterRepresentation[], role: string) {
    return role === "reference"
        ? representations.find(item => item.role === "turnaround_sheet") || representations.find(item => item.role === "primary") || representations.find(item => item.role === "front") || representations.find(item => item.mediaType.startsWith("image") && !item.role.startsWith("costume:"))
        : representations.find(item => item.role === role && item.mediaType.startsWith("image"));
}

export function validateShotCostumeTimeline(plan: ShotCostumeTimeline, durationMs: number, versionId: string, representations: CharacterRepresentation[]) {
    if (!plan.assetId || plan.assetVersionId !== versionId) throw new Error("换装计划与当前角色版本不一致，请重新设置本镜头内换装");
    if (!Array.isArray(plan.segments) || plan.segments.length < 2 || plan.segments.length > 12) throw new Error("镜头内换装需要 2–12 个时间段");
    let end = 0;
    const roles = new Set<string>();
    for (const [index, segment] of plan.segments.entries()) {
        if (!Number.isSafeInteger(segment.startMs) || !Number.isSafeInteger(segment.endMs) || segment.startMs !== end || segment.endMs <= segment.startMs || segment.endMs > durationMs) throw new Error(`换装第 ${index + 1} 段时间无效：请从 ${end / 1000} 秒连续安排，不能重叠、留空或超过镜头时长`);
        const image = costumeImage(representations, segment.role);
        if (!image || image.resourceId !== segment.resourceId) throw new Error(`换装第 ${index + 1} 段参考图已变更或不可用，请重新选择，未使用其他图片代替`);
        roles.add(segment.role);
        end = segment.endMs;
    }
    if (end !== durationMs) throw new Error(`换装时间轴需覆盖完整镜头，到 ${durationMs / 1000} 秒结束`);
    if (roles.size < 2) throw new Error("请选择至少两套不同的服装；全程同一造型请使用单套选择");
}
