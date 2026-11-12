import { afterEach, expect, test } from "bun:test";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS } from "@/lib/canvas/canvas-appearance";
import { applyThemeBrandVariables, applyThemePackCanvas } from "@/themes/apply";
import { themePackFor } from "@/themes/registry";
import "@/themes/longying-ink";
import "@/themes/yunhe-xianguan";

const originalThemes = structuredClone(canvasThemes);
const originalPresets = structuredClone(CANVAS_APPEARANCE_PRESETS);
afterEach(() => applyThemePackCanvas("classic"));

test("theme switching restores FG canvas defaults and never accumulates overrides", () => {
    applyThemePackCanvas("longying-ink");
    expect(canvasThemes.light.canvas.background).toBe("#efe9dd");
    expect(themePackFor("longying-ink")?.agentOrb).toBeDefined();
    applyThemePackCanvas("yunhe-xianguan");
    expect(themePackFor("yunhe-xianguan")?.agentOrb).toBeDefined();
    applyThemePackCanvas("yunhe-xianguan");
    applyThemePackCanvas("classic");
    expect(canvasThemes).toEqual(originalThemes);
    expect(CANVAS_APPEARANCE_PRESETS).toEqual(originalPresets);
});

test("switching theme does not mutate already stored canvas appearance snapshots", () => {
    const saved = structuredClone(CANVAS_APPEARANCE_PRESETS[0].values);
    applyThemePackCanvas("longying-ink");
    expect(saved).toEqual(originalPresets[0].values);
    expect(themePackFor("unknown-custom-skin")).toBeUndefined();
});

test("brand labels are CSS string values, not executable markup", () => {
    const values = new Map<string, string>();
    const fakeDocument = { documentElement: { style: { setProperty: (k: string, v: string) => values.set(k, v) } } } as unknown as Document;
    applyThemeBrandVariables('美林"; color:red;', fakeDocument);
    expect(values.get("--theme-brand-name")).toBe(JSON.stringify('美林"; color:red;'));
    expect(values.get("--theme-brand-seal")).toBe(JSON.stringify("美林"));
});
