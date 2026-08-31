import { SYSTEM_VERSION } from "@/lib/version";

import type { ReleaseInfo } from "@/reference/infinite-canvas/src/lib/release";

/**
 * FG Studio owns these notes. Keep the Chinese summary in the same change as
 * the feature commit; never replace it with another project's changelog.
 */
export const CURRENT_RELEASE_LABEL = "本次修改";

export const FG_RELEASE_NOTES: ReleaseInfo[] = [
    {
        version: SYSTEM_VERSION,
        date: "当前系统版本",
        items: [
            { type: "新增", content: "新增可选“生成前确认”节点插件：在“节点插件 → 本地插件”启用后，会预览模型、类型与提示词，可取消或确认；默认关闭，不影响原先的一键生成。" },
            { type: "调整", content: "超级画布提示词框的回车只换行，只有点击“开始生成”才会提交；@ 引用候选项仍可用回车选择。" },
            { type: "修复", content: "修复 AI 对话历史在刷新网页后消失的问题，并补充会话读取与恢复链路日志。" },
            { type: "调整", content: "视频比例改为 16:9、9:16、1:1 等通用展示，底层继续保留模型所需的像素尺寸。" },
            { type: "修复", content: "视频上传、画布节点与资产卡现在优先使用私有云端回放地址；历史视频会按任务 ID 或云端备份自动恢复，无法恢复时明确提示重新上传。" },
            { type: "优化", content: "资产区的视频缩略图可显示首帧，鼠标悬停自动静音播放；新增播放失败、云端备份和回放代理的追踪日志。" },
            { type: "调整", content: "右上角更新入口改为 FG Studio 的中文“本次修改”，不再读取其他项目的 dev 标记和更新日志。" },
            { type: "文档", content: "快捷键与操作说明补充 Ctrl/Cmd + 滚轮纵向移动、Shift + 滚轮横向移动、提示词回车换行、视频版本与截帧操作。" },
            { type: "新增", content: "提示词来源新增 YouMind Seedance 2.0 提示词库，并移除 DavidWu GPT Image 2 与 Awesome GPT-4o。" },
            { type: "优化", content: "参考素材栏支持按住拖动调整顺序，图片1、图片2等编号会随引用顺序同步更新；也可用 Alt + 左右方向键排序。" },
        ],
    },
];
