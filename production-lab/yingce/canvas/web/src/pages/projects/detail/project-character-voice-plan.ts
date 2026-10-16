import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";

export function characterSeedAudioModel(config: AiConfig) {
    const models = selectableModelsByCapability(config, "audio");
    return models.find((model) => modelOptionName(model) === "seed-audio-1.0") ?? models.find((model) => modelOptionName(model).startsWith("seed-audio-")) ?? "";
}
export function characterVoiceDirection(definition: Record<string, unknown>) {
    return [definition.voiceLanguage, definition.voiceAge, definition.voiceTimbre, definition.voiceDelivery, definition.personality].filter((value) => typeof value === "string" && value.trim()).join("；");
}
export function characterVoiceSamplePrompt(name: string, dialogue: string, direction: string, instructions: string) {
    if (!dialogue.trim()) throw new Error("请填写试音台词");
    return [
        `为角色“${name}”生成一段可用于后续角色声音参考的单人干净对白。`,
        `声音特征：${direction.trim() || "自然、清晰，符合角色身份"}。`,
        `表演要求：${instructions.trim() || "自然口语，音量稳定，避免夸张播音腔"}。`,
        "只有该角色一个人说话，不要旁白、音乐、环境音、音效、其他人物或开场介绍。不要朗读声音特征和表演说明，只说下面的台词，台词原文与语言保持不变。",
        `试音台词：${dialogue.trim()}`,
    ].join("\n");
}
export function isCharacterVoiceSampleTask(task: GenerationTask, assetId: string) {
    if (task.clientContext?.characterVoiceAssetId) return task.clientContext.characterVoiceAssetId === assetId;
    try {
        const metadata = JSON.parse(task.inputJson || "{}").metadata;
        return metadata?.operation === "character_voice_sample" && metadata.assetId === assetId;
    } catch {
        return false;
    }
}
export function characterVoiceSampleFromTask(task: GenerationTask, name: string) {
    if (task.status !== "succeeded") return undefined;
    const result = parseBackendGenerationResult(task);
    const audio = result.audio || result.audios?.[0];
    const resourceId = resourceIdFromStorageKey(audio?.storageKey);
    return resourceId ? { resourceId, name: `${name}-声音样本`, url: resourceFileUrl(resourceId) } : undefined;
}
