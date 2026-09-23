# 日志检索工作台重构设计

## Goal

将 `/admin/logs` 重构为以 SLS 查询为入口、以四类日志为一级信息架构的排障工作台：浏览器日志、HTTP 日志、API 日志、基建日志。HTTP 日志记录请求/响应基本信息；API 日志只记录服务端运行时 API 内部的自定义日志、message 和用于排查的标准事件（含审计事件）。默认汇总视图必须完整保留各类结果；应用与接口只作为排序焦点，不得静默排除其他来源。

## Problem

当前页面把查询编辑、已应用条件、URL、分页、请求生命周期、Facet、日志行和异构详情全部放在一个组件中，形成多个事实来源。查询结果又把 `source`、`service`、`event` 混为同一层，导致：

- “App 服务”和“接口请求”既像视图又像筛选条件，用户无法判断是否丢失其他日志；
- 级别统计来自完整结果，来源/服务/事件却来自当前页，聚合口径不一致；
- 时间桶、Facet、分页和快速视图会分别修改不同状态，慢请求可能覆盖新结果；
- 四类日志的字段语义不同，却使用同一套表格列和详情解释；
- 大量历史 `details` 在列表阶段传输，结果表与详情检查混在一起。

## Scope

### In scope

- 建立 canonical `category`：四个主类别 `browser`、`api`（界面名称为“HTTP 日志”）、`api_runtime`（界面名称为“API 日志”）、`infrastructure`，以及不丢失历史事实的 `other` 扩展类别。
- 保留现有四条持久化事件流，查询层通过明确分类规则规范化，不新建四套互相独立的日志页面。
- 将 SLS 查询、可视化条件、类别切换、时间下钻和 Facet 统一为同一个可序列化查询模型。
- 后端返回全量口径的类别、级别、来源、服务和事件 Facet，以及时间分布。
- 前端拆分查询栏、Facet、时间分布、日志流和详情检查器；结果流按类别呈现不同摘要字段。
- 任意一条日志都可以打开独立详情检查器；详情按类别展示完整上下文、关联字段和脱敏原始 payload，不要求用户先猜字段或离开当前结果集。
- 仅保留 keyset cursor 分页，保证可复制 URL 与结果页一致。
- 保留旧 URL 参数和旧 `q` 语法的兼容读取，并在成功查询后回显规范化查询。

### Out of scope

- 不重写日志产生方的脱敏策略、内存队列和 stdout 旁路。
- 不把审计事实改造成普通运行日志；审计记录仍保留为 `audit` 事件流，但作为服务端 API 排障标准事件纳入 `api_runtime`（界面名称为“API 日志”）。
- 不增加新的外部日志采集系统或第三方依赖。
- 不为本任务自动生成测试代码；使用现有类型检查、运行时请求和数据库样本验证。

## Canonical taxonomy

查询层为每条 `LogRecord` 增加 `category`，分类规则在统一 CTE 中只定义一次：

| category | 规则 | 典型字段/事件 |
| --- | --- | --- |
| `browser` | `source = frontend`，但不是明确的 HTTP 请求/响应交换记录 | 浏览器错误、前端上报日志、用户代理、页面路由 |
| `api`（HTTP 日志） | 明确记录 HTTP 请求/响应交换的事件；按具体 HTTP 事件识别，不以 `route`、`http_status` 或 `source` 单独推断 | method、route、HTTP status、duration、trace/request |
| `api_runtime`（API 日志） | 服务端运行时来源 `app`、`provider` 的自定义日志/message、标准化排查事件和审计事件；不包含 HTTP 请求/响应基本记录 | service、event、message、stage/outcome、audit actor/action/resource、task、safe context |
| `infrastructure` | `source in (infra, deploy)` 或服务/事件明确属于 NAS、tunnel、nginx | host、component、event、level、message、details |
| `other` | 无法归入上述类别的未知来源持久化事件 | 保留真实 source、service、event 和 details |

