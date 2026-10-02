import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { appearanceLogoURL, useAppearanceStore } from "@/stores/use-appearance-store";
import type { ThemeName } from "@/stores/use-theme-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type BrandLogoProps = {
    className?: string;
    fallback: ReactNode;
    alt?: string;
    theme?: ThemeName | "auto";
};

export function BrandLogo({ className, alt = "", theme = "auto" }: BrandLogoProps) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const currentTheme = useActiveTheme();
    const source = appearanceLogoURL(appearance, theme === "auto" ? currentTheme : theme);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    if (!appearance.logoConfigured) return (
        <svg viewBox="0 0 64 64" className={cn("block", className)} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
            <path d="M6 14h21v7H13v9h12v7H13v13H6V14Zm52 5-4 5c-2-2-5-3-8-3-7 0-11 4-11 11s4 11 11 11c2 0 4 0 5-1v-7h-7v-6h14v17c-4 3-8 4-12 4-11 0-18-7-18-18s7-18 18-18c5 0 9 2 12 5Z" fill="currentColor" />
        </svg>
    );
    // A configured custom logo must never fall through to the built-in brand
    // when its file becomes unavailable. Keep its footprint neutral instead.
    if (failedSource === source) return <span className={cn("block", className)} aria-hidden="true" />;
    return (
        <img
            src={source}
            alt={alt}
            className={cn("block object-contain", className)}
            draggable={false}
            onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
                setFailedSource(source);
            }}
        />
    );
}

export function BrandLogoFrame({ className, logoClassName, fallback, alt = "", theme = "auto" }: BrandLogoProps & { logoClassName?: string }) {
    const frameEnabled = useAppearanceStore((state) => state.appearance.logoFrameEnabled);
    const unframedStyle: CSSProperties | undefined = frameEnabled
        ? undefined
        : {
              background: "transparent",
              borderColor: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              color: "inherit",
          };
    return (
        <span className={cn("brand-logo-frame", className)} data-logo-frame-enabled={frameEnabled} style={unframedStyle}>
            <BrandLogo className={logoClassName} fallback={fallback} alt={alt} theme={theme} />
        </span>
    );
}
