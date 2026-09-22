# 画布命名同步与日志工作台审计修复设计

## Goal

修复画布入口重命名无法持久化并在刷新后生成恢复副本的问题，同时收敛日志详情数据表达、响应式布局、可读性和可访问性缺陷；修复后使用静态检查、现有测试、构建和第二轮只读审计验证。

## Scope

### Canvas rename

- 入口卡片和画布详情页都必须将名称写入 `creator_canvases.title`。
- 使用已有 `cloudCanvasVersion` 做乐观并发控制；成功后更新本地版本和 `cloudLocalSignature`。
- 云端失败、版本冲突或未登录时保留本地名称，并显示可理解的失败提示；不得静默覆盖用户输入。
- 刷新同步时，已确认成功的名称变更不得被判定为本地冲突，也不得生成恢复副本。
- 不改变画布图数据、节点同步、删除、导入和复制行为。

### Log detail and UI

- 错误事件的顶层 `code`、`message`、`stack`、`metadata` 等字段必须进入结构化详情。
- Provider body 读取失败必须显示“读取不可用”，不能伪装成成功采集的空 JSON。
- `null` Body 要区分“已采集空 Body”和“未采集”。
- 没有真实 response evidence 时不得生成空响应区；Exchange 单侧提示必须基于真实证据。
- 保持请求/响应/Headers/Body 分区展示；中等屏幕详情面板不得覆盖展开查询栏。
- 浅色主题正文、辅助文字和错误状态必须满足可读性要求；折叠查询栏必须提示未执行草稿条件。
- 固定详情面板需要明确的关闭、键盘焦点和屏幕阅读器语义。
- 普通服务错误日志保留 `Error.stack`。

## Non-goals

- 不引入新的日志采集系统、第三方 UI 依赖或数据库迁移。
- 不重写既有日志查询协议和四类日志分类模型。
- 不新增自动化测试代码，遵循项目 AGENTS 约束；使用现有测试与静态/构建验证。

## Architecture

### Canvas data flow

入口重命名调用一个共享的云端重命名动作：读取当前 `cloudCanvasId` 和 `cloudCanvasVersion`，调用已有 `updateCreatorCanvas(id, { title, expectedVersion })`，成功后写回本地标题、云端版本和签名。详情页使用同一个动作，避免依赖仅由图数据变更触发的 900ms debounce。

刷新同步继续以云端版本为权威，但把“名称已成功同步”的本地签名视为无冲突；版本冲突时重新读取云端并保留用户可见错误，不把一次正常名称变更复制成恢复备份。

### Log detail data flow

`formatExchange` 只根据实际字段证据创建 request/response/error 分区。格式化前先保留 `null` 的捕获语义，再将服务端错误事件的顶层字段映射为结构化错误。Provider 读取失败使用 `responseBodyReadFailed` 和 `responseBodyEncoding` 明确输出 unavailable 状态。

### Log UI flow

查询栏状态继续由 `draft` 与 `applied` 分离。详情面板沿用当前 inspector 组件，但根据断点使用查询栏上下文偏移；在 fixed 模式下提供 dialog 语义、关闭按钮和焦点恢复。主题 token 统一控制正文、辅助文字、错误色和代码块。

## Acceptance criteria

1. 从 `/creator#/canvas` 将已有云端画布改名后，等待保存完成再刷新，只有一个画布且名称保持；云端版本递增。
2. 重命名请求失败时，名称不会被静默重置；页面显示失败原因，可再次保存。
3. 详情页和入口页重命名使用同一云端更新协议；不会因名称变更单独生成“本地恢复备份”。
4. `observability_error_events` 的错误 code/message/stack 可在结构化错误区看到；普通服务错误可看到 stack。
5. Provider body 读取失败显示 unavailable，空 body 显示 empty，未提供 body 不显示错误的空响应内容。
6. 761–1560px 宽度下，详情面板不覆盖展开查询栏；折叠查询栏会明确显示待运行条件。
7. 浅色主题辅助文字、错误文字和详情字段可读；固定详情面板具备可关闭、可聚焦的语义。
8. `pnpm test`、`pnpm exec tsc --noEmit --pretty false --incremental false`、`pnpm build` 和 `git diff --check` 通过；第二轮审计无 P1/P2 未解决项。

## Verification boundary

静态检查和本地构建不能证明生产云端数据已经同步。画布重命名需要在已登录本地浏览器中执行一次“重命名—等待—刷新”链路；若无法获得运行时登录态，只报告静态证据，不宣称生产验证通过。
