import { ImageSizePicker } from "@/components/image-size-picker";
import { FGPricePreview } from "@/components/fg-price-preview";
import { dramaPlanFromBeats } from "@/lib/short-drama-production";
import { shortDramaMediaDefault } from "@/lib/short-drama-models";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { shotArtifactPrompt, actionBoardPromptFromBeats } from "./shot-artifact-prompt";
import { prepareShotVideoExecution, shotGenerationReferenceContext, shotSceneReferenceContext } from "./shot-video-execution";
import { rewriteShotVideoPrompt } from "./shot-prompt-rewrite";
import { ShotVideoBatchModal } from "./shot-video-batch-modal";
import { ShotImageGenerationModal, type PreparedShotImage } from "./shot-image-generation-modal";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Form, Image, Input, InputNumber } from "antd";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { EmptyState } from "@/components/ui/product/empty-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Film, Image as ImageIcon, Layers3, List, Maximize2, Play, Plus, RefreshCcw, Save, Search, SlidersHorizontal, Trash2, UsersRound, WandSparkles, X } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { imageQualityLabel } from "@/lib/image-quality";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { customShotTitle, formatShotOrdinal, normalizeDefaultShotTitle } from "@/lib/shot-label";
import { modelCompatibilityError, resolveCompatibleModel, resolveModelVideoBooleanOptions, type ModelRequirements } from "@/lib/model-selection";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { downloadBrowserMedia } from "@/services/browser-download";
import {
    createUnitWorkflow,
    deleteProjectShot,
    linkShotAsset,
    listProjectAssetsPage,
    saveProjectShot,
    unlinkShotAsset,
    updateWorkflowStep,
    type ProjectAsset,
    type ProjectDetail,
    type ProjectShot,
    type ShotAssetReference,
    type ShotArtifact,
    type ShotRevisionInput,
    type WorkflowStep,
} from "@/services/api/projects";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { skillRuntime } from "@/services/skill-runtime";
import { configuredModelMatchesCapability, modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";

import {
    ArtifactStatus,
    artifactTypeForStage,
    assetCategoryLabel,
    currentArtifact,
    currentRevision,
    formatDuration,
    type ShortDramaWorkflowStage,
} from "./workflow-shared";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, inferShotVisualAssets, resolveShotAssetMentionPrompt, stableShotReferences, type ShotAssetReferenceContext } from "./workflow-shot-references";
import { canApplyShotRewrite, shotDraftStore, type ShotEditorValues, type ShotRewriteResult, type ShotWorkspaceDraft } from "./shot-workspace-draft";
import { VideoMediaPreview } from "@/components/asset-media-preview";
import { Select } from "@/components/ui/base/select";

type Props = {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    workflowStep?: WorkflowStep;
    selectedShot?: ProjectShot;
    onSelectShot: (id: string) => void;
    onRefresh: () => Promise<void>;
    onAddShot: () => void;
    addingShot: boolean;
};

const productionStageCopy: Record<"storyboard" | "previz" | "video", { label: string; action: string; empty: string }> = {
    storyboard: { label: "分镜图", action: "生成分镜图", empty: "生成静态分镜图，确认构图、景别与角色位置" },
    previz: { label: "动作预演", action: "生成黑白预演", empty: "生成黑白动作预演，确认表演节拍与镜头运动" },
    video: { label: "镜头视频", action: "生成镜头视频", empty: "选择视频模型后生成当前镜头" },
};

