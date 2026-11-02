import { expect, test } from "bun:test";
import { splitStoryboardSource, completeStoryboardBatch } from "@/lib/chapter-storyboard-batches";
import { chapterStoryboardFromGenerationTask, chapterStoryboardFromGenerationTasks } from "@/pages/projects/detail/project-chapter-ai";
import type { GenerationTask } from "@/services/api/task-center";

function part(index: number, overrides: Partial<GenerationTask> = {}): GenerationTask {
    return { id: `part-${index}`, projectId: "project", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1,
        createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z",
        clientContext: { chapterId: "chapter", chapterOperation: "storyboard", storyboardBatchId: "batch", batchIndex: index, batchCount: 3 },
        resultJson: JSON.stringify({ text: JSON.stringify({ title: "分镜", rows: [{ shotNumber: 1, plotDescription: `剧情${index}`, durationSeconds: 15 }] }) }), ...overrides };
}
test("long bilingual source is partitioned without losing any character or splitting a surrogate", () => {
    const source = ("人物：春天来临前不要爱上我。\nEVAN: Don't leave. 🌸\n\n").repeat(120);
    const parts = splitStoryboardSource(source);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map(part => part.text).join("")).toBe(source);
    for (const [index, part] of parts.entries()) {
        expect(part.start).toBe(index ? parts[index - 1].end : 0);
        expect(part.text.length).toBeLessThanOrEqual(1200);
        expect(part.text).toBe(source.slice(part.start, part.end));
        expect(part.text.charCodeAt(part.text.length - 1)).not.toBeWithin(0xD800, 0xDC00);
    }
});
test("oversized source is rejected before any provider task can be submitted", () => {
    expect(() => splitStoryboardSource("x".repeat(1200 * 25))).toThrow("尚未提交");
});
test("completed child never imports an incomplete chapter after refresh", () => {
    expect(completeStoryboardBatch(part(1), [part(1)])).toBeNull();
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3, { status: "running" })])).toBeNull();
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3, { status: "failed" })])).toBeNull();
    expect(() => chapterStoryboardFromGenerationTask(part(1))).toThrow("所有批次");
});
test("all parts are merged in source order with unique sequential shot numbers", () => {
    const result = chapterStoryboardFromGenerationTasks([part(3), part(1), part(2)]);
    expect(result.rows.map(row => row.plotDescription)).toEqual(["剧情1", "剧情2", "剧情3"]);
    expect(result.rows.map(row => row.shotNumber)).toEqual([1, 2, 3]);
});
test("same-id tasks from other projects and chapters cannot complete a batch", () => {
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3, { projectId: "other" })])).toBeNull();
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3, { clientContext: { ...part(3).clientContext, chapterId: "other" } })])).toBeNull();
});
test("duplicate or newer failed attempts cannot satisfy missing parts", () => {
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(2)])).toBeNull();
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3), part(3, { status: "failed", createdAt: "2026-10-22T01:00:00Z" })])).toBeNull();
});
test("successful status with malformed content still cannot replace the chapter", () => {
    expect(() => chapterStoryboardFromGenerationTasks([part(1), part(2), part(3, { resultJson: JSON.stringify({ text: '{"rows":[{"plotDescription":"unfinished' }) })])).toThrow("分镜结果不完整");
});
test("unrelated malformed batch context does not crash chapter recovery", () => {
    const unrelated = part(4, { clientContext: { storyboardBatchId: "other", batchIndex: -1, batchCount: 0 } });
    expect(completeStoryboardBatch(part(1), [part(1), part(2), part(3), unrelated])?.length).toBe(3);
});
