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

付费图片或视频请求在连接中断、响应 body 读取失败、成功响应缺少可用结果或任务状态无法确认时，一律记录为 `unknown` / `awaiting_reconciliation`，不自动发起第二次可能收费的请求。图片确认接口返回 `503 GENERATION_STATUS_UNKNOWN`；Creator 视频确认接口只把草稿原子切换为 `queued` 并返回 `202`，由 Compose 的 `video-worker` 继续处理。worker 使用 `creator-video:<taskId>` 作为 Provider 与素材请求的稳定 `Idempotency-Key`，并把 `prepared`、`usage_reserved`、`provider_request_started` 阶段写入任务输出；进程在 Provider 请求阶段重启或超时后只进入待对账，不重复提交。确定性参数/权限拒绝仍标记为失败，并只清理确认未产生副作用的临时素材。

这里的“完整”指正常 JSON 业务字段会保留到日志；为防止日志失控，payload 有深度、数组、对象键数量和字符串长度上限，单条 server log 最大为 256 KiB，超出部分以截断标记保留可识别结构。`Authorization`、Cookie、API key、token、签名 query value、签名 URL 的用户名/密码和 query value、Base64/二进制媒体内容均会脱敏；URL 只保留可定位的 origin/path/query key，并附带不可逆的关联 fingerprint。Prompt 和供应商错误响应属于本次 provider exchange 的排障数据，访问日志必须受控，不能对外返回。

## 必须带的字段

- `traceId`：单次 HTTP 请求关联 ID；响应头会回传 `x-fg-trace-id`。
- `feature`、`stage`：稳定、可筛选的功能和阶段名。
- `taskId` / `sessionId` / `workspaceId`：有对应对象时必须带。
- `model`、`referenceCount`、`durationMs`、`outcome`：适用时记录，便于核对模型与耗时。

普通业务日志中不得写入 Prompt 原文、模型回复、图片 Base64、Bearer/API Key、密码、Cookie、签名 URL、邮箱或原始媒体内容；只有上节定义的 provider exchange 审计事件可保留脱敏后的完整 logical request/response body。需要关联使用者时使用内部 UUID，不使用邮箱。

## 前端、主机和周期报表

浏览器由 `components/ClientErrorReporter.tsx` 采集全局 `error`、`unhandledrejection`、网络失败和未成功的 `/api/*` 响应；画布事件异常和必要的创作台诊断通过 `lib/observability/client-log.ts` 进入同一入口 `/api/observability/client-errors`。服务端从当前 `fg_session` 解析主体并写入 `user_id`，同时把权威 `actorId` / `actorEmail` 固化在 metadata，日志详情优先展示账户邮箱，其次展示用户 UUID；没有会话的历史浏览器错误明确显示为“浏览器会话 / 未关联账户”，不能根据时间猜测用户。该接口是旁路 telemetry：事件格式错误、限流或数据库不可用时均不向用户抛出业务异常；事件数量按用户或 User-Agent 限制，文本和 metadata 在入库前脱敏和截断。

### 画布视频重新生成的播放恢复边界

视频节点重新生成时，旧版本保留在 `videoAlternatives`，新任务在完成前处于 `loading` 且尚无播放地址。浏览器可能在旧 `<video>` 卸载时发出 `onError`；这不是新任务的播放失败，必须忽略，不能用新任务 ID 查询旧版本的副本。真正的播放恢复按失败版本自身的 `creatorTaskId` 或 `cloudStoragePath` 查询，避免把“新任务仍在生成”误报为“视频可用副本暂时无法读取”。该问题于 2026-09-20 通过生产任务与 NAS 文件核查确认。

