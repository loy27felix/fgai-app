import { expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/fg-six/" });
for (const key of ["window", "document", "navigator", "localStorage", "Element", "Node", "HTMLElement", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}

const { renderToStaticMarkup } = await import("react-dom/server");
const { MemoryRouter } = await import("react-router");
const { i18n, switchLocale } = await import("../../src/i18n");
const { useLocaleStore } = await import("../../src/stores/use-locale-store");
const { WorkspaceSidebarNav } = await import("../../src/components/layout/workspace-sidebar-nav");
const { CreationModeTabs } = await import("../../src/pages/create/creation-workspace");

test("FG workspace and creator use the selected language and restore it on startup", async () => {
    const noop = () => {};
    const render = () => renderToStaticMarkup(
        <MemoryRouter>
            <WorkspaceSidebarNav collapsed={false} onNavigate={noop} onOpenSearch={noop} onExpand={noop} onCollapse={noop} />
            <CreationModeTabs mode="text" onModeChange={noop} />
        </MemoryRouter>,
    );
    expect(render()).toContain("超级自由画布");
    switchLocale("en-US");
    expect(i18n.language).toBe("en-US");
    expect(render()).toContain(">Canvas<");
    expect(render()).toContain(">Video<");
    switchLocale("ja-JP");
    expect(render()).toContain(">キャンバス<");
    expect(render()).toContain(">動画<");
    const saved = localStorage.getItem("yingce:locale")!;
    switchLocale("zh-CN");
    localStorage.setItem("yingce:locale", saved);
    await useLocaleStore.persist.rehydrate();
    expect(i18n.language).toBe("ja-JP");
    expect(render()).toContain(">動画<");
});
