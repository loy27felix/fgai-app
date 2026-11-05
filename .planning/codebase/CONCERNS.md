# Codebase Concerns

**Analysis Date:** 2026-11-05

本地图仅基于本地静态阅读，重点为主站、Python media Worker、自有集成与部署边界；不是完整安全审计。
`production-lab/` 按独立服务集处理，仅抽查自有 gateway 与主站接入，不逐一扫描 upstream/vendor。
“已确认”指可沿仓库调用链证明的代码行为；“条件风险”不表示生产已发生；部署状态、实际配置和容量均未在线核验。
未运行构建、测试、生产脚本或网络请求，未操作 container、SSH 或 daemon；不记录任何凭证值。

## Tech Debt

**启动迁移的 schema 提交与迁移账本记录不是一个原子操作：**
- Issue: 已确认：迁移 SQL 自带 `BEGIN`/`COMMIT`，启动器先执行整个 SQL，再独立插入 `fg_schema_migrations`。
  schema 已提交而账本尚未写入时存在中断窗口；advisory lock 只能避免并发迁移，不能消除该窗口。
- Files: `scripts/local-db-migrate.mjs:66-88`、`docker/initdb/013-local-media-workers.sql:1`、`docker/initdb/013-local-media-workers.sql:133`、`docker-compose.yml`。
- Impact: 条件风险：中断后下一次启动会重放已生效的迁移；是否安全取决于具体 SQL 的可重入性。
  当前未确认存在由此造成的数据丢失或启动事故，不能把所有迁移都视作不可重放。
- Fix approach: 后续修改启动迁移时，将 schema 变更与账本记录设计为同一事务，并一并处理现有 SQL 内部事务边界。
  已应用迁移有 checksum 保护，应新增迁移而非改写历史；本次不调整执行流程。

## Known Bugs

**P1 — `ignoreDuplicates` 被忽略，重放创建请求会覆盖已有生成任务：**
- Symptoms: 已确认：`LocalQuery.upsert()` 接受 `ignoreDuplicates`，但只保存 `onConflict`，最终始终生成 `DO UPDATE SET`。
  图片、视频草稿接口均传入 `ignoreDuplicates: true`，冲突时仍会覆盖 `status`、`request`、模型和画布绑定等字段。
- Files: `lib/local/db.ts:113-117`、`lib/local/db.ts:157-164`、`lib/local/server.ts`、`lib/local/server-client.ts`、
  `app/api/creator/images/route.ts:234-278`、`app/api/creator/videos/route.ts:230-279`、`docker/initdb/001-local.sql:342-353`。
- Trigger: 使用同一用户/工作区的相同幂等键再次创建草稿；已有任务即使不再是 `draft`，冲突分支仍能将其写回 `draft`。
  这是状态覆盖的静态确认；再次付费属于后续确认与 Provider 行为相关的风险，未验证实际扣费。
- Workaround: 暂无可靠的服务端回放保护可绕过此适配器语义；仅避免客户端重复提交不能保证正确性。
  修复应让该选项产生 `DO NOTHING`，再由接口现有的查询分支读取原任务，而不是重置既有状态。

**P1 — media Worker 独立鉴权入口被浏览器 session middleware 提前拦截：**
- Symptoms: 已确认：middleware 将没有 `fg_session` 的非公开路径重定向到 `/login`，公开列表未包含 `/api/creator/worker/*`。
  Python 客户端只发送 Bearer token 或配对信息，不能按预期到达注册、claim、heartbeat 等独立鉴权逻辑。
- Files: `middleware.ts`、`lib/local/middleware.ts`、`worker/src/fg_worker/client.py:26-45`、
  `app/api/creator/worker/register/route.ts`、`app/api/creator/worker/jobs/claim/route.ts`、`lib/creator/media-worker-auth.ts:196-198`。
- Trigger: Worker 通过该 Next.js 入口访问匹配路径且没有浏览器 cookie。
  在 `MEDIA_WORKER_ENABLED=true` 时直接阻断本应可用的功能；生产开关、安装状态与是否存在其他入口未核验。
