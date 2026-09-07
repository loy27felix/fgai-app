"use client";

import { useEffect, useState } from "react";
import { Bot, Sparkles } from "lucide-react";

import { AgentCompanion } from "./agent-companion";
import { CodexAgentPanel } from "./codex-agent-panel";
import { LocalAgentPanel } from "./local-agent-panel";
import { useAgentStore } from "@/reference/infinite-canvas/src/stores/use-agent-store";

type AgentMode = "fg" | "codex";

const MODE_STORAGE_KEY = "fg-canvas-agent-mode";

export function CanvasAgentSwitchboard({ embedded }: { embedded?: boolean }) {
    const [mode, setMode] = useState<AgentMode>("fg");
    const [fgStatus, setFgStatus] = useState("等你确认创意方向，我会把下一步拆成可执行的选择。");
    const connected = useAgentStore((state) => state.connected);
    const waiting = useAgentStore((state) => state.waiting);
    const sending = useAgentStore((state) => state.sending);
    const activity = useAgentStore((state) => state.activity);

    useEffect(() => {
        const saved = localStorage.getItem(MODE_STORAGE_KEY);
        if (saved === "codex" || saved === "fg") setMode(saved);
    }, []);

    const changeMode = (next: AgentMode) => {
        setMode(next);
        localStorage.setItem(MODE_STORAGE_KEY, next);
    };

    useEffect(() => {
        const receiveStatus = (event: Event) => {
            const detail = (event as CustomEvent<{ status?: string }>).detail;
            if (typeof detail?.status === "string" && detail.status.trim()) setFgStatus(detail.status);
        };
        const receiveCompletion = (event: Event) => {
            const detail = (event as CustomEvent<{ kind?: "image" | "video"; title?: string }>).detail;
            if (detail?.kind === "video") setFgStatus("视频已完成，先预览挑选版本，再决定是否拼接或继续修改。");
            if (detail?.kind === "image") setFgStatus("图片已完成，可以挑选版本、继续局部修改，或把它接到下一段视频。");
        };
        window.addEventListener("fg-agent-companion-status", receiveStatus);
        window.addEventListener("fg-generation-completed", receiveCompletion);
        return () => {
            window.removeEventListener("fg-agent-companion-status", receiveStatus);
            window.removeEventListener("fg-generation-completed", receiveCompletion);
        };
    }, []);

    const handoffTask = (prompt: string, intent: "chat" | "production" = "chat") => {
        window.dispatchEvent(new CustomEvent("fg-agent-companion-task", {
            detail: { prompt, intent, target: mode },
        }));
        if (mode === "fg" && intent === "production") changeMode("fg");
    };

    const codexBusy = waiting || sending;
    const companionBusy = mode === "codex" ? codexBusy : /正在|生成|制作|等待/.test(fgStatus);
    const companionStatus = mode === "codex"
        ? connected ? (activity || (codexBusy ? "Codex 正在处理你的任务。" : "已连接，等你派发下一项任务。")) : "本机 Codex 尚未连接。"
        : fgStatus;

    return (
        <section className="fg-agent-switchboard relative flex min-h-0 flex-1 flex-col" aria-label="画布智能助手">
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
            <AgentCompanion
                status={companionStatus}
                busy={companionBusy}
                agentLabel={mode === "codex" ? "本机 Codex" : "公司模型 Agent"}
                onTask={handoffTask}
            />
        </section>
    );
}
