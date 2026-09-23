export const PRODUCTION_LAB_DEMO_STATE_KEY = "fg-production-lab-v0-demo-1";
export const PRODUCTION_LAB_ACTIVE_PROJECT_PREFIX = "fg-production-lab-active-v1";
export const PRODUCTION_LAB_LEGACY_CANVAS_KEY = "fg-lab-canvas-concept-v1";

export function projectCanvasStorageKey(actorId: string, projectId: string, episode: number) {
  return `fg-lab-canvas-v2:${actorId}:${projectId}:ep-${episode}`;
}

export function projectCanvasRecoveryStorageKey(actorId: string, projectId: string, episode: number) {
  return `fg-lab-canvas-recovery-v1:${actorId}:${projectId}:ep-${episode}`;
}

export function activeProjectStorageKey(actorId: string) {
  return `${PRODUCTION_LAB_ACTIVE_PROJECT_PREFIX}:${actorId}`;
}

export function scriptComparisonStorageKey(actorId: string, projectId: string) {
  return `fg-lab-script-comparison-v2:${actorId}:${projectId}`;
}

export function assetLibraryStorageKey(actorId: string, projectId: string) {
  return `assets:${actorId}:${projectId || "unassigned"}`;
}
