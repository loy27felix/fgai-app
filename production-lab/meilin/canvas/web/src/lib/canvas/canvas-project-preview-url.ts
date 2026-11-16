export function isCanvasProjectPreviewURL(value?: string) {
    return Boolean(value && /^(https?:|blob:|data:image\/|data:video\/|\/(?:fg-six\/)?api\/)/.test(value));
}
