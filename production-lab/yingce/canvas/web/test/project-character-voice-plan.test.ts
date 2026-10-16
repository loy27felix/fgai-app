import { defaultConfig, createModelChannel, modelOptionName } from "../src/stores/use-config-store";
import { characterSeedAudioModel } from "../src/pages/projects/detail/project-character-voice-plan";
import { expect, test } from "bun:test";
import { characterVoiceDirection, characterVoiceSamplePrompt, isCharacterVoiceSampleTask, characterVoiceSampleFromTask } from "../src/pages/projects/detail/project-character-voice-plan";
import type { GenerationTask } from "../src/services/api/task-center";
const task: GenerationTask = {
    id: "voice-task",
    status: "succeeded",
    type: "canvas_audio",
    attempts: 1,
    createdAt: "2026-10-16T01:00:00Z",
    updatedAt: "2026-10-16T01:00:00Z",
    inputJson: JSON.stringify({ metadata: { operation: "character_voice_sample", assetId: "character-a" } }),
    resultJson: JSON.stringify({ mode: "audio", audio: { storageKey: "resource:voice-one", dataUrl: "/api/resources/voice-one/file", mimeType: "audio/mpeg" } }),
};
test("voice prompt inherits direction and locks single-speaker clean dialogue", () => {
    const direction = characterVoiceDirection({ voiceLanguage: "英语", voiceAge: "成年男性", voiceTimbre: "低沉", appearance: "白衣服" });
    const prompt = characterVoiceSamplePrompt("Evan", "I will find you.", direction, "克制、语速偏快");
    expect(prompt).toContain("I will find you.");
    expect(prompt).toContain("英语；成年男性；低沉");
    expect(prompt).toContain("只有该角色一个人说话");
    expect(prompt).toContain("不要旁白、音乐");
    expect(prompt).not.toContain("白衣服");
    expect(() => characterVoiceSamplePrompt("A", " ", "", "")).toThrow("请填写试音台词");
});
test("recovery finds only the same character's audio sample tasks", () => {
    expect(isCharacterVoiceSampleTask(task, "character-a")).toBe(true);
    expect(isCharacterVoiceSampleTask(task, "character-b")).toBe(false);
    expect(isCharacterVoiceSampleTask({ ...task, inputJson: "bad-json" }, "character-a")).toBe(false);
});
test("only persisted successful audio is offered for binding", () => {
    expect(characterVoiceSampleFromTask(task, "Evan")?.resourceId).toBe("voice-one");
    expect(characterVoiceSampleFromTask(task, "Evan")?.name).toBe("Evan-声音样本");
    expect(characterVoiceSampleFromTask({ ...task, status: "running" }, "Evan")).toBeUndefined();
    expect(characterVoiceSampleFromTask({ ...task, resultJson: JSON.stringify({ audio: { dataUrl: "https://provider/temporary.mp3" } }) }, "Evan")).toBeUndefined();
});

test("role voice generation selects Seed Audio from available channels and never silently substitutes music models", () => {
    const config = { ...defaultConfig, channels: [createModelChannel({ id: "voice", models: ["suno-v5", "seed-audio-1.0"], scope: "personal" })] };
    expect(modelOptionName(characterSeedAudioModel(config))).toBe("seed-audio-1.0");
    expect(characterSeedAudioModel({ ...config, channels: [createModelChannel({ models: ["suno-v5"] })] })).toBe("");
});
