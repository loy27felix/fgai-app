import { type ReactNode, useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Plus, Square, X } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";

import { ModelPicker } from "@/reference/infinite-canvas/src/components/model-picker";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { GenerationPriceBadge } from "@/reference/infinite-canvas/src/components/generation-price-badge";
import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";
import type { CanvasResourceReference } from "@/reference/infinite-canvas/src/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    isSelectingReferences?: boolean;
    replacingReferenceId?: string | null;
    onBeginReferenceSelection?: (nodeId: string) => void;
    onBeginReferenceReplacement?: (nodeId: string, reference: CanvasResourceReference) => void;
    onRemoveReference?: (nodeId: string, referenceId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // 插件节点用 useBuiltinPanel.mode 指定生成类型
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], isSelectingReferences = false, replacingReferenceId = null, onBeginReferenceSelection, onBeginReferenceReplacement, onRemoveReference, onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);

    // 仅在切换到其它节点时恢复对应提示词;同一节点生成完成后继续保留当前输入。
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
    };

    return (
        <div
            data-canvas-no-zoom
            className="thin-scrollbar max-h-[min(560px,calc(100vh-120px))] overflow-y-auto rounded-[24px] border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <ReferenceStrip
                nodeId={node.id}
                references={mentionReferences}
                theme={theme}
                isSelecting={isSelectingReferences}
                replacingReferenceId={replacingReferenceId}
                onSelect={onBeginReferenceSelection}
                onReplace={onBeginReferenceReplacement}
                onRemove={onRemoveReference}
            />
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                className="thin-scrollbar min-h-[120px] h-[min(190px,28vh)] max-h-[260px] w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Tooltip title="放大编辑提示词">
                        <Button
                            type="text"
                            className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Maximize2 className="size-3.5" />}
                            onClick={() => setIsPromptEditorOpen(true)}
                            aria-label="放大编辑提示词"
                        />
                    </Tooltip>
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} className="canvas-model-picker-node" />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="canvas-model-picker-node" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="canvas-model-picker-node" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="canvas-model-picker-node" />
                            <CanvasTextSettingsPopover
                                config={config}
                                count={node.metadata?.textCount || 1}
                                onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                                onCountChange={(textCount) => onConfigChange(node.id, { textCount })}
                            />
                        </>
                    )}
                </div>
                {mode === "image" ? <GenerationPriceBadge className="max-w-full shrink-0" kind="image" model={config.model} size={config.size} count={Number(config.count) || 1} /> : mode === "video" ? <GenerationPriceBadge className="max-w-full shrink-0" kind="video" model={config.model} duration={config.videoSeconds} resolution={config.vquality} /> : null}
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim()}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "开始生成"}
                    title={isRunning ? "停止生成" : "开始生成"}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            <Modal title="编辑提示词" open={isPromptEditorOpen} centered width={760} footer={null} onCancel={() => setIsPromptEditorOpen(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <ReferenceStrip
                        nodeId={node.id}
                        references={mentionReferences}
                        theme={theme}
                        isSelecting={isSelectingReferences}
                        replacingReferenceId={replacingReferenceId}
                        onSelect={onBeginReferenceSelection}
                        onReplace={onBeginReferenceReplacement}
                        onRemove={onRemoveReference}
                    />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function ReferenceStrip({
    nodeId,
    references,
    theme,
    isSelecting = false,
    replacingReferenceId,
    onSelect,
    onReplace,
    onRemove,
}: {
    nodeId: string;
    references: CanvasResourceReference[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isSelecting?: boolean;
    replacingReferenceId?: string | null;
    onSelect?: (nodeId: string) => void;
    onReplace?: (nodeId: string, reference: CanvasResourceReference) => void;
    onRemove?: (nodeId: string, referenceId: string) => void;
}) {
    if (!references.length && !onSelect) return null;
    return (
        <div
            className="mb-2 flex min-w-0 items-center gap-2 overflow-x-auto rounded-2xl border px-2.5 py-2"
            style={{ borderColor: theme.toolbar.border, background: theme.toolbar.activeBg + "66" }}
            aria-label={"已连接 " + references.length + " 个参考素材"}
        >
            <span className="shrink-0 text-[11px] font-semibold opacity-70">参考素材</span>
            <div className="flex min-w-0 items-center gap-1.5">
                {references.map((reference) => (
                    <ReferencePreviewTooltip key={reference.id} reference={reference} theme={theme}>
                        <div
                            className="flex h-9 max-w-44 shrink-0 items-center gap-1.5 rounded-xl border px-1.5 transition hover:-translate-y-px hover:shadow-sm"
                            style={{ borderColor: replacingReferenceId === reference.id ? theme.node.activeStroke : theme.toolbar.border, background: replacingReferenceId === reference.id ? `${theme.node.activeStroke}18` : theme.toolbar.panel }}
                            title={onReplace ? `点击后在画布中替换 ${reference.label}` : reference.label + " · " + reference.title}
                            role={onReplace ? "button" : undefined}
                            tabIndex={onReplace ? 0 : undefined}
                            onClick={(event) => {
                                if (!onReplace) return;
                                event.stopPropagation();
                                onReplace(nodeId, reference);
                            }}
                            onKeyDown={(event) => {
                                if (!onReplace || (event.key !== "Enter" && event.key !== " ")) return;
                                event.preventDefault();
                                event.stopPropagation();
                                onReplace(nodeId, reference);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            aria-label={onReplace ? `替换 ${reference.label}` : undefined}
                        >
                            {reference.previewUrl && reference.kind === "image" ? <img src={reference.previewUrl} alt="" className="size-7 rounded-lg object-cover" /> : null}
                            {reference.previewUrl && reference.kind === "video" ? <video src={reference.previewUrl} className="size-7 rounded-lg bg-black object-cover" muted preload="metadata" /> : null}
                            {!reference.previewUrl || (reference.kind !== "image" && reference.kind !== "video") ? <span className="grid size-7 place-items-center rounded-lg bg-black/10 text-[10px] font-bold">{reference.kind === "text" ? "TXT" : reference.kind === "audio" ? "AUD" : "REF"}</span> : null}
                            <span className="max-w-28 truncate text-[11px] font-medium">{reference.label}</span>
                            {onRemove ? (
                                <button
                                    type="button"
                                    className="grid size-5 shrink-0 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onRemove(nodeId, reference.id);
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    aria-label={`移除 ${reference.label}`}
                                    title="移除参考素材"
                                >
                                    <X className="size-3" />
                                </button>
                            ) : null}
                        </div>
                    </ReferencePreviewTooltip>
                ))}
                {replacingReferenceId ? <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.activeStroke }}>请在画布中选择同类型素材</span> : null}
                {onSelect ? (
                    <button
                        type="button"
                        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border px-2 text-[11px] font-medium transition hover:opacity-80"
                        style={{ borderColor: isSelecting ? theme.node.activeStroke : theme.toolbar.border, background: isSelecting ? `${theme.node.activeStroke}18` : theme.toolbar.panel, color: theme.node.text }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onSelect(nodeId);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        title={isSelecting ? "正在从画布选择素材，点击结束" : "从画布选择图片、视频、文本或组"}
                    >
                        <Plus className="size-3.5" />
                        {isSelecting ? "选取中" : "添加"}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function ReferencePreviewTooltip({ reference, theme, children }: { reference: CanvasResourceReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode }) {
    const previewUrl = reference.previewUrl;
    if (!previewUrl || (reference.kind !== "image" && reference.kind !== "video")) return <>{children}</>;
    const reportPreviewError = () => console.warn("[canvas reference preview] unavailable", { referenceId: reference.id, kind: reference.kind });
    return (
        <Tooltip
            placement="top"
            mouseEnterDelay={0.18}
            title={
                <div className="w-72 overflow-hidden rounded-xl border p-1.5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel, color: theme.node.text }}>
                    {reference.kind === "image" ? <img src={previewUrl} alt={reference.title || reference.label} className="max-h-[420px] w-full rounded-lg object-contain" onError={reportPreviewError} /> : <video src={previewUrl} className="max-h-[420px] w-full rounded-lg bg-black object-contain" autoPlay loop muted playsInline preload="metadata" onError={reportPreviewError} />}
                    <div className="px-1 pb-0.5 pt-1 text-[11px] font-medium">{reference.label}<span className="ml-1 opacity-60">· {reference.title}</span></div>
                </div>
            }
        >
            {children}
        </Tooltip>
    );
}
function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoReferenceMode: node.metadata?.videoReferenceMode || globalConfig.videoReferenceMode || defaultConfig.videoReferenceMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoReferenceMode") return { videoReferenceMode: value as "reference" | "first_last" };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
