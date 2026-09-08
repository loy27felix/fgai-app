import assert from "node:assert/strict";
import test from "node:test";

import { mergeCanvasDomainData } from "../reference/infinite-canvas/src/services/app-sync";

const project = (id: string, updatedAt = "2026-09-08T00:00:00.000Z") => ({
    id,
    title: id,
    updatedAt,
    createdAt: updatedAt,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines" as const,
    appearance: { backgroundImageOpacity: 0.5, gridOpacity: 0.4 },
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
});

test("a locally deleted canvas cannot be restored from an older WebDAV manifest", () => {
    const merged = mergeCanvasDomainData(
        { projects: [project("keep")], deletedProjectIds: ["deleted"] },
        { projects: [project("keep", "2026-09-07T00:00:00.000Z"), project("deleted")], deletedProjectIds: [] },
    );

    assert.deepEqual(merged.projects.map((item) => item.id), ["keep"]);
    assert.deepEqual(merged.deletedProjectIds, ["deleted"]);
});

test("a remote tombstone removes the canvas on this device and is retained for the next sync", () => {
    const merged = mergeCanvasDomainData(
        { projects: [project("deleted")], deletedProjectIds: [] },
        { projects: [], deletedProjectIds: ["deleted"] },
    );

    assert.deepEqual(merged.projects, []);
    assert.deepEqual(merged.deletedProjectIds, ["deleted"]);
});
