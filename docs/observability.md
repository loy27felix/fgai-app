# 功能日志与问题溯源

FG Studio 的服务端日志输出为 JSON Lines，可通过 Docker 主机上的 `pnpm logs:app` 读取；Node runtime 的结构化日志同时异步写入 `observability_log_events`，供 `/admin/logs` 检索。新功能必须先接入 `lib/observability/server-log.ts`，再接入业务逻辑；日志写入失败不能影响正常创作、保存或计费。

## 每个服务端功能的最小事件链

1. `*_received`：收到请求，记录 `traceId`、功能名和非敏感规模信息。
2. `*_rejected`：鉴权、参数、权限或额度拒绝，记录拒绝原因代码。
3. `*_started`：开始外部模型、NAS 或数据库的关键操作。
4. `*_completed`：完成，记录状态、耗时、任务/会话 ID、模型和结果数量。
5. `*_failed`：失败，记录安全化错误、耗时和可关联的 `traceId`。

异步且可能收费的任务（图片、视频、音频）还必须把关键状态写入各自的任务事件表；日志只用于诊断，不能替代任务状态或用量账本。

## Wetoken 请求/响应审计

Wetoken 的 `wetoken_asset_exchange`、`wetoken_video_exchange`、`wetoken_chat_exchange` 和 `wetoken_image_exchange` 事件会为每次供应商 HTTP 调用记录：`exchangeId`、`traceId`、`taskId` / `sessionId`、`operation`、请求 `method`、脱敏后的 `url`、请求 headers、完整 logical request body、HTTP 状态、响应 headers、完整 logical response body、body 编码和 `durationMs`。请求发送、响应收到、网络失败和响应 body 读取失败分别使用稳定的 `stage` 值，便于按 `exchangeId` 配对请求与响应。

这里的“完整”指正常 JSON 业务字段会保留到日志；为防止日志失控，payload 有深度、数组、对象键数量和字符串长度上限，单条 server log 最大为 256 KiB，超出部分以截断标记保留可识别结构。`Authorization`、Cookie、API key、token、签名 query value、签名 URL 的用户名/密码和 query value、Base64/二进制媒体内容均会脱敏；URL 只保留可定位的 origin/path/query key，并附带不可逆的关联 fingerprint。Prompt 和供应商错误响应属于本次 provider exchange 的排障数据，访问日志必须受控，不能对外返回。

## 必须带的字段

- `traceId`：单次 HTTP 请求关联 ID；响应头会回传 `x-fg-trace-id`。
- `feature`、`stage`：稳定、可筛选的功能和阶段名。
- `taskId` / `sessionId` / `workspaceId`：有对应对象时必须带。
- `model`、`referenceCount`、`durationMs`、`outcome`：适用时记录，便于核对模型与耗时。

普通业务日志中不得写入 Prompt 原文、模型回复、图片 Base64、Bearer/API Key、密码、Cookie、签名 URL、邮箱或原始媒体内容；只有上节定义的 provider exchange 审计事件可保留脱敏后的完整 logical request/response body。需要关联使用者时使用内部 UUID，不使用邮箱。

## 前端、主机和周期报表

浏览器由 `components/ClientErrorReporter.tsx` 采集全局 `error`、`unhandledrejection`、网络失败和未成功的 `/api/*` 响应；画布事件异常和必要的创作台诊断通过 `lib/observability/client-log.ts` 进入同一入口 `/api/observability/client-errors`。该接口是旁路 telemetry：事件格式错误、限流或数据库不可用时均不向用户抛出业务异常；事件数量按用户或 User-Agent 限制，文本和 metadata 在入库前脱敏和截断。

实际 Docker 主机上的 `scripts/service-monitor.sh` 每轮把 Docker、NAS、App、PostgreSQL、Tunnel、磁盘和 App 错误检查写入 `observability_service_events` / `observability_error_events`。观测 HTTP 上报在独立后台进程中执行，网络或 App 不可用时不会拖慢本机健康检查。`scripts/report-scheduler.sh` 每 5 分钟调用一次内部 `/api/observability/report-runner`；每轮最多生成 4 份报表，scheduler 失败或历史补算未完成时下一轮继续重试。内部接口使用 `x-fg-observability-secret`，优先读取 `FG_OBSERVABILITY_SECRET`，兼容回退到 `SESSION_SECRET`。

周期报表由 `lib/observability/reporting.ts` 生成并写入 `report_runs` 及三个快照表：

- `report_account_summaries`：按账户汇总 AI 调用、成功/失败/处理中、Token、图片、视频、确认/估算/预留成本、未知成本调用和错误数。
- `report_error_summaries`：合并前端、App、Provider、Infra、Deploy、Billing、Data 和任务状态错误，保留错误类型、首次/末次时间、发生次数及受影响账户/请求/任务数；`metadata.affectedAccountEmails` 保存报表时可关联的账户邮箱，供管理员定位具体影响对象。
- `report_service_summaries`：根据主机心跳和状态事件计算检查次数、事故次数、异常时长；观测断档时标记 `data_complete=false`，不伪造可用率。

日报、周报和月报都按 `Asia/Shanghai` 计算。`revision=0` 是允许异步任务和供应商费用迟到的临时版，`revision=1` 是后续对账的最终版；任务使用数据库唯一键幂等，失败任务保留失败原因并可安全重试。管理员从 `/admin/reports` 查看报表，通知 webhook 失败不会改变报表成功状态。

## 日志检索工作台

管理员从 `/admin/logs` 查看统一日志流。页面把 `audit_events`、`observability_log_events`、`observability_error_events` 和 `observability_service_events` 合并为同一条可检索事件流，支持近 15 分钟、1 小时、6 小时、24 小时、7 天和 31 天范围，按关键词、来源和级别筛选，并通过时间分布、事件列表和右侧完整事件 JSON 详情定位一次异常。默认只读取最近 24 小时，单次最多返回 200 条，继续加载时使用 keyset cursor 在同一组筛选条件下读取后续记录，不受旧 offset 上限影响；当前查询条件会同步到 URL，刷新后保持不变。

`logServerEvent` 先输出 JSON Lines，再把同一份已安全序列化的 payload 放入异步数据库队列；正常数据库可用时，普通服务日志会进入 `observability_log_events`，`recordAuditEvent` 的重复 raw 行会按 `eventId` 与 `audit_events` 合并显示。数据库或队列不可用时保留 Docker stdout 旁路并丢弃数据库副本，保证业务请求不等待观测写入；因此 Docker 日志轮转或 Edge middleware 的 `http_request_received` 仍需通过 `pnpm logs:app` 溯源，不能把它们误认为已进入工作台。事件详情沿用写入端的安全序列化结果，仅对管理员开放。

## 排查方式

```bash
pnpm logs:app | grep '"traceId":"<x-fg-trace-id>"'
pnpm logs:app | grep '"feature":"creator_chat"'
pnpm logs:app | grep '"taskId":"<task-id>"'
```

修改或新增 API 路由时，代码评审应确认：成功、可预期拒绝和异常失败三条分支都有对应的安全日志，并为关键脱敏或关联行为补充自动化测试。Node 日志单条上限为 256 KiB；业务/诊断字段尽量完整保留，但凭据、token、密码、Cookie、签名 query value 和二进制内容仍必须保护。
