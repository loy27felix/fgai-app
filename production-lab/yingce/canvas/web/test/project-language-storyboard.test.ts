import { expect, test } from "bun:test";
import { chapterStoryboardFromGenerationTask } from "@/pages/projects/detail/project-chapter-ai";
import { originalEnglishDialogue } from "@/services/api/project-language";
import type { GenerationTask } from "@/services/api/task-center";
const original = "迪伦：别碰那根弦。\nDylan: Don't touch that string.";
function task(dialogue: string, performed = dialogue): GenerationTask {
    return { id: "task", projectId: "project", type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "", updatedAt: "",
        inputJson: JSON.stringify({ metadata: { projectLanguagePolicy: { version: 1, spoken: "en-original", screenText: "no-zh" }, originalEnglishDialogue: originalEnglishDialogue(original) } }),
        resultJson: JSON.stringify({ text: JSON.stringify({ rows: [{ durationSeconds: 15, plotDescription: "迪伦制止对方", dialogue, characters: [], assetBindings: [], videoMotionPrompt: `【声音设计】\n对白：\n${performed}` }] }) }),
    };
}
test("chapter import keeps original English and refuses newly translated or mismatched performed lines", () => {
    const english = "Dylan: Don't touch that string.";
    expect(chapterStoryboardFromGenerationTask(task(english)).rows[0].dialogue).toBe(english);
    expect(() => chapterStoryboardFromGenerationTask(task("迪伦：别碰那根弦。"))).toThrow("原稿英文");
    expect(() => chapterStoryboardFromGenerationTask(task(english, "Dylan: Please keep your hands off the string."))).toThrow("原英文");
});