未知的非浏览器、非服务端、非基建来源不丢弃，也不冒充基建日志；它们归入 `other`，查询响应同时保留真实 `source`，并以“其他来源”扩展分组显示。`provider` 表示服务端 API 的 Provider 调用诊断，归入 `api_runtime`；当前 billing 导入事件的实际 source 为 `app`，因此随 app 事件归入 `api_runtime`。虽然 `billing` 和 `data` 是允许的 source 值，仓库中没有对应 source 生产者，不因枚举存在就扩大分类；无已确认 API 生产者的来源仍归入 `other`。`audit` 事件及其未配对的 audit 来源标准事件归入 `api_runtime`，同时保留 `kind` 和真实 `source`；详情中显示审计主体、动作、资源及结果，不把审计事件伪装成普通 message。

现有查询参数值为兼容既有链接保持不变：`api` 对应 HTTP 日志，`api_runtime` 对应 API 日志。界面标签、Facet 和 SLS 字段说明必须明确展示映射，避免把内部兼容 key 误当成用户可见分类名称。

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

SLS 支持保持现有安全语义：已知文本字段使用 `field:value`，状态/耗时支持 `=`, `>=`, `<=`，裸词按全文 AND；未知 `field:value` 继续作为兼容全文词，未知比较表达式返回 400。`category:api` 继续指向兼容 key `api`（HTTP 日志），`category:api_runtime` 指向 API 日志；查询栏字段说明同时展示用户可读名称。新增字段 `category`/`scope` 的非法值返回可解释的 400。

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

Facet 与 summary 必须使用同一 applied query 的全量结果口径。单个 Facet 计算时排除自身维度条件，保证用户从当前类别切换到其他类别时仍能看到可选项。列表行只返回规范化摘要和有界的脱敏标量上下文预览，不返回任意完整 payload；API 日志列表应优先呈现真实 message、事件和少量排障字段。任意日志行点击后打开详情检查器，详情检查器展示规范化字段、关联字段、类别专属字段和完整脱敏 JSON。未预先登记的自定义标量字段应可在事件上下文中直接查看；对象/数组应单列全宽、折叠且有高度上限，避免挤成窄长列。详情读取失败时保留结果流，并在检查器内显示可重试错误，不得把详情错误当成查询失败。

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
└── LogInspector (selected row + HTTP exchange / runtime / browser / infra adapters + full redacted payload)
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
2. 输入 `category:api status>=500` 能只筛选 HTTP 错误；输入 `category:api_runtime` 能定位 API 内部日志（含审计事件）；输入 `category:infrastructure` 能定位 NAS/tunnel/nginx 类记录。
3. Facet、summary、timeline 和列表总数使用一致的全量口径；切换某个 Facet 后其他 Facet 仍能正确显示候选。
4. 连续点击时间桶、Facet、分页时旧响应不会覆盖新结果；浏览器前进/后退能恢复完整 applied query。
5. HTTP 类别仅包含明确的请求/响应交换事件；携带 route/status 的 API 内部错误、普通前端错误不会因此误分类。API 类别包含服务端自定义日志/message、诊断标准事件和 audit 事件；审计去重规则不变。
6. HTTP 日志行突出 route、method/status、duration、trace/request；API 日志突出自定义 message、service/event、stage/outcome、审计主体/动作/资源及安全上下文；浏览器和基建行使用各自摘要字段。
7. 任意日志都能打开详情 inspector；详情能展示各类日志的关键字段、关联 ID、类别专属字段和完整脱敏 JSON，并支持复制/重试；未知标量上下文可见，复杂值全宽折叠，列表不会因未知 details 结构撑坏布局。
8. TypeScript、migration syntax、`git diff --check` 和本地登录后的 `/admin/logs` 运行时验证通过。

## Verification

不自动新增测试代码。使用以下可重复验证：

```bash
pnpm exec tsc --noEmit --pretty false --incremental false
node --check scripts/local-db-migrate.mjs
git diff --check
```

运行时验证覆盖：四类 scope、`category`/`status` SLS 查询、空结果恢复、Facet 全量计数、cursor 下一页、详情 inspector、浏览器前进/后退，以及样本 API/运行/浏览器/基建事件的分类结果。
