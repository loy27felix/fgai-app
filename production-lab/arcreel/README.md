# FG 超级小说转视频：ArcReel 上游适配

上游地址、提交与许可证见 [SOURCE.md](SOURCE.md)。当前同步目标为 ArcReel v0.32.0，提交 `0ebdebc5714f5918f567f4e77c0393e0f91b4a49`。

## 本次同步内容

- 新手引导和演示工作台调整，引导气泡跟随对应卡片，并可在原位置交接给 Agent。
- 长文本弹窗支持键盘滚动；长名称和较窄工作区减少横向溢出；页面布局与截图检查覆盖更多场景。
- 项目概览在切换页面后继续生成，通知的「查看」能跳到对应资产和分镜。
- 资产搜索兼容带重音的名称，并统一 SQLite 与 PostgreSQL 的匹配行为。
- 草稿、脚本规划、剪辑时间线和记忆的已保存改动计入项目最近活动。
- 写入后的刷新失败会明确提示；带未保存改动的删除只有成功后才清除草稿；合并、重命名确认与资产写入保持同步。
- 对话框、状态栏、预览与选择器继续迁移到共享组件；代码、模型 ID、Token 与请求路径字段使用等宽字体。

同步保留 FG 品牌、公司模型与费用适配、用户运行环境隔离，以及此前从设置中移除市场和许可源码面板的调整。许可证、NOTICE 和可下载源码仍保留，界面入口移除不等于移除许可证义务。

## 验证和发布

按 `upstream/AGENTS.md` 执行受影响域的完整检查。前端上游测试和页面替身使用 `VITE_BRAND_NAME=ArcReel`，正式构建使用 `FG FOR DIRECTOR`，工作台导航展示「超级小说转视频」。测试容器不能继承正式运行环境的 `AUTH_ENABLED=false` 或固定 `DATABASE_URL`：测试需启用认证检查，并让 fixture 创建各 worker 独立的数据库。

后端测试和浏览器压力测试依次运行。Playwright 使用与锁文件一致的官方镜像，增加测试容器共享内存；失败场景保留原断言，不用重录截图掩盖品牌或布局错误。

本次验证覆盖全部 15,844 项后端测试：unit 9,287 通过、1 跳过，integration 6,554 通过、2 跳过。测试主机有 7.75 GiB 可用内存，单进程执行全量套件的嵌套子进程曾触发 OOM；按两个目录依次执行 `pytest -n 4 --dist loadfile` 后全部收集项完成。`tests/e2e/` 没有 Python 测试，页面测试由前端 Playwright 执行。前端 3,499 项测试通过；1,291 个页面场景先执行完整套件，再用正确品牌环境和独立容器复测全部失败场景，最终全部通过。后端静态检查、市场子包 686 项测试、测试规范审计、CI 工作流检查及文档站检查通过。

发布前备份每位用户的 SQLite 数据库并执行 `PRAGMA integrity_check`。运行中的生成任务会推迟该用户的运行环境升级。发布器检查镜像启动命令、升级后健康状态；异常时恢复原镜像，用户项目目录与素材不重建。

数据库迁移失败时，应恢复对应的升级前数据库快照再恢复旧镜像。不要让旧镜像直接读未确认兼容的新 schema。

## 镜像与源码

从本目录构建 `deploy/Dockerfile`，显式传入 `BUILD_COMMIT`。镜像启动命令应为 `/app/.venv/bin/python /app/fg-entry.py`；只有前端静态构建产物不能作为后端运行镜像。

`/app/fg-source.tar.gz` 保存实际随镜像发布的上游代码和 FG 适配。公司凭据只保存在服务器私密配置中，不包含在源码包、Git 或前端响应里。

## 原生只读排查

产品入口 `deploy/entry.py` 将原生 FastAPI 挂载至 `GET /internal/support/evidence`
及 `GET /internal/support/version`。这两个精确路径独立校验
`Authorization: Bearer <SUPPORT_BOT_NATIVE_READ_TOKEN>`，不要求 `x-fg-runtime`，
也不接受普通 capability / JWT 替代。token 至少 32 字符，且不能等于
`FG_ARC_CAPABILITY`；未配置或实例 `FG_ARC_ACTOR` 无效时返回 503。
其他业务路径仍使用原有认证，不授予排查 token 写权限。

- evidence 的 `actorId` 必须等于服务端 `FG_ARC_ACTOR`，不读取客户端 actor header。
  `start/end` 接受带时区的 ISO 时间，默认最近 24h，窗口最长 7 天；
  `limit` 默认 50、范围 1–100。成功响应 scope 回显实际执行的精确 `projectId/taskId`，
  未知参数、重复参数、无效标识和非法窗口拒绝请求。
- records 从配置的原生 SQLite（`mode=ro` + `query_only`）中读取 tasks、
  agent_sessions，以及 `ARCREEL_DATA_DIR/projects/*/project.json` 的 metadata。
  时间筛选依据 `updatedAt`；项目 `status=present` 仅表示存在持久化项目文件，
  `agent_run` 为会话快照，不等同于逐轮执行历史。只投影固定标识、状态、时间字段，
  不返回标题、prompt、用户内容、payload、result、异常原文或凭据。
