# FG 广告工作台

第六板块中的独立广告制作工作区，复用原版 AdCraft 的 ReactFlow 画布、Pi Agent、技能与时间线。上游源码位于 `upstream/`，基线更新至 `GML-MMGroup/AdCraft@fd2bd03e8756565384834dbfe8b0776915e470fb`；保留源码许可与出处。

新项目可选择自由创作或品牌专业模式。品牌模式依次推进品牌资料、活动目标、创意方案、广告规格和制作；数据库、模型渠道与服务配置使用当前 FG 工作区。已有工程保留原模式。

桌面图片、视频可拖入画布建立媒体节点；图片可拖入或粘贴到对话框，确认素材用途后上传。参考菜单支持多选、可见勾选与确认，保留当前输入文字。上传不会自动调用媒体生成。

用户路径：左侧 **广告工作台 → 新建广告项目 → 填写产品需求和预算 → 打开广告制作画布**。广告不归属神话故事小组或故事项目；创建和回收站统一在 FG 广告页管理。原版工作区内继续规划、编写脚本、制作图像与视频、编辑和导出；重新打开恢复原工程。工作区移除重复的创意、工程、素材及回收站导航，直接访问这些旧地址也会返回 FG 广告页。

账号复用 FG 登录。项目默认私有，仅负责人、明确邀请的成员和超级管理员可访问。每次 API、素材和模型请求都执行服务端权限检查，浏览器没有 WeToken 密钥。工程素材保持项目私有，公司素材库作为共享来源按需导入。同一画布由一位同事编辑，新成员进入时原用户收到实名提示并退出，写入权限由网关强制校验。

模型目录由 FG 已启用渠道及模型能力生成，目前适配 5 个文本、8 个图片和 9 个视频规格；无权限模型不会出现在可用列表。广告助手选择文本模型，节点面板按媒体类型选择模型及真实参数。文本工具调用、图片和视频任务进入现有 FG 队列，记录实际操作人、项目和 Reference ID，复用授权会话的人民币账单核销。参数价格由现有 FG 费率表计算；待核销金额不能当作实际零费用。独立 BGM/TTS 模型未配置，音频可使用上传素材及视频模型原生音轨。

媒体原文件与生成结果存储在 NAS `/Volumes/FgStudio/media/adcraft/workspaces/<workspace>`；SQLite 工程数据库存储于 Mac mini 的 Docker 持久卷，写入后及每分钟做一致性备份到 NAS，启动时可恢复。NAS 标记缺失时拒绝写入。备份、内部记录和数据库不通过媒体接口开放。云端模型任务使用 FG 频控；本机 FFmpeg 合成最多 2 个并行。

验收不调用收费模型：网关模拟覆盖三种请求、工具调用、预算拒绝与重复提交；实际原版服务验证工程创建、参考图 NAS 上传、跨工程拒绝和数据库备份恢复。完整付费成片不自动重跑。

部署使用 `deploy/Dockerfile.{api,web}` 与上游 Agent Dockerfile，仅新增第六板块三个私有容器，外部通过现有 FG 网关进入。前五板块的服务和数据库不改动。

## 原生只读自助排查

API 提供 `GET /internal/support/evidence`、`GET /internal/support/version`。两者只接受独立的 `Authorization: Bearer <SUPPORT_BOT_NATIVE_READ_TOKEN>`，token 未配置或不足 32 字符时均拒绝；FG 业务 secret 不能替代此 token。响应禁止缓存，不接收 SQL、数据库路径、正文或任意 workspace 参数。

共享 API 的 evidence 额外要求可信 gateway 提供：

- `X-FG-Internal: <FG_ADCRAFT_SECRET>`；
- `X-FG-Support-Actor`，必须与 query `actorId` 一致；
- `X-FG-Support-Workspaces`，由 gateway **查询 FG 原生 DB 的所有权/成员 ACL** 得到的 workspace UUID JSON 数组（1–100 个）。gateway 必须剥除客户端同名 header 后重新生成，不能把客户端传入的 workspace 当作授权。映射为空、缺失、非法或内部 secret 不匹配时拒绝，不能降级为扫描全部 workspace。

query：`actorId` 必填；`start/end` 为含时区 ISO 时间，默认以 end（未指定则当前时间）往前 24h，最大 7 天；`limit` 默认 50，范围 1–100；可精确过滤 `projectId/taskId/requestId/traceId`。未知/不支持参数返回 400（`support_unsupported_filter`），重复/非法参数返回 422（`support_invalid_query`）。scope 回显实际执行的 actorId/start/end 及请求中出现的四类 ID filter；错误只返回固定安全 errorCode，不透传业务响应正文。时间范围匹配记录创建或更新时间；records 是授权 workspace 的元数据，不声称该 actor 是每条记录的创建者；logs 另按真实业务 ingress 接受的 actor 精确过滤。

