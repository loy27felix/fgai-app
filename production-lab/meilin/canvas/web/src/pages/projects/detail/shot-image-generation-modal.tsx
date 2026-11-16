import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Radio, Spin } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { FGPricePreview } from "@/components/fg-price-preview";
import { getResource, resourceIdFromStorageKey } from "@/services/api/resources";
import { prepareShotImageTransfer, type ShotImageTransfer } from "@/services/shot-image-transfer";
import { SHOT_REFERENCE_TOTAL_TARGET } from "@/lib/shot-image-transfer";
import { selectShotImageReferences } from "./shot-image-references";
import type { ShotAssetReferenceContext } from "./workflow-shot-references";
import type { SkillRuntimeMetadata } from "@/services/skill-runtime";
import type { AiConfig } from "@/stores/use-config-store";
import type { ModelRequirements } from "@/lib/model-selection";

export type PreparedShotImage = { operationId: string; context: ShotAssetReferenceContext; transfer: ShotImageTransfer; execution: { prompt: string; metadata: SkillRuntimeMetadata } };
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
export function ShotImageGenerationModal({
    title,
    context,
    config,
    requirements,
    onPreparePrompt,
    onConfirm,
    onClose,
}: {
    title: string;
    context: ShotAssetReferenceContext;
    config: AiConfig;
    requirements: ModelRequirements;
    onPreparePrompt: (context: ShotAssetReferenceContext) => Promise<PreparedShotImage["execution"]>;
    onConfirm: (prepared: PreparedShotImage) => Promise<boolean>;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState(() => new Set(context.assetReferences.map((r) => r.assetId)));
    const [optimize, setOptimize] = useState(true);
    const [sizes, setSizes] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true),
        [busy, setBusy] = useState(false),
        [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [prepared, setPrepared] = useState<PreparedShotImage>();
    const alive = useRef(true),
        locked = useRef(false);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        let current = true;
        void Promise.all(
            context.referenceImages.map(async (image) => {
                const id = resourceIdFromStorageKey(image.storageKey);
                if (!id) throw new Error(`${image.name} 尚未保存到素材库`);
                return [image.id, (await getResource(id)).size] as const;
            }),
        )
            .then((entries) => {
                if (current) setSizes(Object.fromEntries(entries));
            })
            .catch((e) => {
                if (current) setError(e instanceof Error ? e.message : "读取参考图失败");
            })
            .finally(() => {
                if (current) setLoading(false);
            });
        return () => {
            current = false;
        };
    }, [context]);
    const scoped = selectShotImageReferences(context, selected);
    const total = scoped.referenceImages.reduce((sum, image) => sum + (sizes[image.id] || 0), 0);
    const selectedRequirements: ModelRequirements = { ...requirements, input: { textCount: 1, videoCount: 0, characterCount: 0, imageCount: scoped.referenceImages.length, audioCount: 0 } };
    const prepare = async () => {
        if (locked.current) return;
        locked.current = true;
        setBusy(true);
        setError("");
        setPrepared(undefined);
        try {
            const transfer = await prepareShotImageTransfer(scoped.referenceImages, optimize, { isCurrent: () => alive.current, onProgress: setProgress });
            const execution = await onPreparePrompt(scoped);
            if (alive.current) setPrepared({ operationId: crypto.randomUUID(), context: { ...scoped, referenceImages: transfer.images }, transfer, execution });
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "准备失败");
        } finally {
            locked.current = false;
            if (alive.current) setBusy(false);
        }
    };
    const confirm = async () => {
        if (!prepared || locked.current) return;
        locked.current = true;
        setSubmitting(true);
        try {
            if (await onConfirm(prepared)) onClose();
        } finally {
            locked.current = false;
            if (alive.current) setSubmitting(false);
        }
    };
    return (
        <AppModal
            open
            title={`${title} · 参考图与生成确认`}
            width={880}
            onCancel={() => {
                if (!submitting) onClose();
            }}
            maskClosable={false}
            footer={
                <>
                    <Button disabled={submitting} onClick={onClose}>
                        取消
                    </Button>
                    <Button loading={busy} disabled={loading || submitting} onClick={() => void prepare()}>
                        {prepared ? "重新准备" : "准备参考图并预览"}
                    </Button>
                    <Button type="primary" loading={submitting} disabled={!prepared || busy} onClick={() => void confirm()}>
                        确认并生成
                    </Button>
                </>
            }
        >
            <div className="grid gap-4">
                <p>本次勾选只影响这一次分镜图／动作预演，不会删除资产、解除镜头绑定或修改视频参考。</p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={busy || submitting}
                        onClick={() => {
                            setSelected(new Set(context.assetReferences.map((r) => r.assetId)));
                            setPrepared(undefined);
                        }}
                    >
                        全选
                    </Button>
                    <Button
                        disabled={busy || submitting}
                        onClick={() => {
                            setSelected(new Set());
                            setPrepared(undefined);
                        }}
                    >
                        不使用参考图
                    </Button>
                    <span className="self-center text-xs">
                        已选 {scoped.referenceImages.length} 张 · 原图合计 {loading ? "读取中" : sizeLabel(total)}
                    </span>
                </div>
                {loading ? (
                    <Spin />
                ) : (
                    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
                        {context.assetReferences.map((reference) => {
                            const image = context.referenceImages[reference.imageIndex - 1];
                            return (
                                <Checkbox
                                    key={reference.assetId}
                                    className="rounded-lg border border-border p-2"
                                    checked={selected.has(reference.assetId)}
                                    disabled={busy || submitting}
                                    onChange={(event) => {
                                        setSelected((previous) => {
                                            const next = new Set(previous);
                                            if (event.target.checked) next.add(reference.assetId);
                                            else next.delete(reference.assetId);
                                            return next;
                                        });
                                        setPrepared(undefined);
                                    }}
                                    aria-label={`本次使用${reference.title}`}
                                >
                                    <span className="flex items-center gap-2">
                                        {image && <CachedResourceImage storageKey={image.storageKey} src={image.url} alt={reference.title} className="size-12 rounded object-contain" />}
                                        <span className="min-w-0 text-xs">
                                            <span className="block truncate">{reference.title}</span>
                                            <span>{sizeLabel(sizes[image?.id] || 0)}</span>
                                        </span>
                                    </span>
                                </Checkbox>
                            );
                        })}
                    </div>
                )}
                {!scoped.referenceImages.length && <Alert type="warning" title="本次仅按文字生成，不会锁定角色与场景参考形象" />}
                <Radio.Group
                    value={optimize ? "optimized" : "original"}
                    disabled={busy || submitting}
                    onChange={(event) => {
                        setOptimize(event.target.value === "optimized");
                        setPrepared(undefined);
                    }}
                    options={[
                        { value: "optimized", label: "优化传输（推荐，保留原资产）" },
                        { value: "original", label: "上传原图" },
                    ]}
                />
                <p className="text-xs text-foreground/60">大图仅为本次提交制作 WebP 副本，最长边不超过 2048，保持比例与透明背景。不会覆盖原图；可在下方预览实际提交版本。准备参考图不调用图片模型。</p>
                {!optimize && total > SHOT_REFERENCE_TOTAL_TARGET && <Alert type="warning" title="整包原图较大，上游可能再次返回 413；建议开启优化传输" />}
                {busy && <p role="status">{progress || "正在准备参考图"}</p>}
                {error && <Alert type="error" title={error} />}
                {prepared && (
                    <>
                        <Alert type="success" title={`本次提交 ${prepared.transfer.images.length} 张：${sizeLabel(prepared.transfer.originalBytes)} → ${sizeLabel(prepared.transfer.submittedBytes)}`} />
                        <div className="grid grid-cols-3 gap-2">
                            {prepared.transfer.images.map((image, index) => (
                                <div key={image.id} className="text-xs">
                                    <CachedResourceImage storageKey={image.storageKey} src={image.url} alt={`${image.name}实际提交图`} className="h-24 w-full object-contain" />
                                    <p>
                                        图片{index + 1} · {image.name}
                                    </p>
                                    <p>
                                        {image.width}×{image.height} · {sizeLabel(image.bytes || 0)}
                                    </p>
                                </div>
                            ))}
                        </div>
                        <Input.TextArea readOnly value={prepared.execution.prompt} autoSize={{ minRows: 6, maxRows: 12 }} aria-label="本次实际生成提示词" />
                        <FGPricePreview config={config} model={config.model} mode="image" requirements={selectedRequirements} />
                    </>
                )}
            </div>
        </AppModal>
    );
}
