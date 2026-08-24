"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { App, Button, Tooltip } from "antd";
import { Bot, CircleAlert, History, MessageSquare, Plus, PlugZap, ScrollText, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { activateAgentClient, fetchAgentJson, postCodexApproval, postState, postToolResult } from "./agent-api";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatTimeline, AgentTaskProgress, AgentUsageBar } from "./agent-chat";
import { AgentConnectView } from "./agent-connect-view";
import { agentAttachmentToChatAttachment, agentErrorView, eventUsage, formatAgentActivity, formatAgentEvent, formatAgentEventLog, formatAgentPlan, isCanvasWriteTool, parseEventData, toolName } from "./agent-event-formatters";
import { AgentHistoryView } from "./agent-history-view";
import { AgentLogView } from "./agent-log-view";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { runSiteTool, isSiteTool } from "@/reference/infinite-canvas/src/lib/agent/agent-site-tools";
import type { CanvasAgentOp } from "@/reference/infinite-canvas/src/lib/canvas/canvas-agent-ops";
import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { randomId } from "@/reference/infinite-canvas/src/lib/utils";
import { useAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentPendingApproval, type AgentThreadSummary } from "@/reference/infinite-canvas/src/stores/use-agent-store";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";

type AgentHello = {
    protocolVersion?: number;
    codex?: { busy?: boolean; threadId?: string; turnId?: string };
    workspace?: { activeThreadId?: string; workspacePath?: string };
    conversation?: { threadId?: string; status?: string };
    pendingApprovals?: AgentPendingApproval[];
};

type AgentThreadsResponse = { data?: AgentThreadSummary[]; threads?: AgentThreadSummary[]; workspace?: { activeThreadId?: string; workspacePath?: string }; conversation?: { threadId?: string } };
type AgentThreadResponse = { data?: AgentThreadSummary; thread?: AgentThreadSummary; messages?: AgentChatItem[]; workspace?: { activeThreadId?: string; workspacePath?: string }; conversation?: { threadId?: string } };
type AgentWorkspaceResponse = { workspace?: { activeThreadId?: string; workspacePath?: string }; conversation?: { threadId?: string } };
type AgentTurnResponse = { threadId?: string; turnId?: string; workspace?: { activeThreadId?: string }; conversation?: { threadId?: string } };

const MAX_ATTACHMENTS = 9;