实际 Docker 主机上的 `scripts/service-monitor.sh` 每轮把 Docker、NAS、App、PostgreSQL、Tunnel、磁盘和 App 错误检查写入 `observability_service_events` / `observability_error_events`。Tunnel 与公网媒体检查分别记录为 `tunnel` 和 `public-media`：前者检查 connector readiness，并同时检查命令退出码和参数错误输出，避免 CLI 报错却返回 0 造成假成功；后者从宿主机探测 `PROVIDER_MEDIA_URL`，验证 HTTPS 证书，只将 2xx 与无参数 `/api/local/storage/content` 的预期 400 视为可达；其他响应、TLS 错误、超时和连接失败均告警，并记录 curl 退出码及 HTTP 状态。两类检查各自连续失败达到阈值后告警；健康和异常状态均每轮采样，先持久化到 outbox，成功落盘后才推进本机状态，重试保留原始 `observedAt` 与唯一 `eventKey`。重复异常采样带有 `metadata.monitorHeartbeat=true`，API 仅接受这两类服务状态未变化的异常标记；日志页面隐藏这些重复异常采样；报表错误汇总在每个受影响周期保留一条持续故障摘要，其余重复采样隐藏。服务可用率统计继续使用完整观测序列，告警仅在状态变化时触发。监控不主动重启或重建 cloudflared，公网失败不能证明 connector 断开。已有容器的 healthcheck 不会随 Compose 文件修改或 `restart` 更新，必须在明确授权的维护操作中重建容器。App 错误采集只匹配顶层 `level=error/critical`、失败/未知 `outcome`、失败 `stage` 或明确的 fatal/panic/exception 文本，不会把成功日志中的嵌套 `error: null` 当成故障；`app-errors` 同一健康状态不重复写事件，只记录状态变化。App 错误通过 outbox 持久投递，按容器时间游标采集完整闭合日志窗口，全部入队成功才推进游标；历史归档按文件字节游标补采，每轮一份、最多 100 行。其他服务健康心跳在独立后台进程中 best-effort 上报；持久 outbox 在本轮健康检查后同步尝试投递，每轮先执行一次最多 2 秒的协议检查，新 API 未就绪时保留所有事件；随后最多尝试 5 条（失败也计入限额）、每条最多等待 2 秒。monitor/error 类别公平轮换，失败事件更新时间后轮到队尾；HTTP 400/405/410/413/415/422 的原事件与拒绝原因保存到本地 quarantine，鉴权、部署、限流与 5xx 故障继续重试。Docker 不可用的早退分支也尝试投递已有积压。网络或 App 不可用时事件继续留在本机队列。内部接口使用 `x-fg-observability-secret`，优先读取 `FG_OBSERVABILITY_SECRET`，兼容回退到 `SESSION_SECRET`。

HTTPS Nginx gateway 将 5xx 请求以 JSON 写入容器 stdout，字段包含不带 query 的 URI、HTTP/upstream 状态、耗时以及 trace/request ID；不记录请求参数、headers、cookie 或 body。`service-monitor.sh` 按持久游标读取这些记录，先写入宿主机 `~/Library/Application Support/fg-studio-monitor/outbox`，再通过受 secret 保护的 `/api/observability/error-events` 送入 `source=infra`。App 暂时不可用时事件留在 outbox，成功收到 2xx 后才删除；固定 `eventKey` 使重叠扫描和重试可幂等入库。NAS supervisor 的故障、恢复和状态过渡也会进入同一 outbox，再写入 `observability_service_events`，并保留原始状态与发生时间。这样 `/admin/logs` 能显示 Nginx 5xx 和 supervisor 状态时间线；NAS 入队失败时保存独立本地 pending 事件，重试保留原始时间与标识，不影响安全保护业务。部署、回滚与 NAS 重建在持锁后先建立旧容器日志 follow，再执行替换；空日志容器通过受限日志查询、同容器运行状态和跟随进程存活进行 best-effort 复核，无法确认时推迟替换。捕获最长 150 秒，重建 CLI 最长 120 秒；CLI 超时后 daemon 状态不确定，本轮不继续盲目回滚或降级替换。归档原子发布，异常捕获的完整行保留为带 `capture_status=partial` 标记的 `*-partial.log`，监控仍按字节游标补采。Docker 已删除、轮转且未归档的日志无法回填。

周期报表由 `lib/observability/reporting.ts` 生成并写入 `report_runs` 及三个快照表：

- `report_account_summaries`：按账户汇总 AI 调用、成功/失败/处理中、Token、图片、视频、确认/估算/预留成本、未知成本调用和错误数。
- `report_error_summaries`：合并前端、App、Provider、Infra、Deploy、Billing、Data 和任务状态错误，保留错误类型、首次/末次时间、发生次数及受影响账户/请求/任务数；`metadata.affectedAccountEmails` 保存报表时可关联的账户邮箱，`metadata.sample` 保存最新失败样本的主体、时间、功能、动作/阶段、Route、Trace/Request/Task、参数、业务数据、metadata、stack 和原始错误，报表可直接跳转 `/admin/logs` 做完整链路检索。
- `report_service_summaries`：根据主机心跳和状态事件计算检查次数、事故次数、异常时长；按 `host + service + check_name` 独立计算再按有效观测时长加权汇总，NAS supervisor 动作事件不参与可用率；首尾和中间统一使用 90 秒新鲜度，超限或存在 unknown 时标记 `data_complete=false`。仅 healthy/unhealthy 计入有效观测，全部异常时可用率为 0，全部 unknown 或无有效观测时为空。

日报、周报和月报都按 `Asia/Shanghai` 计算。`revision=0` 是允许异步任务和供应商费用迟到的临时版，`revision=1` 是后续对账的最终版；任务使用数据库唯一键幂等，失败任务保留失败原因并可安全重试。迟到的监控或错误事件实际入库后，对应历史报表会自动重算，包括超出常规补算范围的最终版；重复投递不会触发重算。服务状态还会影响后续周期的 seed 和事故起点，因此迟到服务采样会使所有结束时间晚于采样的已有报表失效，可能增加历史重算量；普通错误事件仅使所属周期报表失效。旧快照保留到新结果原子发布，页面区分待重算、重算中和真实失败；水位、租约及事务锁防止生成期间的迟到数据或旧任务覆盖新结果。重算不重复发送 webhook。管理员从 `/admin/reports` 查看报表，通知 webhook 失败不会改变报表成功状态。

