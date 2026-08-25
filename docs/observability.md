# 功能日志与问题溯源

FG Studio 的服务端日志输出为 JSON Lines，可通过 Docker 主机上的 `pnpm logs:app` 读取。新功能必须先接入 `lib/observability/server-log.ts`，再接入业务逻辑；日志写入失败不能影响正常创作、保存或计费。

## 每个服务端功能的最小事件链

1. `*_received`：收到请求，记录 `traceId`、功能名和非敏感规模信息。
2. `*_rejected`：鉴权、参数、权限或额度拒绝，记录拒绝原因代码。
3. `*_started`：开始外部模型、NAS 或数据库的关键操作。
4. `*_completed`：完成，记录状态、耗时、任务/会话 ID、模型和结果数量。
5. `*_failed`：失败，记录安全化错误、耗时和可关联的 `traceId`。

异步且可能收费的任务（图片、视频、音频）还必须把关键状态写入各自的任务事件表；日志只用于诊断，不能替代任务状态或用量账本。

## 必须带的字段

- `traceId`：单次 HTTP 请求关联 ID；响应头会回传 `x-fg-trace-id`。
- `feature`、`stage`：稳定、可筛选的功能和阶段名。
- `taskId` / `sessionId` / `workspaceId`：有对应对象时必须带。
- `model`、`referenceCount`、`durationMs`、`outcome`：适用时记录，便于核对模型与耗时。

日志中不得写入 Prompt 原文、模型回复、图片 Base64、Bearer/API Key、密码、Cookie、签名 URL、邮箱或原始媒体内容。需要关联使用者时使用内部 UUID，不使用邮箱。

## 排查方式

```bash
pnpm logs:app | grep '"traceId":"<x-fg-trace-id>"'
pnpm logs:app | grep '"feature":"creator_chat"'
pnpm logs:app | grep '"taskId":"<task-id>"'
```

修改或新增 API 路由时，代码评审应确认：成功、可预期拒绝和异常失败三条分支都有对应的安全日志，并为关键脱敏或关联行为补充自动化测试。
