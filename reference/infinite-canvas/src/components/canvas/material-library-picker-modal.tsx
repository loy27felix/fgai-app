import { useMemo, useState } from "react";
import { Empty, Input, Modal, Tag } from "antd";
import { FileAudio, Search } from "lucide-react";

import { cn } from "@/reference/infinite-canvas/src/lib/utils";
import { materialToInsertPayload, useMaterialLibraryStore, type MaterialInsertPayload, type MaterialItem } from "@/reference/infinite-canvas/src/stores/use-material-library-store";

type Props = {
    open: boolean;
    title?: string;
    onInsert: (payload: MaterialInsertPayload) => void;
    onClose: () => void;
};

export function MaterialLibraryPickerModal({ open, title = "从素材库选择", onInsert, onClose }: Props) {
    const items = useMaterialLibraryStore((state) => state.items);
    const folders = useMaterialLibraryStore((state) => state.folders);
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState<"all" | MaterialItem["kind"]>("all");
    const [folderId, setFolderId] = useState("all");
    const visible = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return items.filter((item) => (kind === "all" || item.kind === kind) && (folderId === "all" || item.folderId === folderId) && (!query || item.title.toLowerCase().includes(query)));
    }, [folderId, items, keyword, kind]);

    return <Modal title={title} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 460 } }}>
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input className="w-52" size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索素材库" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <div className="flex gap-1.5">{(["all", "image", "video", "audio"] as const).map((option) => <Tag.CheckableTag key={option} checked={kind === option} className={cn("prompt-filter-tag", kind === option && "is-active")} onChange={() => setKind(option)}>{option === "all" ? "全部" : option === "image" ? "图片" : option === "video" ? "视频" : "音频"}</Tag.CheckableTag>)}</div>
                <select aria-label="素材库文件夹" value={folderId} onChange={(event) => setFolderId(event.target.value)} className="rounded-md border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"><option value="all">全部文件夹</option><option value="">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
            </div>
            {visible.length ? <div className="grid grid-cols-4 gap-3">{visible.map((item) => <PickerCard key={item.id} item={item} onClick={() => onInsert(materialToInsertPayload(item))} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="素材库还没有可用素材" className="py-12" />}
        </div>
    </Modal>;
}

function PickerCard({ item, onClick }: { item: MaterialItem; onClick: () => void }) {
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    return <button type="button" onClick={onClick} onPointerEnter={() => { if (item.kind === "video") void video?.play().catch((error) => console.warn("[material picker video preview failed]", { materialId: item.id, error })); }} onPointerLeave={() => { video?.pause(); if (video) video.currentTime = 0; }} className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900">
        {item.kind === "image" ? <img src={item.url} alt={item.title} className="aspect-[4/3] w-full object-cover" /> : item.kind === "video" ? <video ref={setVideo} src={`${item.url}#t=0.1`} muted playsInline loop preload="metadata" className="aspect-[4/3] w-full object-cover" onError={() => console.warn("[material picker video preview unavailable]", { materialId: item.id })} /> : <div className="flex aspect-[4/3] items-center justify-center bg-violet-500/10 text-violet-500"><FileAudio className="size-8" /></div>}
        <div className="p-2.5"><div className="flex items-center justify-between gap-2"><span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{item.title}</span><Tag className="m-0 shrink-0 text-[10px]">{item.kind === "image" ? "图片" : item.kind === "video" ? "视频" : "音频"}</Tag></div></div>
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
    </button>;
}
