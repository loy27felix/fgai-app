import { HardDrive } from "lucide-react";
import { Link } from "react-router";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";

function StorageGlyph() {
    return (
        <span className="app-workspace-sidebar-storage-icon" aria-hidden="true">
            <HardDrive strokeWidth={1.75} />
        </span>
    );
}

export function WorkspaceSidebarStorageMeter({ collapsed }: { collapsed: boolean }) {
    const query = useAccountFileStorageUsage();
    const meter = accountStorageMeter(query.data);
    const usedText = query.data ? `已用 ${meter.usedLabel}` : query.isError ? "容量暂不可用" : "正在统计容量";

    if (query.isError && !query.data) {
        return (
            <div className={cn("app-workspace-sidebar-storage is-error", collapsed && "is-collapsed")}>
                {collapsed ? (
                    <button type="button" title="容量统计暂时不可用，点击重试" aria-label="重试加载账号容量" onClick={() => void query.refetch()}>
                        <StorageGlyph />
                    </button>
                ) : (
                    <>
                        <StorageGlyph />
                        <span>容量暂不可用</span>
                        <button type="button" onClick={() => void query.refetch()}>
                            重试
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Link
            to="/assets"
            className={cn(
                "app-workspace-sidebar-storage",
                collapsed && "is-collapsed",
                query.data?.usedBytes ? "has-usage" : null,
                query.isPending && !query.data && "is-pending",
            )}
            title={`${usedText}。文件保存在 NAS，个人文件总量不限额；共享引用不会重复复制文件。`}
            aria-label={`NAS 文件，${usedText}`}
            aria-busy={query.isPending && !query.data}
            onFocus={() => preloadWorkspaceRoute("/assets")}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <StorageGlyph />
            {!collapsed ? (
                <span className="app-workspace-sidebar-storage-body">
                    <span className="app-workspace-sidebar-storage-copy">
                        <span className="app-workspace-sidebar-storage-meta">
                            <span className="app-workspace-sidebar-storage-used">{usedText}</span>
                        </span>
                    </span>
                </span>
            ) : null}
        </Link>
    );
}
