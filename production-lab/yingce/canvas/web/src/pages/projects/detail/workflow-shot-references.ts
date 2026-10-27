import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assetCategoryLabel, normalizeAssetCategory } from "@/lib/asset-category";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { CharacterRepresentation, ProjectAsset, ProjectDetail, ShotAssetReference } from "@/services/api/projects";
import type { AssetCategory } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";
import { shotCostumeTimelines, validateShotCostumeTimeline } from "./shot-costume-timeline";

export type ShotAssetReferenceContext = {
    mentionReferences: CanvasResourceReference[];
    referenceImages: ReferenceImage[];
    referenceAudios: ReferenceAudio[];
    assetReferences: ShotPromptAssetReference[];
    resolvedCharacterVersions: Array<{ assetId: string; versionId: string }>;
    costumeTimelineError?: string;
    costumeDurationMs?: number;
};

export type ShotPromptAssetReference = {
    assetId: string;
    title: string;
    category: string;
    imageIndex: number;
    audioIndex?: number;
    voiceDescription?: string;
    identityDescription?: string;
    costumeDescription?: string;
    costumeRole?: string;
    costumeTimeRanges?: Array<{ startMs: number; endMs: number }>;
    aliases?: string[];
    dialogue?: string;
    visualUsage?: "screen-only";
};

function assetNames(asset: ProjectAsset): string[] {
    const definition = asset.character?.definition || asset.definition || {};
    const aliases = normalizeAssetCategory(asset.category) === "character" ? definition.aliases : [];
    return [...new Set([asset.title, ...(Array.isArray(aliases) ? aliases.filter((name): name is string => typeof name === "string") : typeof aliases === "string" ? aliases.split(/[、,，;；]/) : [])]
        .map(name => name.trim().normalize("NFKC").toLocaleLowerCase()).filter(name => name.length >= 2))];
}

function namePattern(name: string, global = false) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(/^[a-z0-9 .'-]+$/i.test(name) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped, global ? "gi" : "i");
}

function matchingAssetNames(assets: ProjectAsset[], text: string) {
    const names = new Map<string, ProjectAsset[]>();
    for (const asset of assets) {
        for (const name of assetNames(asset)) names.set(name, [...(names.get(name) || []).filter(item => item.id !== asset.id), asset]);
    }
    const normalized = text.normalize("NFKC").toLocaleLowerCase();
    return [...names].filter(([name]) => namePattern(name).test(normalized));
}

/** Full names and confirmed aliases only; an ambiguous alias never chooses an arbitrary face. */
export function inferShotVisualAssets(assets: ProjectAsset[], text: string, explicitIds: string[] = []): ProjectAsset[] {
    const matched = new Map<string, ProjectAsset>();
    for (const id of explicitIds) {
        const asset = assets.find((item) => item.id === id);
        if (asset) matched.set(id, asset);
    }
    for (const [, candidates] of matchingAssetNames(assets.filter(asset => ["character", "environment", "prop"].includes(normalizeAssetCategory(asset.category))), text)) {
        if (candidates.length !== 1) continue;
        const asset = candidates[0];
        if (asset.primaryVersionId && ["ready", "confirmed"].includes(asset.status) && projectAssetReferenceImage(asset)) matched.set(asset.id, asset);
    }
    return [...matched.values()];
}

/** Reference lists and voice notes cannot claim that a character is on screen. */
export function shotNarrativeText(prompt: string) {
    const blocks = prompt.split(/(?=【[^】]+】)/u);
    const timelines = blocks.filter(block => /^【[^】]*(?:分镜.*时间轴|动作时间轴)[^】]*】/u.test(block));
    const relevant = timelines.length ? timelines : blocks.filter(block => !/^【[^】]*(?:参考|资产|声音|声线|对白|台词|负面|约束|画风)[^】]*】/u.test(block));
    return relevant.join("\n");
}

export function assertShotCharacterCoverage(prompt: string, context: ShotAssetReferenceContext, assets: ProjectAsset[], excludedIds: string[] = []) {
    const characters = assets.filter(asset => normalizeAssetCategory(asset.category) === "character" && !excludedIds.includes(asset.id));
    let text = shotNarrativeText(prompt);
    // Explicitly absent and voice-only mentions do not require a visible body.
    for (const asset of characters) for (const name of assetNames(asset)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`${escaped}\\s*[：:]?\\s*(?:不出场|不入镜|不在本镜|不出现|仅画外音|只以(?:手机)?消息出现|[（(]V\\.?O\\.?[)）])`, "gi"), "");
    }
    const bound = new Set(context.assetReferences.filter(ref => normalizeAssetCategory(ref.category) === "character").map(ref => ref.assetId));
    const missing = new Set<string>();
    for (const [name, candidates] of matchingAssetNames(characters, text)) {
        if (candidates.length > 1) {
            if (candidates.filter(asset => bound.has(asset.id)).length !== 1) throw new Error(`角色别名“${name}”对应多个资产，请先人工确认角色参考，未提交视频生成`);
        } else if (!bound.has(candidates[0].id)) missing.add(candidates[0].title);
    }
    if (missing.size) throw new Error(`本镜头出现的角色未绑定参考图：${[...missing].join("、")}。请点击“重新匹配资产”并确认角色图片，未提交视频生成`);
}

