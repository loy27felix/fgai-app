import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/reference/infinite-canvas/src/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/reference/infinite-canvas/src/services/file-storage";
import { imageToDataUrl } from "@/reference/infinite-canvas/src/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/reference/infinite-canvas/src/lib/seedance-video";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/reference/infinite-canvas/src/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/reference/infinite-canvas/src/types/media";
import { createClient } from "@/lib/supabase/client";
import { createVideoDraft, confirmVideoTask, finalizeVideoUploads, getVideoTask, uploadVideoReference } from "@/lib/creator/video-client";
import { videoImageRoles, type VideoReferenceMode } from "@/lib/creator/video";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; storagePath?: string; assetId?: string; externalTaskId?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted and FG-owned video models, which run their own create+poll flow. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();
const pluginVideoErrors = new Map<string, string>();
const pluginVideoPromises = new Map<string, Promise<void>>();
const FG_VIDEO_MODELS = new Set([
    "doubao-seedance-2-0",
    "doubao-seedance-2-0-filter-off",
    "doubao-seedance-2-0-fast",
    "doubao-seedance-2-0-fast-filter-off",
    "dreamina-seedance-2-0-mini",
    "dreamina-seedance-2-0-mini-filter-off",
]);

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

async function fgVideoFile(url: string, name: string, mime: string) {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (error) {
        const detail = error instanceof Error ? error.message : "network error";
        throw new Error(`参考素材读取失败（${name}）：${detail}`);
    }
    if (!response.ok) throw new Error(`参考素材读取失败（${name}）：HTTP ${response.status}`);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type || mime });
}
function normalizedVideoReferenceMode(config: AiConfig): VideoReferenceMode {
    return config.videoReferenceMode === "first_last" ? "first_last" : "reference";
}

function assertVideoReferenceMode(mode: VideoReferenceMode, imageCount: number, videoCount: number, audioCount: number) {
    if (mode === "first_last" && (videoCount > 0 || audioCount > 0)) {
        throw new Error("首尾帧模式只能连接图片，不能混合视频或音频参考");
    }
    return videoImageRoles(mode, imageCount);
}

async function fgGenerateVideo(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[] = [], signal?: AbortSignal): Promise<VideoGenerationResult> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const mode = normalizedVideoReferenceMode(config);
    const imageInputs = references.slice(0, SEEDANCE_REFERENCE_LIMITS.images);
    const videoInputs = videoReferences.slice(0, 3);
    const audioInputs = audioReferences.slice(0, 3);
    const imageRoles = assertVideoReferenceMode(mode, imageInputs.length, videoInputs.length, audioInputs.length);
    const imageFiles = await Promise.all(imageInputs.map(async (image, index) => {
        try {
            const dataUrl = await imageToDataUrl(image);
            return await fgVideoFile(dataUrl, image.name || `reference-${index + 1}.png`, image.type || "image/png");
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("参考素材读取失败")) throw error;
            const detail = error instanceof Error ? error.message : "读取失败";
            throw new Error(`参考图片读取失败（${image.name || `reference-${index + 1}`}）：${detail}`);
        }
    }));
    const videoFiles = await Promise.all(videoInputs.map((video, index) => fgVideoFile(video.url, video.name || `reference-video-${index + 1}.mp4`, video.type || "video/mp4")));
    const audioFiles = await Promise.all(audioInputs.map((audio, index) => fgVideoFile(audio.url, audio.name || `reference-audio-${index + 1}.mp3`, audio.type || "audio/mpeg")));
    const files = [...imageFiles, ...videoFiles, ...audioFiles];
    const model = (config.model || config.videoModel || "doubao-seedance-2-0").replace(/^.*::/, "");
    const ratio = config.size.includes(":") ? config.size : "16:9";
    const rawSeconds = Number(config.videoSeconds);
    const seconds = rawSeconds === -1 ? -1 : Math.max(4, Math.min(15, rawSeconds || 5));
    const resolution = normalizeCreatorVideoResolution(config.vquality);
    let imageIndex = 0;
    const referencesManifest = files.map((file) => {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
        const ordinaryRole = kind === "video" ? "reference_video" : kind === "audio" ? "reference_audio" : "reference_image";
        const role = kind === "image" ? imageRoles[imageIndex++] : ordinaryRole;
        return { name: file.name, mimeType: file.type, size: file.size, kind, role };
    });
    let draft: Awaited<ReturnType<typeof createVideoDraft>>;
    try {
        draft = await createVideoDraft({ canvasId: null, nodeId: null, prompt, model, references: referencesManifest as any, duration: seconds, ratio, resolution, watermark: config.videoWatermark === "true", generateAudio: config.videoGenerateAudio !== "false", skill: null, idempotencyKey: crypto.randomUUID() });
    } catch (error) {
        throw new Error(`视频草稿创建失败：${error instanceof Error ? error.message : "网络请求失败"}`);
    }
    for (let index = 0; index < files.length; index += 1) {
        try {
            const upload = await supabaseUploadVideoReference(draft.task.id, draft.uploadPaths[index], files[index]);
            if (upload.error) throw upload.error;
        } catch (error) {
            const detail = error instanceof Error ? error.message : "网络请求失败";
            throw new Error(`参考素材上传失败（${files[index].name}）：${detail}`);
        }
    }
    try {
        await finalizeVideoUploads(draft.task.id, draft.uploadPaths);
    } catch (error) {
        throw new Error(`参考素材确认失败：${error instanceof Error ? error.message : "网络请求失败"}`);
    }
    let immediate: Awaited<ReturnType<typeof confirmVideoTask>>;
    try {
        immediate = await confirmVideoTask(draft.task.id);
    } catch (error) {
        throw new Error(`视频任务提交失败：${error instanceof Error ? error.message : "网络请求失败"}`);
    }
    if (immediate.videoUrl) return { ...(await videoResultFromUrl(immediate.videoUrl, { signal })), storagePath: typeof immediate.task?.output?.video_storage_path === "string" ? immediate.task.output.video_storage_path : undefined, assetId: typeof immediate.task?.output?.video_asset_id === "string" ? immediate.task.output.video_asset_id : undefined, externalTaskId: typeof immediate.task?.external_task_id === "string" ? immediate.task.external_task_id : undefined };
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let task: Awaited<ReturnType<typeof getVideoTask>>["task"];
        try {
            task = (await getVideoTask(draft.task.id)).task;
        } catch (error) {
            throw new Error(`视频任务状态读取失败：${error instanceof Error ? error.message : "网络请求失败"}`);
        }
        if (task.videoUrl) return { ...(await videoResultFromUrl(task.videoUrl, { signal })), storagePath: typeof task.output?.video_storage_path === "string" ? task.output.video_storage_path : undefined, assetId: typeof task.output?.video_asset_id === "string" ? task.output.video_asset_id : undefined, externalTaskId: typeof task.external_task_id === "string" ? task.external_task_id : undefined };
        if (task.status === "failed" || task.status === "expired") throw new Error(task.error || "视频生成失败，请查看历史任务");
        await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    throw new Error("视频生成超时，请稍后重试");
}

