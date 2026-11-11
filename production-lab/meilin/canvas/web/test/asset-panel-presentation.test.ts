import { expect, test } from "bun:test";
import { assetPanelPresentation } from "@/lib/canvas/asset-panel-presentation";
import type { EntityAsset } from "@/stores/use-asset-store";
const role: EntityAsset = { id: "role", title: "Evan", kind: "entity", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { definition: {}, coverStorageKey: "resource:turnaround" } };
test("canvas side panel uses the current character resource, rather than mistaking an empty payload cover for unsynced media", () => {
    expect(assetPanelPresentation(role)).toMatchObject({ storageKey: "resource:turnaround", status: "形象已就绪", insertable: true });
    expect(assetPanelPresentation({ ...role, data: { definition: {} } }).status).toBe("形象待完善");
    expect(assetPanelPresentation({ ...role, coverUrl: "/existing-cover.png", data: { definition: {} } }).cover).toBe("/existing-cover.png");
});