## 日志检索工作台

管理员从 `/admin/logs` 查看统一日志流。页面把 `audit_events`、`observability_log_events`、`observability_error_events` 和 `observability_service_events` 合并为同一条可检索事件流，支持近 15 分钟、1 小时、6 小时、24 小时、7 天和 3 个月范围，也支持自定义开始/结束时间，单次查询最多 3 个月，按关键词、来源和级别筛选，并通过时间分布、事件列表和详情 inspector 定位一次异常。事件列表直接显示时间、来源、主体邮箱或 ID、事件和动作；选中事件后，详情按“谁、何时、做了什么”展示主体、时间、动作、功能、资源、工作区和状态变化，再展示 trace/request/task 链路、请求响应 headers/body、parameters/data/metadata 和完整事件 JSON。详情 inspector 固定在视口右侧并自带滚动，左侧事件流很长时无需回到页面顶部。默认只读取最近 15 分钟，默认每页 50 条，分页使用保留 PostgreSQL 微秒时间与 bigint 序号的 keyset cursor 在同一组筛选条件下读取前后页，不受旧 offset 上限影响；当前查询条件会同步到 URL，刷新后保持不变。

`logServerEvent` 先输出 JSON Lines，再把同一份已安全序列化的 payload 放入异步数据库队列；正常数据库可用时，普通服务日志会进入 `observability_log_events`，`recordAuditEvent` 的重复 raw 行会按 `eventId` 与 `audit_events` 合并显示。API、管理员页面和所有非 GET 请求的 Edge middleware 元数据会通过内部 Node collector 异步进入同一日志表，collector 不等待业务响应，且不记录请求 body。数据库短暂不可用时，失败批次会在有界队列中等待冷却后重试，同时保留 Docker stdout 旁路；长时间故障超过队列容量、浏览器离线或 telemetry 入口触发保护性限流时，仍只能以旁路日志为恢复依据，不能把旁路数据误认为已进入工作台。事件详情使用完整脱敏序列化预算，列表 preview 使用普通限额；详情仅对管理员开放。

## 自助排查连接日志

网页助手使用既有结构化日志记录进度连接，不记录问题正文、截图、Cookie 或请求凭据：

- `support_bot_web_read_failed`：建连前或备用刷新读取失败，保留 `stage`（环境校验、鉴权、附件或会话快照）和脱敏异常。
- `support_bot_web_stream_failed`：连接建立后的读取或推送异常，保留错误类型、错误码、脱敏消息和堆栈，以及发生阶段和连接持续时间。
- `support_bot_web_stream_closed`：记录 `renewal`（定时续连）、`client_disconnect`（客户端一侧连接结束）或 `error`。客户端结束可能来自关闭页面或网络断开，不能单凭此事件判断用户网络故障；正常续连不记为错误。

上述日志包含 `conversationId` 和 `traceId`；流式日志还关联初始快照中最新一条问题的 `ticketId`、`jobId`（存在时）。SSE、会话快照及读取异常响应通过 `x-fg-trace-id` 返回关联编号，异常详情只进入服务端日志，不发送给用户。日志先写 stdout，再由既有异步队列持久化；数据库不可用时仍可查 stdout，但不能视为已落库。客户端续连和备用刷新合同见 Canvas 的 HTTP API“FG 网页自助排查接入”章节。

## 排查方式

助手调查闭环可按 `jobId` 关联 `support_bot_investigation_finished`（复核完成、调用数量、结论级别、剩余缺口数量）和 `support_bot_investigation_incomplete`（预算、无进展或答复校验阻塞）。后者不代表业务故障原因，也不会将草稿保存为已完成诊断。`support_bot_understanding_failed`、`support_bot_collection_failed`、`support_bot_analysis_failed`、`support_bot_evidence_failed` 记录对应阶段的脱敏异常；查询失败额外标记工具和目标服务，不记录查询参数或问题正文。失败任务按既有队列最多尝试四次，不无限重查。完整流程与证据边界见 README 的自助排查助手章节。

```bash
pnpm logs:app | grep '"traceId":"<x-fg-trace-id>"'
pnpm logs:app | grep '"feature":"creator_chat"'
pnpm logs:app | grep '"taskId":"<task-id>"'
```

修改或新增 API 路由时，代码评审应确认：成功、可预期拒绝和异常失败三条分支都有对应的安全日志，并为关键脱敏或关联行为补充自动化测试。Node 日志单条上限为 256 KiB；业务/诊断字段尽量完整保留，但凭据、token、密码、Cookie、签名 query value 和二进制内容仍必须保护。
