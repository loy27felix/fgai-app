import { localForageStorageForScope, localForageKeysForScope } from "@/lib/localforage-storage";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { getActiveUserScope } from "@/lib/user-scope";
import type { AgentPermissionMode, AgentRun } from "@/services/api/agent";

export type CloudAgentMessagePresentation = {
    displayText?: string;
    canvasReferenceNodeId?: string;
};

export type CloudAgentConversationMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    streaming?: boolean;
    reasoning?: boolean;
    planItems?: Array<{ id: string; title: string; status: "pending" | "doing" | "done" }>;
    planTerminal?: boolean;
    question?: { question: string; options: Array<{ label: string; detail?: string }>; allowFreeform?: boolean };
    meta?: string;
    detail?: unknown;
    attachments?: Array<{ id: string; name: string; url: string }>;
    interjection?: "sent" | "undelivered";
};

export type CloudAgentConversation = {
    id: string;
    serverConversationId?: string;
    runs?: AgentRun[];
    lastEventSeq?: number;
    /** 未发送草稿和主动选中的会话只属于本机，不由云端覆盖。 */
    draft?: string;
    localNewCanvasId?: string;
    localSelectedCanvasId?: string;
    title: string;
    messages: CloudAgentConversationMessage[];
    run: AgentRun | null;
    model?: string;
    permissionMode: AgentPermissionMode;
    skillIds?: string[];
    createdAt: string;
    updatedAt: string;
};

type CloudAgentConversationDocument = {
    version: 1;
    activeId: string | null;
    conversations: CloudAgentConversation[];
};

export type CloudAgentPendingSubmission = CloudAgentMessagePresentation & {
    fingerprint: string;
    key: string;
    request?: import("@/services/api/agent").CreateAgentRunInput;
    parentRunId?: string;
    messageId?: string;
};

const CLOUD_AGENT_CONVERSATIONS_KEY = "cloud-agent-conversations-v2";
const historyWrites = new Map<string, Promise<void>>();
const deletedConversationIds = new Map<string, Set<string>>();

export async function deleteCloudAgentConversation(id: string, activeId: string | null, conversations: CloudAgentConversation[], scope = getActiveUserScope()) {
    const key = `${scope}:${storageKey()}`;
    const removed = deletedConversationIds.get(key) || new Set<string>();
    deletedConversationIds.set(key, removed);
    removed.add(id);
    try {
        await saveCloudAgentConversations( activeId === id ? null : activeId, conversations.filter((item) => item.id !== id), scope);
    } catch (error) {
        removed.delete(id);
        throw error;
    }
}

// 平台只有一个 Agent：对话按账号保存，不再按画布分桶。每轮绑定哪个画布由发送时所在页面决定。
export async function loadCloudAgentConversations(scope = getActiveUserScope()): Promise<CloudAgentConversationDocument> {
    const value = await localForageStorageForScope(scope).getItem(storageKey());
    if (!value) return importLegacyConversations(scope);

    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("Agent 对话历史已损坏");
    }
    if (!isConversationDocument(parsed)) throw new Error("Agent 对话历史格式无效");
    return parsed;
}

// Keep existing per-canvas chats and their original retry identities when moving
// to the account-wide panel. Legacy records stay intact as a recovery source.
async function importLegacyConversations(scope: string): Promise<CloudAgentConversationDocument> {
    const keys = (await localForageKeysForScope(scope)).filter(key => key.startsWith('cloud-agent-conversations-v1:') && !key.includes(':pending:'));
    const storage = localForageStorageForScope(scope);
    const conversations = new Map<string, CloudAgentConversation>();
    for (const key of keys) {
        const name = key;
        const raw = await storage.getItem(name);
        if (!raw) continue;
        const document: unknown = JSON.parse(raw);
        if (!isConversationDocument(document)) throw Error('旧画布对话格式无效，原记录已保留');
        const canvasKey = name.slice('cloud-agent-conversations-v1:'.length);
        for (const conversation of document.conversations) {
            const previous = conversations.get(conversation.id);
            if (!previous || previous.updatedAt < conversation.updatedAt) conversations.set(conversation.id, conversation);
            const pending = await storage.getItem(`cloud-agent-conversations-v1:pending:${canvasKey}:${encodeURIComponent(conversation.id)}`);
            if (pending) {
                const existing = await storage.getItem(pendingStorageKey(conversation.id));
                if (existing && existing !== pending) throw Error('旧请求恢复记录存在冲突，请先核对原任务');
                await storage.setItem(pendingStorageKey(conversation.id), pending);
            }
        }
    }
    const items = [...conversations.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    const result: CloudAgentConversationDocument = { version: 1, activeId: items[0]?.id ?? null, conversations: items };
    if (items.length) await storage.setItem(storageKey(), JSON.stringify(result));
    return result;
}

export async function saveCloudAgentConversations(activeId: string | null, conversations: CloudAgentConversation[], scope = getActiveUserScope()) {
    const key = `${scope}:${storageKey()}`;
    // 流式标记只属于内存中的观察状态。若网络在最后一个 delta 后断开，
    // 也不能让下次恢复把思考卡片误判为仍在实时展开。
    const persistedConversations = conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({ ...message, streaming: false })),
    }));
    const write = (historyWrites.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        const removed = deletedConversationIds.get(key);
        const document: CloudAgentConversationDocument = { version: 1, activeId: activeId && removed?.has(activeId) ? null : activeId, conversations: persistedConversations.filter((item) => !removed?.has(item.id)) };
        await localForageStorageForScope(scope).setItem(storageKey(), JSON.stringify(document));
    });
    historyWrites.set(key, write);
    try { await write; } finally { if (historyWrites.get(key) === write) historyWrites.delete(key); }
}

