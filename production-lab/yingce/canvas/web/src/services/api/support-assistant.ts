import { http } from "./request";

export interface SupportMessage {
    id: string;
    text: string;
    status: string;
    stage?: string;
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
    return supportRequest<{ ticketId: string }>("POST", data);
}
