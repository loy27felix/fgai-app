export function microphoneErrorMessage(error: unknown): string {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "请允许此页面使用麦克风，再重试";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "未找到麦克风，请检查设备连接";
    if (name === "NotReadableError" || name === "TrackStartError") return "麦克风被占用，请关闭其他录音应用后重试";
    return "无法启动麦克风，请检查浏览器权限和 HTTPS 连接";
}
