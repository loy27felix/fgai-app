export type GenerationCompletionKind = "image" | "video";

export type GenerationCompletionNotice = {
    kind: GenerationCompletionKind;
    /** A stable task or run id prevents the same async completion from popping twice. */
    id?: string;
    title?: string;
    body?: string;
};

const recentlyNotified = new Set<string>();
const RECENT_NOTICE_LIMIT = 240;

function rememberNotice(key: string) {
    recentlyNotified.add(key);
    if (recentlyNotified.size <= RECENT_NOTICE_LIMIT) return;
    const oldest = recentlyNotified.values().next().value;
    if (typeof oldest === "string") recentlyNotified.delete(oldest);
}

export function browserNotificationPermission(): NotificationPermission | "unsupported" {
    if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
}

export async function requestGenerationCompletionNotifications() {
    if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported" as const;
    try {
        return await Notification.requestPermission();
    } catch {
        return "denied" as const;
    }
}

export function notifyGenerationCompleted(notice: GenerationCompletionNotice) {
    if (typeof window === "undefined") return false;
    const key = notice.id ? `${notice.kind}:${notice.id}` : "";
    if (key && recentlyNotified.has(key)) return false;
    if (key) rememberNotice(key);

    const isVideo = notice.kind === "video";
    const title = notice.title || (isVideo ? "视频已生成完成" : "图片已生成完成");
    const body = notice.body || (isVideo
        ? "结果已在 FG Studio 中就绪，可以预览、挑选版本或继续拼接。"
        : "结果已在 FG Studio 中就绪，可以预览、挑选版本或继续修改。");

    window.dispatchEvent(new CustomEvent("fg-generation-completed", {
        detail: { ...notice, title, body, occurredAt: Date.now() },
    }));

    if (browserNotificationPermission() !== "granted") return false;
    try {
        const browserNotice = new Notification(title, {
            body,
            tag: key || `fg-generation-${notice.kind}-${Date.now()}`,
        });
        browserNotice.onclick = () => {
            window.focus();
            browserNotice.close();
        };
        return true;
    } catch {
        return false;
    }
}
