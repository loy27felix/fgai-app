# 日志检索工作台重构设计

## Goal

将 `/admin/logs` 重构为以 SLS 查询为入口、以四类日志为一级信息架构的排障工作台：浏览器日志、API 日志、API 运行日志、基建日志。默认汇总视图必须完整保留四类结果；应用与接口只作为排序焦点，不得静默排除其他来源。

## Problem

当前页面把查询编辑、已应用条件、URL、分页、请求生命周期、Facet、日志行和异构详情全部放在一个组件中，形成多个事实来源。查询结果又把 `source`、`service`、`event` 混为同一层，导致：

- “App 服务”和“接口请求”既像视图又像筛选条件，用户无法判断是否丢失其他日志；
- 级别统计来自完整结果，来源/服务/事件却来自当前页，聚合口径不一致；
- 时间桶、Facet、分页和快速视图会分别修改不同状态，慢请求可能覆盖新结果；
- 四类日志的字段语义不同，却使用同一套表格列和详情解释；
- 大量历史 `details` 在列表阶段传输，结果表与详情检查混在一起。

## Scope

### In scope

- 建立 canonical `category`：四个主类别 `browser`、`api`、`api_runtime`、`infrastructure`，以及不丢失历史事实的 `other` 扩展类别。
- 保留现有四条持久化事件流，查询层通过明确分类规则规范化，不新建四套互相独立的日志页面。
- 将 SLS 查询、可视化条件、类别切换、时间下钻和 Facet 统一为同一个可序列化查询模型。
- 后端返回全量口径的类别、级别、来源、服务和事件 Facet，以及时间分布。
- 前端拆分查询栏、Facet、时间分布、日志流和详情检查器；结果流按类别呈现不同摘要字段。
- 仅保留 keyset cursor 分页，保证可复制 URL 与结果页一致。
- 保留旧 URL 参数和旧 `q` 语法的兼容读取，并在成功查询后回显规范化查询。

### Out of scope

- 不重写日志产生方的脱敏策略、内存队列和 stdout 旁路。
- 不把审计事实改造成普通运行日志；审计记录仍保留为 `audit` 事件流，并映射到“其他来源”扩展类别。
- 不增加新的外部日志采集系统或第三方依赖。
- 不为本任务自动生成测试代码；使用现有类型检查、运行时请求和数据库样本验证。

## Canonical taxonomy

查询层为每条 `LogRecord` 增加 `category`，分类规则在统一 CTE 中只定义一次：

| category | 规则 | 典型字段/事件 |
| --- | --- | --- |
| `browser` | `source = frontend` 或客户端错误/客户端交换事件 | 浏览器错误、前端上报日志、用户代理、页面路由 |
| `api` | `source = app` 且事件为 HTTP 请求接收/交换完成，或服务为 `http`/`browser-api` | method、route、HTTP status、duration、trace/request |
| `api_runtime` | `source = app` 的主动运行日志、服务事件、业务接口内部日志，但不属于 `api` | service、event、outcome、message、task、payload |
| `infrastructure` | `source in (infra, deploy)` 或服务/事件明确属于 NAS、tunnel、nginx | host、component、event、level、message、details |
| `other` | audit、provider、billing、data 等无法归入上述四类的持久化事件 | 保留真实 source、service、event 和 details |

`audit`、`provider`、`billing`、`data` 等现有来源不丢弃，也不冒充基建日志；它们归入 `other`，查询响应同时保留真实 `source`，并以“其他来源”扩展分组显示。若未来需要独立审计视图，只增加 category filter，不改变现有事件事实。

默认 `scope=all`。`app-first` 是排序/分组焦点：先展示 `api` 与 `api_runtime`，随后展示明确标记的“其他类别/来源”，不改变命中总数，也不影响分页总量。

## Data and query contract

### Applied query

客户端只把 URL 视为已应用查询的唯一事实来源：

```ts
type LogSearch = {
  from: string;
  to: string;
  q: string;
  scope: 'all' | 'browser' | 'api' | 'api_runtime' | 'infrastructure' | 'other';
  level: LogLevelFilter;
  filters: StructuredFilters;
  limit: 50 | 100 | 200;
  cursor: string | null;
  focus: 'all' | 'app-first';
};
```

`DraftLogSearch` 只存在于查询栏，点击“运行查询”时一次性替换 `LogSearch`。Facet、时间桶、行内关联字段和快速聚焦均从当前 `LogSearch` 派生下一份查询，不直接修改草稿。

### Request

`GET /api/observability/logs` 保留现有认证和旧参数兼容，但增加：

- `scope`：默认 `all`，用于过滤 canonical category；
- `focus`：默认 `all`，只影响结果排序/分组，不过滤数据；
- 只接受 cursor 分页；旧 `offset` 可读取但立即规范化为第一页，不再返回 `nextOffset`。

SLS 支持保持现有安全语义：已知文本字段使用 `field:value`，状态/耗时支持 `=`, `>=`, `<=`，裸词按全文 AND；未知 `field:value` 继续作为兼容全文词，未知比较表达式返回 400。新增字段 `category`/`scope` 的非法值返回可解释的 400。

### Response

