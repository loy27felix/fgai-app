import { useState } from "react";
import { App, Button, Modal } from "antd";

import { deleteCreatorCanvas } from "@/lib/creator/canvas-client";
import { useAssetStore } from "@/reference/infinite-canvas/src/stores/use-asset-store";
import { useCanvasStore } from "@/reference/infinite-canvas/src/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/reference/infinite-canvas/src/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const projects = useCanvasStore((state) => state.projects);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);

    const confirm = async () => {
        if (busy || !ids.length) return;
        setBusy(true);
        try {
            const selected = projects.filter((project) => ids.includes(project.id));
            const requests = selected.flatMap((project) => project.cloudCanvasId ? [deleteCreatorCanvas(project.cloudCanvasId)] : []);
            const results = await Promise.allSettled(requests);
            let blockingFailure: unknown = null;
            for (const result of results) {
                if (result.status !== "rejected") continue;
                const status = result.reason && typeof result.reason === "object" && "status" in result.reason
                    ? Number((result.reason as { status?: unknown }).status)
                    : 0;
                // A 404 means the cloud row is already gone; deleting the
                // local project is safe and prevents it from being re-imported.
                if (status !== 404) {
                    blockingFailure = result.reason;
                    break;
                }
            }
            if (blockingFailure) throw blockingFailure;

            deleteProjects(ids);
            cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
            message.success("画布及其云端记录已删除");
        } catch (error) {
            console.error("[canvas delete]", error);
            message.error("云端画布删除失败，未删除本地画布，请重试");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            onCancel={() => !busy && setDeleteIds([])}
            footer={
                <>
                    <Button disabled={busy} onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" loading={busy} onClick={() => void confirm()}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。云端副本也会同步删除，避免下次进入时自动回补。</p>
        </Modal>
    );
}
