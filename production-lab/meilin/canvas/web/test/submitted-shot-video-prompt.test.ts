import { expect, test } from "bun:test";
import { projectLanguageTaskInput } from "@/services/api/project-language";

test("the frontend task boundary preserves a submitted shot video prompt verbatim", async () => {
    const body = { projectId: "a".repeat(32), type: "canvas_video", prompt: "手改片段。全程无对白。", input: { mode: "video", prompt: "手改片段。全程无对白。", metadata: { shotId: "shot", projectLanguagePolicy: { version: 1, spoken: "en-original", screenText: "no-zh" }, artifactMetadata: { actualPrompt: "手改片段。全程无对白。" } } } };
    expect(await projectLanguageTaskInput(body)).toBe(body);
});
