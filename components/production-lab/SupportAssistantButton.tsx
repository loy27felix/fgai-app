"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, DatePicker, Input, Image, Select, Spin, Modal as AppModal } from "antd";
import type { Dayjs } from "dayjs";
import { Search } from "lucide-react";

interface SupportMessage {
    id: string;
    text: string;
    status: string;
    stage?: string;
    reply: string | null;
    ticketId: string;
    imageCount?: number;
}

type LocatorType = "taskId" | "requestId" | "traceId";

interface SupportContext {
    source: "fg";
    pagePath: string;
    projectId?: string;
    taskId?: string;
    sessionId?: string;
    occurredFrom?: string;
    occurredTo?: string;
    requestId?: string;
    traceId?: string;
}

function supportContext(): SupportContext {
    const context: SupportContext = {
        source: "fg", pagePath: window.location.pathname,
    };
    const params = new URLSearchParams(window.location.search);
    for (const key of ["projectId", "taskId", "sessionId", "requestId", "traceId"] as const) {
        const value = params.get(key)?.trim();
        if (value) context[key] = value;
    }
    const projectRoute = context.pagePath.match(/^\/projects\/([^/]+)(?:\/|$)/);
    if (!context.projectId && projectRoute) {
        try { context.projectId = decodeURIComponent(projectRoute[1]); } catch { /* Ignore malformed route encoding / 忽略无效的路由编码。 */ }
    }
    return context;
}

async function supportRequest(url: string, options?: RequestInit) {
    // Use the FG session endpoint directly; Canvas API uses a different envelope.
    // 直接使用 FG 会话接口，避免进入 Canvas 的另一套响应协议。
    const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store" });
    if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("登录状态不可用，请重新登录 FG 后继续。");
    const body = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录 FG 后继续。" : body.error || "问题助手暂时无法连接，请重试。");
    return body;
}

// Browser-native decoding is bounded and sequential; avoid ten full-size base64 copies.
// 用浏览器原生解码逐张处理，避免同时持有十张大图的 base64 副本。
async function prepareScreenshot(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    const picture = new window.Image();
    const canvas = document.createElement("canvas");
    try {
        picture.src = url;
        await picture.decode();
        let blob: Blob = file;
        const scale = Math.min(1, 2560 / Math.max(picture.naturalWidth, picture.naturalHeight));
        if (file.size > 2 * 1024 * 1024 || scale < 1) {
            canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
            const context = canvas.getContext("2d");
            if (!context) throw new Error("浏览器无法处理截图");
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(picture, 0, 0, canvas.width, canvas.height);
            const encode = (type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(value => value ? resolve(value) : reject(new Error("截图压缩失败")), type, quality);
            });
            blob = await encode("image/png");
            for (const quality of [0.9, 0.75, 0.6, 0.45, 0.3]) {
                if (blob.size <= 2 * 1024 * 1024) break;
                blob = await encode("image/jpeg", quality);
            }
            if (blob.size > 2 * 1024 * 1024) throw new Error("截图细节过多，请裁剪到问题区域再上传");
        }
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("截图读取失败"));
            reader.onerror = () => reject(new Error("截图读取失败"));
            reader.readAsDataURL(blob);
        });
    } finally {
        URL.revokeObjectURL(url);
        picture.src = "";
        canvas.width = canvas.height = 0;
    }
}

