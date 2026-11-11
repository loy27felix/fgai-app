import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSettingsPanel } from "../src/components/image-settings-panel";
import { modelCapabilityConfigFor, normalizeImageValue } from "../src/lib/model-capabilities";
import { defaultConfig } from "../src/stores/use-config-store";
import { canvasThemes } from "../src/lib/canvas-theme";
import { resolveImageRequestSize } from "../src/services/api/image-validation";

const image = JSON.parse(readFileSync(new URL("fixtures/gpt-image-25-native-profile.json", import.meta.url), "utf8"));
for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    const config = { ...defaultConfig, model: `test::${model}`, imageModel: `test::${model}`, size: "1024x1024", quality: "low", channels: [{ ...defaultConfig.channels[0], id: "test", models: [model], modelCosts: [{ model, protocol: "openai-image" as const, capabilityConfig: { version: 1, image } }] }] };
    test(`${model}: real native profile keeps 2K/4K pixel choices independently of quality`, () => {
        const markup = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
        expect(markup).toContain(">2K</button>");
        expect(markup).toContain(">4K</button>");
        const profile = modelCapabilityConfigFor(config, config.model).image!;
        expect(normalizeImageValue(profile, { size: "3840x2160", quality: "low" }).size).toBe("3840x2160");
        expect(resolveImageRequestSize(profile, "low", "3840x2160")).toEqual({ parameter: "size", value: "3840x2160" });
    });
}
