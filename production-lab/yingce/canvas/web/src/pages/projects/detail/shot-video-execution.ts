import { resolveShotAssetMentionPrompt, type ShotAssetReferenceContext } from "./workflow-shot-references";

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
export function prepareShotVideoExecution(prompt: string, context: ShotAssetReferenceContext, options: { dialogue?: string; useVoiceSamples?: boolean } = {}) {
    const references = shotGenerationReferenceContext(context, options.useVoiceSamples);
    const resolved = resolveShotAssetMentionPrompt(prompt, references, { dialogue: options.dialogue });
    const boundary = [
        "【本镜头生成边界】",
        "仅演绎上方当前镜头的剧情、动作时间轴与对白。参考素材只负责指定的身份、外观或空间，不从参考素材补写其他集的故事。",
        ...(references.referenceAudios.length ? [
            "音频样本仅用于相应角色的音色、口音与发声质感，不是本镜头的对白或配乐。禁止复述、续写、翻译样本中的台词，禁止复制样本的环境声、音乐和音效。",
            "本镜头实际说出的内容只能来自上方当前镜头明确列出的对白；样本有声音而当前镜头无对白的角色保持无声。",
        ] : []),
    ].join("\n");
    return {
        prompt: [resolved, boundary].join("\n\n"),
        context: references,
        metadata: { mediaPromptSource: "approved-shot", voiceReferenceMode: references.referenceAudios.length ? "timbre-only" : "description-only" },
    };
}