function newId() {
    // getRandomValues also works on HTTP intranet pages / 兼容局域网 HTTP 页面。
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function conversationId(userId: string) {
    const key = `fg-support-conversation:${userId}`;
    try {
        const existing = localStorage.getItem(key);
        if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    } catch { /* Storage may be unavailable / 浏览器可能禁用存储。 */ }
    const id = newId();
    try { localStorage.setItem(key, id); } catch { /* Keep this session in memory / 本次会话仍可在内存中使用。 */ }
    return id;
}

export function SupportAssistantButton({ userId }: { userId: string }) {
    const [open, setOpen] = useState(false);
    return <>
        <Button onClick={() => setOpen(true)} icon={<Search size={16} />} aria-label="打开自助排查助手">自助排查</Button>
        <AppModal title="自助排查助手" open={open} onCancel={() => setOpen(false)} footer={null} width={720}>
            {open ? <SupportConversation key={userId} userId={userId} /> : null}
        </AppModal>
    </>;
}

function SupportConversation({ userId }: { userId: string }) {
    const [id, setId] = useState(() => conversationId(userId));
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [text, setText] = useState("");
    const [occurredRange, setOccurredRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [locatorType, setLocatorType] = useState<LocatorType>("taskId");
    const [locatorId, setLocatorId] = useState("");
    const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const scopeHelpId = useId();
    const [occurredFrom, occurredTo] = occurredRange || [];
    const rangeError = !occurredRange ? ""
        : !occurredFrom?.isValid() || !occurredTo?.isValid() ? "请选择完整的发生时间段。"
        : occurredTo.valueOf() <= occurredFrom.valueOf() ? "结束时间必须晚于开始时间。"
        : occurredTo.diff(occurredFrom) > 7 * 24 * 60 * 60 * 1000 ? "发生时间段最长为 7 天（168 小时）。" : "";
    const [images, setImages] = useState<string[]>([]);
    const [readingImages, setReadingImages] = useState(false);
    const imageReadLock = useRef(false);
    const imageInput = useRef<HTMLInputElement>(null);
    const [error, setError] = useState("");
    const [connectionError, setConnectionError] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [revision, setRevision] = useState(0);
    const end = useRef<HTMLDivElement>(null);
    const activeId = useRef(id);
    activeId.current = id;

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        async function refresh() {
            try {
                const body = await supportRequest(`/api/support-bot/web?conversationId=${encodeURIComponent(id)}`, { signal: controller.signal });
                if (!cancelled) { setMessages(body.messages || []); setConnectionError(""); }
            } catch (cause) {
                if (!cancelled) setConnectionError(cause instanceof Error ? cause.message : "读取会话失败");
            } finally {
                if (!cancelled) { setLoading(false); timer = setTimeout(() => void refresh(), 2500); }
            }
        }
        void refresh();
        return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    }, [id, revision]);

    const latestMessage = messages.at(-1);
    useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, latestMessage?.reply, latestMessage?.status, latestMessage?.stage]);

    async function addImages(files: File[]) {
        if (!files.length || imageReadLock.current || sending) return;
        if (images.length + files.length > 10) { setError("最多添加 10 张截图。"); return; }
        if (files.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024)) {
            setError("截图仅支持 PNG、JPEG、WebP，每张原图不超过 20 MiB，最多 10 张。"); return;
        }
        // Lock synchronously before FileReader yields / 异步读取前同步上锁，避免多次选择绕过数量限制。
        imageReadLock.current = true; setReadingImages(true); setError("");
        try {
            const selected: string[] = [];
            for (const file of files) selected.push(await prepareScreenshot(file));
            setImages(current => [...current, ...selected]);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "截图读取失败，请重新选择。");
        } finally { imageReadLock.current = false; setReadingImages(false); }
    }

    function newConversation() {
        const next = newId();
        try { localStorage.setItem(`fg-support-conversation:${userId}`, next); } catch { /* Memory fallback / 存储不可用时保留内存会话。 */ }
        setId(next); setMessages([]); setText(""); setImages([]); setError(""); setConnectionError(""); setLoading(true);
        resetScope();
    }

    function resetScope() {
        setOccurredRange(null); setLocatorType("taskId"); setLocatorId("");
    }

    async function send() {
        const question = text.trim();
        if ((!question && !images.length) || sending || imageReadLock.current) return;
        if (rangeError) { setError(rangeError); return; }
        const context = supportContext();
        if (occurredFrom && occurredTo) {
            context.occurredFrom = occurredFrom.toISOString();
            context.occurredTo = occurredTo.toISOString();
        }
        if (locatorId.trim()) context[locatorType] = locatorId.trim();
        setSending(true); setError("");
        try {
            await supportRequest("/api/support-bot/web", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, text: question, images, context }) });
            if (activeId.current === id) { setText(""); setImages([]); setRevision(value => value + 1); }
        } catch (cause) {
            if (activeId.current === id) setError(cause instanceof Error ? cause.message : "发送失败");
        } finally { setSending(false); }
    }

    return <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">识别截图模块、咨询使用方法，或排查生成失败等问题。助手会核对相关代码与当前账号相关的操作记录，不会自动修改数据。</p>
            <Button onClick={newConversation} disabled={sending || readingImages}>新问题</Button>
        </div>
        <div role="log" aria-label="排查对话" aria-live="polite" className="flex min-h-48 max-h-[50vh] flex-col gap-4 overflow-y-auto rounded-xl border border-border p-4">
            {loading ? <Spin aria-label="加载会话" /> : null}
            {!loading && !messages.length ? <p className="text-sm text-muted-foreground">可直接描述现象或上传截图；如有任务 ID、发生时间或错误文字，可一并提供，帮助关联本次操作。</p> : null}
            {messages.map(item => <article key={item.id} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0">
                <div><strong className="text-sm">你</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>{item.imageCount ? <p className="mt-1 text-xs text-muted-foreground">已附 {item.imageCount} 张截图</p> : null}</div>
                {item.imageCount ? <Image.PreviewGroup><div className="flex flex-wrap gap-3">{Array.from({ length: item.imageCount }, (_, index) => <Image
                    key={index} src={`/api/support-bot/web?conversationId=${encodeURIComponent(id)}&messageId=${encodeURIComponent(item.id)}&image=${index}`}
                    alt={`已发送截图 ${index + 1}`} width={96} height={72} style={{ objectFit: "contain" }}
                />)}</div></Image.PreviewGroup> : null}
                <div className="rounded-lg bg-muted/50 p-3"><strong className="text-sm">FG 助手</strong>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.reply || ((item.status === "pending" || item.status === "processing") && item.stage) || (item.status === "failed" ? "本次排查失败，请补充信息后重新发送。" : "已收到，正在查询任务、日志与相关代码…")}</p>
                    {item.ticketId ? <p className="mt-2 break-all text-xs text-muted-foreground">问题编号：{item.ticketId}</p> : null}
                </div>
            </article>)}
            <div ref={end} />
        </div>
        {error || connectionError ? <Alert type="error" showIcon message={error || connectionError} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重试连接</Button>} /> : null}
        <form onSubmit={event => { event.preventDefault(); void send(); }} onKeyDown={event => {
            // Enter commits the date/locator input, not the entire investigation.
            // 回车用于确认日期或定位输入，避免意外提交整条排查问题。
            if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
        }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <span className="text-sm">发生时间段（可选）</span>
                <DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm:ss" className="w-full" aria-label="故障发生时间段" aria-describedby={scopeHelpId}
                    value={occurredRange} disabled={sending} placeholder={["开始时间", "结束时间"]} status={rangeError ? "error" : undefined} aria-invalid={Boolean(rangeError)}
                    onCalendarChange={dates => setOccurredRange(dates?.[0] || dates?.[1] ? dates : null)} onChange={setOccurredRange} />
                <p className="text-xs text-muted-foreground">浏览器本地时区：{timeZone}；最长 7 天，不填时不指定故障时间。</p>
                {rangeError ? <p role="alert" className="text-xs text-muted-foreground">{rangeError}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select<LocatorType> aria-label="定位编号类型" value={locatorType} disabled={sending} onChange={setLocatorType}
                    options={[{ value: "taskId", label: "任务 taskId" }, { value: "requestId", label: "请求 requestId" }, { value: "traceId", label: "链路 traceId" }]} />
                <Input aria-label="定位编号" aria-describedby={scopeHelpId} className="min-w-0 flex-1" value={locatorId} disabled={sending} allowClear placeholder="定位编号（可选）" onChange={event => setLocatorId(event.target.value)} />
                <Button onClick={resetScope} disabled={sending}>重置定位</Button>
            </div>
            <p id={scopeHelpId} className="text-xs text-muted-foreground">不填定位信息仅能候选检索，不能确认故障。URL 编号自动附带，同类型以手填为准；发送后保留当前定位范围用于继续追问，可修改或重置。</p>
            <Input.TextArea aria-label="描述问题或补充排查信息" placeholder="请描述操作、异常现象或错误文字；发生时间和定位编号可在上方填写" onPaste={event => {
                const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
                if (files.length) { event.preventDefault(); void addImages(files); }
            }} value={text} onChange={event => setText(event.target.value)} maxLength={4000} showCount autoSize={{ minRows: 3, maxRows: 6 }} disabled={sending} />
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="选择问题截图" disabled={sending || readingImages} onChange={event => { void addImages(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => imageInput.current?.click()} loading={readingImages} disabled={sending || images.length >= 10}>添加截图</Button>
                <span className="text-xs text-muted-foreground">可粘贴 PNG/JPEG/WebP，最多 10 张，每张原图不超过 20 MiB。大图发送前自动压缩，预览即实际提交图片；仅保存并发送处理后的图片给诊断模型，请先遮盖个人信息、密码及 API Key。</span>
            </div>
            {images.length ? <Image.PreviewGroup><div className="flex flex-wrap gap-3">{images.map((image, index) => <div key={index} className="flex flex-col gap-1">
                <Image src={image} alt={`待发送截图 ${index + 1}`} width={96} height={72} style={{ objectFit: "contain" }} />
                <Button size="small" disabled={sending || readingImages} aria-label={`删除截图 ${index + 1}`} onClick={() => setImages(current => current.filter((_, position) => position !== index))}>删除</Button>
            </div>)}</div></Image.PreviewGroup> : null}
            <div className="flex justify-end pt-2"><Button type="primary" htmlType="submit" loading={sending} disabled={(!text.trim() && !images.length) || loading || readingImages || Boolean(rangeError)}>发送并排查</Button></div>
        </form>
    </div>;
}
