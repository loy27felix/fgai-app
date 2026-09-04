import { memo, useMemo, useRef, useState } from "react";
import { App, Empty, Input, Popconfirm } from "antd";
import { Check, ChevronRight, FileAudio, Folder, FolderOpen, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";

import type { CanvasTheme } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { cn } from "@/reference/infinite-canvas/src/lib/utils";
import { deleteMaterialLibraryAsset, moveMaterialLibraryAsset, renameMaterialLibraryFolder, uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import { MATERIAL_LIBRARY_DRAG_MIME, materialToInsertPayload, useMaterialLibraryStore, type MaterialFolder, type MaterialInsertPayload, type MaterialItem } from "@/reference/infinite-canvas/src/stores/use-material-library-store";

const ROOT_ID = "__all_materials__";

export const CanvasMaterialLibraryTab = memo(function CanvasMaterialLibraryTab({ onInsert, theme }: { onInsert: (payload: MaterialInsertPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const folders = useMaterialLibraryStore((state) => state.folders);
    const items = useMaterialLibraryStore((state) => state.items);
    const addFolder = useMaterialLibraryStore((state) => state.addFolder);
    const renameFolder = useMaterialLibraryStore((state) => state.renameFolder);
    const addItem = useMaterialLibraryStore((state) => state.addItem);
    const updateItem = useMaterialLibraryStore((state) => state.updateItem);
    const removeItem = useMaterialLibraryStore((state) => state.removeItem);
    const [selectedFolderId, setSelectedFolderId] = useState(ROOT_ID);
    const [keyword, setKeyword] = useState("");
    const [newFolderName, setNewFolderName] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return items.filter((item) => (selectedFolderId === ROOT_ID || item.folderId === selectedFolderId) && (!query || item.title.toLowerCase().includes(query)));
    }, [items, keyword, selectedFolderId]);
    const rootFolders = useMemo(() => folders.filter((folder) => !folder.parentId), [folders]);

    const createFolder = () => {
        const id = addFolder(newFolderName, selectedFolderId === ROOT_ID ? null : selectedFolderId);
        if (!id) return;
        setNewFolderName("");
        setCreatingFolder(false);
        setSelectedFolderId(id);
        message.success("文件夹已创建");
    };
    const uploadFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading("正在上传到素材库…", 0);
        try {
            let added = 0;
            for (const file of files) {
                const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
                if (!kind) continue;
                const folder = folders.find((candidate) => candidate.id === selectedFolderId);
                const stored = await uploadCanvasAsset(file, { kind, source: "upload", name: file.name, libraryScope: "material-library", folderId: selectedFolderId === ROOT_ID ? undefined : selectedFolderId, folderName: folder?.name });
                addItem({ kind, title: file.name || "未命名素材", url: stored.contentUrl, mimeType: file.type || "application/octet-stream", storagePath: stored.storagePath, cloudAssetId: stored.assetId, folderId: selectedFolderId === ROOT_ID ? null : selectedFolderId, folderName: folder?.name });
                added += 1;
            }
            if (added) message.success(`已上传 ${added} 个素材`);
            else message.warning("仅支持图片、视频或音频文件");
        } catch (error) {
            console.warn("[material library upload failed]", { error });
            message.error("上传失败，请重试");
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    const deleteItem = async (item: MaterialItem) => {
        const hide = message.loading("正在删除素材…", 0);
        try {
            if (item.cloudAssetId) await deleteMaterialLibraryAsset(item.cloudAssetId);
            removeItem(item.id);
            console.info("[material library item removed]", { materialId: item.id, cloud: Boolean(item.cloudAssetId) });
            message.success("素材已删除");
        } catch (error) {
            console.warn("[material library item delete failed]", { materialId: item.id, error });
            message.error("删除素材失败，请重试");
        } finally {
            hide();
        }
    };
    const moveItem = async (item: MaterialItem, folderId: string | null) => {
        if (item.folderId === folderId) return;
        const hide = message.loading("正在移动素材…", 0);
        try {
            const folderName = folderId ? folders.find((folder) => folder.id === folderId)?.name : undefined;
            if (item.cloudAssetId) await moveMaterialLibraryAsset(item.cloudAssetId, folderId, folderName);
            updateItem(item.id, { folderId, folderName });
            console.info("[material library item moved]", { materialId: item.id, folderId, cloud: Boolean(item.cloudAssetId) });
            message.success("素材已移动");
        } catch (error) {
            console.warn("[material library item move failed]", { materialId: item.id, folderId, error });
            message.error("移动素材失败，请重试");
        } finally {
            hide();
        }
    };
    const renameFolderName = async (folder: MaterialFolder, folderName: string) => {
        const normalized = folderName.trim().replace(/\s+/g, " ").slice(0, 48);
        if (!normalized || normalized === folder.name) return;
        const hide = message.loading("正在重命名文件夹…", 0);
        try {
            await renameMaterialLibraryFolder(folder.id, normalized);
            renameFolder(folder.id, normalized);
            message.success("文件夹已重命名");
        } catch (error) {
            console.warn("[material library folder rename failed]", { folderId: folder.id, error });
            message.error("重命名失败，请重试");
        } finally {
            hide();
        }
    };

    return <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索素材库" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <button type="button" title="上传素材" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="grid size-7 shrink-0 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"><Upload className="size-3.5" /></button>
            <button type="button" title="新建文件夹" onClick={() => setCreatingFolder((value) => !value)} className="grid size-7 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10"><Plus className="size-4" /></button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
        </div>
        {creatingFolder ? <div className="flex gap-1.5 px-3 pb-2"><Input size="small" autoFocus placeholder="文件夹名称" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onPressEnter={createFolder} /><button type="button" onClick={createFolder} className="rounded-md px-2 text-xs font-medium" style={{ color: theme.toolbar.activeText }}>创建</button></div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <div className="mb-2 border-b pb-2" style={{ borderColor: theme.toolbar.border }}>
                <button type="button" onClick={() => setSelectedFolderId(ROOT_ID)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition", selectedFolderId === ROOT_ID && "bg-black/10 dark:bg-white/10")}><FolderOpen className="size-3.5" />全部素材<span className="ml-auto opacity-45">{items.length}</span></button>
                {rootFolders.map((folder) => <FolderBranch key={folder.id} folder={folder} folders={folders} items={items} selectedFolderId={selectedFolderId} collapsed={collapsed} onSelect={setSelectedFolderId} onRename={(target, name) => void renameFolderName(target, name)} onToggle={(id) => setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} />)}
            </div>
            <div className="flex items-center justify-between px-1 pb-1"><span className="text-[11px] font-medium opacity-55">{selectedFolderId === ROOT_ID ? "全部素材" : folders.find((folder) => folder.id === selectedFolderId)?.name || "文件夹"}</span><span className="text-[11px] opacity-40">{visibleItems.length}</span></div>
            {visibleItems.length ? <div className="grid grid-cols-2 gap-2">{visibleItems.map((item) => <MaterialCard key={item.id} item={item} folders={folders} onInsert={() => onInsert(materialToInsertPayload(item))} onMove={(folderId) => void moveItem(item, folderId)} onRemove={() => void deleteItem(item)} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这里还没有素材" className="pt-10" />}
        </div>
    </div>;
});

function FolderBranch({ folder, folders, items, selectedFolderId, collapsed, onSelect, onRename, onToggle }: { folder: MaterialFolder; folders: MaterialFolder[]; items: MaterialItem[]; selectedFolderId: string; collapsed: Set<string>; onSelect: (id: string) => void; onRename: (folder: MaterialFolder, name: string) => void; onToggle: (id: string) => void }) {
    const children = folders.filter((candidate) => candidate.parentId === folder.id);
    const isCollapsed = collapsed.has(folder.id);
    const count = items.filter((item) => item.folderId === folder.id).length;
    const [editing, setEditing] = useState(false);
    const [draftName, setDraftName] = useState(folder.name);
    const commitRename = () => {
        const nextName = draftName.trim().replace(/\s+/g, " ").slice(0, 48);
        setEditing(false);
        if (nextName && nextName !== folder.name) onRename(folder, nextName);
    };
    return <div role="treeitem" aria-expanded={children.length ? !isCollapsed : undefined}>
        <div className={cn("group flex items-center rounded-md transition", selectedFolderId === folder.id && "bg-black/10 dark:bg-white/10")}>
            <button type="button" onClick={() => onToggle(folder.id)} className="grid size-6 place-items-center opacity-55" disabled={!children.length}>{children.length ? <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} /> : null}</button>
            {editing ? <div className="flex min-w-0 flex-1 items-center gap-1 py-0.5"><Input size="small" autoFocus value={draftName} maxLength={48} onChange={(event) => setDraftName(event.target.value)} onPressEnter={commitRename} onKeyDown={(event) => { if (event.key === "Escape") { setDraftName(folder.name); setEditing(false); } }} /><button type="button" aria-label="确认重命名" onClick={commitRename} className="grid size-6 shrink-0 place-items-center opacity-70 hover:opacity-100"><Check className="size-3.5" /></button><button type="button" aria-label="取消重命名" onClick={() => { setDraftName(folder.name); setEditing(false); }} className="grid size-6 shrink-0 place-items-center opacity-55 hover:opacity-100"><X className="size-3.5" /></button></div> : <><button type="button" onClick={() => onSelect(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs"><Folder className="size-3.5 shrink-0" /><span className="truncate">{folder.name}</span><span className="ml-auto pr-1 opacity-40">{count}</span></button><button type="button" aria-label={`重命名文件夹 ${folder.name}`} title="重命名文件夹" onClick={() => { setDraftName(folder.name); setEditing(true); }} className="mr-1 grid size-6 shrink-0 place-items-center rounded opacity-0 transition hover:bg-black/10 group-hover:opacity-75 focus:opacity-100 dark:hover:bg-white/10"><Pencil className="size-3" /></button></>}
        </div>
        {!isCollapsed ? <div className="ml-3 border-l pl-1" style={{ borderColor: "rgba(148,163,184,.18)" }}>{children.map((child) => <FolderBranch key={child.id} folder={child} folders={folders} items={items} selectedFolderId={selectedFolderId} collapsed={collapsed} onSelect={onSelect} onRename={onRename} onToggle={onToggle} />)}</div> : null}
    </div>;
}

function MaterialCard({ item, folders, onInsert, onMove, onRemove }: { item: MaterialItem; folders: MaterialFolder[]; onInsert: () => void; onMove: (folderId: string | null) => void; onRemove: () => void }) {
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    const previewStart = () => { if (item.kind === "video") void video?.play().catch((error) => console.warn("[material library video preview failed]", { materialId: item.id, error })); };
    const previewStop = () => { video?.pause(); if (video) video.currentTime = 0; };
    return <div draggable className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border border-white/10 bg-black/10 active:cursor-grabbing" onPointerEnter={previewStart} onPointerLeave={previewStop} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(MATERIAL_LIBRARY_DRAG_MIME, item.id); console.info("[material library drag started]", { materialId: item.id, kind: item.kind }); }}>
        {item.kind === "image" ? <img src={item.url} alt={item.title} className="size-full object-cover" /> : item.kind === "video" ? <video ref={setVideo} src={`${item.url}#t=0.1`} muted playsInline loop preload="metadata" className="size-full object-cover" onError={() => console.warn("[material library video preview unavailable]", { materialId: item.id })} /> : <div className="flex size-full flex-col items-center justify-center gap-2 bg-violet-500/10 text-violet-100"><FileAudio className="size-7" /><span className="line-clamp-2 px-2 text-center text-[10px]">{item.title}</span></div>}
        <button type="button" onClick={onInsert} className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">插入画布</button>
        <Popconfirm title="删除素材？" description="删除后无法恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onRemove}><button type="button" className="absolute right-1 top-1 z-10 grid size-7 place-items-center rounded-md bg-black/65 text-white opacity-0 transition hover:bg-red-500 group-hover:opacity-100" aria-label="删除素材" title="删除素材"><Trash2 className="size-3.5" /></button></Popconfirm>
        <select value={item.folderId || ""} onChange={(event) => onMove(event.target.value || null)} onClick={(event) => event.stopPropagation()} className="absolute bottom-1 left-1 right-1 max-w-[calc(100%-0.5rem)] rounded bg-black/65 px-1 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100"><option value="">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
    </div>;
}
