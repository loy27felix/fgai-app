import { describe, expect, test } from "bun:test";
import { prepareShotVideoExecution } from "@/pages/projects/detail/shot-video-execution";
import type { ShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";

const context: ShotAssetReferenceContext = {
    mentionReferences: [], referenceImages: [], resolvedCharacterVersions: [],
    referenceAudios: [{ id: "old-episode-voice", name: "角色声音样本", type: "audio/wav", url: "/sample.wav", storageKey: "resource:voice" }],
    assetReferences: [{ assetId: "evan", title: "Evan", category: "character", imageIndex: 1, audioIndex: 1, voiceDescription: "低沉、克制、慢速" }],
};

describe("reviewed shot video execution", () => {
    test("a bound old-episode voice is not automatically sent to each new shot", () => {
        const shots = ["新闻播报", "界面回溯", "风险记录", "更新判断"];
        const results = shots.map(story => prepareShotVideoExecution(`【视频整体概念】\n${story}`, context));
        expect(new Set(results.map(result => result.prompt)).size).toBe(4);
        for (const [index, result] of results.entries()) {
            expect(result.prompt).toContain(shots[index]);
            expect(result.context.referenceAudios).toEqual([]);
            expect(result.prompt).not.toContain("音频1");
            expect(result.prompt).toContain("低沉、克制、慢速");
            expect(result.metadata.voiceReferenceMode).toBe("description-only");
        }
        expect(context.referenceAudios).toHaveLength(1);
        expect(context.assetReferences[0].audioIndex).toBe(1);
    });
    test("explicit voice use binds timbre while excluding sample dialogue and sounds", () => {
        const result = prepareShotVideoExecution("【视频整体概念】\n当前场景", context, { useVoiceSamples: true, dialogue: "Evan: Only this line." });
        expect(result.context.referenceAudios).toHaveLength(1);
        expect(result.prompt).toContain("声音参考：音频1");
        expect(result.prompt).toContain("Only this line.");
        expect(result.prompt).toContain("禁止复述、续写、翻译样本中的台词");
        expect(result.prompt).toContain("禁止复制样本的环境声、音乐和音效");
        expect(result.metadata.voiceReferenceMode).toBe("timbre-only");
    });
    test("the reviewed full prompt and its three timed dialogue lines survive verbatim", () => {
        const prompt = "【视频整体概念】\n当前集\n【声音设计】\n0–3秒 NEWS: Current news.\n10–13秒 Evan: Current response.\n15–18秒 Shadow: Current reply.\n【负面约束】\n不加音乐";
        const result = prepareShotVideoExecution(prompt, context);
        expect(result.prompt.startsWith(prompt)).toBe(true);
        expect(result.prompt).not.toContain("skill-context");
        expect(result.prompt).not.toContain("【用户任务】");
        expect(result.metadata.mediaPromptSource).toBe("approved-shot");
    });
});