// Keep the retry key outside the chat snapshot. If the response is lost, a
// page refresh can safely repeat the same request without creating another
// billed Agent turn.
export async function loadCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return null;
    const value = await localForageStorageForScope(scope).getItem(pendingStorageKey(conversationId));
    if (value === null || value === undefined) return null;
    // A corrupt recovery record is not proof that the previous POST never ran.
    // Fail closed rather than discarding its identity and risking another charge.
    try {
        const parsed = JSON.parse(value) as Partial<CloudAgentPendingSubmission> | null;
        if (!parsed || typeof parsed.fingerprint !== "string" || typeof parsed.key !== "string" || parsed.key.length < 8) throw new Error("invalid identity");
        if (parsed.request !== undefined && (!parsed.request || parsed.request.idempotencyKey !== parsed.key || typeof parsed.request.canvasId !== "string" || typeof parsed.request.prompt !== "string")) throw new Error("invalid request");
        if (parsed.parentRunId !== undefined && typeof parsed.parentRunId !== "string") throw new Error("invalid parent");
        if (parsed.messageId !== undefined && typeof parsed.messageId !== "string") throw new Error("invalid message");
        return { fingerprint: parsed.fingerprint, key: parsed.key, request: parsed.request, parentRunId: parsed.parentRunId, messageId: parsed.messageId, displayText: parsed.displayText, canvasReferenceNodeId: parsed.canvasReferenceNodeId } satisfies CloudAgentPendingSubmission;
    } catch {
        throw new Error("待确认请求记录损坏，已暂停本对话发送；请先在任务中心核对原运行，不要直接重复生成");
    }
}

export async function saveCloudAgentPendingSubmission(conversationId: string, pending: CloudAgentPendingSubmission, scope = getActiveUserScope()) {
    if (!conversationId) throw new Error("缺少 Agent 对话范围，无法保存幂等提交");
    await localForageStorageForScope(scope).setItem(pendingStorageKey(conversationId), JSON.stringify(pending));
}

export async function clearCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return;
    await localForageStorageForScope(scope).removeItem(pendingStorageKey(conversationId));
}

export function cloudAgentConversationServerId(conversation: CloudAgentConversation) {
    return conversation.serverConversationId || conversation.run?.conversationId;
}

export function cloudAgentPendingMatchesRun(pending: CloudAgentPendingSubmission | null, run: AgentRun | null) {
    return Boolean(pending?.key && run?.idempotencyKey && pending.key === run.idempotencyKey);
}

export function cloudAgentConversationTitle(messages: CloudAgentConversationMessage[]) {
    const firstPrompt = displayConversationTitle(messages.find((message) => message.role === "user")?.text || "");
    return firstPrompt.length > 28 ? `${firstPrompt.slice(0, 28)}...` : firstPrompt;
}

function displayConversationTitle(value: string) {
    return markdownPlainText(value.replace(/@\[skill:[^\]]+\]/gu, "技能包")) || "新对话";
}

function storageKey() {
    return `${CLOUD_AGENT_CONVERSATIONS_KEY}:global`;
}

function pendingStorageKey(conversationId: string) {
    return `${CLOUD_AGENT_CONVERSATIONS_KEY}:pending:${encodeURIComponent(conversationId)}`;
}

function emptyDocument(): CloudAgentConversationDocument {
    return { version: 1, activeId: null, conversations: [] };
}

function isConversationDocument(value: unknown): value is CloudAgentConversationDocument {
    if (!value || typeof value !== "object") return false;
    const document = value as Partial<CloudAgentConversationDocument>;
    if (document.version !== 1 || !Array.isArray(document.conversations)) return false;
    return document.conversations.every((conversation) => {
        if (!conversation || typeof conversation !== "object") return false;
        const candidate = conversation as Partial<CloudAgentConversation>;
        return typeof candidate.id === "string"
            && typeof candidate.title === "string"
            && Array.isArray(candidate.messages)
            && typeof candidate.createdAt === "string"
            && typeof candidate.updatedAt === "string"
            && ["read_only", "auto", "request_approval"].includes(candidate.permissionMode || "");
    });
}
