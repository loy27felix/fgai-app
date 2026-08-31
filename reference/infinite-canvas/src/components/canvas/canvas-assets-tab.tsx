import { memo, useMemo, useRef, useState } from "react";
import { App, Empty, Input, Popconfirm, Tag } from "antd";
import { ChevronRight, FileText, Image as ImageIcon, Plus, Search, Trash2, Video } from "lucide-react";

import { cn } from "@/reference/infinite-canvas/src/lib/utils";
import { uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import { uploadMediaFile } from "@/reference/infinite-canvas/src/services/file-storage";
import { uploadImage } from "@/reference/infinite-canvas/src/services/image-storage";
import { useAssetStore, type Asset } from "@/reference/infinite-canvas/src/stores/use-asset-store";
import type { CanvasTheme } from "@/reference/infinite-canvas/src/lib/canvas-theme";

import type { InsertAssetPayload } from "./asset-picker-modal";

type StandardAsset = Extract<Asset, { kind: "image" | "video" | "text" }>;

const GROUPS = [
    { kind: "image", label: "图片", icon: ImageIcon },
    { kind: "video", label: "视频", icon: Video },
    { kind: "text", label: "文本", icon: FileText },
] as const;

function isStandardAsset(asset: Asset): asset is StandardAsset {
    return asset.kind === "image" || asset.kind === "video" || asset.kind === "text";
}

function toInsertPayload(asset: StandardAsset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, cloudStoragePath: asset.data.cloudStoragePath, cloudAssetId: asset.data.cloudAssetId, creatorTaskId: asset.data.creatorTaskId, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

export const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const visibleAssets = useMemo(() => assets.filter(isStandardAsset), [assets]);
    const allTags = useMemo(() => Array.from(new Set(visibleAssets.flatMap((asset) => asset.tags || []))).slice(0, 20), [visibleAssets]);
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return visibleAssets.filter((asset) => (tagFilter === "all" || asset.tags.includes(tagFilter)) && (!query || [asset.title, ...asset.tags].join(" ").toLowerCase().includes(query)));
    }, [keyword, tagFilter, visibleAssets]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading("正在添加资产…", 0);
        try {
            let added = 0;
            for (const file of files) {
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file);
                    addAsset({ kind: "image", title: file.name || "图片", coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
                    added += 1;
                } else if (file.type.startsWith("video/")) {
                    const media = await uploadMediaFile(file, "video");
                    const durable = await uploadCanvasAsset(file, { kind: "video", source: "upload", name: file.name }).catch((error) => {
                        console.warn("[canvas asset durable copy failed]", { kind: "video", name: file.name, error });
                        return null;
                    });
                    addAsset({ kind: "video", title: file.name || "视频", coverUrl: "", tags: [], data: { url: durable?.contentUrl || media.url, storageKey: media.storageKey, cloudStoragePath: durable?.storagePath, cloudAssetId: durable?.assetId || undefined, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType }, metadata: durable ? { durable: true } : { durable: false } });
                    added += 1;
                }
            }
            added ? message.success(`已添加 ${added} 个资产`) : message.warning("仅支持图片或视频文件");
        } catch (error) {
            console.warn("[canvas assets upload failed]", { error });
            message.error("添加失败，请重试");
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索资产" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10" style={{ color: theme.node.text }}><Plus className="size-3.5" />添加</button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
        </div>
        {allTags.length ? <div className="flex flex-wrap gap-1.5 px-3 pb-2"><Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>全部</Tag.CheckableTag>{allTags.map((tag) => <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((previous) => previous === tag ? "all" : tag)}>{tag}</Tag.CheckableTag>)}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {GROUPS.map((group) => {
                const items = filtered.filter((asset) => asset.kind === group.kind);
                if (!items.length) return null;
                const Icon = group.icon;
                return <div key={group.kind}>
                    <button type="button" onClick={() => setCollapsed((state) => ({ ...state, [group.kind]: !state[group.kind] }))} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"><ChevronRight className={cn("size-3.5 transition-transform", !collapsed[group.kind] && "rotate-90")} /><Icon className="size-3.5" /><span>{group.label}</span><span className="opacity-50">{items.length}</span></button>
                    {collapsed[group.kind] ? null : <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">{items.map((asset) => <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(toInsertPayload(asset))} onRemove={() => { removeAsset(asset.id); message.success("资产已移除"); }} />)}</div>}
                </div>;
            })}
            {!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资产" className="pt-16" /> : null}
        </div>
    </div>;
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: StandardAsset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    return <div className="group relative aspect-square overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onPointerEnter={() => { if (asset.kind === "video") void video?.play().catch((error) => console.warn("[canvas asset video preview failed]", { assetId: asset.id, error })); }} onPointerLeave={() => { video?.pause(); if (video) video.currentTime = 0; }}>
        {asset.kind === "image" ? <img src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover" /> : asset.kind === "video" ? <video ref={setVideo} src={`${asset.data.url}#t=0.1`} muted playsInline loop preload="metadata" className="size-full object-cover" onError={() => console.warn("[canvas asset video preview unavailable]", { assetId: asset.id })} /> : <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2 text-[11px]">{asset.data.content}</div>}
        <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition group-hover:opacity-100"><button type="button" onClick={onInsert} className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm"><Plus className="size-4" /></button><Popconfirm title="移除该资产?" okText="移除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onRemove}><button type="button" className="grid size-8 place-items-center rounded-full bg-white/90 text-red-500 shadow-sm"><Trash2 className="size-4" /></button></Popconfirm></div>
    </div>;
}
