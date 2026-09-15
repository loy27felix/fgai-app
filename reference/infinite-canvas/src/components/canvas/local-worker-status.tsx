import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Tooltip } from "antd";
import { Cpu, RefreshCw, ShieldCheck } from "lucide-react";

import { createMediaWorkerPairingCode, listMediaWorkers, mediaWorkerBackendLabel, type MediaWorkerSummary } from "@/reference/infinite-canvas/src/services/api/media-worker";

function relativeHeartbeat(value: string | null) {
    if (!value) return "从未心跳";
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "时间未知";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds} 秒前`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
    return `${Math.round(seconds / 3600)} 小时前`;
}

export function LocalWorkerStatus() {
    const [workers, setWorkers] = useState<MediaWorkerSummary[]>([]);
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: string } | null>(null);

    const refresh = useCallback(() => {
        setLoading(true);
        setError("");
        void listMediaWorkers()
            .then((result) => {
                setEnabled(result.enabled);
                setWorkers(result.workers || []);
            })
            .catch((reason) => setError(reason instanceof Error ? reason.message : "Worker 状态读取失败"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        refresh();
        const timer = window.setInterval(refresh, 30_000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    const createPairing = async () => {
        setError("");
        try {
            const result = await createMediaWorkerPairingCode();
            setPairingCode(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "配对码生成失败");
        }
    };

    const onlineCount = useMemo(() => workers.filter((worker) => worker.status === "online").length, [workers]);

    return (
        <div className="pointer-events-auto w-[290px] rounded-xl border bg-black/35 p-3 text-white shadow-xl backdrop-blur-md" data-canvas-no-zoom>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><Cpu className="size-4" />本机 GPU Worker</div>
                <Tooltip title="刷新 Worker 状态"><Button type="text" size="small" loading={loading} icon={<RefreshCw className="size-3.5" />} onClick={refresh} /></Tooltip>
            </div>
            {enabled === false ? <div className="mt-2 text-xs text-amber-300">功能未启用（管理员可开启 MEDIA_WORKER_ENABLED）</div> : null}
            {error ? <Alert className="mt-2" type="error" showIcon message={error} /> : null}
            {!error && enabled !== false && !workers.length ? <div className="mt-2 text-xs opacity-65">尚未配对 Worker。先生成一次性配对码，再在运行 Worker 的电脑执行配对命令。</div> : null}
            {enabled === true ? (
                <div className="mt-2 rounded-lg border border-white/10 p-2">
                    <Button size="small" type="primary" onClick={() => void createPairing()}>生成一次性配对码</Button>
                    {pairingCode ? <div className="mt-2 space-y-1 text-xs"><div className="font-mono text-base tracking-[0.2em] text-emerald-300">{pairingCode.code}</div><div className="opacity-60">10 分钟内有效，只显示在当前页面；不要发到群里。</div><Button size="small" onClick={() => void navigator.clipboard?.writeText(pairingCode.code)}>复制配对码</Button></div> : null}
                </div>
            ) : null}
            {workers.length ? (
                <div className="mt-2 space-y-1.5">
                    <div className="mb-1 text-xs opacity-60">{onlineCount} 台在线 / {workers.length} 台已配对</div>
                    {workers.slice(0, 3).map((worker) => (
                        <div key={worker.id} className="rounded-lg border border-white/10 px-2.5 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium">{worker.name}</span><span className={worker.status === "online" ? "text-emerald-300" : worker.status === "revoked" ? "text-red-300" : "text-amber-300"}>{worker.status === "online" ? "在线" : worker.status === "revoked" ? "已撤销" : "离线"}</span></div>
                            <div className="mt-1 flex items-center justify-between gap-2 opacity-65"><span>{worker.platform} · {worker.architecture}</span><span>{relativeHeartbeat(worker.last_seen_at)}</span></div>
                            <div className="mt-1 flex items-center gap-1 opacity-65"><ShieldCheck className="size-3" />{(worker.capabilities?.backends || []).map(mediaWorkerBackendLabel).join(" / ") || "未上报后端"}</div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