export default function WorkflowProductionWorkbench(props: Props) {
    const { activeStage, detail, projectId, unitId, workflowStep, selectedShot, onSelectShot, onRefresh, onAddShot, addingShot } = props;
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const draftScope = useUserStore(state => state.user?.id || "");
    const [form] = Form.useForm<ShotEditorValues>();
    const watchedDuration = Form.useWatch("durationSeconds", form);
    const watchedVideoPrompt = Form.useWatch("videoPrompt", form);
    const watchedTitle = Form.useWatch("title", form);
    const [leftTab, setLeftTab] = useState<"assets" | "episodes" | "shots">("episodes");
    const [previewTab, setPreviewTab] = useState<"latest" | "history">("latest");
    const [previewArtifactId, setPreviewArtifactId] = useState("");
    const [imagePreviewArtifact, setImagePreviewArtifact] = useState<ShotArtifact | null>(null);
    const [editorDirty, updateEditorDirty] = useState(false);
    const editorDirtyRef = useRef(false);
    const setEditorDirty = (dirty: boolean) => { editorDirtyRef.current = dirty; updateEditorDirty(dirty); };
    const [readyDraftKey, setReadyDraftKey] = useState("");
    const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const draftWarningShown = useRef(false);
    const draftShotId = selectedShot?.id || "";
    const draftKey = JSON.stringify([draftScope, projectId, draftShotId]);
    const draftReady = readyDraftKey === draftKey;
    const activeWorkspaceKey = useRef(draftKey);
    activeWorkspaceKey.current = draftKey;
    const liveReferenceContext = useRef<ShotAssetReferenceContext | null>(null);
    const hydratedReferenceKey = useRef("");
    const persistDraft = () => {
        if (!draftScope || !draftShotId) return;
        void shotDraftStore.persist(draftScope, projectId, draftShotId).catch(() => {
            if (!draftWarningShown.current) { draftWarningShown.current = true; message.warning("本地草稿暂未写入，请保存脚本后再关闭页面"); }
        });
    };
    const rememberDraft = (patch: Partial<ShotWorkspaceDraft>) => {
        if (!draftScope || !draftShotId) return;
        shotDraftStore.update(draftScope, projectId, draftShotId, patch);
        clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(persistDraft, 300);
    };
    const rememberEditor = () => { setEditorDirty(true); rememberDraft({ values: form.getFieldsValue() }); };
    const [promptPreview, setPromptPreview] = useState<{ title: string; text: string } | null>(null);
    const [rewriteOpen, setRewriteOpen] = useState(false);
    const [videoBatchOpen, setVideoBatchOpen] = useState(false);
    const [imageConfirmation, setImageConfirmation] = useState<{ shotId: string; stage: ShortDramaWorkflowStage; context: ShotAssetReferenceContext; values: ShotEditorValues; configKey: string } | null>(null);
    useEffect(() => setImageConfirmation(null), [projectId, unitId, selectedShot?.id, activeStage]);
    const [rewriteNotes, setRewriteNotes] = useState("");
    const [rewriteDirection, setRewriteDirection] = useState("");
    const [rewriteSkillIds, setRewriteSkillIds] = useState<string[]>([]);
    const [rewriting, setRewriting] = useState(() => shotDraftStore.isRewriting(draftScope, projectId, draftShotId));
    const [rewriteStatus, setRewriteStatus] = useState("");
    const [rewriteResult, setRewriteResult] = useState<ShotRewriteResult | null>(null);
    const [submittingShotIds, setSubmittingShotIds] = useState<Set<string>>(() => new Set());
    const checkedAssetShots = useRef(new Set<string>());
    const [associatingShotIds, setAssociatingShotIds] = useState<Set<string>>(() => new Set());
    const assetsAssociating = Boolean(selectedShot && associatingShotIds.has(selectedShot.id));
    const [taskClock, setTaskClock] = useState(() => Date.now());
    const activeShotIdRef = useRef(selectedShot?.id || "");
    const hydratedShotRevisionKey = useRef("");
    activeShotIdRef.current = selectedShot?.id || "";
    useEffect(() => {
        let cancelled = false;
        const workspaceKey = draftKey;
        const isCurrent = () => !cancelled && activeWorkspaceKey.current === workspaceKey;
        setReadyDraftKey("");
        setEditorDirty(false);
        setRewriteOpen(false);
        setRewriteNotes(""); setRewriteDirection(""); setRewriteSkillIds([]); setRewriteResult(null); setRewriteStatus("");
        setRewriting(shotDraftStore.isRewriting(draftScope, projectId, draftShotId));
        if (!draftScope || !draftShotId) { setReadyDraftKey(workspaceKey); return; }
        const unsubscribe = shotDraftStore.subscribe(draftScope, projectId, draftShotId, () => {
            if (!isCurrent()) return;
            const current = shotDraftStore.peek(draftScope, projectId, draftShotId);
            setRewriting(shotDraftStore.isRewriting(draftScope, projectId, draftShotId));
            if (current) {
                setRewriteNotes(current.notes); setRewriteDirection(current.direction); setRewriteSkillIds(current.skillIds);
                setRewriteResult(current.result || null);
                if (current.result) setRewriteStatus("此镜头的修改建议已完成，请检查后应用");
            }
        });
        void shotDraftStore.read(draftScope, projectId, draftShotId).then(draft => {
            if (!isCurrent()) return;
            if (draft.values && !editorDirtyRef.current) {
                const references = liveReferenceContext.current?.mentionReferences || [];
                const tokens = new Set([...((draft.values.videoPrompt || "").matchAll(/@\[asset:([^\]]+)\]/g))].map(match => match[1]));
                const sameBindings = tokens.size === references.length && references.every(reference => reference.assetId && tokens.has(reference.assetId));
                form.setFieldsValue({ ...draft.values, videoPrompt: sameBindings ? draft.values.videoPrompt : ensureShotAssetMentionPrompt(draft.values.videoPrompt || "", references) });
                setEditorDirty(true);
            }
            setRewriteNotes(draft.notes);
            setRewriteDirection(draft.direction || "");
            setRewriteSkillIds(draft.skillIds);
            setRewriteResult(draft.result || null);
            if (draft.result) setRewriteStatus("已恢复此镜头的修改建议，请检查后应用");
        }).catch(error => { if (isCurrent()) message.warning(error instanceof Error ? error.message : "镜头草稿读取失败"); })
            .finally(() => { if (isCurrent()) setReadyDraftKey(workspaceKey); });
        return () => { cancelled = true; unsubscribe(); clearTimeout(draftTimer.current); persistDraft(); };
        // Drafts are scoped per shot; the mounted workbench keeps in-flight media tasks and model choices.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftScope, projectId, draftShotId]);
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unitId).slice().sort((left, right) => left.position - right.position), [detail.shots, unitId]);
    const shotIndex = selectedShot ? shots.findIndex((item) => item.id === selectedShot.id) : -1;
    const revision = currentRevision(detail, selectedShot);
    const artifactType = artifactTypeForStage(activeStage);
    const artifacts = useMemo(() => selectedShot ? (detail.shotArtifacts || []).filter((item) => item.shotId === selectedShot.id && item.type === artifactType).slice().sort((left, right) => right.version - left.version) : [], [artifactType, detail.shotArtifacts, selectedShot]);
    const shotTask = useMemo<GenerationTask | undefined>(() => {
        return (detail.tasks || []).filter((task) => task.clientContext?.shotId === selectedShot?.id && task.clientContext?.artifactType === artifactType).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    }, [artifactType, detail.tasks, selectedShot?.id]);
    useEffect(() => {
        if (shotTask?.status !== "queued" && shotTask?.status !== "running") return;
        const timer = window.setInterval(() => setTaskClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [shotTask?.status, shotTask?.id]);
    const shotTaskElapsed = shotTask ? formatTaskElapsed(Date.parse(shotTask.startedAt || shotTask.createdAt), taskClock) : "";
    const newestArtifact = artifacts.find((item) => item.selected) || artifacts[0];
    const previewArtifact = artifacts.find((item) => item.id === previewArtifactId) || newestArtifact;
    const generationCapability = activeStage === "video" ? "video" as const : "image" as const;
    const modelOptions = useMemo(() => selectableModelsByCapability(effectiveConfig, generationCapability), [effectiveConfig, generationCapability]);
    const segmentPlan = dramaPlanFromBeats(revision?.actionBeatsJson || "");
    const projectDefaultModel = generationCapability === "video" ? segmentPlan?.model || detail.project.defaultVideoModel : detail.project.defaultImageModel;
    const globalDefaultModel = shortDramaMediaDefault(effectiveConfig, generationCapability);
    const defaultModel = projectDefaultModel && configuredModelMatchesCapability(effectiveConfig, projectDefaultModel, generationCapability) ? projectDefaultModel : globalDefaultModel;
    const initialModel = defaultModel || modelOptions[0] || "";
    const [selectedModel, setSelectedModel] = useState(initialModel);
    const selectedModelRef = useRef(initialModel);
    const [aspectRatio, setAspectRatio] = useState(detail.project.aspectRatio || "16:9");
    const [resolution, setResolution] = useState("480");
    const [imageQuality, setImageQuality] = useState(effectiveConfig.quality || "auto");
    const [useVoiceSamples, setUseVoiceSamples] = useState(false);
    useEffect(() => setUseVoiceSamples(false), [projectId, unitId]);
    const { skills: availableSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const shotAssetReferenceContext = useMemo(() => buildShotAssetReferenceContext(detail, selectedShot?.id || ""), [detail, selectedShot?.id]);
    liveReferenceContext.current = shotAssetReferenceContext;
    const referenceByVersionId = useMemo(() => {
        const references = (detail.shotReferences || []).filter((reference) => reference.shotId === selectedShot?.id && reference.role === "reference" && reference.status === "linked");
        return new Map(references.flatMap((reference) => [
            [reference.assetVersionId, reference] as const,
            ...(reference.asset?.primaryVersionId ? [[reference.asset.primaryVersionId, reference] as const] : []),
        ]));
    }, [detail.shotReferences, selectedShot?.id]);
    const currentDurationSeconds = Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000));
    const generationSeconds = String(Math.max(1, Math.round(currentDurationSeconds)));
    const generationReferences = useMemo(() => generationCapability === "video" ? shotGenerationReferenceContext(shotSceneReferenceContext(watchedVideoPrompt || revision?.videoPrompt || "", shotAssetReferenceContext), useVoiceSamples) : shotAssetReferenceContext, [generationCapability, watchedVideoPrompt, revision?.videoPrompt, shotAssetReferenceContext, useVoiceSamples]);
    const generationReferenceAudios = generationCapability === "video" ? generationReferences.referenceAudios : [];
    const excludedReferenceNames = shotAssetReferenceContext.assetReferences.filter(reference => !generationReferences.assetReferences.some(selected => selected.assetId === reference.assetId)).map(reference => reference.title);
    const videoEditOperation = generationCapability === "video" && generationReferences.referenceImages.length ? "reference_to_video" : undefined;
    const modelRequirements = useMemo<ModelRequirements>(() => ({
        capability: generationCapability,
        input: { textCount: 1, imageCount: generationReferences.referenceImages.length, videoCount: 0, audioCount: generationReferenceAudios.length, characterCount: 0 },
        videoOperation: videoEditOperation,
        videoSeconds: generationCapability === "video" ? generationSeconds : undefined,
        imageSize: generationCapability === "image" ? aspectRatio : undefined,
        options: generationCapability === "video"
            ? { size: aspectRatio, vquality: resolution, videoSeconds: Number(generationSeconds) }
            : { size: aspectRatio, quality: imageQuality },
    }), [aspectRatio, generationCapability, generationReferenceAudios.length, generationSeconds, imageQuality, resolution, generationReferences.referenceImages.length, videoEditOperation]);
    const routedModel = resolveCompatibleModel(effectiveConfig, selectedModel, modelRequirements) || selectedModel;
    const activeProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, routedModel), [effectiveConfig, routedModel]);
    const videoProfile = generationCapability === "video" ? activeProfile.video : undefined;
    const imageProfile = generationCapability === "image" ? activeProfile.image : undefined;
    const videoBooleanOptions = useMemo(() => generationCapability === "video"
        ? resolveModelVideoBooleanOptions(effectiveConfig, routedModel, {}, {
              videoGenerateAudio: effectiveConfig.videoGenerateAudio,
              videoWatermark: effectiveConfig.videoWatermark,
          })
        : undefined, [effectiveConfig, generationCapability, routedModel]);
    const generationConfig = useMemo(() => ({
        ...effectiveConfig,
        model: routedModel,
        imageModel: generationCapability === "image" ? routedModel : effectiveConfig.imageModel,
        videoModel: generationCapability === "video" ? routedModel : effectiveConfig.videoModel,
        size: aspectRatio,
        quality: imageQuality,
        vquality: resolution,
        videoSeconds: generationSeconds,
        ...(videoBooleanOptions || {}),
    }), [aspectRatio, effectiveConfig, generationCapability, generationSeconds, imageQuality, resolution, routedModel, videoBooleanOptions]);
    const priceChannel = resolveModelChannel(generationConfig, routedModel);
    const configuredCredits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(routedModel),
        count: 1,
        seconds: generationCapability === "video" ? generationSeconds : 1,
        capability: generationCapability,
        config: generationConfig,
        requirements: modelRequirements,
    });
    const quoteRequest = useMemo(() => modelQuoteRequest(generationConfig, routedModel, generationCapability, modelRequirements), [generationCapability, generationConfig, modelRequirements, routedModel]);
    const quoteRequestKey = JSON.stringify(quoteRequest || null);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const generationCredits = routeQuote ? routeQuote.amountMicrocredits / 1_000_000 : configuredCredits;
    const formattedGenerationCredits = generationCredits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const modelSummary = routedModel ? modelDisplayName(effectiveConfig, routedModel) : "未选择模型";
    const durationSummary = `${Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000))}s`;
    const resolutionSummary = generationCapability === "video" ? formatVideoResolutionLabel(resolution) : imageQuality.toUpperCase();

    useEffect(() => {
        selectedModelRef.current = initialModel;
        setSelectedModel(initialModel);
        if (!initialModel) return;
        const profile = modelCapabilityConfigFor(effectiveConfig, initialModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: String(Math.max(1, (selectedShot?.durationMs || 15_000) / 1000)),
                ratio: detail.project.aspectRatio || effectiveConfig.size,
                resolution: /seedance-2[.-]5/i.test(modelOptionName(initialModel)) ? "480" : effectiveConfig.vquality,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
            // Model defaults must not rewrite the narrative duration or a local draft on polling.
        } else if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: detail.project.aspectRatio || effectiveConfig.size, quality: effectiveConfig.quality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    }, [detail.project.aspectRatio, effectiveConfig, form, generationCapability, initialModel]);

    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setRouteQuote(quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(null);
            });
        return () => controller.abort();
        // quoteRequestKey captures the normalized request without retriggering on object identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, quoteRequestKey]);

    useEffect(() => {
        const key = `${draftKey}:${revision?.id || ""}`;
        const referenceKey = JSON.stringify(shotAssetReferenceContext.mentionReferences.map(reference => [reference.assetId, reference.kind, reference.title]));
        if (hydratedShotRevisionKey.current === key || (hydratedShotRevisionKey.current && editorDirtyRef.current)) {
            if (hydratedReferenceKey.current === referenceKey) return;
            hydratedReferenceKey.current = referenceKey;
            // 自动关联或人工核对资产只补引用，不覆盖正在编辑的脚本。
            const currentPrompt = form.getFieldValue("videoPrompt") || "";
            const nextPrompt = ensureShotAssetMentionPrompt(currentPrompt, shotAssetReferenceContext.mentionReferences);
            if (nextPrompt !== currentPrompt) {
                form.setFieldValue("videoPrompt", nextPrompt);
                rememberEditor();
            }
            return;
        }
        hydratedShotRevisionKey.current = key;
        hydratedReferenceKey.current = referenceKey;
        const shotDurationSeconds = Math.max(0.5, (revision?.durationMs || selectedShot?.durationMs || 3000) / 1000);
        const normalizedDurationSeconds = shotDurationSeconds;
        const videoPrompt = ensureShotAssetMentionPrompt(revision?.videoPrompt || "", shotAssetReferenceContext.mentionReferences);
        form.setFieldsValue({
            title: normalizeDefaultShotTitle(selectedShot?.title, Math.max(0, shotIndex)),
            plotDescription: revision?.plotDescription || selectedShot?.description || "",
            action: revision?.action || "",
            dialogue: revision?.dialogue || "",
            shotSize: revision?.shotSize || "",
            cameraAngle: revision?.cameraAngle || "",
            cameraMovement: revision?.cameraMovement || "",
            durationSeconds: normalizedDurationSeconds,
            imagePrompt: revision?.imagePrompt || "",
            actionBoardPrompt: actionBoardPromptFromBeats(revision?.actionBeatsJson),
            videoPrompt,
            negativePrompt: revision?.negativePrompt || "",
            continuityNotes: revision?.continuityNotes || "",
        });
        setPreviewArtifactId("");
        setImagePreviewArtifact(null);
        setEditorDirty(!revision);
    }, [draftKey, effectiveConfig, form, generationCapability, initialModel, revision?.id, selectedShot?.id, shotAssetReferenceContext.mentionReferences]);

    const changeGenerationModel = (nextModel: string) => {
        const nextProfile = modelCapabilityConfigFor(effectiveConfig, nextModel);
        if (generationCapability === "video" && nextProfile.video && !videoDurationAllowed(nextProfile.video, Number(form.getFieldValue("durationSeconds") || generationSeconds))) {
            message.warning("该模型不支持当前剧情片段时长，请先重新划分片段或选择支持该时长的模型");
            return;
        }
        selectedModelRef.current = nextModel;
        setSelectedModel(nextModel);
        const profile = modelCapabilityConfigFor(effectiveConfig, nextModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: String(form.getFieldValue("durationSeconds") || generationSeconds),
                ratio: aspectRatio,
                resolution,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
            form.setFieldValue("durationSeconds", Number(normalized.seconds));
            return;
        }
        if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: aspectRatio, quality: imageQuality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    };

    const saveShot = useMutation({
        mutationFn: async (values: ShotEditorValues) => {
            if (!selectedShot) throw new Error("请先选择镜头");
            return saveProjectShot(projectId, {
                id: selectedShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: selectedShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: selectedShot.status,
                revision: revisionInput(values, revision?.actionBeatsJson),
            });
        },
        onSuccess: async (result, values) => { acknowledgeSavedValues(result.shot.id, values); await onRefresh(); message.success("镜头脚本已保存为新版本"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头保存失败"),
    });

    const acknowledgeSavedValues = (shotId: string, values: ShotEditorValues) => {
        const draft = shotDraftStore.peek(draftScope, projectId, shotId);
        if (draft?.values && JSON.stringify(draft.values) !== JSON.stringify(values)) return;
        shotDraftStore.update(draftScope, projectId, shotId, { values: undefined });
        if (activeShotIdRef.current === shotId && JSON.stringify(form.getFieldsValue()) === JSON.stringify(values)) setEditorDirty(false);
        void shotDraftStore.persist(draftScope, projectId, shotId).catch(() => message.warning("服务端已保存，本地草稿清理失败"));
    };

    const duplicateShot = useMutation({
        mutationFn: async () => {
            if (!selectedShot) throw new Error("请先选择镜头");
            const values = await form.validateFields();
            rememberDraft({ values });
            return saveProjectShot(projectId, { duplicateOf: selectedShot.id, unitId, title: `${values.title} · 副本`, description: values.plotDescription, durationMs: Math.round(values.durationSeconds * 1000), revision: revisionInput(values, revision?.actionBeatsJson) });
        },
        onSuccess: async result => { await onRefresh(); onSelectShot(result.shot.id); message.success("已创建独立副本，原镜头与产物已保留"); },
        onError: error => message.error(error instanceof Error ? error.message : "镜头复制失败"),
    });

    const deleteShot = useMutation({
        mutationFn: async ({ shotId }: { shotId: string; nextShotId: string }) => deleteProjectShot(projectId, shotId),
        onSuccess: async (_result, { nextShotId }) => {
            onSelectShot(nextShotId);
            await onRefresh();
            message.success("镜头已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头删除失败"),
    });

    const changeAssetBinding = useMutation({
        mutationFn: async ({ asset, reference }: { asset?: ProjectAsset; reference?: ShotAssetReference }) => {
            if (!selectedShot) throw new Error("请先选择镜头");
            if (reference) return unlinkShotAsset(projectId, selectedShot.id, reference.id);
            if (!asset?.primaryVersionId) throw new Error("该资产还没有可绑定版本");
            return linkShotAsset(projectId, selectedShot.id, { assetVersionId: asset.primaryVersionId, role: "reference" });
        },
        onSuccess: async (_result, variables) => { await onRefresh(); message.success(variables.reference ? "已取消当前镜头的资产引用" : "资产已绑定到当前镜头"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头资产更新失败"),
    });

    const associateShotAssets = async (shot: ProjectShot, text: string) => {
        const linked = new Set(detail.shotReferences.filter((reference) => reference.shotId === shot.id && reference.status === "linked").map((reference) => reference.assetVersionId));
        const candidates = inferShotVisualAssets(detail.assets, text).filter((asset) => !linked.has(asset.primaryVersionId!));
        if (!candidates.length) return;
        if (linked.size + candidates.length > 6) throw new Error("该片段匹配的参考资产超过 6 项，请从左侧资产栏核对选择");
        setAssociatingShotIds((current) => new Set(current).add(shot.id));
        try {
            for (const asset of candidates) await linkShotAsset(projectId, shot.id, { assetVersionId: asset.primaryVersionId!, role: "reference" });
            await onRefresh();
        } finally {
            setAssociatingShotIds((current) => { const next = new Set(current); next.delete(shot.id); return next; });
        }
    };

    useEffect(() => {
        if (!selectedShot || !detail.assets.length) return;
        const associationKey = JSON.stringify([draftScope, projectId, selectedShot.id]);
        if (checkedAssetShots.current.has(associationKey)) return;
        checkedAssetShots.current.add(associationKey);
        // 已有人工绑定保持原样；旧分镜第一次打开时补齐明确出现的视觉资产。
        if (detail.shotReferences.some((reference) => reference.shotId === selectedShot.id && reference.status === "linked")) return;
        const text = [revision?.plotDescription || selectedShot.description, revision?.videoPrompt, revision?.imagePrompt, revision?.action].filter(Boolean).join("\n");
        void associateShotAssets(selectedShot, text).catch((error) => message.error(error instanceof Error ? error.message : "自动关联资产失败，请核对后重试"));
        // 每张镜头只自动关联一次，后续保留人工取消和替换的选择。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftScope, projectId, selectedShot?.id, revision?.id, detail.assets, detail.shotReferences]);

    const generateArtifact = async (preparedImage?: PreparedShotImage): Promise<boolean> => {
        if (!selectedShot || submittingShotIds.has(selectedShot.id) || assetsAssociating) return false;
        if (generationCapability === "image" && !preparedImage) {
            try {
                const values = await form.validateFields();
                setImageConfirmation({ shotId: selectedShot.id, stage: activeStage, context: shotAssetReferenceContext, values: structuredClone(values), configKey: JSON.stringify(generationConfig) });
            } catch { /* Ant Design displays field validation errors inline. */ }
            return false;
        }
        if (preparedImage && (imageConfirmation?.shotId !== selectedShot.id || imageConfirmation.stage !== activeStage)) return false;
        const submittingShot = selectedShot;
        setSubmittingShotIds((current) => new Set(current).add(submittingShot.id));
        try {
            if (preparedImage && imageConfirmation?.configKey !== JSON.stringify(generationConfig)) throw new Error("生成设置已变化，请关闭确认窗口后重新准备");
            const values = preparedImage ? imageConfirmation!.values : await form.validateFields();
            let productionStep = workflowStep;
            if (!productionStep) {
                const initialized = await createUnitWorkflow(projectId, unitId);
                productionStep = (initialized.workflow.steps || []).find((step) => step.stepKey === activeStage);
            }
            if (!productionStep) throw new Error("当前生成阶段不可用，请刷新页面后重试");
            if (!routedModel) throw new Error(activeStage === "video" ? "请先配置视频模型" : "请先配置图片模型");
            const submittedRequirements: ModelRequirements = preparedImage ? { ...modelRequirements, input: { textCount: 1, videoCount: 0, characterCount: 0, imageCount: preparedImage.context.referenceImages.length, audioCount: 0 } } : modelRequirements;
            const compatibilityError = modelCompatibilityError(effectiveConfig, routedModel, submittedRequirements);
            if (compatibilityError) throw new Error(`当前模型配置不可用：${compatibilityError}`);
            if (productionStep.status === "failed") await updateWorkflowStep(projectId, productionStep.id, { status: "ready", error: "", outputJson: productionStep.outputJson });
            const saved = await saveProjectShot(projectId, {
                id: submittingShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: submittingShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: submittingShot.status,
                revision: revisionInput(values, revision?.actionBeatsJson),
            });
            acknowledgeSavedValues(saved.shot.id, values);
            const mode = generationCapability;
            const config = { ...generationConfig, videoSeconds: String(Math.max(1, Math.round(values.durationSeconds))) };
            if (!isAiConfigReady(config, routedModel)) throw new Error("当前模型渠道配置不完整，请先到设置中补齐");
            const basePrompt = shotArtifactPrompt(activeStage, values, resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson)?.prompt);
            const skillExecution = mode === "video"
                ? prepareShotVideoExecution(basePrompt, shotAssetReferenceContext, { dialogue: values.dialogue, useVoiceSamples, projectAssets: detail.assets })
                : preparedImage!.execution;
            const submittedReferences = preparedImage?.context || ("context" in skillExecution ? skillExecution.context : shotAssetReferenceContext);
            const referenceTransport = preparedImage ? { mode: preparedImage.transfer.mode, originalBytes: preparedImage.transfer.originalBytes, submittedBytes: preparedImage.transfer.submittedBytes, images: preparedImage.transfer.records } : undefined;
            await submitBackendGenerationTask({
                projectId,
                mode,
                ...(preparedImage ? { clientOperationId: preparedImage.operationId } : {}),
                prompt: skillExecution.prompt,
                config,
                referenceImages: submittedReferences.referenceImages,
                referenceAudios: mode === "video" ? submittedReferences.referenceAudios : [],
                metadata: {
                    ...skillExecution.metadata,
                    workflowStepId: productionStep.id,
                    domainProjectId: projectId,
                    unitId,
                    shotId: saved.shot.id,
                    shotRevisionId: saved.shot.currentRevisionId,
                    artifactType,
                    role: "output",
                    source: "short-drama-workflow",
                    ...(mode === "video" && submittedReferences.referenceImages.length ? { videoEditOperation: "reference_to_video" } : {}),
                    resolvedCharacterVersions: submittedReferences.resolvedCharacterVersions,
                    ...(referenceTransport ? { referenceTransport } : {}),
                    artifactMetadata: { model: routedModel, aspectRatio, resolution, durationSeconds: values.durationSeconds, actualPrompt: skillExecution.prompt, ...skillExecution.metadata, ...(referenceTransport ? { referenceTransport } : {}) },
                },
            });
            await onRefresh();
            message.success(`${productionStageCopy[activeStage as "storyboard" | "previz" | "video"].label}任务已提交`);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成任务提交失败");
            return false;
        } finally {
            setSubmittingShotIds((current) => {
                const next = new Set(current);
                next.delete(submittingShot.id);
                return next;
            });
        }
    };

    const stageCopy = productionStageCopy[activeStage as "storyboard" | "previz" | "video"];
    const selectedShotSubmitting = submittingShotIds.has(selectedShot?.id || "");

    if (!selectedShot) {
        return <div className="workflow-empty-shot"><EmptyState size="compact" title="当前章节还没有分镜" action={<Button type="primary" icon={<Plus className="size-4" />} loading={addingShot} onClick={onAddShot}>新增第一个分镜</Button>} /></div>;
    }

    const inspectPrompt = async (historical = false) => {
        try {
            if (historical && previewArtifact?.taskId) {
                const task = await queryGenerationTask(previewArtifact.taskId);
                setPromptPreview({ title: `${stageCopy.label} · v${previewArtifact.version} · 生成时提示词`, text: task.prompt });
                return;
            }
            const values = form.getFieldsValue();
            const base = shotArtifactPrompt(activeStage, values, resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson)?.prompt);
            const prepared = generationCapability === "video"
                ? prepareShotVideoExecution(base, shotAssetReferenceContext, { dialogue: values.dialogue, useVoiceSamples })
                : await skillRuntime.prepare({ profile: "shortDrama", prompt: resolveShotAssetMentionPrompt(base, shotAssetReferenceContext, { dialogue: values.dialogue }), skills: availableSkills, selectedSkillIds: rewriteSkillIds });
            setPromptPreview({ title: `${stageCopy.label} · 本次将提交的提示词`, text: prepared.prompt });
        } catch (error) { message.error(error instanceof Error ? error.message : "提示词读取失败"); }
    };
    const rewritePrompt = async () => {
        if (rewriting || !rewriteNotes.trim()) return;
        if (!shotDraftStore.beginRewrite(draftScope, projectId, selectedShot.id)) return;
        const values = form.getFieldsValue();
        const original = values.videoPrompt || "";
        const shotId = selectedShot.id;
        const workspaceKey = draftKey;
        setRewriting(true);
        setRewriteResult(null);
        rememberDraft({ result: null });
        setRewriteStatus("正在提交提示词修改任务…");
        try {
            const result = await rewriteShotVideoPrompt({ projectId, unitId: selectedShot.unitId, shotId, config: { ...effectiveConfig, model: "", textModel: "" }, notes: rewriteNotes, seconds: values.durationSeconds, facts: { projectName: detail.project.name, projectStyle: resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson), current: values, previous: shots[shotIndex - 1] ? currentRevision(detail, shots[shotIndex - 1]) : null, next: shots[shotIndex + 1] ? currentRevision(detail, shots[shotIndex + 1]) : null, references: shotAssetReferenceContext.assetReferences }, skills: availableSkills, skillIds: rewriteSkillIds, actionDirection: rewriteDirection, onFallback: text => message.warning(text), onTask: task => { if (activeWorkspaceKey.current === workspaceKey) setRewriteStatus(`${task.stage || (task.status === "queued" ? "排队中" : "正在重写提示词")} · ${task.id.slice(0, 8)}`); } });
            resolveShotAssetMentionPrompt(result.text, shotAssetReferenceContext, { dialogue: values.dialogue });
            const suggestion = { shotId, original, seconds: Number(values.durationSeconds), text: ensureShotAssetMentionPrompt(result.text, shotAssetReferenceContext.mentionReferences), ...(result.lockedDialogue === undefined ? {} : { originalDialogue: values.dialogue || "", lockedDialogue: result.lockedDialogue }) };
            if (activeWorkspaceKey.current === workspaceKey) setRewriteResult(suggestion);
            rememberDraft({ result: suggestion });
            if (activeWorkspaceKey.current === workspaceKey) setRewriteStatus("重写完成，请检查后应用；原提示词和视频仍保留");
        } catch (error) { if (activeWorkspaceKey.current === workspaceKey) setRewriteStatus(error instanceof Error ? error.message : "提示词重写失败"); }
        finally { shotDraftStore.endRewrite(draftScope, projectId, shotId); if (activeWorkspaceKey.current === workspaceKey) setRewriting(false); }
    };
    const applyRewrite = () => {
        if (!rewriteResult || !canApplyShotRewrite(rewriteResult, selectedShot.id, form.getFieldsValue())) return message.warning("生成建议后正文或时长又有修改，请重新生成建议，避免覆盖新内容");
        form.setFieldValue("videoPrompt", ensureShotAssetMentionPrompt(rewriteResult.text, shotAssetReferenceContext.mentionReferences));
        if (rewriteResult.lockedDialogue !== undefined) form.setFieldValue("dialogue", rewriteResult.lockedDialogue);
        rememberEditor();
        setRewriteOpen(false);
        message.success("已应用到编辑区，请保存镜头脚本后生成视频");
    };

    const requestShotSelection = (nextShotId: string) => {
        if (nextShotId === selectedShot.id) return;
        if (editorDirty) rememberDraft({ values: form.getFieldsValue() });
        onSelectShot(nextShotId);
    };

    const requestAddShot = () => {
        if (editorDirty) rememberDraft({ values: form.getFieldsValue() });
        onAddShot();
    };

    const requestDeleteShot = () => {
        const nextShot = shots[shotIndex + 1] || shots[shotIndex - 1];
        modal.confirm({
            title: `删除镜头“${watchedTitle || selectedShot.title || "未命名镜头"}”？`,
            content: editorDirty
                ? "该镜头的未保存修改、脚本版本、资产引用和生成产物都会被删除，且无法恢复。"
                : "该镜头的脚本版本、资产引用和生成产物都会被删除，且无法恢复。",
            okText: "删除镜头",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: () => deleteShot.mutateAsync({ shotId: selectedShot.id, nextShotId: nextShot?.id || "" }),
        });
    };

    const selectRelativeShot = (offset: number) => {
        const next = shots[shotIndex + offset];
        if (next) requestShotSelection(next.id);
    };

    return (
        <div className="workflow-production-shell">
            <div className="workflow-production-main">
                <aside className="workflow-library-panel">
                        <SegmentedControl
                        block
                        size="sm"
                        value={leftTab}
                        onChange={(value) => setLeftTab(value as typeof leftTab)}
                        options={[{ value: "episodes", label: "章节" }, { value: "shots", label: "镜头" }, { value: "assets", label: "资产" }]}
                    />
                    <div className="workflow-library-scroll thin-scrollbar">
                        {leftTab === "assets" ? <AssetLibrary detail={detail} referenceByVersionId={referenceByVersionId} changing={changeAssetBinding.isPending} onToggle={(asset, reference) => changeAssetBinding.mutate({ asset, reference })} /> : null}
                        {leftTab === "episodes" ? <EpisodeLibrary detail={detail} activeUnitId={unitId} projectId={projectId} activeStage={activeStage} /> : null}
                        {leftTab === "shots" ? <ShotLibrary detail={detail} shots={shots} selectedShotId={selectedShot.id} onSelectShot={requestShotSelection} /> : null}
                    </div>
                </aside>

                <section className="workflow-shot-editor">
                    <header className="workflow-panel-header">
                        <div className="workflow-shot-heading">
                            <span className="workflow-shot-number">{formatShotOrdinal(shotIndex)}</span>
                            {customShotTitle(watchedTitle || selectedShot.title, shotIndex) ? <h2>{customShotTitle(watchedTitle || selectedShot.title, shotIndex)}</h2> : null}
                            <StatusBadge tone={saveShot.isPending ? "loading" : editorDirty ? "warning" : revision ? "success" : "neutral"} label={!draftReady ? "读取草稿中" : saveShot.isPending ? "保存中" : editorDirty ? "本地草稿 · 待保存" : revision ? "已保存" : "草稿"} className="m-0" />
                        </div>
                        <div className="flex items-center gap-1"><span className="mr-1 text-[var(--fs-micro)] text-foreground/45">{shotIndex + 1} / {shots.length}</span><Button type="text" size="small" icon={<ChevronLeft className="size-4" />} disabled={shotIndex <= 0} onClick={() => selectRelativeShot(-1)} aria-label="上一个镜头" /><Button type="text" size="small" icon={<ChevronRight className="size-4" />} disabled={shotIndex >= shots.length - 1} onClick={() => selectRelativeShot(1)} aria-label="下一个镜头" /></div>
                    </header>
                    <Form form={form} disabled={!draftReady} layout="vertical" className="workflow-shot-form" onValuesChange={rememberEditor} onFinish={(values) => saveShot.mutate(values)}>
                        <div className="workflow-shot-form-scroll thin-scrollbar">
                            <div className="workflow-form-section-heading"><span>镜头脚本</span><small>先写清镜头里发生什么，再调整生成参数</small></div>
                            <Form.Item name="title" label="镜头名称" rules={[{ required: true, message: "请输入镜头名称" }]}><Input placeholder="用一句话概括这个镜头" /></Form.Item>
                            <Form.Item name="videoPrompt" label="视频提示词" rules={[{ required: true, message: "请输入视频提示词" }]}><ShotAssetMentionTextarea references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                            <div className="mb-3 flex flex-wrap gap-2"><Button size="small" onClick={() => setRewriteOpen(true)}>提修改意见 / 用 Skill 重写提示词</Button><Button size="small" onClick={() => void inspectPrompt()}>查看{stageCopy.label}完整 Prompt</Button>{activeStage === "video" && <Button size="small" disabled={editorDirty || selectedShotSubmitting} onClick={() => setVideoBatchOpen(true)}>批量生成镜头视频</Button>}</div>
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-foreground/60"><span>{assetsAssociating ? "正在自动关联本片段的图片资产…" : "根据片段匹配角色、场景和道具；可从左侧资产栏核对调整"}</span><Button size="small" loading={assetsAssociating} disabled={changeAssetBinding.isPending} onClick={() => void associateShotAssets(selectedShot, [form.getFieldValue("plotDescription"), form.getFieldValue("videoPrompt"), form.getFieldValue("action")].join("\n")).catch((error) => message.error(error instanceof Error ? error.message : "自动关联资产失败"))}>重新匹配资产</Button></div>
                            <BoundAssets detail={detail} shotId={selectedShot.id} changing={changeAssetBinding.isPending || assetsAssociating} onUnlink={(reference) => changeAssetBinding.mutate({ reference })} />
                            <div className="workflow-form-grid">
                                <Form.Item name="action" label="表演与动作"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="按动作节拍描述人物表演、走位和物体运动" /></Form.Item>
                                <Form.Item name="dialogue" label="对白 / 旁白"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="填写对白、旁白或需要保留的声音信息" /></Form.Item>
                            </div>
                            <WorkflowDisclosure
                                icon={<SlidersHorizontal />}
                                title="生成设置"
                                description="生成规格与镜头语言"
                                summary={<><span>{durationSummary}</span><span>{aspectRatio}</span><span>{resolutionSummary}</span><span className="is-model">{modelSummary}</span></>}
                            >
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">生成规格</div>
                                    <Form.Item label="生成模型">
                                        <ModelPicker
                                            config={generationConfig}
                                            value={selectedModel}
                                            capability={generationCapability}
                                            requirements={modelRequirements}
                                            onChange={changeGenerationModel}
                                            fullWidth
                                            className="workflow-model-picker"
                                            placeholder={activeStage === "video" ? "选择视频模型" : "选择图片模型"}
                                            showSelectedPrice
                                        />
                                    </Form.Item>
                                    <Form.Item label="提示词重写技能" extra="先通过“用 Skill 重写提示词”检查并应用；视频模型只接收编辑区的最终提示词。"><SkillRuntimePicker profile="shortDrama" skills={availableSkills} loading={skillsLoading} value={rewriteSkillIds} onChange={setRewriteSkillIds} /></Form.Item>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="durationSeconds" label="镜头时长（秒）">
                                            {generationCapability === "video" && videoProfile?.duration.selection === "enum"
                                                ? <Select options={videoDurationOptions(videoProfile).map((value) => ({ value, label: `${value} 秒` }))} />
                                                : <InputNumber className="w-full" min={generationCapability === "video" ? videoProfile?.duration.min || 1 : 0.5} max={generationCapability === "video" ? videoProfile?.duration.max || 60 : 60} step={generationCapability === "video" ? videoProfile?.duration.step || 1 : 0.5} />}
                                        </Form.Item>
                                        {generationCapability === "video" ? <Form.Item label="画幅"><Select value={aspectRatio} onChange={setAspectRatio} options={(videoProfile?.ratios || []).map((value) => ({value, label:value}))} /></Form.Item> : null}
                                        {generationCapability === "video" ? (
                                            <Form.Item label="分辨率"><Select value={resolution} onChange={setResolution} options={(videoProfile?.resolutions || []).map((value) => ({ value, label: formatVideoResolutionLabel(value) }))} /></Form.Item>
                                        ) : imageProfile?.quality.supported && !imageResolutionUsesQuality(imageProfile) ? (
                                            <Form.Item label="生成画质"><Select value={imageQuality} onChange={setImageQuality} options={imageProfile.quality.values.map((value) => ({ value, label: imageQualityLabel(value) }))} /></Form.Item>
                                        ) : <div />}
                                    </div>
                                    {generationCapability === "video" && excludedReferenceNames.length > 0 ? <p className="mb-3 text-xs text-foreground/60">本次按正文的出场限制，不发送这些角色参考：{excludedReferenceNames.join("、")}。项目资产仍保留；可在完整 Prompt 中核对实际参考。</p> : null}
                                    {generationCapability === "video" && shotAssetReferenceContext.referenceAudios.length > 0 ? <div className="mb-3 text-xs"><Checkbox checked={useVoiceSamples} onChange={event => setUseVoiceSamples(event.target.checked)}>使用已绑定角色的声音样本（仅参考音色）</Checkbox><p className="mt-1 text-foreground/60">{useVoiceSamples ? `本次使用 ${generationReferenceAudios.length} 个声音样本，仅参考音色，只演本镜头台词。请核对样本。` : "注意：本次不发送已绑定声音样本，仅按文字声线生成；生成声音可能与所绑定样本不同。勾选上方选项后才会发送样音。"}</p></div> : null}
                                    {generationCapability === "image" && imageProfile ? <ImageSizePicker profile={imageProfile} size={aspectRatio} quality={imageQuality} onChange={(size, quality) => { setAspectRatio(size); if (quality) setImageQuality(quality); }} /> : null}
                                </div>
                                <div className="workflow-settings-section">
                                    <div className="workflow-settings-section-title">镜头语言</div>
                                    <div className="workflow-form-grid is-three">
                                        <Form.Item name="shotSize" label="景别"><Select allowClear placeholder="自动" options={["特写", "近景", "中景", "全景", "远景"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraAngle" label="机位角度"><Select allowClear placeholder="自动" options={["平视", "俯拍", "仰拍", "侧面", "过肩"].map((value) => ({ value, label: value }))} /></Form.Item>
                                        <Form.Item name="cameraMovement" label="运镜方式"><Select allowClear placeholder="自动" options={["固定", "推镜", "拉镜", "摇镜", "移镜", "跟拍"].map((value) => ({ value, label: value }))} /></Form.Item>
                                    </div>
                                </div>
                            </WorkflowDisclosure>
                            <WorkflowDisclosure
                                className="is-advanced"
                                icon={<WandSparkles />}
                                title="生成补充"
                                description="仅在模型需要额外约束时填写"
                                summary={<span>提示词 · 排除内容 · 接戏</span>}
                            >
                                <div className="workflow-form-grid">
                                    <Form.Item name="plotDescription" label="镜头画面" rules={[{ required: true, message: "请输入镜头画面" }]}><ShotAssetMentionTextarea variant="scene" references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                                    <Form.Item name="imagePrompt" label="画面提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="留空时根据镜头画面自动生成" /></Form.Item>
                                    <Form.Item name="actionBoardPrompt" label="动作黑白预演提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="选填；留空时按本镜头动作、接戏备注生成黑白动作预演" /></Form.Item>
                                    <Form.Item name="negativePrompt" label="排除内容"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写不希望出现的元素、动作或画面问题" /></Form.Item>
                                    <Form.Item name="continuityNotes" label="接戏备注"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="记录人物位置、朝向、服装、道具及前后镜延续关系" /></Form.Item>
                                </div>
                            </WorkflowDisclosure>
                        </div>
                        <footer className="workflow-editor-actions">
                            <div className="workflow-generation-cost" aria-live="polite">
                                <FGPricePreview config={generationConfig} model={routedModel} mode={generationCapability} requirements={modelRequirements} />
                                {creditsEnabled && formattedGenerationCredits ? <><CreditSymbol /><span title={routeQuote ? modelQuoteDescription(routeQuote) : undefined}>本次{routeQuote?.estimated ? "预估" : "费用"} {formattedGenerationCredits} 积分</span></> : creditsEnabled && routedModel ? <span>本次费用将在提交时按实际规格计算</span> : null}
                            </div>
                            <div className="flex items-center gap-2"><Button danger icon={<Trash2 className="size-4" />} loading={deleteShot.isPending} disabled={saveShot.isPending || selectedShotSubmitting || changeAssetBinding.isPending} onClick={requestDeleteShot}>删除镜头</Button><Button icon={<Copy className="size-4" />} loading={duplicateShot.isPending} disabled={deleteShot.isPending || !draftReady} onClick={() => duplicateShot.mutate()}>创建副本</Button><Button htmlType="submit" icon={<Save className="size-4" />} loading={saveShot.isPending} disabled={!editorDirty || deleteShot.isPending}>保存脚本</Button><Button type="primary" icon={<Play className="size-4" />} loading={selectedShotSubmitting || shotTask?.status === "queued" || shotTask?.status === "running"} disabled={deleteShot.isPending} onClick={() => void generateArtifact()}>{selectedShotSubmitting ? `${stageCopy.action}（正在提交）` : shotTask?.status === "queued" || shotTask?.status === "running" ? `${stageCopy.action}（已运行${shotTaskElapsed}）` : shotTask?.status === "failed" ? `${stageCopy.action}（上次失败，可重试）` : shotTask?.status === "succeeded" && !newestArtifact ? `${stageCopy.action}（已完成，正在同步）` : newestArtifact ? `${stageCopy.action}（已生成）` : stageCopy.action}</Button></div>
                        </footer>
                    </Form>
                </section>

                <aside className="workflow-preview-panel">
                    <header className="workflow-preview-header">
                        <div className="workflow-preview-header-row">
                            <div className="workflow-preview-title"><Film className="size-4 shrink-0" /><span>产物预览</span></div>
<SegmentedControl size="sm" value={previewTab} onChange={(value) => setPreviewTab(value as typeof previewTab)} options={[{ value: "latest", label: "最新" }, { value: "history", label: `历史 ${artifacts.length}` }]} />
                        </div>
<SegmentedControl
                            block
                            size="sm"
                            className="workflow-preview-stage-switch"
                            value={activeStage}
                            options={[{ value: "storyboard", label: "分镜图" }, { value: "previz", label: "动作预演" }, { value: "video", label: "镜头视频" }]}
                            onChange={(nextStage) => navigate(`/projects/${projectId}/workflow/${unitId}/${nextStage}`)}
                        />
                    </header>
                    <div className="workflow-preview-scroll thin-scrollbar">
                        {generationCapability === "image" && shotTask?.status === "failed" && /\b413\b|request entity too large|payload too large/i.test(`${shotTask.errorCode || ""} ${shotTask.error || ""}`) && <Alert type="warning" title="上次参考图上传包过大（413）" description="点击重新生成，先勾选本次参考图并使用优化传输；原始资产和视频绑定保留。" action={<Button size="small" onClick={() => void generateArtifact()}>调整参考图并重试</Button>} />}
                        {previewTab === "latest" ? <LatestPreview artifact={previewArtifact} emptyText={stageCopy.empty} onPreviewImage={setImagePreviewArtifact} /> : <ArtifactHistory artifacts={artifacts} activeId={previewArtifact?.id} onSelect={(artifact) => { setPreviewArtifactId(artifact.id); setPreviewTab("latest"); }} />}
                        <div className="workflow-preview-summary"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">当前产物</span><ArtifactStatus artifact={newestArtifact} compact /></div><div className="mt-1 text-[var(--fs-micro)] text-foreground/45">{newestArtifact ? `${formatDuration(selectedShot.durationMs)} · ${resolution}p · v${newestArtifact.version}` : "当前镜头还没有生成产物"}</div></div>
                        <div className="workflow-preview-actions"><Button icon={<RefreshCcw className="size-3.5" />} loading={selectedShotSubmitting || shotTask?.status === "queued" || shotTask?.status === "running"} onClick={() => void generateArtifact()}>重新生成</Button><Button disabled={!previewArtifact?.taskId} onClick={() => void inspectPrompt(true)}>生成时 Prompt</Button><Button icon={<Download className="size-3.5" />} disabled={!previewArtifact?.resourceId} onClick={() => previewArtifact?.resourceId && void downloadArtifact(previewArtifact, `${detail.units.find(unit => unit.id === unitId)?.title || "本集"}-${selectedShot.title}`, message.error)}>下载{activeStage === "video" ? "视频" : "图片"}</Button></div>
                        <ArtifactHistory artifacts={artifacts.slice(0, 4)} activeId={previewArtifact?.id} onSelect={(artifact) => setPreviewArtifactId(artifact.id)} compact />
                    </div>
                </aside>
            </div>

            {imageConfirmation && imageConfirmation.shotId === selectedShot.id && imageConfirmation.stage === activeStage && <ShotImageGenerationModal
                key={`${projectId}:${unitId}:${selectedShot.id}:${activeStage}`}
                title={stageCopy.label} context={imageConfirmation.context} config={generationConfig} requirements={modelRequirements}
                onClose={() => setImageConfirmation(null)}
                onPreparePrompt={async context => {
                    const values = imageConfirmation.values;
                    const base = shotArtifactPrompt(activeStage, values, resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson)?.prompt);
                    const scopedPrompt = ensureShotAssetMentionPrompt(base, context.mentionReferences);
                    return skillRuntime.prepare({ profile: "shortDrama", prompt: resolveShotAssetMentionPrompt(scopedPrompt, context, { dialogue: values.dialogue }), skills: availableSkills, selectedSkillIds: rewriteSkillIds });
                }}
                onConfirm={generateArtifact}
            />}
            <AppModal
                flush
                open={Boolean(imagePreviewArtifact?.resourceId)}
                title={imagePreviewArtifact?.type === "action_board" ? "动作预演预览" : "分镜图预览"}
                footer={null}
                centered
                width="min(960px, calc(100vw - 32px))"
                onCancel={() => setImagePreviewArtifact(null)}
            >
                {imagePreviewArtifact?.resourceId ? <img className={`workflow-image-preview-modal ${imagePreviewArtifact.type === "action_board" ? "grayscale" : ""}`} src={resourceFileUrl(imagePreviewArtifact.resourceId)} alt={imagePreviewArtifact.type === "action_board" ? "动作预演大图" : "分镜图大图"} /> : null}
            </AppModal>

            {activeStage === "video" && <ShotVideoBatchModal open={videoBatchOpen} detail={detail} key={`${projectId}:${unitId}`} unitId={unitId} config={generationConfig} onClose={() => setVideoBatchOpen(false)} onRefresh={onRefresh} />}
            <AppModal open={Boolean(promptPreview)} title={promptPreview?.title} width={960} onCancel={() => setPromptPreview(null)} footer={<Button onClick={() => setPromptPreview(null)}>关闭</Button>}>
                <Input.TextArea readOnly value={promptPreview?.text || ""} autoSize={{ minRows: 14, maxRows: 26 }} aria-label="完整生成提示词" />
            </AppModal>
            <AppModal open={rewriteOpen} title="修改视频提示词" width={880} onCancel={() => setRewriteOpen(false)} footer={<><Button onClick={() => setRewriteOpen(false)}>关闭</Button><Button loading={rewriting} disabled={!rewriteNotes.trim()} onClick={() => void rewritePrompt()}>生成修改建议</Button><Button type="primary" disabled={!rewriteResult || rewriting || rewriteResult.shotId !== selectedShot.id} onClick={applyRewrite}>检查后应用到编辑区</Button></>}>
                <div className="grid gap-3">
                    <p className="text-xs text-foreground/60">默认使用剧本转分镜 Skill，可补选其他技能。只重写文字，检查并保存后再单独生成视频。个人 GPT 优先，无 Key 或明确额度不足时使用 Sonnet 5.5，按公司额度计费。</p>
                    <p className="text-xs text-foreground/60">修改意见与建议只保存在当前镜头；切换镜头后可回来继续编辑。</p>
                    <Input.TextArea value={rewriteNotes} disabled={rewriting || !draftReady} onChange={event => { setRewriteNotes(event.target.value); rememberDraft({ notes: event.target.value }); }} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="例如：起步和反应更快，去掉重复环顾；保留对白；从上一段右手持灯的姿态继续，镜头跟随转身；命中时加短促飞屑和光反射。" />
                    <SkillRuntimePicker skills={availableSkills} loading={skillsLoading} value={rewriteSkillIds} onChange={ids => { setRewriteSkillIds(ids); rememberDraft({ skillIds: ids }); }} profile="shortDrama" />
                    <Input.TextArea value={rewriteDirection} disabled={rewriting || !draftReady} onChange={event => { setRewriteDirection(event.target.value); rememberDraft({ direction: event.target.value }); }} placeholder="有打戏时填写并确认打法、能力、强度、环境和禁用项；填写后加载 wuxi-action-director-public" />
                    {rewriteStatus && <div role="status" className="text-xs">{rewriteStatus}</div>}
                    {rewriteResult && <Input.TextArea value={rewriteResult.text} readOnly autoSize={{ minRows: 12, maxRows: 24 }} aria-label="重写后的视频提示词" />}
                </div>
            </AppModal>
            <ShotTimeline activeStage={activeStage} detail={detail} shots={shots} selectedShotId={selectedShot.id} submittingShotIds={submittingShotIds} onSelectShot={requestShotSelection} onAddShot={requestAddShot} addingShot={addingShot} />
        </div>
    );
}

function formatTaskElapsed(startedAt: number, now: number) {
    const totalSeconds = Math.max(0, Math.floor((now - (Number.isFinite(startedAt) ? startedAt : now)) / 1_000));
    return `${Math.floor(totalSeconds / 60)}分钟${String(totalSeconds % 60).padStart(2, "0")}秒`;
}

function WorkflowDisclosure({ icon, title, description, summary, className = "", children }: { icon: ReactNode; title: string; description: string; summary: ReactNode; className?: string; children: ReactNode }) {
    return (
        <details className={`workflow-disclosure ${className}`}>
            <summary>
                <span className="workflow-disclosure-heading"><span className="workflow-disclosure-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></span>
                <span className="workflow-disclosure-summary">{summary}<ChevronDown className="workflow-disclosure-chevron" /></span>
            </summary>
            <div className="workflow-disclosure-body"><div className="workflow-disclosure-content">{children}</div></div>
        </details>
    );
}

function AssetLibrary({ detail, referenceByVersionId, changing, onToggle }: { detail: ProjectDetail; referenceByVersionId: Map<string, ShotAssetReference>; changing: boolean; onToggle: (asset: ProjectAsset, reference?: ShotAssetReference) => void }) {
    const [category, setCategory] = useState("all");
    const [sourceUnitId, setSourceUnitId] = useState("");
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const [page, setPage] = useState(1);
    const pageSize = 30;
    const assetsQuery = useQuery({
        queryKey: ["project", detail.project.id, "assets", "workflow-library", category, sourceUnitId, debouncedKeyword, page, pageSize],
        queryFn: () => listProjectAssetsPage(detail.project.id, { page, pageSize, category: category === "all" ? undefined : category, unitId: sourceUnitId || undefined, query: debouncedKeyword || undefined }),
    });
    useEffect(() => setPage(1), [debouncedKeyword]);
    const assetsPage = assetsQuery.data?.assets || [];
    const groups = useMemo(() => {
        const map = new Map<string, ProjectAsset[]>();
        assetsPage.forEach((asset) => map.set(asset.category || "other", [...(map.get(asset.category || "other") || []), asset]));
        return Array.from(map.entries());
    }, [assetsPage]);
    const total = assetsQuery.data?.total || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return <div className="workflow-asset-groups"><Input allowClear size="small" className="mb-2 w-full" value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<Search className="size-3.5 text-foreground/35" />} placeholder="搜索资产名称" aria-label="搜索镜头资产" /><Select size="small" className="mb-2 w-full" aria-label="按章节筛选素材" value={sourceUnitId} options={[{ value: "", label: "全部章节 / 共享资产" }, ...detail.units.slice().sort((a, b) => a.position - b.position).map(unit => ({ value: unit.id, label: unit.title }))]} onChange={value => { setSourceUnitId(value); setPage(1); }} /><Select size="small" className="mb-2 w-full" value={category} options={[{ value: "all", label: `全部资产（${Object.values(assetsQuery.data?.categoryCounts || {}).reduce((sum, count) => sum + count, 0)}）` }, ...Object.entries(assetsQuery.data?.categoryCounts || {}).filter(([, count]) => count > 0).map(([value, count]) => ({ value, label: `${assetCategoryLabel(value)}（${count}）` }))]} onChange={(value) => { setCategory(value); setPage(1); }} />{assetsQuery.isLoading ? <div className="py-6 text-center text-xs text-foreground/45">正在读取资产…</div> : groups.length ? groups.map(([groupCategory, assets]) => <section key={groupCategory}><h3>{assetCategoryLabel(groupCategory)} <span>({assets.length})</span></h3><div className="workflow-asset-list">{assets.map((asset) => { const reference = asset.primaryVersionId ? referenceByVersionId.get(asset.primaryVersionId) : undefined; const active = Boolean(reference); const previewUrl = assetPreviewUrl(asset); return <button key={asset.id} type="button" className={`workflow-asset-row ${active ? "is-active" : ""}`} disabled={changing || !asset.primaryVersionId} aria-pressed={active} onClick={() => onToggle(asset, reference)}><span className="workflow-asset-thumb">{asset.mediaType === "video" && asset.storageKey ? <VideoMediaPreview storageKey={asset.storageKey} alt={asset.title} className="h-full w-full" fallback={<Film />} /> : previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : asset.category === "character" ? <UsersRound /> : asset.mediaType === "image" ? <ImageIcon /> : <Box />}</span><span className="min-w-0 flex-1"><strong title={asset.title}>{asset.title}</strong><small>{active ? "已绑定 · 点击取消" : `${assetCategoryLabel(asset.category)} · v${Math.max(1, asset.versionCount)}`}</small></span>{active ? <span className="workflow-bound-dot" /> : null}</button>; })}</div></section>) : <EmptyState size="compact" title={debouncedKeyword ? "没有找到匹配资产" : "项目还没有资产"} />}{total > pageSize ? <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[var(--fs-micro)] text-foreground/45"><span>{page}/{pages} · 共 {total} 项</span><span className="flex gap-1"><Button type="text" size="small" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} /><Button type="text" size="small" icon={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} /></span></div> : null}</div>;
}

function ShotAssetMentionTextarea({ value = "", onChange = () => undefined, references, variant = "motion" }: { value?: string; onChange?: (value: string) => void; references: ReturnType<typeof buildShotAssetReferenceContext>["mentionReferences"]; variant?: "scene" | "motion" }) {
    const isScene = variant === "scene";
    const [expanded, setExpanded] = useState(false);
    const editor = (large = false) => (
        <CanvasResourceMentionTextarea
            value={value}
            references={references}
            onChange={onChange}
            sendOnEnter={false}
            containerClassName={`workflow-shot-mention-container ${large ? "is-expanded" : isScene ? "is-scene" : ""}`}
            className={`thin-scrollbar workflow-shot-mention-editor ${isScene ? "is-scene" : ""}`}
            style={{ color: "var(--foreground)" }}
            placeholder={isScene
                ? references.length ? "描述主体、场景、动作、构图与光线；输入 @ 可引用已绑定资产" : "描述主体、场景、动作、构图与光线；先绑定资产后可用 @ 引用"
                : references.length ? "补充动作节奏、运镜变化和动态细节；输入 @ 可引用已绑定资产" : "补充动作节奏、运镜变化和动态细节；绑定资产后可用 @ 引用"}
            aria-label={isScene ? "镜头画面，可使用 @ 引用已绑定资产" : "视频提示词，可使用 @ 引用已绑定资产"}
        />
    );
    return <>
        {!isScene && <div className="mb-2 flex justify-end"><Button type="text" size="small" icon={<Maximize2 className="size-3.5" />} onClick={() => setExpanded(true)}>展开编辑完整提示词</Button></div>}
        {editor()}
        <AppModal title="视频提示词 · 完整编辑" open={expanded} width={1000} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
            <p className="mb-3 text-sm text-foreground/65">修改与当前镜头同步；输入 @ 可引用已绑定资产，关闭后可保存脚本。</p>
            {editor(true)}
        </AppModal>
    </>;
}

function EpisodeLibrary({ detail, activeUnitId, projectId, activeStage }: { detail: ProjectDetail; activeUnitId: string; projectId: string; activeStage: ShortDramaWorkflowStage }) {
    return <div className="workflow-simple-list">{detail.units.slice().sort((left, right) => left.position - right.position).map((unit, index) => <Link key={unit.id} to={`/projects/${projectId}/workflow/${unit.id}/${activeStage}`} className={unit.id === activeUnitId ? "is-active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><strong>{unit.title}</strong></Link>)}</div>;
}

function ShotLibrary({ detail, shots, selectedShotId, onSelectShot }: { detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; onSelectShot: (id: string) => void }) {
    return <div className="workflow-simple-list">{shots.map((shot, index) => { const video = currentArtifact(detail, shot.id, "video"); return <button key={shot.id} type="button" className={shot.id === selectedShotId ? "is-active" : ""} onClick={() => onSelectShot(shot.id)}><span>{formatShotOrdinal(index)}</span><span className="min-w-0 flex-1"><strong>{customShotTitle(shot.title, index) || "未命名"}</strong><small>{formatDuration(shot.durationMs)}</small></span><ArtifactStatus artifact={video} compact /></button>; })}</div>;
}

function BoundAssets({ detail, shotId, changing, onUnlink }: { detail: ProjectDetail; shotId: string; changing: boolean; onUnlink: (reference: ShotAssetReference) => void }) {
    const references = stableShotReferences((detail.shotReferences || []).filter((item) => item.shotId === shotId));
    const assetByVersionId = useMemo(() => new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset])), [detail.assets]);
    return (
        <div className="workflow-bound-assets">
            <div className="workflow-bound-assets-heading"><span className="workflow-field-label">镜头资产</span><small>{references.length ? `已绑定 ${references.length} 项` : "从左侧资产栏点击绑定"}</small></div>
            <Image.PreviewGroup>
                <div className="workflow-bound-assets-content">
                    {references.length ? references.map((reference) => {
                        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
                        const title = asset?.title || "历史资产版本";
                        const previewUrl = asset ? assetPreviewUrl(asset) : "";
                        return <div key={reference.id} className="workflow-bound-asset-chip">
                            <span className="workflow-bound-asset-preview">{asset?.mediaType === "video" && asset.storageKey ? <VideoMediaPreview storageKey={asset.storageKey} alt={title} className="h-full w-full" fallback={<Film />} /> : previewUrl ? <Image src={previewUrl} alt={`${title}预览`} width={40} height={40} loading="lazy" preview={{ mask: "预览" }} /> : <Box aria-hidden />}</span>
                            <span className="workflow-bound-asset-copy"><em>{asset ? assetCategoryLabel(asset.category) : "历史"}</em><strong title={title}>{title}</strong></span>
                            <button type="button" disabled={changing} aria-label={`取消引用 ${title}`} onClick={() => onUnlink(reference)}><X aria-hidden /></button>
                        </div>;
                    }) : <span>尚未绑定角色、场景或道具</span>}
                </div>
            </Image.PreviewGroup>
        </div>
    );
}

function LatestPreview({ artifact, emptyText, onPreviewImage }: { artifact?: ShotArtifact; emptyText: string; onPreviewImage: (artifact: ShotArtifact) => void }) {
    if (!artifact?.resourceId) return <div className="workflow-media-empty"><span><Play className="size-7" /></span><p>{emptyText}</p></div>;
    const src = resourceFileUrl(artifact.resourceId);
    if (artifact.type === "video") return <VideoArtifactPreview src={src} title="镜头视频" />;
    return <button type="button" className="workflow-preview-media-button" onClick={() => onPreviewImage(artifact)} aria-label={artifact.type === "action_board" ? "点击预览动作预演" : "点击预览分镜图"}>
        <img className={`workflow-preview-media ${artifact.type === "action_board" ? "grayscale" : ""}`} src={src} alt="镜头生成预览" loading="eager" />
        <span className="workflow-preview-expand" aria-hidden="true"><Maximize2 className="size-4" /></span>
    </button>;
}

function VideoArtifactPreview({ src, title }: { src: string; title: string }) {
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        setPlaying(false);
    }, [src]);

    if (playing) return <video className="workflow-preview-media" src={src} controls autoPlay playsInline preload="metadata" aria-label={title} />;
    return <button type="button" className="workflow-preview-media-button workflow-video-poster" onClick={() => setPlaying(true)} aria-label={`点击播放${title}`}>
        <VideoMediaPreview src={src} alt={title} className="workflow-preview-media" fallback={<Film />} />
        <span className="workflow-video-play" aria-hidden="true"><Play className="size-6" fill="currentColor" /></span>
    </button>;
}

function ArtifactHistory({ artifacts, activeId, onSelect, compact = false }: { artifacts: ShotArtifact[]; activeId?: string; onSelect: (artifact: ShotArtifact) => void; compact?: boolean }) {
    if (!artifacts.length) return compact ? null : <EmptyState size="compact" title="暂无历史版本" />;
    return <section className={`workflow-history ${compact ? "is-compact" : ""}`}><div className="workflow-history-title">历史版本</div>{artifacts.map((artifact) => <button key={artifact.id} type="button" className={artifact.id === activeId ? "is-active" : ""} onClick={() => onSelect(artifact)}>{artifact.resourceId ? artifact.type === "video" ? <VideoMediaPreview storageKey={resourceStorageKey(artifact.resourceId)} alt={`视频 v${artifact.version}`} className="workflow-history-video-thumb" fallback={<Film />} /> : <img src={resourceFileUrl(artifact.resourceId)} alt="" loading="lazy" /> : <span className="workflow-history-placeholder"><Layers3 /></span>}<span className="min-w-0 flex-1"><strong>v{artifact.version}{artifact.selected ? " · 当前" : ""}</strong><small>{new Date(artifact.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><ArtifactStatus artifact={artifact} compact /></button>)}</section>;
}

function ShotTimeline({ activeStage, detail, shots, selectedShotId, submittingShotIds, onSelectShot, onAddShot, addingShot }: { activeStage: ShortDramaWorkflowStage; detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; submittingShotIds: Set<string>; onSelectShot: (id: string) => void; onAddShot: () => void; addingShot: boolean }) {
    const artifactType = artifactTypeForStage(activeStage);
    const latestTaskByShotId = useMemo(() => {
        const tasks = new Map<string, GenerationTask>();
        for (const task of detail.tasks || []) {
            const shotId = task.clientContext?.shotId;
            if (!shotId || task.clientContext?.artifactType !== artifactType) continue;
            const current = tasks.get(shotId);
            if (!current || task.updatedAt > current.updatedAt) tasks.set(shotId, task);
        }
        return tasks;
    }, [artifactType, detail.tasks]);
    return <section className="workflow-shot-timeline"><header><div><strong>{detail.units.find((item) => item.id === shots[0]?.unitId)?.title || "本集"}</strong><span>{shots.length} 镜 · 总时长 {formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}</span></div><div className="flex items-center gap-1 text-[var(--fs-micro)] text-foreground/40"><List className="size-3.5" /> 共 {shots.length} 镜</div></header><div className="workflow-shot-track thin-scrollbar">{shots.map((shot, index) => <TimelineShot key={shot.id} artifactType={artifactType} detail={detail} shot={shot} task={latestTaskByShotId.get(shot.id)} submitting={submittingShotIds.has(shot.id)} index={index} selected={shot.id === selectedShotId} onSelect={() => onSelectShot(shot.id)} />)}<button type="button" className="workflow-add-shot-card" disabled={addingShot} onClick={onAddShot}><Plus className="size-5" /><span>新增分镜</span></button></div></section>;
}

function TimelineShot({ artifactType, detail, shot, task, submitting, index, selected, onSelect }: { artifactType: string; detail: ProjectDetail; shot: ProjectShot; task?: GenerationTask; submitting: boolean; index: number; selected: boolean; onSelect: () => void }) {
    const video = currentArtifact(detail, shot.id, "video");
    const previz = currentArtifact(detail, shot.id, "action_board");
    const storyboard = currentArtifact(detail, shot.id, "storyboard");
    const preview = video?.resourceId ? video : previz?.resourceId ? previz : storyboard?.resourceId ? storyboard : undefined;
    const stateArtifact = artifactType === "video" ? video : artifactType === "action_board" ? previz : storyboard;
    const revision = currentRevision(detail, shot);
    const stageLabel = artifactType === "video" ? "镜头视频" : artifactType === "action_board" ? "动作预演" : "分镜画面";
    const cameraMeta = [revision?.shotSize, revision?.cameraMovement].filter(Boolean).join(" · ") || "等待补充镜头参数";
    return <button type="button" className={`workflow-timeline-shot ${selected ? "is-active" : ""}`} onClick={onSelect}><span className="workflow-timeline-media">{preview?.resourceId && preview.type === "video" ? <VideoMediaPreview storageKey={resourceStorageKey(preview.resourceId)} alt={`${formatShotOrdinal(index)}视频首帧`} className="h-full w-full" fallback={<Film />} /> : preview?.resourceId ? <img src={resourceFileUrl(preview.resourceId)} alt="" loading="lazy" /> : <Film />}</span><span className="workflow-timeline-copy"><span className="workflow-timeline-heading"><strong>{formatShotOrdinal(index)}</strong><b>{formatDuration(shot.durationMs)}</b></span>{customShotTitle(shot.title, index) ? <em className="workflow-timeline-title">{customShotTitle(shot.title, index)}</em> : null}<small className="workflow-timeline-meta">{cameraMeta}</small><span className="workflow-timeline-status"><span>{stageLabel}{stateArtifact ? ` · v${stateArtifact.version}` : ""}</span><ArtifactStatus artifact={stateArtifact} taskStatus={submitting ? "queued" : task?.status} compact /></span></span></button>;
}

function revisionInput(values: ShotEditorValues, actionBeatsJson?: string): ShotRevisionInput {
    let actionBeats: Array<Record<string, unknown>> = [];
    try { const parsed: unknown = JSON.parse(actionBeatsJson || "[]"); if (Array.isArray(parsed)) actionBeats = parsed; } catch { /* Historical revisions may have no beat payload. */ }
    actionBeats = actionBeats.filter(beat => !(beat.kind === "artifact_prompt" && beat.artifactType === "action_board"));
    if (values.actionBoardPrompt?.trim()) actionBeats.push({ kind: "artifact_prompt", artifactType: "action_board", prompt: values.actionBoardPrompt.trim() });
    return {
        actionBeats,
        plotDescription: values.plotDescription,
        action: values.action,
        dialogue: values.dialogue,
        shotSize: values.shotSize,
        cameraAngle: values.cameraAngle,
        cameraMovement: values.cameraMovement,
        durationMs: Math.round(values.durationSeconds * 1000),
        imagePrompt: values.imagePrompt,
        videoPrompt: values.videoPrompt,
        negativePrompt: values.negativePrompt,
        continuityNotes: values.continuityNotes,
    };
}

async function downloadArtifact(artifact: ShotArtifact, shotTitle: string, onError: (content: string) => void) {
    if (!artifact.resourceId) return;
    try {
        await downloadBrowserMedia({
            storageKey: resourceStorageKey(artifact.resourceId),
            fileName: `${shotTitle || "shot"}-v${artifact.version}.${artifact.type === "video" ? "mp4" : "png"}`,
        });
    } catch (error) {
        onError(error instanceof Error ? `下载失败：${error.message}` : "下载失败");
    }
}

function assetPreviewUrl(asset: ProjectAsset) {
    const representation = asset.character?.representations?.find((item) => item.role === "primary") || asset.character?.representations?.[0];
    if (representation?.resourceId) return resourceFileUrl(representation.resourceId);
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return resourceId && asset.mediaType === "image" ? resourceFileUrl(resourceId) : "";
}