```ts
type LogFacet = { value: string; label: string; count: number };

type LogExplorerSnapshot = {
  applied: LogSearch;
  rows: LogRecord[];
  page: { hasMore: boolean; nextCursor: string | null };
  summary: {
    total: number;
    byCategory: Record<string, number>;
    byLevel: Record<string, number>;
    sourceCount: number;
    serviceCount: number;
  };
  facets: {
    category: LogFacet[];
    level: LogFacet[];
    source: LogFacet[];
    service: LogFacet[];
    event: LogFacet[];
  };
  timeline: LogTimelineBucket[];
};
```

Facet 与 summary 必须使用同一 applied query 的全量结果口径。单个 Facet 计算时排除自身维度条件，保证用户从当前类别切换到其他类别时仍能看到可选项。列表行只返回规范化摘要和受控详情字段；详情检查器可以继续展示脱敏 JSON，但不得让列表布局依赖未知 payload 结构。

## Backend architecture

- `lib/observability/log-search-contract.ts`：定义 client-safe 的 `LogSearch`、默认值、URL 编解码、旧参数归一化。
- `lib/observability/log-query.ts`：保留统一 CTE 和 SQL 参数化；新增 canonical category、全量 Facet、scope/focus 归一化；移除 offset 双语义。
- `app/api/observability/logs/route.ts`：只负责认证、输入读取、调用查询和错误映射。
- `app/admin/logs/page.tsx`：只负责认证、URL 解析、初始快照，不再维护前端状态语义。

分类规则、筛选规则、列表/summary/timeline/facet 的 SQL 条件必须共享同一个 normalized filter。`occurred_at` 用于时间线和排序，`ingested_at` 继续保留在详情中以便解释迟到日志。

## Frontend architecture

```text
LogExplorer (reducer + request lifecycle)
├── LogQueryBar (draft, SLS, time, applied chips, focus)
├── LogTimeline (density strip + drilldown)
├── LogFacets (category / level / source / service / event)
├── LogStream (category-aware compact rows + cursor pagination)
└── LogInspector (selected row + HTTP exchange / runtime / browser / infra adapters)
```

页面层级固定为：

1. 紧凑标题和导航；
2. sticky 查询带：SLS 输入、运行按钮、时间、命中数、已应用/待运行标记；
3. 四类 category Tab 与时间分布；
4. 可收起 Facet rail、主日志流、选中后出现的详情 inspector；
5. 空状态只展示当前查询摘要和恢复动作，不保留大面积装饰图表。

颜色仅用于级别、HTTP 状态和当前焦点；日志正文、时间和关联 ID 使用可读的正文/等宽字体组合。旧的营销式大标题、发光伪元素、四张 summary 卡和重复的 inline grid 样式删除或收敛到 `.log-desk` 局部 token。

## State, concurrency and failure handling

- reducer 只保存 `draft`、`applied`、`snapshot`、`selectedId`、`requestState`。
- 每次查询创建 `AbortController` 和递增 request id；只有最新请求可以写入 snapshot、URL、loading 和 error。
- 查询失败保留上一份成功 snapshot，同时明确提示“当前展示的是上次成功查询”；错误条件仍留在 draft 中等待修正。
- 浏览器前进/后退监听 URL 并重新加载 applied query；selected row 不写进查询 URL，详情关闭后不改变结果集。
- 类别 Tab、Facet、时间桶和关联字段都基于 applied query 生成新查询，自动清 cursor 并回到第一页。

## Compatibility and migration

- 保留 `q`、`source`、`level`、时间、结构化字段和旧页面链接；服务端把旧参数归一化为 `LogSearch` 后返回 `applied`。
- 不修改已执行 migration；若确需索引或显式 category 存储，只新增顺序 migration 并登记 checksum。
- 现有 `source` 值保持可检索；新增 category 只作为查询规范化字段，不要求立即回填历史表。
- 详情中的 provider、billing、data、audit 事件继续可见，并标注真实 `source`，不得被归类名称覆盖。

## Acceptance criteria

1. 默认 `scope=all` 时四个主类别和“其他来源”都可见；app-first 只改变顺序/分组，不能改变 total。
2. 输入 `category:api status>=500` 能只筛选 API 错误；输入 `category:infrastructure` 能定位 NAS/tunnel/nginx 类记录。
3. Facet、summary、timeline 和列表总数使用一致的全量口径；切换某个 Facet 后其他 Facet 仍能正确显示候选。
4. 连续点击时间桶、Facet、分页时旧响应不会覆盖新结果；浏览器前进/后退能恢复完整 applied query。
5. API 日志行突出 route、method/status、duration、trace/request；API 运行日志突出 service/event/outcome/message；浏览器和基建行使用各自摘要字段。
6. 详情 inspector 能展示四类日志的关键字段和脱敏 JSON；列表不会因为未知 details 结构撑坏布局。
7. TypeScript、migration syntax、`git diff --check` 和本地登录后的 `/admin/logs` 运行时验证通过。

## Verification

不自动新增测试代码。使用以下可重复验证：

```bash
pnpm exec tsc --noEmit --pretty false --incremental false
node --check scripts/local-db-migrate.mjs
git diff --check
```

运行时验证覆盖：四类 scope、`category`/`status` SLS 查询、空结果恢复、Facet 全量计数、cursor 下一页、详情 inspector、浏览器前进/后退，以及样本 API/运行/浏览器/基建事件的分类结果。
