import { expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { inspectLive2DPackage } from "../src/services/live2d-package";

function runtime(prefix: string) {
    return {
        [`${prefix}/model.model3.json`]: strToU8(
            JSON.stringify({
                Version: 3,
                FileReferences: {
                    Moc: "model.moc3",
                    Textures: ["textures/0.png"],
                    Physics: "physics.json",
                    Motions: { Idle: [{ File: "motions/idle.motion3.json" }] },
                },
            }),
        ),
        [`${prefix}/model.moc3`]: strToU8("MOC3-test"),
        [`${prefix}/textures/0.png`]: new Uint8Array([137, 80, 78, 71]),
        [`${prefix}/physics.json`]: strToU8("{}"),
        [`${prefix}/motions/idle.motion3.json`]: strToU8("{}"),
    };
}
function archive(files: Record<string, Uint8Array>) {
    return new File([zipSync(files)], "source.zip", { type: "application/zip" });
}

test("source archives offer every model and upload only the selected model's runtime files", async () => {
    const source = archive({ ...runtime("free/runtime"), ...runtime("pro/runtime"), "free/editor.cmo3": strToU8("editor"), "ReadMe.txt": strToU8("info"), "pro/runtime/unused.png": new Uint8Array([1]), "script.js": strToU8("not executable") });
    const inspected = await inspectLive2DPackage(source);
    expect(inspected.entries).toEqual(["free/runtime/model.model3.json", "pro/runtime/model.model3.json"]);
    const selected = await inspected.build(inspected.entries[1]);
    const files = unzipSync(new Uint8Array(await selected.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(Object.keys(runtime("pro/runtime")).sort());
    expect(Object.keys(files).some((name) => name.includes("free") || name.endsWith(".js"))).toBe(false);
    await expect(inspected.build("not-a-model")).rejects.toThrow("选择");
});

test("missing files and unsafe references fail with a useful explanation", async () => {
    const files = runtime("model");
    delete files["model/textures/0.png"];
    const inspected = await inspectLive2DPackage(archive(files));
    await expect(inspected.build(inspected.entries[0])).rejects.toThrow("textures/0.png");
    files["model/model.model3.json"] = strToU8(JSON.stringify({ Version: 3, FileReferences: { Moc: "../secret.moc3", Textures: ["a.png"] } }));
    const unsafe = await inspectLive2DPackage(archive(files));
    await expect(unsafe.build(unsafe.entries[0])).rejects.toThrow("路径");
});

test("rejects duplicate paths, oversized JSON and archives without runtime models", async () => {
    await expect(inspectLive2DPackage(archive({ "readme.txt": strToU8("editor only") }))).rejects.toThrow("model3.json");
    await expect(inspectLive2DPackage(archive({ ...runtime("a"), "A/model.moc3": strToU8("MOC3") }))).rejects.toThrow("重复");
    await expect(inspectLive2DPackage(archive({ ...runtime("a"), "large.json": new Uint8Array(2 * 1024 * 1024 + 1) }))).rejects.toThrow("限制");
});
