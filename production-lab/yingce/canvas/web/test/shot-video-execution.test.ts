import { describe, expect, test } from "bun:test";
import { prepareShotVideoExecution } from "@/pages/projects/detail/shot-video-execution";
import type { ShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";

const context: ShotAssetReferenceContext = {
    mentionReferences: [], referenceImages: [], resolvedCharacterVersions: [],
    referenceAudios: [{ id: "old-episode-voice", name: "角色声音样本", type: "audio/wav", url: "/sample.wav", storageKey: "resource:voice" }],
    assetReferences: [{ assetId: "evan", title: "Evan", category: "character", imageIndex: 1, audioIndex: 1, voiceDescription: "低沉、克制、慢速" }],
};

describe("reviewed shot video execution", () => {
    const characters = ["Mia", "Evan", "Shadow"];
    const cast: ShotAssetReferenceContext = {
        mentionReferences: characters.map(name => ({ id: name, nodeId: "", assetId: name, kind: "character", label: name, title: name, active: true })),
        referenceImages: characters.map(name => ({ id: name, name, type: "image/png", dataUrl: "", storageKey: `resource:${name}` })),
        referenceAudios: characters.map(name => ({ id: name, name, type: "audio/wav", url: "", storageKey: `resource:${name}-voice` })),
        assetReferences: characters.map((name, index) => ({ assetId: name, title: name, category: "character", imageIndex: index + 1, audioIndex: index + 1 })),
        resolvedCharacterVersions: characters.map(name => ({ assetId: name, versionId: `${name}-version` })),
    };
    test("an explicitly remote video caller is bound to the phone screen, not an onsite actor", () => {
        const result = prepareShotVideoExecution("【视频整体概念】\nEvan在餐桌视频通话。\n【参考图绑定】\nMia只在真实视频通话中出现。", cast);
        expect(result.context.referenceImages.map(image => image.id)).toContain("Mia");
        expect(result.prompt).toContain("Mia：图片1（仅用于手机屏幕中的通话影像，不是现场人物）");
        expect(result.prompt).toContain("- Mia：仅手机屏幕内人物外观参考：图片1");
        expect(result.prompt).toContain("不得让其坐在现场对面");
    });
    test("an explicitly limited cast excludes an unmentioned bound character and reindexes images and voices", () => {
        const result = prepareShotVideoExecution("【背景人物活动】\n空间中只有 Evan 与 Shadow。\n【角色参考】\nMia：@[asset:Mia]\nEvan：@[asset:Evan]\nShadow：@[asset:Shadow]", cast, { useVoiceSamples: true });
        expect(result.context.referenceImages.map(image => image.id)).toEqual(["Evan", "Shadow"]);
        expect(result.context.referenceAudios.map(audio => audio.id)).toEqual(["Evan", "Shadow"]);
        expect(result.context.resolvedCharacterVersions.map(reference => reference.assetId)).toEqual(["Evan", "Shadow"]);
        expect(result.prompt).not.toContain("Mia");
        expect(result.prompt).toContain("Evan：图片1");
        expect(result.prompt).toContain("人物参考：图片2；声音参考：音频2");
    });
    test("a text-message-only character contributes neither a body image nor a speaking sample", () => {
        const result = prepareShotVideoExecution("Mia：只以手机消息出现，不出场。Evan拿起手机。", cast, { useVoiceSamples: true });
        expect(result.context.referenceImages.map(image => image.id)).not.toContain("Mia");
        expect(result.context.referenceAudios.map(audio => audio.id)).not.toContain("Mia");
        expect(result.prompt).toContain("Mia：只以手机消息出现，不出场。");
    });
    test("a no-background-people instruction excludes unrelated automatically bound characters", () => {
        const result = prepareShotVideoExecution("【视频整体概念】\nEvan独自在客厅。\n【背景人物活动】\n没有背景人物。", cast);
        expect(result.context.referenceImages.map(image => image.id)).toEqual(["Evan"]);
        expect(result.prompt).not.toContain("Mia：");
        expect(result.prompt).not.toContain("Shadow：");
    });
    test("a character mentioned in a flashback is not removed by the present scene roster", () => {
        const result = prepareShotVideoExecution("空间中只有 Evan 与 Shadow。随后插入 Mia 在街头的回忆。", cast);
        expect(result.context.referenceImages.map(image => image.id)).toContain("Mia");
        expect(cast.referenceImages.map(image => image.id)).toEqual(characters);
    });
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
