# FG 综合工作台共享运行组件

软件在公司服务器运行，成员通过 FG 登录进入工作台即可使用。每个成员的项目、会话和配置仍保存在各自的独立挂载中，无需在员工电脑安装 Remotion、Chromium、FFmpeg 或 yt-dlp。

## 构建与发布

此 Dockerfile 包含两个交付目标，构建运行服务必须显式选择 `runtime`：

```sh
docker build --target runtime -t fg-creator-runtime:<release> -f deploy/Dockerfile .
docker build --target web -t fg-creator-web:<release> -f deploy/Dockerfile .
```

`provision.py` 在变更实例前校验镜像启动命令必须为 `node /app/fg-entry.mjs`。Web 镜像不能用于运行服务。

发布前备份每个成员的 SQLite 数据库和服务器私密配置；保留上一版镜像。只在当前成员没有进行中的任务时切换实例，发布后检查实例健康接口及 `/creator/components/status`。配置、账户凭据和数据库备份不进入 GitHub。

## Remotion

镜像内打包与执行器相同版本的 Remotion 组件，并使用 Linux Chromium。打包时校验组件清单与资源哈希，实际渲染包含图片、音频和中文字幕的 1280×720 H.264 视频；组件也保留本地修复档案。

2026-10-07 的局域网发布已验证 Remotion 4.0.473；16 个成员实例健康。另在与成员实例相同的 768 MiB / 1 CPU / 256 PID 限制下通过实际视频渲染验证。

## yt-dlp

镜像提供 yt-dlp 2026.08.19、Python、Node.js 与 FFmpeg。更新检查使用官方 nightly 发布 API；GitHub API 限流时从官方发布 Atom 获取版本，再校验官方 SHA256SUMS。下载及原子安装仍使用原有 URL、版本格式和文件哈希校验。

2026-10-07 更新检查接口返回 HTTP 200，发现可更新版本 2026.09.27.232945。这表示更新检查已恢复，不表示所有成员实例已安装该 nightly 版本。

## 原生自助排查（只读）

当前 creator-app/static 入口处于退役保护（HTTP 410），provisioner 显式退出；本次不恢复入口。
下述合同与独立本地 fixture 用于存量原生取证，不能证明产品仍在用或业务入口 E2E 已通过。

`GET /internal/support/evidence` 和可选 `GET /internal/support/version` 位于真实 daemon，
不是 gateway 回执。entry 仅为这两个路径转发原始只读 Bearer，不以可写 daemon token 替换，
也不要求业务 `x-fg-runtime`；其他业务路径仍走原有 capability/daemon Bearer 认证。
只读检查不依赖 NAS marker，因此存储故障时仍可读取实例私有 SQLite 元数据。

实例需要配置：

- `SUPPORT_BOT_NATIVE_READ_TOKEN`：独立随机只读 token，至少 32 字符，不得与
  `FG_CREATOR_CAPABILITY` 或 daemon 业务 token 相同；缺失、过短、复用均 fail closed。
- `FG_CREATOR_ACTOR`：该实例的真实 FG actor。actor、数据库、HOME 和挂载必须按成员隔离，
  查询 `actorId` 必须与启动时的 actor 精确一致；不能用 query/header 切换实例身份。
- `OPENCREATOR_BUILD_COMMIT`、`OPENCREATOR_BUILD_VERSION`、`OPENCREATOR_BUILD_TIME`、
  `OPENCREATOR_BUILD_ENVIRONMENT`、`OPENCREATOR_BUILD_DIRTY`：真实构建/启动注入；
  `TIME` 使用 ISO UTC，`DIRTY` 使用 `true`/`false`。未提供保持 `unknown`，不借用其他组件的版本。
  不向浏览器传递只读 token。

主 `Dockerfile` 的 build stage 接收同名五个 build args，runtime 继承对应 ENV。
shared Web 的 `Dockerfile.web` 也独立接收这些 args，并复制当前 `vite.config.ts`；
Vite 构建产物输出 `.well-known/fg-runtime.json`，内容为
`{service:"opencreator-web",build:{commit,version,buildTime,environment,dirty}}`。
Gateway/preflight 必须另外读取 Web 实例的 `GET /.well-known/fg-runtime.json`，
不能用 daemon 的 `{service:"opencreator",build,actorId}` 证明 shared Web 版本。
Vite dev 也提供相同合同（根路径以及带 `OPENCREATOR_WEB_BASE` 前缀的路径），
其元数据固定于本次 dev 启动，不等于已验证生产构建或 nginx 镜像。
`Dockerfile.patch` 仅更新 entry 等运行资源，不含本次 daemon 源码；原生接口上线必须使用包含新 daemon 的 runtime 镜像。

Evidence 参数：`actorId` 必填；`start`/`end` 为合法 RFC3339 时间，省略时默认最近 24h，
区间必须递增且最多 7 天；`limit` 默认 50，范围 1–100；支持可选
`taskId`、`requestId`、`projectId`、`traceId`。重复参数、未知参数和非法标识均拒绝。

