import { type ReactNode } from "react";

import { ImageSettingsTheme } from "@/reference/infinite-canvas/src/components/image-settings-panel";
import { type CanvasTheme } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/reference/infinite-canvas/src/stores/use-config-store";
import { REASONING_EFFORT_OPTIONS, reasoningEffortLabel as getReasoningEffortLabel } from "@/lib/ai/reasoning";

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-4" }: TextSettingsPanelProps) {
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className="text-lg font-semibold">文本设置</div>
                <div className="space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>推理强度</div>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                        {REASONING_EFFORT_OPTIONS.map((item) => (
                            <OptionPill key={item.value} selected={config.reasoningEffort === item.value} theme={theme} onClick={() => onConfigChange("reasoningEffort", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return getReasoningEffortLabel(value);
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
