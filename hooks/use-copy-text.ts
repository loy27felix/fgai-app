import { App } from "antd";
import copy from "copy-to-clipboard";

export function useCopyText() {
    const { message } = App.useApp();

    return (value: string, successText = "已复制") => {
        void copy(value).then(copied => {
            if (copied) message.success(successText);
            else message.error("复制失败，请手动选择文本复制");
        }).catch(() => { message.error("复制失败，请手动选择文本复制"); });
    };
}
