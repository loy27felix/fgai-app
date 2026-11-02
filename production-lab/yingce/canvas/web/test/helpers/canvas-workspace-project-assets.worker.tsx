import { mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { strict as assert } from "node:assert";
const window = new Window({ url: "http://localhost/canvas/project-canvas" });
for (const name of ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node", "ShadowRoot", "MutationObserver", "ResizeObserver", "getComputedStyle"])
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : (window as any)[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const requests: any[] = [],
    inserts: any[] = [];
let failProject = false;
const card = { assetId: "evan", versionId: "v4", definition: {}, visualStatus: "ready", voiceStatus: "empty", representations: [{ id: "sheet", resourceId: "current-sheet", mediaType: "image", role: "turnaround_sheet" }] };
const character = { id: "evan", title: "Evan", category: "character", mediaType: "entity", status: "confirmed", versionCount: 4, usages: [], position: 0, updatedAt: "", character: card };
mock.module("@/services/api/projects", () => ({
    listProjectAssetsPage: async (id: string, options: any) => {
        requests.push({ projectId: id, ...options });
        if (failProject) throw new Error("No access");
        return {
            assets: id === "empty" ? [] : options.category === "character" ? [character] : [{ ...character, id: "frame", title: "分镜图", category: "material", mediaType: "image", storageKey: "resource:frame", character: undefined }],
            total: id === "empty" ? 0 : 1,
            hasMore: false,
        };
    },
    getProjectCharacter: async (id: string, assetId: string) => {
        requests.push({ detailProject: id, assetId });
        return { asset: character, character: { ...card, versionId: "v5" } };
    },
}));
mock.module("@/services/user-data-sync", () => ({
    loadAssetLibraryPage: async (options: any) => {
        requests.push({ personal: true, ...options });
        return { assets: [{ id: "medusa", title: "美杜莎", kind: "image", category: "character", data: { dataUrl: "/medusa.png" } }], total: 1 };
    },
}));
mock.module("@/components/canvas/asset-picker-modal", () => ({
    externalAssetToInsertPayload: () => {
        throw new Error("No external assets");
    },
    assetPickerSelectionToInsertPayloads: async () => {
        throw new Error("Project character must not use the personal character endpoint");
    },
}));
mock.module("@/components/cached-resource-image", () => ({ CachedResourceImage: (props: any) => <img src={props.src} data-storage={props.storageKey} alt={props.alt} /> }));
mock.module("@/components/assets/asset-library-picker-modal", () => ({ AssetLibraryPickerModal: () => null }));
const { useUserStore } = await import("../../src/stores/use-user-store");
useUserStore.setState({ hydrated: true, user: { id: "admin" } as any });
const { CanvasWorkspaceAssetPanel } = await import("../../src/components/canvas/canvas-workspace-asset-panel");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const render = async (id?: string) =>
    act(async () => {
        root.render(
            <App>
                <QueryClientProvider client={client}>
                    <CanvasWorkspaceAssetPanel
                        key={id}
                        domainProjectId={id}
                        onInsert={async (rows) => {
                            inserts.push(...rows);
                        }}
                        onManage={() => {}}
                    />
                </QueryClientProvider>
            </App>,
        );
    });
const settle = async () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
    });
await render("story");
await settle();
await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === "角色")!.click();
});
await settle();
assert.equal(requests.at(-1).projectId, "story");
assert(host.textContent!.includes("Evan"));
assert(!host.textContent!.includes("美杜莎"));
assert.equal(host.querySelector('img[alt="Evan"]')!.getAttribute("data-storage"), "resource:current-sheet");
await act(async () => {
    (host.querySelector('button[aria-label="插入画布：Evan"]') as HTMLButtonElement).click();
});
await settle();
assert.equal(inserts[0].assetId, "evan");
assert.equal(inserts[0].versionId, "v5");
assert.equal(requests.at(-1).detailProject, "story");
assert(!requests.some((row) => row.personal));
await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === "我的素材")!.click();
});
await settle();
assert(host.textContent!.includes("美杜莎"));
await render("empty");
await settle();
assert(!host.textContent!.includes("美杜莎"));
assert(host.textContent!.includes("没有匹配的资产"));
failProject = true;
await render("forbidden");
await settle();
assert(host.textContent!.includes("资产读取失败"));
assert(!host.textContent!.includes("美杜莎"));
await render();
await settle();
assert(host.textContent!.includes("美杜莎"));
await act(async () => root.unmount());
client.clear();
await window.happyDOM.close();
console.log(JSON.stringify({ projectScopedInsertion: true, noPersonalFallback: true, currentRepresentation: true }));
