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
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let streaming = false;
    let revision = 0;
    async function refreshFallback() {
        fallback = undefined;
        if (refreshing || controller.signal.aborted) return;
        refreshing = true;
        const before = revision;
        const readController = new AbortController();
        const cancelRead = () => readController.abort();
        controller.signal.addEventListener("abort", cancelRead, { once: true });
        const timeout = setTimeout(cancelRead, 10_000);
        try {
            const body = await readSupportConversation(conversationId, readController.signal);
            if (controller.signal.aborted) return;
            if (!Array.isArray(body.messages)) throw new Error("暂时无法读取排查记录，请稍后重试。");
            if (before === revision) { handlers.onSnapshot(body.messages); handlers.onError(""); }
            if (source.readyState === EventSource.CLOSED && !reconnect) connect();
        } catch (cause) {
            if (!controller.signal.aborted && before === revision) handlers.onError(readController.signal.aborted ? "暂时无法更新排查进度，正在自动重试。" : cause instanceof Error ? cause.message : "读取会话失败");
        } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRead);
            refreshing = false;
            if (!controller.signal.aborted && !streaming && !fallback) fallback = setTimeout(() => void refreshFallback(), 5000);
        }
    }
    function received() {
        streaming = true;
        clearTimeout(fallback); fallback = undefined;
        handlers.onError("");
    }
    function interrupted() {
        if (controller.signal.aborted) return;
        streaming = false;
        if (source.readyState === EventSource.OPEN) source.close();
        // Reconnect silently; only a failed fallback read needs a user-facing warning.
        // 静默重连，只有备用读取也失败时才提示；备用读取成功即清除旧警告。
        // Repeated SSE errors must not continually postpone the fallback read.
        // 连续 SSE 错误不能反复推迟降级读取，否则断线期间会一直没有更新。
        if (!fallback && !refreshing) fallback = setTimeout(() => void refreshFallback(), 3000);
    }
    function connect() {
        clearTimeout(reconnect); reconnect = undefined;
        if (controller.signal.aborted) return;
        streaming = false;
        source?.close();
        source = new EventSource(`/api/support-bot/web?conversationId=${encodeURIComponent(conversationId)}&stream=1`);
        source.addEventListener("snapshot", event => {
            try {
                const body = JSON.parse(event.data);
                if (!Array.isArray(body.messages)) throw new Error("Invalid snapshot");
                revision++; handlers.onSnapshot(body.messages); received();
            } catch { interrupted(); }
        });
        source.onmessage = event => {
            try {
                const body = JSON.parse(event.data);
                if (typeof body.message?.id !== "string") throw new Error("Invalid message");
                revision++; handlers.onMessage(body.message); received();
            } catch { interrupted(); }
        };
        source.addEventListener("reconnect", () => {
            if (controller.signal.aborted) return;
            source.close();
            reconnect = setTimeout(connect, 1500);
            interrupted();
        });
        source.addEventListener("unavailable", interrupted);
        source.onerror = interrupted;
    }
    connect();
    // Close only this subscription; the queued investigation keeps running.
    // 关闭弹窗只取消当前订阅，已提交的排查任务继续执行。
    return () => { source.close(); controller.abort(); clearTimeout(fallback); clearTimeout(reconnect); };
}
