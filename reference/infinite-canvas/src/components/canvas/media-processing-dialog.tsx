import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Button, Modal, Progress, Select, Segmented, Spin } from "antd";
import { Eraser, MonitorCog, Sparkles } from "lucide-react";

import { uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import { createMediaJob, getCreatorWorkspace, listMediaWorkers, mediaWorkerBackendLabel, type MediaWorkerJob, type MediaWorkerSummary } from "@/reference/infinite-canvas/src/services/api/media-worker";
import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";
import type { MediaOperation, TargetResolution } from "@/types/media-worker";

type SupportedOperation = Extract<MediaOperation, "video_super_resolution" | "watermark_removal">;

export function MediaProcessingDialog({ node, open, onClose, onJobCreated }: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onJobCreated: (job: MediaWorkerJob, operation: SupportedOperation) => void;
}) {
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const [operation, setOperation] = useState<SupportedOperation>("video_super_resolution");
    const [targetResolution, setTargetResolution] = useState<TargetResolution>("1080p");
    const [modelProfile, setModelProfile] = useState("basicvsrpp-quality");
    const [workers, setWorkers] = useState<MediaWorkerSummary[]>([]);
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [loadingWorkers, setLoadingWorkers] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submittedProgress, setSubmittedProgress] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [maskHasPaint, setMaskHasPaint] = useState(false);

    const content = node?.metadata?.content || "";
    const sourceAssetId = node?.metadata?.cloudAssetId || "";
    const sourceWidth = Math.max(1, Math.round(node?.metadata?.naturalWidth || node?.width || 640));
    const sourceHeight = Math.max(1, Math.round(node?.metadata?.naturalHeight || node?.height || 360));
    const isVideo = node?.type === CanvasNodeType.Video;
    const onlineWorkers = useMemo(() => workers.filter((worker) => worker.status === "online"), [workers]);
    const compatibleWorkers = useMemo(
        () => onlineWorkers.filter((worker) => worker.capabilities?.operations?.includes(operation) && worker.capabilities?.modelProfiles?.includes(modelProfile)),
        [modelProfile, onlineWorkers, operation],
    );

    useEffect(() => {
        if (!open) return;
        setOperation("video_super_resolution");
        setTargetResolution("1080p");
        setModelProfile("basicvsrpp-quality");
        setError("");
        setSubmittedProgress(null);
        setMaskHasPaint(false);
        const canvas = maskCanvasRef.current;
        if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

        let active = true;
        setLoadingWorkers(true);
        void listMediaWorkers()
            .then((result) => {
                if (!active) return;
                setEnabled(result.enabled);
                setWorkers(result.workers || []);
            })
            .catch((reason) => {
                if (!active) return;
                setEnabled(false);
                setWorkers([]);
                setError(reason instanceof Error ? reason.message : "本机 Worker 状态读取失败");
            })
            .finally(() => {
                if (active) setLoadingWorkers(false);
            });
        return () => {
            active = false;
        };
    }, [open, node?.id]);

    const paintMask = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width));
        const y = Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = "rgba(255,255,255,.92)";
        context.beginPath();
        context.arc(x, y, Math.max(12, Math.min(canvas.width, canvas.height) * 0.035), 0, Math.PI * 2);
        context.fill();
        setMaskHasPaint(true);
    };

    const submit = async () => {
        if (!node || !sourceAssetId) {
            setError("这个节点还没有云端素材 ID，请先等待素材保存到云端后再处理");
            return;
        }
        if (!isVideo) {
            setError("本机 GPU 媒体处理目前只支持视频节点");
            return;
        }
        if (enabled !== true) {
            setError("本地 Worker 功能尚未启用，请先在服务端开启 MEDIA_WORKER_ENABLED");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            let maskAssetId: string | null = null;
            if (operation === "watermark_removal") {
                const canvas = maskCanvasRef.current;
                if (!canvas || !maskHasPaint) throw new Error("请在预览图上涂抹要去除的水印区域");
                const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("遮罩生成失败")), "image/png"));
                const maskFile = new File([blob], `${node.title || "media"}-mask.png`, { type: "image/png" });
                const stored = await uploadCanvasAsset(maskFile, { kind: "image", source: "upload", name: maskFile.name });
                maskAssetId = stored.assetId;
            }
            const workspace = await getCreatorWorkspace();
            const result = await createMediaJob({
                workspaceId: workspace.workspace.id,
                operation,
                sourceAssetId,
                maskAssetId,
                targetResolution: operation === "video_super_resolution" ? targetResolution : null,
                modelProfile,
                idempotencyKey: `canvas-media-${node.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            });
            setSubmittedProgress(0);
            onJobCreated(result.job, operation);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "媒体处理任务创建失败，请重试");
        } finally {
            setSubmitting(false);
        }
    };

    const resetMask = () => {
        const canvas = maskCanvasRef.current;
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        setMaskHasPaint(false);
    };

    const availableProfileOptions = operation === "watermark_removal"
        ? [{ label: "ProPainter · 用户遮罩", value: "propainter-mask" }]
        : [
              { label: "BasicVSR++ · 质量优先", value: "basicvsrpp-quality" },
              { label: "Real-ESRGAN 序列回退 · 不锐化", value: "realesrgan-sequence-fallback" },
          ];

    return (
        <Modal title={null} open={open && Boolean(node)} onCancel={onClose} footer={null} width={900} centered destroyOnHidden>
            <div className="space-y-5" data-canvas-no-zoom>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-semibold">本机 GPU 媒体处理</h2>
                        <p className="mt-1 text-sm opacity-60">任务会进入服务端队列，原素材保持不变，结果写回 NAS 后再创建派生节点。</p>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs opacity-70"><MonitorCog className="size-4" />{loadingWorkers ? "读取 Worker…" : `${onlineWorkers.length} 台在线`}</div>
                </div>

                {!sourceAssetId ? <Alert type="warning" showIcon message="素材尚未完成云端保存" description="请等节点上的“保存到云端”提示消失后再提交处理，避免浏览器临时链接失效。" /> : null}
                {!isVideo ? <Alert type="info" showIcon message="请从视频节点打开本机 GPU 处理" description="当前 Worker 的超分和去水印适配器针对视频，图片仍可使用现有图片放大工具。" /> : null}
                {enabled === false ? <Alert type="info" showIcon message="本地 Worker 尚未启用" description="管理员开启 MEDIA_WORKER_ENABLED 后，现有 WeToken/画布生成流程不受影响。" /> : null}
                {error ? <Alert type="error" showIcon message={error} /> : null}

                <div className="grid gap-5 md:grid-cols-[minmax(320px,1fr)_320px]">
                    <div className="rounded-xl border p-3">
                        <div className="relative grid min-h-[300px] place-items-center overflow-hidden rounded-lg bg-black/10">
                            {content ? (isVideo ? <video src={content} className="absolute inset-0 h-full w-full object-contain" controls muted playsInline /> : <img src={content} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />) : <span className="text-sm opacity-50">暂无预览</span>}
                            {operation === "watermark_removal" ? (
                                <canvas
                                    ref={maskCanvasRef}
                                    width={sourceWidth}
                                    height={sourceHeight}
                                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                    onPointerDown={(event) => {
                                        event.currentTarget.setPointerCapture(event.pointerId);
                                        drawingRef.current = true;
                                        paintMask(event);
                                    }}
                                    onPointerMove={(event) => {
                                        if (drawingRef.current) paintMask(event);
                                    }}
                                    onPointerUp={(event) => {
                                        drawingRef.current = false;
                                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                                    }}
                                    onPointerCancel={() => { drawingRef.current = false; }}
                                />
                            ) : null}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs opacity-60">
                            <span>{node?.title || "媒体节点"}</span>
                            <span>{sourceWidth} × {sourceHeight}px</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <Segmented
                            block
                            value={operation}
                            options={[{ label: "视频超分", value: "video_super_resolution" }, { label: "去水印", value: "watermark_removal" }]}
                            onChange={(value) => {
                                setOperation(value as SupportedOperation);
                                setModelProfile(value === "watermark_removal" ? "propainter-mask" : "basicvsrpp-quality");
                                setMaskHasPaint(false);
                                setError("");
                            }}
                        />
                        {operation === "video_super_resolution" ? (
                            <label className="block space-y-1.5 text-sm">
                                <span className="font-medium opacity-75">目标分辨率</span>
                                <Select className="w-full" value={targetResolution} options={[{ label: "1080p · 1920 × 1080", value: "1080p" }, { label: "2K · 2560 × 1440", value: "2k" }, { label: "4K · 3840 × 2160", value: "4k" }]} onChange={setTargetResolution} />
                            </label>
                        ) : (
                            <Alert type="info" showIcon message="在预览图上涂抹水印区域" description="只会处理你绘制的区域，原始素材会作为独立资产保留。" />
                        )}
                        <label className="block space-y-1.5 text-sm">
                            <span className="font-medium opacity-75">处理模型</span>
                            <Select className="w-full" value={modelProfile} options={availableProfileOptions} onChange={setModelProfile} />
                        </label>
                        {operation === "watermark_removal" ? <Button block icon={<Eraser className="size-4" />} onClick={resetMask}>清除遮罩</Button> : null}
                        <div className="rounded-xl border px-3 py-2.5 text-xs leading-5">
                            <div className="flex items-center justify-between"><span className="opacity-60">可用 Worker</span><span className={compatibleWorkers.length ? "text-emerald-500" : "text-amber-500"}>{compatibleWorkers.length ? `${compatibleWorkers.length} 台匹配` : "等待本机 Worker"}</span></div>
                            {compatibleWorkers.length ? <div className="mt-2 space-y-1 opacity-70">{compatibleWorkers.slice(0, 3).map((worker) => <div key={worker.id} className="flex items-center justify-between"><span className="truncate">{worker.name}</span><span>{(worker.capabilities.backends || []).map(mediaWorkerBackendLabel).join(" / ") || worker.platform}</span></div>)}</div> : null}
                        </div>
                        {submittedProgress !== null ? <Progress percent={submittedProgress} status="active" size="small" format={() => "已入队，等待 Worker"} /> : null}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs opacity-55"><Sparkles className="size-4" />不会上传到公有云 GPU；仅使用已配对的本机 Worker</div>
                    <Button type="primary" loading={submitting} disabled={enabled !== true || !sourceAssetId || !isVideo || (operation === "watermark_removal" && !maskHasPaint)} onClick={() => void submit()}>提交到本机队列</Button>
                </div>
            </div>
        </Modal>
    );
}
