import { expect, test } from "bun:test";
import { chapterStoryboardFromGenerationTask, chapterStoryboardFromGenerationTasks } from "@/pages/projects/detail/project-chapter-ai";
import { originalEnglishDialogue } from "@/services/api/project-language";
import type { GenerationTask } from "@/services/api/task-center";
const original = "迪伦：别碰那根弦。\nDylan: Don't touch that string.";
function task(dialogue: string, performed = dialogue): GenerationTask {
    return { id: "task", projectId: "project", type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "", updatedAt: "",
        inputJson: JSON.stringify({ metadata: { projectLanguagePolicy: { version: 1, spoken: "en-original", screenText: "no-zh" }, originalEnglishDialogue: originalEnglishDialogue(original) } }),
        resultJson: JSON.stringify({ text: JSON.stringify({ rows: [{ durationSeconds: 15, plotDescription: "迪伦制止对方", dialogue, characters: [], assetBindings: [], videoMotionPrompt: `【声音设计】\n对白：\n${performed}` }] }) }),
    };
}
test("chapter import recovers source translations and derives performed lines from original English", () => {
    const english = "Dylan: Don't touch that string.";
    expect(chapterStoryboardFromGenerationTask(task(english)).rows[0].dialogue).toBe(english);
    expect(chapterStoryboardFromGenerationTask(task("迪伦：别碰那根弦。")).rows[0].dialogue).toBe("Dylan：Don't touch that string.");
    const repaired=chapterStoryboardFromGenerationTask(task(english, "Dylan: Please keep your hands off the string.")).rows[0];
    expect(repaired.videoMotionPrompt).toContain(english);expect(repaired.videoMotionPrompt).not.toContain("Please keep");
    expect(()=>chapterStoryboardFromGenerationTask(task("Dylan: A newly invented line."))).toThrow();
});

test("only explicitly reviewed saved imports may accept an authored video line over the original script",()=>{
    const value=task("Dylan: Don't touch that string.","Dylan: Stay here.");
    expect(chapterStoryboardFromGenerationTasks([value]).rows[0].videoMotionPrompt).not.toContain("Stay here.");
    const reviewed=chapterStoryboardFromGenerationTasks([value],{reviewedDialogue:true});
    expect(reviewed.rows[0].videoMotionPrompt).toContain("Dylan: Stay here.");
    expect(value.resultJson).toContain("Stay here.");
});

test("English import distinguishes inline voice and action/timing directions from spoken lines", () => {
    const english = "Dylan: Don't touch that string.";
    const performed = `动作音：椅子轻响。\n声线设定：Dylan，成年男性，平静低声。\n对白时段：3—8秒。\n${english}`;
    expect(chapterStoryboardFromGenerationTask(task(english, performed)).rows[0].dialogue).toBe(english);
    expect(chapterStoryboardFromGenerationTask(task(english, performed.replace("Don't touch", "Please touch"))).rows[0].videoMotionPrompt).toContain(english);
    expect(chapterStoryboardFromGenerationTask(task(english, `声线设定（单独列出）：\n${english}`)).rows[0].videoMotionPrompt).toContain("对白：");
});
