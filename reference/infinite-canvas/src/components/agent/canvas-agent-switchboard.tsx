"use client";

import { useEffect, useState } from "react";
import { Bot, Sparkles } from "lucide-react";

import { CodexAgentPanel } from "./codex-agent-panel";
import { LocalAgentPanel } from "./local-agent-panel";

type AgentMode = "fg" | "codex";

const MODE_STORAGE_KEY = "fg-canvas-agent-mode";

export function CanvasAgentSwitchboard({ embedded }: { embedded?: boolean }) {
    const [mode, setMode] = useState<AgentMode>("fg");

    useEffect(() => {
        const saved = localStorage.getItem(MODE_STORAGE_KEY);
        if (saved === "codex" || saved === "fg") setMode(saved);
    }, []);

    const changeMode = (next: AgentMode) => {
        setMode(next);
        localStorage.setItem(MODE_STORAGE_KEY, next);
    };

    return (
        <section className="fg-agent-switchboard" aria-label="画布智能助手">
            <div className="fg-agent-modebar">
                <div className="fg-agent-mode-copy">
                    <span className="fg-agent-mode-pulse" aria-hidden />
                    <span>画布智能助手</span>
                </div>
                <div className="fg-agent-mode-toggle" role="tablist" aria-label="Agent 模式">
                    <button type="button" role="tab" aria-selected={mode === "fg"} className={mode === "fg" ? "active" : ""} onClick={() => changeMode("fg")}>
                        <Sparkles size={13} /> 公司模型
                    </button>
                    <button type="button" role="tab" aria-selected={mode === "codex"} className={mode === "codex" ? "active" : ""} onClick={() => changeMode("codex")}>
                        <Bot size={13} /> 本机 Codex
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex flex-1 flex-col">{mode === "fg" ? <LocalAgentPanel embedded={embedded} /> : <CodexAgentPanel embedded={embedded} />}</div>
        </section>
    );
}