export function CodexAgentPanel({ embedded: _embedded }: { embedded?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const navigate = useNavigate();
    const { message } = App.useApp();
    const url = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const enabled = useAgentStore((state) => state.enabled);
    const connected = useAgentStore((state) => state.connected);
    const prompt = useAgentStore((state) => state.prompt);
    const attachments = useAgentStore((state) => state.attachments);
    const sending = useAgentStore((state) => state.sending);
    const waiting = useAgentStore((state) => state.waiting);
    const tokenUsage = useAgentStore((state) => state.tokenUsage);
    const eventLogs = useAgentStore((state) => state.eventLogs);
    const threads = useAgentStore((state) => state.threads);
    const activeThreadId = useAgentStore((state) => state.activeThreadId);
    const workspacePath = useAgentStore((state) => state.workspacePath);
    const loadingThreads = useAgentStore((state) => state.loadingThreads);
    const activeTab = useAgentStore((state) => state.activeTab);
    const confirmTools = useAgentStore((state) => state.confirmTools);
    const permissionMode = useAgentStore((state) => state.permissionMode);
    const activity = useAgentStore((state) => state.activity);
    const connectError = useAgentStore((state) => state.connectError);
    const pendingTool = useAgentStore((state) => state.pendingTool);
    const pendingApprovals = useAgentStore((state) => state.pendingApprovals);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const disconnectAgent = useAgentStore((state) => state.disconnectAgent);
    const addMessage = useAgentStore((state) => state.addMessage);
    const addEventLog = useAgentStore((state) => state.addEventLog);
    const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
    const closePanel = useAgentStore((state) => state.closePanel);
    const clientIdRef = useRef(`fg-super-canvas-${randomId()}`);
    const canvasContextRef = useRef(useAgentStore.getState().canvasContext);
    const navigateRef = useRef(navigate);
    const connectionRef = useRef<EventSource | null>(null);

    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const activeAttachments = useMemo(() => attachments.map(agentAttachmentToChatAttachment), [attachments]);

    useEffect(() => {
        navigateRef.current = navigate;
    }, [navigate]);

    useEffect(() => {
        const unsubscribe = useAgentStore.subscribe((state) => {
            canvasContextRef.current = state.canvasContext;
        });
        return unsubscribe;
    }, []);

    const log = useCallback((title: string, text: string, raw?: unknown) => {
        addEventLog({ id: randomId(), time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), title, text, raw });
    }, [addEventLog]);

    const mergeMessage = useCallback((next: AgentChatItem) => {
        const state = useAgentStore.getState();
        const index = state.messages.findIndex((item) => item.id === next.id || (next.streamId && item.streamId === next.streamId));
        if (index < 0) {
            addMessage(next);
            return;
        }
        const messages = [...state.messages];
        messages[index] = { ...messages[index], ...next, attachments: next.attachments || messages[index].attachments };
        setAgentState({ messages });
    }, [addMessage, setAgentState]);

    const loadThreads = useCallback(async (includeHistory = true) => {
        if (!endpoint || !token.trim()) return;
        setAgentState({ loadingThreads: true });
        try {
            const response = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, "/agent/codex/threads");
            const nextThreads = response.data || response.threads || [];
            const nextThreadId = response.conversation?.threadId || response.workspace?.activeThreadId || useAgentStore.getState().activeThreadId;
            setAgentState({ threads: nextThreads, workspacePath: response.workspace?.workspacePath || "", activeThreadId: nextThreadId || "", connectError: "" });
            if (includeHistory && nextThreadId) {
                const thread = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(nextThreadId)}`);
                if (Array.isArray(thread.messages)) setAgentState({ messages: thread.messages });
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : "读取 Codex 历史失败";
            log("读取历史失败", text, error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [endpoint, log, setAgentState, token]);

    const handleToolCall = useCallback(async (payload: { requestId?: string; name?: string; input?: Record<string, unknown> }, bypassConfirmation = false) => {
        const requestId = String(payload.requestId || "");
        const name = String(payload.name || "");
        const input = payload.input || {};
        if (!requestId || !name) return;
        const current = useAgentStore.getState();
        if (!bypassConfirmation && current.confirmTools && isCanvasWriteTool(name)) {
            setAgentState({ pendingTool: { requestId, name, input } });
            return;
        }
        try {
            let result: unknown;
            if (isSiteTool(name)) {
                result = await runSiteTool(name, input, navigateRef.current, { canvasSnapshot: canvasContextRef.current?.snapshot || null });
            } else if (name === "site_navigate") {
                const path = typeof input.path === "string" ? input.path : "/";
                navigateRef.current(path);
                result = { ok: true, path };
            } else if (name === "canvas_apply_ops") {
                result = canvasContextRef.current?.applyOps(Array.isArray(input.ops) ? (input.ops as CanvasAgentOp[]) : []) || { ok: false, error: "当前未打开画布" };
            } else if (name === "canvas_undo") {
                result = canvasContextRef.current?.undoOps() || { ok: false, error: "当前没有可撤销的画布操作" };
            } else {
                result = canvasContextRef.current?.snapshot || { ok: false, error: "当前未打开画布" };
            }
            await postToolResult(endpoint, token, clientIdRef.current, { requestId, result });
            log("工具完成", toolName(name));
        } catch (error) {
            const text = error instanceof Error ? error.message : "工具执行失败";
            await postToolResult(endpoint, token, clientIdRef.current, { requestId, error: text }).catch(() => undefined);
            log("工具失败", `${toolName(name)} · ${text}`, error);
        }
    }, [endpoint, log, setAgentState, token]);

    useEffect(() => {
        if (!enabled || !endpoint || !token.trim()) return;
        let disposed = false;
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientIdRef.current)}`);
        connectionRef.current = source;
        const isActive = () => !disposed && connectionRef.current === source;
        const routeEvent = (event: Event) => {
            const payload = parseEventData<Parameters<typeof formatAgentEvent>[0]>(event);
            if (!payload || !isActive()) return;
            const currentThread = useAgentStore.getState().activeThreadId;
            const eventThread = payload.threadId || payload.thread_id || "";
            if (eventThread && currentThread && eventThread !== currentThread) return;
            const usage = eventUsage(payload);
            if (usage.input || usage.cached || usage.output) setAgentState({ tokenUsage: usage });
            const eventLog = formatAgentEventLog(payload);
            if (eventLog) log(eventLog.title, eventLog.text, payload);
            const plan = formatAgentPlan(payload);
            if (plan) mergeMessage({ ...plan, id: `plan-${eventThread || "active"}`, streamId: undefined });
            const activityItem = formatAgentActivity(payload);
            if (activityItem) mergeMessage({ ...activityItem, id: payload.item?.id || randomId() });
            const messageItem = formatAgentEvent(payload);
            if (messageItem) mergeMessage({ ...messageItem, id: payload.item?.id || randomId(), streamId: undefined });
            if (payload.type === "item.updated" && payload.item?.type === "agent_message") {
                const id = payload.item.id || `stream-${eventThread || "active"}`;
                const existing = useAgentStore.getState().messages.find((item) => item.id === id);
                const delta = typeof payload.item.delta === "string" ? payload.item.delta : typeof payload.item.text === "string" ? payload.item.text : "";
                if (delta) mergeMessage({ id, role: "assistant", title: "Codex", text: `${existing?.text || ""}${delta}`, streamId: id });
            }
            if (payload.type === "turn.completed") {
                const failed = payload.status === "failed";
                setAgentState({ waiting: false, sending: false, activity: failed ? "处理失败" : "已完成" });
                if (failed) {
                    const view = agentErrorView(payload.error?.message || payload.message);
                    addMessage({ id: randomId(), role: "error", title: view.title, text: view.text });
                } else void loadThreads(false);
            }
        };
        source.addEventListener("hello", (event) => {
            if (!isActive()) return;
            const hello = parseEventData<AgentHello>(event);
            const busy = Boolean(hello?.codex?.busy);
            const threadId = hello?.conversation?.threadId || hello?.workspace?.activeThreadId || useAgentStore.getState().activeThreadId;
            setAgentState({ connected: true, connectError: "", activity: busy ? "Codex 正在处理" : "已连接", waiting: busy, sending: false, activeThreadId: threadId || "", pendingApprovals: hello?.pendingApprovals || [], activeTab: "chat" });
            void postState(endpoint, token, clientIdRef.current, canvasContextRef.current?.snapshot || null);
            void activateAgentClient(endpoint, token, clientIdRef.current);
            void loadThreads();
        });
        source.addEventListener("codex_state", (event) => {
            const payload = parseEventData<{ busy?: boolean; threadId?: string }>(event);
            if (!payload || !isActive()) return;
            const busy = Boolean(payload.busy);
            if (payload.threadId && useAgentStore.getState().activeThreadId && payload.threadId !== useAgentStore.getState().activeThreadId) return;
            setAgentState({ waiting: busy, sending: false, activity: busy ? "Codex 正在处理" : "已完成" });
            if (!busy) void loadThreads(false);
        });
        source.addEventListener("tool_call", (event) => {
            const payload = parseEventData<{ requestId?: string; name?: string; input?: Record<string, unknown> }>(event);
            if (payload && isActive()) void handleToolCall(payload);
        });
        source.addEventListener("codex_approval", (event) => {
            const payload = parseEventData<AgentPendingApproval>(event);
            if (!payload?.requestId || !isActive()) return;
            setAgentState({ pendingApprovals: [...useAgentStore.getState().pendingApprovals.filter((item) => item.requestId !== payload.requestId), payload], activity: "等待权限确认" });
        });
        source.addEventListener("agent_event", routeEvent);
        source.addEventListener("agent_error", (event) => {
            const payload = parseEventData<{ message?: string }>(event);
            if (!isActive()) return;
            const view = agentErrorView(payload?.message);
            setAgentState({ waiting: false, sending: false, activity: "处理失败" });
            addMessage({ id: randomId(), role: "error", title: view.title, text: view.text });
            log(view.title, view.text, payload);
        });
        source.onerror = () => {
            if (!isActive()) return;
            setAgentState({ connected: false, activity: "正在重连", connectError: "本机 Codex Agent 暂时不可达，服务恢复后会自动重连。" });
        };
        return () => {
            disposed = true;
            if (connectionRef.current === source) connectionRef.current = null;
            source.close();
        };
    }, [addMessage, enabled, endpoint, handleToolCall, loadThreads, log, mergeMessage, setAgentState, token]);

    const setPermissionMode = (next: "request" | "automatic" | "full") => {
        localStorage.setItem("canvas-agent-permission-mode", next);
        setAgentState({ permissionMode: next });
    };

    const addFiles = async (files: FileList | File[] | null) => {
        const sourceFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, MAX_ATTACHMENTS - useAgentStore.getState().attachments.length));
        const next = await Promise.all(sourceFiles.map(readAttachment));
        setAgentState({ attachments: [...useAgentStore.getState().attachments, ...next] });
    };

    const send = async () => {
        const state = useAgentStore.getState();
        const text = state.prompt.trim();
        if (!state.connected) return message.warning("请先连接本机 Codex Agent");
        if (state.sending || state.waiting || (!text && !state.attachments.length)) return;
        const messageId = randomId();
        const userText = text || "请分析这些参考图片。";
        setAgentState({ prompt: "", attachments: [], sending: true, activity: "正在发送给 Codex" });
        addMessage({ id: messageId, role: "user", text: userText, attachments: state.attachments });
        try {
            const accepted = await fetchAgentJson<AgentTurnResponse>(endpoint, state.token, "/agent/codex/turn", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ prompt: userText, messageText: userText, messageId, clientId: clientIdRef.current, threadId: state.activeThreadId || undefined, permissionMode: state.permissionMode, attachments: state.attachments }),
            });
            const threadId = accepted.conversation?.threadId || accepted.workspace?.activeThreadId || accepted.threadId || state.activeThreadId;
            setAgentState({ activeThreadId: threadId || "", sending: false, waiting: true, activity: "Codex 正在处理" });
            log("发送任务", userText.slice(0, 120));
        } catch (error) {
            const view = agentErrorView(error instanceof Error ? error.message : "发送失败");
            setAgentState({ sending: false, waiting: false, activity: "处理失败" });
            addMessage({ id: randomId(), role: "error", title: view.title, text: view.text });
            log(view.title, view.text, error);
        }
    };

    const newThread = async () => {
        if (!connected || sending || waiting) return;
        try {
            const response = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current, permissionMode }) });
            const threadId = response.conversation?.threadId || response.workspace?.activeThreadId || "";
            setAgentState({ activeThreadId: threadId, messages: [], tokenUsage: null, activeTab: "chat", activity: "新对话已创建" });
            void loadThreads(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建 Codex 对话失败");
        }
    };

    const resumeThread = async (threadId: string) => {
        if (!connected || sending || waiting) return;
        try {
            const response = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current, permissionMode }) });
            setAgentState({ activeThreadId: response.conversation?.threadId || threadId, messages: Array.isArray(response.messages) ? response.messages : [], activeTab: "chat", activity: "已恢复对话" });
            void loadThreads(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "恢复 Codex 对话失败");
        }
    };

    const deleteThreads = async (threadIds: string[]) => {
        try {
            await Promise.all(threadIds.map((threadId) => fetchAgentJson(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current }) })));
            await loadThreads();
            message.success(`已删除 ${threadIds.length} 条对话`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除 Codex 对话失败");
        }
    };

    const replyTool = async (accept: boolean) => {
        const current = useAgentStore.getState().pendingTool;
        if (!current) return;
        setAgentState({ pendingTool: null });
        if (!accept) {
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: current.requestId, error: "用户拒绝本次画布操作" }).catch(() => undefined);
            return;
        }
        await handleToolCall({ requestId: current.requestId, name: current.name, input: current.input }, true);
    };

    const decideApproval = async (approval: AgentPendingApproval, decision: "accept" | "acceptForSession" | "decline") => {
        try {
            await postCodexApproval(endpoint, token, approval.requestId, decision);
            setAgentState({ pendingApprovals: useAgentStore.getState().pendingApprovals.filter((item) => item.requestId !== approval.requestId) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交权限确认失败");
        }
    };

    const stop = async () => {
        try {
            await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: useAgentStore.getState().activeThreadId, clientId: clientIdRef.current }) });
            setAgentState({ waiting: false, sending: false, activity: "已请求停止" });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "停止请求失败");
        }
    };

    const tabs = [
        { value: "chat" as const, label: "对话", icon: <MessageSquare className="size-3.5" /> },
        { value: "history" as const, label: "历史", icon: <History className="size-3.5" />, count: threads.length },
        { value: "log" as const, label: "日志", icon: <ScrollText className="size-3.5" /> },
        { value: "setup" as const, label: "连接", icon: <PlugZap className="size-3.5" /> },
    ];

    return (
        <section className="fg-codex-panel" aria-label="本机 Codex Agent">
            <header className="fg-codex-header">
                <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="fg-codex-icon"><Bot className="size-4" /></span><strong>本机 Codex</strong><span className={`fg-codex-status ${connected ? "online" : enabled ? "connecting" : ""}`}>{connected ? "已连接" : enabled ? "连接中" : "未连接"}</span></div>
                    <p>仅在此电脑运行；可读取并操作当前画布。</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Tooltip title="新建 Codex 对话"><Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" disabled={!connected || sending || waiting} icon={<Plus className="size-4" />} onClick={() => void newThread()} /></Tooltip>
                    <Tooltip title="关闭 Agent"><Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<X className="size-4" />} onClick={closePanel} /></Tooltip>
                </div>
            </header>
            <AgentPanelTabs value={activeTab} items={tabs} theme={theme} onChange={(next) => setAgentState({ activeTab: next })} />
            {activeTab === "setup" ? (
                <AgentConnectView theme={theme} url={url} token={token} enabled={enabled} connected={connected} activity={activity} connectError={connectError} onUrlChange={(value) => setAgentState({ url: value })} onTokenChange={(value) => setAgentState({ token: value })} onToggleEnabled={() => enabled ? disconnectAgent({ activity: "已断开", connectError: "" }) : connectAgent()} />
            ) : activeTab === "history" ? (
                <AgentHistoryView theme={theme} threads={threads} activeThreadId={activeThreadId} workspacePath={workspacePath} loading={loadingThreads} busy={sending || waiting} connected={connected} onRefresh={() => void loadThreads()} onNewThread={() => void newThread()} onResumeThread={(threadId) => void resumeThread(threadId)} onDeleteThreads={(threadIds) => void deleteThreads(threadIds)} />
            ) : activeTab === "log" ? (
                <AgentLogView logs={eventLogs} theme={theme} context={{ endpoint, connected, enabled, activity, waiting, sending, messages: useAgentStore.getState().messages.length, pendingTool: pendingTool ? toolName(pendingTool.name) : undefined }} onClear={clearEventLogs} onCopied={(text) => message.success(text)} onCopyBlocked={(text) => message.warning(text)} />
            ) : (
                <>
                    {!connected && enabled ? <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: "rgba(250,204,21,.35)", color: theme.node.muted }}><CircleAlert className="mt-0.5 size-4 shrink-0 text-yellow-500" />正在连接本机 Codex。若长时间未连接，请检查右侧“连接”页的服务与 token。</div> : null}
                    {!enabled ? <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}><span>未连接本机 Codex，仍可切回“公司模型”正常使用。</span><Button size="small" type="primary" onClick={() => setAgentState({ activeTab: "setup" })}>去连接</Button></div> : null}
                    <AgentTaskProgress theme={theme} busy={sending || waiting} />
                    <AgentChatTimeline theme={theme} pendingTool={pendingTool} pendingApprovals={pendingApprovals} sending={sending} waiting={waiting} onRejectTool={() => void replyTool(false)} onApproveTool={() => void replyTool(true)} onApprovalDecision={(approval, decision) => void decideApproval(approval, decision)} />
                    {tokenUsage ? <AgentUsageBar usage={tokenUsage} theme={theme} /> : null}
                    <AgentChatComposer prompt={prompt} attachments={activeAttachments} disabled={!connected} sending={sending || waiting} placeholder={connected ? "让 Codex 分析、整理或操作当前画布…" : "请先在“连接”页接入本机 Codex"} theme={theme} onPromptChange={(value) => setAgentState({ prompt: value })} onSubmit={() => void send()} onStop={() => void stop()} onAddFiles={addFiles} onRemoveAttachment={(id) => setAgentState({ attachments: useAgentStore.getState().attachments.filter((item) => item.id !== id) })} confirmTools={confirmTools} onConfirmToolsChange={(value) => setAgentState({ confirmTools: value })} permissionMode={permissionMode} onPermissionModeChange={setPermissionMode} />
                </>
            )}
        </section>
    );
}

async function readAttachment(file: File): Promise<AgentAttachment> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取图片失败"));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
    return { id: randomId(), name: file.name, type: file.type, size: file.size, width: 0, height: 0, url: dataUrl, dataUrl };
}
