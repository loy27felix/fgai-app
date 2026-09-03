export type CanvasAppearance = {
    /** Private creator-assets object key. It is resolved through the content proxy at render time. */
    backgroundImagePath?: string;
    /** Opacity of the uploaded background image, from 0 to 1. */
    backgroundImageOpacity: number;
    /** Opacity of the movable dots/lines overlay, from 0 to 1. */
    gridOpacity: number;
};

export const DEFAULT_CANVAS_APPEARANCE: CanvasAppearance = {
    backgroundImageOpacity: 0.72,
    gridOpacity: 0.4,
};

function clamp(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** Normalises local persistence and remote graph payloads without persisting data/blob URLs. */
export function normalizeCanvasAppearance(input?: Partial<CanvasAppearance> | null): CanvasAppearance {
    const path = typeof input?.backgroundImagePath === "string" && input.backgroundImagePath.trim().length > 0 && input.backgroundImagePath.length <= 1024
        ? input.backgroundImagePath.trim()
        : undefined;
    return {
        ...(path ? { backgroundImagePath: path } : {}),
        backgroundImageOpacity: clamp(input?.backgroundImageOpacity, DEFAULT_CANVAS_APPEARANCE.backgroundImageOpacity),
        gridOpacity: clamp(input?.gridOpacity, DEFAULT_CANVAS_APPEARANCE.gridOpacity),
    };
}
