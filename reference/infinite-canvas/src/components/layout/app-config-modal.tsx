import { App, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import { Cloud, Download, Pencil, Plus, RefreshCw, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/reference/infinite-canvas/src/components/model-picker";
import { ChannelEditorDrawer } from "@/reference/infinite-canvas/src/components/layout/channel-editor-drawer";
import { ConfigPromptSources } from "@/reference/infinite-canvas/src/components/layout/config-prompt-sources";
import { exportAppConfig, importAppConfig } from "@/reference/infinite-canvas/src/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/reference/infinite-canvas/src/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/reference/infinite-canvas/src/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/reference/infinite-canvas/src/lib/audio-generation";
import { isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedanceRatioOptions, seedanceResolutionOptions } from "@/reference/infinite-canvas/src/lib/seedance-video";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue, videoResolutionOptions, videoSecondOptions, videoSizeOptions } from "@/reference/infinite-canvas/src/components/video-settings-panel";
import { createModelChannel, modelOptionName, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { getVideoModel } from "@/lib/ai/video-models";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    defaultLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", defaultLabel: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", defaultLabel: "默认视频模型" },
    { capability: "text", modelKey: "textModel", defaultLabel: "默认文本模型" },
    { capability: "audio", modelKey: "audioModel", defaultLabel: "默认音频模型" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的资产",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const videoNodePreset = videoNodePresetFor(config);
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    useEffect(() => {
        const nextValues = {
            size: videoNodePreset.size,
            resolution: videoNodePreset.resolution,
            seconds: videoNodePreset.seconds,
        };
        if (config.newVideoNodeSize !== nextValues.size) updateConfig("newVideoNodeSize", nextValues.size);
        if (config.newVideoNodeResolution !== nextValues.resolution) updateConfig("newVideoNodeResolution", nextValues.resolution);
        if (config.newVideoNodeSeconds !== nextValues.seconds) updateConfig("newVideoNodeSeconds", nextValues.seconds);
    }, [config.newVideoNodeResolution, config.newVideoNodeSeconds, config.newVideoNodeSize, updateConfig, videoNodePreset.resolution, videoNodePreset.seconds, videoNodePreset.size]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success("配置与用户偏好已导入");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "配置文件读取失败");
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: `渠道 ${config.channels.length + 1}` });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个资产，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">默认导出会自动移除 API Key 与 WebDAV 密码；完整配置仅适合在可信设备间传递。</div>
                <div className="flex flex-wrap gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>导入配置</Button>
                    <Button icon={<Download className="size-4" />} onClick={() => exportAppConfig()}>导出脱敏配置</Button>
                    <Button danger icon={<Download className="size-4" />} onClick={() => Modal.confirm({ title: "导出完整配置？", content: "文件会包含 API Key 和 WebDAV 密码，请只保存到可信位置。", okText: "导出", cancelText: "取消", onOk: () => exportAppConfig({ includeSecrets: true }) })}>导出完整配置</Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">每个渠道选择一个协议并拉取模型，为每个模型指定能力（生图/视频/文本/音频），并可自定义调用脚本。</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · {channel.models.length} 个模型 · {channel.baseUrl || "未填写接口地址"}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    编辑
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "偏好设置",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 text-sm font-semibold">默认模型</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">生成偏好</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: "提示词来源",
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的资产、生成记录和本地媒体文件，不包含 AI API Key；浏览器会直接连接 WebDAV 服务。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "video-node-defaults",
                        label: "新建视频节点",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                                    <div className="mb-1 text-sm font-semibold">新建视频节点预设</div>
                                    <div className="mb-4 text-xs leading-5 text-stone-500">只作用于之后新建的视频节点（包括从连线创建）。创建时会写入该节点，已有节点和之后更改的全局偏好都不会覆盖它。</div>
                                    <div className="mb-4 rounded-md bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                                        <span className="font-medium text-stone-800 dark:text-stone-100">当前默认模型：{videoNodePreset.modelLabel}</span>
                                        <span className="mx-1.5 text-stone-400">·</span>
                                        {videoNodePreset.capabilityNote}
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-3">
                                        <Form.Item label="新建节点画幅" className="mb-0">
                                            <Select value={videoNodePreset.size} options={videoNodePreset.sizeOptions} onChange={(value) => updateConfig("newVideoNodeSize", value)} />
                                        </Form.Item>
                                        <Form.Item label="新建节点分辨率" className="mb-0">
                                            <Select value={videoNodePreset.resolution} options={videoNodePreset.resolutionOptions} onChange={(value) => updateConfig("newVideoNodeResolution", value)} />
                                        </Form.Item>
                                        <Form.Item label="新建节点时长" extra={videoNodePreset.durationNote} className="mb-0">
                                            <Select value={videoNodePreset.seconds} options={videoNodePreset.secondOptions} onChange={(value) => updateConfig("newVideoNodeSeconds", value)} />
                                        </Form.Item>
                                    </div>
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        完成
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

