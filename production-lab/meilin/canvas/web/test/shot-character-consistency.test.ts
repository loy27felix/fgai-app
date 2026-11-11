import { expect, test } from "bun:test";
import { prepareShotVideoExecution } from "@/pages/projects/detail/shot-video-execution";
import type { ShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";

const context: ShotAssetReferenceContext = {
    mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [],
    assetReferences: [{ assetId: "boss", title: "Boss", category: "character", imageIndex: 1, aliases: ["老板"], identityDescription: "性别：男性；外貌：中年男性", voiceDescription: "成年男声，厚重严肃" }],
};

test("bound male character rejects an invented female identity before video submission", () => {
    expect(() => prepareShotVideoExecution("【参考图绑定】\n人物C：老板。没有已绑定图片。本批锁定为四十多岁女性。\n【声音设计】\n对白：Boss: Keep going.", context)).toThrow("Boss");
});

test("explicit female voice profile conflicts with a bound male voice", () => {
    expect(() => prepareShotVideoExecution("【参考图绑定】\nBoss：中年男性。\n【声音设计】\n声线：BOSS——四十岁女性，中低音。", context)).toThrow("声线");
    expect(() => prepareShotVideoExecution("【参考图绑定】\nBoss：中年男性。\n【声音设计】\n对白：\nBoss: Keep going.\n声线：\nEvan：年轻男声。\n老板：四十多岁女性，中低音。", context)).toThrow("声线");
});

test("another woman's identity and a quoted line cannot change Boss's identity", () => {
    const text = "【参考图绑定】\nBoss：四十岁男性。\nMia：女性。\n【声音设计】\n对白：\nBOSS：“她是女性。”\n声线：BOSS——成年男声；Mia——成年女声。";
    expect(() => prepareShotVideoExecution(text, context)).not.toThrow();
    expect(prepareShotVideoExecution(text, context).prompt).toContain("性别：男性");
});

test("unknown and conflicting source gender is not guessed, and input is not rewritten", () => {
    const text = "【参考图绑定】\n老板：女性。\n【声音设计】\n无对白。";
    const unknown = { ...context, assetReferences: [{ ...context.assetReferences[0], identityDescription: "正文未明确", voiceDescription: "平稳克制" }] };
    expect(prepareShotVideoExecution(text, unknown).prompt.startsWith(text)).toBe(true);
    expect(prepareShotVideoExecution(text, { ...unknown, assetReferences: [{ ...unknown.assetReferences[0], identityDescription: "男性或女性尚待确认" }] }).prompt.startsWith(text)).toBe(true);
});
