import { expect, test } from "bun:test";
import { groupWorkbenchTasks, planWorkbenchBatch } from "../src/pages/workbench/workbench-batches";
import type { GenerationTask } from "../src/services/api/task-center";

test("batch submission respects a model's output limit and never creates a redundant remainder task", () => {
    expect(planWorkbenchBatch("image", 5, 4)).toEqual([4, 1]);
    expect(planWorkbenchBatch("image", 8, 4)).toEqual([4, 4]);
    expect(planWorkbenchBatch("video", 3, 4)).toEqual([1, 1, 1]);
});

test("polling receipts and refreshed task lists cannot duplicate the same billed work in a gallery batch", () => {
    const task = (id: string, index: number): GenerationTask => ({ id, createdAt: "2026-11-01T00:00:00Z", clientContext: { batchId: "batch", batchIndex: index, batchCount: 2 } } as GenerationTask);
    const first = task("first", 0), second = task("second", 1);
    const groups = groupWorkbenchTasks([second, first, { ...first }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((item) => item.id)).toEqual(["first", "second"]);
    expect(groups[0].expectedTasks).toBe(2);
});
