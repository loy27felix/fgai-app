import { captureVideoGenerationRecipe } from "@/lib/canvas/canvas-video-stack";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { buildAudioGenerationMetadata, buildVideoGenerationMetadata, generationReferenceUrls, runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { canvasGenerationPromptMetadata } from "@/lib/canvas/canvas-generation-submission";
import { buildGenerationNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { producedModelCandidateForGeneration } from "@/lib/canvas/produced-model";
import { isDoubaoAudioConfig } from "@/lib/audio-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;

export async function executeVideoGeneration({
    nodeId,
    sourceNode,
    prompt,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    projectId,
    canvasConnections,
    canvasNodes,
    setSelectedNodeIds,
    setDialogNodeId,
    setNodes,
    setConnections,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    applyGenerationTaskResult,
    registerPendingNodeIds,
    styleMetadata,
    skillMetadata,
    taskContext,
    retryContext,
    usePrecreatedVideoTarget,
}: CanvasGenerationExecution, runTask = runCanvasGenerationTaskToConsumer) {
    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
    const isExistingVideoNode = sourceNode?.type === CanvasNodeType.Video;
    // Batch planning already allocated a fresh, empty destination for this intent.
    // Capacity retries keep that destination; an existing result is never replaced.
    const reuseEmptyTarget = Boolean(usePrecreatedVideoTarget && sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content && !sourceNode.metadata?.storageKey);
    const videoId = reuseEmptyTarget ? nodeId : nanoid();
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const videoGenerationMetadata = buildVideoGenerationMetadata(sourceNode, generationContext, generationConfig);
    const draftVideoNode: CanvasNodeData = {
        id: videoId,
        type: CanvasNodeType.Video,
        title: buildGenerationNodeTitle(prompt, "Generated Video"),
        position: reuseEmptyTarget ? parent : findAvailableGenerationGroupPosition(canvasNodes, { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y }, spec),
        width: spec.width,
        height: spec.height,
        metadata: {
            ...canvasGenerationPromptMetadata(prompt, effectivePrompt),
            status: NODE_STATUS_LOADING,
            errorDetails: undefined,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
            model: generationConfig.model,
            producedModelCandidate: producedModelCandidateForGeneration(generationConfig),
            size: generationConfig.size,
            seconds: generationConfig.videoSeconds,
            vquality: generationConfig.vquality,
            generateAudio: generationConfig.videoGenerateAudio,
            watermark: generationConfig.videoWatermark,
            references: generationReferenceUrls(generationContext),
            ...videoGenerationMetadata,
            ...styleMetadata,
            ...skillMetadata,
        },
    };
    const nextInputConnections = isExistingVideoNode ? canvasConnections.filter(edge => edge.toNodeId === nodeId).map(edge => ({ ...edge, id: nanoid(), toNodeId: videoId })) : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }];
    const videoNode = captureVideoGenerationRecipe(draftVideoNode, nextInputConnections);
    registerPendingNodeIds([videoId]);
    setNodes(current => reuseEmptyTarget ? current.map(node => node.id === nodeId ? videoNode : node) : [...current.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: node.metadata?.content ? NODE_STATUS_SUCCESS : "idle" as const } } : node), videoNode]);
    if (!reuseEmptyTarget) setConnections(current => [...current, ...nextInputConnections]);
    setSelectedNodeIds(new Set([videoId])); setDialogNodeId(videoId);

    startGenerationRequest(videoId, nodeId, nodeId, controller);
    try {
        await runTask(
            {
                projectId,
                nodeId: videoId,
                ...retryContext,
                mode: "video",
                prompt: effectivePrompt,
                config: generationConfig,
                referenceImages: generationContext.referenceImages,
                referenceVideos: generationContext.referenceVideos,
                referenceAudios: generationContext.referenceAudios,
                signal: controller.signal,
                metadata: {
                    sourceNodeId: nodeId,
                    ...taskContext,
                    resolvedCharacterVersions: generationContext.resolvedCharacterVersions,
                    resolvedCharacterVoices: generationContext.resolvedCharacterVoices,
                    promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                    promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                    ...videoGenerationMetadata,
                    ...styleMetadata,
                    ...skillMetadata,
                },
            },
            {
                bindTask: (task) => bindGenerationTask(videoId, task),
                consumeTask: (task) => applyGenerationTaskResult(videoId, task),
            },
        );
    } finally {
        finishGenerationRequest(videoId, controller);
    }
}

export async function executeAudioGeneration({
    nodeId,
    sourceNode,
    prompt,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    projectId,
    setNodes,
    setConnections,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    applyGenerationTaskResult,
    registerPendingNodeIds,
    taskContext,
    skillMetadata,
    retryContext,
}: CanvasGenerationExecution) {
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
    const isExistingAudioNode = sourceNode?.type === CanvasNodeType.Audio && Boolean(sourceNode.metadata?.content);
    const audioId = isEmptyAudioNode ? nodeId : nanoid();
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const audioNode: CanvasNodeData = {
        id: audioId,
        type: CanvasNodeType.Audio,
        title: buildGenerationNodeTitle(prompt, "Generated Audio"),
        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
        width: isEmptyAudioNode ? sourceNode.width : spec.width,
        height: isEmptyAudioNode ? sourceNode.height : spec.height,
        metadata: { ...canvasGenerationPromptMetadata(prompt, effectivePrompt), status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig), ...skillMetadata },
    };
    registerPendingNodeIds([audioId]);
    setNodes((current) =>
        isEmptyAudioNode ? current.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
    );
    if (!isEmptyAudioNode && !isExistingAudioNode) setConnections((current) => [...current, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);

    startGenerationRequest(audioId, nodeId, nodeId, controller);
    try {
        await runCanvasGenerationTaskToConsumer(
            {
                projectId,
                nodeId: audioId,
                ...retryContext,
                mode: "audio",
                prompt: doubaoAudioPrompt(generationConfig, effectivePrompt, generationContext.referenceAudios.length, generationContext.referenceImages.length),
                config: generationConfig,
                referenceImages: generationContext.referenceImages,
                referenceAudios: generationContext.referenceAudios,
                signal: controller.signal,
                metadata: { sourceNodeId: nodeId, ...taskContext, resolvedCharacterVersions: generationContext.resolvedCharacterVersions, resolvedCharacterVoiceKey: generationContext.resolvedCharacterVoices[0]?.voiceKey, ...skillMetadata },
            },
            {
                bindTask: (task) => bindGenerationTask(audioId, task),
                consumeTask: (task) => applyGenerationTaskResult(audioId, task),
            },
        );
    } finally {
        finishGenerationRequest(audioId, controller);
    }
}

function doubaoAudioPrompt(config: CanvasGenerationExecution["generationConfig"], prompt: string, audioCount: number, imageCount: number) {
    if (!isDoubaoAudioConfig(config)) return prompt;
    // 参考图片模式的 text_prompt 只保留要合成的文本，图片走 references。
    if (imageCount > 0) return prompt.replace(/@(图片|音频|视频|绘图|角色|文本)\d+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
    if (audioCount <= 0) return prompt;
    // 官方参考音频用 @Audio1、@Audio2，和 references 的顺序一致。画布里的 @音频N 只是编辑器槽位。
    const next = prompt.replace(/@音频(\d+)/g, "@Audio$1");
    const missing = Array.from({ length: audioCount }, (_, index) => `@Audio${index + 1}`).filter((marker) => !next.includes(marker));
    return missing.length ? `${missing.join(" ")} ${next}` : next;
}
