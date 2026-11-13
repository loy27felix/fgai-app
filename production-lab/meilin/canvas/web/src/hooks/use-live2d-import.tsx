import { App, Select } from "antd";
import { inspectLive2DPackage } from "@/services/live2d-package";

/** Both account and site settings use the same model selection and runtime preparation. */
export function useLive2DImport() {
    const { modal } = App.useApp();
    return async (file: File): Promise<File | undefined> => {
        const archive = await inspectLive2DPackage(file);
        let entry: string | undefined = archive.entries[0];
        if (archive.entries.length > 1) {
            entry = await new Promise<string | undefined>((resolve) => {
                let chosen = archive.entries[0];
                modal.confirm({
                    title: "压缩包中有多个 Live2D 模型",
                    content: (
                        <div className="space-y-3">
                            <p>选择要使用的一套。系统只上传该模型的运行文件，忽略编辑工程和说明文件。</p>
                            <Select
                                aria-label="选择包内 Live2D 模型"
                                className="w-full"
                                defaultValue={chosen}
                                options={archive.entries.map((value) => ({ value, label: value }))}
                                onChange={(value) => {
                                    chosen = value;
                                }}
                            />
                        </div>
                    ),
                    okText: "导入所选模型",
                    cancelText: "取消",
                    width: 600,
                    onOk: () => {
                        resolve(chosen);
                    },
                    onCancel: () => {
                        resolve(undefined);
                    },
                    afterClose: () => {
                        resolve(undefined);
                    },
                });
            });
        }
        return entry ? archive.build(entry) : undefined;
    };
}
