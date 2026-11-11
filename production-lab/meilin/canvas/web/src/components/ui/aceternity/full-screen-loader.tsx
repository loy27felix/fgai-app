import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label, detail, className }: FullScreenLoaderProps) {
    const { t } = useTranslation();
    const title = label ?? t("account.ui.loader.label");
    const subtitle = detail ?? t("account.ui.loader.detail");
    const [phase] = useState(() => ({ "--loader-phase": `-${performance.now()}ms` } as CSSProperties));
    return (
        <div
            data-full-screen-loader
            role="status"
            aria-live="polite"
            aria-label={t("account.ui.loader.aria", { label: title, detail: subtitle })}
            className={cn("full-screen-loader", className)}
            style={phase}
        >
            <div className="full-screen-loader-scene" aria-hidden="true">
                <span className="full-screen-loader-guide is-horizontal" />
                <span className="full-screen-loader-guide is-vertical" />
                <span className="full-screen-loader-frame is-left"><i /><i /><i /></span>
                <span className="full-screen-loader-frame is-right"><i /><i /><i /></span>
                <span className="full-screen-loader-script"><i /><i /><i /><b /></span>
                <span className="full-screen-loader-timeline"><i /><i /><i /><i /><b /></span>
                <span className="full-screen-loader-orbit" />
                <BrandLogoFrame className="full-screen-loader-logo" logoClassName="full-screen-loader-logo-image" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />
            </div>
            <div className="full-screen-loader-copy"><strong>{title}</strong><span>{subtitle}</span><LoadingSignal /></div>
        </div>
    );
}

export function WorkspaceRouteLoader({ label }: { label?: string }) {
    const { t } = useTranslation();
    const title = label ?? t("account.ui.loader.route");
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={title}>
            <div className="workspace-route-loader-content">
                <span className="workspace-route-loader-mark"><BrandLogoFrame className="workspace-route-loader-logo" logoClassName="size-4" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} /></span>
                <LoadingSignal />
                <span>{title}</span>
            </div>
        </section>
    );
}

function LoadingSignal() {
    return <span className="loading-signal" aria-hidden="true"><i /><i /><i /></span>;
}
