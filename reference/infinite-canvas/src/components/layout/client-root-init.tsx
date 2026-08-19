import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { usePromptSourceScheduler } from "@/reference/infinite-canvas/src/hooks/use-prompt-source-scheduler";
import { useAssetStore, type Asset } from "@/reference/infinite-canvas/src/stores/use-asset-store";
import { requestBrowserPersistence } from "@/reference/infinite-canvas/src/services/local-persistence";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const replaceAssets = useAssetStore((state) => state.replaceAssets);
    const cloudAssetsLoadedRef = useRef(false);

    useEffect(() => {
        void requestBrowserPersistence();
    }, []);

    useEffect(() => {
        if (!assetsHydrated || cloudAssetsLoadedRef.current) return;
        void fetch("/api/creator/assets", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) return;
                const payload = await response.json().catch(() => ({}));
                if (!Array.isArray(payload.assets)) return;
                const remoteAssets: Asset[] = payload.assets.map((asset: Record<string, unknown>) => {
                    const sourceMetadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : {};
                    const metadata: Record<string, unknown> = {
                        ...sourceMetadata,
                        cloudAssetId: asset.id,
                        cloudStoragePath: asset.storagePath,
                    };
                    const base = {
                        id: String(asset.id),
                        title: typeof asset.name === "string" ? asset.name : "云端资产",
                        coverUrl: typeof asset.signedUrl === "string" ? asset.signedUrl : "",
                        tags: ["云端"],
                        source: "FG Studio",
                        note: "NAS 本地资产",
                        createdAt: typeof asset.createdAt === "string" ? asset.createdAt : new Date().toISOString(),
                        updatedAt: typeof asset.updatedAt === "string" ? asset.updatedAt : new Date().toISOString(),
                        metadata,
                    };
                    if (asset.kind === "video") return { ...base, kind: "video", data: { url: typeof asset.signedUrl === "string" ? asset.signedUrl : "", storageKey: undefined, width: Number(asset.width) || 1280, height: Number(asset.height) || 720, bytes: 0, mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "video/mp4" } } as Asset;
                    if (asset.kind === "image") return { ...base, kind: "image", data: { dataUrl: typeof asset.signedUrl === "string" ? asset.signedUrl : "", storageKey: undefined, width: Number(asset.width) || 1024, height: Number(asset.height) || 1024, bytes: 0, mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "image/png" } } as Asset;
                    if (asset.kind === "document" || asset.kind === "audio") return null;
                    return { ...base, kind: "text", data: { content: typeof metadata.content === "string" ? metadata.content : "" } } as Asset;
                }).filter((asset: Asset | null): asset is Asset => Boolean(asset));
                const remoteIds = new Set(remoteAssets.map((asset: Asset) => asset.metadata?.cloudAssetId));
                const localAssets = useAssetStore.getState().assets.filter((asset) => !asset.metadata?.cloudAssetId || remoteIds.has(asset.metadata.cloudAssetId));
                replaceAssets([...remoteAssets, ...localAssets.filter((asset) => !remoteIds.has(asset.metadata?.cloudAssetId))]);
                cloudAssetsLoadedRef.current = true;
            })
            .catch(() => {
                // Local-first use remains available when the account is signed out.
            });
    }, [assetsHydrated, replaceAssets]);
    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
