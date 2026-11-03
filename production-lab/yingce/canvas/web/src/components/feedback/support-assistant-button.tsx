import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Collapse, DatePicker, Input, Image, Popover, Select, Spin, Tooltip } from "antd";
import type { Dayjs } from "dayjs";
import { useLocation, useMatches } from "react-router";
import { ArrowUp, Copy, ImagePlus, Search, SlidersHorizontal, Square, X } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { AppModal } from "@/components/ui/product/app-modal";
import { fgWorkspaceBasePath } from "@/lib/fg-entry-url";
import { cancelSupportQuestions, watchSupportConversation, submitSupportQuestion, type SupportBrowserRequest, type SupportContext, type SupportMessage } from "@/services/api/support-assistant";
import { getClientDiagnosticEvents } from "@/services/diagnostics/client-diagnostics";

type LocatorType = "taskId" | "requestId" | "traceId";

function supportContext(location: { pathname: string; search: string }, routeParams: Record<string, string | undefined>): SupportContext {
    // Router location is authoritative, including when the workspace is mounted under a basename.
    // 以 Router 的实际页面为准，浏览器 pathname 只用于还原挂载前缀。
    const context: SupportContext = { source: "canvas", pagePath: `${fgWorkspaceBasePath(window.location.pathname)}${location.pathname}` };
    const params = new URLSearchParams(location.search);
    for (const key of ["projectId", "taskId", "sessionId", "requestId", "traceId"] as const) {
        const value = params.get(key)?.trim();
        if (value) context[key] = value;
    }
    const projectId = routeParams.projectId || (location.pathname.startsWith("/canvas/") ? routeParams.id : undefined);
    if (projectId) context.projectId = projectId;
    return context;
}

function collectBrowserRequests(context: SupportContext): SupportBrowserRequest[] {
    const to = context.occurredTo ? new Date(context.occurredTo) : new Date();
    const from = context.occurredFrom ? new Date(context.occurredFrom) : new Date(to.getTime() - 15 * 60 * 1000);
    const pagePath = context.pagePath.slice(fgWorkspaceBasePath(context.pagePath).length);
    const projectResource = pagePath.startsWith("/canvas/") ? "canvas-projects"
        : pagePath.startsWith("/drama-pipeline/") ? "dramas"
        : pagePath.startsWith("/projects/") ? "projects" : undefined;

    return getClientDiagnosticEvents({ from, to }).filter(event => event.category === "request" && event.level === "error").flatMap(event => {
        if (!event.route) return [];
        let route: string;
        try {
            const url = new URL(event.route, window.location.origin);
            if (url.protocol !== "http:" && url.protocol !== "https:") return [];
            route = url.pathname;
        } catch { return []; }
        const apiRoute = route.slice(fgWorkspaceBasePath(route).length).replace(/^\/api(?=\/|$)/, "");
        if (/^\/(?:support-bot|observability|diagnostics)(?:\/|$)/.test(apiRoute)) return [];

        // A shared trace spans pages; require an exact project route or explicit diagnostic scope.
        // trace 可能跨页面复用，项目页仅采纳精确路由或诊断字段可确认归属的请求。
        if (context.projectId && projectResource) {
            const projectRoute = apiRoute.match(/^\/(projects|canvas-projects|dramas)\/([^/]+)(?:\/|$)/);
            if (projectRoute) {
                try {
                    if (projectRoute[1] !== projectResource || decodeURIComponent(projectRoute[2]) !== context.projectId) return [];
                } catch { return []; }
            } else if ((projectResource === "canvas-projects" ? event.canvasId : event.projectId) !== context.projectId) return [];
        }

        // Copy only locator fields, never the full event or its message/stack.
        // 只拷贝定位字段，禁止展开完整事件及其 message/stack。
        return [{
            id: event.id, occurredAt: new Date(event.timestamp).toISOString(), route,
            httpStatus: event.httpStatus, errorCode: event.code && /^[A-Za-z0-9_.:-]{1,96}$/.test(event.code) ? event.code : undefined,
            requestId: event.requestId, traceId: event.traceId, taskId: event.taskId,
            projectId: event.projectId, durationMs: event.durationMs,
        }];
    }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 20);
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
        <button type="button" className="app-workspace-topbar-feedback-pill" onClick={() => setOpen(true)} aria-label="打开自助排查助手">
            <Search aria-hidden="true" /><span>自助排查</span>
        </button>
        <AppModal title="自助排查助手" open={open} onCancel={() => setOpen(false)} footer={null} width={800} centered styles={{ body: { height: "min(600px, calc(100dvh - 120px))", overflow: "hidden" } }}>
            {open ? <SupportConversation key={userId} userId={userId} /> : null}
        </AppModal>
    </>;
}

