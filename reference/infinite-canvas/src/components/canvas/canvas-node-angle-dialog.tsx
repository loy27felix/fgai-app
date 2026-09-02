import { useEffect, useState } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { RotateCcw, WandSparkles } from "lucide-react";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
    mode?: "angle" | "storyboard";
};

const defaultParams: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 9,
    cameraDistance: 4.8,
    wideAngle: false,
    mode: "angle",
};

export function CanvasNodeAngleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void }) {
    const [params, setParams] = useState(defaultParams);

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={860} centered destroyOnHidden>
            <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-semibold">AI 多角度与分镜</h2>
                        <p className="mt-1 text-sm opacity-60">先用一张原图确定镜头，生成结果仍可在画布中继续编辑</p>
                    </div>
                    <Segmented
                        value={params.mode || "angle"}
                        options={[
                            { label: "单一新角度", value: "angle" },
                            { label: "九宫格分镜", value: "storyboard" },
                        ]}
                        onChange={(value) => update("mode", value as CanvasImageAngleParams["mode"])}
                    />
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="flex min-h-[300px] flex-col justify-between rounded-xl border p-4">
                        <div className="grid flex-1 place-items-center">
                            <div className="relative">
                                <img src={dataUrl} alt="" className="size-48 rounded-2xl object-cover shadow-2xl" draggable={false} style={{ transform: previewTransform(params) }} />
                                {params.mode === "storyboard" ? <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 overflow-hidden rounded-2xl border-2 border-white/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,.35)]">{Array.from({ length: 9 }, (_, index) => <span key={index} className="border border-white/70 bg-black/5" />)}</div> : null}
                                <div className="absolute -bottom-6 left-1/2 h-10 w-24 -translate-x-1/2 rounded-full border bg-black/20 backdrop-blur" />
                            </div>
                        </div>
                        <Button className="w-fit" icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>
                            重置
                        </Button>
                    </div>
                    {params.mode === "storyboard" ? (
                        <div className="space-y-4 py-2">
                            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/5 p-4">
                                <div className="text-sm font-semibold text-cyan-500">一张图，九个连贯镜头</div>
                                <p className="mt-2 text-sm leading-6 opacity-70">会保留原图的主体、造型与风格，按建立镜头、动作推进、细节、反应和收束编排为 3 × 3 分镜表。</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs opacity-65">
                                {["建立", "中景", "特写", "侧面", "动作", "反应", "细节", "俯视", "收束"].map((label, index) => <div key={label} className="rounded-lg border px-2 py-3"><span className="mr-1 opacity-50">{index + 1}</span>{label}</div>)}
                            </div>
                            <p className="text-xs leading-5 opacity-55">生成后可使用图片工具栏的「切图」，设为 3 行 × 3 列，将九格拆成独立画布节点。</p>
                        </div>
                    ) : (
                        <div className="space-y-6 py-2">
                            <AngleSlider label="左右角度" value={params.horizontalAngle} min={-60} max={60} step={1} suffix="deg" onChange={(value) => update("horizontalAngle", value)} />
                            <AngleSlider label="俯仰角度" value={params.pitchAngle} min={-45} max={45} step={1} suffix="deg" onChange={(value) => update("pitchAngle", value)} />
                            <AngleSlider label="镜头距离" value={params.cameraDistance} min={1} max={10} step={0.1} onChange={(value) => update("cameraDistance", value)} />
                            <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
                                <span className="font-medium opacity-75">广角镜头</span>
                                <Segmented
                                    className="w-fit"
                                    value={params.wideAngle ? "wide" : "standard"}
                                    options={[
                                        { label: "标准", value: "standard" },
                                        { label: "广角", value: "wide" },
                                    ]}
                                    onChange={(value) => update("wideAngle", value === "wide")}
                                />
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} onClick={() => onConfirm(params)}>
                        {params.mode === "storyboard" ? "生成九宫格分镜" : "AI 生成"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function AngleSlider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
            <span className="font-medium opacity-75">{label}</span>
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
            <span className="whitespace-nowrap text-right font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {suffix}
            </span>
        </div>
    );
}

function previewTransform(params: CanvasImageAngleParams) {
    if (params.mode === "storyboard") return "scale(.98)";
    const scale = 1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
    return `perspective(520px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${Math.max(0.72, Math.min(1.08, scale))})`;
}
