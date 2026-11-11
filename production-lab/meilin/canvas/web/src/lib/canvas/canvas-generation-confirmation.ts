import { configuredModelDisplayName, modelRequestOptions } from "@/lib/model-selection";
import { generationPromptFingerprint } from "@/lib/generation-error";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";

export type GenerationConfirmationItem = { key: string; inputKey: string; title: string; kind: string; fields: Array<[string, string]>; prompt: string; references: string[] };
const labels = { image: "图片", video: "视频", audio: "音频", text: "文本" };
const auto = (value: unknown) => value === undefined || value === null || value === "" || /^(auto|adaptive|any)$/i.test(String(value));
function dimensions(size: string) {
    const match = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]),
        height = Number(match[2]);
    if (!width || !height) return undefined;
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height);
    return { pixels: `${width} × ${height} px`, ratio: `${width / divisor}:${height / divisor}` };
}
export function canvasConfirmationInputKey(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string) {
    const sources = connections
        .filter((connection) => connection.toNodeId === node.id)
        .map((connection) => connection.fromNodeId)
        .sort();
    const input = (value: CanvasNodeData | undefined) =>
        value
            ? {
                  id: value.id,
                  type: value.type,
                  title: value.title,
                  metadata: Object.fromEntries(Object.entries(value.metadata ?? {}).filter(([key]) => !/^(status|task|generationBatches|errorDetails|generationErrorCode|updatedAt|lastGeneration|videoGenerationRecipe|videoGenerationReferenceConnections)/.test(key))),
              }
            : undefined;
    return generationPromptFingerprint(JSON.stringify({ prompt, node: input(node), sources: sources.map((id) => input(nodes.find((value) => value.id === id))) }));
}
export function canvasGenerationConfirmationItem(node: CanvasNodeData, mode: CanvasNodeGenerationMode, config: AiConfig, prompt: string, nodes: CanvasNodeData[], connections: CanvasConnection[], displayPrompt = prompt): GenerationConfirmationItem {
    const params = modelRequestOptions(config, mode);
    const fields: Array<[string, string]> = [["模型", configuredModelDisplayName(config, config.model) || config.model || "未配置"]];
    if (mode === "image" || mode === "video") {
        const size = String(params.size ?? config.size ?? "auto");
        const pixels = dimensions(size);
        const ratio = pixels?.ratio ?? (auto(size) ? "自适应（由模型确定）" : size);
        fields.push(["画面比例", ratio]);
        if (mode === "image") {
            const tier = params.imageResolution ?? config.imageResolution;
            fields.push(["生成尺寸", pixels?.pixels ?? (auto(tier) ? "自适应（像素尺寸由模型返回）" : `${tier} 档位，实际像素由模型返回`)]);
            fields.push(["生成张数", `${Number(params.count ?? config.count) || 1} 张`]);
        } else {
            fields.push(["清晰度", auto(params.vquality) ? "自适应（由模型确定）" : String(params.vquality)]);
            const seconds = Number(params.videoSeconds);
            fields.push(["生成时长", Number.isFinite(seconds) && seconds > 0 ? `${seconds} 秒` : "自适应／按输入时长"]);
            fields.push(["同步声音", params.videoGenerateAudio ? "生成声音" : "不生成声音"]);
        }
    } else if (mode === "audio") {
        fields.push(["音频格式", String(params.audioFormat || config.audioFormat || "由模型确定")], ["音色", String(params.audioVoice || "模型默认")], ["语速", `${Number(params.audioSpeed) || 1} 倍`], ["生成时长", "按文本和语速决定"]);
    } else fields.push(["生成内容", "文本回复"]);
    if (config.taskWorkflowProvider && config.taskWorkflowProvider !== "model") fields.push(["工作流", `${config.taskWorkflowProvider} · ${config.runningHub.workflowId || "当前工作流"}`]);
    const inputKey = canvasConfirmationInputKey(node, nodes, connections, prompt);
    const key = generationPromptFingerprint(JSON.stringify({ inputKey, mode, model: config.model, params, workflow: config.taskWorkflowProvider, workflowID: config.runningHub.workflowId }));
    const references = connections.filter((connection) => connection.toNodeId === node.id).map((connection) => nodes.find((value) => value.id === connection.fromNodeId)?.title || "参考节点");
    return { key, inputKey, title: node.title || `${labels[mode]}节点`, kind: labels[mode], fields, prompt: displayPrompt, references };
}
