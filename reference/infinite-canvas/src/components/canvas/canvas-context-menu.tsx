import { useEffect } from "react";
import type { ReactNode } from "react";
import { CopyPlus, FolderPlus, ImageDown, Trash2 } from "lucide-react";

import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState } from "@/reference/infinite-canvas/src/types/canvas";

export function CanvasNodeContextMenu({ menu, node, onClose, onDuplicate, onDelete, onCaptureVideoFrame, onAddToMaterialLibrary }: { menu: ContextMenuState; node?: CanvasNodeData; onClose: () => void; onDuplicate: () => void; onDelete: () => void; onCaptureVideoFrame?: (frame: "first" | "current" | "last") => void; onAddToMaterialLibrary?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? <MenuButton icon={<CopyPlus className="size-4" />} label="创建副本" onClick={onDuplicate} /> : null}
            {menu.type === "node" && node && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType) && node.metadata?.content && onAddToMaterialLibrary ? <MenuButton icon={<FolderPlus className="size-4" />} label="添加到素材库" onClick={onAddToMaterialLibrary} /> : null}
            {menu.type === "node" && node?.type === CanvasNodeType.Video && node.metadata?.content && onCaptureVideoFrame ? (
                <>
                    <MenuButton icon={<ImageDown className="size-4" />} label="截取首帧为图片" onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton icon={<ImageDown className="size-4" />} label="截取当前帧为图片" onClick={() => onCaptureVideoFrame("current")} />
                    <MenuButton icon={<ImageDown className="size-4" />} label="截取尾帧为图片" onClick={() => onCaptureVideoFrame("last")} />
                </>
            ) : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
