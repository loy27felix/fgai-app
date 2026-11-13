import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { strToU8, unzipSync, zipSync } from "fflate";
const dom = new Window({ url: "https://canvas.example/fg-six/", settings: { device: { prefersReducedMotion: "reduce" } } });
for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLBodyElement",
    "HTMLHtmlElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Element",
    "Node",
    "SVGElement",
    "ShadowRoot",
    "DocumentFragment",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "MutationObserver",
    "ResizeObserver",
    "localStorage",
]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : (dom as unknown as Record<string, unknown>)[key] });
}
Object.assign(globalThis, { getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasAppearanceEditor } = await import("../../src/pages/admin/settings/components/canvas-appearance-editor");
const { MeilinCompanionSettings } = await import("../../src/components/canvas/meilin-companion-settings");
const { DEFAULT_CANVAS_APPEARANCE } = await import("../../src/lib/canvas/agent-appearance");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, client: InstanceType<typeof QueryClient>;
let get: ReturnType<typeof spyOn>, post: ReturnType<typeof spyOn>, put: ReturnType<typeof spyOn>;
let changes: typeof DEFAULT_CANVAS_APPEARANCE;
const uploads: { path: string; data: FormData }[] = [];
const writes: Record<string, unknown>[] = [];
const initial = { userId: "owner", name: "美林", height: 160, avatarType: "site", revision: 0, resourceId: "", live2dResourceId: "", live2dEntry: "" };
function Admin() {
    const [value, setValue] = useState({ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "orb" as const });
    return (
        <CanvasAppearanceEditor
            value={value}
            onChange={(next) => {
                changes = next;
                setValue(next as typeof value);
            }}
            disabled={false}
            onUploading={() => {}}
        />
    );
}
beforeEach(() => {
    useUserStore.getState().setUser({ id: "owner", username: "owner", displayName: "Owner", role: "admin", status: "active" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    uploads.length = 0;
    writes.length = 0;
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path === "/agent/companion") return { ...initial };
        throw Error("Unexpected GET " + path);
    });
    post = spyOn(http, "post").mockImplementation(async (path, data) => {
        uploads.push({ path: String(path), data: data as FormData });
        const value = { resourceId: "owned-model", entry: "free/model.model3.json" };
        return String(path).startsWith("/admin/") ? { model: value } : value;
    });
    put = spyOn(http, "put").mockImplementation(async (_path, value) => {
        writes.push(value as Record<string, unknown>);
        return { ...(value as object), revision: 1 };
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    get.mockRestore();
    post.mockRestore();
    put.mockRestore();
});
afterAll(() => dom.happyDOM.abort());
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
    });
}
async function mount(personal = false) {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>{personal ? <MeilinCompanionSettings /> : <Admin />}</QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
}
function button(label: string) {
    const item = [...document.querySelectorAll("button")].find((el) => el.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    expect(item).toBeTruthy();
    return item!;
}
async function click(label: string) {
    await act(async () => button(label).click());
    await settle();
}
async function selectMode() {
    const radio = document.querySelector('input[type="radio"][value="live2d"]') as HTMLInputElement;
    expect(radio.disabled).toBe(false);
    await act(async () => radio.click());
    await settle();
}
function packageFile() {
    const files: Record<string, Uint8Array> = { "editor.cmo3": strToU8("editor") };
    for (const prefix of ["free", "pro"]) {
        files[`${prefix}/model.model3.json`] = strToU8(JSON.stringify({ Version: 3, FileReferences: { Moc: "model.moc3", Textures: ["0.png"] } }));
        files[`${prefix}/model.moc3`] = strToU8("MOC3");
        files[`${prefix}/0.png`] = new Uint8Array([137, 80, 78, 71]);
    }
    return new File([zipSync(files)], "models.zip");
}
async function upload() {
    const input = document.querySelector('input[type="file"][accept=".zip,application/zip"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [packageFile()] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
}
async function verifyRuntime() {
    const selected = uploads[0].data.get("file") as File;
    const files = unzipSync(new Uint8Array(await selected.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["free/0.png", "free/model.moc3", "free/model.model3.json"]);
}

test("admin can choose Live2D without an existing model and import a selected runtime", async () => {
    await mount();
    await selectMode();
    expect(changes.avatarType).toBe("live2d");
    expect(document.body.textContent).toContain("请点击下方");
    await upload();
    expect(document.body.textContent).toContain("压缩包中有多个 Live2D 模型");
    expect(uploads).toHaveLength(0);
    await click("导入所选模型");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe("/admin/settings/appearance/live2d");
    await verifyRuntime();
    expect(changes.live2dResourceId).toBe("owned-model");
    expect(changes.avatarType).toBe("live2d");
    expect(writes).toHaveLength(0);
});
test("cancelling model selection neither uploads nor saves", async () => {
    await mount();
    await selectMode();
    await upload();
    await click("取消");
    expect(uploads).toHaveLength(0);
    expect(writes).toHaveLength(0);
});
test("personal upload saves the chosen model to the user's profile", async () => {
    await mount(true);
    await selectMode();
    await upload();
    await click("导入所选模型");
    expect(uploads[0].path).toBe("/agent/companion/uploads/live2d");
    await verifyRuntime();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ avatarType: "live2d", live2dResourceId: "owned-model", live2dEntry: "free/model.model3.json" });
    expect(document.body.textContent).toContain("助手形象已保存到你的账号");
});
