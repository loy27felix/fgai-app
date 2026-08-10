import { saveAs } from "file-saver";

import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/reference/infinite-canvas/src/stores/use-prompt-source-store";
import type { PromptSource } from "@/reference/infinite-canvas/src/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1 | 2;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: { sources: PromptSource[]; schedule: PromptSourceSchedule };
};

const SENSITIVE_KEYS = new Set(["apiKey", "password", "token", "secret"]);

function redact<T extends Record<string, unknown>>(value: T): T {
    const next = { ...value } as T;
    for (const key of Object.keys(next)) if (SENSITIVE_KEYS.has(key)) (next as Record<string, unknown>)[key] = "";
    return next;
}

function redactConfig(config: AiConfig): AiConfig {
    return { ...config, apiKey: "", channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })) };
}

function redactWebdav(webdav: WebdavSyncConfig): WebdavSyncConfig {
    return redact(webdav as unknown as Record<string, unknown>) as unknown as WebdavSyncConfig;
}

export function exportAppConfig(options: { includeSecrets?: boolean } = {}) {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const safeConfig = options.includeSecrets ? config : redactConfig(config);
    const safeWebdav = options.includeSecrets ? webdav : redactWebdav(webdav);
    const data: AppConfigFile = { app: "infinite-canvas", version: 2, exportedAt: new Date().toISOString(), config: safeConfig, webdav: safeWebdav, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try { data = JSON.parse(await file.text()) as AppConfigFile; }
    catch { throw new Error("配置文件格式不正确"); }
    if (data.app !== "infinite-canvas" || ![1, 2].includes(data.version) || !data.config || !data.webdav || !data.promptSources) throw new Error("配置文件格式不正确");

    const current = useConfigStore.getState();
    const config: AiConfig = {
        ...data.config,
        apiKey: data.config.apiKey || current.config.apiKey,
        channels: data.config.channels.map((channel, index) => ({ ...channel, apiKey: channel.apiKey || current.config.channels[index]?.apiKey || "" })),
    };
    const webdav: WebdavSyncConfig = { ...data.webdav, password: data.webdav.password || current.webdav.password };
    useConfigStore.setState({ config, webdav });
    usePromptSourceStore.setState(data.promptSources);
}
