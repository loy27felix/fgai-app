import { useUserStore } from "@/stores/use-user-store";

// Each image is submitted as its own task. Never send the batch size as provider n.
export function generationBatchLimit(activeTaskLimit: number): number {
    return Math.max(1, Math.min(15, Number.isFinite(activeTaskLimit) ? Math.floor(activeTaskLimit) || 1 : 1));
}

export function currentGenerationBatchLimit(): number {
    return generationBatchLimit(useUserStore.getState().runtimeLimits.activeTaskLimit);
}

export function useGenerationBatchLimit(): number {
    return generationBatchLimit(useUserStore((state) => state.runtimeLimits.activeTaskLimit));
}

export function clampGenerationCount(count: unknown, limit = currentGenerationBatchLimit()): number {
    const value = Number(count);
    return Math.max(1, Math.min(generationBatchLimit(limit), Number.isFinite(value) ? Math.floor(Math.abs(value)) || 1 : 1));
}

/** Multiply a single-task quote without changing its currency or unit. */
export function batchQuoteTotal(perTaskAmount: number, taskCount: number): number {
    return perTaskAmount * Math.max(1, Number.isFinite(taskCount) ? Math.floor(taskCount) || 1 : 1);
}
