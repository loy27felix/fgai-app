import { expect, test } from "bun:test";
import { ensureMediaNodeMinimumSize } from "../src/lib/canvas/canvas-node-size";
import { buildAnglePrompt } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { buildAngleGenerationConfig } from "../src/lib/canvas/canvas-angle-generation";
import { defaultConfig } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

test("old square video nodes recover their natural portrait geometry without moving the centre", () => {
    const video: CanvasNodeData = { id: "v", type: CanvasNodeType.Video, title: "v", position: { x: 100, y: 100 }, width: 432, height: 432, metadata: { content: "video", naturalWidth: 480, naturalHeight: 854 } };
    const fixed = ensureMediaNodeMinimumSize(video);
    expect(fixed.width / fixed.height).toBeCloseTo(480 / 854);
    expect(fixed.position.x + fixed.width / 2).toBeCloseTo(316);
    expect(fixed.position.y + fixed.height / 2).toBeCloseTo(316);
    for (const flag of ["locked", "manualSize", "freeResize"] as const) {
        expect(ensureMediaNodeMinimumSize({ ...video, metadata: { ...video.metadata, [flag]: true } }).width).toBe(432);
    }
});

test("multi-angle prompts establish the subject's visible side rather than only changing the background", () => {
    const right = buildAnglePrompt({ horizontalAngle: 90, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false });
    const left = buildAnglePrompt({ horizontalAngle: -90, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false });
    expect(right).toContain("右侧面");
    expect(left).toContain("左侧面");
    expect(right).toContain("不能只改变背景");
    expect(right).toContain("身份");
});

test("the actual angle request follows source dimensions then honours an explicit ratio and resolution", () => {
    const capabilityConfig = defaultModelCapabilityConfig(undefined, "test-image");
    capabilityConfig.image!.size = { parameter: "aspect_ratio", values: ["1:1", "16:9", "9:16"], default: "1:1", allowCustom: false };
    capabilityConfig.image!.quality = { supported: true, values: ["1k", "2k", "4k"], default: "1k" };
    const model = "relay::test-image";
    const config = { ...defaultConfig, model, imageModel: model, models: [model], imageModels: [model], size: "1:1", quality: "2k", channels: [{ id: "relay", name: "test", baseUrl: "https://example.com", apiKey: "fixture", apiFormat: "openai" as const, models: ["test-image"], modelCosts: [{ model: "test-image", capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1, capabilityConfig }] }] };
    const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 432, height: 432, metadata: { content: "image", naturalWidth: 1080, naturalHeight: 1920, size: "1:1" } };
    expect(buildAngleGenerationConfig(config, node).size).toBe("9:16");
    const selected = buildAngleGenerationConfig(config, node, { horizontalAngle: 90, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false, outputSize: { size: "16:9", quality: "4k" } });
    expect(selected.size).toBe("16:9");
    expect(selected.quality).toBe("4k");
    expect(selected.count).toBe("1");
    expect(node.metadata?.size).toBe("1:1");
});