function SupportConversation({ userId }: { userId: string }) {
    const copyText = useCopyText();
    const location = useLocation();
    const routeParams = useMatches().at(-1)?.params || {};
    const [id, setId] = useState(() => conversationId(userId));
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [text, setText] = useState("");
    const [occurredRange, setOccurredRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [locatorType, setLocatorType] = useState<LocatorType>("taskId");
    const [locatorId, setLocatorId] = useState("");
    const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const scopeHelpId = useId();
    const composerHelpId = useId();
    const [scopeOpen, setScopeOpen] = useState(false);
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
    const [stopping, setStopping] = useState(false);
    const [revision, setRevision] = useState(0);
    const conversation = useRef<HTMLDivElement>(null);
    const followLatest = useRef(true);
    const shownReply = useRef<string | undefined>(undefined);
    const activeId = useRef(id);
    activeId.current = id;

    useEffect(() => watchSupportConversation(id, {
        onSnapshot: items => { setMessages(items); setLoading(false); },
        onMessage: item => {
            setMessages(current => current.some(message => message.id === item.id)
                ? current.map(message => message.id === item.id ? item : message) : [...current, item]);
            setLoading(false);
        },
        onError: message => { setConnectionError(message); if (message) setLoading(false); },
    }), [id, revision]);

    const latestMessage = messages.at(-1);
    const hasActiveJobs = messages.some(message => ["pending", "processing"].includes(message.status));
    useEffect(() => {
        // Do not pull users away while they read older evidence.
        // 用户向上阅读历史证据时，不因流式更新强制拉回底部。
        const container = conversation.current;
        if (followLatest.current && container) {
            if (latestMessage?.reply && shownReply.current !== latestMessage.id) {
                const reply = container.querySelector(`[data-support-reply="${CSS.escape(latestMessage.id)}"]`);
                if (reply) container.scrollTop += reply.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
            } else if (!latestMessage?.reply) container.scrollTop = container.scrollHeight;
        }
        shownReply.current = latestMessage?.reply ? latestMessage.id : undefined;
    }, [messages.length, latestMessage?.reply, latestMessage?.status, latestMessage?.stage, latestMessage?.progress?.length]);

    async function addImages(files: File[]) {
        if (!files.length || imageReadLock.current || sending || hasActiveJobs || stopping) return;
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
        followLatest.current = true;
        setId(next); setMessages([]); setText(""); setImages([]); setError(""); setConnectionError(""); setLoading(true);
        resetScope(); setScopeOpen(false);
    }

    function resetScope() {
        setOccurredRange(null); setLocatorType("taskId"); setLocatorId("");
    }

    async function send() {
        const question = text.trim();
        if ((!question && !images.length) || loading || sending || hasActiveJobs || stopping || imageReadLock.current) return;
        if (rangeError) { setError(rangeError); return; }
        const context = supportContext(location, routeParams);
        if (occurredFrom && occurredTo) {
            context.occurredFrom = occurredFrom.toISOString();
            context.occurredTo = occurredTo.toISOString();
        }
        if (locatorId.trim()) context[locatorType] = locatorId.trim();
        const browserRequests = collectBrowserRequests(context);
        if (browserRequests.length) context.browserRequests = browserRequests;
        followLatest.current = true;
        setSending(true); setError("");
        try {
            const submitted = await submitSupportQuestion({ conversationId: id, text: question, images, context });
            if (activeId.current === id) {
                setMessages(current => current.some(item => item.id === submitted.jobId) ? current : [...current, {
                    id: submitted.jobId, ticketId: submitted.ticketId, text: question || "请根据附带截图排查问题。",
                    status: "pending", stage: "已收到，等待排查", reply: null, imageCount: images.length,
                }]);
                setText(""); setImages([]); setRevision(value => value + 1);
            }
        } catch (cause) {
            if (activeId.current === id) {
                setError(cause instanceof Error ? cause.message : "发送失败");
                setRevision(value => value + 1);
            }
        } finally { setSending(false); }
    }

    async function stop() {
        const jobIds = messages.filter(item => ["pending", "processing"].includes(item.status)).map(item => item.id);
        if (!jobIds.length || stopping) return;
        setStopping(true); setError("");
        try {
            const result = await cancelSupportQuestions(id, jobIds);
            if (activeId.current === id) { setMessages(result.messages); setRevision(value => value + 1); }
        } catch (cause) {
            if (activeId.current === id) setError(cause instanceof Error ? cause.message : "终止失败，请重试");
        } finally { setStopping(false); }
    }

    return <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">核对实际代码与操作记录 · 排查过程实时更新</p>
            <Button size="small" onClick={newConversation} disabled={loading || sending || readingImages || hasActiveJobs || stopping}>新问题</Button>
        </div>
        <div ref={conversation} role="log" aria-label="排查对话" aria-live="polite"
            onScroll={() => { const element = conversation.current; if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border p-3">
            {loading ? <Spin aria-label="加载会话" /> : null}
            {!loading && !messages.length ? <div className="m-auto max-w-sm py-8 text-center">
                <Search size={24} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm">遇到什么问题？</p>
                <p className="mt-2 text-xs text-muted-foreground">描述操作和异常，或粘贴截图。有时间段或任务编号时，可点击“定位信息”补充。</p>
            </div> : null}
            {messages.map(item => <article key={item.id} className="flex shrink-0 flex-col gap-3 border-b border-border pb-4 last:border-0">
                <div><strong className="text-sm">你</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p></div>
                {item.imageCount ? <Image.PreviewGroup><div className="flex gap-2 overflow-x-auto">{Array.from({ length: item.imageCount }, (_, index) => <Image
                    key={index} src={`/api/support-bot/web?conversationId=${encodeURIComponent(id)}&messageId=${encodeURIComponent(item.id)}&image=${index}`}
                    alt={`已发送截图 ${index + 1}`} width={64} height={48} style={{ objectFit: "contain", flexShrink: 0 }}
                />)}</div></Image.PreviewGroup> : null}
                <div data-support-reply={item.id} className="min-w-0 rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><strong className="text-sm">FG 助手</strong>{["pending", "processing"].includes(item.status) ? <Spin size="small" aria-label="排查进行中" /> : null}</div>
                        {item.reply ? <Tooltip title="复制完整结果，包含折叠的证据与查询范围"><Button type="text" size="small" icon={<Copy size={14} aria-hidden="true" />} aria-label="复制排查结果" onClick={() => copyText(item.reply || "", "已复制完整排查结果")}>复制结果</Button></Tooltip> : null}
                    </div>
                    {item.reply ? <SupportReply reply={item.reply} /> : <>
                        <p role="status" className="mt-2 text-sm">{item.status === "failed" ? "本次排查失败，请补充信息后重新发送。" : item.stage || "已收到，正在排查…"}</p>
                        {item.progress?.length ? <p className="mt-2 line-clamp-3 break-words text-xs text-muted-foreground">{item.progress.at(-1)?.text}</p> : null}
                    </>}
                    {item.progress?.length ? <Collapse ghost size="small" items={[{ key: "progress", label: `排查过程 · ${item.progress.length} 条查询结果`, children: <ol className="space-y-2 text-xs text-muted-foreground">{item.progress.map(event => <li key={event.id} className="break-words"><time dateTime={event.at} className="mr-2">{new Date(event.at).toLocaleTimeString()}</time>{event.text}</li>)}</ol> }]} /> : null}
                    {item.ticketId ? <p className="mt-2 break-all text-xs text-muted-foreground">问题编号：{item.ticketId}</p> : null}
                </div>
            </article>)}
        </div>
        {error || connectionError ? <Alert type={error ? "error" : "warning"} showIcon title={error || connectionError} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重试连接</Button>} /> : null}
        <form onSubmit={event => { event.preventDefault(); void send(); }} onKeyDown={event => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            if (event.target instanceof HTMLInputElement) event.preventDefault();
            if ((event.ctrlKey || event.metaKey) && event.target instanceof HTMLTextAreaElement) { event.preventDefault(); void send(); }
        }} aria-label="问题输入区" aria-busy={sending || readingImages || stopping} className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1">
                <span aria-live="polite" className="text-xs font-medium text-muted-foreground">{hasActiveJobs ? "排查进行中，可终止当前任务" : "问题描述"}</span>
                <Popover trigger="click" placement="top" autoAdjustOverflow open={scopeOpen} onOpenChange={setScopeOpen} title="定位信息（可选）" content={<div role="group" aria-label="定位信息（可选）" className="flex flex-col gap-3 overflow-y-auto overscroll-contain" style={{ width: "min(440px, calc(100vw - 64px))", maxHeight: "min(320px, 45dvh)" }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setScopeOpen(false); } }}>
                    <DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm:ss" className="w-full" aria-label="故障发生时间段" aria-describedby={scopeHelpId}
                        value={occurredRange} disabled={sending || hasActiveJobs || stopping} placeholder={["开始时间", "结束时间"]} status={rangeError ? "error" : undefined} aria-invalid={Boolean(rangeError)}
                        onCalendarChange={dates => setOccurredRange(dates?.[0] || dates?.[1] ? dates : null)} onChange={setOccurredRange} />
                    <div className="flex flex-wrap items-center gap-2">
                        <Select<LocatorType> aria-label="定位编号类型" value={locatorType} disabled={sending || hasActiveJobs || stopping} onChange={setLocatorType}
                            options={[{ value: "taskId", label: "任务 taskId" }, { value: "requestId", label: "请求 requestId" }, { value: "traceId", label: "链路 traceId" }]} />
                        <Input aria-label="定位编号" aria-describedby={scopeHelpId} className="min-w-0 flex-1" value={locatorId} disabled={sending || hasActiveJobs || stopping} allowClear placeholder="粘贴定位编号" onChange={event => setLocatorId(event.target.value)} />
                        <Button onClick={resetScope} disabled={sending || hasActiveJobs || stopping}>重置</Button>
                    </div>
                    <p id={scopeHelpId} className="text-xs text-muted-foreground">时区：{timeZone}，最长 7 天。未填写时只查询候选记录，不据此确认根因。URL 编号自动附带，手填优先；追问保留定位范围。</p>
                    <p className="text-xs text-muted-foreground">附带所选时间内最多 20 条浏览器失败请求元数据；未选时间时取最近 15 分钟，仅作线索。不上传正文、请求头或 URL 凭据。</p>
                    <div className="flex justify-end"><Button size="small" onClick={() => setScopeOpen(false)}>完成</Button></div>
                </div>}>
                    <Button type="text" size="small" icon={<SlidersHorizontal size={14} aria-hidden="true" />} aria-label="定位信息" aria-expanded={scopeOpen} disabled={sending || hasActiveJobs || stopping} className={occurredRange || locatorId.trim() ? "text-primary" : undefined}>定位信息{occurredRange || locatorId.trim() ? <span aria-label="已设置定位信息" className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}</Button>
                </Popover>
            </div>
            {rangeError ? <p role="alert" className="text-xs text-destructive">{rangeError} 请在“定位信息”中调整。</p> : null}
            <div className="rounded-xl border border-border bg-background p-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
                {images.length ? <Image.PreviewGroup><div aria-label="待发送截图" className="mb-2 flex gap-2 overflow-x-auto py-1">{images.map((image, index) => <div key={index} className="relative shrink-0 rounded-lg border border-border bg-muted/50 p-1">
                    <Image src={image} alt={`待发送截图 ${index + 1}`} width={72} height={56} style={{ objectFit: "contain" }} />
                    <div className="absolute right-0 top-0"><Button size="small" shape="circle" icon={<X size={12} aria-hidden="true" />} disabled={sending || readingImages || hasActiveJobs || stopping} aria-label={`删除截图 ${index + 1}`} onClick={() => setImages(current => current.filter((_, position) => position !== index))} /></div>
                </div>)}</div></Image.PreviewGroup> : null}
                <Input.TextArea aria-label="描述问题或补充排查信息" aria-describedby={composerHelpId} placeholder={hasActiveJobs ? "正在排查，终止或完成后可重新发送问题…" : "描述遇到的问题、操作步骤或报错，也可以直接粘贴截图…"} variant="borderless" style={{ padding: 0, resize: "none" }} onPaste={event => {
                    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
                    if (files.length) { event.preventDefault(); void addImages(files); }
                }} value={text} onChange={event => setText(event.target.value)} maxLength={4000} autoSize={{ minRows: 3, maxRows: 4 }} readOnly={sending || hasActiveJobs || stopping} />
                <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="选择问题截图" disabled={sending || readingImages || hasActiveJobs || stopping} onChange={event => { void addImages(Array.from(event.target.files || [])); event.target.value = ""; }} />
                <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        <Tooltip title="支持选择或粘贴 PNG/JPEG/WebP，最多 10 张，每张原图 20 MiB。发送前自动压缩，预览即提交图片；截图会保存并交给诊断模型，请先遮盖个人信息、密码和密钥。">
                            <Button type="text" size="small" icon={<ImagePlus size={16} aria-hidden="true" />} aria-label="添加截图" onClick={() => imageInput.current?.click()} loading={readingImages} disabled={sending || images.length >= 10 || hasActiveJobs || stopping}>截图{images.length ? ` ${images.length}/10` : ""}</Button>
                        </Tooltip>
                    </div>
                    {hasActiveJobs || stopping ? <Button danger icon={<Square size={14} aria-hidden="true" />} aria-label="终止排查" loading={stopping} disabled={stopping} onClick={() => void stop()}>终止排查</Button> : <Button type="primary" htmlType="submit" icon={<ArrowUp size={16} aria-hidden="true" />} aria-label="发送并排查" loading={sending} disabled={(!text.trim() && !images.length) || loading || readingImages || Boolean(rangeError)}>发送</Button>}
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                <span id={composerHelpId}>{hasActiveJobs || stopping ? "终止或排查完成后可继续发送" : readingImages ? "正在处理截图…" : <><span className="hidden sm:inline">Enter 换行 · </span>Ctrl / ⌘ + Enter 发送</>}</span>
                <span aria-label={`${text.length} / 4000 字`} className="shrink-0 tabular-nums">{text.length} / 4000</span>
            </div>
        </form>
    </div>;
}

function SupportReply({ reply }: { reply: string }) {
    const sections = reply.split(/\n\n(?=(?:结论[^\n]*|原因 \/ 功能依据|如何解决|查询范围|浏览器失败请求线索[^\n]*|实际查到的记录|逐服务运行环境|已核对源码[^\n]*|核对证据|取证缺口|未核实 \/ 数据范围|还需补充|继续定位)\n)/);
    const isDetail = (section: string) => /^(查询范围|浏览器失败请求线索|实际查到的记录|逐服务运行环境|已核对源码|核对证据)/.test(section);
    const details = sections.filter(isDetail);
    return <div className="mt-2 space-y-3">
        <p className="whitespace-pre-wrap break-words text-sm">{sections.filter(section => !isDetail(section)).join("\n\n")}</p>
        {details.length ? <Collapse ghost size="small" items={[{ key: "evidence", label: "查看详细证据与查询范围", children: <p className="whitespace-pre-wrap break-words text-xs">{details.join("\n\n")}</p> }]} /> : null}
    </div>;
}