export function stableShotReferences(references: ShotAssetReference[]) {
    return references.slice().sort((a, b) => ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) || String(a.id || a.assetVersionId || "").localeCompare(String(b.id || b.assetVersionId || "")));
}

export function buildShotAssetReferenceContext(detail: ProjectDetail, shotId: string): ShotAssetReferenceContext {
    const assetByVersionId = new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset]));
    const seenAssetIds = new Set<string>();
    const baseEntries = stableShotReferences(detail.shotReferences || []).flatMap((reference) => {
        if (reference.shotId !== shotId || reference.status !== "linked") return [];
        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
        if (!asset || seenAssetIds.has(asset.id)) return [];
        const image = projectAssetReferenceImage(asset, reference);
        if (!image) return [];
        seenAssetIds.add(asset.id);
        return [{ asset, image, reference }];
    });
    const shot = detail.shots?.find(item => item.id === shotId);
    const revision = detail.shotRevisions?.find(item => item.id === shot?.currentRevisionId);
    const durationMs = revision?.durationMs || shot?.durationMs || 0;
    let costumeTimelineError: string | undefined;
    let costumeDurationMs: number | undefined;
    type Entry = typeof baseEntries[number] & { timeRanges?: Array<{ startMs: number; endMs: number }> };
    let entries: Entry[] = baseEntries;
    try {
        const plans = shotCostumeTimelines(revision?.actionBeatsJson);
        const plannedAssets = new Set<string>();
        for (const plan of plans) {
            if (plannedAssets.has(plan.assetId)) throw new Error("同一角色有重复的换装计划，请重新设置");
            plannedAssets.add(plan.assetId);
            const entry = baseEntries.find(item => item.asset.id === plan.assetId);
            if (!entry?.asset.character) throw new Error("换装计划的角色已取消绑定，请重新设置或移除本镜头内换装");
            validateShotCostumeTimeline(plan, durationMs, entry.reference.assetVersionId, entry.reference.referencedVersion?.representations || entry.asset.character.representations);
        }
        entries = baseEntries.flatMap(entry => {
            const plan = plans.find(item => item.assetId === entry.asset.id);
            if (!plan) return [entry];
            costumeDurationMs = durationMs;
            const roles = [...new Set(plan.segments.map(segment => segment.role))];
            return roles.map((role, index) => {
                const reference = { ...entry.reference, role };
                const image = projectAssetReferenceImage(entry.asset, reference)!;
                return { ...entry, reference, image: { ...image, id: index ? `${entry.asset.id}:${role}` : entry.asset.id }, timeRanges: plan.segments.filter(segment => segment.role === role).map(({startMs,endMs}) => ({startMs,endMs})) };
            });
        });
    } catch (error) {
        costumeTimelineError = error instanceof Error ? error.message : "镜头内换装设置无效，请重新设置";
    }

    const referenceAudios: ReferenceAudio[] = [];
    const audioIndexByResourceId = new Map<string, number>();
    const assetReferences = entries.map(({ asset, reference, timeRanges }, index) => {
        const costume = reference.role.startsWith("costume:") ? reference.referencedVersion?.representations.find(item => item.role === reference.role) : undefined;
        const sampleResourceId = stringValue(asset.character?.voice?.profile.sampleResourceId);
        let audioIndex: number | undefined;
        if (sampleResourceId) {
            audioIndex = audioIndexByResourceId.get(sampleResourceId);
            if (!audioIndex) {
                audioIndex = referenceAudios.length + 1;
                audioIndexByResourceId.set(sampleResourceId, audioIndex);
                referenceAudios.push({
                    id: `project-character-voice:${asset.id}`,
                    name: `${asset.title}-声音样本`,
                    type: "audio/*",
                    url: resourceFileUrl(sampleResourceId),
                    storageKey: resourceStorageKey(sampleResourceId),
                });
            }
        }
        return {
            assetId: asset.id,
            title: asset.title,
            category: asset.category,
            ...(costume ? { costumeDescription: [costume.metadata?.name, costume.metadata?.clothing].filter(Boolean).join("：") } : {}),
            ...(timeRanges ? { costumeTimeRanges: timeRanges, costumeRole: reference.role, costumeDescription: costume ? [costume.metadata?.name, costume.metadata?.clothing].filter(Boolean).join("：") : "默认形象" } : {}),
            imageIndex: index + 1,
            ...(audioIndex ? { audioIndex } : {}),
            ...(asset.character ? { voiceDescription: characterVoiceDescription(asset) } : {}),
            ...(asset.character ? {
                identityDescription: [asset.character.definition?.gender, asset.character.definition?.appearance, asset.character.definition?.physique].map(stringValue).filter(Boolean).join("；"),
                aliases: Array.isArray(asset.character.definition?.aliases) ? asset.character.definition.aliases.filter((name): name is string => typeof name === "string" && Boolean(name.trim())) : stringValue(asset.character.definition?.aliases).split(/[、,，;]/).map(name => name.trim()).filter(Boolean),
            } : {}),
        } satisfies ShotPromptAssetReference;
    });

    return {
        ...(costumeTimelineError ? { costumeTimelineError } : {}),
        ...(costumeDurationMs ? { costumeDurationMs } : {}),
        mentionReferences: entries.filter((entry,index) => entries.findIndex(item => item.asset.id === entry.asset.id) === index).map(({ asset, image }) => ({
            id: `project-asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind: asset.character ? "character" : "image",
            label: asset.title,
            title: asset.title,
            previewUrl: image.url,
            storageKey: image.storageKey,
            active: true,
            category: projectAssetCategory(asset.category),
        })),
        referenceImages: entries.map(({ image }) => image),
        referenceAudios,
        assetReferences,
        resolvedCharacterVersions: baseEntries.flatMap(({ asset, reference }) => asset.character ? [{ assetId: asset.id, versionId: reference.referencedVersion?.id || reference.assetVersionId || asset.character.versionId }] : []),
    };
}

export function resolveShotAssetMentionPrompt(prompt: string, context: ShotAssetReferenceContext, options: { dialogue?: string } = {}) {
    if (context.costumeTimelineError) throw new Error(context.costumeTimelineError);
    const screenOnly = new Set(context.assetReferences.filter(reference => reference.visualUsage === "screen-only").map(reference => reference.assetId));
    const imageLabelByAssetId = new Map(context.mentionReferences.map(reference => [reference.assetId, `图片${context.assetReferences.find(item=>item.assetId===reference.assetId)?.imageIndex}${screenOnly.has(reference.assetId || "") ? "（仅用于手机屏幕中的通话影像，不是现场人物）" : ""}`]));
    const unresolved = new Set<string>();
    const resolved = prompt.replace(/@\[asset:([^\]]+)\]/g, (token, assetId: string) => {
        const label = imageLabelByAssetId.get(assetId);
        if (!label) {
            unresolved.add(token);
            return token;
        }
        return label;
    });
    if (unresolved.size) throw new Error(`提示词中的 ${Array.from(unresolved).join("、")} 未绑定到当前镜头，请重新选择资产或删除引用`);
    if (resolved.trim().startsWith("【分镜】")) {
        const mediaBindings = context.assetReferences.map(reference => `${reference.title}${reference.aliases?.length ? `（同一角色别名：${reference.aliases.join("、")}）` : ""}身份或外观只参考图片${reference.imageIndex}，不与其他参考互换${reference.audioIndex ? `，音色参考音频${reference.audioIndex}` : ""}`).join("；");
        const compact = mediaBindings ? resolved.trim().replace("人物站位：", `人物站位：${mediaBindings}。`) : resolved.trim();
        return context.costumeDurationMs ? [compact, compileShotAssetReferencePrompt(context.assetReferences)].join("\n\n") : compact;
    }
    const dialogueContext = withShotDialogue(context.assetReferences, options.dialogue);
    const assetBlock = compileShotAssetReferencePrompt(dialogueContext.references);
    const dialogueBlock = dialogueContext.unassignedDialogue ? `【镜头台词】\n\n${dialogueContext.unassignedDialogue}` : "";
    return [resolved.trim(), assetBlock, dialogueBlock].filter(Boolean).join("\n\n");
}

export function ensureShotAssetMentionPrompt(prompt: string, references: Array<Pick<CanvasResourceReference, "assetId" | "kind" | "label" | "title">>) {
    const bound = new Set(references.flatMap(reference => reference.assetId ? [reference.assetId] : []));
    // Remove only canonical reference tokens and their generated standalone lines.
    // Authored action, dialogue and names remain intact after deselection.
    const value = prompt.split(/\r?\n/).flatMap(line => {
        const tokens = [...line.matchAll(/@\[asset:([^\]]+)\]/g)];
        if (tokens.length === 1 && !bound.has(tokens[0][1]) && /^[^：:\n]+[：:]\s*@\[asset:[^\]]+\]\s*$/.test(line.trim())) return [];
        return [line.replace(/@\[asset:([^\]]+)\]/g, (token, id: string) => bound.has(id) ? token : "")];
    }).join("\n").replace(/【(?:角色参考|场景与道具参考)】\s*(?=【|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!value) return "";
    const mentionedAssetIds = new Set(Array.from(value.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]));
    const missing = references.filter((reference): reference is typeof reference & { assetId: string } => Boolean(reference.assetId && !mentionedAssetIds.has(reference.assetId)));
    if (!missing.length) return value;
    if (value.startsWith("【分镜】")) return value.replace("人物站位：", `人物站位：${missing.map(reference => `${reference.title || reference.label}参考@[asset:${reference.assetId}]`).join("；")}。`);
    const block = (title: string, items: typeof missing) => items.length
        ? [title, ...items.map((reference) => `${reference.title || reference.label}：@[asset:${reference.assetId}]`)].join("\n")
        : "";
    const characters = missing.filter((reference) => reference.kind === "character");
    const otherAssets = missing.filter((reference) => reference.kind !== "character");
    return [value, block("【角色参考】", characters), block("【场景与道具参考】", otherAssets)].filter(Boolean).join("\n\n");
}

export function compileShotAssetReferencePrompt(references: ShotPromptAssetReference[]) {
    if (!references.length) return "";
    const lines = references.flatMap((reference) => {
        const visualLabel = reference.visualUsage === "screen-only" ? "仅手机屏幕内人物外观参考" : reference.category === "character" ? "人物参考" : `${projectAssetCategoryLabel(reference.category)}参考`;
        const media = [`${visualLabel}：图片${reference.imageIndex}`, reference.audioIndex ? `声音参考：音频${reference.audioIndex}` : ""].filter(Boolean).join("；");
        return [
            `- ${reference.title}：${media}`,
            reference.category === "character" ? `  身份对应：${[reference.title, ...(reference.aliases || [])].join("、")}指同一角色，只从图片${reference.imageIndex}继承面部身份、发型、体态${reference.costumeTimeRanges ? "；此角色多张造型图是同一演员在不同时间的服装，不增加分身，服装仅按下方时间范围切换" : "和服装"}；多人同屏、遮挡或切镜后仍保持各自身份，不混用其他角色或场景图中的脸。` : ["environment", "prop"].includes(normalizeAssetCategory(reference.category)) ? "  此图仅提供该场景或道具参考，不提供演员身份，不从中增加出场人物。" : "",
            reference.identityDescription ? `  已确认人物设定：${reference.identityDescription}` : "",
            reference.costumeDescription ? `  ${reference.costumeTimeRanges ? `使用时段：${reference.costumeTimeRanges.map(range=>`${range.startMs/1000}–${range.endMs/1000}秒`).join("、")}；本时段` : "本镜头"}服装造型：${reference.costumeDescription}。服装与配饰以此参考图为准，保持该角色面部身份和声音，不套用其他造型的衣服。` : "",
            reference.voiceDescription ? `  声音画像：${reference.voiceDescription}` : "",
            reference.dialogue ? `  镜头台词：${reference.dialogue}` : "",
        ].filter(Boolean);
    });
    return ["【资产参考】", "", ...lines].join("\n");
}

export function projectAssetReferenceImage(asset: ProjectAsset, reference?: ShotAssetReference): ReferenceImage | undefined {
    const boundRepresentations = reference?.referencedVersion?.representations || [];
    const costume = reference?.role.startsWith("costume:");
    const representation = costume ? boundRepresentations.find(item => item.role === reference?.role) : preferredVisualRepresentation(boundRepresentations)
        || (asset.character ? preferredVisualRepresentation(asset.character.representations) : undefined);
    if (costume && !representation) throw new Error(`${asset.title}的所选服装图片不可用，请重新选择造型；未使用其他图片代替`);
    if (representation) {
        return {
            id: asset.id,
            name: asset.title,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(representation.resourceId),
            storageKey: resourceStorageKey(representation.resourceId),
        };
    }
    if (asset.mediaType !== "image" || !asset.storageKey) return undefined;
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return {
        id: asset.id,
        name: asset.title,
        type: "image/*",
        dataUrl: "",
        ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}),
        storageKey: asset.storageKey,
    };
}

function preferredVisualRepresentation(representations: CharacterRepresentation[]) {
    return representations.find((item) => item.role === "turnaround_sheet")
        || representations.find((item) => item.role === "primary")
        || representations.find((item) => item.role === "front")
        || representations.find((item) => item.mediaType.startsWith("image") && !item.role.startsWith("costume:"));
}

function withShotDialogue(references: ShotPromptAssetReference[], dialogue?: string) {
    const value = stringValue(dialogue);
    if (!value) return { references, unassignedDialogue: "" };
    const characters = references.filter((reference,index) => reference.category === "character" && references.findIndex(item=>item.assetId===reference.assetId)===index);
    if (characters.length === 1) {
        return {
            references: references.map((reference,index) => reference.assetId === characters[0]?.assetId && references.findIndex(item=>item.assetId===reference.assetId)===index ? { ...reference, dialogue: value } : reference),
            unassignedDialogue: "",
        };
    }
    const resolved = references.map((reference,index) => {
        if (reference.category !== "character") return reference;
        if (references.findIndex(item=>item.assetId===reference.assetId)!==index) return reference;
        const matched = dialogueForCharacter(value, reference.title);
        return matched ? { ...reference, dialogue: matched } : reference;
    });
    return {
        references: resolved,
        unassignedDialogue: resolved.some((reference) => reference.dialogue) ? "" : value,
    };
}

function dialogueForCharacter(dialogue: string, characterName: string) {
    const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[：:]\\s*([^\\n]+)`, "g");
    return Array.from(dialogue.matchAll(pattern), (match) => match[1]?.trim()).filter(Boolean).join("；");
}

function projectAssetCategory(value: string): AssetCategory {
    return normalizeAssetCategory(value);
}

function projectAssetCategoryLabel(value: string) {
    return assetCategoryLabel(value);
}

function characterVoiceDescription(asset: ProjectAsset) {
    const definition = asset.character?.definition || {};
    const voice = asset.character?.voice;
    return [
        stringValue(definition.voiceGender) || stringValue(definition.gender),
        stringValue(definition.voiceLanguage) || stringValue(voice?.profile.language),
        stringValue(definition.voiceAge),
        stringValue(definition.voiceTimbre) || stringValue(voice?.profile.timbre),
        stringValue(voice?.instructions),
    ].filter(Boolean).join("；");
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
