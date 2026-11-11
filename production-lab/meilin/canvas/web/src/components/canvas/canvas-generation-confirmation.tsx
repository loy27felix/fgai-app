import { useCallback, useEffect, useRef } from "react";
import { App } from "antd";
import type { GenerationConfirmationItem } from "@/lib/canvas/canvas-generation-confirmation";

export function CanvasGenerationConfirmationContent({ items, duplicate = false }: { items: GenerationConfirmationItem[]; duplicate?: boolean }) {
    return (
        <div>
            <p>请核对本次生成内容与参数。点击“确认生成”后才会创建任务，并按当前模型规则计费。</p>
            {duplicate && <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">这是相同内容的再次生成，会新建任务并可能再次计费。</p>}
            <div className="grid max-h-[55dvh] gap-3 overflow-y-auto pr-1">
                {items.map((item, index) => (
                    <section key={`${item.key}-${index}`} className="rounded-lg border border-border p-3">
                        <div className="mb-2 font-semibold">
                            {items.length > 1 ? `${index + 1}. ` : ""}
                            {item.title} · {item.kind}
                        </div>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                            {item.fields.map(([label, value]) => (
                                <div key={label} className="contents">
                                    <dt className="text-foreground/60">{label}</dt>
                                    <dd className="m-0 break-words font-medium">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className="mt-2 text-xs text-foreground/60">参考素材：{item.references.length ? item.references.join("、") : "未连接参考节点"}</div>
                        <details className="mt-2 text-xs">
                            <summary className="cursor-pointer">查看本次生成内容</summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">{item.prompt || "按参考素材生成"}</pre>
                        </details>
                    </section>
                ))}
            </div>
            <p className="mb-0 mt-3 text-xs text-foreground/60">需要修改时请点取消，返回节点调整。自适应尺寸以模型实际返回为准。</p>
        </div>
    );
}
export function useCanvasGenerationConfirmation(scope?: string) {
    const { modal } = App.useApp();
    const pending = useRef(new Set<() => void>());
    useEffect(
        () => () => {
            for (const cancel of pending.current) cancel();
            pending.current.clear();
        },
        [scope],
    );
    return useCallback(
        (items: GenerationConfirmationItem[], duplicate = false) =>
            new Promise<boolean>((resolve) => {
                let settled = false;
                const settle = (value: boolean) => {
                    if (settled) return;
                    settled = true;
                    pending.current.delete(cancel);
                    resolve(value);
                };
                const cancel = () => {
                    settle(false);
                    instance.destroy();
                };
                const instance = modal.confirm({
                    title: items.length > 1 ? `确认生成 ${items.length} 个任务？` : "确认生成内容",
                    content: <CanvasGenerationConfirmationContent items={items} duplicate={duplicate} />,
                    okText: "确认生成",
                    cancelText: "取消",
                    centered: true,
                    width: 640,
                    zIndex: 10000,
                    maskClosable: false,
                    keyboard: false,
                    onOk: () => settle(true),
                    onCancel: () => settle(false),
                    afterClose: () => settle(false),
                });
                pending.current.add(cancel);
            }),
        [modal],
    );
}
