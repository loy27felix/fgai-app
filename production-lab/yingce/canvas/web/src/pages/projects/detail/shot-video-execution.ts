import { assertShotCharacterCoverage, ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt, type ShotAssetReferenceContext } from "./workflow-shot-references";
import type { ProjectAsset } from "@/services/api/projects";

function explicitGender(value = "") {
    const male = /男性|男声|\bmale\b/i.test(value), female = /女性|女声|\bfemale\b/i.test(value);
    return male === female ? undefined : male ? "男性" : "女性";
}

function assertCharacterConsistency(prompt: string, context: ShotAssetReferenceContext) {
    const binding = prompt.split("【参考图绑定】")[1]?.split(/【[^】]+】/)[0] || "";
    const sound = prompt.split("【声音设计】")[1]?.split(/【[^】]+】/)[0] || "";
    const voiceLines: string[] = [];
    let inVoiceProfile = false;
    for (const line of sound.split(/\r?\n/)) {
        if (/^\s*对白/.test(line)) inVoiceProfile = false;
        if (/^\s*(?:基础)?声线/.test(line) || /声线[：:]/.test(line)) inVoiceProfile = true;
        if (inVoiceProfile) voiceLines.push(line.replace(/^\s*(?:基础)?声线(?:设定)?[：:]\s*/, ""));
    }
    for (const reference of context.assetReferences.filter(item => item.category === "character")) {
        const aliases = [reference.title, ...(reference.aliases || [])].filter(Boolean).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        const cue = new RegExp(`^(?:人物[A-ZＡ-Ｚ][：:]\\s*)?(?:${aliases})(?:声线)?(?:[（(][^）)]*[）)])?\\s*[：:。—-]+\\s*([^\\n；;]*)`, "i");
        const expectedIdentity = explicitGender(reference.identityDescription);
        const expectedVoice = explicitGender(reference.voiceDescription);
        const profiles = voiceLines.join("\n");
        for (const [text, expected, kind] of [[binding, expectedIdentity, "人物设定"], [profiles, expectedVoice, "声线"]] as const) {
            if (!expected) continue;
            for (const line of text.split(/[\r\n；;]/)) {
                const declared = explicitGender(line.trim().match(cue)?.[1]);
                if (declared && declared !== expected) throw new Error(`${reference.title} 的${kind}冲突：已绑定设定为${expected}，视频提示词却写成${declared}。请先修改提示词或角色设定，尚未提交生成。`);
            }
        }
    }
}

/** Only explicit authored restrictions may remove a reference; absence alone is not evidence. */
export function shotSceneReferenceContext(prompt: string, context: ShotAssetReferenceContext): ShotAssetReferenceContext {
    // These trailing blocks are generated from bindings and cannot prove presence in the story.
    const story = prompt.split(/【(?:角色参考|场景与道具参考|资产参考|镜头台词)】/)[0];
    const roster = story.match(/空间中只有([^。\n]+)/)?.[1];
    const containsName = (text: string, reference: ShotAssetReferenceContext["assetReferences"][number]) => {
        const names = [reference.title, reference.title.replace(/^(?:Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+/i, ""), ...(reference.aliases || [])];
        return names.some(value => {
            const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, "i").test(text);
        });
    };
    const rosterRecognized = Boolean(roster && context.assetReferences.some(reference => reference.category === "character" && containsName(roster, reference)));
    const noExtraCast = /【背景人物活动】\s*(?:没有|无)背景人物/.test(story)
        && context.assetReferences.some(reference => reference.category === "character" && containsName(story, reference));
    const kept = context.assetReferences.flatMap(reference => {
        if (reference.category !== "character") return [reference];
        const clauses = story.split(/[。\n]/).filter(line => containsName(line, reference));
        const textOnly = clauses.some(line => /(?<!不)(?:只|仅).{0,12}(?:手机消息|文字消息|短信)/.test(line));
        const excludedByRoster = (rosterRecognized || noExtraCast) && !containsName(story, reference);
        if (textOnly || excludedByRoster) return [];
        const screenOnly = clauses.some(line => /(?:只|仅).{0,24}(?:视频通话|手机屏幕|通话画面)/.test(line));
        return [{ ...reference, ...(screenOnly ? { visualUsage: "screen-only" as const } : {}) }];
    });
    const imageIndices = [...new Set(kept.map(reference => reference.imageIndex))].sort((a, b) => a - b);
    const audioIndices = [...new Set(kept.flatMap(reference => reference.audioIndex ? [reference.audioIndex] : []))].sort((a, b) => a - b);
    const assetIds = new Set(kept.map(reference => reference.assetId));
    return {
        ...context,
        mentionReferences: context.mentionReferences.filter(reference => assetIds.has(reference.assetId || "")),
        referenceImages: imageIndices.flatMap(index => context.referenceImages[index - 1] ? [context.referenceImages[index - 1]] : []),
        referenceAudios: audioIndices.flatMap(index => context.referenceAudios[index - 1] ? [context.referenceAudios[index - 1]] : []),
        assetReferences: kept.map(reference => ({ ...reference, imageIndex: imageIndices.indexOf(reference.imageIndex) + 1, ...(reference.audioIndex ? { audioIndex: audioIndices.indexOf(reference.audioIndex) + 1 } : {}) })),
        resolvedCharacterVersions: context.resolvedCharacterVersions.filter(reference => assetIds.has(reference.assetId)),
    };
}