type VideoNodePreset = {
    modelLabel: string;
    capabilityNote: string;
    durationNote: string;
    sizeOptions: Array<{ value: string; label: string }>;
    resolutionOptions: Array<{ value: string; label: string }>;
    secondOptions: Array<{ value: string; label: string }>;
    size: string;
    resolution: string;
    seconds: string;
};

function videoNodePresetFor(config: AiConfig): VideoNodePreset {
    const modelId = modelOptionName(config.videoModel || config.model);
    const modelSpec = getVideoModel(modelId);
    const seedanceConfig = isSeedanceVideoConfig({ ...config, model: config.videoModel || config.model });
    const requiresAdaptiveFrameRatio = config.videoReferenceMode === "first_last" && Boolean(modelSpec?.requiresAdaptiveRatioForFrameMode);

    if (!seedanceConfig) {
        const normalizedSize = normalizeVideoSizeValue(config.newVideoNodeSize);
        const normalizedResolution = normalizeVideoResolutionValue(config.newVideoNodeResolution);
        const normalizedSeconds = nearestOption(config.newVideoNodeSeconds, videoSecondOptions);
        return {
            modelLabel: modelId || "未选择视频模型",
            capabilityNote: "使用通用视频节点预设；自定义渠道的特殊限制仍以其接口返回为准。",
            durationNote: "可选 4–15 秒。",
            sizeOptions: videoSizeOptions,
            resolutionOptions: videoResolutionOptions,
            secondOptions: videoSecondOptions.map((value) => ({ value, label: `${value} 秒` })),
            size: videoSizeOptions.some((item) => item.value === normalizedSize) ? normalizedSize : videoSizeOptions[0].value,
            resolution: videoResolutionOptions.some((item) => item.value === normalizedResolution) ? normalizedResolution : videoResolutionOptions[0].value,
            seconds: normalizedSeconds,
        };
    }

    const allowedResolutions = modelSpec
        ? seedanceResolutionOptions.filter((item) => modelSpec.resolutions.includes(item.value))
        : seedanceResolutionOptions;
    const allowedSeconds = seedanceDurationOptions.filter((value) => value === -1
        ? modelSpec?.supportsAdaptiveDuration !== false
        : value >= (modelSpec?.minDuration || 4) && value <= (modelSpec?.maxDuration || 15));
    const allowedRatios = requiresAdaptiveFrameRatio
        ? seedanceRatioOptions.filter((item) => item.value === "adaptive")
        : seedanceRatioOptions;
    const normalizedResolution = normalizeSeedanceResolution(config.newVideoNodeResolution, modelSpec?.id);
    const normalizedSeconds = String(normalizeSeedanceDuration(config.newVideoNodeSeconds, modelSpec?.id));
    const normalizedSize = requiresAdaptiveFrameRatio ? "adaptive" : normalizeSeedanceRatio(config.newVideoNodeSize);
    const label = modelSpec?.label || modelId || "未选择视频模型";
    const durationMin = modelSpec?.minDuration || 4;
    const durationMax = modelSpec?.maxDuration || 15;

    return {
        modelLabel: label,
        capabilityNote: modelSpec
            ? `仅展示 ${label} 支持的分辨率与时长。${requiresAdaptiveFrameRatio ? "当前为首尾帧模式，画幅固定为自适应。" : ""}`
            : "该渠道未声明模型能力，展示 Seedance 通用预设；接口仍会进行最终校验。",
        durationNote: `${durationMin}–${durationMax} 秒${modelSpec?.supportsAdaptiveDuration !== false ? "，或选择智能" : ""}。`,
        sizeOptions: allowedRatios.map((item) => ({ value: item.value, label: item.label })),
        resolutionOptions: allowedResolutions.map((item) => ({ value: item.value, label: item.label })),
        secondOptions: allowedSeconds.map((value) => ({ value: String(value), label: value === -1 ? "智能" : `${value} 秒` })),
        size: allowedRatios.some((item) => item.value === normalizedSize) ? normalizedSize : allowedRatios[0].value,
        resolution: allowedResolutions.some((item) => item.value === normalizedResolution) ? normalizedResolution : allowedResolutions[0].value,
        seconds: allowedSeconds.some((value) => String(value) === normalizedSeconds) ? normalizedSeconds : String(allowedSeconds[0]),
    };
}

function nearestOption(value: string, options: readonly string[]) {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return options[0];
    return options.reduce((nearest, option) => Math.abs(Number(option) - requested) < Math.abs(Number(nearest) - requested) ? option : nearest, options[0]);
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、默认模型和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "ark") return "火山方舟";
    return "OpenAI";
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
