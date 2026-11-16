import { describe, expect, test } from "bun:test";
import { projectVisualPrompt } from "../src/pages/projects/detail/project-visual-prompt";

describe("scene and prop reference images", () => {
    test("keeps scene details and project style without a character turnaround", () => {
        const prompt = projectVisualPrompt({ name: "雨夜街道", category: "environment", definition: { description: "狭窄街道", lighting: "雨夜霓虹" }, style: "写实电影" });
        for (const value of ["场景环境", "狭窄街道", "雨夜霓虹", "写实电影"]) expect(prompt).toContain(value);
        expect(prompt).not.toContain("三视图");
    });
    test("uses prop instructions and rejects an empty definition", () => {
        expect(projectVisualPrompt({ name: "手机", category: "prop", definition: { description: "银色折叠手机" } })).toContain("道具设定图");
        expect(() => projectVisualPrompt({ name: "手机", category: "prop", definition: {} })).toThrow("先编辑");
    });
});
