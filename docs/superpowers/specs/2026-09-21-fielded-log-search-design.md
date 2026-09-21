# Fielded Log Search Design

## Goal

将 `/admin/logs` 从仅支持时间、来源、级别和全文模糊匹配的日志列表，改为同时支持可视化筛选与受限 SLS 风格查询的检索工作台，让管理员能够按一次请求、任务、接口或错误快速定位日志。

## Scope

- 保留统一事件流、旧 URL 参数、keyset 分页、详情 inspector 和脱敏日志内容。
- 支持 `service`、`event`、`route`、`outcome`、`traceId`、`requestId`、`taskId`、`userId`、`actorEmail`、HTTP 状态和耗时。
- SLS 输入支持已知字段的 `field:value`、带引号值、HTTP 状态/耗时的 `=`, `>=`, `<=`，以及裸词全文检索；所有条件按 AND 组合。
- 已知 SLS 字段的非法语法、比较符、数值和冲突范围必须返回可解释的 400，不执行歧义查询。
- 为兼容历史 `q`，未知 `field:value` 保持为一个全文词；未知字段的 `=`, `>=`, `<=` 比较表达式必须返回 400。
- 页面提供与上述字段等价的筛选控件、可移除条件、URL 同步、关联字段一键回填，以及直接可见的 route、HTTP 状态和耗时。

## Architecture

前端将可视化控件和原始 SLS 输入同时映射为同一组 URL/API 参数。后端将 query 参数与 SLS token 归一化为结构化过滤器：ID 和文本字段走真实列的匹配，状态和耗时走范围条件，裸词保留在安全的全文搜索条件中。所有 SQL 值继续使用占位符参数化。

查询继续使用既有四类事件的统一 CTE；过滤器必须在统一查询中一致生效，确保列表、汇总和时间分布看到同一结果集。数据库只增加围绕 `occurred_at` 的高频字段组合索引，不为 payload/JSON/search_text 添加泛化索引。

## Compatibility and Failure Handling

`q`、`source`、`level`、时间、cursor、offset、limit 保持原有语义。未传新字段时结果与原检索保持兼容，历史 `q` 中的未知 `field:value` 不会被误判为字段筛选。前端仅在查询成功后更新已生效 Chip；API 返回 400 时展示错误而不把错误条件伪装成空结果。

## Verification

项目规则禁止为本任务自动新增测试代码。验证使用 TypeScript 类型检查、SQL migration 清单/语法检查、`git diff --check`，以及对 SLS 正常与异常输入的可重复现有运行时检查。未配置 ESLint 时不得启动交互式初始化或写入配置。
