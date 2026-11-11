import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, Modal } from "antd";
import { CanvasVideoSettingsPopover } from "@/components/canvas/canvas-video-settings-popover";
import { CanvasPromptOptimizerDrawer } from "@/components/canvas/canvas-prompt-optimizer-drawer";
import { defaultConfig } from "@/stores/use-config-store";
import "@/styles/globals.css";

// Actual production popover and AntD modal, with memory-only settings and no model requests.
export function mountSettingsPopoverHarness(host: HTMLElement) {
    function Harness() {
        const [config, setConfig] = useState({ ...defaultConfig, model: "wan3.0-video", videoSeconds: "30", vquality: "720p", size: "adaptive" });
        return <ConfigProvider theme={{ token: { motion: false } }}>
            <CanvasPromptOptimizerDrawer open={false} prompt="回归验证" generationMode="video" targetModel={config.model} config={config} optimizerModel="" references={[]} provider={null} onClose={() => {}} onApply={() => {}}>
            <div><Modal open centered footer={null} width={960} className="canvas-prompt-editor-modal" styles={{ container: { overflow: "hidden" } }}>
                <div style={{ height: 320, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <textarea aria-label="放大的视频提示词" defaultValue="回归验证，不提交生成" />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <CanvasVideoSettingsPopover config={config} onConfigChange={(key, value) => setConfig(current => ({ ...current, [key]: value }))} />
                    </div>
                    <output id="settings-result">{config.videoSeconds}</output>
                </div>
            </Modal></div>
            </CanvasPromptOptimizerDrawer>
        </ConfigProvider>;
    }
    const root = createRoot(host);
    root.render(<Harness />);
    return () => root.unmount();
}
