import { expect, test } from "bun:test";
import { projectAssetExecutionPrompt, projectAssetGenerationPrompt, projectAssetReferencePlan, runAssetBatch } from "../src/pages/projects/detail/project-asset-generation-plan";
import type { StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import type { ProjectAsset } from "../src/services/api/projects";
const asset = { id: "evan", title: "Evan", category: "character", definition: { appearance: "28岁白人男性，棕色短发" } } as ProjectAsset;
test("a supporting character does not silently inherit the protagonist's style portrait", () => {
    const evan = { ...asset, character: { representations: [{ resourceId: "evan-portrait" }] } } as ProjectAsset;
    const investigator = { ...asset, id: "investigator", title: "调查人员" };
    const profile = { assets: [{ kind: "reference", status: "validated", referenceResourceIds: ["evan-portrait", "palette"] }] } as StyleProfileSnapshot;
    const plan = projectAssetReferencePlan(investigator, [], profile, [evan, investigator]);
    expect(plan.ids).toEqual(["palette"]);
    expect(plan.excluded).toEqual([{ id: "evan-portrait", name: "Evan" }]);
    expect(projectAssetReferencePlan(evan, [], profile, [evan]).ids).toContain("evan-portrait");
    expect(projectAssetReferencePlan(investigator, ["evan-portrait"], profile, [evan]).ids).toContain("evan-portrait");
    expect(profile.assets[0].referenceResourceIds).toContain("evan-portrait");
});
test("asset prompts preserve explicit identity and unstructured global style", () => {
    const prompt = projectAssetGenerationPrompt(asset, "美国纽约，真人心理悬疑电影，蓝灰雨夜");
    expect(prompt).toContain("28岁白人男性");
    expect(prompt).toContain("美国纽约");
    expect(prompt).toContain("蓝灰雨夜");
    expect(prompt).not.toContain("一位年轻中国");
    expect(prompt).toContain("正面、右侧面、背面");
});
test("saved editable prompt is the generation prompt until explicitly rebuilt", () => {
    const edited = { ...asset, definition: { ...asset.definition, generationPrompt: "我的已确认提示词" } };
    expect(projectAssetGenerationPrompt(edited, "新风格")).toBe("我的已确认提示词");
    expect(projectAssetGenerationPrompt(edited, "新风格", true)).toContain("新风格");
});
test("static asset draft excludes voice configuration and empty extraction placeholders", () => {
    const prompt = projectAssetGenerationPrompt({ ...asset, definition: { ...asset.definition, clothing: "深蓝工作夹克", voiceAge: "低沉青年男声", voiceTimbre: "沙哑气声", name: "Evan", personality: "正文未明确" } }, "手绘二维动画，统一线条和纸张颗粒");
    expect(prompt).toContain("深蓝工作夹克");
    expect(prompt).not.toContain("沙哑气声");
    expect(prompt).not.toContain("voiceAge");
    expect(prompt).not.toContain("正文未明确");
    expect(prompt).not.toContain("人物哑光皮肤");
});
test("execution binds latest project style even when an edited saved prompt contains old style", () => {
    const prompt = projectAssetExecutionPrompt("主播坐在电脑前，慢慢后拉；旧画风：3D卡通", "environment", "真人恐怖电影，冷灰蓝色，细腻胶片颗粒");
    expect(prompt).toContain("真人恐怖电影，冷灰蓝色，细腻胶片颗粒");
    expect(prompt).toContain("无人空镜");
    expect(prompt).toContain("不得把剧情动作、对白、声音和运镜画成图像");
    expect(prompt).toContain("不把项目中的某个默认地点、人物或光源复制到所有资产");
    expect(prompt.lastIndexOf("真人恐怖电影")).toBeGreaterThan(prompt.indexOf("旧画风"));
});
test("style-only references never dictate asset identity", () => {
    const prompt = projectAssetExecutionPrompt("角色设定", "character", "二维水彩动画");
    expect(prompt).toContain("画风参考仅约束媒介、色板、光影和材质");
    expect(prompt).toContain("非人角色");
    expect(prompt).toContain("真人项目");
});
test("changing global style replaces generated execution rules while keeping user edits", () => {
    const old = projectAssetExecutionPrompt("保留深蓝工作夹克", "character", "旧全局画风");
    const updated = projectAssetExecutionPrompt(old + "\n用户补充：银色戒指", "character", "新全局画风");
    expect(updated).not.toContain("旧全局画风");
    expect(updated).toContain("新全局画风");
    expect(updated).toContain("保留深蓝工作夹克");
    expect(updated).toContain("用户补充：银色戒指");
    expect(updated.match(/【本次静态资产执行规则】/g)).toHaveLength(1);
    expect(projectAssetExecutionPrompt(updated, "character", "新全局画风")).toBe(updated);
});
test("bounded batch reports partial failures and never resubmits a failed operation", async () => {
    let active = 0,
        maximum = 0;
    const called: number[] = [];
    const results: number[] = [];
    await runAssetBatch(
        [1, 2, 3, 4],
        async (item) => {
            called.push(item);
            active++;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active--;
            if (item === 2) throw Error("unknown submit");
        },
        (item, error) => results.push(error ? -item : item),
    );
    expect(maximum).toBeLessThanOrEqual(2);
    expect(called.sort()).toEqual([1, 2, 3, 4]);
    expect(results).toContain(-2);
    expect(results).toContain(4);
});
