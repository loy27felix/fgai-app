import { Modal, type ModalProps } from "antd";
import type { CSSProperties } from "react";

// 用途：产品弹窗壳。消费 token 由内容自己负责。接管 AntD Modal 的重复 flush 内边距。
const FLUSH_STYLES = {
    container: { padding: 0, overflow: "hidden" },
    body: { padding: 0 },
} as const;

export type AppModalProps = ModalProps & {
    /** 内容自带外壳时去掉 AntD 默认内边距，避免每个业务弹窗复制同一套 styles。 */
    flush?: boolean;
    /** 长文提示词需在系统截图/切换窗口后保持打开，不使用 GPU 模糊层。 */
    stablePromptEditor?: boolean;
};

export function AppModal({ flush = false, stablePromptEditor = false, destroyOnHidden = true, styles, ...props }: AppModalProps) {
    const mergeResolvedStyles = (resolved: unknown) => {
        const base = resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : {};
        if (!flush) return base;
        const container = base.container && typeof base.container === "object" ? (base.container as CSSProperties) : {};
        const body = base.body && typeof base.body === "object" ? (base.body as CSSProperties) : {};
        return {
            ...base,
            container: { ...container, ...FLUSH_STYLES.container },
            body: { ...body, ...FLUSH_STYLES.body },
        };
    };
    const mergedStyles =
        typeof styles === "function"
            ? (info: { props: ModalProps }) => mergeResolvedStyles(styles(info))
            : mergeResolvedStyles(styles);

    return <Modal destroyOnHidden={destroyOnHidden} {...props}
        {...(stablePromptEditor ? {
            rootClassName: [props.rootClassName, "fg-stable-prompt-editor"].filter(Boolean).join(" "),
            keyboard: false,
            mask: { closable: false },
            transitionName: "",
            maskTransitionName: "",
            wrapProps: { ...props.wrapProps, "data-canvas-prompt-editor-open": props.open ? "true" : undefined },
        } : {})}
        styles={mergedStyles as ModalProps["styles"]} />;
}
