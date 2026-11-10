export interface SupportFeedback {
    rating: "helpful" | "unhelpful";
    correction: string;
    updatedAt: string;
}

export interface SupportMessage {
    id: string;
    text: string;
    status: string;
    stage?: string;
    progress?: { id: string; text: string; at: string }[];
    reply: string | null;
    ticketId: string;
    imageCount?: number;
    feedback?: SupportFeedback | null;
}

export async function supportRequest(url: string, options?: RequestInit) {
    // Use the FG session endpoint directly; Canvas API uses a different envelope.
    // 直接使用 FG 会话接口，避免进入 Canvas 的另一套响应协议。
    const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store" });
    if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("登录状态不可用，请重新登录 FG 后继续。");
    const body = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录 FG 后继续。" : body.error || "问题助手暂时无法连接，请重试。");
    return body;
}

export function readSupportConversation(conversationId: string, signal: AbortSignal): Promise<{ messages: SupportMessage[] }> {
    return supportRequest(`/api/support-bot/web?conversationId=${encodeURIComponent(conversationId)}`, { signal });
}

export function cancelSupportQuestions(conversationId: string, jobIds: string[]): Promise<{ cancelled: number; messages: SupportMessage[] }> {
    return supportRequest('/api/support-bot/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', conversationId, jobIds }) });
}

export function submitSupportFeedback(conversationId: string, jobId: string, rating: SupportFeedback["rating"], correction: string): Promise<{ feedback: SupportFeedback }> {
    return supportRequest('/api/support-bot/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'feedback', conversationId, jobId, rating, correction }) });
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
