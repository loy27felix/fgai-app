import { HardDrive } from "lucide-react";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, formatStorageBytes } from "@/lib/account-storage-usage";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const query = useAccountFileStorageUsage();
    const usage = query.data;

    return (
        <section className={`assets-storage-usage${usage?.usedBytes ? " has-usage" : ""}`} aria-label="NAS 文件已用" aria-busy={query.isPending} title="个人文件总量不限额，共享引用不重复复制文件">
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">NAS 文件已用</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)}
                    </span>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                    容量统计暂时不可用。
                    <button type="button" onClick={() => void query.refetch()}>
                        重试
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">正在统计已用容量…</span>
            )}
        </section>
    );
}
