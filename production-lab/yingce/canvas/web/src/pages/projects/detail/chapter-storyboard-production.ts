import type { StoryboardRow } from "@/types/canvas";
import { formatShotOrdinal } from "@/lib/shot-label";
import { listProjectAssetsPage, type ProjectAsset, type ProjectDetail, type ShotRevisionInput } from "@/services/api/projects";
import { ensureShotAssetMentionPrompt, inferShotVisualAssets, shotNarrativeText } from "./workflow-shot-references";
import type { DramaProductionPlan } from "@/lib/short-drama-production";

export type ChapterStoryboardAsset = {
    id: string;
    title: string;
    type: "image" | "video" | "audio" | "character";
    category?: string;
    tags: string[];
    prompt: string;
    characterAssetId?: string;
    characterVersionId?: string;
};

export type ChapterStoryboardCharacter = {
    assetId?: string;
    versionId?: string;
    name: string;
    definition: Record<string, unknown>;
};

export type ProjectShotReplacementInput = {
    title: string;
    description: string;
    durationMs: number;
    revision: ShotRevisionInput;
    assetVersionIds: string[];
};

export type ChapterStoryboardReplaceImpact = {
    shotCount: number;
    revisionCount: number;
    referenceCount: number;
    artifactCount: number;
    candidateCount: number;
};

export async function loadChapterStoryboardAssets(projectId: string): Promise<ProjectAsset[]> {
    const assets = new Map<string, ProjectAsset>();
    for (let page = 1; ; page++) {
        const result = await listProjectAssetsPage(projectId, { page, pageSize: 100 });
        const previous = assets.size;
        for (const asset of result.assets) assets.set(asset.id, asset);
        if (!result.hasMore && assets.size >= result.total) return [...assets.values()];
        if (!result.hasMore || assets.size === previous) throw new Error("项目资产清单读取不完整，尚未提交生成，请重试");
    }
}

export function chapterStoryboardCharacters(detail: ProjectDetail, unitId?: string): ChapterStoryboardCharacter[] {
    const confirmed = detail.assets.flatMap((asset): ChapterStoryboardCharacter[] => {
        const card = asset.character;
        if (asset.category !== "character" || !card?.versionId) return [];
        return [{ assetId: asset.id, versionId: card.versionId, name: asset.title, definition: card.definition || {} }];
    });
    const seenNames = new Set(confirmed.map((character) => normalizeCharacterName(character.name)));
    const pending = detail.assetCandidates.flatMap((candidate): ChapterStoryboardCharacter[] => {
        if (candidate.category !== "character" || candidate.status !== "pending_confirmation") return [];
        if (unitId && candidate.unitId && candidate.unitId !== unitId) return [];
        const name = candidate.name.trim();
        const normalizedName = normalizeCharacterName(name);
        if (!normalizedName || seenNames.has(normalizedName)) return [];
        seenNames.add(normalizedName);
        return [{ name, definition: candidateDefinition(candidate.detailsJson) }];
    });
    return [...confirmed, ...pending];
}

export function chapterStoryboardAssets(detail: ProjectDetail): ChapterStoryboardAsset[] {
    return detail.assets.flatMap((asset): ChapterStoryboardAsset[] => {
        const type = storyboardAssetType(asset.mediaType, asset.category);
        if (!type || (type !== "character" && !asset.primaryVersionId)) return [];
        const characterVersionId = asset.character?.versionId;
        if (type === "character" && !characterVersionId) return [];
        return [{
            id: asset.id,
            title: asset.title,
            type,
            category: asset.category || undefined,
            tags: [],
            prompt: assetPrompt(asset.previewText, asset.character?.definition, asset.title),
            ...(type === "character" ? { characterAssetId: asset.id, characterVersionId } : {}),
        }];
    }).sort((a, b) => storyboardAssetPriority(a) - storyboardAssetPriority(b)).slice(0, 60);
}

function storyboardAssetPriority(asset: ChapterStoryboardAsset) {
    return asset.type === "character" ? 0 : asset.category === "environment" || asset.category === "prop" ? 1 : 2;
}

