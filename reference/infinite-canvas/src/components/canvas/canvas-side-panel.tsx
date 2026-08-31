import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { App, Empty, Input, Popconfirm, Select, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, ChevronRight, Download, Eye, FileText, Folder, Image as ImageIcon, ListChecks, Music2, Plus, Search, Settings2, Square, Trash2, Type, Video } from "lucide-react";
import { motion } from "motion/react";

import { canvasThemes, type CanvasTheme } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { exportCanvasNodes } from "@/reference/infinite-canvas/src/lib/canvas/canvas-export";
import { getNodeDefinition } from "@/reference/infinite-canvas/src/lib/canvas/node-registry";
import { cn } from "@/reference/infinite-canvas/src/lib/utils";
import { PromptDetailDialog } from "@/reference/infinite-canvas/src/pages/prompts/components/prompt-detail-dialog";
import { PromptImagePreview } from "@/reference/infinite-canvas/src/pages/prompts/components/prompt-image-preview";
import { fetchSourcePrompts, type Prompt } from "@/reference/infinite-canvas/src/services/api/prompts";
import { uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import { creatorCanvasAssetContentUrl, creatorVideoContentUrl } from "@/lib/creator/video-client";
import { uploadMediaFile } from "@/reference/infinite-canvas/src/services/file-storage";
import { uploadImage } from "@/reference/infinite-canvas/src/services/image-storage";
import { useAssetStore, type Asset, type AssetKind } from "@/reference/infinite-canvas/src/stores/use-asset-store";
import { usePromptSourceStore } from "@/reference/infinite-canvas/src/stores/use-prompt-source-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/reference/infinite-canvas/src/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

import { ASSET_DRAG_MIME, assetToInsertPayload, type InsertAssetPayload } from "./asset-picker-modal";
import { CanvasAssetsTab } from "./canvas-assets-tab";
import { CanvasMaterialLibraryTab } from "./canvas-material-library-tab";
import type { MaterialInsertPayload } from "@/reference/infinite-canvas/src/stores/use-material-library-store";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type PanelTab = "canvas" | "assets" | "materials" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
    onInsertMaterial?: (payload: MaterialInsertPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset, onInsertMaterial }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[60] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-4 px-4 pt-3.5">
                    <TabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                    <TabButton label="资产" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                    <TabButton label="素材库" active={tab === "materials"} theme={theme} onClick={() => setTab("materials")} />
                    <TabButton label="提示词库" active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {tab === "canvas" ? (
                        <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                    ) : tab === "assets" ? (
                        <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                    ) : tab === "materials" ? (
                        <CanvasMaterialLibraryTab onInsert={(payload) => {
                            if (onInsertMaterial) onInsertMaterial(payload);
                        }} theme={theme} />
                    ) : (
                        <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                    )}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整左侧面板宽度" />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// 画布 Tab —— 列出节点,点击居中放大并选中
// ---------------------------------------------------------------------------

const NODE_FILTER_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: CanvasNodeType.Image },
    { label: "视频", value: CanvasNodeType.Video },
    { label: "文本", value: CanvasNodeType.Text },
    { label: "音频", value: CanvasNodeType.Audio },
    { label: "配置", value: CanvasNodeType.Config },
    { label: "分组", value: CanvasNodeType.Group },
];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

type CanvasNodeTreeItem = {
    node: CanvasNodeData;
    children: CanvasNodeTreeItem[];
};

/**
 * Keep group membership in the side panel structural rather than flattening
 * it into a second, disconnected list. A matching child keeps its ancestor
 * groups visible so search and type filters never hide its location.
 */
