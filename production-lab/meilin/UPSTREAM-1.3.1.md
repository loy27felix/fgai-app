# FG 1.3.1 上游同步记录

本地候选同步日期：2026-10-10。正式上线状态以 [验收记录](ACCEPTANCE-1.3.1.md) 为准。

2026-10-10 再次执行两个上游的 `fetch origin main` 和 `ls-remote origin refs/heads/main`，远端最新哈希与下表目标一致；候选已包含这些提交，没有重复覆盖后续 FG 修复。最新单项提交分别为画布 COS 素材附件下载修复、ArcReel 队列草稿共享及串行重连 / 延迟反馈处理。

| 组件 | 同步基线 → 目标 | 候选主要变化 |
| --- | --- | --- |
| Open AI Canvas | `d6a57c2fa74afc52fde88d057ce6b6113604b258` → [v1.6.4 / 37b44444](https://github.com/ddcat-ai/open-ai-canvas/commit/37b44444f06c58f3b3ce1937078b520ca99c8db3) | 大画布和连线索引、图片分层、素材去重、参考槽位和视频资源访问恢复、Agent 审批和输出限制、模型能力及尺寸档位。 |
| ArcReel | `0ebdebc5714f5918f567f4e77c0393e0f91b4a49` → [v0.33.0 / 08ab3b32](https://github.com/ArcReel/ArcReel/commit/08ab3b32328bd24de9d5793296df32ed8dd6cb9f) | 素材状态缓存、缩略图按需读取、MP4 faststart、Agent 会话持久化、空闲及队列处理、供应商任务 ID 和失败状态。 |

FG 采用三方对比合并，保留公司统一登录、用户私有运行时、渠道目录、人民币账本、预算、原 3000 入口、NAS 归属和 31 个公司技能包。未将上游独立登录、钱包或任意目录访问替换进公司流程。

画布的 Bash 镜像解析与发布测试依赖 `.github/scripts/resolve-image.sh` 和 `promote-image.sh`。两份脚本按目标上游原文纳入；没有因此启用上游 GitHub 工作流。

FG 适配回归包含跨平台路径及换行、默认品牌和当前外观恢复、公司模型价格与协议约束、受统一登录保护的工作区路由。实际 Skill 调用发现的节点命名问题单独修复：展示使用用户输入摘要，完整技能上下文仍保留在生成请求中。

ArcReel 前端通过自身 `@tailwindcss/vite` 插件处理 Tailwind 4；显式空 PostCSS 插件配置防止嵌入 FG 仓库时继承父项目 Tailwind 3。公司请求适配继续覆盖同步与异步 HTTP 客户端，估价不记为最终生成，暂存清理错误不覆盖原始供应商结果。

Open AI Canvas 的 MIT LICENSE、版权与 NOTICE 保留；ArcReel 的 AGPL-3.0 LICENSE、NOTICE 和修改版源码提供路径保留。上游自身版本号与 FG 1.3.1 版本号分别维护，不将上游包版本改写为 FG 版本。
