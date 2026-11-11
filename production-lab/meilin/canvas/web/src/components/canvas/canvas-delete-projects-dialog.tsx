import { App, Button, Modal } from "antd";
import { useState } from "react";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { deleteCanvasProjectsWithRemoteSync } from "@/services/user-data-sync";
import {useUserStore} from "@/stores/use-user-store";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const [deleting, setDeleting] = useState(false);
    const remote=useUserStore(state=>Boolean(state.user));
    const confirm = async () => {
        setDeleting(true);
        try {
            await deleteCanvasProjectsWithRemoteSync(ids);
            void cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
        } catch (error) {
            message.error(error instanceof Error ? `删除画布失败：${error.message}` : "删除画布失败，请稍后重试");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={remote?"移入画布回收站？":"删除画布？"}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        {remote?"移入回收站":"删除"}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{remote?`将 ${ids.length} 个画布移入回收站，保留 30 天，期间可以恢复。到期自动彻底删除，工程记录转入 NAS recycle；素材库及其他画布使用的素材保留。`:`将删除 ${ids.length} 个本地画布，节点和连线也会移除。`}</p>
        </Modal>
    );
}
