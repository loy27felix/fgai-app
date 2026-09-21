"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";

type ThumbnailOptions = {
    maxDimension?: number;
    quality?: number;
};

type ThumbnailJob = {
    key: string;
    source: string;
    options: Required<ThumbnailOptions>;
    resolve: (value: string | null) => void;
};

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = { maxDimension: 960, quality: 0.82 };
const MAX_CACHE_ENTRIES = 96;
const MAX_CONCURRENT_CONVERSIONS = 3;
const thumbnailCache = new Map<string, string>();
const pendingThumbnails = new Map<string, Promise<string | null>>();
const thumbnailQueue: ThumbnailJob[] = [];
let activeConversions = 0;

function isWebpSource(source: string) {
    return /^data:image\/webp[;,]/i.test(source) || /\.webp(?:[?#]|$)/i.test(source);
}

function cacheThumbnail(key: string, value: string) {
    const previous = thumbnailCache.get(key);
    if (previous && previous !== value) URL.revokeObjectURL(previous);
    thumbnailCache.delete(key);
    thumbnailCache.set(key, value);
    while (thumbnailCache.size > MAX_CACHE_ENTRIES) {
        const oldest = thumbnailCache.entries().next().value as [string, string] | undefined;
        if (!oldest) break;
        thumbnailCache.delete(oldest[0]);
        URL.revokeObjectURL(oldest[1]);
    }
}

function pumpThumbnailQueue() {
    while (activeConversions < MAX_CONCURRENT_CONVERSIONS && thumbnailQueue.length) {
        const job = thumbnailQueue.shift();
        if (!job) break;
        activeConversions += 1;
        void convertToWebp(job.source, job.options)
            .then((value) => {
                if (value) cacheThumbnail(job.key, value);
                job.resolve(value);
            })
            .finally(() => {
                activeConversions -= 1;
                pumpThumbnailQueue();
            });
    }
}

function convertToWebp(source: string, options: Required<ThumbnailOptions>): Promise<string | null> {
    if (typeof window === "undefined" || typeof Image === "undefined" || typeof document === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = "async";
        // Same-origin cloud asset URLs work without this flag. Anonymous CORS
        // lets a provider URL opt into conversion while failures still fall
        // back to the original source without breaking the canvas.
        if (!source.startsWith("data:") && !source.startsWith("blob:")) image.crossOrigin = "anonymous";
        image.onload = () => {
            const width = Math.max(1, image.naturalWidth || image.width);
            const height = Math.max(1, image.naturalHeight || image.height);
            const scale = Math.min(1, options.maxDimension / Math.max(width, height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext("2d", { alpha: true });
            if (!context) {
                resolve(null);
                return;
            }
            try {
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    resolve(blob ? URL.createObjectURL(blob) : null);
                }, "image/webp", options.quality);
            } catch {
                // A provider URL without CORS can taint the canvas. The
                // caller then keeps the original URL as a safe fallback.
                resolve(null);
            }
        };
        image.onerror = () => resolve(null);
        image.src = source;
    });
}

function requestThumbnail(source: string, options: Required<ThumbnailOptions>) {
    const key = `${source}|${options.maxDimension}|${options.quality}`;
    const cached = thumbnailCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = pendingThumbnails.get(key);
    if (pending) return pending;
    const promise = new Promise<string | null>((resolve) => {
        thumbnailQueue.push({ key, source, options, resolve });
        pumpThumbnailQueue();
    }).finally(() => pendingThumbnails.delete(key));
    pendingThumbnails.set(key, promise);
    return promise;
}

export function useLocalWebpThumbnail(source: string | undefined | null, options: ThumbnailOptions = {}) {
    const normalized = typeof source === "string" ? source.trim() : "";
    const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
    const key = normalized ? `${normalized}|${resolvedOptions.maxDimension}|${resolvedOptions.quality}` : "";
    const [thumbnail, setThumbnail] = useState<string | null>(() => thumbnailCache.get(key) || null);

    useEffect(() => {
        let cancelled = false;
        setThumbnail(thumbnailCache.get(key) || null);
        if (!normalized || isWebpSource(normalized)) {
            return () => { cancelled = true; };
        }
        const cached = thumbnailCache.get(key);
        if (cached) {
            setThumbnail(cached);
            return () => { cancelled = true; };
        }
        void requestThumbnail(normalized, resolvedOptions).then((value) => {
            if (!cancelled) setThumbnail(value);
        });
        return () => { cancelled = true; };
    }, [key, normalized, resolvedOptions.maxDimension, resolvedOptions.quality]);

    return thumbnail || normalized;
}

type LocalWebpImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    src?: string | null;
    maxDimension?: number;
    quality?: number;
};

/**
 * A display-only thumbnail. It never mutates node/asset data and callers keep
 * using their original `src` for zoom, download, export and provider uploads.
 */
export function LocalWebpImage({ src, maxDimension, quality, decoding = "async", ...props }: LocalWebpImageProps) {
    const displaySource = useLocalWebpThumbnail(src, { maxDimension, quality });
    return <img {...props} src={displaySource || undefined} decoding={decoding} />;
}
