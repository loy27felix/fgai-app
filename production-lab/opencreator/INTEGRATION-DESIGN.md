# FG 创作者工作台 · OpenCreator 接入评估

2026-10-04；源码已拉取到 `D:/FG.AI/.local/reference-repos/OpenCreator`。
上游：https://github.com/krillinai/OpenCreator ，提交 `a5117d7b7c4273d7c71d94d33efb9d6230a9558d`，Apache-2.0。

目前处于源码评估阶段，尚未提供平台入口或上线服务。

## 对公司有用的部分

视频翻译与双语字幕、视频下载、封面设计、文章与短视频脚本、智能配音。长视频自动切片和数字人仍是上游在开发的能力，不能当作已可用功能交付。通用图片、视频生成已有 FG 画布，独立模块优先解决翻译、配音和跨平台内容改编。

## 为什么不能直接共用一个实例

它依赖 Codex CLI / app-server、个人 Codex 配置和本地 Runtime。daemon 的接口使用一个全局 Bearer Token；文件、项目、会话、MCP、工具执行并没有 FG 的用户权限边界。直接让所有同事共享 Mac mini 的 Codex HOME 会混用文件和凭证。

## 独立接入边界

左侧新增“创作者工作台”，与故事、广告、自由画布平级。FG 网关鉴权后分配每个用户独立 Runtime、数据库、项目目录、Codex HOME 和内部令牌。用户工程默认私有，显式分享，文件仍由 NAS 管理。不能读取主机用户目录、SSH 凭证或原五板块数据。

文本与媒体渠道统一走 FG WeToken 中转。CLI 所需 Responses / tools 协议必须先做免费模拟适配验证，不能把 Chat Completions 模型任意伪装成 Codex 模型。字幕识别、配音服务还需要确认公司实际可用渠道，未配置的能力应明确停用。

源码已核实 `apps/daemon/src/codex/provider-config.ts`：可保存自定义 Base URL、API Key 和模型，也读取 `model_providers` 配置；Codex 是运行引擎，并非只允许官方账号。创作工具还有独立 AI 服务配置与 OpenAI-compatible 图片接口。因此接 WeToken 是可行的适配方向，但尚未完成协议、用户隔离与人民币账单集成，不能标为已上线。Codex 专用生图路径存在主动隔离自定义凭据的实现，不应宣称每个功能都直接遵循同一 Base URL。

所有收费调用在发送前做人民币报价和月额度预留；执行时保留操作人、项目、模型和供应商请求编号，出账按 Reference ID 核销。Codex 原生登录产生的订阅用量不能混报为 WeToken 人民币账单。

## 上线验收

两位用户无法互相读取工程、附件和 Agent 文件；退出后从 NAS 恢复；断线不重复收费；无权限模型不可选；有预算时不允许无费用上限的请求；免费验证下载、导入字幕、导出与删除恢复，最终再按授权验证收费功能。