- Workaround: 不应给 Worker 填造 session cookie，也不应关闭全局鉴权。
  修复时只对独立鉴权 Worker 路径放行 middleware，并保留各 route 的 feature flag、配对码、Bearer 与 lease 校验。

**P2 — 本地媒体 suffix Range 的终点计算错误：**
- Symptoms: 已确认：`bytes=-N` 分支以 `size - N` 计算起点，却仍把 `N` 当成绝对终点。
  因而后缀读取可能得到错误内容或 `416`；不是所有视频播放请求都会触发。
- Files: `app/api/local/storage/content/route.ts:56-63`、`lib/local/storage.ts:231-243`。
- Trigger: 例如对 10,000-byte 的可访问文件请求 `Range: bytes=-500`：源码算出起点 9,500、终点 500，随后拒绝请求。
  此例为静态推导，没有实际发送请求。
- Workaround: 调用方可暂用显式 `bytes=start-end`；服务端应区分 suffix Range 与普通 Range，让 suffix 终点使用 `size - 1`。

## Security Considerations

**P1 — 通用数据库 gateway 的写入所有权边界不完整：**
- Risk: 已确认：route 只用 `payload.user_id ||= user.id` 补默认值，不强制 payload 归属当前用户；
  其追加的 `.eq("user_id", user.id)` 只影响 select/update/delete，insert/upsert SQL 不使用这些 filters。
  已登录调用方若知道其他用户的记录 ID，可通过指定冲突键的 upsert 覆盖该记录或更改归属。
- Files: `app/api/local/db/route.ts:17-36`、`lib/local/db.ts:141-169`、`lib/local/server-client.ts`、
  `docker/initdb/001-local.sql:209-238`、`docker-compose.yml`。
- Current mitigation: 已有登录检查、表/操作/filter allowlist、SQL identifier 校验和参数绑定；读取与一般更新附带用户过滤。
  但仓库初始化 SQL 未为这些表定义补足该边界的 RLS policy，且本地 DB client 自身不实施 row ownership。
  实际部署的额外数据库策略未核验；这不是已证实发生的跨用户攻击。
- Recommendations: 服务端强制写入归属，拒绝转移 owner，并对冲突记录执行原子所有权约束；仅覆盖 payload 的 `user_id` 仍不足以防止覆盖别人的 ID。
  不向浏览器开放任意 conflict target；优先收紧现有三张表的 gateway，而非重建整套数据层。

**P1（配置条件）— 媒体签名缺少必填 secret 的 fail-closed 行为：**
- Risk: 已确认：签名函数在 `SESSION_SECRET` 缺失时回退到源码内固定值，验证端使用同样逻辑且不拒绝启动。
  条件风险：若实际部署遗漏 secret，知道存储路径的调用方可构造可通过验证的链接；没有确认生产存在此配置。
- Files: `lib/local/storage.ts:88-98`、`lib/local/storage.ts:214-225`、`app/api/local/storage/content/route.ts:33-44`、
  `.env.example`、`.env.docker.example`。
- Current mitigation: 已有路径合法性、过期时间和 timing-safe 比较；普通未签名访问仍有用户与路径检查，示例配置也提示提供 secret。
  但有效签名本身可授权无登录读取，因此固定 fallback 不是单纯的开发便利问题。
- Recommendations: 对需要媒体签名的运行环境明确要求高熵 secret，缺失时拒绝签发/验证并给出配置错误。
  不记录或回显 secret；是否需要轮换现有 secret 须由部署核验决定，不能仅据本地图判断已泄露。

## Performance Bottlenecks

**媒体传输仍有整文件驻留内存的路径：**
- Problem: 已确认：普通媒体 GET 无 Range 时调用 `readLocalFile()`；Worker input 无 Range 时将整个文件作为一个 Range 读取。
  Python Worker 的 `download_input()` 同样先获得完整响应 bytes，再写临时文件。
