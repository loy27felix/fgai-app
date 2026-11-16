import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { EntityAsset } from "../../src/stores/use-asset-store";

const dom = new Window({ url: "https://canvas.example/fg-six/", settings: { device: { prefersReducedMotion: "reduce" } } });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLBodyElement", "HTMLHtmlElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "SVGElement", "ShadowRoot", "DocumentFragment", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "ResizeObserver", "localStorage"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : (dom as unknown as Record<string, unknown>)[key] });
}
Object.assign(globalThis, { getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CastLibraryPicker } = await import("../../src/pages/drama-pipeline/studio/cast-library-picker");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useAssetStore } = await import("../../src/stores/use-asset-store");
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, client: InstanceType<typeof QueryClient>;
let get: ReturnType<typeof spyOn>, post: ReturnType<typeof spyOn>;
let remote: EntityAsset;
let closed = false;
const picked: string[] = [];
const pages: number[] = [];
function card(storageKey?: string, id = "role-card"): EntityAsset {
    return { id, kind: "entity", title: id === "role-card" ? "簌簌" : "另一个角色", category: "character", status: "confirmed", tags: [], coverUrl: "", createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z", data: { definition: {}, coverStorageKey: storageKey } };
}
beforeEach(() => {
    useUserStore.getState().setUser({ id: "owner", username: "owner", displayName: "Owner", role: "admin", status: "active" });
    useUserStore.getState().setHydrated(true);
    useAssetStore.setState({ assets: [card()] });
    remote = card("resource:latest-image");
    picked.length = 0;
    pages.length = 0;
    closed = false;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    get = spyOn(http, "get").mockImplementation(async (path, config) => {
        if (path !== "/assets") throw Error("Unexpected GET " + path);
        const page = Number(config?.params?.page || 1);
        pages.push(page);
        return { assets: [page === 1 ? remote : card("resource:other-image", "other-card")], kindCounts: { entity: 80 }, categoryCounts: { character: 80 }, folderCounts: {}, page, pageSize: 40, total: 80, hasMore: page === 1 };
    });
    // Image decoding is outside this selection test; resource access failures do not change pickability.
    post = spyOn(http, "post").mockRejectedValue(new Error("Preview not loaded in selection fixture"));
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    get.mockRestore();
    post.mockRestore();
});
afterAll(() => dom.happyDOM.abort());
async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
}
async function mount() {
    await act(async () => root.render(
        <ConfigProvider theme={{ token: { motion: false } }}><App><QueryClientProvider client={client}>
            <CastLibraryPicker open cast={{ kind: "character", name: "簌簌" }} onClose={() => { closed = true; }} onPick={async resourceId => { picked.push(resourceId); }} />
        </QueryClientProvider></App></ConfigProvider>,
    ));
    await settle();
}
function confirm() {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.replace(/\s/g, "") === "用作参考图并锁定");
    expect(button).toBeTruthy();
    return button!;
}
async function selectRole() {
    const button = document.querySelector('button.asset-picker-card-action[title="簌簌"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("true");
}
test("a server role image overrides a stale local card with no image", async () => {
    await mount();
    await selectRole();
    expect(document.body.textContent).toContain("已选 1");
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    await settle();
    expect(picked).toEqual(["latest-image"]);
    expect(closed).toBe(true);
});
test("confirmation adopts the latest image instead of an older cached image", async () => {
    useAssetStore.setState({ assets: [card("resource:old-image")] });
    await mount();
    await selectRole();
    await act(async () => confirm().click());
    await settle();
    expect(picked).toEqual(["latest-image"]);
});
test("a selected server card keeps its current image after changing pages", async () => {
    await mount();
    await selectRole();
    await act(async () => (document.querySelector('button[aria-label="下一页"]') as HTMLButtonElement).click());
    await settle();
    expect(pages).toContain(2);
    expect(document.querySelector('button.asset-picker-card-action[title="另一个角色"]')).toBeTruthy();
    expect(document.body.textContent).toContain("已选 1");
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    await settle();
    expect(picked).toEqual(["latest-image"]);
});
test("a role card without a server image remains unavailable", async () => {
    useAssetStore.setState({ assets: [card("resource:old-image")] });
    remote = card();
    await mount();
    const button = document.querySelector('button.asset-picker-card-action') as HTMLButtonElement;
    expect(button.title).toBe("这个角色卡还没有形象图");
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(confirm().disabled).toBe(true);
    expect(picked).toEqual([]);
});
