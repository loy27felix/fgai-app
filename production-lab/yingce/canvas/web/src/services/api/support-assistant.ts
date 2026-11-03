import { http } from "./request";

export interface SupportMessage {
    id: string;
    text: string;
    status: string;
    stage?: string;
    progress?: { id: string; text: string; at: string }[];
    reply: string | null;
    ticketId: string;
    imageCount?: number;
}

export interface SupportBrowserRequest {
    id: string;
    occurredAt: string;
    route: string;
    httpStatus?: number;
    errorCode?: string;
    requestId?: string;
    traceId?: string;
    taskId?: string;
    projectId?: string;
    durationMs?: number;
}

export interface SupportContext {
    source: "fg" | "canvas";
    pagePath: string;
    projectId?: string;
    taskId?: string;
    sessionId?: string;
    occurredFrom?: string;
    occurredTo?: string;
    requestId?: string;
    traceId?: string;
    browserRequests?: SupportBrowserRequest[];
}

async function supportRequest<T>(method: "GET" | "POST", data?: unknown, params?: { conversationId: string }, signal?: AbortSignal): Promise<T> {
    // FG uses its own session and a non-Canvas envelope; keep the shared transport.
    // FG 使用独立会话与响应格式，保留公共 transport，但不进入 Canvas 信封解包。
    const response = await http.raw<T & { error?: string }>({
        baseURL: "", url: "/api/support-bot/web", method, data, params, signal,
        withCredentials: true, validateStatus: () => true,
    });
    if (!String(response.headers["content-type"]).includes("application/json")) throw new Error("登录状态不可用，请重新登录 FG 后继续。");
    if (response.status < 200 || response.status >= 300) {
        throw new Error(response.status === 401 ? "登录已过期，请重新登录 FG 后继续。" : response.data.error || "问题助手暂时无法连接，请重试。");
    }
    return response.data;
}

export function readSupportConversation(conversationId: string, signal: AbortSignal) {
    return supportRequest<{ messages: SupportMessage[] }>("GET", undefined, { conversationId }, signal);
}

export function submitSupportQuestion(data: { conversationId: string; text: string; images: string[]; context: SupportContext }) {
    return supportRequest<{ ticketId: string; jobId: string }>("POST", data);
}

export function cancelSupportQuestions(conversationId: string, jobIds: string[]) {
    return supportRequest<{ cancelled: number; messages: SupportMessage[] }>("POST", { action: "cancel", conversationId, jobIds });
}

export function watchSupportConversation(conversationId: string, handlers: {
    onSnapshot: (messages: SupportMessage[]) => void;
    onMessage: (message: SupportMessage) => void;
    onError: (message: string) => void;
}) {
    const controller = new AbortController();
    let source: EventSource;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let revision = 0;
    async function refreshFallback() {
        fallback = undefined;
        if (refreshing || controller.signal.aborted) return;
        refreshing = true;
        const before = revision;
        try {
            const body = await readSupportConversation(conversationId, controller.signal);
            if (controller.signal.aborted) return;
            if (before === revision) handlers.onSnapshot(body.messages);
            if (source.readyState === EventSource.CLOSED) connect();
        } catch (cause) {
            if (!controller.signal.aborted) handlers.onError(cause instanceof Error ? cause.message : "读取会话失败");
        } finally {
            refreshing = false;
            if (!controller.signal.aborted && source.readyState !== EventSource.OPEN && !fallback) fallback = setTimeout(() => void refreshFallback(), 5000);
        }
    }
    function interrupted() {
        if (controller.signal.aborted) return;
        handlers.onError("实时连接中断，正在重连；期间自动刷新，排查不会停止。");
        // Repeated SSE errors must not continually postpone the fallback read.
        // 连续 SSE 错误不能反复推迟降级读取，否则断线期间会一直没有更新。
        if (!fallback && !refreshing) fallback = setTimeout(() => void refreshFallback(), 3000);
    }
    function connect() {
        source?.close();
        source = new EventSource(`/api/support-bot/web?conversationId=${encodeURIComponent(conversationId)}&stream=1`);
        source.onopen = () => { clearTimeout(fallback); fallback = undefined; handlers.onError(""); };
        source.addEventListener("snapshot", event => {
            try {
                const body = JSON.parse(event.data);
                if (!Array.isArray(body.messages)) throw new Error("Invalid snapshot");
                revision++; handlers.onSnapshot(body.messages); handlers.onError("");
            } catch { interrupted(); }
        });
        source.onmessage = event => {
            try {
                const body = JSON.parse(event.data);
                if (typeof body.message?.id !== "string") throw new Error("Invalid message");
                revision++; handlers.onMessage(body.message); handlers.onError("");
            } catch { interrupted(); }
        };
        source.addEventListener("unavailable", interrupted);
        source.onerror = interrupted;
    }
    connect();
    // Close only this subscription; the queued investigation keeps running.
    // 关闭弹窗只取消当前订阅，已提交的排查任务继续执行。
    return () => { source.close(); controller.abort(); clearTimeout(fallback); };
}
