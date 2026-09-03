const NODE_TITLE_OFFSET = 28;
const NODE_TITLE_CLEARANCE = 8;

// Node titles live in world coordinates just above the node. The hover toolbar
// lives in screen coordinates, so it must include the current zoom scale when
// reserving room for the title; otherwise the toolbar covers the rename target.
export function getNodeToolbarTop(nodeTop: number, viewportScale: number) {
    return nodeTop - NODE_TITLE_OFFSET * viewportScale - NODE_TITLE_CLEARANCE;
}
