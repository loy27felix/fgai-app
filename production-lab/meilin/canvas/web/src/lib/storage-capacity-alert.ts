export function storageCapacityAlert(disk: { available: boolean; usagePercent: number }) {
    if (!disk.available || !Number.isFinite(disk.usagePercent) || disk.usagePercent < 80) return null;
    return disk.usagePercent >= 90
        ? { type: "error" as const, title: "NAS 容量告警", description: "使用率达到 90%，请管理员尽快扩容或整理历史文件。" }
        : { type: "warning" as const, title: "NAS 容量提醒", description: "使用率达到 80%，请管理员安排扩容或整理历史文件。" };
}