数据只从 `FG_ADCRAFT_SQLITE_ROOT`（默认 `/database`）下 `<workspace>/v2/adcraft.sqlite3` 以 SQLite `mode=ro` 和 `query_only` 读取，不初始化、恢复或迁移业务库。固定投影包含 projects、agent_runs、agent_canvas_chat_turns、agent_canvas_provider_tasks、agent_canvas_skill_runs，关联 workflow 确定 project；不读取名称、提示词、消息、媒体 URL、密钥、provider 响应正文或 JSON payload。`taskId` 对应各类原生 run/turn/task/skill-run ID；业务表的 requestId 仅 agent_runs 原生字段可查，traceId 未在这些业务表持久化，过滤它时 records 为空，不能伪造关联；HTTP logs 可按实际 request/trace ID 过滤。

已通过 FG 业务 secret 的 `/w/<workspace>/…` 请求完成时才写入原生 `support_http_request`，actor 来自可信 FG ingress；support、health、version 探针不产生业务证据。gateway 的合法 `x-request-id` 原样保留；缺失或非法时 API 分配实际 request ID 并在业务响应 `X-Request-ID` 返回，日志记录相同 ID，不把 idempotency key 冒充 request ID。所有 support actor/filter/关联 ID 限 `[A-Za-z0-9_.:-]{1,120}`，非法 query 拒绝，非法可选关联不赋值，业务原 ID 不截断。route 使用匹配后的路由模板，无 query/body/Authorization；写入和读取均严格校验 request ID、整数 HTTP status（100–599）、标准 HTTP method、无 query 的 route、7–40 位 hex commit 和 boolean dirty。异常 method、未匹配 route 或缺失/非法 build 不伪造日志证据，coverage 不可用；指定窗口内旧日志不合法也不透传或改写。日志在 `<workspace>/support-http.jsonl`，使用 Python `RotatingFileHandler`，每段 8 MiB、保留两段历史，跨重启保存；每次 evidence 总计最多读取 2 MiB / 5000 行，再按 limit 裁剪。预算、结果数量截断时 `truncated=true`，不宣称恢复了接入前或已轮转丢弃的历史。部署维持单个 API worker，避免多进程竞争同一 rotating handler。

`coverage.operations`、`coverage.inboundHttp` 分别报告真实源可读性，必需源不可读时 `incomplete=true`，不得把空 records/logs 当作完成 E2E。日志写入/actor 归属缺失会将当前进程 coverage 置为不可用，并尽力保存 `<workspace>/support-http.failed`；该标记跨重启保持，磁盘恢复并补查缺失时段前不能宣称完整。

### 各组件运行版本

| 组件 | 独立版本入口 | 配置与边界 |
| --- | --- | --- |
| API | `http://adcraft-api:8000/internal/support/version` | service=`adcraft`，component=`api`；读取镜像 `/app/adcraft-api-build.json` |
| Agent | `http://adcraft-agent:8765/internal/support/version` | service=`adcraft-agent`，同一 support token；FG 模式也支持该入口，业务 Agent token 不授权 support；读取 `/app/adcraft-agent-build.json` |
| Web | `http://adcraft-web/.well-known/fg-runtime.json` | service=`adcraft-web`，静态公开、仅无敏感构建元数据，精确 location、缺文件 404，不回退 SPA |

三个镜像分别在各自 Dockerfile 接收并固化 `ADCRAFT_BUILD_COMMIT`（完整 Git SHA）、`ADCRAFT_BUILD_VERSION`、`ADCRAFT_BUILD_TIME`（含时区 ISO）、`ADCRAFT_BUILD_ENVIRONMENT`、`ADCRAFT_BUILD_DIRTY`（`true/false`）。部署必须为每个镜像传入真实构建来源；不从运行容器的 checkout、API 版本或业务 `/health` 的旧常量反推其余组件。未注入的字段保持 `unknown`，dirty 为 `null`，gateway 不应视为 verified。API evidence 的 components 不主动访问另外两个服务，标明独立镜像/运行时；统一版本聚合由 gateway 分别读取三处入口并比较。

本地原生隔离可设置 `FG_ADCRAFT_NAS_ROOT`（默认 `/nas`）、`FG_ADCRAFT_SQLITE_ROOT`；需要真实 gateway 冷启动模型目录及 Agent 回调时可分别设置 `FG_ADCRAFT_GATEWAY_BASE_URL`（默认 `http://gateway:3010`）、`FG_ADCRAFT_AGENT_BASE_URL`（默认 `http://adcraft-agent:8765`）。本地源码启动的 API/Agent 可分别用 `ADCRAFT_API_BUILD_FILE`、`ADCRAFT_AGENT_BUILD_FILE` 指向本次启动准备的真实来源 manifest，不能用它们声明未构建的生产镜像。NAS ready 标记与已有存储保护规则不变。
