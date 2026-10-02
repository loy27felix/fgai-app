# 技术来源

采用 https://github.com/ddcat-ai/open-ai-canvas ，已同步 main / f030204541611256fecf7241c9a9babef1b0408a（基线 v1.6.0 / 42f14cd7）。本公司产品版本是 FG Studio 1.2.0。

画布内的 FG 3D 导演台来自 https://github.com/mangfufu/director-desk ，基线 v0.4.10 / d7b1b915e71b996bbb242abc392b8d06f29ebb6a。保留 `canvas/director-desk/LICENSE` 与动作素材声明；FG 增加同源嵌入、NAS 工程保存和画布输出，桌面专用 MCP、更新与本机密钥设置不在网页版开放。

FG 改动包括独立部署及登录桥接、公司品牌、WeToken 协议与模型参数适配、NAS 上传持久化、人民币报价及账单核销。保留 `canvas/LICENSE`、第三方声明和技术文档；上游版本用于技术追溯，产品更新使用公司仓库。
