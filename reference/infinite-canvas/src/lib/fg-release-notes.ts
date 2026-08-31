import { SYSTEM_VERSION } from "@/lib/version";

import type { ReleaseInfo } from "@/reference/infinite-canvas/src/lib/release";

/**
 * FG Studio owns these notes. Keep the Chinese summary in the same change as
 * the feature commit; never replace it with another project's changelog.
 */
export const CURRENT_RELEASE_LABEL = "更新内容";

export const FG_RELEASE_NOTES: ReleaseInfo[] = [
    {
        version: SYSTEM_VERSION,
        date: "当前系统版本",
        items: [
            { type: "新增", content: "在原有“资产”页旁新增独立“素材库”：可新建文件夹、上传图片/视频/音频，拖入任意画布，或从节点右键菜单保存到素材库；原资产页保持不变。" },
            { type: "新增", content: "节点参考素材的“添加”支持从素材库选择；所选素材会插入当前画布并自动连为参考，提示词中的 @ 引用同步更新。" },
            { type: "修复", content: "提示词库图片预览保留同源安全代理；代理暂时不可用时自动回退到来源提供的公开图片地址，并记录不含完整 URL 的诊断日志。" },
            { type: "新增", content: "新增可选“生成前确认”节点插件：在“节点插件 → 本地插件”启用后，会预览模型、类型与提示词，可取消或确认；默认关闭，不影响原先的一键生成。" },
            { type: "调整", content: "超级画布提示词框的回车只换行，只有点击“开始生成”才会提交；@ 引用候选项仍可用回车选择。" },
            { type: "修复", content: "修复 AI 对话历史在刷新网页后消失的问题，并补充会话读取与恢复链路日志。" },
            { type: "调整", content: "视频比例改为 16:9、9:16、1:1 等通用展示，底层继续保留模型所需的像素尺寸。" },
            { type: "修复", content: "视频上传、画布节点与资产卡现在优先使用私有云端回放地址；历史视频会按任务 ID 或云端备份自动恢复，无法恢复时明确提示重新上传。" },
            { type: "优化", content: "资产区的视频缩略图可显示首帧，鼠标悬停自动静音播放；新增播放失败、云端备份和回放代理的追踪日志。" },
            { type: "调整", content: "右上角更新入口显示为“更新内容”，不再读取其他项目的 dev 标记和更新日志。" },
            { type: "文档", content: "快捷键与操作说明补充 Ctrl/Cmd + 滚轮纵向移动、Shift + 滚轮横向移动、提示词回车换行、视频版本与截帧操作。" },
            { type: "新增", content: "提示词来源新增 YouMind Seedance 2.0 提示词库，并移除 DavidWu GPT Image 2 与 Awesome GPT-4o。" },
            { type: "优化", content: "参考素材栏支持按住拖动调整顺序，图片1、图片2等编号会随引用顺序同步更新；也可用 Alt + 左右方向键排序。" },
        ],
    },
];
