# 技术来源

采用 https://github.com/ddcat-ai/open-ai-canvas ，已同步 main / 1dfc8ce7ac21587719b17fa6f7315a14e03a621f（包含任务恢复、审批暂停和复制节点保存修复）。本公司产品版本是 FG Studio 1.2.12。

FG FOR DIRECTOR 采用 https://github.com/ArcReel/ArcReel 的 0.32.0 / 9aaf44130837120c099b2f774f05670877c91a66，保留 AGPL-3.0 LICENSE 与 NOTICE。对应上游和公司部署层源码可由已登录用户在关于页下载；目录为 `production-lab/arcreel`。

FG FOR CREATER 采用 https://github.com/krillinai/OpenCreator，保留源码中的许可声明；用户界面名称、默认中文、公司模型、计费、NAS 隔离和原生入口由 FG 集成，目录为 `production-lab/opencreator`。

画布内的 FG 3D 导演台来自 https://github.com/mangfufu/director-desk ，基线 v0.4.10 / d7b1b915e71b996bbb242abc392b8d06f29ebb6a。保留 `canvas/director-desk/LICENSE` 与动作素材声明；FG 增加同源嵌入、NAS 工程保存和画布输出，桌面专用 MCP、更新与本机密钥设置不在网页版开放。

FG 改动包括独立部署及登录桥接、公司品牌、WeToken 协议与模型参数适配、NAS 上传持久化、人民币报价及账单核销。保留 `canvas/LICENSE`、第三方声明和技术文档；上游版本用于技术追溯，产品更新使用公司仓库。
