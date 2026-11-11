import { expect, test } from "bun:test";
import { runChapterBatch } from "../src/pages/projects/detail/chapter-batch-runner";

test("a third chapter failure keeps its error and continues all remaining selected chapters once", async () => {
    const submitted: string[] = [];
    const outcomes = await runChapterBatch(["a", "b", "c", "d", "e"], {
        stopped: () => false,
        process: async id => { submitted.push(id); if (id === "c") throw Error("original task still recoverable"); return "completed"; },
    });
    expect(submitted).toEqual(["a", "b", "c", "d", "e"]);
    expect(outcomes.map(item => item.status)).toEqual(["completed", "completed", "failed", "completed", "completed"]);
    expect(outcomes[2].error).toBe("original task still recoverable");
});

test("explicit stop finishes the current chapter and leaves later chapters unsubmitted", async () => {
    let stopped = false;
    const outcomes = await runChapterBatch(["a", "b", "c"], {
        stopped: () => stopped,
        process: async id => { if (id === "b") stopped = true; return id === "a" ? "skipped" : "completed"; },
    });
    expect(outcomes.map(item => item.id)).toEqual(["a", "b"]);
});