只读取当前 daemon 已打开的 `app.sqlite` 固定表：`projects`、`runs`、`creator_jobs`、
`creator_stage_runs`、`creator_provider_requests`，只返回 ID、状态、时间、关联 ID 和错误码。
时间按 `updatedAt` 筛选（stage 使用 finished/started/created 时间）；`taskId` 对应原生 run/job ID，
也可匹配 stage ID/provider remote task ID；record 的 `requestId` 为 provider request ID，
HTTP 日志的 `request_id` 为请求关联 ID，两者不伪造关联。
模型返回的 errorCode 仅为事实/检索线索，不能单独充分证明根因。
不读取或返回 prompt、state/result body、原始 run 文本、文件路径或凭据。
原生 trace ID 尚不可用，带 `traceId` 查询返回 HTTP 400 `UNSUPPORTED_FILTER`，而不是忽略或放宽筛选。
成功响应的 scope 回显实际应用的 taskId/requestId/projectId（仅传入时包含），以及规范化的 actorId/start/end。

### 原生持久 HTTP 日志与覆盖边界

复用 Node `fs`（无新增依赖），固定写入 daemon 自有
`OPENCREATOR_DATA_DIR/logs/support-http/<FG_CREATOR_ACTOR>/`；目录 0700、文件 0600。
实例必须持久挂载该 dataDir（与 `app.sqlite` 同生命周期），一个 dataDir/actor 仅允许一个 daemon writer。
`http.ndjson` 每 512KiB 轮转为 `http.1.ndjson` 至 `http.3.ndjson`，最多约 2MiB；
追加、轮转、读取串行化，追加后 datasync，`coverage.json` 原子替换并 fsync。
覆盖元数据随实例持久化：最早可证明历史、淘汰边界、关闭/恢复间隔与异常退出缺口。
轮转中断恢复保留文件，但保守地只从恢复时刻重新声明完整覆盖，不补造历史。
读取只访问固定文件，拒绝文件 symlink，重新校验 actor/schema 并按白名单投影；
每次最多读取 2MiB/5000 行，最多返回 `limit` 条最新匹配记录。不扫描 Docker/主机日志。
stdout 仍输出同一脱敏事件，但 evidence 从原生持久文件读取，不依赖 ring 或 stdout 回灌。
现有 run NDJSON 是模型执行事件，不冒充 HTTP 日志。

仅在原有业务 Bearer 认证成功后记录已注册业务路由；support、health/version 探针、
未认证扫描和未通过该业务认证链的 internal tool 路由不生成业务证据。
日志 correlation ID 仅允许 `[A-Za-z0-9_.:-]{1,120}`，`http_status` 为 100–599 整数，
method 为常规 HTTP method，route 不含 query。`build_commit` 必须是实际 7–40 位 hex，
`build_dirty` 必须是布尔值，`build_time` 仅在启动注入了合法 ISO 时间时输出。
缺 commit/dirty 时不伪造元数据或生成不合规事件，HTTP 源标记
`HTTP_LOG_BUILD_METADATA_UNAVAILABLE` 且 incomplete；version 的 unknown 仍保持 unknown。
日志不包含 URL query、原始路径、headers/body 或异常文本；安全 `x-request-id` 可沿用，
否则使用 daemon 自身生成且随响应返回的 `x-request-id`。actor 仅取启动身份，
任务/工程关联只取受限路由参数，不凭空推导跨服务关系。

`coverage.operations.available` 表示固定 SQLite 查询是否成功，读取失败不等同于无数据。
`coverage.inboundHttp` 包含 `available`、`persistent:true`、`retention`、`windowComplete`、
`retainedFrom`、`checkpoint`、`gaps`、扫描计数；缺口时附固定安全 `reason`/`reasons`。
初始化/写入/读取失败、损坏行（含异 actor）、请求窗口早于历史起点、跨重启缺口、
尚未结束的未来窗口或超读取预算都会令顶层 `incomplete:true`。
只有两个必需源可读且实际窗口覆盖完整，才返回 `incomplete:false`；
新实例默认最近 24h 通常历史不足，不能用空数据或预检自身证明业务 E2E。
两类返回各自受 `limit` 限制，超限或扫描预算不足时 `truncated:true`；超扫描预算也会 incomplete。
持续存储失败时不影响业务响应，仅 stdout 可继续输出；恢复存储后需重启该实例重新初始化，
未持久化时段不得补写成历史记录。进程关闭间隔保守地列为覆盖缺口；窗口完全位于重启前则可完整读取。

本地验证应启动独立 HOME、Codex HOME、数据库和项目目录的真实 daemon，
通过免费 `/projects/managed` 和 draft `/creator/jobs` API 创建非空对象，
再验证读取、脱敏、跨 actor 拒绝和 token 权限边界；不调用收费 run/stage API。
本地 Vite dev 元数据验证与 daemon 验证分别执行；生产构建和完整 entry bootstrap
需要另行授权/环境，不可用模拟或空证据替代。
