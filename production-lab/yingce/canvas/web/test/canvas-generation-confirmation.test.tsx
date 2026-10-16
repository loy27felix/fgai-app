import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasGenerationConfirmationItem, canvasConfirmationInputKey } from "../src/lib/canvas/canvas-generation-confirmation";
import { CanvasGenerationConfirmationContent } from "../src/components/canvas/canvas-generation-confirmation";
import { defaultConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../src/types/canvas";
const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "镜头01", x: 0, y: 0, width: 200, height: 300, metadata: { prompt: "快步走过雨夜街道" } };
const image: CanvasNodeData = { ...node, id: "ref", type: CanvasNodeType.Image, title: "角色A", metadata: { content: "resource:old" } };
const connections: CanvasConnection[] = [{ id: "link", fromNodeId: "ref", toNodeId: "video" }];
const videoConfig = { ...defaultConfig, model: "seedance-test", size: "9:16", videoSeconds: "12", vquality: "480p", videoGenerateAudio: "true" };
describe("canvas generation confirmation", () => {
    test("shows the actual video model, ratio, resolution and duration", () => {
        const item = canvasGenerationConfirmationItem(node, "video", videoConfig, "快步走", [node, image], connections);
        expect(item.fields).toContainEqual(["模型", "seedance-test"]);
        expect(item.fields).toContainEqual(["画面比例", "9:16"]);
        expect(item.fields).toContainEqual(["清晰度", "480p"]);
        expect(item.fields).toContainEqual(["生成时长", "12 秒"]);
        expect(item.references).toEqual(["角色A"]);
    });
    test("shows exact image pixels and derived ratio without using node display dimensions", () => {
        const item = canvasGenerationConfirmationItem(node, "image", { ...defaultConfig, model: "image-test", size: "1536x1024", count: "3" }, "photo", [node], []);
        expect(item.fields).toContainEqual(["生成尺寸", "1536 × 1024 px"]);
        expect(item.fields).toContainEqual(["画面比例", "3:2"]);
        expect(item.fields).toContainEqual(["生成张数", "3 张"]);
    });
    test("adaptive video never invents a duration or pixel size", () => {
        const item = canvasGenerationConfirmationItem(node, "video", { ...videoConfig, size: "auto", videoSeconds: "auto", vquality: "auto" }, "", [node], []);
        expect(item.fields).toContainEqual(["生成时长", "自适应／按输入时长"]);
        expect(item.fields).toContainEqual(["画面比例", "自适应（由模型确定）"]);
    });
    test("approvals change when model, duration, prompt or references change", () => {
        const make = (config = videoConfig, prompt = "walk", sources = [node, image]) => canvasGenerationConfirmationItem(node, "video", config, prompt, sources, connections);
        const key = make().key;
        expect(make({ ...videoConfig, videoSeconds: "15" }).key).not.toBe(key);
        expect(make({ ...videoConfig, model: "other-model" }).key).not.toBe(key);
        expect(make(videoConfig, "run").key).not.toBe(key);
        expect(make(videoConfig, "walk", [node, { ...image, metadata: { content: "resource:new" } }]).key).not.toBe(key);
        expect(canvasConfirmationInputKey({ ...node, metadata: { ...node.metadata, status: "loading", taskId: "new-task" } }, [node, image], connections, "walk")).toBe(make().inputKey);
    });
    test("confirmation screen renders batch items, repeated-submit warning and content safely", () => {
        const item = canvasGenerationConfirmationItem(node, "video", videoConfig, "<script>bad</script>", [node], []);
        const markup = renderToStaticMarkup(<CanvasGenerationConfirmationContent items={[item, { ...item, title: "镜头02" }]} duplicate />);
        expect(markup).toContain("12 秒");
        expect(markup).toContain("镜头02");
        expect(markup).toContain("再次计费");
        expect(markup).not.toContain("<script>");
        expect(markup).toContain("&lt;script&gt;");
    });
});
