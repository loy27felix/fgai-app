import copy from "copy-to-clipboard";
import { App } from "antd";

const COPIED_HINT = "已复制";

export function useCopyText() {
    const feedback = App.useApp().message;
    return (value: string, successText = COPIED_HINT) => {
        void copy(String(value)).then(copied => {
            if (copied) feedback.success(successText);
            else feedback.error("复制失败，请手动选择文本复制");
        }).catch(() => { feedback.error("复制失败，请手动选择文本复制"); });
    };
}