async function supabaseUploadVideoReference(taskId: string, path: string, file: File) {
    const supabase = createClient();
    try {
        const direct = await supabase.storage.from("creator-assets").upload(path, file, { upsert: false, contentType: file.type });
        if (!direct.error) return direct;
    } catch {
        // Fall through to the same-origin server upload. This covers browsers or
        // deployments where the Supabase Storage CORS preflight is unavailable.
    }
    await uploadVideoReference(taskId, path, file);
    return { data: { path }, error: null };
}
function normalizeCreatorVideoResolution(value: string) {
    const normalized = String(value || "720").trim().toLowerCase();
    if (normalized === "4k") return "4K";
    if (normalized === "auto" || normalized === "high" || normalized === "medium") return "720p";
    const token = normalized.replace(/p$/i, "") || "720";
    return `${token}p`;
}

function isFgCreatorVideoModel(value: string) {
    return FG_VIDEO_MODELS.has(modelOptionName(value));
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    return fgGenerateVideo(config, prompt, references, videoReferences, audioReferences, options?.signal);
}
export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    if (isFgCreatorVideoModel(selectedModel)) return createCreatorVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考资产");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        if (result) return { status: "completed", result };
        const error = pluginVideoErrors.get(task.id);
        if (error) return { status: "failed", error };
        if (pluginVideoPromises.has(task.id)) return { status: "pending" };
        return { status: "failed", error: "视频任务已失效，请重新生成" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

async function createCreatorVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const id = nanoid();
    const work = fgGenerateVideo(config, prompt, references, videoReferences, audioReferences, options?.signal)
        .then((result) => {
            pluginVideoResults.set(id, result);
        })
        .catch((error) => {
            pluginVideoErrors.set(id, error instanceof Error ? error.message : "视频生成失败");
        });
    pluginVideoPromises.set(id, work);
    void work.then(() => pluginVideoPromises.delete(id), () => pluginVideoPromises.delete(id));
    return { id, provider: "plugin", model };
}
async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    const store = (input: Blob | string) => uploadMediaFile(input, "video").then((stored) => ({
        ...stored,
        ...(result.storagePath ? { cloudStoragePath: result.storagePath } : {}),
        ...(result.assetId ? { cloudAssetId: result.assetId } : {}),
        ...(result.externalTaskId ? { externalTaskId: result.externalTaskId } : {}),
    }));
    if (result.blob) return store(result.blob);
    if (result.url) {
        try {
            return await store(result.url);
        } catch (error) {
            throw new Error("视频已生成，但无法保存到当前浏览器，请检查本地存储权限后重试");
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const mode = normalizedVideoReferenceMode(config);
    assertVideoReferenceMode(mode, Math.min(references.length, SEEDANCE_REFERENCE_LIMITS.images), Math.min(videoReferences.length, SEEDANCE_REFERENCE_LIMITS.videos), Math.min(audioReferences.length, SEEDANCE_REFERENCE_LIMITS.audios));
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences, mode);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error?.message) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], mode: VideoReferenceMode = normalizedVideoReferenceMode(config)) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    const imageInputs = references.slice(0, SEEDANCE_REFERENCE_LIMITS.images);
    const imageRoles = assertVideoReferenceMode(mode, imageInputs.length, videoReferences.length, audioReferences.length);
    for (let index = 0; index < imageInputs.length; index += 1) {
        const image = imageInputs[index];
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: imageRoles[index] });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、资产 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、资产 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(4, Math.min(15, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | SeedanceTask) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return `服务返回了 HTML 错误页面（${value.slice(0, 80)}...）`;
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error 可能是字符串或含 message 的对象
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || "视频下载失败");
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地资产失败"));
        reader.readAsDataURL(blob);
    });
}
