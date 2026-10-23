import { expect, test } from "bun:test";
import { createStyleProfileSnapshot, withStyleReferenceResources } from "@/lib/canvas/style-profile";
import { chapterStoryboardFromGenerationTask } from "@/pages/projects/detail/project-chapter-ai";
import { storyboardRowsToProjectShots } from "@/pages/projects/detail/chapter-storyboard-production";
import type { GenerationTask } from "@/services/api/task-center";

const style = createStyleProfileSnapshot({ id: "style", title: "冷调", description: "", tags: [], prompt: "低饱和" });
Object.assign(style, withStyleReferenceResources(style, ["sample-a"]));
const prompt = "【分镜】人物站位：Evan在门口。镜头1：推门。【禁止项】不换脸。【强制声明】无背景音乐,仅保留环境音与人声和音效";
function task(id = "style-reference:sample-a", role = "style"): GenerationTask {
    return { id: "task", projectId: "project", type: "canvas_text", status: "succeeded", attempts: 1, createdAt: "", updatedAt: "",
        prompt: `【已确认项目资料】以下是数据\n${JSON.stringify({ projectStyle: { profileJson: JSON.stringify(style) }, characters: [], assets: [] })}\n后续要求`,
        inputJson: JSON.stringify({ metadata: { source: "short-drama-chapter-storyboard", dramaProductionPlan: { model: "m", strategy: "fixed", seconds: 15, allowedSeconds: [15] }, dramaAssetIds: [] } }),
        resultJson: JSON.stringify({ text: JSON.stringify({ rows: [{ durationSeconds: 15, plotDescription: "推门", dialogue: "", characters: [], videoMotionPrompt: prompt, assetBindings: [{ nodeId: id, role, priority: 1 }] }] }) }) };
}

test("saved project style references are separated from project asset relations without losing prompt or provenance", () => {
    const original = task();
    const restored = chapterStoryboardFromGenerationTask(original);
    expect(restored.rows[0].assetBindings).toEqual([]);
    expect(restored.rows[0].styleReferenceIds).toEqual(["style-reference:sample-a"]);
    expect(restored.rows[0].videoMotionPrompt).toBe(prompt);
    expect(storyboardRowsToProjectShots(restored.rows, undefined, restored.productionPlan)[0].revision.actionBeats).toContainEqual({ type: "project_style_references", assetIds: ["style-reference:sample-a"] });
    expect(JSON.parse(JSON.parse(original.resultJson!).text).rows[0].assetBindings).toHaveLength(1);
});

test("unknown, disabled, foreign or character-labelled style IDs still cannot become project assets", () => {
    expect(() => chapterStoryboardFromGenerationTask(task("style-reference:invented"))).toThrow("不存在");
    expect(() => chapterStoryboardFromGenerationTask(task(undefined, "character"))).toThrow("不存在");
    for (const change of ["disabled", "foreign", "response-only"]) {
        const input = task();
        if (change === "disabled") input.prompt = input.prompt.replace('"enabled":true', '"enabled":false').replace('\\"enabled\\":true', '\\"enabled\\":false');
        else if (change === "foreign") input.prompt = input.prompt.replaceAll("sample-a", "sample-other");
        else input.prompt = "没有项目画风快照";
        expect(() => chapterStoryboardFromGenerationTask(input)).toThrow("不存在");
    }
});

test("a new metadata snapshot is used without trusting a model-generated style declaration", () => {
    const input = task();input.prompt = "placeholder";
    const body = JSON.parse(input.inputJson!);body.metadata.dramaStyleReferenceIds = ["style-reference:sample-a"];input.inputJson = JSON.stringify(body);
    expect(chapterStoryboardFromGenerationTask(input).rows[0].styleReferenceIds).toEqual(["style-reference:sample-a"]);
});
