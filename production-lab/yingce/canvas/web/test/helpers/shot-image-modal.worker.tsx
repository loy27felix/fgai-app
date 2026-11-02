import { mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { strict as assert } from "node:assert";

const window = new Window({ url: "http://localhost/" });
for (const name of ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node", "ShadowRoot", "MutationObserver", "ResizeObserver", "getComputedStyle"]) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : (window as any)[name] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("@/components/ui/product/app-modal", () => ({
    AppModal: ({ children, footer }: any) => (
        <div>
            {children}
            {footer}
        </div>
    ),
}));
mock.module("@/components/cached-resource-image", () => ({ CachedResourceImage: ({ alt }: any) => <img alt={alt} /> }));
mock.module("@/components/fg-price-preview", () => ({ FGPricePreview: () => <span>费用预览</span> }));
mock.module("@/services/api/resources", () => ({
    getResource: async () => ({ size: 10_000_000 }),
    resourceIdFromStorageKey: (key: string) => (key?.startsWith("resource:") ? key.slice(9) : undefined),
    resourceFileUrl: (id: string) => `/api/resources/${id}/file`,
    resourceStorageKey: (id: string) => `resource:${id}`,
}));
let preparationCalls = 0;
mock.module("@/services/shot-image-transfer", () => ({
    prepareShotImageTransfer: async (images: any[], optimize: boolean) => {
        preparationCalls++;
        return { images, records: [], originalBytes: images.length * 10_000_000, submittedBytes: images.length * 100_000, mode: optimize ? "optimized" : "original" };
    },
}));
const { ShotImageGenerationModal } = await import("../../src/pages/projects/detail/shot-image-generation-modal");
const names = ["苏晚", "凌玄", "红烛"];
const context = {
    referenceImages: names.map((name, index) => ({ id: String(index), name, type: "image/png", dataUrl: "", storageKey: `resource:original-${index}` })),
    referenceAudios: [],
    resolvedCharacterVersions: [],
    mentionReferences: names.map((title, index) => ({ id: title, assetId: String(index), nodeId: "", title, label: title, kind: "image" as const, active: true })),
    assetReferences: names.map((title, index) => ({ assetId: String(index), title, category: "prop", imageIndex: index + 1 })),
};
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let confirmations = 0,
    closed = 0,
    submitted: any;
await act(async () => {
    root.render(
        <ShotImageGenerationModal
            title="分镜图"
            context={context}
            config={{} as any}
            requirements={{ capability: "image" }}
            onPreparePrompt={async (selection) => ({ prompt: `本次参考：${selection.referenceImages.map((image) => image.name).join("、")}`, metadata: {} })}
            onConfirm={async (value) => {
                confirmations++;
                submitted = value;
                return true;
            }}
            onClose={() => {
                closed++;
            }}
        />,
    );
});
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label) as unknown as HTMLButtonElement;
assert(button("确认并生成").disabled, "cannot submit before preparation");
assert.equal(preparationCalls, 0);
assert.equal(confirmations, 0);
await act(async () => {
    (host.querySelector('input[aria-label="本次使用凌玄"]') as unknown as HTMLInputElement).click();
});
assert(host.textContent?.includes("已选 2 张"), "deselect without unlinking");
await act(async () => {
    button("准备参考图并预览").click();
});
assert.equal(preparationCalls, 1);
assert.equal(confirmations, 0, "preparation alone cannot generate");
assert.equal((host.querySelector('textarea[aria-label="本次实际生成提示词"]') as unknown as HTMLTextAreaElement).value, "本次参考：苏晚、红烛");
assert(!button("确认并生成").disabled);
await act(async () => {
    button("不使用参考图").click();
});
assert(button("确认并生成").disabled, "changing selection invalidates prepared prompt");
await act(async () => {
    button("准备参考图并预览").click();
});
await act(async () => {
    button("确认并生成").click();
    button("确认并生成").click();
});
assert.equal(confirmations, 1, "double click creates one submission");
assert.equal(submitted.context.referenceImages.length, 0);
assert.equal(typeof submitted.operationId, "string");
assert.equal(closed, 1);
assert.equal(context.referenceImages.length, 3, "original bindings intact");
await act(async () => root.unmount());
console.log(JSON.stringify({ confirmedOnlyAfterReview: true, perAttemptDeselection: true, invalidatedOnChange: true, doubleClickProtected: true, originalBindingsIntact: true, paidCalls: 0 }));
await window.happyDOM.close();
