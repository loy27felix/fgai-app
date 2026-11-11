import { expect, test } from "bun:test";
import { createStyleProfileSnapshot, parseStyleProfile, styleReferenceResourceIds, withStyleReferenceResources, resolveStyleExecutionPlan } from "@/lib/canvas/style-profile";
import { canvasReferenceDisplayLabel, canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";

test("style references remain optional, unique and limited to six stored images", () => {
    const profile = createStyleProfileSnapshot({ id: "style", title: "英国雨夜", description: "", tags: [], prompt: "冷色雨夜，英国演员" });
    expect(styleReferenceResourceIds(profile)).toEqual([]);
    const edited = { ...profile, ...withStyleReferenceResources(profile, ["a", "b", "a"]) };
    expect(styleReferenceResourceIds(edited)).toEqual(["a", "b"]);
    expect(styleReferenceResourceIds({ ...edited, ...withStyleReferenceResources(edited, []) })).toEqual([]);
    expect(() =>
        withStyleReferenceResources(
            profile,
            Array.from({ length: 7 }, (_, i) => String(i)),
        ),
    ).toThrow("6");
    expect(resolveStyleExecutionPlan(edited, { mode: "image", model: "gpt-image-2", interfaceType: "openai-image" }).status).toBe("ready");
});

test("audio titles distinguish voices without changing stored node mention identity", () => {
    const ref = { id: "audio-a", nodeId: "audio-a", kind: "audio" as const, label: "音频1", title: "Evan_英国男声.wav", active: true };
    expect(canvasReferenceDisplayLabel(ref)).toBe("音频1 · Evan_英国男声.wav");
    const token = canvasResourceMentionToken(ref);
    expect(canvasResourceMentionToken({ ...ref, title: "Shadow_柔和声音.wav" })).toBe(token);
    expect(canvasReferenceDisplayLabel({ ...ref, title: "" })).toBe("音频1");
});

test("saved reference styles survive legacy Go null optional fields", () => {
    const profile = createStyleProfileSnapshot({ id: "saved", title: "带参考图", description: "", tags: [], prompt: "写实电影" });
    const saved = { ...profile, assets: [{ id: "ref", kind: "reference", provider: "fg-resource", title: "画风参考 1", status: "validated", enabled: true, referenceResourceIds: ["image-1"], referenceUrls: null, baseModels: null, triggerWords: null, weight: null, parameters: null }] };
    const restored = parseStyleProfile(JSON.stringify(saved));
    expect(restored).not.toBeNull();
    expect(styleReferenceResourceIds(restored)).toEqual(["image-1"]);
    expect(resolveStyleExecutionPlan(restored!, { mode: "image", model: "gpt-image-2" }).status).toBe("ready");
    expect(parseStyleProfile(JSON.stringify({ ...saved, assets: [{ ...saved.assets[0], weight: "invalid" }] }))).toBeNull();
});
