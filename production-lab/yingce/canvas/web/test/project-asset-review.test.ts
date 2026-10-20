import { describe, expect, test } from "bun:test";
import { recommendProjectAsset, projectAssetTaskState } from "../src/pages/projects/detail/project-asset-review";
import type { GenerationTask } from "../src/services/api/task-center";

describe("asset review follows script importance", () => {
    test("ordinary single-use prop is not selected", () => {
        expect(recommendProjectAsset({ title: "纸巾", category: "prop" }, [{ sourceText: "他用纸巾擦手，随后出门。" }]).selected).toBe(false);
    });
    test("a one-off clue is preserved", () => {
        expect(recommendProjectAsset({ title: "信封", category: "prop", definition: { purpose: "包含关键线索" } }, [{ sourceText: "她留下信封。" }]).selected).toBe(true);
    });
    test("repeated props and named aliases remain selected", () => {
        expect(recommendProjectAsset({ title: "旧表", category: "prop", definition: { aliases: ["腕表"] } }, [{ sourceText: "他放下旧表。" }, { sourceText: "她认出腕表。" }]).selected).toBe(true);
    });
    test("aliases do not double-count the same occurrence", () => {
        expect(recommendProjectAsset({ title: "旧表", category: "prop", definition: { aliases: ["表"] } }, [{ sourceText: "他放下旧表。" }]).selected).toBe(false);
    });
    test("characters and scenes stay available without name matches", () => {
        expect(recommendProjectAsset({ title: "Evan", category: "character" }, []).selected).toBe(true);
        expect(recommendProjectAsset({ title: "公寓", category: "environment" }, []).selected).toBe(true);
    });
});

describe("task cards use safe server context", () => {
    const asset = { id: "asset", updatedAt: "2026-10-20T00:00:00Z" };
    const task = (status: GenerationTask["status"], createdAt = "2026-10-20T00:01:00Z") => ({ id: status, status, clientContext: { assetId: asset.id }, createdAt, updatedAt: createdAt }) as GenerationTask;
    test("queued/running state does not require private task inputs", () => {
        expect(projectAssetTaskState([task("queued")], asset)?.text).toBe("排队中");
        expect(projectAssetTaskState([task("running")], asset)?.active).toBe(true);
    });
    test("newer retry wins over an old failed task", () => {
        expect(projectAssetTaskState([task("failed"), task("running", "2026-10-20T00:02:00Z")], asset)?.active).toBe(true);
    });
    test("failure is visible but does not overwrite a newer saved version", () => {
        expect(projectAssetTaskState([task("failed")], asset)?.text).toContain("失败");
        expect(projectAssetTaskState([task("failed", "2026-10-19T23:00:00Z")], asset)).toBeUndefined();
    });
});
