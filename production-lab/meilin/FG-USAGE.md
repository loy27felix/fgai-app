# 美林 · 超级导演

从第六板块侧栏进入，与短剧 Agent、广告工作台和小说转视频并存。管理员在「平台配置 → 功能开放」启用美林后，成员才能使用；直接访问 API 也执行开关和登录校验。

## 制作流程

说一句故事建立剧目，确认立项和全剧画风，逐集写剧本、整理资产、编写分段提示词，再进入拍摄与后期。保留现有小球、剧集网格、全剧资产复用与长期记忆。

默认文本 GPT6.1 Sol（Trings 个人 Key，high 思考）、生图 Seedream 5 Pro、视频 SD2.5。每位成员先到个人设置 → GPT 接入填写自己的 API URL 和 API Key；Key 在服务端按账号加密保存，不回显、不共享。GPT 在 FG 不扣内部额度，实际费用和额度以个人 Trings 账户为准，仍保留用量记录。未配置会明确提示，不自动借用他人或公司 Key。

立项与圣经支持直接编辑，也可复制指引到 Google AI Studio 起草、讨论后粘贴完整 JSON 导入待确认草稿。保存修改后需要重新确认，已有剧本与产物保留。新生成的选角、外貌、表演与红线说明使用中文；已存英文内容可通过「将说明翻译为中文」主动转换，保留角色原名与成片英文对白设定。

资产提示词默认使用 `short-drama-asset-prompts`，生图时可另选已安装的风格技能。文戏默认 `script-to-drama-prompt-dev`；武戏先确认方向卡后使用 `wuxi-action-director-public`。外部技能包从只读挂载加载，缺失会报出技能名称，不静默假装使用。

生成资产或视频后先出现报价确认：展示模型、规格、实际提示词、参考素材、人民币报价及个人月度额度。关闭弹窗不会提交任务，可以稍后重新打开；取消提交不调用媒体模型。确认后可离开页面，服务端继续处理，回到项目按原 FG 任务恢复。

每个资产版本保留实际提示词。视频结果提供原生播放器；只有服务端确认成功并取得资源后才显示已生成。未知进度显示真实状态，不用计时器假装完成。

## 协作与费用

所有者可点击「分享剧目」，用 FG 成员邮箱添加只读或可编辑成员。取消分享后媒体和导出也停止授权。只读成员不能修改、生成或管理分享。

可编辑成员自行确认自己准备的媒体报价，费用计入该成员月度额度。FG 原生项目目前按所有者隔离，因此同一剧的不同提交成员各有一个原生计费项目；通过稳定剧 UUID 汇总，不冒用剧目所有者身份扣费。

计费项目由 `/api/meilin/billing-project` 创建，独立执行美林开放校验，不继承短剧的 `/projects` 开关。项目名称带稳定剧 UUID，避免同一成员建立第二部剧时发生名称冲突；映射响应丢失时找回原项目。该接口由 FG 后端提供，发布时必须与网关适配一起更新。

「费用」页从 FG 原始调用和核销记录读取，支持全剧明细及分集、分段、资产汇总。按用量预估与已核销分开显示；服务商独立回报金额尚未由现有账本提供时标为待确认。未核销不能显示成免费，人工明确免收遵循 FG 账本决定。

剧、集和段有独立稳定编号，插入或删除剧集只变更显示顺序；历史费用、素材版本及原任务不会改归属。删除剧目使用软删除，避免丢失账单和任务映射。

## 服务及上线

生产入口为 `/fg-six/meilin-app/`，API 为 `/fg-six/api/fg/meilin/`。内部服务只在 Compose 网络监听，不对局域网开放独立业务端口。网关逐请求验证 FG 登录和 Origin，再签署短时内部身份；不把平台 Cookie 或上游公司密钥传给美林前端。

数据库使用第六板块 PostgreSQL；上传与输出持久化到 NAS。`deploy/Dockerfile` 的构建上下文为本目录：

```powershell
docker build -f production-lab/meilin/deploy/Dockerfile -t fg-six-meilin:<commit> production-lab/meilin
```

Compose 的 `meilin` profile 默认不自动启动，避免已有部署意外新增服务。授权部署时配置固定 `MEILIN_IMAGE` 和只读 `MEILIN_SKILLS_PATH`，核对挂载存在、备份数据库、预演迁移，再启动该 profile。`MEILIN_INTERNAL_SECRET` 由 Compose 复用既有内部服务凭证，只在服务端注入。

新增表：`fg_meilin_dramas`、`fg_meilin_members`、`fg_meilin_events`、`fg_meilin_projects`、`fg_meilin_calls`。新增表幂等创建，不改写旧表数据。回滚先关闭功能入口并回到原镜像，保留数据表、NAS 文件及账单，不使用 DROP 或清空来回滚。

