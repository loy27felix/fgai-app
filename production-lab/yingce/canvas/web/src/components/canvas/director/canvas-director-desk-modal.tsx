import { useEffect, useRef, useState } from "react";
import { Button, Space } from "antd";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { getMediaBlob } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    open: boolean; node?: CanvasNodeData; onClose: () => void;
    onSave: (document: Record<string, unknown>) => Promise<void>;
    onOutput: (file: File) => Promise<void>; onAgentContext: (summary: string) => Promise<void>;
};
export function CanvasDirectorDeskModal(props: Props) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const latest = useRef(props); latest.current = props;
    const [status, setStatus] = useState("载入 3D 场景…");
    const busy = useRef(0);
    const command = (command: string) => iframe.current?.contentWindow?.postMessage({channel: "fg-director-desk-command", command}, location.origin);
    useEffect(() => {
        if (!props.open) return;
        let queue = Promise.resolve(); let disposed = false;
        setStatus("工程与当前画布关联，自动保存到 NAS");
        const listener = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow || event.data?.channel !== "fg-director-desk") return;
            const {id, method, payload} = event.data;
            if (typeof id !== "string" || typeof method !== "string") return;
            // Serialize writes so an export and an autosave cannot overwrite the canvas version.
            queue = queue.then(async () => {
                if (disposed) return;
                busy.current++;
                try {
                    let result: unknown = true;
                    if (method === "load") {
                        const key = latest.current.node?.metadata?.storageKey;
                        const blob = key ? await getMediaBlob(key) : null;
                        if (key && !blob) throw new Error("云端工程读取失败，请重试，不能用空白工程替换");
                        result = blob ? JSON.parse(await blob.text()) : null;
                    } else if (method === "save") {
                        if (!payload?.document || typeof payload.document !== "object" || !Array.isArray(payload.document.scenes)) throw new Error("3D 工程格式无效");
                        setStatus("正在保存工程…"); await latest.current.onSave(payload.document); setStatus("工程已保存到 NAS");
                    } else if (method === "output") {
                        if (!(payload?.blob instanceof Blob) || typeof payload.name !== "string") throw new Error("导出文件无效");
                        setStatus("正在写入画布与 NAS…"); await latest.current.onOutput(new File([payload.blob], payload.name, {type: payload.blob.type})); setStatus("已保存到画布与 NAS");
                    } else if (method === "agent-context") {
                        if (typeof payload?.summary !== "string") throw new Error("调度说明无效");
                        await latest.current.onAgentContext(payload.summary);
                    } else if (method === "close") { latest.current.onClose(); }
                    else throw new Error("不支持的导演台操作");
                    event.source?.postMessage({channel: "fg-director-desk-result", id, result}, {targetOrigin: location.origin});
                } catch (error) {
                    const message = error instanceof Error ? error.message : "云端保存失败";
                    setStatus(message); event.source?.postMessage({channel: "fg-director-desk-result", id, error: message}, {targetOrigin: location.origin});
                } finally { busy.current--; }
            });
        };
        window.addEventListener("message", listener);
        return () => { disposed = true; window.removeEventListener("message", listener); };
    }, [props.open]);
    return <AppModal flush open={props.open} onCancel={() => { if (!busy.current) command("close"); }} maskClosable={false} keyboard={false}
        width="calc(100vw - 32px)" style={{top: 16}} title={null} closable={false} footer={null}>
        <div data-canvas-no-zoom data-canvas-wheel-scroll>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{borderColor: "var(--border-subtle)"}}>
                <div><strong>FG 3D 导演台</strong><div className="text-xs opacity-70" role="status">{status}</div></div>
                <Space wrap>
                    <Button onClick={() => command("save")}>保存工程</Button>
                    <Button onClick={() => command("snapshot")}>截图回画布</Button>
                    <Button onClick={() => command("prompt")}>调度说明回画布</Button>
                    <Button onClick={() => command("export")}>参考视频回画布</Button>
                    <Button type="primary" onClick={() => { if (!busy.current) command("close"); }}>返回画布</Button>
                </Space>
            </div>
            {props.open ? <iframe ref={iframe} src="/director-desk/?fg=1" title="FG 3D 导演台场景与运镜" allow="fullscreen" className="block w-full border-0" style={{height: "calc(100dvh - 132px)"}} /> : null}
        </div>
    </AppModal>;
}
