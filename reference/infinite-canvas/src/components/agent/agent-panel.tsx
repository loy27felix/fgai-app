import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";

import { CanvasAgentSwitchboard } from "./canvas-agent-switchboard";
import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/reference/infinite-canvas/src/stores/use-agent-store";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);

    useEffect(() => {
        const update = () => setViewportWidth(window.innerWidth);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const effectiveWidth = viewportWidth > 0 ? Math.min(width, Math.max(360, viewportWidth - 24)) : width;
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = effectiveWidth;
        let nextWidth = startWidth;
        const maxWidth = viewportWidth > 0 ? Math.min(820, Math.max(360, viewportWidth - 24)) : 820;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(maxWidth, Math.max(360, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
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
        <motion.div className="relative z-[70] flex h-full shrink-0" initial={{ width: 0, opacity: 0 }} animate={{ width: panelOpen ? effectiveWidth + 1 : 0, opacity: panelOpen ? 1 : 0 }} transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}>
            <motion.aside className="relative flex h-full min-w-0 shrink-0 flex-col border-l" data-canvas-shortcuts-ignore initial={{ x: 48 }} animate={{ x: panelClosing ? 28 : 0 }} transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }} style={{ width: effectiveWidth, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整右侧面板宽度" />
                <CanvasAgentSwitchboard embedded />
            </motion.aside>
        </motion.div>
    );
}
