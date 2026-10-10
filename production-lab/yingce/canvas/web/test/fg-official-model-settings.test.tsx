import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { capabilities } from "../../../gateway/fg-model-capabilities.mjs";
import { ImageSettingsPanel } from "../src/components/image-settings-panel";
import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { normalizeImageValue, normalizeModelCapabilityConfig, normalizeVideoValue } from "../src/lib/model-capabilities";
import { resolveImageRequestSize } from "../src/services/api/image-validation";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";

function configured(model: string, capability: "image" | "video") {
    const profile = normalizeModelCapabilityConfig(capabilities({
        id: model, capability, protocol: capability === "video" ? "fg-wetoken-wan3-video" : "openai-image", price: {},
    }));
    const channel = createModelChannel({ id: "official-qa", name: "QA", models: [model], modelCosts: [{
        model, capability, billingMode: "per_call", unitPriceMicrocredits: 0, capabilityConfig: profile,
    }] });
    return { profile, config: { ...defaultConfig, model: `${channel.id}::${model}`, imageModel: `${channel.id}::${model}`, videoModel: `${channel.id}::${model}`, channels: [channel] } };
}

test("the deployed Wan3 profile reaches the actual duration slider and request normalizer", () => {
    const { profile, config } = configured("wan3.0-video", "video");
    const html = renderToStaticMarkup(<VideoSettingsPanel config={{ ...config, videoSeconds: "30", size: "9:16", vquality: "720p" }} onConfigChange={() => {}} theme={canvasThemes.dark} />);
    expect(html).toContain('aria-valuemin="2"');
    expect(html).toContain('aria-valuemax="30"');
    expect(html).toContain('aria-valuenow="30"');
    expect(normalizeVideoValue(profile.video!, { seconds: "30", ratio: "9:16", resolution: "720p" })).toEqual({ seconds: "30", ratio: "9:16", resolution: "720p" });
    expect(normalizeVideoValue(profile.video!, { seconds: "2" }).seconds).toBe("2");
    expect(normalizeVideoValue(profile.video!, { seconds: "31" }).seconds).toBe("5");
});

for (const model of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    test(`${model} renders official settings and preserves custom sizes through request validation`, () => {
        const { profile, config } = configured(model, "image");
        const quality = model === "gpt-image-2" ? "high" : "max";
        const html = renderToStaticMarkup(<ImageSettingsPanel config={{ ...config, quality, size: "3840x2160", count: "10" }} onConfigChange={() => {}} theme={canvasThemes.dark} />);
        expect(html).toContain("透明背景");
        expect(html).toContain("3840 × 2160 px");
        expect(html).toContain('max="10"');
        expect(html.includes("超高")).toBe(model !== "gpt-image-2");
        expect(html.includes("最高")).toBe(model !== "gpt-image-2");
        expect(normalizeImageValue(profile.image!, { quality, size: "3840x2160", count: "10" }).quality).toBe(quality);
        for (const size of ["3840x2160", "2160x3840", "1536x1536", "1536x512"]) {
            expect(resolveImageRequestSize(profile.image!, quality, size)).toEqual({ parameter: "size", value: size });
        }
        for (const size of ["1025x1024", "4096x1024", "3072x1008", "3840x2176", "512x512"]) {
            expect(() => resolveImageRequestSize(profile.image!, quality, size)).toThrow();
        }
    });
}