export function storyboardRowsToProjectShots(rows: StoryboardRow[], detail?: ProjectDetail, productionPlan?: DramaProductionPlan, referenceChoices?: Record<number, string[]>): ProjectShotReplacementInput[] {
    const versionByAssetId = new Map((detail?.assets || []).flatMap((asset) => asset.primaryVersionId ? [[asset.id, asset.primaryVersionId] as const] : []));
    const mentionReferenceByAssetId = new Map((detail?.assets || []).map((asset) => [asset.id, {
        assetId: asset.id,
        kind: asset.category === "character" ? "character" as const : "image" as const,
        label: asset.title,
        title: asset.title,
    }]));
    return rows.map((row, index) => {
        const shotNumber = index + 1;
        const description = row.plotDescription.trim() || `镜头 ${shotNumber}`;
        const durationMs = Math.max(1000, Math.round((Number(row.durationSeconds) || 1) * 1000));
        const referencePlan = detail ? storyboardRowReferencePlan(row, detail.assets) : undefined;
        if (referencePlan?.missingIds.length && !referenceChoices?.[index]) throw new Error(`片段 ${shotNumber} 有已失效参考，请先核对当前项目资产再导入`);
        const assetIds = referenceChoices?.[index] || referencePlan?.selectedIds || storyboardRowAssetIds(row);
        if (assetIds.length > 6) throw new Error(`片段 ${shotNumber} 匹配到 ${assetIds.length} 项参考资产，请核对并精简到 6 项以内`);
        const mentionReferences = assetIds.flatMap((assetId) => {
            const reference = mentionReferenceByAssetId.get(assetId);
            return reference ? [reference] : [];
        });
        return {
            title: formatShotOrdinal(index),
            description,
            durationMs,
            assetVersionIds: assetIds.flatMap((assetId) => versionByAssetId.get(assetId) ? [versionByAssetId.get(assetId)!] : []),
            revision: {
                plotDescription: description,
                action: joinStoryboardAction(row),
                dialogue: row.dialogue.trim(),
                shotSize: row.shotSize.trim(),
                cameraAngle: row.camera.trim(),
                cameraMovement: row.motion.trim(),
                durationMs,
                imagePrompt: row.imageGenerationPrompt.trim(),
                videoPrompt: ensureShotAssetMentionPrompt(row.videoMotionPrompt, mentionReferences),
                negativePrompt: row.negativePrompt.trim(),
                continuityNotes: row.continuityOut.trim(),
                actionBeats: [
                    ...(row.sourceTask ? [{ type: "chapter_storyboard_import", ...row.sourceTask }] : []),
                    ...(referencePlan?.describedOnly.length ? [{ type: "described_assets_without_reference", assetIds: referencePlan.describedOnly.map(asset => asset.id) }] : []),
                    ...(referenceChoices?.[index] ? [{ type: "reviewed_reference_selection", assetIds, candidateAssetIds: referencePlan?.candidates.map(asset => asset.id) }] : []),
                    ...(row.timeBeats.trim() ? [{ description: row.timeBeats.trim() }] : []),
                    ...(productionPlan ? [{ type: "drama_video_segment", productionPlan }] : []),
                    ...(row.styleReferenceIds?.length ? [{ type: "project_style_references", assetIds: row.styleReferenceIds }] : []),
                ],
            },
        };
    });
}

export function chapterStoryboardReplaceImpact(detail: ProjectDetail, unitId: string): ChapterStoryboardReplaceImpact {
    const shots = detail.shots.filter((shot) => shot.unitId === unitId);
    const shotIds = new Set(shots.map((shot) => shot.id));
    return {
        shotCount: shots.length,
        revisionCount: detail.shotRevisions.filter((revision) => shotIds.has(revision.shotId)).length,
        referenceCount: detail.shotReferences.filter((reference) => shotIds.has(reference.shotId)).length,
        artifactCount: detail.shotArtifacts.filter((artifact) => artifact.unitId === unitId).length,
        candidateCount: detail.assetCandidates.filter((candidate) => Boolean(candidate.shotId && shotIds.has(candidate.shotId))).length,
    };
}

function storyboardRowAssetIds(row: StoryboardRow) {
    return Array.from(new Set([
        ...row.assetBindings.map((binding) => binding.nodeId),
        ...row.characters.flatMap((character) => character.characterAssetId ? [character.characterAssetId] : []),
    ]));
}

/** Preserve the model's explicit bindings; only infer optional props into unused slots.
 * A name mentioned in reference/voice/negative notes cannot add another actor. */
export function storyboardRowReferencePlan(row: StoryboardRow, assets: ProjectAsset[]) {
    const explicit = storyboardRowAssetIds(row);
    const known = new Set(assets.map(asset => asset.id));
    const missingIds = explicit.filter(id => !known.has(id));
    const narrative = [row.plotDescription, shotNarrativeText(row.videoMotionPrompt), row.performanceBlocking, ...row.characters.map(character => character.characterName)].join("\n");
    const inferred = inferShotVisualAssets(assets, narrative);
    const required = [...new Set([...explicit.filter(id => known.has(id)), ...inferred.filter(asset => asset.category === "character").map(asset => asset.id)])];
    const selectedIds = [...required];
    const describedOnly: ProjectAsset[] = [];
    for (const asset of inferred) {
        if (selectedIds.includes(asset.id)) continue;
        if (selectedIds.length < 6) selectedIds.push(asset.id);
        else describedOnly.push(asset);
    }
    return { selectedIds, describedOnly, missingIds, needsReview: required.length > 6 || missingIds.length > 0, candidates: missingIds.length ? assets : assets.filter(asset => selectedIds.includes(asset.id) || describedOnly.some(item => item.id === asset.id)) };
}

function storyboardAssetType(mediaType: string, category: string): ChapterStoryboardAsset["type"] | null {
    if (category === "character") return "character";
    if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return mediaType;
    return null;
}

function assetPrompt(previewText: string | undefined, definition: Record<string, unknown> | undefined, title: string) {
    const preview = previewText?.replace(/\s+/g, " ").trim();
    if (preview) return preview.slice(0, 600);
    if (definition && Object.keys(definition).length) return JSON.stringify(definition).slice(0, 600);
    return title.trim();
}

function candidateDefinition(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function normalizeCharacterName(value: string) {
    return value.trim().toLocaleLowerCase();
}

function joinStoryboardAction(row: StoryboardRow) {
    return [
        labeledText("叙事意图", row.narrativeIntent),
        labeledText("表演调度", row.performanceBlocking),
        labeledText("时间节拍", row.timeBeats),
        labeledText("情绪", row.emotion),
        labeledText("光线与氛围", row.lightingAndAtmosphere),
        labeledText("声音", row.audioEffects),
    ].filter(Boolean).join("\n");
}

function labeledText(label: string, value: string) {
    const text = value.trim();
    return text ? `${label}：${text}` : "";
}
