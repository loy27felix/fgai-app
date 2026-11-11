import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { resolveStyleExecutionPlan, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { projectVisualPrompt } from "./project-visual-prompt";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { updateProjectAssetVisual, type ProjectAsset } from "@/services/api/projects";

type ProjectStylePrompt = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

export async function generateProjectVisual(input: { projectId: string; asset: ProjectAsset; projectStyle?: ProjectStylePrompt; config: AiConfig }) {
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId, nodeId: `project-visual:${input.asset.id}`, mode: "image",
        prompt: projectVisualPrompt({ name: input.asset.title, category: input.asset.category, definition: input.asset.definition || {}, style: input.projectStyle?.prompt }),
        config: { ...input.config, count: "1", taskWorkflowProvider: "model" },
        metadata: { operation: "project_asset_image", assetId: input.asset.id, assetVersionId: input.asset.primaryVersionId },
    });
    const resourceId = resourceIdFromStorageKey(result.images?.[0]?.storageKey);
    if (!resourceId) throw new Error("图片已生成，但尚未保存到资源库，请从任务记录恢复图片后绑定");
    return updateProjectAssetVisual(input.projectId, input.asset.id, { resourceId, versionId: input.asset.primaryVersionId });
}

export function characterTurnaroundConfig(config: AiConfig): AiConfig {
    const model = config.imageModel || config.model;
    return { ...config, model, imageModel: model, ...defaultImageParamsForModel(config, model), count: "1", taskWorkflowProvider: "model" };
}

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; projectStyle?: ProjectStylePrompt; config: AiConfig }) {
    const promptTemplateVariables = characterTurnaroundVariables(input.name, input.definition, input.projectStyle);
    const model = input.config.imageModel || input.config.model;
    const profile = modelCapabilityConfigFor(input.config, model).image;
    const generationConfig = { ...input.config, model, ...(profile ? normalizeImageValue(profile, input.config) : {}), count: "1", taskWorkflowProvider: "model" as const };
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    const styleExecutionPlan = input.projectStyle?.profile ? resolveStyleExecutionPlan(input.projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(generationConfig)) throw new Error(`当前图片模型无法完整执行项目画风：${styleExecutionPlan.warnings.join("；")}。请切换图片模型，或在项目设置中停用对应画风资产`);
    await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `character-turnaround:${input.assetId}`,
        mode: "image",
        prompt: promptTemplateTaskPlaceholder("角色三视图"),
        config: generationConfig,
        metadata: { operation: PromptTemplateOperation.CharacterTurnaround, promptTemplateOperation: PromptTemplateOperation.CharacterTurnaround, promptTemplateVariables, characterAssetId: input.assetId, stylePresetId: input.projectStyle?.id, styleProfileJson: input.projectStyle?.profile ? serializeStyleProfile(input.projectStyle.profile) : undefined, styleExecutionPlan, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
}

function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, projectStyle?: ProjectStylePrompt) {
    const visual = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, definition.multiViewPrompt]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("；");
    if (!visual) throw new Error("请先填写剧情定位、角色外貌、体型或服装，再初始化三视图");
    return { 角色名称: name, 项目画风: characterStyleConstraint(projectStyle) || "项目尚未指定画风，保持角色媒介中性。", 角色设定: visual };
}

function characterStyleConstraint(projectStyle?: ProjectStylePrompt) {
    if (!projectStyle) return "";
    // 三视图只继承角色资产相关规范，避免把建筑、运镜等项目规则错误塞进静态设定表。
    const characterSections = new Set(["风格组合", "项目定位", "题材世界观", "视觉媒介", "角色设计系统", "项目色彩与光影", "服饰、材质与场景", "资产一致性", "全局禁用"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => {
        const title = line.match(/^【([^】]+)】/)?.[1];
        return title ? characterSections.has(title) : false;
    });
    return [
        `项目画风：${projectStyle.title}。角色造型、配色、服装材质与最终渲染媒介必须遵循以下规范：`,
        ...(rules.length ? rules : [projectStyle.prompt]),
    ].join("\n");
}
