import { useEffect, useRef, useState, type ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { Asset } from "@/stores/use-asset-store";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import { captureVideoPoster } from "@/lib/video-poster";
import { getActiveUserScope } from "@/lib/user-scope";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if (asset.kind === "video" && (asset.data.url || asset.data.storageKey)) {
        return <VideoMediaPreview storageKey={asset.data.storageKey} src={asset.data.url} alt={alt} className={className} fallback={fallback} />;
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} />;
}

const posterCache = new Map<string, Blob>();

export function VideoMediaPreview({ storageKey, src = "", alt, className = "", fallback }: { storageKey?: string; src?: string; alt: string; className?: string; fallback?: ReactNode }) {
    const host = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [preview, setPreview] = useState<{ key: string; poster?: string; source?: string; failed?: boolean }>();
    const key = `${getActiveUserScope()}:${storageKey || src}`;
    useEffect(() => {
        if (!host.current) return;
        if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: "100px" });
        observer.observe(host.current);
        return () => observer.disconnect();
    }, [key]);
    useEffect(() => {
        if (!visible) return;
        const controller = new AbortController();
        let objectUrl: string | undefined;
        void (async () => {
            const cached = posterCache.get(key);
            if (cached) {
                objectUrl = URL.createObjectURL(cached);
                setPreview({ key, poster: objectUrl });
                return;
            }
            const source = await resolveVideoMediaUrl(storageKey, src);
            if (controller.signal.aborted) return;
            const captured = await captureVideoPoster(source, { signal: controller.signal, maxWidth: 480 });
            if (controller.signal.aborted) return;
            if (captured.poster) {
                posterCache.set(key, captured.poster);
                if (posterCache.size > 64) posterCache.delete(posterCache.keys().next().value!);
                objectUrl = URL.createObjectURL(captured.poster);
            }
            setPreview({ key, poster: objectUrl, source });
        })().catch(() => { if (!controller.signal.aborted) setPreview({ key, failed: true }); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [visible, key, storageKey, src]);
    const current = preview?.key === key ? preview : undefined;
    return <div ref={host} className={className}>
        {current?.poster ? <img src={current.poster} alt={alt} className="h-full w-full object-cover" />
            : current?.source ? <video src={current.source} aria-label={alt} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setPreview({ key, failed: true })} onLoadedMetadata={event => { const video = event.currentTarget; if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2); }} />
            : <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-foreground/65">{fallback}<span className="text-xs">{current?.failed ? "预览读取失败，点击查看或重试" : visible ? "正在读取视频预览…" : "视频预览"}</span></div>}
    </div>;
}