## 免费验收

在 `upstream/` 执行：

```powershell
npm ci --ignore-scripts
npm test
npm run smoke
npm run build
```

单元/集成测试使用一次性 PostgreSQL 引擎和本地模型服务替身，验证真实 SQL、权限、确认、去重及费用读取。smoke 强制 mock，使用临时目录，成功或失败都清理测试剧并关闭自建服务。测试不运行付费模型。

`scripts/preview-integration.mjs` 仅供本机免费界面验收，不进入运行镜像。其项目和图片为临时测试数据，不能作为真实出图或生产上线证据。

2026-10-15 已发布 v1.3.11 并开放生产入口 `/fg-six/meilin`。四个容器健康、管理员真实登录入口及页面已验；生产 PostgreSQL 快照迁移重复执行通过，143 张既有表指纹不变，新增 5 张美林表。外部 14 个技能包已只读挂载。真实付费文本、图片、视频及费用核销尚未验收，需要单独明确模型、规格与预算；普通成员登录态也仍待实际体验确认。

语音输入目前保留原型的浏览器识别；未接入公司 ASR，也不调用收费配音或音乐服务。当前美林拍摄引用支持图片资产；音频上传保留名称，但独立声音绑定和视频音频参考选择仍需后续实现，不能视为已具备画布的全部多媒体引用能力。

## 原生只读排查

- `GET /internal/support/version` 返回 `{service:"meilin",build}`；`GET /internal/support/evidence` 返回当前真实归属的剧目、生产/Studio 任务快照、本人操作事件及本人原生 HTTP 日志。不调用供应商、不提交任务、不回显 document、prompt、请求 body、Key 或异常原文。
- 两个接口仅接受独立 `Authorization: Bearer <SUPPORT_BOT_NATIVE_READ_TOKEN>`，token 至少 32 字符；未配置、过短或不匹配均 403，不能以 `MEILIN_INTERNAL_SECRET` 替代。需在服务运行环境单独注入，不能传给前端。
- Query：`actorId` 必填 UUID；`start/end` 为带时区 ISO 时间，默认以 end（缺省当前时间）向前 24h，最大 7 天；`projectId/taskId/requestId/traceId` 为可选精确筛选；`limit` 默认 50、范围 1–100。非法、重复或未知 query 返回 400。scope 只回显实际执行的 actor/time 及传入的四个可选筛选；错误提供固定安全 errorCode（兼容 error.code）。
- PostgreSQL 实际检查 `fg_meilin_dramas.owner_id` 或 `fg_meilin_members.user_id`；事件另要求 `fg_meilin_events.actor_id` 匹配。成员被移除后不再看到该剧目记录。`projectId` 是原生剧 UUID；嵌套任务以父文档 `updatedAt` 快照时间筛选，不冒充供应商任务时间。历史缺失的关联 ID/错误码不猜补。
- 新增幂等表 `fg_meilin_support_http` 及 actor/time 索引，包含在现有 `upstream/schema.sql`，服务既有初始化执行迁移。仅在业务身份签名校验成功后的真实业务请求完成/断开时持久化固定安全字段并输出 stdout。`/internal/support/*`、health/version、`/api/config` 等探针不生成业务日志；不把查询 evidence 本身当作业务证据。
- HTTP 日志跨进程重启保留在 PG，不自动清理。每次按 actor、时间和关联 ID 过滤，最多读取 101 条固定字段记录（少于 2 MiB/5000 行），再按 limit 返回。新安装以前、首条持久日志以前没有历史补录。写入失败会使本进程 `coverage.inboundHttp.available=false`，不能把空日志当成健康证明。
- `coverage.operations` / `coverage.inboundHttp` 提供 `available/reason`，日志另有 `retention/availableSince`。源不可读、写失败或请求时间早于可用日志历史时 `incomplete=true`；命中数量超限另标 `truncated=true`。支持接口在某一源故障时仍返回 200 的部分结果并明确缺口，不能据空数组宣布 E2E 通过。
- 构建元数据统一为 `BUILD_COMMIT`、`BUILD_VERSION`、`BUILD_TIME`（ISO）、`BUILD_ENVIRONMENT`、`BUILD_DIRTY`（`true|false`）。Dockerfile 接受同名 build args 并保留到镜像 ENV；打包者必须传实际提交、产品版本、打包时间、目标环境和工作树状态。不在服务启动时伪造构建时间，缺省为 `unknown`，dirty 不明为 `null`。本产品 package version 为 `0.1.0`，提交及 dirty 需按实际构建源计算。
