import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig, type VideoCapabilityConfig } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";

function configFor(profile: VideoCapabilityConfig): AiConfig {
    const channel = createModelChannel({ id: "qa", name: "QA", models: ["qa-video"], modelCosts: [{
        model: "qa-video", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 0,
        capabilityConfig: { version: 1, video: profile },
    }] });
    return { ...defaultConfig, model: "qa::qa-video", videoModel: "qa::qa-video", channels: [channel], videoSeconds: "11", size: "9:16", vquality: "720p" };
}

function profileWith(values: number[]) {
    const profile = defaultModelCapabilityConfig("openai-video").video!;
    return { ...profile, duration: { selection: "enum" as const, values, default: 5 },
        resolutions: ["480p", "720p", "1080p"], ratios: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        generateAudio: { supported: true, default: true } };
}

function render(config: AiConfig) {
    return renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={() => {}} theme={canvasThemes.dark} />);
}

describe("video settings capability controls", () => {
    test("long duration enums use a slider and numeric field up to the declared maximum", () => {
        const html = render(configFor(profileWith(Array.from({ length: 29 }, (_, index) => index + 2))));
        expect(html).toContain('role="slider"');
        expect(html).toContain('aria-valuemin="2"');
        expect(html).toContain('aria-valuemax="30"');
        expect(html).toContain('aria-valuenow="11"');
        expect(html).toContain('type="number"');
        expect(html).not.toContain('>30s</button>');
        expect(html).toContain('aria-label="视频比例 9:16" aria-pressed="true"');
        expect(html).toContain('>Auto</span>');
        expect(html).toContain('aria-label="生成音频 开启" aria-pressed="true"');
    });

    test("short discrete enums retain only supported duration choices", () => {
        const html = render({ ...configFor(profileWith([5, 10])), videoSeconds: "5" });
        expect(html).not.toContain('role="slider"');
        expect(html).toContain('>5s</button>');
        expect(html).toContain('>10s</button>');
        expect(html).not.toContain('>6s</button>');
    });

    test("duration slider does not offer unpriced seconds", () => {
        const config = configFor(profileWith(Array.from({ length: 27 }, (_, index) => index + 4)));
        config.channels[0]!.modelCosts![0]!.logicalPriceTiers = [4, 5, 6, 7, 8].map(videoSeconds => ({
            resolution: "720p", videoSeconds, unitPriceMicrocredits: 1, selector: { vquality: "720p", videoSeconds: String(videoSeconds) },
        }));
        const html = render({ ...config, videoSeconds: "6" });
        expect(html).toContain('aria-valuemax="8"');
        expect(html).not.toContain('aria-valuemax="30"');
    });
});