- Files: `app/api/local/storage/content/route.ts:56-62`、`lib/local/storage.ts:226-243`、
  `app/api/creator/worker/jobs/[id]/input/route.ts:14-38`、`worker/src/fg_worker/client.py:32-45`、`worker/src/fg_worker/queue_loop.py`。
- Cause: 服务端使用 `readFile` / `Buffer.alloc(end - start + 1)`，客户端也未流式落盘；显式大 Range 仍会分配对应大小的 Buffer。
  这可沿调用链确认，但没有内存曲线、并发压测或当前 OOM 证据；Worker 入口还受前述 middleware 问题影响。
- Improvement path: 在修复入口后，优先为上述实际传输路径提供有界流式读取/落盘或连续分块下载，并保留鉴权、NAS readiness、Range 与 backpressure 语义。
  不把增大 Node heap 或 libuv worker 数量视为消除整文件分配的办法。

## Fragile Areas

**部署回滚、NAS 隔离与数据库前向迁移的联动边界：**
- Files: `scripts/auto-deploy.sh:555-620`、`scripts/auto-deploy.sh:650-698`、`scripts/local-db-migrate.mjs`、
  `scripts/nas-supervisor.sh`、`scripts/lock-utils.sh`、`docker-compose.yml`、`Dockerfile`、`.codex-memory/project_deployment_version.md`。
- Why fragile: 已确认：部署回滚会选择旧代码重建/替换 App，而启动过程执行数据库前向迁移；回滚函数本身没有数据库逆向迁移。
  条件风险：只有引入不兼容 schema/data 变更时，旧 App 回滚才可能仍不可用；当前未证实存在必然失败的迁移组合。
  NAS 守卫、共享 recreate lock、脚本重执行和 deployment version 又共同决定部署是否真正完成，不能仅看 Git HEAD。
- Safe modification: 保持 fast-forward 后重新执行新脚本、显式注入 `APP_DEPLOYMENT_VERSION`、核对 `/api/version`，以及锁 FD 的 `fstat` 身份校验。
  涉及 schema 的部署需明确旧 App 可读写条件与恢复方案；不能把 checkout 回滚等同于数据回滚。
  任何诊断均不得停用、重启或卸载受保护生产 LaunchAgent，也不得删除锁文件来“解除”冲突。
- Test coverage: 仓库有 `scripts/test-build-resource-guard.py`，但该测试并不等同于迁移后回滚、NAS 探针变化及锁交接的完整验证。
  本轮没有执行任何脚本或故障注入；记忆中的 2026-10-12 卸载事故只是保护约束背景，不作为当前必现 bug。

## Scaling Limits

**媒体文件上限不等于已验证的并发处理容量：**
- Current capacity: 实际吞吐、内存预算及并发安全容量未验证。可确认的协议常量为：Worker 上传上限 2 GiB、单分片 8 MiB；
  默认能力探测也上报 2 GiB 输入上限。这些是代码限制，不是处理能力承诺。
  Files: `lib/local/worker-storage.ts:7-9`、`worker/src/fg_worker/capabilities.py:166`、`worker/src/fg_worker/queue_loop.py:26-28`。
- Limit: 已确认的资源边界沿用上文“整文件驻留内存”问题；不能从这些常量推导系统能稳定并行处理几个大文件。
  Files: `app/api/creator/worker/jobs/[id]/input/route.ts`、`lib/local/storage.ts`、`worker/src/fg_worker/client.py`。
- Scaling path: 先消除无界单次读取，再在隔离环境测量实际文件大小、并发数与峰值内存；本轮不提出未经证实的扩容数值。
  Files: `app/api/creator/worker/jobs/[id]/input/route.ts`、`worker/src/fg_worker/queue_loop.py`。

## Dependencies at Risk

本轮未确认具体依赖漏洞、失效或必须迁移的包；没有联网查询 advisory，也不依据版本号推断漏洞。
`package.json`、`pnpm-lock.yaml` 与 `Dockerfile` 已提供主站依赖和 frozen-lockfile 构建入口；
`production-lab/yingce/gateway/package.json` 是自有集成的独立依赖入口，不代表已审计整个服务集。
因此不提出通用升级、框架迁移或 vendor 重构建议；未开展的软件供应链审计不等于已确认安全。