- 原生持久化目前没有 requestId / traceId 关联字段；指定这些条件时返回部分覆盖：
  `records=[]`、`coverage.operations.available=false`、固定 reason
  `native_records_request_trace_filter_unsupported`，以及 `incomplete=true`。
  HTTP 日志仍按全部请求条件（含 requestId / traceId）精确取交集筛选，scope 原样回显这些条件，
  inboundHttp 反映真实日志可读性；不放宽 records、不伪造请求到持久化记录的映射，
  也不把 partial chain 当作完整链路。接口校验错误返回固定
  安全 errorCode；业务记录无结构化 errorCode 时不从异常原文推断错误码。
- 仅入口 capability 认证接受后的业务 HTTP 请求记录 `support_http_request`：UTC `timestamp`、服务端 actor、
  安全格式的受信代理 `request_id`（否则新生成并通过 `X-Request-ID` 回传）、`http_status`、method、route template、
  build 字段及存在的安全路径 ID。不采集 query / body / header / 原始 URL。
  `/internal/support/*`、health/version 及 capability 拒绝请求不采集，探针不会制造业务日志。
  认证接受标记、actor/build/timestamp 缺失的历史不冒充业务证据，也不补造历史 actor。
- 安全 HTTP 日志使用 stdlib RotatingFileHandler 写 stdout 与实例 `/state/support-http.jsonl`，
  每文件 1 MiB、保留 1 份轮转文件，重启后继续读取；可用 `ARCREEL_SUPPORT_LOG_DIR`
  指定实例私有目录。本地读取总上限 2 MiB / 5000 行，不解析原有非结构化日志。
  不补造缺少入口接受标记、actor/build/timestamp 的历史，写入/读取失败使 inboundHttp.available=false。
  轮转历史缺口、来源不可读或扫描上限均在 coverage 披露；
  `coverage.operations` / `coverage.inboundHttp` 描述可用性，`incomplete` 表示
  必需源不可用、部分不可读或历史缺口，`truncated` 表示结果/扫描达到上限。
  空 records / logs 仅是查询结果，不代表业务 E2E 验收成功。

### 运行版本与配置

`version` 返回 `{service, build, actorId}`。build 含 `commit/version/buildTime/environment/dirty`，
缺失或无效值为 `unknown`（dirty 已知时为 boolean），不从 gateway 回执推断运行版本。

Dockerfile 在实际 build 中写入 `/app/arcreel-build.json`：
`BUILD_COMMIT`、`BUILD_TIME`、`BUILD_ENVIRONMENT`、`BUILD_DIRTY` 为 build args；
version 取镜像内 `pyproject.toml`，未传 buildTime 时使用构建当刻 UTC 时间。
commit、environment、dirty 未提供时保持 unknown。
不构建镜像的本地启动可显式注入下列运行变量（存在时覆盖镜像 manifest）：

```text
FG_ARC_ACTOR
FG_ARC_GATEWAY_URL
LISTEN_HOST
LISTEN_PORT
SUPPORT_BOT_NATIVE_READ_TOKEN
ARCREEL_BUILD_COMMIT
ARCREEL_BUILD_VERSION
ARCREEL_BUILD_TIME
ARCREEL_BUILD_ENVIRONMENT
ARCREEL_BUILD_DIRTY
DATABASE_URL
ARCREEL_DATA_DIR
ARCREEL_SUPPORT_LOG_DIR
```

部署方必须向每个实例注入独立只读 token，并传入真实构建/启动元数据；
这里不改共享 gateway / relay，也不恢复已退役的 `deploy/provision.py`。
共享排查环境 `SUPPORT_BOT_ENVIRONMENT=local` 对应实例注入
`ARCREEL_BUILD_ENVIRONMENT=development`；历史日志保留生成时的真实 environment，
不得通过改写历史日志或伪造 clean 状态满足环境校验。

完整 `deploy/entry.py` 可使用受信 `FG_ARC_GATEWAY_URL`（默认 `http://fg-gateway:3010`）
选择 Gateway origin，仍调用 `/internal/arcreel/<actor>/models`，不绕过模型目录鉴权或退役策略。
`LISTEN_HOST/LISTEN_PORT` 默认 `0.0.0.0/1241`；HOME 与既有数据/DB env 可隔离至本地临时目录。
完整入口启动依赖真实 Gateway 模型目录（text/image/video 均非空）及其 capability，
此初始化与后续模型执行不能用仅 native app/lifespan 探针替代。

支持日志为实例私有文件（0600），读写拒绝 symlink / 非普通文件；
JSONL 解析只投影固定安全字段，缺少认证接受标记或 actor 不匹配的行不作为证据。
这不是针对实例内同 UID 恶意进程的签名审计日志；信任边界仍是实例文件/进程隔离。
