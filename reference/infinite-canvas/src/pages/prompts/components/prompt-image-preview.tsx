import { useMemo, useState, type ImgHTMLAttributes } from "react";

import { promptImageOriginalUrl } from "@/reference/infinite-canvas/src/services/api/prompt-image-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    src: string;
    promptId?: string;
};

function hostOf(value: string) {
    try {
        return new URL(value).hostname;
    } catch {
        return "unknown";
    }
}

/**
 * Prompt sources often use public CDNs. Keep the authenticated same-origin
 * proxy as the first request, but render the public URL if that proxy is
 * unavailable (for example after an expired browser session).
 */
export function PromptImagePreview({ src, promptId, alt, onError, ...props }: Props) {
    const [usingDirectUrl, setUsingDirectUrl] = useState(false);
    const directUrl = useMemo(() => promptImageOriginalUrl(src), [src]);
    const visibleUrl = usingDirectUrl && directUrl ? directUrl : src;

    return (
        <img
            {...props}
            src={visibleUrl}
            alt={alt}
            onError={(event) => {
                if (!usingDirectUrl && directUrl) {
                    console.warn("[prompt preview proxy failed; using public fallback]", { promptId, host: hostOf(directUrl) });
                    setUsingDirectUrl(true);
                    return;
                }
                console.warn("[prompt preview image failed]", { promptId, host: hostOf(visibleUrl), path: usingDirectUrl ? "public-fallback" : "proxy" });
                onError?.(event);
            }}
        />
    );
}
