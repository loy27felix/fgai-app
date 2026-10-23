import { afterEach, expect, test } from "bun:test";
import { apiClient } from "@/services/api/request";
import { chapterStoryboardAssets, chapterStoryboardCharacters, loadChapterStoryboardAssets } from "@/pages/projects/detail/chapter-storyboard-production";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = originalAdapter; });
const material = (index: number): ProjectAsset => ({ id: `material-${index}`, title: `生成素材${index}`, mediaType: "image", category: "material", status: "confirmed", primaryVersionId: `v-${index}`, versionCount: 1, usages: [], position: index, updatedAt: "" });
const boss: ProjectAsset = { ...material(200), id: "boss", title: "Boss", category: "character", character: { versionId: "boss-v2", version: 2, definition: { gender: "男性", voiceGender: "男声" }, representations: [], visualStatus: "ready", voiceStatus: "ready" } };

test("confirmed characters are not displaced by sixty newer generated media assets", () => {
    const assets = [...Array.from({ length: 65 }, (_, i) => material(i)), boss];
    const chosen = chapterStoryboardAssets({ assets } as ProjectDetail);
    expect(chosen).toHaveLength(60);
    expect(chosen.some(asset => asset.id === "boss")).toBe(true);
});

test("a lazy overview loads every asset page before building actual storyboard input", async () => {
    const pages: number[] = [];
    apiClient.defaults.adapter = async config => {
        const page = Number(config.params?.page);pages.push(page);
        expect(config.url).toBe("/projects/project/assets");
        const assets = page === 1 ? Array.from({ length: 100 }, (_, i) => material(i)) : [boss];
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, msg: "", data: { assets, page, pageSize: 100, total: 101, hasMore: page === 1, categoryCounts: {}, folderCounts: {} } } };
    };
    const assets = await loadChapterStoryboardAssets("project");
    expect(pages).toEqual([1, 2]);
    const snapshot = { assets, assetCandidates: [] } as unknown as ProjectDetail;
    expect(chapterStoryboardCharacters(snapshot).find(character => character.name === "Boss")?.definition).toMatchObject({ gender: "男性", voiceGender: "男声" });
    expect(chapterStoryboardAssets(snapshot).some(asset => asset.id === "boss")).toBe(true);
});

test("an incomplete or failed page cannot silently turn a project into an empty asset list", async () => {
    apiClient.defaults.adapter = async config => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, msg: "", data: { assets: [], page: 1, pageSize: 100, total: 5, hasMore: true, categoryCounts: {}, folderCounts: {} } } });
    await expect(loadChapterStoryboardAssets("project")).rejects.toThrow("资产清单");
});