function buildCanvasNodeTree(nodes: CanvasNodeData[], matchingNodeIds: Set<string>) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const childrenByParentId = new Map<string, CanvasNodeData[]>();

    nodes.forEach((node) => {
        const parentId = node.metadata?.groupId;
        if (!parentId || !nodeIds.has(parentId)) return;
        const children = childrenByParentId.get(parentId) || [];
        children.push(node);
        childrenByParentId.set(parentId, children);
    });

    const buildBranch = (node: CanvasNodeData, ancestors = new Set<string>()): CanvasNodeTreeItem | null => {
        // Broken or cyclic membership should never prevent the rest of the
        // panel from rendering. The log makes malformed imports traceable.
        if (ancestors.has(node.id)) {
            console.warn("[canvas side panel] skipped cyclic group membership", { nodeId: node.id, groupId: node.metadata?.groupId });
            return null;
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(node.id);
        const children = (childrenByParentId.get(node.id) || []).map((child) => buildBranch(child, nextAncestors)).filter((child): child is CanvasNodeTreeItem => Boolean(child));
        if (!matchingNodeIds.has(node.id) && !children.length) return null;
        return { node, children };
    };

    return nodes
        .filter((node) => {
            const parentId = node.metadata?.groupId;
            return !parentId || !nodeIds.has(parentId);
        })
        .map((node) => buildBranch(node))
        .filter((branch): branch is CanvasNodeTreeItem => Boolean(branch));
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);
    const tree = useMemo(() => buildCanvasNodeTree(nodes, new Set(filtered.map((node) => node.id))), [nodes, filtered]);

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));
    const toggleGroup = (groupId: string) => {
        setCollapsedGroupIds((current) => {
            const next = new Set(current);
            const willCollapse = !next.has(groupId);
            if (willCollapse) next.add(groupId);
            else next.delete(groupId);
            console.info("[canvas side panel] group tree toggled", { groupId, collapsed: willCollapse });
            return next;
        });
    };

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading("正在导出选中元素…", 0);
        try {
            await exportCanvasNodes(targets, `画布元素-${targets.length}个`);
            message.success(`已导出 ${targets.length} 个元素`);
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error("导出失败，请重试");
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="text-xs font-medium opacity-60">画布元素</span>
                {filtered.length ? <span className="text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? "取消" : "选择"}
                </button>
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS} />}
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索节点" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {tree.length ? (
                    <div className="space-y-1.5">
                        {tree.map((branch) => (
                            <CanvasNodeTreeBranch
                                key={branch.node.id}
                                branch={branch}
                                collapsedGroupIds={collapsedGroupIds}
                                selectedNodeIds={selectedNodeIds}
                                checked={checked}
                                selectMode={selectMode}
                                theme={theme}
                                onToggleGroup={toggleGroup}
                                onToggleChecked={toggleChecked}
                                onFocusNode={onFocusNode}
                                onPreviewNode={onPreviewNode}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{nodes.length ? "没有匹配的节点" : "画布暂无节点"}</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {allChecked ? "取消全选" : "全选"}
                    </button>
                    <span className="text-xs opacity-45">已选 {checked.size}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        导出选中
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function CanvasNodeTreeBranch({ branch, collapsedGroupIds, selectedNodeIds, checked, selectMode, theme, onToggleGroup, onToggleChecked, onFocusNode, onPreviewNode }: {
    branch: CanvasNodeTreeItem;
    collapsedGroupIds: Set<string>;
    selectedNodeIds: Set<string>;
    checked: Set<string>;
    selectMode: boolean;
    theme: CanvasTheme;
    onToggleGroup: (groupId: string) => void;
    onToggleChecked: (nodeId: string) => void;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
}) {
    const { node, children } = branch;
    const isGroup = node.type === CanvasNodeType.Group;
    const canCollapse = isGroup && children.length > 0;
    const collapsed = canCollapse && collapsedGroupIds.has(node.id);
    const Icon = NODE_TYPE_ICON[node.type] || FileText;
    const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
    const isChecked = checked.has(node.id);
    const active = selectMode ? isChecked : selectedNodeIds.has(node.id);

    return (
        <div role="treeitem" aria-expanded={canCollapse ? !collapsed : undefined} className="min-w-0">
            <div className={cn("group flex w-full items-center rounded-lg transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")} style={active ? { background: theme.toolbar.activeBg } : undefined}>
                {isGroup ? (
                    <button
                        type="button"
                        onClick={() => onToggleGroup(node.id)}
                        className="ml-1 grid size-6 shrink-0 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                        aria-label={collapsed ? `展开分组 ${node.title || "未命名分组"}` : `收起分组 ${node.title || "未命名分组"}`}
                        aria-expanded={canCollapse ? !collapsed : undefined}
                        disabled={!canCollapse}
                    >
                        <ChevronRight className={cn("size-3.5 transition-transform duration-150", collapsed ? "" : "rotate-90")} />
                    </button>
                ) : <span className="ml-1 size-6 shrink-0" />}
                <button type="button" onClick={() => (selectMode ? onToggleChecked(node.id) : onFocusNode(node.id))} className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-2 text-left" title={selectMode ? undefined : "定位到节点"}>
                    {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md" style={isGroup ? { background: theme.node.fill } : undefined}>
                        {isImage ? <img src={node.metadata!.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-4.5 opacity-65" />}
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block truncate text-sm font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || (isGroup ? "未命名分组" : "未命名节点")}</span>
                        <span className="block truncate text-xs leading-snug opacity-50">{isGroup ? `${children.length} 个节点` : nodePreviewText(node)}</span>
                    </span>
                    {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                </button>
                {selectMode || !isImage ? null : (
                    <button type="button" onClick={() => onPreviewNode(node.id)} className="mr-1.5 grid size-7 shrink-0 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="放大预览" title="放大预览">
                        <Eye className="size-3.5" />
                    </button>
                )}
            </div>
            {canCollapse && !collapsed ? (
                <div role="group" className="ml-4 border-l pl-1.5" style={{ borderColor: theme.toolbar.border }}>
                    <div className="space-y-1 pt-1">
                        {children.map((child) => (
                            <CanvasNodeTreeBranch
                                key={child.node.id}
                                branch={child}
                                collapsedGroupIds={collapsedGroupIds}
                                selectedNodeIds={selectedNodeIds}
                                checked={checked}
                                selectMode={selectMode}
                                theme={theme}
                                onToggleGroup={onToggleGroup}
                                onToggleChecked={onToggleChecked}
                                onFocusNode={onFocusNode}
                                onPreviewNode={onPreviewNode}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// 素材库 —— 以工作区为范围，按文件夹筛选并按媒体类型折叠展示。
// ---------------------------------------------------------------------------

const MATERIAL_FOLDERS = [
    { id: "uncategorized", label: "未分类" },
    { id: "characters", label: "人物角色" },
    { id: "scenes", label: "场景" },
    { id: "props", label: "道具" },
    { id: "styles", label: "风格" },
    { id: "sound", label: "音效" },
] as const;

const ASSET_GROUPS: { kind: AssetKind; label: string; icon: typeof Square }[] = [
    { kind: "image", label: "图片", icon: ImageIcon },
    { kind: "video", label: "视频", icon: Video },
    { kind: "audio", label: "音频", icon: Music2 },
    { kind: "text", label: "文本", icon: FileText },
];

function materialFolderId(asset: Asset) {
    const metadataFolder = typeof asset.metadata?.library_folder === "string" ? asset.metadata.library_folder : "";
    return asset.folderId || metadataFolder || "uncategorized";
}

const LegacyMergedMaterialTab = memo(function LegacyMergedMaterialTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [folderFilter, setFolderFilter] = useState<string>("all");
    const [uploadFolderId, setUploadFolderId] = useState<string>("uncategorized");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (folderFilter === "all" || materialFolderId(asset) === folderFilter) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, folderFilter, keyword]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);
    const folderCounts = useMemo(() => new Map(MATERIAL_FOLDERS.map((folder) => [folder.id, assets.filter((asset) => materialFolderId(asset) === folder.id).length])), [assets]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading("正在添加资产…", 0);
        let added = 0;
        try {
            for (const file of files) {
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file);
                    let durable: Awaited<ReturnType<typeof uploadCanvasAsset>> | null = null;
                    try {
                        durable = await uploadCanvasAsset(file, { kind: "image", source: "upload", name: file.name, folderId: uploadFolderId });
                    } catch (error) {
                        console.warn("[material library durable copy failed]", { kind: "image", name: file.name, folderId: uploadFolderId, error });
                    }
                    addAsset({ kind: "image", title: file.name || "图片", coverUrl: durable?.contentUrl || image.url, tags: [], folderId: uploadFolderId, data: { dataUrl: durable?.contentUrl || image.url, storageKey: image.storageKey, cloudStoragePath: durable?.storagePath, cloudAssetId: durable?.assetId || undefined, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType }, metadata: { library_folder: uploadFolderId, durable: Boolean(durable) } });
                    added += 1;
                } else if (file.type.startsWith("video/")) {
                    const media = await uploadMediaFile(file, "video");
                    let durable: Awaited<ReturnType<typeof uploadCanvasAsset>> | null = null;
                    try {
                        durable = await uploadCanvasAsset(file, { kind: "video", source: "upload", name: file.name, folderId: uploadFolderId });
                    } catch (error) {
                        console.warn("[material library durable copy failed]", { kind: "video", name: file.name, folderId: uploadFolderId, error });
                    }
                    addAsset({
                        kind: "video",
                        title: file.name || "视频",
                        coverUrl: "",
                        tags: [],
                        folderId: uploadFolderId,
                        data: {
                            url: durable?.contentUrl || media.url,
                            storageKey: media.storageKey,
                            cloudStoragePath: durable?.storagePath,
                            cloudAssetId: durable?.assetId || undefined,
                            width: media.width || 0,
                            height: media.height || 0,
                            bytes: media.bytes,
                            mimeType: media.mimeType,
                        },
                        metadata: durable ? { durable: true, library_folder: uploadFolderId } : { durable: false, library_folder: uploadFolderId, durableUploadError: "云端备份失败，当前视频仅保存在本机浏览器" },
                    });
                    if (!durable) message.warning(`${file.name || "视频"} 已添加，但云端备份失败；请保持本浏览器缓存可用后重试上传`);
                    added += 1;
                } else if (file.type.startsWith("audio/")) {
                    const audio = await uploadMediaFile(file, "audio");
                    let durable: Awaited<ReturnType<typeof uploadCanvasAsset>> | null = null;
                    try {
                        durable = await uploadCanvasAsset(file, { kind: "audio", source: "upload", name: file.name, folderId: uploadFolderId });
                    } catch (error) {
                        console.warn("[material library durable copy failed]", { kind: "audio", name: file.name, folderId: uploadFolderId, error });
                    }
                    addAsset({ kind: "audio", title: file.name || "音频", coverUrl: "", tags: [], folderId: uploadFolderId, data: { url: durable?.contentUrl || audio.url, storageKey: audio.storageKey, cloudStoragePath: durable?.storagePath, cloudAssetId: durable?.assetId || undefined, bytes: audio.bytes, mimeType: audio.mimeType, durationMs: audio.durationMs }, metadata: { durable: Boolean(durable), library_folder: uploadFolderId } });
                    if (!durable) message.warning(`${file.name || "音频"} 已添加，但云端备份失败；请保持本浏览器缓存可用后重试上传`);
                    added += 1;
                }
            }
            if (added) message.success(`已添加 ${added} 个资产`);
            else message.warning("仅支持图片、视频或音频文件");
        } catch (error) {
            console.error(error);
            message.error("添加失败，请重试");
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索素材" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <Select size="small" value={uploadFolderId} className="w-24 shrink-0" options={MATERIAL_FOLDERS.map((folder) => ({ value: folder.id, label: folder.label }))} onChange={setUploadFolderId} aria-label="上传素材所在文件夹" />
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <Plus className="size-3.5" />
                    导入
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2" role="tree" aria-label="素材文件夹">
                <button type="button" role="treeitem" aria-selected={folderFilter === "all"} onClick={() => setFolderFilter("all")} className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition", folderFilter === "all" ? "bg-black/10 dark:bg-white/15" : "opacity-60 hover:opacity-100")}><Folder className="size-3" />全部 <span className="opacity-55">{assets.length}</span></button>
                {MATERIAL_FOLDERS.map((folder) => (
                    <button key={folder.id} type="button" role="treeitem" aria-selected={folderFilter === folder.id} onClick={() => setFolderFilter(folder.id)} className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition", folderFilter === folder.id ? "bg-black/10 dark:bg-white/15" : "opacity-60 hover:opacity-100")}><Folder className="size-3" />{folder.label} <span className="opacity-55">{folderCounts.get(folder.id) || 0}</span></button>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{group.label}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(assetToInsertPayload(asset))} onRemove={() => (removeAsset(asset.id), message.success("素材已移除"))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此文件夹暂无素材" className="pt-16" />
                )}
            </div>
        </div>
    );
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
    const startPreview = () => {
        if (asset.kind !== "video") return;
        const video = videoElement;
        if (!video) return;
        void video.play().catch((error) => console.warn("[canvas asset video preview failed]", { assetId: asset.id, error }));
    };
    const stopPreview = () => {
        const video = videoElement;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    };
    return (
        <div
            draggable
            className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing"
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
            onPointerEnter={startPreview}
            onPointerLeave={stopPreview}
            onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
                console.info("[material library drag started]", { assetId: asset.id, kind: asset.kind, folderId: materialFolderId(asset) });
            }}
        >
            <AssetCover asset={asset} videoRef={setVideoElement} />
            <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label="插入画布"
                >
                    <Plus className="size-4" />
                </button>
                <Popconfirm title="移除该资产?" okText="移除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label="移除资产"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset, videoRef }: { asset: Asset; videoRef?: Ref<HTMLVideoElement> }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") return <VideoAssetCover asset={asset} videoRef={videoRef} />;
    if (asset.kind === "audio") return <AudioAssetCover asset={asset} />;
    return <img src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
}

function AudioAssetCover({ asset }: { asset: Extract<Asset, { kind: "audio" }> }) {
    return (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-violet-500/10 px-2 text-center text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
            <Music2 className="size-7" />
            <span className="line-clamp-2 text-[10px] font-medium leading-4">{asset.title}</span>
            {asset.data.url ? <audio src={asset.data.url} preload="metadata" className="hidden" onError={() => console.warn("[material library audio preview failed]", { assetId: asset.id, hasCloudBackup: Boolean(asset.data.cloudStoragePath) })} /> : null}
        </div>
    );
}

function VideoAssetCover({ asset, videoRef }: { asset: Extract<Asset, { kind: "video" }>; videoRef?: Ref<HTMLVideoElement> }) {
    const [failedUrls, setFailedUrls] = useState<string[]>([]);
    const fallbackUrl = asset.data.creatorTaskId
        ? creatorVideoContentUrl(asset.data.creatorTaskId)
        : asset.data.cloudStoragePath
            ? creatorCanvasAssetContentUrl(asset.data.cloudStoragePath)
            : "";
    const sourceUrl = !failedUrls.includes(asset.data.url)
        ? asset.data.url
        : fallbackUrl && !failedUrls.includes(fallbackUrl)
            ? fallbackUrl
            : "";
    const isUnavailable = !sourceUrl;

    if (isUnavailable) {
        return (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 px-3 text-center" style={{ color: "rgba(148,163,184,.9)" }}>
                <Video className="size-5 opacity-70" />
                <span className="text-[10px] leading-4">视频副本不可用</span>
                <span className="text-[9px] leading-3 opacity-65">请从原始文件重新上传</span>
            </div>
        );
    }

    return (
        <video
            ref={videoRef}
            key={sourceUrl}
            src={`${sourceUrl}#t=0.1`}
            muted
            playsInline
            loop
            preload="metadata"
            className="size-full object-cover transition duration-300 group-hover:scale-[1.04]"
            onError={() => {
                console.warn("[canvas asset video playback failed]", { assetId: asset.id, hasCloudBackup: Boolean(asset.data.cloudStoragePath), hasCreatorTask: Boolean(asset.data.creatorTaskId), urlKind: sourceUrl.startsWith("blob:") ? "blob" : "remote" });
                setFailedUrls((previous) => previous.includes(sourceUrl) ? previous : [...previous, sourceUrl]);
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// 提示词库 Tab —— 按来源折叠分组,展开时按需加载,点击复制 / 插入文本节点
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [detail, setDetail] = useState<Prompt | null>(null);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("已复制提示词");
        } catch {
            message.error("复制失败");
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索提示词" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-1">
                    {enabledSources.length ? enabledSources.map((source) => (
                        <PromptSourceGroup
                            key={source.id}
                            sourceId={source.id}
                            sourceName={source.name}
                            keyword={keyword}
                            open={!!expanded[source.id]}
                            theme={theme}
                            onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                            onInsert={onInsert}
                            onView={setDetail}
                        />
                    )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无提示词" className="pt-12" />}
                </div>
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

function PromptSourceGroup({
    sourceId,
    sourceName,
    keyword,
    open,
    theme,
    onToggle,
    onInsert,
    onView,
}: {
    sourceId: string;
    sourceName: string;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onView: (prompt: Prompt) => void;
}) {
    // 展开过一次即缓存,避免收起后重复请求;搜索命中时也需要拿到数据来计数。
    const showResults = open || !!keyword.trim();
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });

    const filtered = useMemo(() => {
        const items = query.data || [];
        const q = keyword.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(q));
    }, [query.data, keyword]);

    const insertPrompt = (item: Prompt) => onInsert({ kind: "text", content: item.prompt, title: item.title });

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{sourceName}</span>
                {showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
            </button>
            {showResults ? (
                <div className="px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            加载失败,点击重试
                        </button>
                    ) : filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.map((item) => (
                                <PromptRow key={item.id} item={item} theme={theme} onInsert={() => insertPrompt(item)} onView={() => onView(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{keyword.trim() ? "无匹配提示词" : "该来源暂无提示词"}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                                        <PromptImagePreview src={item.coverUrl} promptId={item.id} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="查看详情" title="查看详情">
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label="插入画布"
                    title="插入画布"
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