/** A character voice binding is not consent to reuse the sample's spoken script. */
export function shotGenerationReferenceContext(context: ShotAssetReferenceContext, useVoiceSamples = false): ShotAssetReferenceContext {
    if (useVoiceSamples) return context;
    return {
        ...context,
        referenceAudios: [],
        assetReferences: context.assetReferences.map(({ audioIndex: _audioIndex, ...reference }) => reference),
    };
}

/** Media models receive the reviewed shot, never the instructions used to write it. */
export function prepareShotVideoExecution(prompt: string, context: ShotAssetReferenceContext, options: { dialogue?: string; useVoiceSamples?: boolean; projectAssets?: ProjectAsset[] } = {}) {
    const references = shotGenerationReferenceContext(shotSceneReferenceContext(prompt, context), options.useVoiceSamples);
    if (options.projectAssets) assertShotCharacterCoverage(prompt, references, options.projectAssets, context.assetReferences.filter(ref => !references.assetReferences.some(selected => selected.assetId === ref.assetId)).map(ref => ref.assetId));
    assertCharacterConsistency(prompt, references);
    const scopedPrompt = ensureShotAssetMentionPrompt(prompt, references.mentionReferences);
    const resolved = resolveShotAssetMentionPrompt(scopedPrompt, references, { dialogue: options.dialogue });
    const boundary = [
        "【本镜头生成边界】",
        "仅演绎上方当前镜头的剧情、动作时间轴与对白。参考素材只负责指定的身份、外观或空间，不从参考素材补写其他集的故事。",
        ...references.assetReferences.filter(reference => reference.visualUsage === "screen-only").map(reference => `${reference.title}只存在于手机屏幕内部的视频通话画面，参考图片${reference.imageIndex}仅锁定屏幕内的脸。不得让其坐在现场对面、出现在同一房间、进入现场双人镜头或拥有现场身体投影；其声音始终来自手机扬声器。`),
        ...(references.referenceAudios.length ? [
            "音频样本仅用于相应角色的音色、口音与发声质感，不是本镜头的对白或配乐。禁止复述、续写、翻译样本中的台词，禁止复制样本的环境声、音乐和音效。",
            "本镜头实际说出的内容只能来自上方当前镜头明确列出的对白；样本有声音而当前镜头无对白的角色保持无声。",
        ] : []),
    ].join("\n");
    return {
        prompt: [resolved, boundary].join("\n\n"),
        context: references,
        metadata: {
            mediaPromptSource: "approved-shot",
            voiceReferenceMode: references.referenceAudios.length ? "timbre-only" : "description-only",
            referenceAssetIds: references.assetReferences.map(reference => reference.assetId),
            referenceManifest: references.assetReferences.map(reference => ({
                assetId: reference.assetId, title: reference.title, category: reference.category, imageIndex: reference.imageIndex,
                assetVersionId: references.resolvedCharacterVersions.find(item => item.assetId === reference.assetId)?.versionId,
                storageKey: references.referenceImages[reference.imageIndex - 1]?.storageKey,
                visualUsage: reference.visualUsage || "on-screen",
            })),
            excludedReferenceAssetIds: context.assetReferences.filter(reference => !references.assetReferences.some(selected => selected.assetId === reference.assetId)).map(reference => reference.assetId),
        },
    };
}
