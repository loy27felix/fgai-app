import { expect, test } from "bun:test";
import { canApplyShotRewrite, createShotDraftStore } from "@/pages/projects/detail/shot-workspace-draft";

test("shot drafts and rewrite notes survive navigation and remain isolated by account, project and shot", async () => {
    const data = new Map<string, string>();
    const storage = (scope: string) => ({ getItem: async (key: string) => data.get(scope + key) || null, setItem: async (key: string, value: string) => { data.set(scope + key, value); }, removeItem: async () => {} });
    const store = createShotDraftStore(storage);
    store.update("alice", "p1", "shot1", { notes: "咖啡厅跳切", values: { title: "镜头01", durationSeconds: 15, videoPrompt: "手动改过的提示词" } });
    store.update("alice", "p1", "shot2", { notes: "加快动作" });
    await Promise.all([store.persist("alice", "p1", "shot1"), store.persist("alice", "p1", "shot2")]);
    const restored = createShotDraftStore(storage);
    expect((await restored.read("alice", "p1", "shot1")).values?.videoPrompt).toBe("手动改过的提示词");
    expect((await restored.read("alice", "p1", "shot2")).notes).toBe("加快动作");
    expect((await restored.read("bob", "p1", "shot1")).notes).toBe("");
    expect((await restored.read("alice", "p2", "shot1")).notes).toBe("");
});

test("an older pending IndexedDB read never replaces new local edits", async () => {
    let finish!: (value: string) => void;
    const store = createShotDraftStore(() => ({ getItem: () => new Promise<string>(resolve => { finish = resolve; }), setItem: async () => {}, removeItem: async () => {} }));
    const pending = store.read("alice", "p", "s");
    store.update("alice", "p", "s", { notes: "刚输入的修改" });
    finish(JSON.stringify({ notes: "旧修改", direction: "", skillIds: [] }));
    expect((await pending).notes).toBe("刚输入的修改");
});

test("rewrite application accepts manual edits made before generation and reference-only refreshes, but rejects newer authored edits", () => {
    const result = { shotId: "s", original: "手动改过的正文", seconds: 15, text: "新建议" };
    expect(canApplyShotRewrite(result, "s", { videoPrompt: "手动改过的正文\n\n【角色参考】\nEvan：@[asset:evan]", durationSeconds: 15 })).toBe(true);
    expect(canApplyShotRewrite(result, "s", { videoPrompt: "生成后又修改了正文", durationSeconds: 15 })).toBe(false);
    expect(canApplyShotRewrite(result, "other", { videoPrompt: result.original, durationSeconds: 15 })).toBe(false);
    expect(canApplyShotRewrite(result, "s", { videoPrompt: result.original, durationSeconds: 13 })).toBe(false);
    expect(canApplyShotRewrite({ ...result, original: "跟随 @[asset:evan]" }, "s", { videoPrompt: "跟随 @[asset:shadow]", durationSeconds: 15 })).toBe(false);
});
test("an English rewrite cannot overwrite dialogue edited after the suggestion was generated", () => {
    const result = { shotId: "s", original: "正文", seconds: 15, text: "建议", originalDialogue: "迪伦：别碰。", lockedDialogue: "Dylan: Don't." };
    expect(canApplyShotRewrite(result, "s", { videoPrompt: "正文", durationSeconds: 15, dialogue: result.originalDialogue })).toBe(true);
    expect(canApplyShotRewrite(result, "s", { videoPrompt: "正文", durationSeconds: 15, dialogue: "Dylan: My new line." })).toBe(false);
});
