export type ChapterBatchOutcome = { id: string; status: "completed" | "skipped" | "failed"; error?: string };

/** Each chapter owns its task and failure; never retry an ambiguous submission here. */
export async function runChapterBatch(ids: readonly string[], options: {
    stopped: () => boolean;
    process: (id: string, index: number) => Promise<"completed" | "skipped">;
    onOutcome?: (outcome: ChapterBatchOutcome) => void;
}) {
    const outcomes: ChapterBatchOutcome[] = [];
    for (const [index, id] of [...ids].entries()) {
        if (options.stopped()) break;
        let outcome: ChapterBatchOutcome;
        try { outcome = { id, status: await options.process(id, index) }; }
        catch (error) { outcome = { id, status: "failed", error: error instanceof Error ? error.message : "章节处理失败" }; }
        outcomes.push(outcome);
        options.onOutcome?.(outcome);
    }
    return outcomes;
}
