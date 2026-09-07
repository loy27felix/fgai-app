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
            <AgentCompanion
                status={companionStatus}
                busy={companionBusy}
                agentLabel={mode === "codex" ? "本机 Codex" : "公司模型 Agent"}
                onTask={handoffTask}
            />
            <div className="min-h-0 flex flex-1 flex-col">{mode === "fg" ? <LocalAgentPanel embedded={embedded} /> : <CodexAgentPanel embedded={embedded} />}</div>
            <style jsx global>{`
                .fg-agent-companion{position:relative;isolation:isolate;margin:9px 10px 7px;overflow:hidden;border:1px solid rgba(96,235,198,.26);border-radius:16px;background:linear-gradient(132deg,rgba(15,38,42,.98),rgba(15,24,35,.98));box-shadow:inset 0 1px rgba(255,255,255,.045),0 14px 28px rgba(0,0,0,.18);padding:10px 11px;color:#e7fff8}
                .fg-agent-companion:before{content:"";position:absolute;z-index:-1;inset:0;opacity:.58;background:linear-gradient(106deg,transparent 0 48%,rgba(81,244,194,.075) 48% 49%,transparent 49%),radial-gradient(170px 95px at 93% 0,rgba(56,213,255,.2),transparent 74%)}
                .fg-agent-companion-orbit{position:absolute;z-index:-1;right:-34px;top:-53px;width:130px;height:130px;border:1px solid rgba(118,245,208,.14);border-radius:50%;transform:rotate(-18deg)}
                .fg-agent-companion-orbit:before,.fg-agent-companion-orbit:after{content:"";position:absolute;inset:14px;border:1px solid rgba(118,245,208,.1);border-radius:50%}.fg-agent-companion-orbit:after{inset:37px}
                .fg-agent-companion-orbit i{position:absolute;width:4px;height:4px;border-radius:50%;background:#79ffd4;box-shadow:0 0 12px #66ffd2}.fg-agent-companion-orbit i:nth-child(1){top:29px;right:2px}.fg-agent-companion-orbit i:nth-child(2){bottom:16px;left:19px}.fg-agent-companion-orbit i:nth-child(3){top:11px;left:53px}
                .fg-agent-companion-topline{display:flex;align-items:center;justify-content:space-between;gap:8px;color:rgba(196,255,236,.68);font:9px "JetBrains Mono",monospace;letter-spacing:.9px}.fg-agent-companion-topline span{display:inline-flex;align-items:center;gap:5px}.fg-agent-companion-topline em{font-style:normal;color:#7dffce;font-size:8px}.fg-agent-companion-main{display:flex;align-items:center;gap:10px;margin-top:7px}.fg-agent-companion-avatar{position:relative;flex:0 0 52px;width:52px;height:52px;overflow:hidden;border:1px solid rgba(124,255,210,.55);border-radius:17px;background:radial-gradient(circle at 50% 34%,#dbfff0 0 5%,#6affe0 6% 9%,transparent 10%),linear-gradient(140deg,#15656b,#172d48 70%);color:#092229;cursor:pointer;box-shadow:0 0 0 3px rgba(89,239,189,.09),inset 0 -8px 16px rgba(1,16,24,.35);transition:transform .18s ease,border-color .18s ease}.fg-agent-companion-avatar:hover{transform:translateY(-2px);border-color:#bdffe5}.fg-agent-companion-avatar img{width:100%;height:100%;object-fit:cover}.fg-agent-companion-avatar.uploaded{border-radius:50%}.fg-agent-companion-avatar svg{position:absolute;left:11px;bottom:6px;color:#cbfff0}.fg-agent-companion-spark{position:absolute;top:2px;right:5px;color:#f9ffab;font-size:12px;text-shadow:0 0 10px #f5ffac}.fg-agent-companion-eye{position:absolute;bottom:22px;width:4px;height:4px;border-radius:50%;background:#071b21;box-shadow:0 0 0 2px rgba(240,255,249,.86)}.fg-agent-companion-eye.left{left:19px}.fg-agent-companion-eye.right{left:29px}.fg-agent-companion-camera{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:21px;height:21px;border:1px solid rgba(223,255,245,.65);border-radius:50%;background:#0d2d39;color:#b9ffe5}.fg-agent-companion-copy{min-width:0;flex:1}.fg-agent-companion-copy label{display:grid;gap:2px;color:rgba(198,255,238,.61);font-size:9px}.fg-agent-companion-copy input{width:100%;padding:0;border:0;background:transparent;color:#f0fff9;font-weight:750;font-size:15px;line-height:1.2;outline:0}.fg-agent-companion-copy p{display:flex;align-items:flex-start;gap:5px;margin:3px 0 0;color:rgba(225,255,244,.77);font-size:10px;line-height:1.45}.fg-agent-companion-copy p span{flex:0 0 5px;width:5px;height:5px;margin-top:5px;border-radius:50%;background:#68d7be}.fg-agent-companion-copy p span.live{background:#a7ff77;box-shadow:0 0 8px #a7ff77;animation:fg-companion-pulse 1.2s ease-in-out infinite}@keyframes fg-companion-pulse{50%{transform:scale(.62);opacity:.45}}
                .fg-agent-companion-mission{display:grid;gap:5px;margin-top:9px;color:rgba(198,255,238,.65);font:9px "JetBrains Mono",monospace;letter-spacing:.25px}.fg-agent-companion-mission textarea{min-height:45px;resize:vertical;padding:7px 8px;border:1px solid rgba(145,255,220,.16);border-radius:9px;background:rgba(3,13,21,.46);color:#ddfff3;font:10.5px/1.45 ui-sans-serif,system-ui,sans-serif;outline:0}.fg-agent-companion-mission textarea:focus{border-color:rgba(127,255,208,.58);box-shadow:0 0 0 2px rgba(107,249,196,.08)}.fg-agent-companion-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.fg-agent-companion-actions button,.fg-agent-companion-notification{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:30px;border:1px solid rgba(133,255,215,.24);border-radius:9px;background:rgba(66,229,185,.08);color:#c9ffea;font-size:10px;cursor:pointer;transition:background .16s ease,transform .16s ease}.fg-agent-companion-actions button:hover{transform:translateY(-1px);background:rgba(66,229,185,.16)}.fg-agent-companion-actions button:last-child{border-color:rgba(117,208,255,.26);background:rgba(84,153,255,.1);color:#d7efff}.fg-agent-companion-notification{width:100%;margin-top:7px;background:transparent;color:rgba(203,255,237,.72)}.fg-agent-companion-notification.ready{border-color:rgba(169,255,114,.36);color:#b8ff8f;cursor:default}.fg-agent-companion-notification:disabled{opacity:1}.fg-agent-companion-notice{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin:7px 1px 0;color:#ffe6a8;font-size:9.5px;line-height:1.45}.fg-agent-companion-notice button{padding:0;border:0;background:transparent;color:inherit;cursor:pointer}.fg-agent-companion>small{display:block;margin:7px 1px 0;color:rgba(198,255,238,.43);font-size:8.5px;line-height:1.35}
            `}</style>
        </section>
    );
}