## Missing Critical Features

**P1 — 主站月度额度检查缺少原子预占：**
- Problem: 已确认：`assertMonthlyBudgetAvailable()` 读取本月用量并比较预计费用，本身没有事务锁或原子扣减/预占。
  主站图片接口在通过检查后调用 Provider，成功后才写入 ledger；两个并发请求可以基于同一剩余额度同时获准。
  Files: `lib/usage/budget.ts:112-191`、`app/api/ai/image/route.ts:113-152`、`lib/usage/ledger.ts`。
- Blocks: 无法把该检查当作严格的并发费用上限；实际超额需要配置有限额度且请求重叠，发生金额和生产频率未验证。
  已有 submitted/unknown 用量统计及未知价格拒绝逻辑仍有作用，但不消除检查到记账之间的窗口。
  若产品要求硬限额，应在调用 Provider 前原子预占并对成功、失败、结果未知分别结算；本地图不假设已经发生超额。
  Files: `lib/usage/budget.ts`、`app/api/ai/image/route.ts`、`lib/usage/reporting.ts`。

## Test Coverage Gaps

**数据库适配器与真实授权/幂等行为之间的覆盖缺口：**
- What's not tested: 已读安全测试只匹配 gateway 源码是否出现 allowlist、登录与 `.eq(user_id)`；这不能证明 insert/upsert 实际 SQL 具有所有权约束。
  图片接口测试包含源码 contract 与注入依赖的行为测试，但未见覆盖真实 `LocalQuery` 冲突 SQL 和已有非 draft 任务重放的回归。
- Files: `tests/creator/security-hardening.test.ts`、`tests/creator/image-api-contract.test.ts`、
  `tests/creator/session-history-recovery-contract.test.ts`、`lib/local/db.ts`、`app/api/local/db/route.ts`、`app/api/creator/images/route.ts`。
- Risk: 前述 owner 边界与 `ignoreDuplicates` 语义缺陷可以在源码形状测试仍通过时存在。
  已有 `buildWhereClause` 的实参断言并不覆盖冲突写入；本轮没有运行测试，不能报告现有测试通过或失败。
- Priority: High；后续经授权补测时，应针对实际 SQL/隔离数据库的跨用户冲突和同 key 重放，而不是再增加字符串断言。

**独立客户端穿过入口守卫、媒体 Range 与费用并发边界的覆盖缺口：**
- What's not tested: 已读 Worker 测试覆盖 token helper、queue fake client、分片规则和 runbook 术语，未见由无浏览器 cookie 的真实 HTTP 客户端穿过 middleware 的用例。
  本轮测试目录检索也未找到 suffix Range 回归；月度额度 contract 验证时间边界及调用入口存在，不验证并发检查/预占。
- Files: `tests/creator/media-worker-auth.test.ts`、`tests/creator/media-worker-assets.test.ts`、
  `tests/creator/media-worker-e2e-checklist.test.ts`、`worker/tests/test_queue_loop.py`、`tests/usage/monthly-budget-contract.test.ts`、
  `lib/local/middleware.ts`、`app/api/local/storage/content/route.ts`、`lib/usage/budget.ts`。
- Risk: route 内部鉴权正确也可能在到达 route 前失败；合法 Range 或并发请求的行为不能由 helper/源码 contract 推断。
  自有 gateway 存在独立 `policy.test.mjs` 及 integration 脚本，不能据主站测试缺口声称整个 `production-lab/` 没有测试。
  参见 `production-lab/yingce/gateway/policy.test.mjs`、`production-lab/yingce/gateway/fg-workspace-policy.integration.mjs`；本轮均未执行。
- Priority: High（Worker 入口、费用并发）；Medium（suffix Range）。“未见覆盖”限于本次静态阅读与检索，不是全仓不存在任何外部验收的断言。

---

*Concerns audit: 2026-11-05*
