import { useMemo, useRef, useState } from "react";
import { Button, Segmented } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, Trash2 } from "lucide-react";

import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import type { AgentEventLog } from "@/reference/infinite-canvas/src/stores/use-agent-store";
import { formatLogJson, formatLogText, type AgentLogContext } from "./agent-event-formatters";

type LogFilter = "all" | "errors" | "tools" | "system";

function matchesFilter(item: AgentEventLog, filter: LogFilter) {
    if (filter === "all") return true;
    const text = `${item.title}\n${item.text}`;
    if (filter === "errors") return /错误|失败|error|exception/i.test(text);
    if (filter === "tools") return /工具|执行|读取|修改|搜索|创建|画布|tool|call/i.test(text);
    return !/错误|失败|error|exception|工具|执行|读取|修改|搜索|创建|画布|tool|call/i.test(text);
}

export function AgentLogView({ logs, theme, context, onClear, onCopied, onCopyBlocked }: { logs: AgentEventLog[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; context: AgentLogContext; onClear: () => void; onCopied: (text: string) => void; onCopyBlocked: (text: string) => void; }) {
    const [mode, setMode] = useState<"text" | "json">("text");
    const [filter, setFilter] = useState<LogFilter>("all");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const visibleLogs = useMemo(() => logs.filter((item) => matchesFilter(item, filter)), [filter, logs]);
    const content = mode === "text" ? formatLogText(visibleLogs, context) : formatLogJson(visibleLogs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = "日志已复制") => {
        if (await copyToClipboard(value)) { onCopied(tip); return; }
        textareaRef.current?.focus(); textareaRef.current?.select(); onCopyBlocked("已选中日志，请手动复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4"><div className="flex min-h-full flex-col gap-3">
            <div><div className="text-base font-semibold leading-6">运行日志</div><div className="mt-1 text-xs" style={{ color: theme.node.muted }}>筛选、去重后的事件记录</div></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2"><Segmented size="small" value={mode} onChange={(value) => setMode(value as "text" | "json")} options={[{ label: "排查日志", value: "text" }, { label: "原始 JSON", value: "json" }]} /><Segmented size="small" value={filter} onChange={(value) => setFilter(value as LogFilter)} options={[{ label: "全部", value: "all" }, { label: "错误", value: "errors" }, { label: "工具", value: "tools" }, { label: "系统", value: "system" }]} /></div><div className="flex items-center gap-2"><span className="text-xs" style={{ color: theme.node.muted }}>{visibleLogs.length}/{logs.length} 条</span><Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>复制</Button><Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), "最近错误已复制")}>最近错误</Button><Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>清空</Button></div></div>
            <textarea ref={textareaRef} readOnly value={content} className="thin-scrollbar min-h-[360px] flex-1 resize-none rounded-lg border bg-transparent p-3 font-mono text-xs leading-5 outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onFocus={(event) => event.currentTarget.select()} />
        </div></div>
    );
}
